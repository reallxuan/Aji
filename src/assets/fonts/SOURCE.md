# Bundled fonts

Subsets made by `scripts/subset-fonts.py` (fontTools 4.68.0, brotli) on 2026-11-20. Both fonts are
under the SIL Open Font License 1.1; the licence texts are `OFL-Inter.txt` and
`OFL-LXGWWenKai.txt` here, and the About page shows them.

| Source | Release | File | SHA-256 |
|---|---|---|---|
| Inter | [v4.1](https://github.com/rsms/inter/releases/tag/v4.1) | `Inter-4.1.zip` (`web/Inter-Regular.woff2`, `web/Inter-Medium.woff2`) | `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e` |
| LXGW WenKai | [v1.530](https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530) | `LXGWWenKai-Regular.ttf` | `2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b` |
| LXGW WenKai | v1.530 | `LXGWWenKai-Medium.ttf` | `f4b8a34d1f838fe411540cb7c97b1c384ac9738a876c4104500bc42508b2312a` |

LXGW WenKai is the mainland original, not the TC build (interface design, section 3).

| Output | Code points | Bytes |
|---|---|---|
| `LXGWWenKai-Regular.woff2` | 7725 | 1637364 |
| `LXGWWenKai-Medium.woff2` | 7725 | 1685824 |
| `Inter-Regular.woff2` | 296 | 28904 |
| `Inter-Medium.woff2` | 296 | 29536 |

WenKai keeps GB2312, CJK and full-width punctuation, ASCII and every character of both locale files;
Inter keeps Latin-1, general punctuation, arrows and the locale files' non-CJK characters.
`wenkai-codepoints.json` lists what the WenKai subsets cover, read back from their cmap;
`coverage.test.ts` fails when `zh-CN.json` uses a character outside it. Run the script again then.

**Reserved Font Name.** WenKai's licence reserves "LXGW" and 霞鹜 for Modified Versions, with an
additional permission for subsets "converted to other formats (e.g., WOFF/WOFF2) solely for web font
delivery", not made available as installable desktop fonts. Aji ships these subsets inside its
webview only and never installs them, which follows that permission's intent; the owner is asked to
confirm the reading.
