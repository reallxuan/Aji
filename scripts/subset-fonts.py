#!/usr/bin/env python3
"""Subsets the bundled fonts (roadmap O6, M5 design 5.6).

LXGW WenKai keeps GB2312, CJK and full-width punctuation, ASCII, and every character of both
locale files. Inter keeps Latin-1, general punctuation, arrows and every non-CJK character of the
locale files. Both are written as WOFF2 into src/assets/fonts/, together with
wenkai-codepoints.json, the code points the WenKai subsets really cover (read back from their cmap),
which the coverage test checks against zh-CN.json.

Needs fontTools and brotli (both MIT). Run it again whenever a locale gains characters:

    python3 -I scripts/subset-fonts.py \\
        --wenkai-regular LXGWWenKai-Regular.ttf --wenkai-medium LXGWWenKai-Medium.ttf \\
        --inter-regular Inter-Regular.woff2 --inter-medium Inter-Medium.woff2

Sources: LXGW WenKai v1.530 (github.com/lxgw/LxgwWenKai) and Inter 4.1 (github.com/rsms/inter,
the web/ folder of Inter-4.1.zip). SOURCE.md records their hashes.
"""

import argparse
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "assets" / "fonts"
LOCALES = [ROOT / "src" / "locales" / "zh-CN.json", ROOT / "src" / "locales" / "en.json"]


def locale_text() -> str:
    def walk(value):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for item in value.values():
                yield from walk(item)

    return "".join(text for path in LOCALES for text in walk(json.loads(path.read_text("utf-8"))))


def gb2312() -> set[int]:
    """Every character of GB2312: rows 0xA1-0xF7, cells 0xA1-0xFE."""
    chars = set()
    for high in range(0xA1, 0xF8):
        for low in range(0xA1, 0xFF):
            try:
                chars.add(ord(bytes([high, low]).decode("gb2312")))
            except UnicodeDecodeError:
                pass
    return chars


def ranges(*spans: tuple[int, int]) -> set[int]:
    return {code for start, end in spans for code in range(start, end + 1)}


def write_subset(source: Path, target: Path, unicodes: set[int]) -> set[int]:
    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    font = subset.load_font(str(source), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=sorted(unicodes))
    subsetter.subset(font)
    subset.save_font(font, str(target), options)
    covered = set(TTFont(str(target)).getBestCmap())
    print(f"{target.name}: {len(covered)} code points, {target.stat().st_size} bytes")
    return covered


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for name in ["wenkai-regular", "wenkai-medium", "inter-regular", "inter-medium"]:
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()

    text = {ord(c) for c in locale_text()}
    ascii_ = ranges((0x20, 0x7E))
    wenkai = gb2312() | text | ascii_ | ranges((0x3000, 0x303F), (0xFF00, 0xFFEF), (0x2010, 0x2027))
    inter = (
        ranges((0x20, 0x7E), (0xA0, 0xFF), (0x2000, 0x206F), (0x2190, 0x21FF), (0x2212, 0x2212))
        | {c for c in text if c < 0x2E80}
    )

    regular = write_subset(args.wenkai_regular, OUT / "LXGWWenKai-Regular.woff2", wenkai)
    medium = write_subset(args.wenkai_medium, OUT / "LXGWWenKai-Medium.woff2", wenkai)
    write_subset(args.inter_regular, OUT / "Inter-Regular.woff2", inter)
    write_subset(args.inter_medium, OUT / "Inter-Medium.woff2", inter)
    (OUT / "wenkai-codepoints.json").write_text(
        json.dumps({"regular": sorted(regular), "medium": sorted(medium)}, separators=(",", ":"))
        + "\n",
        "utf-8",
    )


if __name__ == "__main__":
    main()
