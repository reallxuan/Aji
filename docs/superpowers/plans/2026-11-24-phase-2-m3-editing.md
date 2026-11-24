# Phase 2 M3 Game Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a record editable in Aji, so a review never needs LizzieYzy:
- moves that make variations, and a variation tree;
- one undo history with an unsaved-changes mark;
- try-out, comments, markup and setup;
- game information with KataGo's full rules;
- view rotation, move numbers and auto-replay;
- save in place and save options;
- whole-game analysis of every branch.

**Architecture:**
- **`aji-core`** gets an editable node pool. Every user edit compiles to primitive operations (`Op`), and each `Op` returns its exact inverse when applied (design 4.1 A). Nodes are never freed while history can bring them back, so ids stay stable.
- **`src-tauri`'s `GameSession`** holds:
  - the current node and the line's tip;
  - try-out;
  - the undo history and the unsaved mark;
  - the source encoding.
- **The service** serves new requests and pushes a tree event when the structure changes. It computes the trend against the current line by key, and plans all-branch jobs.
- **The interface** sends edits and renders snapshots. It adds the edit row and tools, marks, badges, the tree and comment panels, the editable game information, menus, prompts and the browser fake's tree. It never computes a rule.

**Tech Stack:**
- Existing: Tauri 2, Tokio, serde, ts-rs, `encoding_rs` (already in `aji-core`), React 19, Zustand 5, radix-ui, i18next, Tailwind 4, Vitest with Testing Library, `@napi-rs/canvas` screenshot tests, the fake KataGo.
- No new dependency.

**Spec:** [Phase 2 M3 design](../specs/2026-11-24-p2-m3-editing-design.md), approved by the owner on 2026-11-24.
- Mockups: [`docs/design/mockups/p2-m3/`](../../design/mockups/p2-m3/).
- Section numbers below (5.3 and so on) are the design's.
- The phase plan is [Phase 2 plan](2026-11-21-phase-2-roadmap.md).

**Status:** Implemented and reviewed on 2026-11-24. The arm64 macOS app is ready for the maintainer's walk. The automated exit checks produced these results.

- **Branch review and checks.** A fresh whole-branch source review found five issues, and browser testing found two. Regression checks reproduced all seven, and the reviewer approved the corrections. The final checks passed 939 Rust tests and 994 frontend tests, formatting, Clippy, lint, type checking, licence checks and third-party notices. All 100 generated TypeScript bindings matched a fresh generation byte for byte. On a 300-move record with 50 variations, release-mode edit, undo and redo took 1.157, 2.523 and 1.141 ms respectively (50 ms budget each). Building the payload for 10,001 nodes including the root took 2.077 ms (under 100 ms for 10,000 nodes).
- **Browser.** Headless Chrome passed 168/168 editing checks across 1440 × 900, 375 × 812 and 768 × 1024, both themes, with mouse and emulated touch. These included the corrected try-out Pass, title menu under the touch layout grip and phone submenu labels. For insert, flatten and all-branch analysis the browser fake exercises the controls and requests. The native checks below exercised their effects.
- **Native Mac.** Process-local AppKit events and WKWebView editing commands exercised actual menu items, Command-Z and Shift-Command-Z. Focused comment undo and redo left record history intact. Board undo and redo changed one move each. Undoing flatten restored every tree row. Canceling close or a save dialog retained edits. A failed in-place save kept the dirty record open, and retrying wrote the move and quit. Discard quit without writing, and try-out alone quit without a prompt. The job panel started real KataGo 1.18.2 with its b18 network and completed all 257/257 positions, including the side branch.
- **Encoding.** An unedited in-place save of the GBK Fox fixture preserved all 262 raw property values across 243 nodes and preserved the tree structure. The complete file changed from 1,624 to 1,629 bytes as SGF whitespace and repeated property identifiers were normalized.
- **Interoperability.** Aji edited a copy of the 254-move Shin Jinseo–Byun Sangil Samsung Cup semifinal of 2026-11-17. The review exercised keeping and discarding try-out moves, promotion, comments, marks, setup, undo and redo. Sabaki Web opened the saved SGF and showed both players, 255 moves across one fork, one marked node and the comment “Review variation after move 38”. The source file retained its original hash.
- **Build and remaining checks.** `pnpm tauri build --bundles app` produced the 14.57 MiB arm64 Aji.app (0.1.0). Its local ad-hoc signature passed `codesign --verify --deep --strict`. The maintainer's hands-on walk and physical touchscreen check remain open. LizzieYzy was unavailable on the test Mac. The Windows walk belongs to Phase 2 M4.

**Compatibility notes.** SGF export uses compact `RU` for exact Tromp–Taylor so historical named rules keep their established meaning. An otherwise empty explicit `PL[B]` root shares the implicit Black root's analysis key. Old analysis for such roots may need reanalysis or reimport from SGF `LZ`. Clean export removes comments and analysis, including secondary `LZ` data in a collection. If an in-place export exceeds the 20 MiB opening limit, Aji preserves the original file and the dirty record. An explicit Save As can write an oversized copy that Aji cannot reopen.

## Global Constraints

- **Everything from Phase 1, P2 M1 and P2 M2 still holds:**
  - language rules, and interface text in both locales;
  - dependency licences (`cargo deny check licenses`, the npm licence check, the notices staleness check);
  - Conventional Commits ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - `aji-core` depends on no workspace crate and does no I/O;
  - protocol rules: no file paths in `rpc`, errors are `{ code, message }`, camelCase JSON, ts-rs bindings regenerated.
- **No git worktrees**, for subagents too. Work in `/Users/zepher/personal/Aji` on `feat/p2-m3-editing`. Its first commit is the design and mockups, and this plan is its second. Push only when the owner asks.
- **No "·" in any interface text**, in either locale, the native menu labels or a mockup. `src/i18n/parity.test.ts` and `menu_labels_have_no_middle_dot` guard it.
- **Every user-visible string goes through i18n**, `zh-CN` and `en` in the same commit.
  - Chinese strings quoted in the design or mockups are the `zh-CN` values; write natural English for `en`.
  - Native menu labels live in `src-tauri/src/platform/menu.rs` `Labels`, in both languages.
- **LizzieYzy is a feature reference only.** None of its code is copied or translated.
- **Values fixed by the design:**

  | Value | Where |
  |---|---|
  | Undo history | last 1000 entries (5.2) |
  | Node state cache | 4096 nodes besides the current path, then measured on a 20 MB record (5.1) |
  | Move numbers, last N | 10 by default (5.12) |
  | Auto-replay interval | 1.5 s by default (5.12) |
  | Wide default record column | tabs(分支, 评论) over sub-board 1, weights 2 : 1 (5.5) |
  | Edit, undo, redo | answer within 50 ms on a 300-move game with 50 variations (8) |
  | Tree payload | builds in under 100 ms for 10 000 nodes (8) |

- **The owner's decisions are fixed** (design 11):
  - a click keeps the move;
  - try-out is V and a button;
  - no stored engine line, no swap colours, no timed replay;
  - the edit row under the header;
  - 回到这一手 on the right-click menu only, and a left click on a stone does nothing;
  - ↑ ↓ step moves, and [ ] switch continuations.
- **A task that changes a generated type fixes its TypeScript users in the same task**, so `pnpm typecheck` and `pnpm test` pass at every commit. That covers the interface code, `src/dev/` and test fixtures such as `src/game/testing.ts`. Each such task lists them under **Callers**. These edits are the smallest that compile and keep today's behaviour; the interface tasks (10 to 19) build the features.
- **Checks before every commit:**
  - `cargo fmt --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo test --workspace`
  - `pnpm lint`, `pnpm typecheck`, `pnpm test`

## Review Focus

1. **Records with odd nodes.** Examples:
   - a node holding both a move and setup stones;
   - `B[tt]` passes;
   - repeated `B` values;
   - unknown properties;
   - illegal moves in the file;
   - a root with `AB` and `PL`.

   Every edit, then undo, leaves the written SGF byte-identical, and nothing unknown is lost. Test in Task 3 (`undo_restores_odd_records_byte_for_byte`).
2. **Editing while a whole-game job runs and results stream in.** A `TrendNodes` update read for an older line is dropped by the interface, and the job keeps running through edits other than rules. Tests in Task 9 (`edits_do_not_stop_the_job_but_rules_do`) and Task 10 (`stale_trend_updates_are_dropped`).
3. **An edit made while a save is being written, or a failed write.** The edit stays unsaved; the failed write marks nothing saved. Tests in Task 7 (`an_edit_after_export_stays_unsaved`) and Task 18 (`a_failed_write_keeps_the_game_changed`).
4. **A large record:** a 20 MB file, or 10 000 nodes with 500 variations.
   - Opening keeps memory bounded.
   - The tree payload builds in under 100 ms.
   - The tree panel lays out only what is visible.

   Tests in Task 2 (`illegal_scan_keeps_no_boards`), Task 7 (`tree_payload_for_ten_thousand_nodes_is_fast`) and Task 15 (`layout_of_ten_thousand_nodes_is_fast`).
