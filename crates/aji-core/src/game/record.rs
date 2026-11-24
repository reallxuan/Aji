//! A game built from an SGF tree: nodes in an arena, boards per node, the main line, and the
//! positions KataGo analyses.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Serialize;
use ts_rs::TS;

use super::board::{Board, Illegal, expand_points};
use super::rules::{AnalysisRules, RulesReading, is_fox_even_game, read_rules};
use crate::coords::{BoardSize, Color, Move, Point};
use crate::position::Position;
use crate::sgf::{SgfNode, SgfTree};

/// A node's index in the game's arena. The root is 0; a child's id is larger than its parent's.
pub type NodeId = usize;

/// The record's information from the root, for display.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GameInfo {
    pub black: Option<String>,
    pub white: Option<String>,
    pub black_rank: Option<String>,
    pub white_rank: Option<String>,
    pub result: Option<String>,
    pub date: Option<String>,
    pub event: Option<String>,
    pub round: Option<String>,
    pub game_name: Option<String>,
    pub place: Option<String>,
    pub handicap: Option<u8>,
}

/// Why a tree cannot be opened as a game.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameError {
    /// `GM` names a game other than Go.
    NotGo,
    /// Not a square board of 5 to 19 lines. Sizes saturate at 255; an unreadable `SZ` is 0.
    UnsupportedSize { width: u8, height: u8 },
}

/// A board after a sequence of preview moves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Preview {
    pub stones: Vec<Option<Color>>,
    /// The points each move captured.
    pub captured: Vec<Vec<Point>>,
    /// The index of the first illegal move.
    pub illegal_at: Option<u32>,
}

struct Node {
    sgf: SgfNode,
    parent: Option<NodeId>,
    children: Vec<NodeId>,
}

/// What follows from playing the path to a node; computed when first asked for.
struct NodeState {
    board: Board,
    mv: Option<(Color, Move)>,
    illegal: Option<Illegal>,
    move_number: u32,
    to_play: Color,
    /// The latest node on the path that a move list cannot express (setup stones or an
    /// illegal move), else the root.
    base: NodeId,
}

/// A game: the SGF nodes in an arena, with boards and positions derived along any path.
pub struct Game {
    size: BoardSize,
    info: GameInfo,
    nodes: Vec<Node>,
    states: Vec<OnceLock<NodeState>>,
    main_line: Vec<NodeId>,
}

impl std::fmt::Debug for Game {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Game")
            .field("size", &self.size)
            .field("nodes", &self.nodes.len())
            .finish()
    }
}

fn board_size(root: &SgfNode) -> Result<BoardSize, GameError> {
    let unsupported = |w: u32, h: u32| GameError::UnsupportedSize {
        width: u8::try_from(w).unwrap_or(u8::MAX),
        height: u8::try_from(h).unwrap_or(u8::MAX),
    };
    let Some(sz) = root.first("SZ") else {
        return Ok(BoardSize::NINETEEN);
    };
    let parse = |s: &str| s.trim().parse::<u32>().ok();
    let (w, h) = match sz.split_once(':') {
        Some((w, h)) => (parse(w), parse(h)),
        None => (parse(sz), parse(sz)),
    };
    let (Some(w), Some(h)) = (w, h) else {
        return Err(unsupported(0, 0));
    };
    if w != h || !(5..=19).contains(&w) {
        return Err(unsupported(w, h));
    }
    BoardSize::new(u8::try_from(w).expect("at most 19")).map_err(|_| unsupported(w, h))
}

fn text(root: &SgfNode, id: &str) -> Option<String> {
    root.first(id)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}

fn color_of(s: &str) -> Option<Color> {
    match s.trim() {
        "B" | "b" => Some(Color::Black),
        "W" | "w" => Some(Color::White),
        _ => None,
    }
}

fn has_setup(node: &SgfNode) -> bool {
    ["AB", "AW", "AE"].iter().any(|id| node.get(id).is_some())
}

