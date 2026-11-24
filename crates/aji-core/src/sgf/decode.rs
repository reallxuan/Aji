//! Turns a file's bytes into text before any SGF syntax is read (design 5.1).
//!
//! Decoding comes first because a trail byte of GBK, Big5 or Shift-JIS can be `\` or `]`, which
//! a byte-level tokeniser would take for SGF syntax.

use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::{Encoding, GB18030, GBK, UTF_8};

/// Why a file was read in the encoding it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodingSource {
    /// A UTF-8 byte order mark.
    Bom,
    /// The bytes are valid UTF-8.
    Utf8,
    /// The file's `CA` property.
    Declared,
    /// A guess from the bytes.
    Detected,
}

/// A file's text and how it was read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    pub text: String,
    /// The `encoding_rs` name of the encoding the file is in. A file detected as GBK says `GBK`,
    /// though it is decoded as GB18030, the superset Windows writes as "GBK".
    pub encoding: &'static str,
    pub source: EncodingSource,
    /// Invalid byte sequences became U+FFFD.
    pub replaced: bool,
}

impl Decoded {
    /// GBK's decoder accepts GB18030 extensions. Use the superset on save only
    /// when the source actually contains one of its four-byte characters.
    pub fn source_encoding(&self, bytes: &[u8]) -> &'static str {
        if self.encoding == GBK.name() {
            let mut input = bytes.iter().copied();
            while let Some(byte) = input.next() {
                if (0x81..=0xfe).contains(&byte) && input.next().is_some_and(|b| b.is_ascii_digit())
                {
                    return GB18030.name();
                }
            }
        }
        self.encoding
    }
}

/// Decodes an SGF file: a BOM, else valid UTF-8, else a declared multi-byte `CA` that decodes
/// cleanly, else a guess. A declared single-byte charset is used only when the guess is
/// single-byte too, since single-byte charsets never fail to decode.
pub fn decode(bytes: &[u8]) -> Decoded {
    if let Some(rest) = bytes.strip_prefix(b"\xEF\xBB\xBF") {
        return with(UTF_8, rest, EncodingSource::Bom);
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Decoded {
            text: text.to_owned(),
            encoding: UTF_8.name(),
            source: EncodingSource::Utf8,
            replaced: false,
        };
    }
    let declared = declared_charset(bytes);
    if let Some(encoding) = declared.filter(|e| !e.is_single_byte())
        && let Some(text) = encoding.decode_without_bom_handling_and_without_replacement(bytes)
    {
        return Decoded {
            text: text.into_owned(),
            encoding: encoding.name(),
            source: EncodingSource::Declared,
            replaced: false,
        };
    }
    let mut detector = EncodingDetector::new(Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    // Damaged UTF-8 is judged on the unhinted guess: the Fox hint would turn it into GBK.
    let unhinted = detector.guess(None, Utf8Detection::Allow);
    if unhinted.is_single_byte() && mostly_utf8(bytes) {
        // A UTF-8 file cut off mid-character, or with a stray byte, is not windows-1252: keep
        // what is valid and replace the rest.
        return with(UTF_8, bytes, EncodingSource::Utf8);
    }
    let guess = detector.guess(tld_hint(bytes), Utf8Detection::Allow);
    if guess.is_single_byte() {
        // A declared charset beats a single-byte guess: a multi-byte one with a few bad bytes
        // is still closer than mojibake, and a single-byte one agrees with the guess's kind.
        if let Some(encoding) = declared {
            return with(encoding, bytes, EncodingSource::Declared);
        }
    }
    let decoded = with(
        if guess == GBK { GB18030 } else { guess },
        bytes,
        EncodingSource::Detected,
    );
    Decoded {
        encoding: guess.name(),
        ..decoded
    }
}

/// More valid UTF-8 multi-byte characters than broken sequences. Damaged UTF-8 text in Chinese,
/// Japanese or Korean passes; single-byte text (`Müller` in Latin-1) has no valid multi-byte
/// characters and fails.
fn mostly_utf8(bytes: &[u8]) -> bool {
    let (mut valid, mut broken) = (0usize, 0usize);
    for chunk in bytes.utf8_chunks() {
        valid += chunk.valid().chars().filter(|c| c.len_utf8() > 1).count();
        broken += usize::from(!chunk.invalid().is_empty());
    }
    valid > 0 && broken <= valid
}

fn with(encoding: &'static Encoding, bytes: &[u8], source: EncodingSource) -> Decoded {
    let (text, replaced) = encoding.decode_without_bom_handling(bytes);
    Decoded {
        text: text.into_owned(),
        encoding: encoding.name(),
        source,
        replaced,
    }
}

/// A chardetng top-level-domain hint from the file itself: `cn` when an `AP` value names Fox
/// (`foxwq`), whose exports are always GBK. Short GBK records (two names, no `CA`) are otherwise
/// often read as EUC-KR. `RU` gives no hint: a `cn` hint for `RU[Chinese]` reads every Big5 record
/// as GBK, and `jp` or `kr` read most GBK records with those rules wrongly (M8 design section 6).
fn tld_hint(bytes: &[u8]) -> Option<&'static [u8]> {
    let fox = bytes
        .windows(3)
        .enumerate()
        .filter(|&(i, w)| w == b"AP[" && (i == 0 || !bytes[i - 1].is_ascii_uppercase()))
        .any(|(i, _)| {
            let value = &bytes[i + 3..];
            let end = value.iter().position(|&b| b == b']').unwrap_or(value.len());
            value[..end]
                .windows(5)
                .any(|w| w.eq_ignore_ascii_case(b"foxwq"))
        });
    fox.then_some(b"cn".as_slice())
}

