#!/usr/bin/env python3
"""Regenerate src/cli/cmd/tui/asset/backdrop-data.ts from assets/background.gif.

The TUI renders the backdrop as solid-colored character cells, so the data is
stored as a low-res color-indexed grid rather than raw pixels. All frames are
palette-quantized against one shared adaptive palette, concatenated, deflate
compressed and emitted as a single base64 blob (BACKDROP_DATA).

A light median filter is applied after downsampling: the source GIF carries
per-pixel grain that survives BOX downsampling, which both looks noisy when
rendered as character cells and wrecks compression.

Higher COLS/ROWS = sharper backdrop on large terminals at the cost of bundle
size. Keep cols/rows around 3.5:1 because terminal cells are roughly twice as
tall as they are wide.

Usage: python3 script/backdrop-gen.py [--cols N] [--rows N]
"""

import argparse
import base64
import zlib
from pathlib import Path

from PIL import Image, ImageFilter, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
GIF = ROOT / "assets" / "background.gif"
OUT = ROOT / "packages" / "aegisec" / "src" / "cli" / "cmd" / "tui" / "asset" / "backdrop-data.ts"

# Grid aspect matches typical cell geometry (~1:2 w:h) covering a widescreen
# terminal; keep cols/rows ~= 3.5 when changing resolution.
DEFAULT_COLS = 320
DEFAULT_ROWS = 92
PALETTE_COLORS = 128


def load_frames(cols: int, rows: int):
    """Decode every GIF frame (honouring disposal) and downsample to the grid."""
    frames = []
    with Image.open(GIF) as im:
        for _ in ImageSequence.Iterator(im):
            # Disposal/compositing happens inside seek(); convert after seeking
            # so palette frames become plain RGB.
            frame = im.convert("RGB").resize((cols, rows), Image.BOX)
            # Kill per-pixel film grain while keeping edges crisp.
            frame = frame.filter(ImageFilter.MedianFilter(3))
            frames.append(frame)
    return frames


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cols", type=int, default=DEFAULT_COLS)
    parser.add_argument("--rows", type=int, default=DEFAULT_ROWS)
    args = parser.parse_args()

    frames = load_frames(args.cols, args.rows)

    # One adaptive palette shared by all frames so indices stay comparable.
    sample = Image.new("RGB", (args.cols, args.rows * len(frames)))
    for i, frame in enumerate(frames):
        sample.paste(frame, (0, i * args.rows))
    palette = sample.quantize(colors=PALETTE_COLORS, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    pal_img = Image.new("P", (1, 1))
    pal_img.putpalette(palette.getpalette())

    raw_palette = palette.getpalette()
    colors = []
    remap = {}
    indexed = bytearray()
    for frame in frames:
        quantized = frame.quantize(palette=pal_img, dither=Image.Dither.NONE)
        for idx in quantized.tobytes():
            mapped = remap.get(idx)
            if mapped is None:
                rgb = tuple(raw_palette[idx * 3 : idx * 3 + 3])
                mapped = len(colors)
                remap[idx] = mapped
                colors.append("#%02x%02x%02x" % rgb)
            indexed.append(mapped)

    blob = base64.b64encode(zlib.compress(bytes(indexed), 9)).decode()

    def wrap(value, width=100):
        # Template literal: base64 never contains backticks, and the renderer
        # strips whitespace before decoding.
        lines = [value[i : i + width] for i in range(0, len(value), width)]
        return "`\n" + "\n".join(lines) + "\n`"

    OUT.write_text(
        "// Generated from assets/background.gif by script/backdrop-gen.py — do not edit.\n"
        f"export const BACKDROP_COLS = {args.cols}\n"
        f"export const BACKDROP_ROWS = {args.rows}\n\n"
        "export const BACKDROP_COLORS = [\n"
        + "\n".join(f'  "{c}",' for c in colors)
        + "\n]\n\n"
        "// zlib-deflated palette indices for every frame, concatenated.\n"
        "export const BACKDROP_DATA =\n"
        + wrap(blob)
        + "\n"
    )
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB, {len(frames)} frames @ {args.cols}x{args.rows}, {len(colors)} colors)")


if __name__ == "__main__":
    main()