impl Game {
    /// Builds a game from the first tree of a file. `default_rules` applies when the file names
    /// neither rules nor a usable komi.
    pub fn from_sgf(
        tree: SgfTree,
        default_rules: AnalysisRules,
    ) -> Result<(Game, RulesReading), GameError> {
        let root_sgf = tree.nodes.first().cloned().unwrap_or_default();
        if root_sgf.first("GM").is_some_and(|gm| gm.trim() != "1") {
            return Err(GameError::NotGo);
        }
        let size = board_size(&root_sgf)?;
        let reading = read_rules(&root_sgf, default_rules);
        let info = GameInfo {
            black: text(&root_sgf, "PB"),
            white: text(&root_sgf, "PW"),
            black_rank: text(&root_sgf, "BR"),
            white_rank: text(&root_sgf, "WR"),
            result: text(&root_sgf, "RE"),
            date: text(&root_sgf, "DT"),
            event: text(&root_sgf, "EV"),
            round: text(&root_sgf, "RO"),
            game_name: text(&root_sgf, "GN"),
            place: text(&root_sgf, "PC"),
            handicap: root_sgf.first("HA").and_then(|h| h.trim().parse().ok()),
        };

        // Flatten into an arena in pre-order, with an explicit stack.
        let mut nodes: Vec<Node> = Vec::new();
        let mut stack: Vec<(SgfTree, Option<NodeId>)> = vec![(tree, None)];
        while let Some((tree, parent)) = stack.pop() {
            let mut parent = parent;
            for sgf in tree.nodes {
                let id = nodes.len();
                nodes.push(Node {
                    sgf,
                    parent,
                    children: Vec::new(),
                });
                if let Some(p) = parent {
                    nodes[p].children.push(id);
                }
                parent = Some(id);
            }
            // Pushed in reverse so the first variation is numbered first.
            for variation in tree.variations.into_iter().rev() {
                stack.push((variation, parent));
            }
        }
        if nodes.is_empty() {
            nodes.push(Node {
                sgf: SgfNode::default(),
                parent: None,
                children: Vec::new(),
            });
        }
        // Children were pushed in the order their subtrees were numbered, which is file order.
        let mut main_line = vec![0];
        while let Some(&next) = nodes[*main_line.last().expect("not empty")]
            .children
            .first()
        {
            main_line.push(next);
        }
        let states = (0..nodes.len()).map(|_| OnceLock::new()).collect();
        Ok((
            Game {
                size,
                info,
                nodes,
                states,
                main_line,
            },
            reading,
        ))
    }

    pub fn size(&self) -> BoardSize {
        self.size
    }

    pub fn info(&self) -> &GameInfo {
        &self.info
    }

    pub fn root(&self) -> NodeId {
        0
    }

    /// The root, then each node's first child.
    /// The node's properties as the file had them.
    pub fn sgf(&self, node: NodeId) -> &SgfNode {
        &self.nodes[node].sgf
    }

    pub fn main_line(&self) -> &[NodeId] {
        &self.main_line
    }

    pub fn parent(&self, node: NodeId) -> Option<NodeId> {
        self.nodes[node].parent
    }

    /// Whether the record holds no move and no setup stone.
    pub fn is_empty(&self) -> bool {
        self.nodes
            .iter()
            .all(|n| !has_setup(&n.sgf) && n.sgf.get("B").is_none() && n.sgf.get("W").is_none())
    }

    fn state(&self, node: NodeId) -> &NodeState {
        if let Some(state) = self.states[node].get() {
            return state;
        }
        // Compute from the nearest ancestor that has a state, without recursion.
        let mut path = vec![node];
        while let Some(parent) = self.nodes[*path.last().expect("not empty")].parent {
            if self.states[parent].get().is_some() {
                break;
            }
            path.push(parent);
        }
        for &id in path.iter().rev() {
            let parent = self.nodes[id]
                .parent
                .map(|p| self.states[p].get().expect("computed"));
            let state = self.compute(id, parent);
            let _ = self.states[id].set(state);
        }
        self.states[node].get().expect("computed")
    }

