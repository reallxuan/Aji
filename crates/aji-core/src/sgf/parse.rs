//! A forgiving SGF parser over decoded text (design 5.1).

use super::tree::{SgfNode, SgfTree};

/// Something the parser repaired or left out. Each kind is reported once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SgfWarning {
    /// A value ran to the end of the file without its `]`.
    UnclosedValue,
    /// The file ended inside the game; it was closed there.
    Truncated,
    /// Text that is not SGF, a property with no value, or nesting deeper than Aji keeps, was
    /// skipped or flattened.
    Skipped,
    /// The file holds this many more games after the first.
    ExtraGames(usize),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SgfError {
    /// No `(;` starts a game anywhere in the text.
    NotAGame,
}

/// Every game in a file, and what was repaired on the way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SgfCollection {
    pub games: Vec<SgfTree>,
    pub warnings: Vec<SgfWarning>,
}

/// Variations nest at most this deep; deeper `(` and `)` are ignored, which keeps the tree's
/// own recursion (clone, compare, drop) far from the stack limit on any input.
const MAX_DEPTH: usize = 1000;

struct Frame {
    tree: SgfTree,
    /// Opened by the parser for nodes that followed a variation, so it closes with its parent.
    implicit: bool,
}

struct Parser {
    chars: Vec<char>,
    i: usize,
    stack: Vec<Frame>,
    games: Vec<SgfTree>,
    warnings: Vec<SgfWarning>,
    /// `(` ignored past `MAX_DEPTH`, each waiting for its `)`.
    flattened: usize,
}

/// Parses every game in `text`. Recovers from what it can (design 5.1) and reports it.
pub fn parse_sgf(text: &str) -> Result<SgfCollection, SgfError> {
    let mut p = Parser {
        chars: text.chars().collect(),
        i: 0,
        stack: Vec::new(),
        games: Vec::new(),
        warnings: Vec::new(),
        flattened: 0,
    };
    p.run();
    if p.games.is_empty() {
        return Err(SgfError::NotAGame);
    }
    if p.games.len() > 1 {
        p.warn(SgfWarning::ExtraGames(p.games.len() - 1));
    }
    Ok(SgfCollection {
        games: p.games,
        warnings: p.warnings,
    })
}

