"""Writes the derived SGF fixtures next to this script.

Run from the repository root with `python3 -I crates/aji-core/tests/fixtures/sgf/make.py`.
Every file it writes is listed in SOURCES.md. The moves come from samsung-2025-final-2.sgf,
which the CWI Go games archive publishes as public domain. Names, comments, Fox-style headers
and LizzieYzy-style values are made up.
"""

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = (HERE / "samsung-2025-final-2.sgf").read_text("ascii")
MOVES = "".join(re.findall(r";[BW]\[[a-s]{2}\]", SOURCE))
FIRST_40 = "".join(re.findall(r";[BW]\[[a-s]{2}\]", SOURCE)[:40])

COMMENT_ZH = "黑棋在右上角走出了新手，白棋应对稳健，局面依然两分，双方进入中盘战斗。"


def write(name, text, encoding="utf-8", bom=False):
    data = text.encode(encoding)
    if bom:
        data = b"\xef\xbb\xbf" + data
    (HERE / name).write_bytes(data)


def chinese_header(ca=""):
    return (
        f"(;GM[1]FF[4]{ca}SZ[19]EV[第30届三星杯决赛]RO[第2局]"
        "PB[丁浩]BR[九段]PW[廖元赫]WR[九段]KM[6.5]RE[白中盘胜]DT[2025-11-17]"
        f"C[{COMMENT_ZH}]\n"
    )


def gbk_char_with_trail(trail):
    for code in range(0x4E00, 0x9FA6):
        c = chr(code)
        b = c.encode("gbk")
        if len(b) == 2 and b[1] == trail:
            return c
    raise SystemExit(f"no GBK character with trail byte {trail:#x}")


