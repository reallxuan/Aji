//! Writes an SGF tree back as text.

use super::tree::{SgfNode, SgfTree};

/// Nodes per line in a sequence, so files stay readable in a text editor.
const NODES_PER_LINE: usize = 10;

/// Writes `games` one after another, each ending in a line break. Values are escaped (`]` and
/// `\`); each variation starts on its own line.
pub fn write_sgf(games: &[SgfTree]) -> String {
    let mut out = String::new();
    for game in games {
        write_tree(game, None, &mut out);
    }
    out
}

enum Step<'a> {
    Open(&'a SgfTree),
    Close,
}

pub(super) fn write_tree(root: &SgfTree, mut first: Option<&SgfNode>, out: &mut String) {
    let mut stack = vec![Step::Open(root)];
    while let Some(step) = stack.pop() {
        let tree = match step {
            Step::Close => {
                out.push(')');
                continue;
            }
            Step::Open(tree) => tree,
        };
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push('(');
        for (k, node) in tree.nodes.iter().enumerate() {
            if k > 0 && k % NODES_PER_LINE == 0 {
                out.push('\n');
            }
            out.push(';');
            let node = first.take().unwrap_or(node);
            for prop in &node.props {
                out.push_str(&prop.id);
                for value in &prop.values {
                    out.push('[');
                    for c in value.chars() {
                        if c == ']' || c == '\\' {
                            out.push('\\');
                        }
                        out.push(c);
                    }
                    out.push(']');
                }
            }
        }
        stack.push(Step::Close);
        stack.extend(tree.variations.iter().rev().map(Step::Open));
    }
    out.push('\n');
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sgf::parse_sgf;

    #[test]
    fn write_escapes_values() {
        let c = parse_sgf("(;C[a\\]b\\\\])").unwrap();
        let text = write_sgf(&c.games);
        assert!(text.contains("C[a\\]b\\\\]"), "{text}");
    }

    #[test]
    fn write_breaks_long_lines_and_variations() {
        let c = parse_sgf(&format!(
            "(;SZ[19]{}(;B[aa])(;B[bb]))",
            ";B[pd];W[dd]".repeat(13)
        ))
        .unwrap();
        let text = write_sgf(&c.games);
        assert!(text.lines().all(|l| l.matches(';').count() <= 10), "{text}");
        assert!(text.lines().any(|l| l.starts_with("(;B[aa]")), "{text}");
        assert!(text.lines().any(|l| l.starts_with("(;B[bb]")), "{text}");
        assert!(text.ends_with(")\n"));
    }
}