impl Parser {
    fn warn(&mut self, w: SgfWarning) {
        if !self.warnings.contains(&w) {
            self.warnings.push(w);
        }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.i).copied()
    }

    fn skip_whitespace(&mut self) {
        while self.peek().is_some_and(char::is_whitespace) {
            self.i += 1;
        }
    }

    fn run(&mut self) {
        while let Some(c) = self.peek() {
            if self.stack.is_empty() {
                self.i += 1;
                if c == '(' && self.starts_node() {
                    self.open(false);
                } else if !self.games.is_empty() && (c == ';' || c == '[') {
                    // Nodes or values after a game closed early (a stray `)`) are lost: say so.
                    // Text before the first game, a doubled `)` or junk at the end stays quiet.
                    self.warn(SgfWarning::Skipped);
                }
                continue;
            }
            match c {
                '(' => {
                    self.i += 1;
                    if self.stack.len() >= MAX_DEPTH {
                        self.flattened += 1;
                        self.warn(SgfWarning::Skipped);
                    } else {
                        self.open(false);
                    }
                }
                ')' => {
                    self.i += 1;
                    if self.flattened > 0 {
                        self.flattened -= 1;
                    } else {
                        self.close();
                    }
                }
                ';' => {
                    self.i += 1;
                    self.current_tree().nodes.push(SgfNode::default());
                }
                'A'..='Z' => self.property(),
                c if c.is_whitespace() => self.i += 1,
                _ => {
                    self.i += 1;
                    self.warn(SgfWarning::Skipped);
                }
            }
        }
        if !self.stack.is_empty() {
            self.warn(SgfWarning::Truncated);
            while !self.stack.is_empty() {
                self.close();
            }
        }
    }

    /// Whether the next non-space character is `;`.
    fn starts_node(&self) -> bool {
        self.chars[self.i..]
            .iter()
            .find(|c| !c.is_whitespace())
            .is_some_and(|&c| c == ';')
    }

    fn open(&mut self, implicit: bool) {
        self.stack.push(Frame {
            tree: SgfTree::default(),
            implicit,
        });
    }

    /// The tree new nodes go into. Nodes after a variation go into a new implicit variation, so
    /// none is lost or reordered.
    fn current_tree(&mut self) -> &mut SgfTree {
        if self
            .stack
            .last()
            .is_some_and(|f| !f.tree.variations.is_empty())
        {
            self.warn(SgfWarning::Skipped);
            self.open(true);
        }
        &mut self.stack.last_mut().expect("inside a game").tree
    }

    /// Pops the innermost explicit tree (and any implicit ones above it), attaching each to its
    /// parent or, at the top, to the games.
    fn close(&mut self) {
        while let Some(frame) = self.stack.pop() {
            let tree = frame.tree;
            match self.stack.last_mut() {
                Some(parent) if tree.nodes.is_empty() => {
                    parent.tree.variations.extend(tree.variations);
                }
                Some(parent) => parent.tree.variations.push(tree),
                None if tree.nodes.is_empty() => {}
                None => self.games.push(tree),
            }
            if !frame.implicit {
                return;
            }
        }
    }

    fn property(&mut self) {
        // Uppercase letters, with lowercase ones dropped (FF[3] style). Digits after the first
        // letter are kept: LizzieYzy writes `LZ2` and `LZOP2`.
        let mut id = String::new();
        while let Some(c) = self.peek().filter(char::is_ascii_alphanumeric) {
            if c.is_ascii_uppercase() || c.is_ascii_digit() {
                id.push(c);
            }
            self.i += 1;
        }
        self.skip_whitespace();
        if self.peek() != Some('[') {
            self.warn(SgfWarning::Skipped);
            return;
        }
        let mut values = Vec::new();
        while self.peek() == Some('[') {
            self.i += 1;
            values.push(self.value());
            self.skip_whitespace();
        }
        let tree = self.current_tree();
        if tree.nodes.is_empty() {
            tree.nodes.push(SgfNode::default());
        }
        tree.nodes
            .last_mut()
            .expect("a node exists")
            .push(&id, values);
    }

    /// Reads a value after its `[`, through its `]`.
    fn value(&mut self) -> String {
        let mut out = String::new();
        loop {
            let Some(c) = self.peek() else {
                self.warn(SgfWarning::UnclosedValue);
                return out;
            };
            self.i += 1;
            match c {
                ']' => return out,
                '\\' => match self.peek() {
                    Some(n @ ('\n' | '\r')) => {
                        self.i += 1;
                        let pair = if n == '\n' { '\r' } else { '\n' };
                        if self.peek() == Some(pair) {
                            self.i += 1;
                        }
                    }
                    Some(n) => {
                        self.i += 1;
                        out.push(n);
                    }
                    None => {}
                },
                c => out.push(c),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sgf::write_sgf;

    fn moves(tree: &SgfTree) -> Vec<String> {
        let mut out = Vec::new();
        let mut t = tree;
        loop {
            for n in &t.nodes {
                for id in ["B", "W"] {
                    if let Some(v) = n.first(id) {
                        out.push(v.to_owned());
                    }
                }
            }
            match t.variations.first() {
                Some(v) => t = v,
                None => return out,
            }
        }
    }

    #[test]
    fn skips_text_before_the_game() {
        let c = parse_sgf("junk\n<html>(;GM[1];B[pd])").unwrap();
        assert_eq!(c.games.len(), 1);
        assert_eq!(c.games[0].nodes.len(), 2);
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
    }

    #[test]
    fn lowercase_letters_in_ids_are_dropped() {
        let c = parse_sgf("(;AddBlack[aa]CoPyright[x])").unwrap();
        let ids: Vec<_> = c.games[0].nodes[0]
            .props
            .iter()
            .map(|p| p.id.as_str())
            .collect();
        assert_eq!(ids, ["AB", "CP"]);
    }

    #[test]
    fn escapes_and_soft_breaks() {
        let c = parse_sgf("(;C[a\\]b\\\\c\\\nd])").unwrap();
        assert_eq!(c.games[0].nodes[0].first("C"), Some("a]b\\cd"));
        let c = parse_sgf("(;C[x\\\r\ny])").unwrap();
        assert_eq!(c.games[0].nodes[0].first("C"), Some("xy"));
    }

    #[test]
    fn digits_in_ids_are_kept() {
        let c = parse_sgf("(;LZ2[a]LZOP2[b])").unwrap();
        let ids: Vec<_> = c.games[0].nodes[0]
            .props
            .iter()
            .map(|p| p.id.as_str())
            .collect();
        assert_eq!(ids, ["LZ2", "LZOP2"]);
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
    }

    #[test]
    fn duplicate_properties_merge() {
        let c = parse_sgf("(;AP[GNU Go:3.8]  SZ[19]AP[foxwq])").unwrap();
        let node = &c.games[0].nodes[0];
        assert_eq!(node.props[0].id, "AP");
        assert_eq!(node.props[0].values, ["GNU Go:3.8", "foxwq"]);
        assert_eq!(node.props.len(), 2);
    }

    #[test]
    fn unclosed_value_at_eof() {
        let c = parse_sgf("(;C[abc").unwrap();
        assert_eq!(c.games[0].nodes[0].first("C"), Some("abc"));
        assert!(c.warnings.contains(&SgfWarning::UnclosedValue));
        assert!(c.warnings.contains(&SgfWarning::Truncated));
    }

    #[test]
    fn missing_parens_close_at_eof() {
        let c = parse_sgf("(;B[pd];W[dd](;B[pp])(;B[dp]").unwrap();
        let game = &c.games[0];
        assert_eq!(moves(game), ["pd", "dd", "pp"]);
        assert_eq!(game.variations.len(), 2);
        assert_eq!(game.variations[1].nodes[0].first("B"), Some("dp"));
        assert_eq!(c.warnings, [SgfWarning::Truncated]);
    }

    #[test]
    fn moves_after_a_stray_close_are_reported() {
        // A `:)` in a comment closes the game early; the moves after it are lost, and say so.
        let c = parse_sgf("(;GM[1]SZ[19]C[好棋 :]) 继续];B[pd];W[dd];B[pp])").unwrap();
        assert_eq!(c.games.len(), 1);
        assert_eq!(c.warnings, [SgfWarning::Skipped]);
        let c = parse_sgf("(;GM[1];B[pd];W[dd]);B[pp];W[dp])").unwrap();
        assert_eq!(moves(&c.games[0]), ["pd", "dd"]);
        assert_eq!(c.warnings, [SgfWarning::Skipped]);
    }

    #[test]
    fn harmless_text_around_games_is_not_reported() {
        // Before the first game (ruled 27), a doubled `)` and end-of-file junk say nothing.
        let c = parse_sgf("Saved by a site\n(;GM[1];B[pd]))\n\u{1a}").unwrap();
        assert_eq!(c.warnings, []);
    }

    #[test]
    fn two_games() {
        let c = parse_sgf("(;GN[a])\n(;GN[b])").unwrap();
        assert_eq!(c.games.len(), 2);
        assert_eq!(c.warnings, [SgfWarning::ExtraGames(1)]);
    }

    #[test]
    fn no_game_is_an_error() {
        assert_eq!(parse_sgf("hello"), Err(SgfError::NotAGame));
        assert_eq!(parse_sgf("()"), Err(SgfError::NotAGame));
        assert_eq!(parse_sgf(""), Err(SgfError::NotAGame));
    }

    #[test]
    fn a_property_without_a_value_is_skipped() {
        let c = parse_sgf("(;GN[a]XY;B[pd])").unwrap();
        assert_eq!(c.games[0].nodes[0].props.len(), 1);
        assert_eq!(c.games[0].nodes[1].first("B"), Some("pd"));
        assert_eq!(c.warnings, [SgfWarning::Skipped]);
    }

    #[test]
    fn deep_nesting_does_not_overflow() {
        let text = format!("(;{}{}", "(;".repeat(10_000), ")".repeat(10_001));
        let c = parse_sgf(&text).unwrap();
        let written = write_sgf(&c.games);
        assert!(parse_sgf(&written).is_ok());
    }

    #[test]
    fn a_long_main_line_parses() {
        let text = format!("(;SZ[19]{})", ";B[aa];W[bb]".repeat(2_500));
        let c = parse_sgf(&text).unwrap();
        assert_eq!(c.games[0].nodes.len(), 5_001);
    }

    #[test]
    fn write_then_parse_is_identity() {
        for text in [
            "(;GM[1]FF[4]CA[UTF-8]SZ[19]PB[丁浩]C[a\\]b\\\\c];B[pd];W[dd](;B[pp];W[dp])(;B[dp]C[x]))",
            "(;AP[GNU Go:3.8]  SZ[19]AP[foxwq])",
            "(;GN[a])(;GN[b])",
            "(;C[line one\nline two])",
        ] {
            let c = parse_sgf(text).unwrap();
            let again = parse_sgf(&write_sgf(&c.games)).unwrap();
            assert_eq!(again.games, c.games, "{text}");
        }
    }
}
