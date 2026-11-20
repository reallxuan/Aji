# M6 Game Records and Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open SGF game records of any common origin (pro archives, Fox GBK exports, damaged files), draw them with realistic stones, step through them with the header, keyboard and wheel while KataGo analyses the current position under rules and komi the user controls, and save them back as clean UTF-8 SGF that loses nothing.

**Architecture:**
- **`aji-core`, pure Rust.** A new `sgf` module decodes bytes (BOM, UTF-8, declared multi-byte charset, `chardetng` guess), parses into a format-preserving tree with recovery, and writes it back. A new `game` module builds a playable game from that tree: board rules (captures, suicide, simple ko), node flags, the main line, move numbers, analysis rules read from `RU`/`KM`, and `Position`s for KataGo, re-based after mid-game setup or an illegal move. `Position` gains `initial_player`.
- **`aji-engine`.** Sends `initialPlayer`, and gains `clear_position()` so an illegal node holds the engine idle. `EngineStatus.position` becomes optional.
- **`src-tauri`.** A `GameSession` behind `AppContext` serves the `game*` requests and pushes `gameSnapshot` events. Each navigation sends the node's position to the engine. A platform layer (`platform/`, plain Tauri commands outside `rpc`) opens, drops, remembers and saves files and builds the macOS menu. `UiSettings` gains `defaultRules`.
- **Interface.** A game store fed by snapshots; `PlatformFiles` with a Tauri implementation; the live header (game menu, rules chip and game information popover, move counter, navigation with repeat, keyboard, wheel); the notice line; the drop overlay; a stone layer on the board; a rules control shared by the popover and settings.

**Tech Stack:**
- Existing: Tauri 2 (`tauri-plugin-dialog` already a dependency), React 19, Zustand 5, i18next, Tailwind 4, shadcn/ui, Vitest.
- New, Rust: `encoding_rs` ((Apache-2.0 OR MIT) AND BSD-3-Clause) and `chardetng` (Apache-2.0 OR MIT) in `aji-core`; `base64` (MIT OR Apache-2.0) in `src-tauri`; `proptest` (MIT OR Apache-2.0) as an `aji-core` dev-dependency.
- New, TypeScript dev-dependencies: `@napi-rs/canvas` (MIT), `pixelmatch` (ISC), `pngjs` (MIT).

**Spec:** [M6 game records design](../specs/2026-11-21-m6-game-records-design.md), approved by the owner on 2026-11-21, with the mockup [`docs/design/mockups/m6/game-records.html`](../../design/mockups/m6/game-records.html). Section numbers below (5.5 and so on) refer to the design; frame letters (A–G) refer to the mockup.

**Status:** Built on 2026-11-21, except the items under Outstanding.
- **Checks.** Every check passes on the Mac: `cargo fmt --check`, clippy with `-D warnings`, 613 Rust tests, `pnpm lint`, `pnpm typecheck`, 306 TypeScript tests, `cargo deny check licenses`, the npm licence check, the notices staleness check and unchanged generated bindings.
- **Final review.** A fresh review of the whole branch found nothing critical. It found four important issues, and one minor was re-graded as important. Each was fixed with a test that failed first and folded into the commit it corrects:
  - returning to an analysed position dropped its cached analysis, because the engine answered before the interface heard of the position (the snapshot event now goes first);
  - a UTF-8 file with no `CA` that was cut mid-character, or had a stray byte, read as windows-1252;
  - the other games in a saved collection kept `CA[gb2312]` inside a UTF-8 file;
  - moves after a stray `)` were dropped with no warning;
  - save-as could replace an existing `<name>.sgf` that the dialog never asked about (now a native "replace it?" prompt).
  Twelve minor findings are deferred to M7 planning.
- **Mac exit check** with the app from `pnpm tauri build --bundles app` (11.60 MiB):
  - Items 1, 4 and 5 run as automated tests on the fixtures: every good fixture opens and its Chinese names read correctly; a save, reopen and save again is byte-identical; LizzieYzy and unknown properties and the other games of a collection survive; each broken file gives its message, and the truncated one opens with its moves.
  - The header, menus, rules popover, counter, keyboard navigation, notices (frame E), drop overlay (frame F), the illegal-position line and the settings row (frame G) were walked in `pnpm dev` in the browser pane, in light and dark, in Chinese and English, at 1024×700 and 1440×900. The walk found two layout faults, both fixed in Task 11: the title collapsed in a 360 px panel, and the English rules control overflowed its popover.
- **Outstanding.**
  - The native-window items, which are the owner's steps on the built app: item 2 (hold → through a full game while KataGo runs; wheel and trackpad), item 3 (Finder drop; recent after a restart; a moved file shows as missing), item 4's check in another program, item 6 (analysis follows navigation; the illegal fixture), item 7 (high-DPI), and the macOS menu with ⌘N, ⌘O and ⇧⌘S.
  - The PC check, optional until M8.

## Global Constraints

- **Everything from M1 to M5 still holds:** language rules, interface text in both locales, dependency licences, Conventional Commits, crate rules (`aji-core` depends on no workspace crate and does no I/O), and the protocol rules: no file paths in `rpc`; errors are `{ code, message }`; `#[ts(type = "number")]` on every `u64`; camelCase JSON.
- **No git worktrees**, for subagents too. Work in `/Users/zepher/personal/Aji` on `feat/m6-game-records` (from `main` at `dbb1980`; the Windows CI fix `25a8c05` and the design `120c304` are its first two commits). Push only when the owner asks.
- **Every user-visible string goes through i18n**, `zh-CN` and `en` in the same commit. Chinese strings quoted in the design or mockup are the `zh-CN` values; write natural English for `en`. ESLint's i18n rule stays clean, `aria-label`s included.
- **Generated TypeScript types** (`src/transport/generated/`) are regenerated by `cargo test` and committed with the Rust change that made them. New `ErrorCode` values must also be added to `src/i18n/codes.test.ts`.
- **Colours** come from `src/styles/theme.css` tokens. The amber "changed" dot and warning notices use `--score`; error notices use `--engine-error`.
- **Checks before every commit:** `cargo fmt --check`; `cargo clippy --workspace --all-targets -- -D warnings`; `cargo test --workspace`; `pnpm lint`; `pnpm typecheck`; `pnpm test`. A task that adds a dependency also runs `cargo deny check licenses` and `node scripts/check-npm-licenses.mjs`.
- **Values fixed by the design:**
  - Board sizes that open: square 5–19; missing `SZ` is 19.
  - Largest file: 20 MB (`20 * 1024 * 1024` bytes).
  - Recent files: 10, newest first, in `recent.json` in the app config folder.
  - Rules presets: Chinese = area scoring, komi 7.5; Japanese/Korean = territory scoring, komi 6.5; Custom = chosen scoring, komi any multiple of 0.5 in [−150, 150]. KataGo gets `chinese` for area, `japanese` for territory.
  - Default rules setting: Chinese.
  - Fox komi: a komi outside [−150, 150] that is a multiple of 25 is hundredths of a stone, so points = value / 50; `KM[0]` + `HA[0]` (or no `HA`) + `RU[Japanese]` + an `AP` value `foxwq` reads as 6.5.
  - Stone diameter 0.96 of the line spacing; last-move dot diameter 0.22 of the spacing.
  - Warning notices fade after 6 s; error notices stay until closed or replaced.
  - Navigation button repeat: starts after 400 ms, then every 60 ms.
  - Wheel: one move per 50 px of `deltaY` in pixel mode, one per notch in line mode, at most one move per animation frame.