5. **Keys typed into a text field.** In a comment, a game-information field or a rename, V, B, [, ], N, Delete, Backspace, Esc and ⌘Z edit the text. They never edit the record or navigate. Test in Task 16 (`typing_in_the_comment_never_reaches_the_board`).

---

### Task 1: KataGo's full rules in `AnalysisRules`, the query and `RU`

**Files:**
- Modify:
  - `crates/aji-core/src/katarules.rs`: serde and ts-rs derives, `katago_string`, `from_katago_string`, the preset match;
  - `crates/aji-core/src/game/rules.rs`: `Custom` gains `details`, `kata_rules()`, `read_rules`, `same_effect`;
  - `crates/aji-core/src/position.rs`: `Position.rules` becomes `KataRules`;
  - `crates/aji-core/src/game/record.rs`: `to_sgf` writes `RU` from `kata_rules()`;
  - `crates/aji-engine/src/query.rs`: sends a preset name or a rules object.
- Test: in each file. Settings migration in `src-tauri/src/settings.rs`.
- Callers: `src/game/komi.ts`, `src/settings/RulesControl.tsx` and `src/dev/fakeGame.ts` build `custom` with `details: null`.

**Interfaces:**
- Produces:
  - `KoRule`, `ScoringRule`, `TaxRule` and `HandicapBonus` derive `Serialize, Deserialize, TS`, in camelCase. `KataRules` derives them too, in camelCase.
  - `pub struct RuleDetails { pub ko: KoRule, pub tax: TaxRule, pub suicide: bool, pub has_button: bool, pub white_handicap_bonus: HandicapBonus, pub friendly_pass_ok: bool }`, with serde, TS, `Copy`, `Eq` and `Hash`.
  - `AnalysisRules::Custom { komi: Komi, scoring: Scoring, #[serde(default)] details: Option<RuleDetails> }`. `None` means the preset of that scoring (Chinese for area, Japanese for territory), so settings and files written before M3 read unchanged.
  - `AnalysisRules::kata_rules(&self) -> KataRules`.
  - `AnalysisRules::same_effect(&self, other: &AnalysisRules) -> bool`: equal `kata_rules()` and equal komi (backlog M6 minor 4).
  - `KataRules::katago_string(&self) -> String`, for example `koPOSITIONALscoreAREAtaxNONEsui1button0whbN`. Step 3 first checks this spelling against KataGo's own rules string (`Rules::toString` in KataGo's source, and what KataGo accepts as `RU` in an SGF). If KataGo's differs, use KataGo's. `friendlyPassOk` is not in it, and reads back from the preset of its scoring.
  - `KataRules::from_katago_string(s: &str) -> Option<KataRules>`.
  - `KataRules::preset(&self) -> Option<Rules>`: the preset whose values these are.
  - `Position { pub rules: KataRules, … }`. `Position::key()` keeps its bytes, since `key_bytes` is unchanged.
  - `query.rs`: `"rules"` is `rules.preset().map(Rules::katago_name)` when there is one, else the rules object with KataGo's field names (`ko`, `scoring`, `tax`, `suicide`, `hasButton`, `whiteHandicapBonus`, `friendlyPassOk`).