    fn compute(&self, id: NodeId, parent: Option<&NodeState>) -> NodeState {
        let sgf = &self.nodes[id].sgf;
        let mut board = parent.map_or_else(|| Board::new(self.size), |p| p.board.clone());
        let setup = has_setup(sgf);
        for (prop, stone) in [
            ("AB", Some(Color::Black)),
            ("AW", Some(Color::White)),
            ("AE", None),
        ] {
            for value in sgf
                .get(prop)
                .map(|p| p.values.as_slice())
                .unwrap_or_default()
            {
                for point in expand_points(value.trim(), self.size) {
                    board.set(point, stone);
                }
            }
        }

        let mv = [("B", Color::Black), ("W", Color::White)]
            .into_iter()
            .find_map(|(prop, color)| sgf.first(prop).map(|v| (color, v.trim())));
        let mut illegal = None;
        let mut played = None;
        if let Some((color, value)) = mv {
            let n = self.size.get();
            let mv = if value.is_empty() || (value == "tt" && n <= 19) {
                Some(Move::Pass)
            } else {
                match expand_points(value, self.size).as_slice() {
                    [p] if !value.contains(':') => Some(Move::Play(*p)),
                    _ => None,
                }
            };
            match mv {
                Some(mv) => {
                    illegal = board.play(color, mv, false).illegal;
                    played = Some((color, mv));
                }
                None => illegal = Some(Illegal::OffBoard),
            }
        }

        let move_number = parent.map_or(0, |p| p.move_number) + u32::from(played.is_some());
        let to_play = if let Some(pl) = sgf.first("PL").and_then(color_of) {
            pl
        } else if let Some((color, _)) = played {
            color.opponent()
        } else if let Some(p) = parent {
            p.to_play
        } else if self.info.handicap.is_some_and(|h| h >= 2) && sgf.get("AB").is_some() {
            Color::White
        } else {
            Color::Black
        };
        let base = if setup || illegal.is_some() {
            id
        } else {
            parent.map_or(id, |p| p.base)
        };
        NodeState {
            board,
            mv: played,
            illegal,
            move_number,
            to_play,
            base,
        }
    }

    /// Moves (passes included) from the root to `node`.
    pub fn move_number(&self, node: NodeId) -> u32 {
        self.state(node).move_number
    }

    pub fn board_at(&self, node: NodeId) -> &Board {
        &self.state(node).board
    }

    /// The node's own move.
    pub fn last_move(&self, node: NodeId) -> Option<Move> {
        self.state(node).mv.map(|(_, mv)| mv)
    }

    /// The colour of the node's own move.
    pub fn last_color(&self, node: NodeId) -> Option<Color> {
        self.state(node).mv.map(|(c, _)| c)
    }

    pub fn to_play(&self, node: NodeId) -> Color {
        self.state(node).to_play
    }

    pub fn illegal(&self, node: NodeId) -> Option<Illegal> {
        self.state(node).illegal
    }

    /// Whether any node of the game is flagged illegal.
    pub fn has_illegal(&self) -> bool {
        (0..self.nodes.len()).any(|n| self.illegal(n).is_some())
    }

    /// The position KataGo analyses at `node`; `None` on an illegal node. After setup stones or
    /// an illegal move, the position starts from that node's board (design 5.2).
    pub fn position_at(&self, node: NodeId, rules: &AnalysisRules) -> Option<Position> {
        let state = self.state(node);
        if state.illegal.is_some() {
            return None;
        }
        let base = state.base;
        let mut moves = Vec::new();
        let mut at = node;
        while at != base {
            if let Some(mv) = self.state(at).mv {
                moves.push(mv);
            }
            at = self.nodes[at].parent.expect("the base is an ancestor");
        }
        moves.reverse();

        let base_state = self.state(base);
        let n = usize::from(self.size.get());
        let setup: Vec<(Color, Point)> = base_state
            .board
            .stones()
            .iter()
            .enumerate()
            .filter_map(|(i, stone)| {
                stone.map(|c| {
                    let p = Point {
                        x: u8::try_from(i % n).expect("on the board"),
                        y: u8::try_from(i / n).expect("on the board"),
                    };
                    (c, p)
                })
            })
            .collect();
        let plain_root = base == self.root()
            && setup.is_empty()
            && self.nodes[base].sgf.get("PL").is_none()
            && base_state.mv.is_none();
        // The first move's colour when there is one (a file may continue with either colour
        // after setup stones), else whoever is to play at the base.
        let initial_player = if plain_root {
            None
        } else {
            Some(moves.first().map_or(base_state.to_play, |&(c, _)| c))
        };
        let mut position = Position::empty(self.size, rules.kata_rules(), rules.komi());
        position.setup = setup;
        position.moves = moves;
        position.initial_player = initial_player;
        Some(position)
    }