- **Paths:** paths may appear in the desktop platform layer (`src-tauri/src/platform/` and `src/platform/tauriFiles.ts`), never in `Request`, `Response` or `AppEvent`.

## Review Focus

1. **A UTF-8 file with a stale `CA[gb2312]`, and a GBK file labelled `CA[ISO-8859-1]`.** Both read correctly; neither shows mojibake (Task 1 test).
2. **A very deep or very long file**, such as 10 000 nested `(` or a 5 000-move main line. Parsing and writing return without a stack overflow, and arbitrary bytes never panic (Task 2 and Task 5 tests).
3. **Holding → through a 300-move game while KataGo runs.** The board keeps up, the engine always ends on the last position shown, and no request goes out of order (Task 7 test: concurrent `gameNavigate` calls leave the engine on the final node).
4. **A handicap game at move 0, and a problem file with `AB` after move 1.** KataGo gets `initialPlayer: "W"` and an `initialStones` position respectively, never a move list it would reject (Task 4 and Task 6 tests).
5. **Saving a multi-game file or a LizzieYzy-analysed file.** Every other game and every `LZ*` property comes back, and saving the saved file again gives identical bytes (Task 5 test).

---

### Task 1: SGF decoding

**Files:**
- Create: `crates/aji-core/src/sgf/mod.rs`, `crates/aji-core/src/sgf/decode.rs`
- Modify: `crates/aji-core/Cargo.toml` (add `encoding_rs`, `chardetng`), `crates/aji-core/src/lib.rs` (`pub mod sgf;`), `deny.toml` only if a licence expression needs an allow entry
- Test: `crates/aji-core/src/sgf/decode.rs` (unit tests)

**Interfaces:**
- Produces:
  - `pub enum EncodingSource { Bom, Utf8, Declared, Detected }` (derive `Debug, Clone, Copy, PartialEq, Eq`).
  - `pub struct Decoded { pub text: String, pub encoding: &'static str, pub source: EncodingSource, pub replaced: bool }` (`encoding` is the `encoding_rs` name, `replaced` is true when invalid bytes became U+FFFD).
  - `pub fn decode(bytes: &[u8]) -> Decoded`.

- [ ] **Step 1: Write the failing tests** in `decode.rs`. Build GBK bytes in the tests with `encoding_rs::GBK.encode`.
  - `bom_wins`: `b"\xEF\xBB\xBF(;PB[x])"` → source `Bom`, text without the BOM.
  - `valid_utf8_beats_a_stale_declaration`: UTF-8 bytes of `(;CA[gb2312]PB[丁浩])` → `Utf8`, text contains `丁浩`.
  - `declared_gbk_is_used_when_it_decodes`: GBK bytes of `(;CA[GB2312]PB[丁浩]C[打劫])` → `Declared`, encoding `GBK` or `gb18030`, text contains `丁浩`.
  - `undeclared_gbk_is_detected`: GBK bytes of a 30-character Chinese comment with no `CA` → `Detected`, text round-trips.
  - `gbk_mislabelled_latin1_still_reads_as_gbk`: GBK bytes with `CA[ISO-8859-1]` → text contains the Chinese, not mojibake.
  - `shift_jis_and_euc_kr_are_detected`: Japanese names in Shift-JIS and Korean names in EUC-KR, no `CA` → decoded text matches the source string.
  - `trail_byte_5c_survives`: a GBK string whose second byte is `0x5C` (find one in the test by encoding `'一'..='龥'` and picking the first whose encoding ends in `0x5C`), inside `PB[...]` → decoded text contains it intact.
  - `invalid_bytes_are_replaced`: a declared UTF-8 file with one stray `0xFF` and otherwise ASCII → `replaced == true`, text contains `\u{FFFD}`.
- [ ] **Step 2: Run** `cargo test -p aji-core sgf::decode` — fails to compile (`decode` missing).
- [ ] **Step 3: Implement `decode`** in the order of design 5.1: BOM; `std::str::from_utf8`; the first ASCII `CA[` value found by a byte scan, looked up with `encoding_rs::Encoding::for_label`, used if it is not single-byte (`Encoding::is_single_byte()` false) and `decode_without_bom_handling_and_without_replacement` succeeds; else `chardetng::EncodingDetector` (feed all bytes, `guess(None, true)`), mapping GBK to `GB18030` for decoding; a single-byte declaration is used only when the guess is also single-byte.
- [ ] **Step 4: Run** `cargo test -p aji-core sgf::decode` — passes. Run `cargo deny check licenses` — passes.
- [ ] **Step 5: Commit** `feat(core): detect an SGF file's text encoding`.

### Task 2: SGF parsing and writing

**Files:**
- Create: `crates/aji-core/src/sgf/tree.rs`, `crates/aji-core/src/sgf/parse.rs`, `crates/aji-core/src/sgf/write.rs`
- Modify: `crates/aji-core/src/sgf/mod.rs`
- Test: unit tests in `parse.rs` and `write.rs`

