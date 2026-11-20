# M6 Game Records and Board Design

- Date: 2026-11-21
- Status: Written for the owner's approval
- Roadmap item: M6 in [the Phase 1 roadmap](../plans/2026-11-19-phase-1-roadmap.md)
- Builds on: [project charter](2026-11-19-aji-project-charter-design.md) sections 6.1, 6.6, 6.7 and 6.8; [interface design](2026-11-19-aji-ui-design.md) sections 4.1 and 5.2; [S5 audit](../../audits/phase-1-lizzieyzy-menu.md) (F1, F2, F4, F9, F12, F18, F19, G6, G10, K1)
- Mockup approved by the owner on 2026-11-21: [`docs/design/mockups/m6/game-records.html`](../../design/mockups/m6/game-records.html) (open it in a browser; it loads Inter and LXGW WenKai TC from Google Fonts).
- Markers: **[Decided]** was decided by the owner. **[Proposed]** is the author's call and can be overturned. **[To verify]** is checked during the build.

## 1. Intent

Until now Aji shows one empty board. M6 lets the user open a real game record: a pro final downloaded from the web, a Fox (野狐) export with GBK names, or a 9×9 teaching game. Aji draws the game with realistic stones, lets the user step through it with the header controls, keyboard and mouse wheel, and saves it again as clean UTF-8 SGF. When the board moves, KataGo analyses the position on the board.

A Go player opens many files from many sources. Most of them are slightly broken: missing encodings, odd properties, duplicated tags, truncated endings. M6 is where Aji earns trust: it opens what it can, says plainly why it cannot open the rest, and never destroys information on save.

## 2. Goals, non-goals, anti-goals

**Goals**

- SGF reading in `aji-core`: encoding detection (GBK and GB18030 without `CA`, plus Japanese and Korean encodings), recovery from malformed input, unknown properties kept.
- SGF writing in `aji-core`: UTF-8 with `CA[UTF-8]`, every unknown property written back, including LizzieYzy's `LZ`, `LZOP`, `LZ2` and `LZOP2` (audit G10).
- A game tree with captures, suicide and simple ko, board positions per node, and game information.
- A `GameSession` in the Rust backend and the `game.*` protocol (roadmap 3.1).
- File handling: open (dialog, ⌘O / Ctrl+O), drag and drop, the ten most recent files, save-as, a new empty game.
- Stones (interface design 5.2), the last-move dot, live header navigation, keyboard and wheel.
- Analysis rules and komi per game, chosen by the user, with a default in settings (5.5).
- Analysis follows the current node **[Decided]**: each navigation sends the new position to the engine.
- Screenshot tests for board rendering (charter 6.8).

**Non-goals**