    /// The board after `moves` from `node`, colours alternating from the player to move there.
    /// The game is not changed.
    pub fn preview(&self, node: NodeId, moves: &[Move]) -> Preview {
        let mut board = self.board_at(node).clone();
        let mut color = self.to_play(node);
        let mut captured = Vec::with_capacity(moves.len());
        let mut illegal_at = None;
        for (i, &mv) in moves.iter().enumerate() {
            let result = board.play(color, mv, false);
            if result.illegal.is_some() && illegal_at.is_none() {
                illegal_at = Some(u32::try_from(i).unwrap_or(u32::MAX));
            }
            captured.push(result.captured);
            color = color.opponent();
        }
        Preview {
            stones: board.stones(),
            captured,
            illegal_at,
        }
    }

    /// The game as an SGF tree to write. `CA` becomes `UTF-8`, `FF` and `GM` are added when
    /// missing, and with `rules` (the user changed them) `RU` and `KM` are replaced.
    pub fn to_sgf(&self, rules: Option<&AnalysisRules>) -> SgfTree {
        let mut root = self.nodes[0].sgf.clone();
        set_prop(&mut root, "CA", "UTF-8");
        if root.get("FF").is_none() {
            root.push("FF", ["4".to_owned()]);
        }
        if root.get("GM").is_none() {
            root.push("GM", ["1".to_owned()]);
        }
        if let Some(rules) = rules {
            let kata = rules.kata_rules();
            let ru = match kata.preset() {
                Some(crate::Rules::Chinese) => "Chinese".to_owned(),
                Some(crate::Rules::Japanese | crate::Rules::Korean) => {
                    // A named Japanese RU with KM[0] is ambiguous on an even Fox record.
                    if rules.komi().points() == 0.0 && is_fox_even_game(&root) {
                        kata.katago_string()
                    } else {
                        "Japanese".to_owned()
                    }
                }
                // Existing named Tromp-Taylor records retain their legacy scoring-based reading.
                Some(crate::Rules::TrompTaylor) | None => kata.katago_string(),
            };
            set_prop(&mut root, "RU", &ru);
            set_prop(&mut root, "KM", &format_komi(rules.komi().points()));
        }

        // Sequence heads are the root and every child of a node with several children. Each
        // head's id is larger than its parent's, so building from the highest id down finds
        // every variation already built.
        let mut heads = vec![0];
        for node in &self.nodes {
            if node.children.len() > 1 {
                heads.extend(&node.children);
            }
        }
        heads.sort_unstable();
        let mut built: HashMap<NodeId, SgfTree> = HashMap::new();
        for &head in heads.iter().rev() {
            let mut tree = SgfTree::default();
            let mut at = head;
            loop {
                tree.nodes.push(if at == 0 {
                    root.clone()
                } else {
                    self.nodes[at].sgf.clone()
                });
                match self.nodes[at].children.as_slice() {
                    [only] => at = *only,
                    children => {
                        tree.variations = children
                            .iter()
                            .map(|c| built.remove(c).expect("built before its parent"))
                            .collect();
                        break;
                    }
                }
            }
            built.insert(head, tree);
        }
        built.remove(&0).expect("the root is a head")
    }
}

/// Replaces a property's values with one value, or adds it at the end.
fn set_prop(node: &mut SgfNode, id: &str, value: &str) {
    match node.props.iter_mut().find(|p| p.id == id) {
        Some(prop) => prop.values = vec![value.to_owned()],
        None => node.push(id, [value.to_owned()]),
    }
}