- [x] **Step 1: Write the failing tests:**
  - `katago_string_round_trips_every_combination` (3 × 2 × 3 × 2 × 2 × 3 rule sets)
  - `custom_without_details_is_its_scorings_preset` (`kata_rules()` equals `KataRules::from(Rules::Chinese)` for area)
  - `old_custom_json_still_reads` (`{"kind":"custom","komi":7,"scoring":"area"}` deserialises with `details: None`)
  - `same_effect_ignores_how_the_rules_were_chosen` (`Custom{7.5, area, None}` has the same effect as `Chinese`; changing `ko` does not)
  - `ru_reads_a_katago_string_as_exact_custom_rules` (`RU[koPOSITIONALscoreAREAtaxNONEsui1button0whbN]KM[7]` gives `Custom` with those details)
  - `ru_names_read_as_before` (`AGA`, `Korean`, `NZ` and `tromp-taylor` give M6's readings and position keys, pinned)
  - `to_sgf_writes_the_preset_name_or_the_katago_string`
  - `query_sends_a_preset_name_or_a_rules_object` (`chinese` for Chinese; the object for `ko: positional`)
  - `existing_position_keys_are_unchanged` (the M2 test vector still holds)
- [x] **Step 2: Run** `cargo test --workspace`. Expected: the new tests FAIL to compile or fail.
- [x] **Step 3: Implement** the interfaces above.
  - `read_rules` tries `from_katago_string` before the name table.
  - `Position::empty` takes `KataRules`, and every caller passes `rules.kata_rules()`.
  - `GameSession::set_rules`'s `changed` and the snapshot's `rules.changed` use `same_effect` (M6 minor 4).
- [x] **Step 4: Run** `cargo test --workspace`, `pnpm typecheck` and `pnpm test` (regenerated bindings). Expected: PASS.
- [x] **Step 5: Check with the real KataGo** (`docs/development.md`'s development engine): one query with a custom rules object (`ko: positional`, `tax: all`) is accepted, and its results come back. Record the check in the commit message.
- [x] **Step 6: Commit** `feat(core): carry KataGo's full rule set in custom rules`.

### Task 2: An editable node pool

**Files:**
- Modify: `crates/aji-core/src/game/record.rs`
- Test: in `record.rs`

**Interfaces:**
- Consumes: today's `Game` (`from_sgf`, `to_sgf`, `board_at`, `position_at`, `preview`, `main_line`).
- Produces:
  - `Node` gains `tryout: bool` and `attached: bool`.
  - `Game` gains `root: NodeId`, and drops the "child id > parent id" assumption everywhere, including `to_sgf`'s head order. Heads are visited in depth-first post-order from the root.
  - `Game::root(&self) -> NodeId` returns the field.
  - `Game::children(&self, node: NodeId) -> &[NodeId]`.
  - `Game::is_tryout(&self, node: NodeId) -> bool`.
  - `Game::is_attached(&self, node: NodeId) -> bool`.
  - `Game::path_to(&self, node: NodeId) -> Vec<NodeId>` (root first).
  - `Game::line_through(&self, tip: NodeId) -> Vec<NodeId>`: `path_to(tip)`, then first children to the end.
  - `Game::main_line(&self) -> &[NodeId]` stays, recomputed after every structural change.
  - `Game::invalidate(&mut self, node: NodeId)`: forgets the derived state of `node`'s subtree.
  - `Game::trim(&mut self, keep: &[NodeId])`: drops cached states beyond 4096, never those in `keep`.
  - `Game::illegal_nodes(&self) -> &[NodeId]`: computed at open by one depth-first walk that keeps a board only per open branch point. It replaces `has_illegal`'s per-node boards (M6 minor 10), and is updated by `invalidate`.
  - `Game::info(&self) -> GameInfo`: computed from the root's properties, no longer stored.
  - `to_sgf` skips try-out nodes and detached nodes.

- [x] **Step 1: Write the failing tests:**
  - `line_through_follows_first_children_after_the_tip`
  - `to_sgf_does_not_rely_on_id_order` (a pool whose child has a smaller id writes the same SGF)
  - `invalidate_recomputes_the_subtree_only`
  - `illegal_scan_keeps_no_boards` (after opening a 10 000-node generated record, no node state is cached)
  - `trim_keeps_the_path`
  - `to_sgf_skips_tryout_and_detached_nodes`
- [x] **Step 2: Run** `cargo test -p aji-core record`. Expected: FAIL.
- [x] **Step 3: Implement** the interfaces. `states` stays `Vec<OnceLock<NodeState>>`; `invalidate` and `trim` replace entries through `&mut self`.
- [x] **Step 4: Run** `cargo test --workspace`. Expected: PASS, with every Phase 1 and M2 game test unchanged.
- [x] **Step 5: Commit** `refactor(core): make the game's node pool editable`.

### Task 3: Primitive operations and their inverses

**Files:**
- Create: `crates/aji-core/src/game/edit.rs`
- Modify: `crates/aji-core/src/game/mod.rs`, `record.rs` (the `Op` applier)
- Test: in `edit.rs`

**Interfaces:**
- Produces:
  - `pub enum Op`:
    - `Attach { node: NodeId, parent: NodeId, index: usize }`;
    - `Detach { node: NodeId }`;
    - `SetProps { node: NodeId, props: Vec<SgfProp> }`;
    - `SetTryout { node: NodeId, on: bool }`;
    - `SetRoot { node: NodeId }`;
    - `Reorder { parent: NodeId, children: Vec<NodeId> }`.
  - `Game::alloc(&mut self, props: Vec<SgfProp>, tryout: bool) -> NodeId`: a new detached node. Allocation is not an operation; detached nodes are invisible.
  - `Game::apply_op(&mut self, op: &Op) -> Op`: applies `op`, invalidates what it touched, and returns the inverse.
  - `pub struct Change { pub forward: Vec<Op>, pub inverse: Vec<Op>, pub focus: NodeId }`. `inverse` is in the order to apply it.
  - `Game::undo(&mut self, change: &Change)` and `Game::redo(&mut self, change: &Change)`.
  - `Game::release(&mut self, nodes: &[NodeId])`: empties detached nodes that no history entry can reach again.

- [x] **Step 1: Write the failing tests:**
  - `each_op_then_its_inverse_is_identity` (for every variant, on a fixture with variations)
  - `undo_restores_odd_records_byte_for_byte` (Review Focus 1: the odd-node fixture, a random sequence of 200 ops from a seeded generator, undone in reverse; `write_sgf(to_sgf)` equals the original)
  - `redo_after_undo_equals_the_first_application`
  - `ids_survive_undo_and_redo`
- [x] **Step 2: Run** `cargo test -p aji-core edit`. Expected: FAIL.
- [x] **Step 3: Implement** `Op`, `alloc`, `apply_op`, `undo`, `redo` and `release`.
- [x] **Step 4: Run** `cargo test -p aji-core`. Expected: PASS.
- [x] **Step 5: Commit** `feat(core): apply and invert primitive record operations`.

### Task 4: Record edits

**Files:**
- Modify: `crates/aji-core/src/game/edit.rs`
- Test: in `edit.rs`

**Interfaces:**
- Consumes: Task 3's `Op`, `Change`, `alloc`, `apply_op`.
- Produces:
  - `pub enum Mark { Triangle, Square, Circle, Cross, Label(String) }`, with serde and TS. These are `TR`, `SQ`, `CR`, `MA`, and `LB` as `pt:text`.
  - `pub enum InfoField { Black, White, BlackRank, WhiteRank, Result, Date, Event, Round, Place, GameName }`, with serde and TS. These map to `PB`, `PW`, `BR`, `WR`, `RE`, `DT`, `EV`, `RO`, `PC` and `GN`.
  - `pub enum Edit`:
    - `Play { at: NodeId, color: Color, mv: Move, tryout: bool }`;
    - `InsertMove { at: NodeId, color: Color, mv: Move }`;
    - `Delete { node: NodeId }`;
    - `Promote { node: NodeId }`;
    - `MoveUp { node: NodeId }`;
    - `SetComment { node: NodeId, text: Option<String> }`;
    - `SetMark { node: NodeId, point: Point, mark: Option<Mark> }`;
    - `ClearMarks { node: NodeId }`;
    - `SetupStone { at: NodeId, point: Point, stone: Option<Color> }`;
    - `MoveStone { at: NodeId, from: Point, to: Point }`;
    - `SetToPlay { at: NodeId, color: Color }`;
    - `Flatten { at: NodeId }`;
    - `SetInfo { field: InfoField, value: Option<String> }`;
    - `KeepTryout { node: NodeId }`;
    - `DropTryout`.
  - `pub enum EditError { Illegal(Illegal), NoSuchNode, NotTryout }`.
  - `Game::edit(&mut self, edit: &Edit) -> Result<Change, EditError>`.
  - `Game::marks(&self, node: NodeId) -> Vec<(Point, Mark)>`.
  - `Game::comment(&self, node: NodeId) -> Option<&str>`.
  - `Game::placed_by(&self, node: NodeId) -> Vec<Placed>`, with `pub struct Placed { pub point: Point, pub node: NodeId, pub number: u32, pub branch_number: Option<u32> }`.
    - It lists every stone on `node`'s board that a move on `path_to(node)` placed, with that move's node and number.
    - `branch_number` counts from the first move of the variation `node` is in (its nearest ancestor-or-self that is not a first child). Stones placed before that move have `None`.
    - It serves 回到这一手 (5.6) and move numbers (5.12).
- **Rules each edit follows** (design 5.3, 5.4, 5.6, 5.8, 5.9):
  - **Play:**
    - enters an existing child with the same colour and move, as `Change` with no ops and `focus` that child;
    - otherwise it is refused with `Illegal` if the move is illegal on the node's board, under today's fixed rules (simple ko, no suicide);
    - otherwise it appends a new child.
  - **InsertMove** attaches a new node between `at` and all its children.
  - **Delete** detaches the node.
  - **Promote** reorders every ancestor's children so the node's path comes first.
  - **MoveUp** swaps the node with its previous sibling.
  - **Setup at a node with `B`/`W`** allocates a child setup node and focuses it. Otherwise it edits `AB`/`AW`/`AE` in place: `AE` when the parent's board had the stone, else removal from `AB`/`AW`.
  - **SetMark:** one mark per point; `None` removes it.
  - **Flatten:**
    - allocates a new root with the board as `AB`/`AW`, `PL`, and the old root's properties other than moves, setup and `PL`;
    - attaches `at`'s children to it in order, and sets it as root.
  - **KeepTryout** clears the try-out flag on the path from the first try-out ancestor to `node`, and on `node`'s whole subtree.
  - **DropTryout** detaches every try-out node whose parent is kept.

- [x] **Step 1: Write the failing tests**, one per rule above:
  - `play_enters_a_matching_child`
  - `play_appends_a_new_variation`
  - `play_refuses_an_occupied_point_and_a_suicide`
  - `insert_keeps_the_rest_of_the_line_and_flags_new_illegal_moves`
  - `promote_makes_the_path_the_main_line`
  - `move_up_swaps_letters`
  - `setup_on_a_move_node_starts_a_variation`
  - `setup_on_a_setup_node_edits_in_place`
  - `remove_uses_ae_or_drops_from_ab`
  - `move_stone_is_ae_plus_ab`
  - `one_mark_per_point`
  - `labels_round_trip_lb`
  - `flatten_keeps_info_and_continuations`
  - `keep_tryout_keeps_path_and_subtree_only`
  - `drop_tryout_detaches_tryout_tops`
  - `placed_by_names_each_stones_move_and_branch_number`
  - `every_edit_undoes_exactly` (each edit on the odd-node fixture; undo; SGF byte-identical)
- [x] **Step 2: Run** `cargo test -p aji-core edit`. Expected: FAIL.
- [x] **Step 3: Implement** `Game::edit` by compiling each edit to `Op`s, plus the three queries.
- [x] **Step 4: Run** `cargo test -p aji-core`. Expected: PASS.
- [x] **Step 5: Commit** `feat(core): edit records: moves, variations, comments, marks, setup and info`.

### Task 5: The session's current line and navigation

**Files:**
- Modify: `src-tauri/src/game.rs`
- Test: in `game.rs`

**Interfaces:**
- Consumes: Task 2's `line_through`, `path_to`, `children`.
- Produces:
  - `GameSession` replaces `index: usize` with `current: NodeId` and `tip: NodeId` (5.3).
  - `GameSession::current_line(&self) -> Vec<NodeId>`: `line_through(tip)`.
  - `GameSession::line_index(&self) -> usize`: `current`'s index in it.
  - `NavTarget` gains:
    - `Node(u32)`;
    - `PreviousSibling`, `NextSibling`;
    - `BranchPoint`;
    - `MainLine`.

    `First`, `Last`, `Previous`, `Next` and `Move(n)` follow the current line.
  - **The tip's rules (design 5.3):**
    - `Node(n)` sets `tip = n` when `n` is off the current line; the siblings and `MainLine` do the same with their target.
    - Line moves keep the tip.
    - `GameSession::retip_after_detach(&mut self)` moves the tip to the deepest attached node of the old line, and `current` to its deepest attached ancestor.
  - `GameSession.line_revision: u64` increases when `current_line()` changes.
  - `LineNode` gains `node: NodeId`. `line()` returns the current line.
  - `next_move` skips nodes that only set `PL` or comments, and stops at a node that changes the board without a move (M7 minor 6).
  - `GameSession::open_at_end(&mut self)` (5.12).
  - `GameSession::trim()` runs after each navigation with the current path.

- [x] **Step 1: Write the failing tests:**
  - `going_back_before_a_branch_keeps_the_variation`
  - `next_after_the_branch_point_returns_into_the_variation`
  - `entering_another_node_moves_the_tip`
  - `siblings_switch_continuations_of_the_previous_move`
  - `branch_point_and_main_line_targets`
  - `move_n_follows_the_current_line`
  - `line_revision_changes_only_with_the_line`
  - `next_move_skips_pl_only_nodes` (M7 minor 6)
- [x] **Step 2: Run** `cargo test -p aji game::tests`. Expected: FAIL.
- [x] **Step 3: Implement.** Today's tests that used `index` now go through `line_index()`.
- [x] **Step 4: Run** `cargo test --workspace`. Expected: PASS.
- [x] **Step 5: Commit** `feat: follow the line the user is on through the tree`.

### Task 6: History, unsaved changes and try-out in the session

**Files:**
- Create: `src-tauri/src/history.rs`
- Modify: `src-tauri/src/game.rs`, `src-tauri/src/lib.rs` (module)
- Test: in `history.rs` and `game.rs`

**Interfaces:**
- Consumes: Task 4's `Edit`, `Change`, `Game::edit`, `undo`, `redo`, `release`; Task 5's tip rules.
- Produces:
  - `pub enum EntryKind { Record(Change), Rules { before: AnalysisRules, after: AnalysisRules } }`.
  - `pub struct Entry { pub id: u64, pub kind: EntryKind, pub kept: bool, pub before: Spot, pub after: Spot }`, with `pub struct Spot { pub current: NodeId, pub tip: NodeId, pub tryout: Option<NodeId> }`.
  - `pub struct History`:
    - `push(&mut self, kind: EntryKind, kept: bool, before: Spot, after: Spot) -> Vec<Entry>`, which drops the redo entries and anything past 1000 and returns them for release;
    - `undo(&mut self) -> Option<&Entry>`, `redo(&mut self) -> Option<&Entry>`;
    - `last_kept(&self) -> u64` (0 when none is applied);
    - `mark_saved(&mut self, id: u64)`;
    - `changed(&self) -> bool`: `last_kept() != saved`.
  - `pub enum SessionEdit`, the protocol's edit:
    - `Play { mv: Move }`, `Pass`, `InsertMove { color: Color, mv: Move }`;
    - `DeleteBranch { node: u32 }`, `DeleteFrom { node: u32 }`;
    - `Promote { node: u32 }`, `MoveUp { node: u32 }`;
    - `SetComment { node: u32, text: Option<String> }`;
    - `SetMark { node: u32, point: Point, mark: Option<Mark> }`, `ClearMarks { node: u32 }`;
    - `SetupStone { point: Point, stone: Option<Color> }`, `MoveStone { from: Point, to: Point }`, `SetToPlay { color: Color }`;
    - `Flatten`;
    - `SetInfo { field: InfoField, value: Option<String> }`;
    - `SetRules { rules: Option<AnalysisRules> }`;
    - `TryoutStart`, `TryoutEnd`, `TryoutKeep { node: u32 }`.

    It is serde-tagged `kind`, camelCase, with TS.
  - `pub enum Refusal { Illegal(Illegal), EndTryoutFirst, NoSuchNode }`.
  - `GameSession::edit(&mut self, edit: SessionEdit) -> Result<bool, Refusal>`, plus `undo(&mut self) -> bool`, `redo(&mut self) -> bool`, `changed(&self) -> bool`, `last_kept(&self) -> u64` and `mark_saved(&mut self, id: u64)`.
  - **The session's rules (5.2, 5.4, 5.6):**
    - The colour for `Play` is the current node's player to move. `Pass` plays `Move::Pass`.
    - `DeleteBranch` deletes the nearest ancestor-or-self that is not its parent's first child, and is refused on the main line. `DeleteFrom` deletes the node.
    - `Promote` and `MoveUp` act on that same variation start.
    - While `tryout` is `Some`:
      - only `Play` (a try-out node), `SetComment` and `DeleteFrom` on a try-out node, `TryoutKeep` and `TryoutEnd` are accepted;
      - everything else is `EndTryoutFirst`;
      - entries are not kept, except `TryoutKeep`.
    - `TryoutStart` is a history entry of its own, not kept, with no record ops: undoing it turns try-out off, and redoing it on. So undo walks back through the try-out moves, then the start, then the kept edits before it.
    - `TryoutEnd` is `DropTryout`, and goes back to the start. Undoing it restores `tryout`.
    - **An edit that changes nothing is not an entry.** A `Play` that enters an existing child, a comment, mark, info field or rules value set to what it already is: the session moves `current` as needed and pushes nothing. So stepping into the record's next move by clicking it never marks the game changed.
    - `SetRules` is `EntryKind::Rules`, kept, and refused during try-out.
    - Undo and redo restore `before` and `after`. The tip after undo is `before.tip`.
    - Opening and new clear the history; try-out ends silently.

- [x] **Step 1: Write the failing tests:**
  - `changed_follows_the_last_kept_edit`
  - `undo_to_the_saved_edit_clears_changed`
  - `a_dropped_redo_past_the_save_stays_changed`
  - `tryout_entries_never_change_changed`
  - `keep_tryout_is_a_kept_edit`
  - `kept_edits_are_refused_during_tryout`
  - `undo_of_tryout_end_restores_the_tryout`
  - `undo_lands_on_the_node_before_the_edit` (including a delete of the current node's subtree)
  - `history_holds_1000_entries`
  - `delete_branch_removes_from_the_variation_start`
  - `rules_edits_undo`
  - `entering_an_existing_move_is_not_a_change`
  - `an_unchanged_comment_or_rules_value_is_not_an_edit`
  - `undo_walks_back_through_the_tryout_start`
- [x] **Step 2: Run** `cargo test -p aji history game::tests`. Expected: FAIL.
- [x] **Step 3: Implement.** Entries dropped by `push` are passed to `Game::release` for nodes that are detached.
- [x] **Step 4: Run** `cargo test --workspace`. Expected: PASS.
- [x] **Step 5: Commit** `feat: undo and redo every edit, with try-out and the unsaved mark`.

### Task 7: Protocol and service for editing, the tree and the snapshot

**Files:**
- Modify:
  - `src-tauri/src/protocol.rs`;
  - `src-tauri/src/service.rs`: the handlers, events, rules edit stopping the job, open at end;
  - `src-tauri/src/game.rs`: `snapshot()`, `tree()`.
- Test: in `protocol.rs`, `service.rs`, `game.rs`
- Generated: `src/transport/generated/*`
- Callers: `src/dev/fakeGame.ts` (fills the new snapshot fields with its one-line game, answers `gameEdit { setRules }` as `gameSetRules` did, and `gameTree` with its line), `src/game/testing.ts` and the snapshot fixtures, `src/game/actions.ts` `setRules`, and every reader of `mainLineLength`.

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces:
  - **`Request`** gains:
    - `GameEdit { edit: SessionEdit }`;
    - `GameUndo`, `GameRedo`;
    - `GameTree`;
    - `GameSaved { edit_id: u64, utf8: bool }` (Task 8 uses `utf8`).

    `GameExport` becomes `GameExport { options: ExportOptions }` (Task 8). `GameSetRules` is removed; its callers send `GameEdit { SetRules }`.
  - **`Response`** gains `GameTree(GameTree)`. Edits, undo and redo answer `Response::Game` (snapshot and warnings), as navigation does.
  - **`AppEvent`** gains `GameTree { tree: GameTree }`, sent when `tree_revision` changes.
  - **`GameTree`**: `{ revision: u64, nodes: Vec<TreeNode> }`.
    - `TreeNode` is `{ id: u32, parent: Option<u32>, color: Option<Color>, mv: Option<Move>, flags: u8 }`, in depth-first preorder; children's order is their order in the list. `mv` gives the node menu its title (第 39 手 黑 O12).
    - Flags: `COMMENT = 1`, `TRYOUT = 2`, `NO_MOVE = 4`, `ILLEGAL = 8`.
  - **`GameSnapshot`:**
    - `main_line_length` becomes `line_length`; `line_index` is the index in the current line;
    - it gains `node: u32`, `line_revision`, `tree_revision`;
    - `comment: Option<String>`;
    - `marks: Vec<MarkAt>` with `MarkAt { point: Point, mark: Mark }`;
    - `continuations: Vec<Continuation>` with `Continuation { node: u32, mv: Option<Move>, tryout: bool }`;
    - `tryout: Option<u32>`;
    - `changed: bool`, `can_undo: bool`, `can_redo: bool`;
    - `save_as_first: bool` (5.13: true after a `Truncated` or `Repaired` open, until the first save);
    - `placed: Vec<Placed>`, from Task 4's `placed_by(current)`, with `node` as `u32`.
  - **`ErrorCode`** gains `GameIllegalMove`, `GameEndTryoutFirst` and `GameNoSuchNode`. The error's `detail` carries the `Illegal` reason for `GameIllegalMove`.
  - **The service:**
    - a `SetRules` edit, or an undo or redo of one, stops the job as M2's rules change did;
    - a change of `line_revision` pushes `GameTrend` for the new line.
  - **Open at end:** `GameOpen` gains `at_end: bool`.

- [x] **Step 1: Write the failing tests:**
  - `api_shapes_match_the_protocol` (extended: every new request, response, event and snapshot field)
  - `edit_undo_redo_answer_with_snapshots`
  - `tree_event_only_on_structure_changes` (navigating sends none; a comment sends one, since `COMMENT` changed)
  - `tree_payload_for_ten_thousand_nodes_is_fast` (under 100 ms in release; marked `#[ignore]` in debug, run in Step 4 with `--release --ignored`)
  - `rules_edit_stops_the_job`
  - `an_illegal_move_is_refused_with_its_reason`
  - `open_at_end_lands_on_the_last_move`
- [x] **Step 2: Run** `cargo test -p aji`. Expected: FAIL.
- [x] **Step 3: Implement**, and regenerate the bindings.
- [x] **Step 4: Run** `cargo test --workspace`, `cargo test -p aji --release -- --ignored tree_payload`, `pnpm typecheck` and `pnpm test`. Expected: PASS, with the callers fixed.
- [x] **Step 5: Commit** `feat: edit, undo and the tree over the protocol`.

### Task 8: Export, save handshake, `LZ` on branches and encodings

**Files:**
- Create: `crates/aji-core/src/sgf/encode.rs`
- Modify:
  - `crates/aji-core/src/sgf/mod.rs`;
  - `src-tauri/src/game.rs`: the source encoding, `export`;
  - `src-tauri/src/lizzie.rs` and `service.rs`: `LZ` per node, `CacheClear::Game` over the tree;
  - `src-tauri/src/protocol.rs`.
- Test: in each
- Callers: `src/transport/api.ts` `exportGame(t, options)` and `src/game/actions.ts` `saveAs` (sends `{ scope: 'game', clean: false, inPlace: false }` and writes `text` as today), and `src/dev/fakeGame.ts`.

**Interfaces:**
- Produces:
  - `pub struct Encoded { pub bytes: Vec<u8>, pub fell_back: bool }`.
  - `pub fn encode_sgf(games: &[SgfTree], encoding: &str, ca: Option<&str>) -> Encoded`.
    - It writes with `CA` set to `ca`, or none, and encodes with `encoding_rs`.
    - If any character does not fit, it writes again with `CA[UTF-8]` as UTF-8, and `fell_back` is true.
  - `GameSession` keeps `source: Source`, where `Source { encoding: &'static str, ca: Option<String>, needs_save_as: bool }`, from `decode` and the open warnings. A new game's source is UTF-8 with `CA[UTF-8]`.
  - **After a save the source is what was written.** A Save As (`GameSaved` after an export with `in_place: false`) or a fallback to UTF-8 sets the source to UTF-8 with `CA[UTF-8]`. So the next ⌘S writes UTF-8, with no repeated notice.
  - `GameSaved { edit_id, utf8: bool }` carries which it was.
  - `pub struct ExportOptions { pub scope: ExportScope, pub clean: bool, pub in_place: bool }`, with `ExportScope { Game, Branch }`.
    - `Branch` writes `path_to(current)` and the current line after it.
    - `clean` drops `C` and every `LZ`/`LZOP`.
    - `in_place` encodes in the source's encoding (5.13).
  - `Response::GameExport { name: String, text: Option<String>, bytes: Option<String>, fell_back: bool, edit_id: u64 }`. `bytes` (base64) is set when `in_place`; otherwise `text`.
  - `GameSaved { edit_id }` calls `mark_saved(edit_id)` and clears `save_as_first`. It is only sent after `Game` scope saves.
  - `LZ` and `LZOP`:
    - are imported for every attached node on open;
    - are written for every node with a cached result when the setting is on;
    - `GameSession::lizzie()` and `export_with` take a `HashMap<NodeId, String>`.
  - Backlog M6 minor 9: export no longer refuses a game without moves. `GameEmpty` stays for an empty record with no properties beyond the defaults.

- [x] **Step 1: Write the failing tests:**
  - `gbk_values_round_trip_in_place` (a Fox GBK fixture without `CA`, opened and saved in place unchanged: every property value's bytes, and `CA`'s absence, are as in the original. `write_sgf` may change layout and add `FF` and `GM`, so whole files are not compared.)
  - `a_wrong_guess_still_round_trips_values` (short GBK fixtures that `decode` reads as EUC-KR without replacement: their property values' bytes come back)
  - `the_source_is_utf8_after_save_as_or_a_fallback`
  - `unencodable_text_falls_back_to_utf8` (`fell_back`, `CA[UTF-8]`)
  - `branch_export_writes_the_path_and_the_line`
  - `clean_export_has_no_comments_or_analysis`
  - `an_edit_after_export_stays_unsaved` (Review Focus 3: export with id 7, edit, `gameSaved(7)`, `changed` true)
  - `lz_on_branch_nodes_round_trips`
  - `clear_game_clears_every_node`
  - `a_header_only_game_saves` (M6 minor 9)
- [x] **Step 2: Run** `cargo test --workspace`. Expected: FAIL.
- [x] **Step 3: Implement.** If `a_wrong_guess_still_round_trips_values` cannot pass for real fixtures (GBK is decoded as GB18030, EUC-KR as windows-949), stop and report: design 5.13's claim does not hold, guessed files go to Save As first (`needs_save_as` true for `EncodingGuessed`), and the owner is told before the task continues.
- [x] **Step 4: Run** `cargo test --workspace`, `pnpm typecheck` and `pnpm test`. Expected: PASS.
- [x] **Step 5: Commit** `feat: save in the file's encoding, save branches and clean records, and keep analysis on branches`.

### Task 9: Whole-game analysis of all branches, and the trend by line

**Files:**
- Modify: `src-tauri/src/job.rs`, `src-tauri/src/follow.rs`, `src-tauri/src/service.rs`
- Test: in each
- Callers: `src/job/jobStore.ts`, `src/panel/CoverageStrip.tsx` (maps keys to slots by the trend's keys, which Task 10 then tests further) and `src/dev/fakeJob.ts`.

**Interfaces:**
- Consumes: Task 5's `line()` with `node`; Task 7's `line_revision`.
- Produces:
  - `pub enum JobScope { Line, AllBranches }`, with serde and TS. `JobOptions` gains `#[serde(default)] scope: JobScope`, defaulting to `Line`, so the stored M2 options read unchanged.
  - `pub fn plan_tree_pass(session_nodes: &[LineNode], options: &JobOptions, current: PositionKey) -> Vec<JobItem>`: every attached kept node in depth-first order, de-duplicated by key, the current position first. Range and side apply by each node's move number and mover.
  - `GameSession::tree_line_nodes(&self) -> Vec<LineNode>`: every attached kept node (no try-out).
  - `JobProgress.working: Option<PositionKey>` and `queued: Vec<PositionKey>` (5.14).
  - **`follow.rs`'s `TrendLine`:**
    - is rebuilt from `session.line()` whenever `line_revision` changes;
    - takes results by key from the cache;
    - `TrendNodes { revision }` carries `line_revision`.
  - **Losses** come from the current line's previous node (`line_losses` as today, on that line).
  - **The job's plan** is never re-planned by edits. A `SetRules` stops it (Task 7).

- [x] **Step 1: Write the failing tests:**
  - `all_branches_plans_every_kept_node_once`
  - `tryout_nodes_are_never_planned`
  - `range_and_side_apply_to_branches`
  - `trend_follows_the_new_line_after_entering_a_variation`
  - `edits_do_not_stop_the_job_but_rules_do` (Review Focus 2)
  - `progress_names_keys`
  - `old_job_options_read_with_line_scope`
- [x] **Step 2: Run** `cargo test -p aji job follow service`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `cargo test --workspace`, `pnpm typecheck` and `pnpm test`. Expected: PASS.
- [x] **Step 5: Commit** `feat: analyse every branch, and follow the current line in the trend`.

### Task 10: Interface transport, stores and commands

**Files:**
- Create: `src/game/treeStore.ts`, `src/game/useTreeSync.ts`, `src/game/editActions.ts`, `src/edit/modeStore.ts`
- Modify:
  - `src/transport/api.ts`;
  - `src/game/gameStore.ts`, `src/game/useGameSync.ts`;
  - `src/commands/registry.ts`, `builtins.ts`, `keymap.ts`;
  - `src/analysis/trendStore.ts`, `useTrendSync.ts` (`lineRevision`);
  - `src/job/*` (keys in progress, `scope`);
  - `src/panel/CoverageStrip.tsx`;
  - `src/locales/*.json`.
- Test: beside each

**Interfaces:**
- Consumes: Tasks 7 to 9's generated types.
- Produces:
  - `api.ts`:
    - `editGame(t: Transport, edit: SessionEdit): Promise<GameReply>`;
    - `undoGame(t)`, `redoGame(t)`;
    - `getGameTree(t): Promise<GameTree>`;
    - `markSaved(t, editId: number, utf8: boolean)`;
    - `exportGame(t, options: ExportOptions)`.
  - `useTreeStore`: `{ tree: GameTree | null; apply(tree: GameTree): void }`. `useTreeSync` fetches when `snapshot.treeRevision` is newer than the store's, and applies `gameTree` events.
  - `editActions.ts`: `edit(ctx: ActionContext, e: SessionEdit): Promise<boolean>`, `undo(ctx)` and `redo(ctx)`.
    - A refusal shows a notice: `notice.illegalMove.<reason>`, `notice.endTryoutFirst` (先结束试下), or `notice.noSuchNode`.
  - `useModeStore`:
    - `{ mode: 'normal' | 'markup' | 'setup'; markupTool: MarkupTool; setupTool: SetupTool; setMode(m); toggle(m) }`;
    - `MarkupTool = 'triangle' | 'square' | 'circle' | 'cross' | 'letter' | 'number' | 'freehand'`;
    - `SetupTool = 'black' | 'white' | 'alternate' | 'insert'`.

    Try-out comes from `snapshot.tryout`. Entering markup or setup while it is set does nothing.
  - **Command ids** added to `CommandId`:
    - `edit.undo`, `edit.redo`, `edit.tryout`, `edit.deleteFrom`;
    - `nav.previousSibling`, `nav.nextSibling`, `nav.mainLine`, `nav.escape`;
    - `file.save`, `file.saveBranch`, `file.saveClean`;
    - `view.rotateCw`, `view.rotateCcw`, `view.flipH`, `view.flipV`, `view.resetOrientation`, `view.moveNumbers`;
    - `replay.toggle`.
  - **Default keys:**
    - `Mod+Z` undo; `Shift+Mod+Z` redo, plus `Mod+Y` off macOS;
    - `V` try-out;
    - `Delete` and `Backspace` delete from here;
    - `[` and `]` siblings;
    - `B` main line;
    - `Escape` the Esc chain;
    - `N` move numbers;
    - `Mod+S` save (off macOS; the native menu owns it on macOS).
  - **`nav.escape`** runs design 5.15's order:
    - the open menu, popover and comment field handle Esc themselves first;
    - then the mode off;
    - then `tryoutEnd`;
    - then `BranchPoint`.
  - **`CoverageStrip`** maps progress keys to the trend's slots by each slot's key.
  - **`JobPanel`** (M2's 分析全局… panel) gains a segmented 当前路线 or 所有分支 control for `scope`, kept with the other remembered job options.
  - **`useTrendSync`** drops `trendNodes` whose `revision` is not the trend store's `lineRevision`.

- [x] **Step 1: Write the failing tests:**
  - `editActions shows the refusal notice`
  - `useTreeSync fetches on a newer treeRevision only`
  - `keymap binds the new keys` (both OS kinds)
  - `escape runs the chain in order`
  - `markup and setup cannot start during try-out`
  - `stale_trend_updates_are_dropped` (Review Focus 2)
  - `coverage strip maps keys to slots`
  - `job panel sends the chosen scope`
- [x] **Step 2: Run** `pnpm test src/game src/commands src/edit src/analysis src/job src/panel/CoverageStrip`. Expected: FAIL.
- [x] **Step 3: Implement**, with `zh-CN` and `en` strings for the commands and notices.
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [x] **Step 5: Commit** `feat: send edits, follow the tree and bind the editing keys`.

### Task 11: The browser fake's tree

**Files:**
- Create: `src/dev/fakeTree.ts`
- Modify: `src/dev/fakeGame.ts`, `src/platform/fakeFiles.ts` (`save`), `docs/development.md`
- Test: `src/dev/fakeTree.test.ts`, `src/dev/scenarios.test.tsx`

**Interfaces:**
- Consumes: the generated protocol types.
- Produces:
  - `createFakeTree(size: number, moves: Move[])`, returning:
    - `play(mv)`, `edit(e: SessionEdit)`, `undo()`, `redo()`, `navigate(to)`;
    - `snapshot()`, `tree(): GameTree`, `line()`, `exportText()`.

    It supports moves and variations with captures, the tip, try-out, comments, marks, setup stones, `PL`, game information, the unsaved mark and the save handshake. Undo stores whole copies; the fake's records are small.
  - `fakeGame.ts` answers `gameEdit`, `gameUndo`, `gameRedo`, `gameTree`, `gameSaved` and the new `gameExport`.
  - `development.md` says what the fake does not do: ko beyond simple ko, insert, flatten and analysis of branches.

- [x] **Step 1: Write the failing tests:**
  - `fake plays variations and undoes them`
  - `fake try-out ends in one step`
  - `fake save handshake clears changed`
  - `scenario game edits through the transport`
- [x] **Step 2: Run** `pnpm test src/dev`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm test`. Expected: PASS.
- [x] **Step 5: Commit** `feat(dev): edit records in the browser fake`.

### Task 12: Playing on the board, the edit row, badges and board menus

**Files:**
- Create: `src/edit/EditRow.tsx`, `src/edit/BoardMenu.tsx`, `src/board/badges.ts`
- Modify:
  - `src/panel/HeaderPanel.tsx`: the row under the header, and 试下中 and 已修改 tags;
  - `src/board/BoardCanvas.tsx`, `drawBoard.ts`, `useBoardGestures.ts`: long press;
  - `src/layout/MainBoard.tsx`, `src/layout/NarrowFrame.tsx`: the row under the board;
  - `src/game/title.ts`: the window title mark;
  - locales.
- Test: beside each, and `src/board/screenshots.test.ts`

**Interfaces:**
- Consumes: Task 10's `edit`, `useModeStore`, the snapshot's `continuations`, `tryout`, `changed`, `canUndo`, `canRedo`.
- Produces:
  - **`BoardCanvas` props:**
    - `onClickPoint?(point: Point): void`, for a primary click or tap on an intersection that no disc claims;
    - `onContextPoint?(point: Point, at: { x: number; y: number }): void`, for a right-click or long press;
    - `badges?: ReadonlyArray<{ point: Point; letter: string; tryout: boolean; outlined: boolean }>`, drawn as interface design 5.4 says, amber when `tryout`;
    - `tryoutNumbers?: ReadonlyArray<{ point: Point; n: number }>`, drawn with a dashed amber ring.
  - **`useBoardGestures`** gains `longPress(x, y)`: 500 ms without moving beyond 10 px (M1's tap thresholds).
  - **`badgesFor(continuations, candidates): Badge[]`** in `src/board/badges.ts`. Letters are A, B, C in `continuations` order; `outlined` when no candidate is on that point.
  - **`EditRow`:** buttons 试下, 标记 and 摆子 (toggle modes, disabled per Task 10), then undo and redo (disabled by `canUndo` and `canRedo`). It holds 44 px targets in the narrow frame.
  - **`BoardMenu`**, a radix context menu with the items of design 5.6 for a stone, an empty point, and a try-out stone:
    - a stone: 回到这一手 (第 N 手), via `navigate({ node })` with the stone's entry in `snapshot.placed`, and the move-number toggle. A setup stone has no entry, and the item is absent;
    - an empty point: 在这里试下, 停一手, and 标记 ▸;
    - a try-out stone: 结束试下 and 保留为分支.
  - **A click on an empty point in normal mode** sends `play`, or `tryoutStart` then `play` from 在这里试下. A click on a candidate disc does the same at its point. A click on a stone does nothing.
  - **The window title** ends with ` (已修改)` (`title.changed`) when changed. No "·".

- [x] **Step 1: Write the failing tests:**
  - `a click on an empty point plays`
  - `a click on a stone does nothing`
  - `badges letter the continuations, amber for try-out`
  - `long press opens the board menu`
  - `edit row disables markup and setup during try-out`
  - `header shows 试下中 and 已修改`
  - screenshot `badges_and_tryout_numbers`
- [x] **Step 2: Run** `pnpm test src/board src/edit src/panel src/layout`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [x] **Step 5: Commit** `feat: play variations on the board, with the edit row, badges and board menus`.

### Task 13: Markup and freehand

**Files:**
- Create: `src/edit/MarkupTools.tsx`, `src/board/marks.ts`, `src/edit/freehandStore.ts`
- Modify: `src/board/BoardCanvas.tsx`, `drawBoard.ts`, `src/layout/MainBoard.tsx`, locales
- Test: beside each, screenshots

**Interfaces:**
- Consumes: the snapshot's `marks`, Task 10's `edit` and `useModeStore`.
- Produces:
  - `drawMarks(ctx, marks: MarkAt[], geometry, stones)`, in `marks.ts`: ink contrasting with the stone; on an empty point a label sits on a board-coloured disc (round 1 mockup).
  - `nextLabel(marks: MarkAt[], kind: 'letter' | 'number'): string`.
  - `MarkupTools`, the second row: △ □ ○ ✕ A 1 | ✎ | 清除标记. In freehand it shows 清除涂鸦.
  - **In markup mode:**
    - discs hide (pass no candidates), while the table keeps updating;
    - a click sends `setMark` with the tool's mark, or `null` when the same mark is there.
  - **`useFreehandStore`:** `{ strokes: Point2[][]; add; clear }`, cleared on `snapshot.node` change. Strokes are drawn on an overlay canvas, and a touch drag draws instead of swiping while ✎ is on.

- [x] **Step 1: Write the failing tests:**
  - `marks from the file are drawn outside markup mode`
  - `a second click with the same tool removes the mark`
  - `letters and numbers take the next free value`
  - `discs hide while marking`
  - `freehand clears on navigation`
  - screenshot `marks_on_stones_and_empty_points`
- [x] **Step 2: Run** `pnpm test src/board src/edit`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [x] **Step 5: Commit** `feat: mark up the board, and draw freehand`.

### Task 14: Setup mode

**Files:**
- Create: `src/edit/SetupTools.tsx`
- Modify: `src/board/BoardCanvas.tsx` (stone drag), `src/layout/MainBoard.tsx`, `src/edit/BoardMenu.tsx`, locales
- Test: beside each

**Interfaces:**
- Consumes: Task 10's `edit`, `useModeStore`; Task 12's `onContextPoint`.
- Produces:
  - `BoardCanvas` gains `onDragStone?(from: Point, to: Point): void`, active only when passed. It draws a dashed ghost under the pointer, and swipes are off while it is set.
  - `SetupTools`: ● ○ ◐ | 轮到 (toggles `setToPlay`) | 停一手 | 插入一手 (the `insert` tool) | 折叠为新局面.
  - **Clicks:**
    - `black` and `white` send `setupStone` with that colour, or `null` on a stone of that colour;
    - `alternate` alternates, starting with the side to move;
    - `insert` sends `insertMove` with the side to move's colour, then returns to `black`.
  - **Setup's stone menu:** 删除这颗子 and 改为黑子 or 改为白子, then a hint line.
  - Discs hide in setup mode.

- [x] **Step 1: Write the failing tests:**
  - `setup clicks add and remove stones`
  - `alternate starts with the side to move`
  - `drag sends moveStone`
  - `insert sends one insertMove then returns to black`
  - `flatten asks nothing and is undoable from the row` (the undo button enables)
- [x] **Step 2: Run** `pnpm test src/edit src/board`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [x] **Step 5: Commit** `feat: set up positions`.

### Task 15: The variation tree panel and the presets

**Files:**
- Create: `src/tree/layoutTree.ts`, `src/tree/TreePanel.tsx`, `src/tree/NodeMenu.tsx`
- Modify:
  - `src/layout/model.ts`: `PanelKind` gains `tree` and `comments`;
  - `src/layout/registry.tsx`, `presets.ts`, `constants.ts`, `validate.ts`;
  - locales.
- Test: beside each

**Interfaces:**
- Consumes: Task 10's `useTreeStore`, the snapshot's `node`, `continuations`, `tryout`.
- Produces:
  - `layoutTree(tree: GameTree): TreeLayout`, with `TreeLayout { cells: Array<{ id: number; depth: number; lane: number; color: Color | null; flags: number; parent: number | null; moveNumber: number }>; depth: number; lanes: number }`.
    - `depth` is the node's distance from the root.
    - `lane` is the first lane free from the parent's depth on, with the main line in lane 0.
    - It is a pure function, linear in the number of nodes.
  - `visibleCells(layout, window: { from: number; to: number; laneFrom: number; laneTo: number })`.
  - **`TreePanel`** draws an SVG of the visible cells.
    - It runs across when the panel's width is at least its height, otherwise down.
    - It draws the current ring, letter tags for the snapshot's continuations, comment dots, try-out dashes, hollow squares for no-move nodes, and every fifth main-line number.
    - It scrolls to keep the current node in view.
    - Click sends `navigate({ node })`. Right-click or long press opens `NodeMenu`.
  - **`NodeMenu`**:
    - for a kept node: 设为主分支, 上移一位, 删除这个分支, 删除这一手及之后, 编辑评论;
    - for a try-out node: 结束试下 (回到第 N 手), 保留为分支.

    Items are disabled per design 5.6.
  - **Folding:**
    - the registry's `tree` spec folds to zero height when alone and the tree has no variations;
    - as a tab it shows 还没有分支.
  - **Presets (design 5.5):**
    - 默认: tabs(candidates, swings, comments, tree);
    - wide default: record column `split('column', [tabs(tree, comments), subboard 1], [2, 1])`;
    - 经典: tabs(tree, comments) under the trend in the left column;
    - 极简, 思考 and 四盘 are unchanged.

- [x] **Step 1: Write the failing tests:**
  - `layout puts the main line in lane 0 and variations below`
  - `layout_of_ten_thousand_nodes_is_fast` (under 50 ms in Vitest)
  - `tree turns with its panel`
  - `click a node navigates`
  - `node menu disables items on the main line`
  - `presets place tree and comments`
  - `an old layout validates without the new panels`
- [x] **Step 2: Run** `pnpm test src/tree src/layout`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [x] **Step 5: Commit** `feat: show the variation tree`.

### Task 16: The comment panel

**Files:**
- Create: `src/comments/CommentPanel.tsx`
- Modify: `src/layout/registry.tsx`, locales
- Test: `src/comments/CommentPanel.test.tsx`

**Interfaces:**
- Consumes: the snapshot's `comment`, `node`, `moveNumber`, `lastMove`; Task 10's `edit`.
- Produces:
  - `CommentPanel`, as the round 1 mockup draws it. It shows:
    - a heading line (第 38 手 白 N17, or 开局前 on the root);
    - the text;
    - an empty state of 添加评论.
  - **Keeping the text.** On blur, on Esc, or when `snapshot.node` changes while editing, it sends `setComment { node: <the node being edited>, text }` if the text changed. Empty text sends `null`.
  - `requestCommentFocus(node: number)`, which `NodeMenu`'s 编辑评论 calls.

- [x] **Step 1: Write the failing tests:**
  - `blur keeps the comment`
  - `navigating while typing keeps it on the old node`
  - `typing_in_the_comment_never_reaches_the_board` (Review Focus 5: V, B, [, ], N, Delete, Backspace, Esc, ⌘Z typed in the field send no edit or navigation)
  - `edit comment from the node menu focuses the field`
- [x] **Step 2: Run** `pnpm test src/comments`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [x] **Step 5: Commit** `feat: read and write comments`.

### Task 17: Game information, custom rules and new game sizes

**Files:**
- Create: `src/panel/ResultField.tsx`, `src/settings/CustomRulesFields.tsx`
- Modify:
  - `src/panel/GameInfoPopover.tsx`;
  - `src/settings/RulesControl.tsx`;
  - `src/panel/GameMenu.tsx`: 其他路数 ▸ 5 to 18;
  - `src-tauri/src/platform/menu.rs` and `mod.rs`: `MenuAction::New(u8)` replaces `New19`, `New13` and `New9`, with the 其他路数 submenu;
  - `src/scoring/ScoringCard.tsx`: 填入点目结果 hand-off;
  - locales.
- Test: beside each; `menu.rs` tests

**Interfaces:**
- Consumes: Task 10's `edit`; Task 1's `RuleDetails`.
- Produces:
  - `parseResult(re: string | null): { winner: 'black' | 'white' | 'draw' | 'none'; by: { points: number } | 'resign' | 'time' | 'forfeit' | null } | { raw: string }`.
  - `formatResult(...)`: gives `B+2.5`, `W+R`, `B+T`, `B+F`, `0` or `null`.
  - **`GameInfoPopover`:**
    - editable fields send `setInfo` on blur or Enter;
    - the result is two selects plus a margin input, with 填入点目结果 when `useScoringStore` holds a count for this game;
    - the handicap is text only;
    - in the narrow frame it opens as a full sheet (M1's `Sheet`), not a popover.
  - **`CustomRulesFields`:** the segmented controls of the round 2 mockup (计分, 打劫, 自杀, 双活计税, 让子补偿, 按钮), building `details`. Changes send `setRules`, disabled during try-out.
  - **The settings page's default rules** use the same control.
  - **`MenuAction::New(size)`:** ids `new:5` to `new:19`. `from_id` and `id` round-trip, tested.

- [x] **Step 1: Write the failing tests:**
  - `parse and format results round trip`
  - `an unknown RE shows as text`
  - `fill from final scoring writes RE`
  - `custom fields send full details`
  - `rules edits are disabled during try-out`
  - `new_size_ids_round_trip` (Rust)
  - `both_languages_label_the_file_menu` (extended)
- [x] **Step 2: Run** `pnpm test src/panel src/settings src/scoring` and `cargo test -p aji menu`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** all checks. Expected: PASS.
- [x] **Step 5: Commit** `feat: edit the game information and KataGo's full rules`.

### Task 18: Saving, save options and the unsaved-changes prompt

**Files:**
- Modify:
  - `src/platform/files.ts`, `tauriFiles.ts`, `fakeFiles.ts`: `save(token, bytesBase64): Promise<boolean>`;
  - `src-tauri/src/platform/mod.rs`: `files_save` with `write_atomically`; `MenuAction::Save`, `SaveBranch`, `SaveClean`, `Undo`, `Redo`;
  - `src-tauri/src/platform/menu.rs`: 保存, 另存当前分支…, 另存为纯净棋谱…;
  - `src-tauri/src/lib.rs`: the window's `CloseRequested` and the app's `ExitRequested` are held and forwarded as an `app-quit-requested` event; an `app_quit` command exits;
  - `src-tauri/src/platform/mod.rs`: a `confirm_discard` command shows `MessageDialogButtons::YesNoCancelCustom(保存, 不保存, 取消)` (tauri-plugin-dialog 2.8.4 has it, as `confirm_replace` uses `OkCancelCustom`) and answers `"save" | "discard" | "cancel"`;
  - `src/game/actions.ts`: `save`, `saveBranch`, `saveClean`, `confirmDiscard`, and the guards on open, new, drop and recent;
  - `src/game/useGameSync.ts` or a new `src/game/useQuitGuard.ts`;
  - locales.
- Test: beside each; `platform` tests

**Interfaces:**
- Consumes: Task 8's `ExportOptions`, `edit_id`, `bytes`, `fell_back`; the snapshot's `changed` and `saveAsFirst`.
- Produces:
  - **`save(ctx)`:**
    - with a token and not `saveAsFirst`: export `{ scope: 'game', clean: false, inPlace: true }`, then `files.save(token, bytes)`, then `markSaved(editId)`, plus the `fellBack` notice (`notice.savedAsUtf8`);
    - otherwise `saveAs`, which exports with `inPlace: false` and marks saved after the write.

    A failed write shows `notice.saveFailed` and marks nothing.
  - **`saveBranch(ctx)` and `saveClean(ctx)`** are Save As with `scope: 'branch'` or `clean: true`, and never mark saved.
  - **`PlatformFiles.confirmDiscard(): Promise<'save' | 'discard' | 'cancel'>`:** the Rust command on desktop, an in-app dialog in the browser fake. No JavaScript dialog package is added.
  - **`confirmDiscard(ctx): Promise<boolean>`:**
    - when `changed`, it asks `files.confirmDiscard()`;
    - 保存 runs `save`, and answers false if the save failed or was cancelled.
  - **The guards.** Open, new, drop and recent call `confirmDiscard` first. On `app-quit-requested`, `confirmDiscard`, then `invoke('app_quit')`.
  - **Undo and redo in the menu.** The macOS 编辑 menu's 撤销 and 重做 become custom items. When a text field has focus, the interface runs `document.execCommand('undo' | 'redo')`; otherwise the game command. **[To verify]** in Task 21 that text undo works in WKWebView this way.

- [x] **Step 0: Check quitting on macOS first.** In `pnpm tauri dev`, add a temporary `RunEvent::ExitRequested` handler that calls `api.prevent_exit()` and logs. Confirm that ⌘Q and 退出 Aji from the predefined Quit item raise it and can be held. If they do not, replace the predefined Quit with a custom item that sends `MenuAction::Quit`, and route it through the same guard. Remove the temporary log.
- [x] **Step 1: Write the failing tests:**
  - `save in place writes bytes and marks saved`
  - `save without a token is save as`
  - `save_as_first goes to save as once`
  - `a_failed_write_keeps_the_game_changed` (Review Focus 3)
  - `open asks before discarding changes`
  - `quit waits for the answer`
  - `branch and clean saves do not mark saved`
  - `files_save_writes_atomically` (Rust)
  - `undo from the menu goes to a focused text field first`
- [x] **Step 2: Run** `pnpm test src/game src/platform` and `cargo test -p aji platform`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** all checks. Expected: PASS.
- [x] **Step 5: Commit** `feat: save in place, save branches and clean records, and ask before discarding changes`.

### Task 19: View rotation, move numbers, auto-replay and opening at the end

**Files:**
- Create: `src/board/orientation.ts`, `src/board/moveNumbers.ts`, `src/game/replayStore.ts`
- Modify:
  - `src/board/BoardCanvas.tsx`, `drawBoard.ts`, `coordinates.ts`;
  - `src/analysis/viewStore.ts`: orientation;
  - `src/device/deviceSettings.ts` and `migrate.ts`: `moveNumbers`, `autoReplaySeconds`, `openAt`;
  - `src/settings/*`: rows;
  - `src/panel/NavButtons.tsx`, `src/panel/BottomNav.tsx`: ▶;
  - `src-tauri/src/platform/menu.rs`: 显示 → 旋转 ▸ and 手数 ▸;
  - `src/panel/ViewMenu.tsx`;
  - `src/game/actions.ts`: open at end;
  - locales.
- Test: beside each, screenshots

**Interfaces:**
- Produces:
  - `type Orientation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7`, the eight symmetries.
  - `toView(p: Point, size: number, o: Orientation): Point` and `fromView(p: Point, size: number, o: Orientation): Point`.
  - `rotateCw(o)`, `rotateCcw(o)`, `flipH(o)`, `flipV(o)`.
  - The orientation applies to stones, discs, marks, badges, numbers and clicks on the main board and sub-boards. Margin labels move with their lines, so Q16 stays labelled Q16. It resets on open and new.
  - **Device settings:**
    - `moveNumbers: { mode: 'off' | 'all' | 'last'; last: number; restartInBranch: boolean; lastOn: 'all' | 'last' }`, default `{ 'off', 10, false, 'all' }`;
    - `autoReplaySeconds: number`, default 1.5;
    - `openAt: 'first' | 'last'`, default `'first'`.
  - `numbersFor(placed: Placed[], lastMoveNumber: number, settings: MoveNumbers): Array<{ point: Point; n: number }>`, from `snapshot.placed`.
    - `all` numbers every entry; `last` numbers entries whose `number` is above `lastMoveNumber − last`.
    - With `restartInBranch`, `branchNumber` is shown, and entries without one are not numbered.
  - **`useReplayStore`:**
    - `{ playing: boolean; start(); stop() }`, stepping `next` every `autoReplaySeconds`;
    - it stops on any other navigation, edit, board click, or at the line's end.
  - **Opening:** `openAt: 'last'` sends `GameOpen { atEnd: true }`.

- [x] **Step 1: Write the failing tests:**
  - `orientation round trips every point`
  - `rotate then counter-rotate is identity`
  - `clicks map through the orientation`
  - `labels follow their lines`
  - `last N numbers and restart in a branch`
  - `replay stops on navigation and at the end`
  - `open at last sends atEnd`
  - `old device settings migrate with defaults`
  - screenshot `rotated_board_with_numbers`
- [x] **Step 2: Run** `pnpm test src/board src/game src/device`. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** all checks. Expected: PASS.
- [x] **Step 5: Commit** `feat: rotate the view, number the stones and replay the game`.

### Task 20: Backlog items

**Files:**
- Modify: `src/game/notices.ts` (M6 minor 2, 3), `src-tauri/src/platform/menu.rs` and `recent.rs` (M6 minor 5), `src/game/actions.ts` `openDropped` (M6 minor 6), `src/commands/builtins.ts` page commands (M7 minor 5), locales
- Test: beside each

**Interfaces:**
- Produces:
  - **M6 minor 2:** the komiUnreadable detail names the rules actually used (`rules.described.*`).
  - **M6 minor 3:** the encodingGuessed title also covers a declared `CA` that failed.
  - **M6 minor 5:** missing recent files stay enabled in the macOS menu, and a click removes the entry with today's missing-file notice.
  - **M6 minor 6:** a drop opens the first path ending in `.sgf` (any case), else the first path.
  - **M7 minor 5:**
    - PageDown stops at a trailing node with no move (a comment), as `Last` does;
    - held PageUp and PageDown send the next step only after the previous navigation answers.

- [x] **Step 1: Write the failing tests**, one per item:
  - `komi unreadable names the rules used`
  - `encoding title covers a failed CA`
  - `missing_recent_entries_are_enabled` (Rust)
  - `drop opens the first sgf`
  - `page down reaches a trailing comment node`
  - `held page keys do not queue a burst`
- [x] **Step 2: Run** the named tests. Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run** all checks. Expected: PASS.
- [x] **Step 5: Commit** `fix: clear the M6 and M7 backlog items M3 touches`.

### Task 21: Documents, the exit check and the Status

**Files:**
- Modify:
  - `docs/superpowers/specs/2026-11-19-aji-ui-design.md`: sections 4.1, 4.4, 5.4, 6 and 8, per design 12;
  - `docs/superpowers/specs/2026-11-19-aji-project-charter-design.md`: 7.2, 7.3 and 7.10, per design 12;
  - `docs/superpowers/plans/2026-11-21-phase-2-roadmap.md`: P10 and P11 settled, P2-G11 declined to 7.10, M3's status line;
  - `docs/backlog/phase-1-deferred.md`: remove the items Task 20 and Tasks 2, 5 and 9 closed;
  - `docs/development.md`: the editing scenario;
  - this plan's **Status**.

- [x] **Step 1: Edit the documents** as design section 12 lists, with "the maintainer's decision, 2026-11-23" on the 7.10 additions.
- [x] **Step 2: Run a fresh whole-branch review** (superpowers:requesting-code-review). Fix each important finding with a failing test first, folded into the commit it corrects.
- [x] **Step 3: Check the exit on the Mac** (design 9):
  - in `pnpm dev` at 1440 × 900, 375 × 812 and 768 × 1024, both themes, every M3 flow by mouse and by touch;
  - in `pnpm tauri dev`:
    - save in place over a GBK Fox record, and compare its bytes when nothing changed;
    - quit with changes and with only try-out;
    - ⌘Z in the comment field;
    - an all-branches job.
  - Then build `pnpm tauri build --bundles app` for the owner's walk.
  - Open a saved file in Sabaki **[To verify]**, and in LizzieYzy if available.
- [x] **Step 4: Record** the results and anything outstanding in this plan's **Status**, as M2's does.
- [x] **Step 5: Commit** `docs: record Phase 2 M3`.