**Interfaces:**
- Produces (all `Debug, Clone, PartialEq, Eq`):
  - `pub struct SgfProp { pub id: String, pub values: Vec<String> }` — `id` uppercase only; values unescaped, soft line breaks removed.
  - `pub struct SgfNode { pub props: Vec<SgfProp> }` with `pub fn get(&self, id: &str) -> Option<&SgfProp>` and `pub fn first(&self, id: &str) -> Option<&str>`.
  - `pub struct SgfTree { pub nodes: Vec<SgfNode>, pub variations: Vec<SgfTree> }` — SGF's own shape (a sequence, then child trees), so a long main line is a `Vec`, not a recursion.
  - `pub enum SgfWarning { UnclosedValue, Truncated, Skipped, ExtraGames(usize) }`.
  - `pub enum SgfError { NotAGame }`.
  - `pub struct SgfCollection { pub games: Vec<SgfTree>, pub warnings: Vec<SgfWarning> }`.
  - `pub fn parse_sgf(text: &str) -> Result<SgfCollection, SgfError>`.
  - `pub fn write_sgf(games: &[SgfTree]) -> String`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests.**
  - `skips_text_before_the_game`: `"junk\n<html>(;GM[1];B[pd])"` → one game, two nodes.
  - `lowercase_letters_in_ids_are_dropped`: `(;AddBlack[aa]CoPyright[x])` → ids `AB`, `CP`.
  - `escapes_and_soft_breaks`: `C[a\]b\\c\\\nd]` → value `a]b\cd`.
  - `duplicate_properties_merge`: `(;AP[GNU Go:3.8]  SZ[19]AP[foxwq])` → `AP` values `["GNU Go:3.8", "foxwq"]`, in first position.
  - `unclosed_value_at_eof`: `(;C[abc` → value `abc`, warnings contain `UnclosedValue` and `Truncated`.
  - `missing_parens_close_at_eof`: `(;B[pd];W[dd](;B[pp])(;B[dp]` → main line `pd dd pp`, a second variation `dp`, warning `Truncated`.
  - `two_games`: `(;GN[a])(;GN[b])` → two games, warning `ExtraGames(1)`.
  - `no_game_is_an_error`: `"hello"` and `"()"` → `Err(NotAGame)`.
  - `deep_nesting_does_not_overflow`: `"(;" + "(;".repeat(10_000)` + `")".repeat(10_001)` parses and `write_sgf` returns.
  - `write_escapes_and_layout`: writing a node with value `a]b\` gives `[a\]b\\]`; a 25-move main line has a line break at least every 10 moves; a variation starts on its own line with `(`.
  - `write_then_parse_is_identity`: for the inputs above, `parse_sgf(&write_sgf(&c.games)).games == c.games`.
- [ ] **Step 2: Run** `cargo test -p aji-core sgf` — fails to compile.
- [ ] **Step 3: Implement** `parse_sgf` as a character-level state machine with an explicit stack of open trees (no recursion), and `write_sgf` with an explicit stack too. Recovery follows design 5.1. Merging duplicates keeps the first occurrence's position.
- [ ] **Step 4: Run** `cargo test -p aji-core sgf` — passes.
- [ ] **Step 5: Commit** `feat(core): parse and write SGF with recovery`.

### Task 3: Board rules

**Files:**
- Create: `crates/aji-core/src/game/mod.rs`, `crates/aji-core/src/game/board.rs`
- Modify: `crates/aji-core/src/lib.rs` (`pub mod game;`)
- Test: unit tests in `board.rs`

**Interfaces:**
- Produces:
  - `pub enum Illegal { Occupied, Suicide, Ko }` (derive `Debug, Clone, Copy, PartialEq, Eq, Serialize, TS`, camelCase).
  - `pub struct PlayResult { pub captured: Vec<Point>, pub illegal: Option<Illegal> }`.
  - `pub struct Board` (`Clone`, `PartialEq`) with:
    - `pub fn new(size: BoardSize) -> Board`;
    - `pub fn size(&self) -> BoardSize`;
    - `pub fn get(&self, p: Point) -> Option<Color>`;
    - `pub fn set(&mut self, p: Point, stone: Option<Color>)` (setup; clears the ko point);
    - `pub fn play(&mut self, color: Color, mv: Move, multi_stone_suicide: bool) -> PlayResult`;
    - `pub fn stones(&self) -> Vec<Option<Color>>` (row-major, `y * size + x`);
    - `pub fn captures(&self) -> (u32, u32)` (stones captured by Black, by White).
  - `pub fn expand_points(value: &str, size: BoardSize) -> Vec<Point>` — one SGF point (`"pd"`) or a compressed rectangle (`"aa:cc"`); off-board or malformed gives an empty `Vec`.

- [ ] **Step 1: Write the failing tests.**
  - `captures_a_group`: surround a two-stone white group; the last black move returns both points in `captured`, and `captures()` is `(2, 0)`.
  - `single_stone_suicide_is_illegal`: `illegal == Some(Suicide)`, and the stone is removed again (the board is unchanged).
  - `multi_stone_suicide_when_allowed`: with `multi_stone_suicide: true`, a two-stone suicide removes the player's own stones and is legal.
  - `simple_ko`: capture one stone into a ko; immediate recapture gives `Some(Ko)` and is still played; a recapture after another move elsewhere is legal.
  - `occupied_point_replaces_the_stone`: `illegal == Some(Occupied)`, the point now holds the new colour.
  - `pass_clears_ko`.
  - `expand_points`: `"aa:cc"` on 19 → 9 points; `"cc:aa"` → the same 9; `"tt"` → empty on 19 (pass is handled by the caller); `"zz"` → empty.
- [ ] **Step 2: Run** `cargo test -p aji-core game::board` — fails.
- [ ] **Step 3: Implement** with a flood fill on a `Vec<Option<Color>>`, using an explicit stack.
- [ ] **Step 4: Run** — passes.
- [ ] **Step 5: Commit** `feat(core): board with captures, suicide and simple ko`.

### Task 4: Games, analysis rules and positions

**Files:**
- Create: `crates/aji-core/src/game/rules.rs`, `crates/aji-core/src/game/record.rs`
- Modify: `crates/aji-core/src/position.rs` (add `initial_player`), every `Position { .. }` literal in the workspace (`crates/aji-engine/src/bin/engine-host.rs`, tests), `crates/aji-core/src/game/mod.rs`
- Test: unit tests in `rules.rs` and `record.rs`; key tests in `position.rs`

**Interfaces:**
- Produces:
  - `Position.initial_player: Option<Color>`; `Position::empty` sets `None`. `key()` appends bytes `[0xFE, color_byte]` only when `Some`, so every existing key stays the same.
  - `pub enum Scoring { Area, Territory }` (serde camelCase, TS).
  - `pub enum AnalysisRules { Chinese, JapaneseKorean, Custom { komi: Komi, scoring: Scoring } }` (serde `tag = "kind"`, camelCase, TS export; `Komi` serialises as a number), with `komi(&self) -> Komi`, `scoring(&self) -> Scoring` and `katago_rules(&self) -> Rules` (Area → `Chinese`, Territory → `Japanese`).
  - `pub struct RulesReading { pub rules: AnalysisRules, pub komi_unreadable: bool }`.
  - `pub fn read_rules(root: &SgfNode, default: AnalysisRules) -> RulesReading` (reads `RU`, `KM`, `HA`, `AP` per design 5.5).
  - `pub type NodeId = usize;`
  - `pub struct GameInfo { pub black: Option<String>, pub white: Option<String>, pub black_rank: Option<String>, pub white_rank: Option<String>, pub result: Option<String>, pub date: Option<String>, pub event: Option<String>, pub round: Option<String>, pub game_name: Option<String>, pub place: Option<String>, pub handicap: Option<u8> }` (serde camelCase, TS).
  - `pub enum GameError { NotGo, UnsupportedSize { width: u8, height: u8 } }` — `width`/`height` saturate at 255.
  - `pub struct Game` with:
    - `pub fn from_sgf(tree: SgfTree, default_rules: AnalysisRules) -> Result<(Game, RulesReading), GameError>`;
    - `pub fn size(&self) -> BoardSize`; `pub fn info(&self) -> &GameInfo`; `pub fn root(&self) -> NodeId`;
    - `pub fn main_line(&self) -> &[NodeId]` (root first; first child each step);
    - `pub fn move_number(&self, node: NodeId) -> u32` (moves, passes included, from the root along the path);
    - `pub fn board_at(&self, node: NodeId) -> &Board` (cached per node on first use);
    - `pub fn last_move(&self, node: NodeId) -> Option<Move>`; `pub fn to_play(&self, node: NodeId) -> Color`;
    - `pub fn illegal(&self, node: NodeId) -> Option<Illegal>`; `pub fn has_illegal(&self) -> bool`;
    - `pub fn position_at(&self, node: NodeId, rules: &AnalysisRules) -> Option<Position>` (`None` on an illegal node);
    - `pub fn preview(&self, node: NodeId, moves: &[Move], rules: &AnalysisRules) -> Preview`;
    - `pub fn to_sgf(&self, rules: Option<&AnalysisRules>) -> SgfTree` (`Some` when the user changed the rules: writes `RU` and `KM` per design 5.5; replaces `CA` with `UTF-8`, adds `FF[4]`/`GM[1]` if missing).
  - `pub struct Preview { pub stones: Vec<Option<Color>>, pub captured: Vec<Vec<Point>>, pub illegal_at: Option<u32> }` (serde camelCase, TS).
- Consumes: `SgfTree`, `SgfNode` (Task 2); `Board`, `expand_points`, `Illegal` (Task 3).

- [ ] **Step 1: Write the failing tests** (`rules.rs`):
  - `presets_from_files`: (`RU[Chinese]`, `KM[7.5]`) → `Chinese`; (`RU[Japanese]`, `KM[6.5]`) → `JapaneseKorean`; (`KM[6.5]`, no `RU`) → `JapaneseKorean`; (`RU[Korean]`, `KM[5.5]`) → `Custom { 5.5, Territory }`; (`RU[Chinese]`, `KM[6.5]`) → `Custom { 6.5, Area }`; nothing → the default.
  - `fox_komi`: (`RU[Chinese]`, `KM[375]`, `AP[foxwq]`) → `Chinese`; (`KM[325]`, `RU[Chinese]`) → `Custom { 6.5, Area }`; (`RU[Japanese]`, `KM[0]`, `HA[0]`, `AP[GNU Go:3.8]`, `AP[foxwq]`) → `JapaneseKorean`; the same without `foxwq` → `Custom { 0, Territory }`.
  - `bad_komi`: `KM[abc]` → default, `komi_unreadable: true`.
  - `katago_mapping`: `Custom { 7, Territory }.katago_rules() == Rules::Japanese`.
- [ ] **Step 2: Write the failing tests** (`record.rs`), each building a tree with `parse_sgf`:
  - `sizes`: `SZ[19:13]` → `UnsupportedSize { 19, 13 }`; `SZ[21]` → `{ 21, 21 }`; `SZ[4]` → error; `SZ[9]` → ok; no `SZ` → 19; `GM[2]` → `NotGo`.
  - `main_line_follows_first_children`, and `move_number` counts passes (`B[]`, and `B[tt]` on 19) but not setup-only nodes.
  - `handicap_root`: `HA[3]AB[dd][pd][dp]` then `W[pp]` → `position_at(root)` has `initial_player == Some(White)` and three setup stones.
  - `pl_sets_player`: `AB[dd]PL[W]` → `to_play(root) == White`, position `initial_player == Some(White)`.
  - `mid_game_setup_rebases`: `;B[pd];W[dd];AB[qq];W[pp]` → the position at the last node has the board after the `AB` node as setup stones, `initial_player` White, and moves `[W pp]`.
  - `illegal_move_rebases_later_nodes`: a move onto an occupied point → `position_at` that node is `None`, `illegal` is `Some(Occupied)`; the next node's position has no moves before it from the bad move and is not `None`.
  - `last_move_and_captures`: `board_at` after a capture lacks the captured stones; `last_move` is the node's move.
  - `preview`: from a node, `[Play(a), Play(b)]` alternating from `to_play`, gives the expected stones and per-move captures; an occupied point gives `illegal_at: Some(i)`.
  - `to_sgf_keeps_everything`: unknown properties, `LZ` values and variations survive `to_sgf(None)`; `CA[GB2312]` becomes `CA[UTF-8]` once; with `Some(&Custom { 7, Territory })`, `RU` is `Japanese` and `KM` is `7`.
- [ ] **Step 3: Write the failing test** (`position.rs`): `initial_player_changes_the_key_only_when_set` (the existing pinned key values still match with `None`; `Some(White)` gives a different key).
- [ ] **Step 4: Run** `cargo test -p aji-core` — fails.
- [ ] **Step 5: Implement.** The game holds the `SgfTree` flattened into an arena of nodes (each keeps its `SgfNode` verbatim, its parent, children and parsed move/setup), so `to_sgf` rebuilds the tree from the arena without losing anything. Boards are computed lazily along the path with a cache. Re-basing: the position's base is the latest node on the path with setup after the first move or an illegal move. Moves are played with `multi_stone_suicide = false`: none of the three rule choices allows suicide (the Tromp-Taylor case of design 5.1 waits for the later custom-rules feature), and `Board::play` keeps the flag for it.
- [ ] **Step 6: Run** `cargo test --workspace` — passes (the engine crates compile with the new field).
- [ ] **Step 7: Commit** `feat(core): games, analysis rules and positions from SGF`.

### Task 5: Fixtures and round-trip tests

**Files:**
- Create: `crates/aji-core/tests/fixtures/sgf/` (files below), `crates/aji-core/tests/fixtures/sgf/SOURCES.md`, `crates/aji-core/tests/fixtures/sgf/make.py`, `crates/aji-core/tests/sgf_fixtures.rs`
- Modify: `crates/aji-core/Cargo.toml` (`proptest` dev-dependency), `docs/development.md` (how to regenerate fixtures)
- Source data: the five Samsung finals downloaded to `/private/tmp/claude-501/-Users-zepher--claude-spares-spare-PzvHoJ/49da135c-227a-48fe-bdcc-2e8600c02ff4/scratchpad/sgf-dl/` (`samsung-01-F1.sgf`, `samsung-09-F1.sgf`, `samsung-18-F1.sgf`, `samsung-28-F3.sgf`, `samsung-30-F2.sgf`). If that folder is gone, fetch them again from `https://homepages.cwi.nl/~aeb/go/games/games/Samsung/{01,09,18,28,30}/F*.sgf`.

**Interfaces:**
- Consumes: `decode`, `parse_sgf`, `write_sgf` (Tasks 1–2); `Game::from_sgf`, `to_sgf` (Task 4).

- [ ] **Step 1: Add the public-domain files** as `samsung-1996-final-1.sgf`, `samsung-2004-final-1.sgf`, `samsung-2013-final-1.sgf`, `samsung-2023-final-3.sgf`, `samsung-2025-final-2.sgf`, unchanged. `SOURCES.md` records the URL of each and the archive's statement "The games here are in the public domain".
- [ ] **Step 2: Write `make.py`** (run with `python3 -I make.py` from the repository root; it reads the 2025 file and writes the derived files). The derived files are listed in design section 7. Names: Ding Hao 丁浩, Liao Yuanhe 廖元赫, event 第30届三星杯决赛. Japanese names: 井山裕太 and 一力遼. Korean names: 신진서 and 박정환. Fox layout and LizzieYzy values: made up, following the design. The script finds a GBK character with a `0x5C` and one with a `0x5D` trail byte and uses them in a player name. Each derived file is listed in `SOURCES.md` as "derived from samsung-2025-final-2.sgf by make.py".
- [ ] **Step 3: Write the tests** in `sgf_fixtures.rs`:
  - `every_good_fixture_opens`: every fixture not prefixed `broken-` decodes, parses and builds a `Game`; for the Samsung files, the last node's board matches a replay of its moves and `move_number` equals the move count.
  - `chinese_names_read`: each encoding variant gives black player `丁浩`; the Shift-JIS and EUC-KR files give their names.
  - `round_trip`: for every fixture, `parse(write(parse(x)))` equals `parse(x)` (with `CA` normalised), and `write(parse(write(x)))` is byte-identical to `write(x)`.
  - `lizzie_and_unknown_properties_survive`: after `to_sgf(None)` and writing, the `LZ`, `LZOP`, `LZ2`, `LZOP2`, `TT`, `TC`, `RL` values equal the input's.
  - `collection_keeps_other_games`: the two-game file writes both games back.
  - `broken_files`: each `broken-*` file gives its expected outcome (truncated: opens with the moves that arrived and warning `Truncated`; `SZ[19:13]`, `SZ[21]`, `GM[2]`: the `GameError`; occupied point: opens with that node illegal).
  - `fox_rules`: the `KM[375]` file reads `Chinese`; the `KM[0]` Japanese file reads `JapaneseKorean`.
  - proptest `parser_never_panics` (arbitrary `Vec<u8>` up to 4 KiB through `decode` and `parse_sgf`), and proptest `random_games_round_trip` (random legal move sequences on 9×9 written, parsed and rebuilt give the same main-line boards).
- [ ] **Step 4: Run** `cargo test -p aji-core --test sgf_fixtures` — passes (fix earlier tasks if a fixture shows a real bug, in the commit it belongs to).
- [ ] **Step 5: Commit** `test(core): SGF fixtures and round-trip tests`.

### Task 6: Engine: initial player, clearing the position

**Files:**
- Modify: `crates/aji-engine/src/query.rs`, `crates/aji-engine/src/engine.rs`, `src-tauri/src/protocol.rs` (`EngineStatus.position` optional), `src-tauri/src/service.rs` (`InvalidPosition` → new code), `src/engine/engineStore.tsx`, `src/transport/api.ts`, `src/i18n/codes.test.ts`, locales
- Test: `crates/aji-engine/src/query.rs` tests, `crates/aji-engine/tests/engine.rs`, `src/engine/engineStore.test.ts`

**Interfaces:**
- Produces:
  - The query has `"initialPlayer": "B" | "W"` when `position.initial_player` is `Some`.
  - `pub async fn Engine::clear_position(&self) -> Result<(), EngineError>`: terminates the running query, keeps the state `Ready` (or `Paused`), and analyses nothing until the next `set_position`. `EngineStatus.position: Option<PositionKey>` (`None` after a clear, and before any position).
  - `ErrorCode::InvalidPosition` with locale text.
  - Engine store: `clearPosition(): void` (sets `position: null`, `analysis: null`, and from then on drops every `analysisUpdate` until `setPosition`). The store's existing "accept updates while `position` is null" behaviour changes: updates are accepted only for the current non-null position (M3 deferral).
- Consumes: `Position.initial_player` (Task 4).

- [ ] **Step 1: Write the failing tests.**
  - `query.rs`: `initial_player_is_sent` (`Some(White)` → `"initialPlayer":"W"`; `None` → no field).
  - `engine.rs` integration (fake KataGo): `clear_position_stops_analysis` (after `clear_position` the fake receives a `terminate` for the running query, no further updates are emitted, `status().position` is `None`; a later `set_position` analyses again). Also the M3 deferrals: `cached_position_fills_at_once` (returning to an analysed position emits its cached update immediately) and `analysis_kept_across_pause_and_resume` (if not already covered; check the existing tests first and add only what is missing).
  - `service.rs`: an engine `InvalidPosition` maps to `ErrorCode::InvalidPosition`.
  - `engineStore.test.ts`: no update is accepted while `position` is null; `clearPosition` drops the analysis and ignores late updates for the old key.
- [ ] **Step 2: Run** `cargo test -p aji-engine` and `pnpm test src/engine` — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all checks — pass; generated types updated.
- [ ] **Step 5: Commit** `feat(engine): send the player to move and let the position be cleared`.

### Task 7: Game session and protocol

**Files:**
- Create: `src-tauri/src/game.rs`
- Modify: `src-tauri/src/protocol.rs`, `src-tauri/src/service.rs` (`AppContext.game`), `src-tauri/src/lib.rs` (create the session; start the engine on the session's position instead of `default_position()`), `src-tauri/src/settings.rs` (`defaultRules`, lenient), `src-tauri/Cargo.toml` (`base64`), `src/i18n/codes.test.ts`, locales
- Test: `src-tauri/src/game.rs` unit tests, `src-tauri/src/service.rs` tests, `src-tauri/src/settings.rs` tests

**Interfaces:**
- Produces:
  - `UiSettings.default_rules: AnalysisRules` (JSON `defaultRules`, default `{ "kind": "chinese" }`, read leniently like the other fields).
  - `pub enum NavTarget { First, Last, Previous, Next, Move(u32) }` (serde camelCase; `Move` as `{ "move": n }`; TS).
  - `pub enum GameWarning { Truncated, Repaired, ExtraGames { count: u32 }, EncodingGuessed { encoding: String }, IllegalMoves, KomiUnreadable }` (serde `tag = "code"`, camelCase, TS). `UnclosedValue` and `Skipped` from the parser both map to `Repaired`; `Truncated` wins when both appear.
  - `pub struct RulesState { pub current: AnalysisRules, pub from_file: AnalysisRules, pub changed: bool, pub ru: Option<String>, pub km: Option<String> }` (camelCase, TS).
  - `pub struct GameSnapshot { pub revision: u64, pub name: Option<String>, pub info: GameInfo, pub rules: RulesState, pub size: u8, pub stones: Vec<Option<Color>>, pub last_move: Option<Move>, pub next_color: Color, pub move_number: u32, pub main_line_length: u32, pub at_start: bool, pub at_end: bool, pub illegal: Option<Illegal>, pub captures: [u32; 2], pub position_key: Option<PositionKey>, pub has_moves: bool }` (camelCase, TS; `revision` with `#[ts(type = "number")]`). `name` is the file name without `.sgf`; the UI composes the title (design 5.4 order) from `info` and `name`.
  - Requests: `GameNew { size: u8 }`, `GameOpen { name: String, bytes: String }` (base64), `GameNavigate { to: NavTarget }`, `GamePreview { moves: Vec<Move> }`, `GameSetRules { rules: Option<AnalysisRules> }` (`None` = back to the file's reading), `GameSnapshot`, `GameExport`.
  - Responses: `Game { snapshot: GameSnapshot, warnings: Vec<GameWarning> }` (for every request that changes or reads the game), `GamePreview { preview: Preview }`, `GameExport { name: String, text: String }`.
  - `AppEvent::GameSnapshot { snapshot: GameSnapshot }`, emitted after every change.
  - `ErrorCode`s: `SgfNotAGame`, `SgfNotGo`, `SgfUnsupportedSize`, `SgfTooLarge`, `GameEmpty` (export of a game with no moves and no setup), `FileReadFailed`, `FileWriteFailed`, `FileNotSgf`, `FileMissing`. The `message` of `SgfUnsupportedSize` carries the size as `"19x13"` and the UI parses nothing from it: add `ProtocolError.detail: Option<String>` (TS optional) for the size, used only by this code.
  - `AppContext.game: Arc<tokio::sync::Mutex<GameSession>>`.
- Consumes: Tasks 1–4 (`decode`, `parse_sgf`, `write_sgf`, `Game`, `read_rules`, `AnalysisRules`), Task 6 (`clear_position`).

- [ ] **Step 1: Write the failing tests** (`service.rs`, with the existing test context and fake engine):
  - `open_navigate_and_export`: `gameOpen` of a small base64 SGF → snapshot at the root (`move_number` 0, `at_start`), the engine received the root position; `gameNavigate { to: last }` → `at_end`, engine position is the last node; `{ move: 9999 }` clamps to the end; `gameExport` → text that parses back to the same main line, name `<name>.sgf`.
  - `navigation_is_ordered`: 50 concurrent `gameNavigate { next }` from the root end with the snapshot at move 50 and the engine's last `set_position` equal to move 50's position.
  - `illegal_node_clears_the_engine`: navigating onto an illegal node calls `clear_position`; snapshot `position_key` is `None`, `illegal` is `Some`.
  - `set_rules`: `gameSetRules { Custom { 7, Territory } }` → `rules.changed`, the engine got komi 7 and `japanese`; `{ rules: null }` → back to the file's reading, `changed` false; export writes `RU[Japanese]KM[7]` only while changed.
  - `new_game_uses_default_rules`: with `defaultRules` set to `japaneseKorean` in settings, `gameNew { size: 13 }` → size 13, rules `JapaneseKorean`; `gameNew { size: 4 }` → error `sgfUnsupportedSize`.
  - `open_errors`: bytes over 20 MB → `sgfTooLarge`; `"hello"` → `sgfNotAGame`; `GM[2]` → `sgfNotGo`; `SZ[19:13]` → `sgfUnsupportedSize` with `detail` `"19x13"`; a failed open leaves the previous game in place.
  - `warnings_are_reported`: an undeclared GBK file → `EncodingGuessed { encoding: "GBK" }`; a two-game file → `ExtraGames { count: 1 }`.
  - `snapshot_events`: each change emits one `gameSnapshot` with a higher `revision`.
  - `preview_changes_nothing`: `gamePreview` returns stones and leaves the snapshot and engine untouched.
  - Settings: `defaultRules` with a bad value falls back to Chinese without losing other fields.
- [ ] **Step 2: Run** `cargo test -p aji` — fails.
- [ ] **Step 3: Implement** `GameSession` (current node, name, `RulesState`, revision, warnings of the last open) and the dispatcher arms. Hold the session's `tokio::sync::Mutex` across the engine call, so positions reach the engine in request order. The session starts as `gameNew { size: 19 }` with the default rules from settings.
- [ ] **Step 4: Run** all checks — pass.
- [ ] **Step 5: Commit** `feat: game session and game requests`.

### Task 8: Platform layer: files, recent list, menu

**Files:**
- Create: `src-tauri/src/platform/mod.rs`, `src-tauri/src/platform/recent.rs`, `src-tauri/src/platform/menu.rs`
- Modify: `src-tauri/src/lib.rs` (register commands, menu, drag-drop listener), `src-tauri/capabilities/default.json` (`core:window:allow-set-title`)
- Test: unit tests in `recent.rs` and `platform/mod.rs` (the parts that take a path, not the dialogs)

**Interfaces:**
- Produces (Tauri commands, camelCase JSON; errors are `ProtocolError`):
  - `files_pick_open() -> Option<OpenedFile>`: native open dialog filtered to `.sgf`.
  - `files_open_path(path: String) -> OpenedFile`: for drops (`fileNotSgf` if the name does not end in `.sgf`, case-insensitive).
  - `files_open_recent(index: u32) -> OpenedFile` (`fileMissing`, and the entry is removed, when the file is gone).
  - `files_remember(token: String, title: String)`: adds the opened or saved file to the recent list (moves it to the top, caps at 10), then rebuilds the macOS menu.
  - `files_recent() -> Vec<RecentEntry>`, `files_clear_recent()`.
  - `files_save_as(suggested_name: String, text: String) -> Option<String>` (the token of the saved file; `None` on cancel): native save dialog, atomic write (temp file in the same folder, then rename).
  - `pub struct OpenedFile { pub token: String, pub name: String, pub bytes: String }` (`bytes` base64; `name` with extension; `token` is an opaque id for `files_remember`, mapped to the path in memory).
  - `pub struct RecentEntry { pub title: String, pub name: String, pub path: String, pub opened_at: u64, pub missing: bool }` (`#[ts(type = "number")]` on `opened_at`, Unix ms). `missing` is checked when listed.
  - Events: `aji://menu` with payload `"new19" | "new13" | "new9" | "open" | "saveAs" | { "recent": n } | "clearRecent"`; Tauri's `onDragDropEvent` is used as is from the UI.
  - Size limit, `.sgf` check and atomic write live in `platform/mod.rs` functions that take paths, so they are unit-tested: `read_sgf_file(path: &Path) -> Result<(String, Vec<u8>), ProtocolError>` and `write_atomically(path: &Path, text: &str) -> io::Result<()>`.
  - `RecentList` in `recent.rs`: `load(path) -> RecentList` (unreadable file → empty, logged), `save(&self, path)`, `push(&mut self, path, title, now)`, `remove(index)`, `clear()`, `entries(&self) -> Vec<RecentEntry>`.
- Consumes: `ErrorCode` values (Task 7).

- [ ] **Step 1: Write the failing tests:** `recent_moves_to_top_and_caps_at_10`; `recent_marks_missing_files`; `recent_survives_a_corrupt_file` (garbage `recent.json` → empty list, then a push writes a valid file); `read_rejects_other_extensions_and_large_files` (20 MB + 1 byte → `sgfTooLarge`); `read_accepts_upper_case_extension`; `write_atomically_replaces_and_leaves_no_temp` (the folder holds only the target afterwards).
- [ ] **Step 2: Run** `cargo test -p aji platform` — fails.
- [ ] **Step 3: Implement** the commands, the macOS menu (app menu; 文件/File with 新建棋局 submenu 19/13/9 路, 打开棋谱… ⌘O, 打开最近 submenu built from the recent list plus 清除最近记录, 另存为… ⇧⌘S; standard Edit and Window menus from `PredefinedMenuItem`), with labels in the language from settings (rebuild on `settingsChanged`). On Windows and Linux, set no menu. Menu labels come from a small Rust table with both languages, `menu.rs`, since the Rust side cannot read the TypeScript locale files; keep it the only Rust-side interface text and list it in the locale parity notes of `docs/development.md`.
- [ ] **Step 4: Run** all checks — pass. Then run `pnpm tauri dev` and check on the Mac: the menu shows, ⌘O opens the dialog, a drop on the window reaches the UI (log the event in the console), a saved file is written.
- [ ] **Step 5: Commit** `feat: open, drop, remember and save game files`.

### Task 9: Stones on the board, and screenshot tests

**Files:**
- Create: `src/board/stones.ts`, `src/board/canvasFactory.ts`, `src/board/screenshots.test.ts`, `src/board/__screenshots__/*.png`
- Modify: `src/board/wood.ts` (take a factory), `src/board/drawBoard.ts`, `src/board/BoardCanvas.tsx` (second canvas layer for stones; props `stones`, `lastMove`), `src/layout/MainFrame.tsx` (pass the game's size and stones), `package.json` (dev-dependencies), `vitest.config.*` or the test file's `// @vitest-environment node` header, `docs/development.md` (`UPDATE_SCREENSHOTS=1 pnpm test src/board/screenshots`)
- Test: `src/board/stones.test.ts`, `src/board/screenshots.test.ts`

**Interfaces:**
- Produces:
  - `export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | OffscreenCanvasLike` with `export interface OffscreenCanvasLike { width: number; height: number; getContext(type: '2d'): CanvasRenderingContext2D | null }`; `export const domCanvas: CanvasFactory`.
  - `woodTexture(cssSize, dpr, create: CanvasFactory = domCanvas)`; `drawBoard(ctx, view, create = domCanvas)`.
  - `export interface StoneSprites { black: OffscreenCanvasLike; white: OffscreenCanvasLike[]; radius: number }` (four white grain rotations).
  - `export function makeStoneSprites(spacing: number, dpr: number, create: CanvasFactory): StoneSprites`.
  - `export function drawStones(ctx: CanvasRenderingContext2D, view: BoardView, stones: readonly (Color | null)[], lastMove: Move | null, sprites: StoneSprites): void` — clears the layer, stamps each stone at its point (white rotation chosen by `(x * 7 + y * 3) % 4`), then the last-move dot.
  - `BoardCanvas` props: `{ cssSize: number; boardSize: number; stones: readonly (Color | null)[]; lastMove: Move | null }`.
- Consumes: `GameSnapshot.stones`, `lastMove`, `size` (Task 7) through the game store (Task 10). Until Task 10 lands, `MainFrame` passes an empty 19×19 board.

- [ ] **Step 1: Write the failing tests.**
  - `stones.test.ts` (jsdom with `vitest-canvas-mock`): `drawStones` stamps one sprite per stone at the geometry's point; the last-move dot is drawn after the stones; sprites are rebuilt only when spacing or `dpr` changes (memoised by `BoardCanvas`).
  - `screenshots.test.ts` (`// @vitest-environment node`; registers `src/assets/fonts/Inter-Regular.woff2` with `GlobalFonts` under the family name the board uses): empty 9, 13 and 19 boards at `dpr` 1; the 2025 Samsung game at move 58 (moves inlined in the test) at `dpr` 1 and 2. Each is compared with `pixelmatch` (`threshold: 0.1`) against its baseline PNG; the test fails when more than 0.1% of pixels differ. With `UPDATE_SCREENSHOTS=1` it writes the baselines instead.
- [ ] **Step 2: Run** `pnpm test src/board` — fails.
- [ ] **Step 3: Implement.** Stone look as in design 5.9 and the mockup's `stone()` function in `docs/design/mockups/m6/game-records.html`, which the owner approved: two shadows from the upper left, a slate radial gradient with a soft highlight for black, and a shell gradient with faint diagonal grain for white. Sprites are drawn once per spacing and `dpr` and stamped with `drawImage`.
- [ ] **Step 4: Generate the baselines** with `UPDATE_SCREENSHOTS=1`, look at each PNG (Read tool) to check that it shows what its name says, then run `pnpm test src/board` without the variable — passes. Run `node scripts/check-npm-licenses.mjs` — passes.
- [ ] **Step 5: Commit** `feat(board): realistic stones, the last-move dot and screenshot tests`.

### Task 10: Game store, transport calls and PlatformFiles

**Files:**
- Create: `src/game/gameStore.ts`, `src/game/useGameSync.ts`, `src/game/title.ts`, `src/game/actions.ts`, `src/game/noticeStore.ts`, `src/platform/files.ts`, `src/platform/tauriFiles.ts`, `src/platform/fakeFiles.ts`, `src/platform/PlatformProvider.tsx`
- Modify: `src/transport/api.ts`, `src/main.tsx` (provide `PlatformFiles`), `src/App.tsx` (`useGameSync`), `src/layout/MainFrame.tsx` (stones from the store), locales
- Test: `src/game/gameStore.test.ts`, `src/game/useGameSync.test.tsx`, `src/game/title.test.ts`, `src/game/actions.test.ts`

**Interfaces:**
- Produces:
  - `api.ts`: `newGame(t, size)`, `openGame(t, name, bytes)`, `navigateGame(t, to: NavTarget)`, `previewGame(t, moves)`, `setGameRules(t, rules: AnalysisRules | null)`, `getGameSnapshot(t)`, `exportGame(t)`. Each returns `{ snapshot, warnings }`, except preview (`Preview`) and export (`{ name, text }`).
  - `gameStore`: `{ snapshot: GameSnapshot | null; apply(snapshot: GameSnapshot): void }`. `apply` ignores a snapshot whose `revision` is not newer. It also calls the engine store's `setPosition(key)` or `clearPosition()`.
  - `noticeStore`: `{ notice: Notice | null; show(n: Notice): void; dismiss(): void }`, with `type Notice = { kind: 'error' | 'warning'; title: string; detail?: string; id: number }`. Warnings dismiss themselves after 6000 ms.
  - `title.ts`: `gameTitle(snapshot, t): string` following design 5.4: `GN`; else event plus round; else "black 对 white"; else the file name; else 未命名棋局.
  - `PlatformFiles` (`files.ts`):
    ```ts
    export interface PlatformFiles {
      pickOpen(): Promise<OpenedFile | null>;
      openPath(path: string): Promise<OpenedFile>;
      openRecent(index: number): Promise<OpenedFile>;
      remember(token: string, title: string): Promise<void>;
      recent(): Promise<RecentEntry[]>;
      clearRecent(): Promise<void>;
      saveAs(suggestedName: string, text: string): Promise<string | null>;
      setWindowTitle(title: string): Promise<void>;
      onDrag(handler: (e: { kind: 'over' | 'leave' } | { kind: 'drop'; paths: string[] }) => void): () => void;
      onMenu(handler: (command: MenuCommand) => void): () => void;
    }
    ```
    `OpenedFile`, `RecentEntry` and `MenuCommand` are TypeScript types mirroring Task 8.
  - `actions.ts`: `openFromPicker()`, `openDropped(paths)`, `openRecent(index)`, `saveAs()`, `startNewGame(size)`, `navigate(to)`, `setRules(rules | null)`. Each takes `{ transport, files, t }`, shows the matching notice on failure or warning, and remembers a file only after `gameOpen` succeeds.
- Consumes: Task 7 protocol, Task 8 commands, Task 6 `clearPosition`.

- [ ] **Step 1: Write the failing tests.**
  - `gameStore`: an older revision is ignored; applying a snapshot sets the engine store's position, or clears it when `positionKey` is null.
  - `useGameSync`: on mount it fetches the snapshot; a `gameSnapshot` event applies; the first frame waits for both the first snapshot and the first engine status (M5 deferral 5: `ready` stays false until both arrive).
  - `title`: each fallback in order, in both languages.
  - `actions`: a failed `gameOpen` shows the error notice with the file name and does not call `remember`; a successful one remembers with the composed title; `ExtraGames`, `EncodingGuessed` and `Truncated` warnings show one warning notice (the most important first: `Truncated`, then `ExtraGames`, then `EncodingGuessed`); a drop of `a.txt` shows `fileNotSgf`; `saveAs` exports, writes and remembers; a cancelled dialog does nothing.
- [ ] **Step 2: Run** `pnpm test src/game` — fails.
- [ ] **Step 3: Implement**, including the Tauri `PlatformFiles` with `invoke`, `getCurrentWindow().setTitle` and `getCurrentWebview().onDragDropEvent`, and a `fakeFiles` for tests and dev scenarios. Set the window title to `Aji — <title>` on every snapshot.
- [ ] **Step 4: Run** all checks — pass.
- [ ] **Step 5: Commit** `feat: game store, game requests and platform files in the interface`.

### Task 11: The live header

**Files:**
- Create: `src/panel/GameMenu.tsx`, `src/panel/RulesChip.tsx`, `src/panel/GameInfoPopover.tsx`, `src/panel/MoveCounter.tsx`, `src/panel/NavButtons.tsx`, `src/settings/RulesControl.tsx`, `src/game/useNavigationKeys.ts`, `src/board/useWheelNavigation.ts`
- Modify: `src/panel/PanelHeader.tsx`, `src/layout/MainFrame.tsx` (wheel on the board), locales
- Test: one test file per component or hook

**Interfaces:**
- Produces:
  - `RulesControl({ value, onChange }: { value: AnalysisRules; onChange(rules: AnalysisRules): void })`: the segmented 中国规则 · 日韩规则 · 自定义 control; a preset shows its fixed komi as text and its scoring as a hint (frame C left); Custom shows the komi stepper (− value +, editable, steps of 0.5, clamped to [−150, 150]; an invalid entry reverts on blur) and the 数子 · 数目 control (frame C right). Switching from a preset to Custom starts at that preset's komi and scoring.
  - `RulesChip`: label `中国 · 7.5`, `日韩 · 6.5` or `自定义 · 7` (komi without a trailing `.0`), with the amber dot when `rules.changed`; opens `GameInfoPopover`.
  - `GameInfoPopover`: the information block (players with stone icons and ranks, result, date, event or source) and the rules block (`RulesControl`, then the source line: "与棋谱一致：…" when unchanged, "已改动。棋谱记载 … 原按…读取。恢复棋谱设定" when changed, with `RU`/`KM` raw values in code style; "棋谱没有写规则或贴目，使用默认设置" when the file had neither).
  - `GameMenu`: the title button and chevron open it (frame B): 新建棋局 ▸ (19 · 13 · 9 路), 打开棋谱… ⌘O, 打开最近 ▸ (entries with title, file name and relative date; the full path as a tooltip; missing entries greyed with "已移动或删除"; an empty state "暂无最近打开的棋谱"; 清除最近记录), a separator, 另存为… ⇧⌘S (disabled while `hasMoves` is false). Shortcuts show ⌘ on macOS and Ctrl elsewhere (from `appInfo.os`).
  - `MoveCounter`: `current / total`; a click turns the current number into a selected text field; Enter jumps (`{ move: n }`), Escape or blur cancels, non-digits are ignored; a hover background hints that it is clickable (frame D).
  - `NavButtons`: first, previous, next, last; disabled at the ends; press-and-hold repeats (400 ms, then every 60 ms).
  - `useNavigationKeys()`: on `window` keydown, unless the target is an input, textarea or contenteditable, or a menu or popover is open: ← ↑ previous, → ↓ next, Home first, End last; ⌘/Ctrl+O open, ⇧⌘/Ctrl+Shift+S save as, ⌘/Ctrl+N new 19×19. Repeated key events are coalesced to one request per animation frame, the latest target winning.
  - `useWheelNavigation(ref)`: design 5.7 wheel rules.
- Consumes: Task 10 actions and stores; shadcn `DropdownMenu` and `Popover` (add the Popover component with the shadcn CLI if missing).

- [ ] **Step 1: Write the failing tests.**
  - `RulesControl`: choosing 日韩规则 calls `onChange({ kind: 'japaneseKorean' })`; a preset shows no stepper; Custom from Chinese starts at 7.5 area; the stepper steps by 0.5 and clamps at 150; typing `7.3` reverts on blur.
  - `RulesChip`: the three labels; the dot only when changed; a click opens the popover.
  - `GameInfoPopover`: "恢复棋谱设定" calls `setRules(null)`; the source line text for the unchanged, changed and no-rules cases.
  - `GameMenu`: items and shortcuts; the recent submenu lists entries in order with a missing entry greyed; 另存为… disabled for an empty game; choosing an entry calls the matching action.
  - `MoveCounter`: click, type `120`, Enter → `navigate({ move: 120 })`; Escape → no call; letters are ignored.
  - `NavButtons`: disabled states at the start and the end; holding next for 1 s with fake timers sends about 10 requests.
  - `useNavigationKeys`: arrows and Home/End send the right targets; nothing fires while an input is focused; 20 key repeats inside one frame send one request.
  - `useWheelNavigation`: twenty `deltaY: 5` pixel events give two moves; one `deltaMode: 1` event gives one move; a 600 px momentum burst inside one frame gives one move.
- [ ] **Step 2: Run** `pnpm test src/panel src/game src/board src/settings` — fails.
- [ ] **Step 3: Implement** following mockup frames A–D.
- [ ] **Step 4: Run** all checks — pass. Then check in `pnpm dev` in the browser pane (fake transport), in both themes and languages, against the mockup.
- [ ] **Step 5: Commit** `feat: game menu, rules and komi, move counter and navigation`.

### Task 12: Notices, drop overlay, illegal positions and the settings default

**Files:**
- Create: `src/panel/NoticeLine.tsx`, `src/board/DropOverlay.tsx`
- Modify: `src/App.tsx` (notice line under the header; drop overlay), `src/panel/EngineStatus.tsx` (the illegal-position line, and the grey dot when the engine has no position), `src/settings/SettingsPanel.tsx` (新棋局默认规则 row with `RulesControl` and its note), `src/dev/scenarios.ts` (scenarios for each notice, the drop overlay and an illegal node), locales, `docs/development.md`
- Test: `src/panel/NoticeLine.test.tsx`, `src/board/DropOverlay.test.tsx`, `src/panel/EngineStatus.test.tsx`, `src/settings/SettingsPanel.test.tsx`

**Interfaces:**
- Produces:
  - `NoticeLine`: reads `noticeStore`; an icon, a bold title, an optional detail line, a close button; error and warning styles as in frame E; keyboard focus does not move to it.
  - Notice texts (both locales), matching frame E: `sgfUnsupportedSize` ("无法打开 {name}" / "不支持 {w}×{h} 的棋盘。Aji 支持 5 到 19 路的方形棋盘。"), `sgfNotAGame`, `sgfNotGo`, `sgfTooLarge`, `fileReadFailed`, `fileWriteFailed`, `fileNotSgf`, `fileMissing`; warnings `truncated` ("棋谱不完整，已打开前 {n} 手" with the main-line length), `extraGames` ("这个文件里有 {n} 局棋，只打开了第一局" / "另存为时其余各局会原样保留。"), `encodingGuessed` ("棋谱未注明编码，已按 {encoding} 读取"), `repaired`, `illegalMoves`, `komiUnreadable`.
  - `DropOverlay`: shown while `onDrag` reports `over`; dims the board under a dashed outline with "松开以打开棋谱" and the dragged file's name when the platform gives it (frame F); hidden on `leave` and `drop`.
  - Settings row: `defaultRules` edited through `RulesControl`, saved with the existing settings flow, with the note "用于新建的棋局，以及没有写明规则或贴目的棋谱。已打开的棋局不受影响。" (frame G).
- Consumes: Tasks 10 and 11.

- [ ] **Step 1: Write the failing tests:** each notice renders its title and detail in both languages; a warning disappears after 6 s and an error does not; a new notice replaces the old one; the overlay follows over/leave/drop; on an illegal node the panel shows "这一步在棋谱中不合法…无法分析这个局面" and no candidates; the settings row saves `defaultRules`, and the open game's rules do not change.
- [ ] **Step 2: Run** the tests — fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all checks — pass. Walk the new dev scenarios in `pnpm dev` against frames E–G.
- [ ] **Step 5: Commit** `feat: notices, the drop overlay, illegal positions and default rules`.

### Task 13: Documents, final review and the Mac exit check

**Files:**
- Modify: `docs/superpowers/plans/2026-11-19-phase-1-roadmap.md` (M6 status; G6 closed as SGF only; the M6 plan link), `docs/audits/phase-1-lizzieyzy-menu.md` (F9 and G6: no `.gib`; G10 done; K1 decided: missing rules use the default setting, initially Chinese), `docs/superpowers/specs/2026-11-19-aji-ui-design.md` (4.1: the rules chip beside the title; the game menu), this plan's Status section

- [ ] **Step 1: Update the documents** above, then run every check once more.
- [ ] **Step 2: Commit** `docs: mark M6 game records done`.
- [ ] **Step 3: Whole-branch review** by a fresh reviewer against the design and this plan. Fix each Important finding with a test that fails first, folded into the commit it corrects (`git rebase` with `fixup!` commits, nothing pushed). Record deferred minors for the owner.
- [ ] **Step 4: Build** with `pnpm tauri build --bundles app` and run the design 9 exit check on the Mac, items 1–7, recording results in this plan's Status. Items that need clicks in the native window and cannot be driven from the session are listed for the owner.
- [ ] **Step 5: Ask the owner** where to merge (recent milestones went to `main`) and merge locally with `--no-ff` only on their word.
