#!/usr/bin/env python3
"""Regenerate weather-icons-set2 from the source Vecteezy SVG.

The source SVG contains 22 direct child icon groups under the outer wrapper
group. This script renders each icon group on the full source canvas via
Quick Look, crops to the visible pixels, expands to a square viewBox with
consistent padding, and rewrites the SVG/PNG outputs plus a small gallery and
manifest.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)

OUTPUT_SIZE = 320
THUMB_SIZE = 2048
BACKGROUND_TOLERANCE = 6
PADDING_RATIO = 0.14
MIN_PADDING = 44.0

ROLE_MAP = {
    "rain": "weather_icon_set2_21",
    "rainNight": "weather_icon_set2_20",
    "heavyRain": "weather_icon_set2_01",
    "thunder": "weather_icon_set2_08",
    "storm": "weather_icon_set2_07",
    "wind": "weather_icon_set2_15",
    "cloud": "weather_icon_set2_16",
    "clearDay": "weather_icon_set2_22",
    "clearNight": "weather_icon_set2_18",
    "cold": "weather_icon_set2_13",
    "snow": "weather_icon_set2_13",
    "fallback": "weather_icon_set2_16",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        default="/Users/felixlee/Downloads/vecteezy_weather-icon-set-full-color_1436842.svg",
    )
    parser.add_argument(
        "--dest",
        default="/Users/felixlee/Documents/YuenYuenWeatherSite/public/asset/weather-icons-set2",
    )
    return parser.parse_args()


def to_number(raw: str) -> float:
    return float(str(raw).strip().replace("px", ""))


def render_with_quicklook(svg_path: Path, out_dir: Path) -> Path:
    subprocess.run(
        ["qlmanage", "-t", "-s", str(THUMB_SIZE), "-o", str(out_dir), str(svg_path)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    png_path = out_dir / f"{svg_path.name}.png"
    if not png_path.exists():
        raise FileNotFoundError(f"Quick Look did not produce {png_path}")
    return png_path


def find_visible_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    rgb = image.convert("RGB")
    corners = [
        rgb.getpixel((0, 0)),
        rgb.getpixel((rgb.width - 1, 0)),
        rgb.getpixel((0, rgb.height - 1)),
        rgb.getpixel((rgb.width - 1, rgb.height - 1)),
    ]
    background = max(set(corners), key=corners.count)
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, background))
    mask = diff.convert("L").point(lambda px: 255 if px > BACKGROUND_TOLERANCE else 0)
    bbox = mask.getbbox()
    if not bbox:
        raise ValueError("Unable to detect visible icon bounds")
    return bbox


def image_bbox_to_source_bbox(
    bbox: tuple[int, int, int, int],
    source_viewbox: tuple[float, float, float, float],
    image_size: tuple[int, int],
) -> tuple[float, float, float, float]:
    src_x, src_y, src_w, src_h = source_viewbox
    out_w, out_h = image_size
    scale = min(out_w / src_w, out_h / src_h)
    offset_x = (out_w - src_w * scale) / 2
    offset_y = (out_h - src_h * scale) / 2

    left = src_x + (bbox[0] - offset_x) / scale
    top = src_y + (bbox[1] - offset_y) / scale
    right = src_x + (bbox[2] - offset_x) / scale
    bottom = src_y + (bbox[3] - offset_y) / scale
    return (left, top, right, bottom)


def expand_to_square(
    bbox: tuple[float, float, float, float],
    source_viewbox: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    src_x, src_y, src_w, src_h = source_viewbox
    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    padding = max(max(width, height) * PADDING_RATIO, MIN_PADDING)

    left -= padding
    top -= padding
    right += padding
    bottom += padding

    width = right - left
    height = bottom - top
    size = max(width, height)
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2

    final_left = center_x - size / 2
    final_top = center_y - size / 2
    final_right = center_x + size / 2
    final_bottom = center_y + size / 2

    if final_left < src_x:
        shift = src_x - final_left
        final_left += shift
        final_right += shift
    if final_top < src_y:
        shift = src_y - final_top
        final_top += shift
        final_bottom += shift
    if final_right > src_x + src_w:
        shift = final_right - (src_x + src_w)
        final_left -= shift
        final_right -= shift
    if final_bottom > src_y + src_h:
        shift = final_bottom - (src_y + src_h)
        final_top -= shift
        final_bottom -= shift

    return (final_left, final_top, final_right, final_bottom)


def source_bbox_to_image_bbox(
    bbox: tuple[float, float, float, float],
    source_viewbox: tuple[float, float, float, float],
    image_size: tuple[int, int],
) -> tuple[int, int, int, int]:
    src_x, src_y, src_w, src_h = source_viewbox
    out_w, out_h = image_size
    scale = min(out_w / src_w, out_h / src_h)
    offset_x = (out_w - src_w * scale) / 2
    offset_y = (out_h - src_h * scale) / 2

    left = offset_x + (bbox[0] - src_x) * scale
    top = offset_y + (bbox[1] - src_y) * scale
    right = offset_x + (bbox[2] - src_x) * scale
    bottom = offset_y + (bbox[3] - src_y) * scale
    return (
        max(0, math.floor(left)),
        max(0, math.floor(top)),
        min(out_w, math.ceil(right)),
        min(out_h, math.ceil(bottom)),
    )


def make_transparent_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    output = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    pixels_in = rgba.load()
    pixels_out = output.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels_in[x, y]
            if r >= 250 and g >= 250 and b >= 250:
                pixels_out[x, y] = (255, 255, 255, 0)
            else:
                pixels_out[x, y] = (r, g, b, a)
    return output


def write_svg(
    root_attrs: dict[str, str],
    icon_group: ET.Element,
    viewbox: tuple[float, float, float, float],
    output_path: Path,
) -> None:
    svg = ET.Element(
        f"{{{SVG_NS}}}svg",
        {
            "version": root_attrs.get("version", "1.1"),
            "viewBox": f"{viewbox[0]:.2f} {viewbox[1]:.2f} {viewbox[2] - viewbox[0]:.2f} {viewbox[3] - viewbox[1]:.2f}",
            "width": str(OUTPUT_SIZE),
            "height": str(OUTPUT_SIZE),
        },
    )
    svg.append(deepcopy(icon_group))
    output_path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(svg, encoding="unicode"))


def build_contact_sheet(png_paths: list[Path], output_path: Path) -> None:
    thumb_w, thumb_h = 150, 170
    cols = 4
    rows = math.ceil(len(png_paths) / cols)
    sheet = Image.new("RGBA", (cols * thumb_w, rows * thumb_h), (244, 247, 251, 255))
    draw = ImageDraw.Draw(sheet)

    for idx, path in enumerate(png_paths):
        image = Image.open(path).convert("RGBA")
        thumb = image.copy()
        thumb.thumbnail((104, 104), Image.Resampling.LANCZOS)
        x = (idx % cols) * thumb_w + (thumb_w - thumb.width) // 2
        y = (idx // cols) * thumb_h + 12
        sheet.alpha_composite(thumb, (x, y))
        draw.text(((idx % cols) * thumb_w + 10, (idx // cols) * thumb_h + 126), path.stem, fill=(16, 34, 62, 255))

    sheet.save(output_path)


def build_index_html(png_paths: list[Path], output_path: Path) -> None:
    cards = []
    for path in png_paths:
        name = path.stem
        cards.append(
            f"<div class='card'><img src='./svg/{name}.svg' alt='{name}' /><p>{name}</p><small>{name.split('_')[-1]}</small></div>"
        )

    output_path.write_text(
        "\n".join(
            [
                "<!doctype html>",
                "<html lang='en'>",
                "<head>",
                "<meta charset='utf-8' />",
                "<meta name='viewport' content='width=device-width, initial-scale=1' />",
                "<title>Weather Icons Set 2</title>",
                "<style>",
                "body{font-family:Manrope,system-ui,sans-serif;margin:0;padding:20px;background:#f4f7fb;color:#10223e}",
                "h1{margin:0 0 8px;font-size:20px}",
                "p.meta{margin:0 0 12px;color:#5f718b}",
                ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}",
                ".card{background:#fff;border:1px solid #dce5f1;border-radius:10px;padding:10px;text-align:center}",
                ".card img{width:88px;height:88px;display:block;margin:0 auto 8px}",
                ".card p{margin:0;font-size:12px;font-weight:700}",
                ".card small{color:#5f718b}",
                "</style>",
                "</head>",
                "<body>",
                "<h1>Rebuilt Weather Icons Set 2</h1>",
                "<p class='meta'>Regenerated from direct source groups with square padded viewBoxes.</p>",
                f"<div class='grid'>{''.join(cards)}</div>",
                "</body>",
                "</html>",
            ]
        )
    )


def main() -> None:
    args = parse_args()
    source_path = Path(args.source)
    dest_dir = Path(args.dest)
    svg_dir = dest_dir / "svg"
    png_dir = dest_dir / "png"

    if dest_dir.exists():
        shutil.rmtree(dest_dir)
    svg_dir.mkdir(parents=True)
    png_dir.mkdir(parents=True)

    tree = ET.parse(source_path)
    root = tree.getroot()
    outer_group = list(root)[0]
    icon_groups = list(outer_group)

    source_viewbox = tuple(float(part) for part in root.attrib["viewBox"].split())
    root_attrs = dict(root.attrib)

    manifest_icons = []
    output_pngs: list[Path] = []

    with tempfile.TemporaryDirectory(prefix="weather-set2-build-") as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)
        render_dir = temp_dir / "renders"
        render_dir.mkdir()

        for idx, icon_group in enumerate(icon_groups, start=1):
            name = f"weather_icon_set2_{idx:02d}"
            temp_svg = temp_dir / f"{name}.svg"
            write_svg(root_attrs, icon_group, (source_viewbox[0], source_viewbox[1], source_viewbox[0] + source_viewbox[2], source_viewbox[1] + source_viewbox[3]), temp_svg)
            render_path = render_with_quicklook(temp_svg, render_dir)

            rendered = Image.open(render_path).convert("RGBA")
            source_bounds = image_bbox_to_source_bbox(find_visible_bbox(rendered), source_viewbox, rendered.size)
            padded_bounds = expand_to_square(source_bounds, source_viewbox)

            final_svg = svg_dir / f"{name}.svg"
            write_svg(root_attrs, icon_group, padded_bounds, final_svg)

            crop_box = source_bbox_to_image_bbox(padded_bounds, source_viewbox, rendered.size)
            cropped = make_transparent_background(rendered.crop(crop_box))
            final_png = cropped.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.LANCZOS)
            final_png_path = png_dir / f"{name}.png"
            final_png.save(final_png_path)
            output_pngs.append(final_png_path)

            manifest_icons.append(
                {
                    "index": idx,
                    "name": name,
                    "svg": f"./svg/{name}.svg",
                    "png": f"./png/{name}.png",
                    "viewBox": [round(padded_bounds[0], 2), round(padded_bounds[1], 2), round(padded_bounds[2] - padded_bounds[0], 2), round(padded_bounds[3] - padded_bounds[1], 2)],
                    "source_bounds": [round(value, 2) for value in source_bounds],
                    "padded_square_bounds": [round(value, 2) for value in padded_bounds],
                }
            )

    build_index_html(output_pngs, dest_dir / "index.html")
    build_contact_sheet(output_pngs, dest_dir / "contact_sheet.png")
    (dest_dir / "manifest.json").write_text(
        json.dumps(
            {
                "source": str(source_path),
                "count": len(manifest_icons),
                "padding_ratio": PADDING_RATIO,
                "min_padding": MIN_PADDING,
                "weather_roles": ROLE_MAP,
                "icons": manifest_icons,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
