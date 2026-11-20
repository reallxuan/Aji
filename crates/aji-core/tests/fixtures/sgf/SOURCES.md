# SGF test fixtures

## Public domain

The CWI Go games archive states: "The games here are in the public domain." These five files are its Samsung Cup final records, unchanged:

| File | Source |
|---|---|
| `samsung-1996-final-1.sgf` | https://homepages.cwi.nl/~aeb/go/games/games/Samsung/01/F1.sgf |
| `samsung-2004-final-1.sgf` | https://homepages.cwi.nl/~aeb/go/games/games/Samsung/09/F1.sgf |
| `samsung-2013-final-1.sgf` | https://homepages.cwi.nl/~aeb/go/games/games/Samsung/18/F1.sgf |
| `samsung-2023-final-3.sgf` | https://homepages.cwi.nl/~aeb/go/games/games/Samsung/28/F3.sgf |
| `samsung-2025-final-2.sgf` | https://homepages.cwi.nl/~aeb/go/games/games/Samsung/30/F2.sgf |

The archive's statement is on https://homepages.cwi.nl/~aeb/go/games/.

## Derived by `make.py`

Every other file is written by `make.py` (run `python3 -I crates/aji-core/tests/fixtures/sgf/make.py` from the repository root). The moves come from `samsung-2025-final-2.sgf`; names, comments and headers are made up:

- Encodings: `gbk-no-ca.sgf`, `gbk-ca-gb2312.sgf`, `gb18030-rare.sgf` (a character outside GBK), `utf8-bom.sgf`, `gbk-trail-bytes.sgf` (characters whose second GBK byte is `\` or `]`), `shift-jis.sgf`, `euc-kr.sgf`.
- Fox layout: `fox-chinese.sgf` (`KM[375]`, `RU[Chinese]`) and `fox-japanese.sgf` (`KM[0]`, `HA[0]`, `RU[Japanese]`), in GBK. The header layout (spaces between properties, `AP` twice, `TM`, `TC`, `TT`, `RL`, `RN`) follows real Fox exports that were looked at; none of them is copied, and the user names are invented.
- LizzieYzy analysis properties: `lizzie.sgf` (`LZ`, `LZOP`, `LZ2`, `LZOP2` with invented values shaped like LizzieYzy's, not taken from LizzieYzy).
- Structure: `variations.sgf`, `handicap.sgf`, `nine.sgf`, `thirteen.sgf`, `passes.sgf`, `compressed-setup.sgf`, `ff3-lowercase.sgf`, `escapes.sgf`, `garbage-before.sgf`, `collection.sgf`.
- Broken: `broken-truncated.sgf`, `broken-missing-paren.sgf`, `broken-size-19x13.sgf`, `broken-size-21.sgf`, `broken-gm2.sgf`, `broken-occupied.sgf`.