/// `7` for 7.0, `7.5` for 7.5.
pub fn format_komi(points: f64) -> String {
    if points.fract() == 0.0 {
        format!("{points:.0}")
    } else {
        format!("{points}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sgf::parse_sgf;

    fn game(text: &str) -> Game {
        let c = parse_sgf(text).unwrap();
        Game::from_sgf(c.games.into_iter().next().unwrap(), AnalysisRules::Chinese)
            .unwrap()
            .0
    }

    fn error(text: &str) -> GameError {
        let c = parse_sgf(text).unwrap();
        Game::from_sgf(c.games.into_iter().next().unwrap(), AnalysisRules::Chinese).unwrap_err()
    }

    fn pt(s: &str) -> Point {
        let b = s.as_bytes();
        Point {
            x: b[0] - b'a',
            y: b[1] - b'a',
        }
    }

    fn last(g: &Game) -> NodeId {
        *g.main_line().last().unwrap()
    }

    fn fox_zero_komi_round_trip(kata: crate::KataRules) {
        let fox = game("(;AP[foxwq]HA[0]RU[Japanese]KM[0];B[pd])");
        let original = fox.to_sgf(None);
        assert_eq!(
            read_rules(&original.nodes[0], AnalysisRules::Chinese)
                .rules
                .komi()
                .points(),
            6.5
        );
        let selected = AnalysisRules::Custom {
            komi: crate::Komi::new(0.0).unwrap(),
            scoring: crate::game::Scoring::Territory,
            details: Some(kata.into()),
        };
        let text = crate::sgf::write_sgf(&[fox.to_sgf(Some(&selected))]);
        let reopened = parse_sgf(&text).unwrap();
        let root = &reopened.games[0].nodes[0];
        assert_eq!(root.first("KM"), Some("0"));
        assert_eq!(root.first("RU"), Some(kata.katago_string().as_str()));
        assert!(
            read_rules(root, AnalysisRules::Chinese)
                .rules
                .same_effect(&selected)
        );
    }

    #[test]
    fn fox_zero_komi_with_custom_rules_survives_export() {
        fox_zero_komi_round_trip(crate::KataRules {
            tax: crate::TaxRule::All,
            ..crate::Rules::Japanese.into()
        });
    }

    #[test]
    fn fox_zero_komi_with_japanese_rules_survives_export() {
        fox_zero_komi_round_trip(crate::Rules::Japanese.into());
    }

    #[test]
    fn exact_tromp_taylor_survives_sgf_export() {
        let game = game("(;RU[koPOSITIONALscoreAREAtaxNONEsui1]KM[5])");
        let exact = read_rules(&game.to_sgf(None).nodes[0], AnalysisRules::Chinese).rules;
        let saved = game.to_sgf(Some(&exact));
        assert_eq!(
            saved.nodes[0].first("RU"),
            Some("koPOSITIONALscoreAREAtaxNONEsui1")
        );
        assert_eq!(
            read_rules(&saved.nodes[0], AnalysisRules::Chinese).rules,
            exact
        );
    }

    #[test]
    fn to_sgf_writes_the_preset_name_or_the_katago_string() {
        let g = game("(;SZ[19])");
        let root = &g.to_sgf(Some(&AnalysisRules::Chinese)).nodes[0];
        assert_eq!(root.first("RU"), Some("Chinese"));
        let input = game("(;RU[koPOSITIONALscoreAREAtaxALLsui1whbN]KM[7])");
        let rules = read_rules(&input.to_sgf(None).nodes[0], AnalysisRules::Chinese).rules;
        let root = &g.to_sgf(Some(&rules)).nodes[0];
        assert_eq!(
            root.first("RU"),
            Some("koPOSITIONALscoreAREAtaxALLsui1whbN")
        );
    }

    #[test]
    fn sizes() {
        assert_eq!(
            error("(;SZ[19:13])"),
            GameError::UnsupportedSize {
                width: 19,
                height: 13
            }
        );
        assert_eq!(
            error("(;SZ[21])"),
            GameError::UnsupportedSize {
                width: 21,
                height: 21
            }
        );
        assert_eq!(
            error("(;SZ[4])"),
            GameError::UnsupportedSize {
                width: 4,
                height: 4
            }
        );
        assert_eq!(error("(;GM[2])"), GameError::NotGo);
        assert_eq!(game("(;SZ[9])").size().get(), 9);
        assert_eq!(game("(;SZ[13:13])").size().get(), 13);
        assert_eq!(game("(;GN[x])").size().get(), 19);
    }

    #[test]
    fn main_line_follows_first_children() {
        let g = game("(;SZ[19];B[pd](;W[dd];B[pp])(;W[dp]))");
        assert_eq!(g.main_line().len(), 4);
        assert_eq!(g.last_move(last(&g)), Some(Move::Play(pt("pp"))));
        assert_eq!(g.move_number(last(&g)), 3);
    }

    #[test]
    fn move_numbers_count_passes_not_setup() {
        let g = game("(;SZ[19];B[pd];W[];B[tt];AB[aa];W[dd])");
        let numbers: Vec<_> = g.main_line().iter().map(|&n| g.move_number(n)).collect();
        assert_eq!(numbers, [0, 1, 2, 3, 3, 4]);
        assert_eq!(g.last_move(g.main_line()[2]), Some(Move::Pass));
        assert_eq!(g.last_move(g.main_line()[3]), Some(Move::Pass));
    }

    #[test]
    fn handicap_root() {
        let g = game("(;SZ[19]HA[3]AB[dd][pd][dp];W[pp])");
        let p = g.position_at(g.root(), &AnalysisRules::Chinese).unwrap();
        assert_eq!(p.initial_player, Some(Color::White));
        assert_eq!(p.setup.len(), 3);
        assert!(p.moves.is_empty());
        assert_eq!(g.to_play(g.root()), Color::White);
        let p = g.position_at(last(&g), &AnalysisRules::Chinese).unwrap();
        assert_eq!(p.moves, [(Color::White, Move::Play(pt("pp")))]);
        assert_eq!(g.info().handicap, Some(3));
    }

    #[test]
    fn plain_game_has_no_initial_player() {
        let g = game("(;SZ[19];B[pd])");
        let p = g
            .position_at(last(&g), &AnalysisRules::JapaneseKorean)
            .unwrap();
        assert_eq!(p.initial_player, None);
        assert!(p.setup.is_empty());
        assert_eq!(p.rules, crate::Rules::Japanese.into());
        assert_eq!(p.komi.points(), 6.5);
    }

    #[test]
    fn pl_sets_player() {
        let g = game("(;SZ[9]AB[dd]PL[W])");
        assert_eq!(g.to_play(g.root()), Color::White);
        let p = g.position_at(g.root(), &AnalysisRules::Chinese).unwrap();
        assert_eq!(p.initial_player, Some(Color::White));
    }

    #[test]
    fn mid_game_setup_rebases() {
        let g = game("(;SZ[19];B[pd];W[dd];AB[qq];W[pp])");
        let p = g.position_at(last(&g), &AnalysisRules::Chinese).unwrap();
        let mut setup = p.setup.clone();
        setup.sort_by_key(|&(_, q)| (q.y, q.x));
        assert_eq!(
            setup,
            [
                (Color::White, pt("dd")),
                (Color::Black, pt("pd")),
                (Color::Black, pt("qq")),
            ]
        );
        assert_eq!(p.initial_player, Some(Color::White));
        assert_eq!(p.moves, [(Color::White, Move::Play(pt("pp")))]);
    }

    #[test]
    fn illegal_move_rebases_later_nodes() {
        let g = game("(;SZ[19];B[pd];W[pd];B[dd])");
        let bad = g.main_line()[2];
        assert_eq!(g.illegal(bad), Some(Illegal::Occupied));
        assert!(g.has_illegal());
        assert_eq!(g.position_at(bad, &AnalysisRules::Chinese), None);
        let p = g.position_at(last(&g), &AnalysisRules::Chinese).unwrap();
        assert_eq!(p.setup, [(Color::White, pt("pd"))]);
        assert_eq!(p.moves, [(Color::Black, Move::Play(pt("dd")))]);
        assert_eq!(g.illegal(last(&g)), None);
    }

    #[test]
    fn off_board_move_is_flagged() {
        let g = game("(;SZ[9];B[pd])");
        assert_eq!(g.illegal(last(&g)), Some(Illegal::OffBoard));
    }

    #[test]
    fn last_move_and_captures() {
        let g = game("(;SZ[9];W[ba];B[aa];W[ca];B[bb];W[ee];B[cb];W[ff];B[da])");
        let b = g.board_at(last(&g));
        assert_eq!(b.get(pt("ba")), None);
        assert_eq!(b.get(pt("ca")), None);
        assert_eq!(b.captures(), (2, 0));
        assert_eq!(g.last_move(last(&g)), Some(Move::Play(pt("da"))));
    }

    #[test]
    fn preview() {
        let g = game("(;SZ[9];W[ba];B[aa];W[ca];B[bb];W[ee];B[cb])");
        let from = last(&g);
        assert_eq!(g.to_play(from), Color::White);
        let pv = g.preview(from, &[Move::Play(pt("gg")), Move::Play(pt("da"))]);
        assert_eq!(pv.captured.len(), 2);
        assert!(pv.captured[0].is_empty());
        assert_eq!(pv.captured[1].len(), 2);
        assert_eq!(pv.illegal_at, None);
        let n = 9;
        assert_eq!(
            pv.stones[usize::from(pt("gg").y) * n + usize::from(pt("gg").x)],
            Some(Color::White)
        );
        let pv = g.preview(from, &[Move::Play(pt("aa"))]);
        assert_eq!(pv.illegal_at, Some(0));
        // The game itself is untouched.
        assert_eq!(g.board_at(from).get(pt("gg")), None);
    }

    #[test]
    fn info_is_read() {
        let g = game(
            "(;SZ[19]PB[丁浩]PW[廖元赫]BR[9p]WR[9p]RE[W+R]DT[2025-11-17]EV[Samsung]RO[2]GN[g]PC[Seoul])",
        );
        let i = g.info();
        assert_eq!(i.black.as_deref(), Some("丁浩"));
        assert_eq!(i.white.as_deref(), Some("廖元赫"));
        assert_eq!(i.black_rank.as_deref(), Some("9p"));
        assert_eq!(i.result.as_deref(), Some("W+R"));
        assert_eq!(i.round.as_deref(), Some("2"));
        assert_eq!(i.place.as_deref(), Some("Seoul"));
    }

    #[test]
    fn to_sgf_keeps_everything() {
        let text =
            "(;CA[GB2312]SZ[19]LZ[a b c]XX[keep];B[pd]LZOP[1 2](;W[dd];B[pp])(;W[dp]C[var]))";
        let g = game(text);
        let tree = g.to_sgf(None);
        let original = parse_sgf(text).unwrap().games.remove(0);
        let root = &tree.nodes[0];
        assert_eq!(root.get("CA").unwrap().values, ["UTF-8"]);
        assert_eq!(root.props.iter().filter(|p| p.id == "CA").count(), 1);
        assert_eq!(root.first("FF"), Some("4"));
        assert_eq!(root.first("GM"), Some("1"));
        assert_eq!(root.first("LZ"), Some("a b c"));
        assert_eq!(root.first("XX"), Some("keep"));
        assert_eq!(tree.nodes[1].first("LZOP"), Some("1 2"));
        assert_eq!(tree.variations.len(), 2);
        assert_eq!(tree.variations[1], original.variations[1]);
        let changed = g.to_sgf(Some(&AnalysisRules::Custom {
            details: None,
            komi: crate::Komi::new(7.0).unwrap(),
            scoring: crate::game::Scoring::Territory,
        }));
        assert_eq!(changed.nodes[0].first("RU"), Some("Japanese"));
        assert_eq!(changed.nodes[0].first("KM"), Some("7"));
        let chinese = g.to_sgf(Some(&AnalysisRules::Chinese));
        assert_eq!(chinese.nodes[0].first("RU"), Some("Chinese"));
        assert_eq!(chinese.nodes[0].first("KM"), Some("7.5"));
    }

    #[test]
    fn a_long_game_builds_without_recursion() {
        let text = format!("(;SZ[19]{})", ";B[aa];W[bb];B[];W[]".repeat(1_500));
        let g = game(&text);
        assert_eq!(g.move_number(last(&g)), 6_000);
        assert!(g.position_at(last(&g), &AnalysisRules::Chinese).is_some());
    }
}