- Tygem `.gib` files **[Decided]**: the owner has none and does not plan Tygem support now. Audit G6 closes as "SGF only".
- Debounced navigation, stale-update filtering, candidate discs, the candidate table and hover variations (M7).
- Showing or editing comments, choosing a variation, playing a move by clicking (Phase 2, per the charter and roadmap O1).
- Save in place. Nothing can change a game in Phase 1, so there is never anything unsaved (audit F8). Save-as is the only save.
- The opened game library (roadmap O7: the title chevron stays the file menu's home in Phase 1).

**Anti-goals** (failure even if everything "works")

- A save that loses a property, a comment, a variation or LizzieYzy analysis.
- A Chinese name shown as mojibake when the file's bytes were enough to read it.
- A file that does not open, with no reason given.
- A board that stutters, or lags behind a held arrow key.
- Paths in `rpc` messages (roadmap 3.1).

## 3. Owner decisions (2026-11-21)

- Understanding of M6 confirmed as written in the roadmap.
- Analysis follows navigation now. Debounce, stale-update filtering and candidate discs stay in M7.
- Fixtures: public pro games from online sources (for example the Samsung Cup); no Tygem files, general SGF support only.
- File commands: the author designs them; the owner judges the result. It must be polished. The mockup was reviewed and approved, with one change: rules and komi (next item).
- Rules and komi are the user's choice per game: Chinese and Japanese/Korean presets with fixed komi, or Custom with a free komi (5.5). The Settings default covers new games and files that do not say.

## 4. Approaches considered

### 4.1 Where the game lives

- **Rust backend `GameSession` [Proposed, chosen]** (roadmap O2 default). One implementation of SGF and rules. The backend knows the current node, so it can tell the engine about each navigation without a second request. Later phases (play against the AI, engine matches, board sync) produce moves in the backend.
- `aji-core` compiled to WebAssembly, tree held in the UI. Navigation needs no round trip, but rules logic runs in two places and the engine side needs the position sent separately. Rejected.

### 4.2 SGF parser

- **Aji's own parser in `aji-core` [Proposed, chosen].** Needs: recovery from broken files, duplicate properties tolerated, unknown properties kept verbatim, encoding handled before tokenising. Small enough to own (a few hundred lines).
- The `sgf-parse` crate (MIT). It is strict on malformed input and models properties as typed values, which makes verbatim round-trip of unknown or broken values harder. Rejected.

### 4.3 Board screenshot tests

- **Pixel comparison in Vitest with `@napi-rs/canvas` [Proposed, chosen].** Node, no browser download; deterministic because the board text uses the bundled Inter font, registered from `src/assets/fonts/Inter-Regular.woff2` (spike on 2026-11-21: the `.woff2` registers and is used for text; radial gradients and shadows render). It tests the drawing code on Skia, not on the WebView, which is the right target: the drawing functions are pure (charter section 5).
- Vitest browser mode with Playwright screenshots. Real browser, but baselines differ per OS (fonts, antialiasing), so it needs a baseline per platform, plus a Chromium download in CI. Rejected.

## 5. Design

### 5.1 SGF reading (`aji-core::sgf`)

**Decoding comes first.** In GBK, GB18030, Big5 and Shift-JIS a trail byte can be `0x5C` (`\`) or `0x5D` (`]`), so a byte-level tokeniser would end a value in the middle of a character. The reader therefore:

1. A UTF-8 BOM means UTF-8 (the BOM is dropped).
2. Bytes that are valid UTF-8 are UTF-8, whatever `CA` says. Tools that convert a file often leave a stale `CA[gb2312]`, and a short UTF-8 text such as `丁浩]` also decodes cleanly as GBK (`涓佹旦]`), so a declaration must not beat valid UTF-8. Real GBK text of any length is almost never valid UTF-8.
3. Otherwise the raw bytes are scanned for an ASCII `CA[` value. A declared **multi-byte** charset (`encoding_rs` labels: `GB2312`, `GBK`, `GB18030`, `Big5`, `Shift_JIS`, `EUC-JP`, `EUC-KR` and aliases) wins if the whole file decodes in it without error.
4. Otherwise `chardetng` guesses, with the top-level domain hint unset. GBK and GB18030 files come out as GBK (decoded as GB18030, its superset), Japanese as Shift-JIS, Korean as EUC-KR. A declared **single-byte** charset (`ISO-8859-1`, `windows-1252` and the like, which never fail to decode) is used only when the guess is itself a single-byte charset, so a GBK file mislabelled `CA[ISO-8859-1]` still reads as GBK.
5. Decodes the whole file to a `String` (replacement characters where a byte sequence is invalid, recorded as a warning).

The result records which encoding was used and why (`bom`, `utf8`, `declared`, `detected`), for logs and tests. A `detected` result gives the `sgfEncodingGuessed` notice.

**Tokenising and parsing** work on characters:

- Anything before the first `(;` is skipped (some sites put headers or HTML before the game).
- Property identifiers: uppercase letters are the identifier. Lowercase letters inside an identifier (FF[3] style, `AddBlack`) are dropped, as the SGF spec allows.
- Values: `\` escapes the next character; a line break after `\` is a soft break and is removed.
- Duplicate properties in one node are merged: values are appended in order (a real Fox file carries `AP[GNU Go:3.8]` and `AP[foxwq]` in one node).
- Whitespace (including runs of spaces between properties, as Fox writes) is ignored outside values.

**Recovery** **[Proposed]**:

- An unclosed value at the end of the file: the value ends at the end of the file, a warning is recorded.
- Missing closing parentheses: the tree is closed at the end of the file, a warning is recorded. A truncated download opens with every move that arrived.
- A property without a value, or garbage between nodes: skipped, warning.
- Several games in one file (a collection): the first game opens, and a notice says the file holds more games that Phase 1 cannot show. The other games are kept as parsed trees in the `GameRecord` and written back after the first on save-as, so a save never drops them.
- No `(;` at all, or no node: the file does not open (`sgfNotAGame`).

**Typed reading** happens over the generic tree, not in the tokeniser:

- `GM` other than 1: does not open (`sgfNotGo`).
- `SZ`: square sizes 5 to 19 open. A non-square size (`SZ[19:13]`) or a size outside 5–19 does not open (`sgfUnsupportedSize`, with the size in the message). Missing `SZ` means 19.
- Moves `B` / `W`: `B[]` is a pass; `B[tt]` is a pass on boards of 19 and less (FF[3] convention). A coordinate off the board is an error on that node (below).
- Setup `AB`, `AW`, `AE`, including compressed point lists (`AB[aa:cc]`). Setup in the root and in later nodes is supported.
- `PL` sets who plays next at a node.
- `HA`, `KM`, `RU`, `PB`, `PW`, `BR`, `WR`, `GN`, `EV`, `RO`, `DT`, `PC`, `RE` are read into `GameInfo`. Everything is also kept as raw properties.

**Rules and komi** are read into the game's analysis rules (5.5) as described there. `RU` and `KM` are always also kept verbatim as raw properties.

**Illegal moves in a file** **[Proposed]**: a move onto an occupied point, a suicide that the game's rules forbid (multi-stone suicide is legal under Tromp-Taylor, as in KataGo), or a simple-ko violation is still played in the tree: the stone is placed, or replaces what was there, and captures are resolved as far as possible. The node is flagged `illegal`, and navigation shows it. This keeps files from odd sources (problem collections, hand-edited records) viewable.

- The illegal node itself is not analysed (KataGo would reject it). The session calls a new `Engine::clear_position()`, which terminates the running query and leaves the engine `ready` with no position, so the previous position is not analysed under the new board. The snapshot's `illegal` flag drives the panel line "该局面不合法，无法分析"; no new engine state is needed.
- Every later node is analysed again: positions after an illegal node are **re-based** (5.2), so the bad move never reaches KataGo.
- Positional superko is not checked. A real record that repeats a whole-board position under Tromp-Taylor rules is vanishingly rare; if KataGo rejects such a query, the panel shows no candidates for that node (section 13).

### 5.2 Game tree and rules (`aji-core::game`)

- `GameTree`: an arena of nodes (`Vec<Node>`, indices as ids), each with its parent, children in file order, the raw properties (ordered, values verbatim) and the parsed move or setup.
- `Board`: a `size × size` grid with captures, suicide detection and the simple-ko point. Computing the board at a node replays from the root along the path; the session caches the board of the current node and its path, so stepping forward or back by one move costs one move, and a jump replays at most 400 moves (well under a millisecond).
- The **main line** is the path that always takes the first child. Phase 1 navigation follows it: "next" goes to the first child, "last" to the end of the main line. Variations stay in the tree and are written back on save; they are not reachable in Phase 1.
- `Position` (existing type) is built from the **base node** plus the moves after it. The base is the root, or the latest node on the path that a move list cannot express: a node with setup stones after the first move (AB/AW/AE, used by some problem files), or an illegal node (5.1). A re-based position sends the board at the base as `initialStones`, with the player to move after the base as `initialPlayer`, then the moves after the base. `aji-engine` already sends `initialStones` (checked 2026-11-21).
- `Position` gains `initial_player: Option<Color>`, sent as KataGo's `initialPlayer` and included in `PositionKey`. Without it KataGo assumes Black moves first, which is wrong at move 0 of a handicap game (White to play) and for any setup position with `PL[W]`. It is set from `PL` at the root (or at the setup node), else White when the root has `HA` ≥ 2 and black setup stones, else left unset.
- Move numbers count moves (passes included) from the root along the main line, not nodes. A node with setup and no move keeps the previous number.

### 5.3 SGF writing (`aji-core::sgf::write`)

- Output is UTF-8. The root's `CA` is replaced by `CA[UTF-8]` (never duplicated); `FF[4]` and `GM[1]` are added if missing; every other property, known or unknown, is written back with its values as read, escaping `]` and `\` again.
- `AP` is left as the file had it. **[Proposed]** Aji does not add itself as the application on a save-as of someone else's game.
- Layout: one node per `;`, a line break before each variation `(` and roughly every 10 moves on the main line, so files stay readable in a text editor.

**Round trip, defined** **[Proposed]**: for every fixture, `parse(write(parse(bytes)))` equals `parse(bytes)` as a tree (same nodes, same properties and values in the same order), except that `CA` reads `UTF-8`. And a file that was UTF-8 to begin with, written once, gives the same bytes when written again (`write(parse(write(x))) == write(x)`). Byte equality with a GBK original is not possible and not claimed.

### 5.4 Game session and protocol

`GameSession` lives in `src-tauri` (it needs the engine handle; `aji-core` stays pure). One game is open at a time. At start the session holds an empty 19×19 game (Chinese rules, komi 7.5, the M2 default position), so the board and analysis behave as today until a file is opened.

Requests (added to `Request`, served by `service::handle`):

| Request | Payload | Reply |
|---|---|---|
| `gameNew` | `{ size }` (5–19, default 19) | `GameSnapshot` |
| `gameOpen` | `{ name, bytes }` (bytes as a base64 string in JSON) | `GameSnapshot` plus `warnings` |
| `gameNavigate` | `{ to: first \| last \| previous \| next \| { move: n } }` | `GameSnapshot` |
| `gamePreview` | `{ moves: [point or pass] }`, alternating colours from the current node's player to move | `{ stones, captured, illegalAt }`: the board after the sequence, which points were captured at each move, and the index of the first illegal move if any. Read-only: it does not change the game or the engine. Built in M6 as the roadmap lists it; first used by M7's hover variations. |
| `gameSetRules` | `{ rules }` or `{ fromFile: true }` | `GameSnapshot` (5.5) |
| `gameSnapshot` | — | `GameSnapshot` |
| `gameExport` | — | `{ name, text }`: UTF-8 SGF text and a suggested file name |

Event: `gameSnapshot` (`AppEvent::GameSnapshot`) after every change, so a second client (Phase 3) follows along. The replying client also gets the snapshot in the reply, and the UI ignores an event whose `revision` it already has.

`GameSnapshot`:

- `revision`: increases on every change.
- `title`: `GN`; else `EV` + `RO`; else `PB vs PW` (`黑方 对 白方` style through i18n on the UI side: the snapshot carries the parts, the UI composes); else the file name without `.sgf`; else untitled.
- `info`: players, ranks, handicap, result, date, event (for the game information popover).
- `rules`: the current analysis rules, the file's reading, `rulesChanged`, and the raw `RU` and `KM` strings (5.5).
- `size`, `stones`: the board at the current node as a flat array of `empty | black | white`.
- `lastMove`: point or pass or none; `nextColor`.
- `moveNumber`, `mainLineLength`: for the move counter.
- `atStart`, `atEnd`.
- `illegal`: the current node is flagged.
- `captures`: stones captured by each side so far (for later, cheap to have).

Every change of current node also calls `engine.set_position` with the node's position (or holds the engine idle on an illegal node). The engine already terminates the previous query; M7 adds debouncing and filtering. `gameNavigate` returns as soon as the snapshot is ready; it does not wait for the engine.

New error codes, each with `zh-CN` and `en` text:

- `sgfNotAGame`, `sgfNotGo`, `sgfUnsupportedSize`, `sgfTooLarge` (over 20 MB), `fileReadFailed`, `fileWriteFailed`, `fileNotSgf` (a drop or recent entry whose name is not `.sgf`), `fileMissing` (a recent file that no longer exists).
- `invalidPosition` (M3 deferral: today an `InvalidPosition` from the engine maps to `internal`).

Warnings carry codes too (`sgfTruncated`, `sgfRepaired`, `sgfExtraGames`, `sgfEncodingGuessed`, `sgfIllegalMoves`); the UI shows at most one line for them (section 5.8).

### 5.5 Analysis rules and komi

Komi conventions differ by country, by server and over time, so Aji reads a best guess from the file and the user can always change what KataGo analyses with **[Decided]** (2026-11-21). The owner's rule: Chinese and Japanese/Korean are presets with a fixed komi; only Custom frees the komi **[Decided]**.

**The three choices** (`AnalysisRules`):

| Choice | Label | Scoring | Komi | Sent to KataGo |
|---|---|---|---|---|
| Chinese | 中国规则 | area (数子) | 7.5, fixed | `rules: chinese`, `komi: 7.5` |
| Japanese/Korean | 日韩规则 | territory (数目) | 6.5, fixed | `rules: japanese`, `komi: 6.5` |
| Custom | 自定义 | area or territory, chosen | any multiple of 0.5 from −150 to 150 | `chinese` or `japanese` by the chosen scoring, with the komi |

When the user switches from a preset to Custom, the custom komi and scoring start from the preset's, so nothing changes until they edit. **[Proposed]** Tromp-Taylor and finer KataGo rule parameters (ko rule, tax, button, the new Chinese rules) are a later "custom rules" feature; nothing here blocks it, because KataGo takes those as fields of the same `rules` object.

**Reading a file** **[Proposed]**:

1. Komi from `KM`, with two Fox conventions observed in real Fox exports on 2026-11-21:
   - `KM[375]` with `RU[Chinese]`: Fox writes komi in hundredths of a stone (3.75 stones = 7.5 points). Rule: a komi outside −150..150 that is a multiple of 25 is read as hundredths of a stone, times two (`KM[375]` → 7.5, `KM[325]` → 6.5).
   - `KM[0]` with `HA[0]` and `RU[Japanese]` in a file with `AP[foxwq]`: Fox's Japanese-rule even games are played at 6.5, so this reads as 6.5.
   - Not a number, or still out of range: no komi (warning).
2. Scoring from `RU` (audit K1), case-insensitive: `Chinese`/`cn`, `AGA`, `Tromp-Taylor`/`tt`, `NZ` → area; `Japanese`/`jp`, `Korean`/`ko` → territory. Missing or unknown: from the komi (7.5 → area, 6.5 → territory), else the default's scoring.
3. Area with 7.5 → Chinese. Territory with 6.5 → Japanese/Korean. Anything else → Custom with the file's komi and scoring (old Japanese games at 5.5, handicap games at 0.5).
4. No `RU` and no usable `KM`: the default from settings.

The snapshot carries the current choice, the choice read from the file, whether they differ (`rulesChanged`), and the raw `RU` and `KM` strings, so the popover can say "棋谱记载 KM[0] RU[Japanese]（野狐日韩规则），原按日韩规则读取".

**Changing it**: a new request `gameSetRules { rules }` (or `{ fromFile: true }` for "恢复棋谱设定") updates the game, sends a new snapshot and re-analyses the current position at once. It applies to this game only.

**The default** for new games and for files that state neither rules nor komi is a new setting, `defaultRules` (same shape), in `settings.json`, initially Chinese. Changing it never changes a game already open.

**Saving**: when `rulesChanged`, save-as writes `RU[Chinese]` or `RU[Japanese]` (by scoring) and `KM` with the number, replacing the file's values. Otherwise `RU` and `KM` are written back exactly as read.

**Where it shows** (mockup frames A, C and G): a chip beside the title always shows the rules in use (`中国 · 7.5`, `日韩 · 6.5`, `自定义 · 7`), with a small amber dot when it differs from the file's reading. Clicking the chip opens the game information popover: players and ranks, result, date and event, then the rules segmented control, the komi (fixed text for a preset, a stepper for Custom), the scoring control for Custom, and the source line with "恢复棋谱设定". The settings page gets the same control as its default.

### 5.6 Files: the platform layer

Roadmap 3.2 puts file dialogs, drag and drop and recent files behind a TypeScript `PlatformFiles` interface. Paths never enter `rpc`. The desktop implementation:

- **Small Tauri commands outside `rpc`**, in `src-tauri/src/platform.rs`: `files_pick_open`, `files_open_dropped(path)`, `files_open_recent(index)`, `files_recent`, `files_save_as(suggested_name, text)`. They are the desktop half of `PlatformFiles`, not protocol: Phase 3's browser client uses `<input type=file>`, HTML5 drops and a download link instead.
- The open commands read the file in the backend (size limit 20 MB, `.sgf` only, case-insensitive) and return `{ name, bytes }` to the UI, which sends `gameOpen`. Every successful `gameOpen` of a desktop file is then confirmed back with `files_remember(token)`, so a file that fails to parse does not enter the recent list. The token is an opaque id the open command returned, so the UI never handles the path either.
- **Recent files**: `recent.json` in the app config folder, up to 10 entries, newest first, each with the absolute path, the display name and the time. Opening a file moves it to the top. A recent file that no longer exists is shown greyed with "已移动或删除" and removed from the list when clicked, with the `fileMissing` message. Access needs no extra grant: the commands are Aji's own Rust code with ordinary file-system access, the same as the network import in M5.
- **Drag and drop**: Tauri's window drag-drop event gives the dropped paths to the platform layer, which opens the first `.sgf` among them. HTML5 drops in the WebView are not used on desktop (on Windows, Tauri's drag-drop handling takes them over by default). **[To verify]** on the Mac during the build that the drag-over and leave events arrive for the overlay.
- **Save-as** opens the native save dialog with the suggested name (`<title>.sgf`, characters illegal in file names replaced by `_`) and writes the text atomically (write to a temp file in the same folder, then rename). A saved file joins the recent list.
- **Native menu** on macOS **[Proposed]**: the app menu, and a 文件 / File menu with 新建棋局, 打开…, 打开最近 ▸, 另存为…; Edit and Window menus with the standard items (copy and paste keep working in text fields). On Windows and Linux there is no menu bar (interface design 4: no application top bar); the panel's title menu is the way in, plus the shortcuts. Menu items send events to the UI, which runs the same actions as the title menu.

### 5.7 The panel header

```
┌────────────────────────────────────────────────────────────────┐
│ 丁浩 对 谢尔豪 ▾  (中国 · 7.5)   ⏮  ◀  38 / 247  ▶  ⏭    ●   ⚙   │
└────────────────────────────────────────────────────────────────┘
```

- **Rules chip**: beside the title; opens the game information popover (5.5).
- **Title and chevron**: the title truncates with an ellipsis. Clicking the title or chevron opens the **game menu** (shadcn dropdown, already initialised in M5):

  ```
  ┌──────────────────────────────┐
  │ 新建棋局                 ⌘N  │
  │ 打开棋谱…                ⌘O  │
  │ 打开最近                   ▸ │──┐ ┌───────────────────────────────────┐
  │ ──────────────────────────── │  └─│ 2025 三星杯决赛 第二局       今天 │
  │ 另存为…                 ⇧⌘S  │    │ 丁浩 对 谢尔豪            11月20日 │
  └──────────────────────────────┘    │ ───────────────────────────────── │
                                      │ 清除最近记录                       │
                                      └───────────────────────────────────┘
  ```

  Recent entries show the game title on the first line in body text and the file name in muted text beneath; hovering shows the full path. The list is empty-stated ("暂无最近打开的棋谱"). New game opens a size submenu (19 · 13 · 9).
- **Navigation**: first, previous, the counter, next, last. Buttons disable at the ends. Holding a button repeats (after 400 ms, every 60 ms), like holding the arrow key.
- **Move counter** `38 / 247`: clicking the current number turns it into a text field with the number selected; Enter jumps (clamped to 0..length), Escape or blur cancels. Typing non-digits is ignored. With no game open the counter reads `0 / 0`.
- **Keyboard** (when focus is not in a text field): ← previous, → next, Home first, End last, ↑ / ↓ the same as ← / → (Fox and LizzieYzy habit) **[Proposed]**; ⌘/Ctrl+O open, ⇧⌘/Ctrl+Shift+S save as, ⌘/Ctrl+N new game. Key repeat is honoured; while a key is held, navigation requests are sent at most once per animation frame, the latest wins (the backend is fast; M7 adds engine-side debouncing).
- **Mouse wheel over the board**: down is next, up is previous. Wheel deltas are accumulated so a trackpad's many small deltas step at a steady rate (one move per 50 px of `deltaY` in pixel mode, one per notch in line mode), and momentum scrolling never jumps more than one move per frame.

### 5.8 Opening feedback

- **Drop overlay**: while a file is dragged over the window, the board dims slightly and a centred label reads "松开以打开棋谱" (release to open). Dropping something that is not `.sgf` shows the `fileNotSgf` notice.
- **Notices**: a single line under the panel header, with an icon, the text and a close button, that fades after 6 s for warnings and stays for errors until closed or replaced. Examples: "无法打开 abc.sgf：不是围棋棋谱", "棋谱不完整，已打开前 183 手", "未声明编码，已按 GBK 读取". There is no toast system elsewhere; this is the panel's one notice line.
- **Window title**: `Aji — <game title>`, or `Aji` with no game.
- The board change on opening is instant; there is no animation. The last-move dot moves with navigation.

### 5.9 Stones and board drawing

- Stones as in interface design 5.2: black matte slate with a small soft highlight to the upper left; white shell with a faint diagonal grain and lower-edge inner shading; a tight contact shadow and a soft offset shadow from a light at the upper left. Stone diameter is 0.96 of the line spacing.
- Each stone sprite (black, white, each with its shadow) is drawn once per spacing and pixel ratio into an offscreen canvas and stamped, so a full board redraws well within a frame. White stones get one of four grain rotations chosen by point, so the board does not look stamped. **[Proposed]**
- The last-move dot: a small disc in the centre, white on black stones and black on white, about 0.22 of the spacing.
- Layers: the wood and grid stay on the existing canvas; stones go on a second canvas above it, redrawn on every snapshot. M7 adds a third layer for candidates.
- Drawing stays a pure function of view data (`drawStones(ctx, view, stones, lastMove, sprites)`); the canvas factory is passed in, so tests can draw into `@napi-rs/canvas`. `woodTexture` gets the same injectable factory.

### 5.10 Analysis panel while navigating

- Navigation sends the position to the engine (5.4). The candidate list shows what the engine sends for the current position. M7 owns filtering stale updates; M6 does the minimum the M3 review asked for: the UI store drops an `analysisUpdate` whose position key differs from the current snapshot's position key, and accepts none while no snapshot has arrived. The snapshot therefore carries `positionKey` (the existing `PositionKey` of the analysed `Position`).
- On an illegal node the panel shows the illegal-position line and no candidates.

## 6. Earlier deferrals folded in

From the M3 review (memory, "M6"):

- `InvalidPosition` gets its own error code and i18n text (5.4).
- The store accepts analysis while the position is null: fixed by 5.10.
- Tests for cached-position fill, and for analysis kept across pause and resume.

From the M5 review, only those that touch M6 files:

- #5 The analysis panel flashes before the first `engineStatus`: the panel's first frame now waits for both the first engine status and the first game snapshot (both come in one round trip at start).

The CI fix for Windows and Linux (`fix/ci-non-macos-build`, a misplaced `cfg` attribute) is separate and lands first; M6 builds on it.

## 7. Fixtures

In `crates/aji-core/tests/fixtures/sgf/`, with a `SOURCES.md` that records the source and licence of each file:

- **Public domain**: five Samsung Cup final games (1996, 2004, 2013, 2023, 2025) from the CWI Go games archive (`homepages.cwi.nl/~aeb/go/games/games/Samsung/`), which states "The games here are in the public domain".
- **Derived** from those games by Aji's own script (`crates/aji-core/tests/fixtures/sgf/make.py`, kept beside them):
  - Chinese player names, event and a Chinese comment, saved as GBK without `CA`, with `CA[gb2312]`, as GB18030 with a character outside GBK, and as UTF-8 with a BOM.
  - A GBK file whose names include characters with a `0x5C` or `0x5D` trail byte (found by the script, which encodes candidates and checks).
  - Japanese names as Shift-JIS without `CA`; Korean names as EUC-KR.
  - A Fox-layout file: the header structure observed in real Fox exports (spaces between properties, `AP` twice, `TM`, `TC`, `TT`, `RL`, `RN`, `KM[375]` with `RU[Chinese]`; and a second with `KM[0]`, `HA[0]`, `RU[Japanese]`), with made-up user names. Real Fox files were looked at for the layout; none of them are copied, because the repository they came from has no licence.
  - LizzieYzy properties: `LZ`, `LZOP`, `LZ2`, `LZOP2` with values shaped like LizzieYzy's (made up, not taken from LizzieYzy, which is GPL), to prove they survive a save.
  - Variations, setup and handicap (`HA[3]`, `AB`), a 9×9 and a 13×13 game, a pass as `B[]` and as `B[tt]`, `AB[aa:cc]` compression, FF[3] lowercase identifiers, escaped `\]` in a comment, a soft line break.
  - Broken files: truncated mid-value, missing `)`, garbage before `(;`, two games in one file, `SZ[19:13]`, `SZ[21]`, `GM[2]`, a move onto an occupied point.
- The owner's own Fox files can be added later; none are needed for M6.

## 8. Testing

- `aji-core`: unit tests per part (decoding order, tokeniser, recovery cases, typed reading, rules, captures, ko, suicide, compressed points, move numbering) and the round-trip tests of 5.3 over every fixture. Property-based tests (`proptest`, MIT/Apache) for "random legal move sequences round-trip" and "the parser never panics on arbitrary bytes". **[Proposed]**
- `src-tauri`: dispatcher tests for every `game*` request without a webview, including the engine receiving the navigated position (the fake KataGo already records queries), and the illegal-node case. Platform commands are tested on temp folders (recent list order, cap at 10, missing files, atomic save, `.sgf` filter).
- UI (Vitest, jsdom): header navigation, counter editing, keyboard, wheel accumulation, game menu and recent submenu, notices, drop overlay, i18n of every new code.
- Board screenshots (Vitest, Node environment, `@napi-rs/canvas`): empty 9/13/19 boards, a mid-game 19×19 position with the last-move dot on each colour, at ratios 1 and 2. Baselines are PNG files in `src/board/__screenshots__/`; a test fails when more than 0.1% of pixels differ by more than a small threshold (`pixelmatch`, ISC). An `UPDATE_SCREENSHOTS=1` run rewrites the baselines. They run on all three CI runners; if antialiasing differs across them beyond the threshold, the threshold is raised for text pixels only, not stones. **[To verify]** on the first CI run.
- New dependencies, each checked by the existing licence gates (`cargo deny`, `scripts/check-npm-licenses.mjs`) before use: `encoding_rs` ((Apache-2.0 OR MIT) AND BSD-3-Clause), `chardetng` (Apache-2.0 OR MIT), `base64` (MIT OR Apache-2.0) if not already present, `proptest` (dev), `@napi-rs/canvas` (MIT, dev), `pixelmatch` (ISC, dev), `pngjs` (MIT, dev).

## 9. Exit check

On the Mac, with a local build (`pnpm tauri build`):

1. Open each Samsung fixture and the GBK, Shift-JIS and Fox-layout fixtures: names read correctly, the board matches the record at the end (spot-check the final move against the file).
2. Navigation: hold → through a full game; it keeps up, no stutter, and the counter and board agree. Wheel and trackpad step steadily. Typing a move number jumps.
3. Drag a file in; open from recent after a restart; a moved file shows as missing.
4. Save-as the GBK fixture, open the saved file, then save-as again: the second save is byte-identical to the first, and opening the saved file in another program (Sabaki, if installed, or a text editor) shows UTF-8 names and the LizzieYzy properties intact.
5. Broken fixtures each show their message; the truncated one opens with its moves.
6. Analysis follows navigation; an illegal-move fixture shows the illegal line.
7. Light and dark themes, at 100% and a high-DPI scale.

The PC check stays optional until M8.

## 10. Questions for the owner

None open. The Fox `KM[0]` reading (5.5) is only a starting point the user can change.

## 11. Documents this changes

- The roadmap: M6 status, G6 closed as SGF only.
- The S5 audit: F9 and G6 (no `.gib`), G10 done, K1 decided as Chinese.
- `docs/development.md`: the fixtures script and screenshot baseline update.

## 12. Left to the builder

- Exact module layout inside `aji-core` and `src-tauri`, and the TypeScript store shape for the game.
- How the stone sprites are built (gradients, noise for the shell grain), within 5.9.
- Icons for the notice line and menu items, from `lucide-react`.
- The base64 transport of bytes, or another encoding if ts-rs makes it awkward.

## 13. Risks

- Encoding guesses can be wrong for short files with few non-ASCII bytes. Mitigation: the `CA` check comes first, and the notice tells the user the encoding was guessed.
- Skia rendering in tests may differ from WebKit/WebView2 in small ways. Mitigation: the exit check looks at the real app; the screenshots guard against regressions, not against the WebView.
- A KataGo rejection of a query (for example a superko repeat under Tromp-Taylor) is only logged today, so the panel would show "ready" with no candidates for that node. Acceptable for M6; M7, which owns the analysis panel's states, can surface query errors.
- Tauri's drag-drop event shape differs slightly per OS. Mitigation: verified on the Mac during the build; Windows CI cannot test it, so the PC check in M8 covers it.
