//! Writes SGF in the source encoding when every character fits.

use encoding_rs::{Encoding, UTF_8};

use super::{SgfNode, SgfTree, write::write_tree};

pub struct Encoded {
    pub bytes: Vec<u8>,
    pub fell_back: bool,
}

/// Sets the first game's declaration and preserves other games' declarations.
/// When conversion to UTF-8 is necessary, updates their existing declarations too.
pub fn encode_sgf(games: &[SgfTree], encoding: &str, ca: Option<&str>) -> Encoded {
    fn text(games: &[SgfTree], ca: Option<&str>, fallback: bool) -> String {
        let mut out = String::new();
        for (i, game) in games.iter().enumerate() {
            let root = game
                .nodes
                .first()
                .filter(|node| i == 0 || (fallback && node.get("CA").is_some()))
                .map(|node| {
                    let mut root = node.clone();
                    set_charset(&mut root, ca);
                    root
                });
            write_tree(game, root.as_ref(), &mut out);
        }
        out
    }
    if let Some(encoding) = Encoding::for_label(encoding.as_bytes()) {
        let sgf = text(games, ca, false);
        if encoding == UTF_8 {
            return Encoded {
                bytes: sgf.into_bytes(),
                fell_back: false,
            };
        }
        let (bytes, _, unmappable) = encoding.encode(&sgf);
        // Some legacy encoders accept aliases that decode to a different character.
        // Shift_JIS encodes a yen sign as the SGF escape byte, for example.
        if !unmappable
            && encoding
                .decode_without_bom_handling_and_without_replacement(&bytes)
                .is_some_and(|decoded| decoded == sgf)
        {
            return Encoded {
                bytes: bytes.into_owned(),
                fell_back: false,
            };
        }
    }
    Encoded {
        bytes: text(games, Some("UTF-8"), true).into_bytes(),
        fell_back: true,
    }
}

fn set_charset(root: &mut SgfNode, ca: Option<&str>) {
    match ca {
        None => root.props.retain(|p| p.id != "CA"),
        Some(value) => match root.props.iter_mut().find(|p| p.id == "CA") {
            Some(prop) => prop.values = vec![value.to_owned()],
            None => root.push("CA", [value.to_owned()]),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sgf::parse_sgf;

    #[test]
    fn unencodable_text_falls_back_to_utf8() {
        let games = parse_sgf("(;CA[GBK]C[🎲])(;CA[gb2312]C[other])")
            .unwrap()
            .games;
        let encoded = encode_sgf(&games, "GBK", Some("GBK"));
        assert!(encoded.fell_back);
        assert_eq!(
            String::from_utf8(encoded.bytes).unwrap(),
            "(;CA[UTF-8]C[🎲])\n(;CA[UTF-8]C[other])\n"
        );
    }
}