def main():
    write("gbk-no-ca.sgf", chinese_header() + MOVES + ")\n", "gbk")
    write("gbk-ca-gb2312.sgf", chinese_header("CA[gb2312]") + MOVES + ")\n", "gbk")
    rare = "𪚥"  # U+2A6A5: in GB18030, not in GBK.
    write(
        "gb18030-rare.sgf",
        chinese_header().replace("PB[丁浩]", f"PB[丁浩{rare}]") + MOVES + ")\n",
        "gb18030",
    )
    write("utf8-bom.sgf", chinese_header("CA[UTF-8]") + MOVES + ")\n", bom=True)

    c5c, c5d = gbk_char_with_trail(0x5C), gbk_char_with_trail(0x5D)
    write(
        "gbk-trail-bytes.sgf",
        chinese_header().replace("PW[廖元赫]", f"PW[{c5c}{c5d}元赫]") + MOVES + ")\n",
        "gbk",
    )

    write(
        "shift-jis.sgf",
        "(;GM[1]FF[4]SZ[19]EV[第50期名人戦]PB[井山裕太]PW[一力遼]KM[6.5]RU[Japanese]"
        "C[黒番の井山が序盤から積極的に打ち進めた一局です。白は中盤で反撃した。]\n"
        + MOVES
        + ")\n",
        "shift_jis",
    )
    write(
        "euc-kr.sgf",
        "(;GM[1]FF[4]SZ[19]EV[명인전]PB[신진서]PW[박정환]KM[6.5]RU[Korean]"
        "C[흑이 초반부터 적극적으로 둔 대국입니다. 백은 중반에 반격했습니다.]\n"
        + MOVES
        + ")\n",
        "euc_kr",
    )

    fox = (
        "(;GM[1]FF[4]  SZ[19]  GN[]  DT[2025-11-17]  PB[黑方棋友]  PW[白方棋友]  BR[9D]  WR[9D]  "
        "KM[{km}]HA[0]RU[{ru}]AP[GNU Go:3.8]RN[2]RE[W+R]TM[300]TC[3]TT[30]AP[foxwq]RL[0]  "
        + MOVES
        + ")"
    )
    write("fox-chinese.sgf", fox.format(km="375", ru="Chinese"), "gbk")
    write("fox-japanese.sgf", fox.format(km="0", ru="Japanese"), "gbk")

    lz = (
        "(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[7.5]PB[黑]PW[白]"
        "LZ[KataGo 1.18.2 b18 54.2 3.1k 1.8\nmove Q16 visits 1240 winrate 5420 scoreMean 1.8 pv Q16 D4 Q3]\n"
        ";B[pd]LZ[KataGo 1.18.2 b18 45.8 2.9k -1.6\nmove D4 visits 1103 winrate 4580 pv D4 Q3]"
        "LZOP[0.18 0.72 3]"
        ";W[dd]LZ2[KataGo 1.18.2 b40 53.9 1.2k 1.7\nmove Q3 visits 640 winrate 5390 pv Q3 C16]"
        "LZOP2[0.12 0.66 2]"
        ";B[pq];W[dp])\n"
    )
    write("lizzie.sgf", lz)

    write(
        "variations.sgf",
        "(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[7.5]RU[Chinese];B[pd];W[dd];B[pq]"
        "(;W[dq]C[主线];B[co];W[cp])"
        "(;W[qo]C[变化一]N[A](;B[qp];W[po])(;B[op]C[变化二]))"
        "(;W[do]C[变化三]))\n",
    )
    write(
        "handicap.sgf",
        "(;GM[1]FF[4]CA[UTF-8]SZ[19]HA[3]KM[0.5]RU[Japanese]AB[dd][pd][dp]"
        ";W[pp];B[qq];W[pq];B[qp];W[qo])\n",
    )
    write(
        "nine.sgf",
        "(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[7]RU[Chinese]"
        ";B[ee];W[gc];B[cg];W[ce];B[dc];W[gg];B[ge];W[fd];B[gf];W[hf])\n",
    )
    write(
        "thirteen.sgf",
        "(;GM[1]FF[4]CA[UTF-8]SZ[13]KM[6.5]"
        ";B[jd];W[dj];B[jj];W[dd];B[gc];W[cg];B[jg];W[kc])\n",
    )
    write("passes.sgf", "(;GM[1]FF[3]SZ[19];B[pd];W[];B[tt];W[dd])\n")
    write("compressed-setup.sgf", "(;GM[1]FF[4]SZ[19]AB[aa:cc]AW[dd:ee]PL[W];W[pp])\n")
    write("ff3-lowercase.sgf", "(;GaMe[1]SiZe[19]PlayerBlack[Old Style];Black[pd];White[dd])\n")
    write(
        "escapes.sgf",
        "(;GM[1]FF[4]CA[UTF-8]SZ[19]C[brackets \\] and a backslash \\\\ and a soft\\\nbreak];B[pd])\n",
    )
    write(
        "garbage-before.sgf",
        "<html><body>Downloaded from a site</body></html>\n" + SOURCE,
        "ascii",
    )
    write(
        "collection.sgf",
        "(;GM[1]FF[4]CA[UTF-8]SZ[19]GN[first];B[pd];W[dd])\n"
        "(;GM[1]FF[4]CA[UTF-8]SZ[19]GN[second];B[dp];W[pp])\n",
    )

    truncated = SOURCE[: SOURCE.index(";B[qi]") + 4]
    write("broken-truncated.sgf", truncated, "ascii")
    write("broken-missing-paren.sgf", SOURCE.rstrip().rstrip(")"), "ascii")
    write("broken-size-19x13.sgf", "(;GM[1]FF[4]SZ[19:13];B[aa])\n")
    write("broken-size-21.sgf", "(;GM[1]FF[4]SZ[21];B[aa])\n")
    write("broken-gm2.sgf", "(;GM[2]FF[4]SZ[8];B[aa])\n")
    write("broken-occupied.sgf", "(;GM[1]FF[4]CA[UTF-8]SZ[19];B[pd];W[pd];B[dd];W[dp])\n")


if __name__ == "__main__":
    main()