/// The encoding named by the first `CA[...]` in the raw bytes, if `encoding_rs` knows the label.
fn declared_charset(bytes: &[u8]) -> Option<&'static Encoding> {
    let at = bytes
        .windows(3)
        .enumerate()
        .find(|&(i, w)| w == b"CA[" && (i == 0 || !bytes[i - 1].is_ascii_uppercase()))?
        .0;
    let value = &bytes[at + 3..];
    let end = value.iter().position(|&b| b == b']')?;
    Encoding::for_label(value[..end].trim_ascii())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gbk(s: &str) -> Vec<u8> {
        let (bytes, _, unmappable) = encoding_rs::GBK.encode(s);
        assert!(!unmappable, "{s} is not GBK");
        bytes.into_owned()
    }

    #[test]
    fn bom_wins() {
        let d = decode(b"\xEF\xBB\xBF(;PB[x])");
        assert_eq!(d.source, EncodingSource::Bom);
        assert_eq!(d.text, "(;PB[x])");
    }

    #[test]
    fn valid_utf8_beats_a_stale_declaration() {
        let d = decode("(;CA[gb2312]PB[丁浩])".as_bytes());
        assert_eq!(d.source, EncodingSource::Utf8);
        assert!(d.text.contains("丁浩"));
    }

    #[test]
    fn declared_gbk_is_used_when_it_decodes() {
        let d = decode(&gbk("(;CA[GB2312]PB[丁浩]C[打劫])"));
        assert_eq!(d.source, EncodingSource::Declared);
        assert!(d.text.contains("丁浩"), "{}", d.text);
        assert!(d.text.contains("打劫"));
    }

    #[test]
    fn undeclared_gbk_is_detected() {
        let text = "(;PB[丁浩]PW[廖元赫]C[黑棋在右上角走出了新手，白棋应对稳健，局面依然两分，双方进入中盘战斗])";
        let d = decode(&gbk(text));
        assert_eq!(d.source, EncodingSource::Detected);
        assert_eq!(d.encoding, "GBK");
        assert_eq!(d.text, text);
    }

    #[test]
    fn gbk_mislabelled_latin1_still_reads_as_gbk() {
        let text = "(;CA[ISO-8859-1]PB[丁浩]PW[廖元赫]C[黑棋在右上角走出了新手，局面两分])";
        let d = decode(&gbk(text));
        assert_eq!(d.text, text);
    }

    #[test]
    fn shift_jis_and_euc_kr_are_detected() {
        let jp = "(;PB[井山裕太]PW[一力遼]C[黒番の井山が序盤から積極的に打ち進めた一局です])";
        let (bytes, _, _) = encoding_rs::SHIFT_JIS.encode(jp);
        assert_eq!(decode(&bytes).text, jp);
        let ko = "(;PB[신진서]PW[박정환]C[흑이 초반부터 적극적으로 둔 대국입니다])";
        let (bytes, _, _) = encoding_rs::EUC_KR.encode(ko);
        assert_eq!(decode(&bytes).text, ko);
    }

    /// A GBK character whose encoding ends in `trail`.
    fn gbk_char_with_trail(trail: u8) -> char {
        ('一'..='龥')
            .find(|c| {
                let bytes = gbk(&c.to_string());
                bytes.len() == 2 && bytes[1] == trail
            })
            .expect("such a character exists")
    }

    #[test]
    fn trail_byte_5c_survives() {
        let c = gbk_char_with_trail(0x5C);
        let text = format!("(;PB[{c}浩]C[打劫是围棋中的常见手段])");
        let d = decode(&gbk(&text));
        assert_eq!(d.text, text);
    }

    const NAMES: &str = "(;GM[1]SZ[19]PB[丁浩]PW[廖元赫]EV[第30届三星杯决赛]C[白中盘胜，黑败着]";

    #[test]
    fn utf8_cut_off_mid_character_stays_utf8() {
        let bytes = NAMES.as_bytes();
        // The last character, 着, loses its last byte; `]` goes with it.
        let cut = &bytes[..bytes.len() - 2];
        let d = decode(cut);
        assert!(d.text.contains("丁浩"), "{}", d.text);
        assert!(d.text.contains("廖元赫"));
        assert_eq!((d.encoding, d.source), ("UTF-8", EncodingSource::Utf8));
        assert!(d.replaced);
    }

    #[test]
    fn a_damaged_utf8_fox_record_stays_utf8() {
        // The Fox hint must not turn damaged UTF-8 into GB18030 mojibake.
        let text = format!("(;GM[1]FF[4]AP[foxwq]{}", &NAMES[1..]);
        let bytes = text.as_bytes();
        let cut = &bytes[..bytes.len() - 2];
        let d = decode(cut);
        assert_eq!((d.encoding, d.source), ("UTF-8", EncodingSource::Utf8));
        assert!(d.text.contains("丁浩"), "{}", d.text);
    }

    #[test]
    fn utf8_with_a_stray_byte_stays_utf8() {
        let mut bytes = NAMES.as_bytes().to_vec();
        bytes.insert(20, 0xFF);
        let d = decode(&bytes);
        assert!(d.text.contains("廖元赫"), "{}", d.text);
        assert!(d.text.contains("三星杯"));
        assert_eq!(d.source, EncodingSource::Utf8);
        assert!(d.replaced);
    }

    #[test]
    fn latin1_is_not_taken_for_damaged_utf8() {
        let d = decode(b"(;PB[M\xFCller]PW[Ren\xE9e])");
        assert_eq!(d.text, "(;PB[Müller]PW[Renée])");
    }

    #[test]
    fn invalid_bytes_are_replaced() {
        let d = decode(b"(;CA[UTF-8]PB[a\xFFb])");
        assert!(d.replaced);
        assert!(d.text.contains('\u{FFFD}'));
    }

    #[test]
    fn short_fox_names_read_as_gbk() {
        // Without a hint chardetng reads this pair as EUC-KR.
        let bytes = gbk("(;GM[1]FF[4]SZ[19]PB[黑方]PW[柯洁]KM[375]RU[Chinese]AP[foxwq];B[pd])");
        let d = decode(&bytes);
        assert_eq!(d.encoding, "GBK");
        assert!(d.text.contains("柯洁"));
    }

    #[test]
    fn big5_with_chinese_rules_stays_big5() {
        let s = "(;GM[1]FF[4]SZ[19]PB[周俊勳]PW[林海峰]RU[Chinese];B[pd])";
        let (bytes, _, _) = encoding_rs::BIG5.encode(s);
        assert_eq!(decode(&bytes).encoding, "Big5");
    }

    #[test]
    fn fox_beats_japanese_rules() {
        let bytes = gbk("(;GM[1]FF[4]SZ[19]PB[黑方]PW[柯洁]KM[0]HA[0]RU[Japanese]AP[foxwq];B[pd])");
        assert_eq!(decode(&bytes).encoding, "GBK");
    }

    #[test]
    fn korean_records_stay_euc_kr() {
        for header in ["RU[Korean]", ""] {
            let s = format!("(;GM[1]FF[4]SZ[19]PB[신진서]PW[박정환]{header};B[pd])");
            let (bytes, _, _) = encoding_rs::EUC_KR.encode(&s);
            assert_eq!(decode(&bytes).encoding, "EUC-KR", "header {header:?}");
        }
    }

    #[test]
    fn fox_name_pairs_read_as_gbk() {
        // 20 names, 380 ordered pairs, each in a Fox header with no CA.
        const NAMES: [&str; 20] = [
            "柯洁",
            "申真谞",
            "朴廷桓",
            "芈昱廷",
            "辜梓豪",
            "杨鼎新",
            "丁浩",
            "李轩豪",
            "党毅飞",
            "连笑",
            "陈浩",
            "陆敏全",
            "邱峻",
            "孔杰",
            "古力",
            "黑方",
            "白方",
            "棋友",
            "於之莹",
            "唐嘉雯",
        ];
        let mut misread = 0;
        for a in NAMES {
            for b in NAMES {
                if a == b {
                    continue;
                }
                let s =
                    format!("(;GM[1]FF[4]SZ[19]PB[{a}]PW[{b}]KM[375]RU[Chinese]AP[foxwq];B[pd])");
                if decode(&gbk(&s)).encoding != "GBK" {
                    misread += 1;
                }
            }
        }
        assert_eq!(misread, 0, "{misread} of 380 misread");
    }
}
