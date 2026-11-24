# M7 Analysis on the Board Design

- Date: 2026-11-21
- Status: Approved by the owner on 2026-11-21
- Roadmap item: M7 in [the Phase 1 roadmap](../plans/2026-11-19-phase-1-roadmap.md)
- Builds on: [project charter](2026-11-19-aji-project-charter-design.md) sections 6.1 and 6.5; [interface design](2026-11-19-aji-ui-design.md) sections 4.1–4.3, 5.3; [M6 design](2026-11-21-m6-game-records-design.md) sections 5.4, 5.7 and 5.10; [S5 audit](../../audits/phase-1-lizzieyzy-menu.md) (C2–C6, C11, H1–H5, H7, A1–A3, A7, G3, G7, G8, G9, K5, K6)
- Mockups approved by the owner on 2026-11-21 (open them in a browser; they load Inter and LXGW WenKai TC from Google Fonts):
  - [`docs/design/mockups/m7/trend-graph.html`](../../design/mockups/m7/trend-graph.html): the win-rate bar and the trend graph.
  - [`docs/design/mockups/m7/board-analysis.html`](../../design/mockups/m7/board-analysis.html): candidate discs, the candidate table, the hovered variation, wheel stepping and the engine card.
- Markers: **[Decided]** was decided by the owner. **[Proposed]** is the author's call and can be overturned. **[To verify]** is checked during the build.

## 1. Intent

M2 to M6 built the path from a clean machine to a running KataGo that follows the board. What the user sees of the analysis is still a plain four-column list. M7 turns it into the screen a Go player reads: paper discs on the board that show at a glance which moves are good and which move the game actually took, a win-rate bar, a graph of how the game swung, and the engine's line for any candidate under the pointer.

It is the last milestone before acceptance (M8): when M7 is done, the whole acceptance path works, from installer to analysis on the board.

## 2. Goals, non-goals, anti-goals

**Goals**

- Analysis follows navigation without flooding KataGo, and no update for one position is ever painted on another (roadmap review focus 4).
- Candidate discs on the board (interface design 5.3), with the outer ring on the move actually played.
- The candidate table (interface design 4.3).
- The win-rate bar with the score lead inside it.
- The trend graph, drawn from whatever positions have results **[Decided]**, as LizzieYzy does. Roadmap O1 is answered: the graph is in Phase 1, the variations tree is not.
- Hovering a candidate (on the board or in the table) shows its principal variation as numbered stones, with captures applied; the wheel steps through it.
- The engine indicator: hover details, and a "stopped at the limit" state that the same click continues (audit G3, K6).
- Keys: Space pauses and resumes; PageUp and PageDown move ten moves (audit G9) **[Decided]**. F toggles the candidates; holding Z hides them (audit G7) **[Decided]**.
- Surface a query KataGo rejects instead of showing an idle panel (M6 design 13).

**Non-goals**

- The variations tree and variation letters (interface design 4.4, 5.4): Phase 2.
- Clicking the board to play a move, and Enter to store a hovered line: Phase 2.
- A timed replay of the hovered line (audit G8) **[Decided]**: not in Phase 1; wheel stepping covers it.
- Keys 1–9 for the candidates' lines, and settings for the candidate count or the line length (audit H4, C2, H5 as settings): Phase 2.
- Whole-game analysis, a persistent cache: Phase 2.
- Ownership, policy heatmaps, move-quality marks on stones.

**Anti-goals** (failure even if everything technically works)

- A disc, table row or bar value from a position other than the one on the board, even for one frame.
- A held arrow key that queues dozens of KataGo queries, so the position the user stops on takes seconds to start analysing.
- A trend graph that looks like data where there is none.
- A hovered line that jitters while the user reads it.
- Panel chrome that takes height from the board, or explanatory text the panel does not need.

## 3. Owner decisions (2026-11-21)

1. **Trend graph in Phase 1.** It needs only some analysed positions, not whole-game analysis.
2. **Win-rate bar**: full panel width; the score lead sits inside the leading side's segment, next to its percentage, and hides itself when the segment is too narrow for both. The uncertainty (误差) is removed.
3. **Graph gaps**: break mode. A stretch with no results is left empty; no bridges.
4. **No verdict line** under the graph ("上一手 白 H8 缓手…" is removed). The legend stays.
5. **Hovered variation**: solid stones with numbers (not translucent).
6. **A restarted search is shown live** (after continue, resume or restart), and the UI should make that feel reasonable (5.2).
7. Everything else in both mockups as proposed: line only (no fill), score axis from the data, hover card and click/drag on the graph, the disc and table rules, wheel stepping, the engine card and the hollow-ring limit state; G7 and G9 in, G8 out.
8. **After the first build (feedback round 1, section 13)**: one black/white perspective for every number; no mistake bars; the legend reads 胜率 and 目差; the played ring flush with the disc; no ring on a variation stone; no lit or dark strip along the board's edges; coordinates can be hidden; nothing in the window can be selected. The wood grain stays as it is until board themes are supported. This supersedes "discs and table in the side to move's view while the bar and graph stay Black's".

## 4. Approaches considered

### 4.1 Where the trend data lives

- **Backend, read from the engine's analysis cache [Proposed, chosen].** The engine already keeps the best (most-visited) result per position, keyed by position. The service reads it for the main line's positions on request. One source of truth, and a reloaded or (in Phase 3) remote client gets the same graph.
- **UI only**, built from the updates it receives. Simpler, but a reload loses it, and a second client would draw a different graph.
- **A separate trend store in the service**, fed from engine events. Duplicates the cache.

### 4.2 Keeping KataGo calm during rapid navigation

- **Rate-limit query submission in the engine actor, leading and trailing edge [Proposed, chosen].** The first position after a quiet period is submitted at once, so a single step costs no latency; during a burst at most one query is submitted per 100 ms, and the position the user stops on is always submitted. Termination of the previous query stays immediate. Cached results are still shown at once.
- **Debounce in the UI.** Only protects one client and delays every single step.
- **Trailing-edge debounce in the engine.** Adds the full delay to every single step.

### 4.3 Drawing candidates and the variation

- **A third canvas layer above the stones [Proposed, chosen]** (M6 design 5.9 planned it). Discs and the variation's numbers redraw on every analysis update without redrawing stones. The variation's stones themselves are drawn on the stone layer from a preview board, so they look identical to game stones. Pure drawing functions, covered by the existing screenshot tests.
- **DOM elements over the board.** Easier hit testing, but text rendering and shadows would not match the canvas stones, and 10 updates a second re-layout the DOM.

## 5. Design

### 5.1 Analysis following navigation (engine)

- `Engine::set_position` keeps its behaviour: terminate the active query at once, emit the cached result for the new position at once if there is one.
- **New: submission rate limit.** The actor remembers when it last submitted a query. If at least `submit_interval` (100 ms **[Proposed]**) has passed, the new position's query is submitted at once. Otherwise a single timer is armed for the remainder; when it fires, the query for whatever position is current then is submitted (if it still wants analysis). A newer `set_position` before the timer fires only changes which position the timer submits. Pause, clear, restart and visit-limit changes cancel or re-arm the timer as they do submission today. `EngineOptions` gains `submit_interval`.
- While a position waits for the timer the state stays `analysing` (the user sees no flicker to ready). The stall watchdog already ignores a moment with no active query (`stalled_at`); a test pins that down.
- Stale updates: the actor already emits only updates of the active query for the current position, and the UI store drops any update whose key differs from the snapshot's (M6). M7 keeps both and adds tests for a burst: 30 positions in 300 ms send at most 4 queries, and no event for an earlier position arrives after the last snapshot.
- **Query errors.** When KataGo answers the current position's query with an error, the engine emits a new event `Rejected { position, message }` (pushed to the UI as `analysisRejected`), and the status snapshot carries the same `rejected` for start-up. An example is a superko repeat under Tromp-Taylor: aji-core checks only simple ko, so such a move reaches KataGo **[To verify]** that KataGo answers it with an error and not with empty results. The UI store keeps the rejection for its position key, like an analysis update, and drops it when the position changes. The panel shows one muted line in place of the candidates: "KataGo 无法分析这个局面", with the message as a tooltip.
- **Principal variation length**: queries ask for 20 moves with `analysisPVLen: 19` (KataGo counts the moves after the first; it accepts the field per query, 1–1000, checked in KataGo's `cpp/command/analysis.cpp` on 2026-11-21). The default without it is 15.

### 5.2 Visit limit and continuing past it (engine and protocol)

- Today the engine stops at the visit limit and returns to `ready`, and the panel shows "已达到每步上限" (M5 design 5.9).
- New request `analysisContinue`: for the current position, set its own target to its cached root visits plus one `visitLimit`, and submit a new query with that `maxVisits`. The engine keeps these targets as absolute visit counts per position key, for as long as it keeps the analysis cache (the app's run, cleared when the engine's files change). A position's effective limit is the larger of its target and the current `visitLimit`; with no limit set there is no limit, and `analysisContinue` does nothing.
- **A new search starts from zero [Decided: show the live search].** KataGo starts every query at zero visits, so after continue, resume or a restart the bar, discs and table show a shallow search that climbs again. The engine keeps showing the live search (its current rule). The UI makes the restart read as intended **[Proposed]**:
  - The engine status and every update carry `previousVisits`: the cached result's root visits for the position when this query started (0 if none).
  - While an active search is below `previousVisits`, the table header shows current and cached visits, for example "总计算量 640 / 1,000". The discs, candidate rows and win-rate bar keep their normal appearance throughout. Once the search catches up or pauses, the header shows the current count.
  - The graph keeps the deeper point throughout (5.3), so it never loses a point to a restart.
- The UI's "limit reached" test (`ready`, a limit set, root visits ≥ the position's limit) moves into the engine: the engine state `ready` gains `limitReached: bool`, so the UI does not need the per-position raise. **[Proposed]** The status line "已达到每步上限" is removed; the dot and its card say it (5.8).

### 5.3 Trend data (backend and protocol)

- The graph has one slot per **main-line node**, not per move number: the main line also holds the root, setup nodes and comment-only nodes, and several nodes can share a move number (`Game::main_line`, `move_number`).
- `GameSession::trend_nodes() -> Vec<TrendNode>`: for each main-line node, `{ moveNumber, mover: Color | null, move: Move | null, key: PositionKey | null }` (no mover or move on a node without one; no key on an illegal node). The key stays in the backend.
- `Engine::summaries(keys) -> Vec<Option<TrendStats>>`: reads the analysis cache through the actor. `TrendStats { winrate, scoreLead, visits }` from the cached update's root info (Black's view).
- New request `gameTrend` → response `trend { nodes: Array<{ moveNumber, mover, move, stats: TrendStats | null }> }`, in main-line order.
- New event `gameTrend` with the same body, pushed by the service whenever the main line's keys or the engine's results can have changed wholesale: a game is opened or created, its rules change (rules are part of the position key), or the engine's files change (the cache is cleared, so the graph empties). A navigation does not push it.
- `GameSnapshot` gains `lineIndex` (the current node's index in the main line) and `nextMove` (the move of the next main-line node that has one, before the next node with a different position; `null` at the end). The UI updates `nodes[lineIndex].stats` from each `analysisUpdate` whose key matches the snapshot's, keeping the update with the most visits (5.2's continue starts a new search from zero; the graph never drops a point because of it).
- x axis: node index. The hover card uses each node's `mover`, `move` and `moveNumber`; colours are never assumed to alternate (handicap, `PL`, setup stones).
- The analysis cache keeps 1,024 positions (enough for two or three long games). An evicted position shows as a gap, which is honest.

### 5.4 The win-rate bar

- Full panel width, 26 px high, 4 px radius, between the header and the graph.
- The black segment's width is Black's win rate. Each side's percentage sits inside its own segment: white text on black at the left end, black text on white at the right end, one decimal.
- The score lead ("领先 3.5 目") sits in the leading side's segment, beside its percentage, in a lighter weight. It is hidden whenever the segment cannot hold both texts with padding (measured, not estimated). With a lead of exactly 0.0 it is hidden.
- Before any result arrives for the position, the bar shows an empty track (no numbers). On an illegal node or with no engine, the bar and graph keep their place; the bar is empty.

### 5.5 The trend graph

Follows the approved mockup, section 2.

- Size: full panel width, 150 px high (100 px when the window is under 720 px tall) **[Proposed]**. Plot margins as in the mockup: axis labels left and right, move-number ticks along the bottom.
- x axis: the main line's nodes, first to last, always the full length (5.3).
- Win rate: the chosen perspective's (13.1), in `text`, 1.6 px, against the left axis (0%, 50%, 100%). Score lead: the same side's, in `score`, 1.4 px, against the right axis, symmetric about 0 so that 0 sits on 50%. The score range is the smallest of ±10, ±20, ±40, ±80, ±160 that holds every plotted lead.
- A node is plotted when its stats have at least 50 visits **[Proposed]**, so a position passed while holding an arrow key does not plot noise. Consecutive plotted moves are joined; any gap breaks the line **[Decided]**. A single isolated point is a small dot.
- The current move: a dashed vertical line in `text-muted`, with a dot on each line where it has a value.
- Legend under the graph: 胜率, 目差, and at the right end the perspective control (13.1). Nothing else on that line **[Decided]**.
- Hover: a hairline at the pointer's move and a small card: "第 72 手 白 R14", then "胜率 49.5% · 目差 −0.1" in the chosen perspective, or "尚未分析" when the move has no plotted point. Click goes to that move; dragging scrubs, sending at most one navigation per animation frame (as held keys do).
- Drawn as SVG in React (a few hundred path points; no chart library).

### 5.6 Candidate discs

Interface design 5.3, as in the mockup section 1.

- Which candidates: KataGo's candidates for the current position, by its order, at most 10, each with at least 2% of the top candidate's visits **[Decided]**. The move actually played next in the record is also shown if KataGo reported it, even below that threshold. The board and the table show the same set.
- Tiers by the side to move's win-rate loss against the best: best; under 2 points (close); 2 to 4 (doubtful); over 4 (poor) **[Decided]**. Fills, rings and text colours as in the design table. The disc's radius matches a stone's.
- The two lines are the settings' `discLines` (default win rate over score lead), in the **chosen perspective** (13.1) **[Decided]**: win rate to one decimal without "%", lead signed to one decimal, visits as `1.2k`.
- The move actually played next (the snapshot's `nextMove`) gets the 2.5 px dark outer ring, flush against the disc's edge (13.3).
- Discs are drawn only while the analysis's position key matches the snapshot's, and not on an illegal node.
- F toggles the discs and the table's rows for the session; holding Z hides them while held. While hidden, the table header shows a muted "已隐藏（F）" **[Proposed]**. Analysis keeps running.

### 5.7 The candidate table

Interface design 4.3, as in the mockup.

- Header line: "候选点" left, "总计算量 3.1k" (root visits) right.
- Columns: rank chip, 落点, 胜率, 目差, 计算量, 与最佳相比. Win rate and lead in the chosen perspective (13.1); the lead in `score`; visits muted.
- The rank chip copies its disc's tier styling. Translucent tiers are drawn in the colour they have over the wood, so they do not turn grey on the panel.
- Last column: "最佳" on the best row, else the difference between the row's shown win rate and the best row's ("−1.8%"; in the other side's perspective a weaker move reads "+1.8%"). The move actually played reads "实战 −1.1%" in bold ("实战 · 最佳" when it is the best), and its chip carries the outer ring.
- Hovering a row previews its line on the board, exactly as hovering its disc (5.8), and highlights the row. Hovering a disc highlights its row.
- Too many rows for the height: the table scrolls; the header line stays.

### 5.8 Hovering a candidate: the variation

- Hover starts when the pointer is over a candidate disc (within the disc's radius) or a table row. The candidate's principal variation is **frozen** at that moment (audit K5); updates do not change it until the pointer leaves and comes back.
- The UI asks `gamePreview` for the first 20 moves of the line (stopping before a pass). From the reply's `captured` lists it can build the board after any prefix itself, so wheel stepping needs no more requests.
- Drawing: the other discs disappear. The line's stones are drawn as ordinary stones on the stone layer, from the preview board **[Decided: solid]**, and each stone still on the board after the shown prefix carries its move number in its centre (Inter semibold, white on black, black on white). A point played twice shows its later number. The game's last-move dot is hidden while previewing. Moves from `illegalAt` on are not shown.
- Wheel while hovering: down adds the next move, up removes the last one, from 1 to the line's length; the first step after hover shows the whole line, and the first wheel-up shows all but the last move **[Proposed]**. The newest stone of a partial line gets a bold number, and no stone gets a ring (13.4). The hovered row shows "3 / 8" beside the point. Leaving the candidate resets it. While hovering a candidate the wheel never navigates the game.
- Leaving the disc and its row ends the preview; the discs return.

### 5.9 The engine indicator

- Colours as now: green while analysing, grey otherwise, red when crashed. New: a **hollow green ring** when the position reached its visit limit (5.2).
- Hover card (shadcn `HoverCard`, opened after 300 ms): a title for the state (分析中, 已暂停, 已达到每步上限, …), then 速度 (visits per second), 计算量 (root visits), 引擎 (KataGo version and backend), 网络 (the network's display name, truncated in the middle). A hint line: "点击暂停", "点击继续", or "点击继续计算 10,000 次" at the limit.
- Speed is measured in the UI from successive updates of the same position: the root-visit increase over the last second of wall time. Shown only while analysing.
- Engine and network names come from a new `running` field on the `engineStatus` response: `{ backend: Backend | null, networkName }` for the files the engine was started with, which the service knows (`startup_files` prefers a development engine over the active set). A development engine has no backend and shows the network's file name. The card asks for the status when it opens.
- Click: pause when analysing, resume when paused, `analysisContinue` at the limit. Space does the same, unless focus is in a text field or the game menu is open.

### 5.10 Keys

Added to M6's navigation keys (M6 design 5.7), with the same focus rule:

| Key | Action |
|---|---|
| Space | The engine indicator's click (pause, resume, continue) |
| PageUp / PageDown | Ten moves back / forward, clamped |
| F | Show or hide candidates |
| Z (held) | Hide candidates while held |

## 6. Earlier deferrals folded in

From the M6 final review (memory list):

- #7 A trackpad pinch (wheel with `ctrlKey`) steps moves: ignore wheel events with `ctrlKey`.
- #8 Pressing ↓ right after the game menu reopens it: return focus to the board area, not the menu trigger, when the menu closes by a selection.
- #11 The drop overlay's fixed colours: move them into theme tokens.
- #12 Audit G9: PageUp and PageDown (5.10).

From the M5 final review:

- #5 The analysis panel flashing before the first engine status: the new panel (bar, graph, table) renders its empty layout until the first status arrives, so nothing jumps.

The other M5 and M6 minors stay deferred; none touches the analysis panel.

## 7. Protocol summary

| Message | Change |
|---|---|
| `analysisContinue` (request) | New: raise the current position's limit by one visit limit and search again |
| `gameTrend` (request) → `trend` | New: `points` per main-line move |
| `gameTrend` (event) | New: pushed when the main line's keys change |
| `analysisRejected` (event) | New: `{ position, message }` |
| `AnalysisUpdate` | Gains `previousVisits` (5.2) |
| `EngineState.ready` | Gains `limitReached` |
| `engineStatus` response | Gains `rejected: { position, message } \| null` and `running: { backend, networkName } \| null` |
| `GameSnapshot` | Gains `lineIndex` and `nextMove` |

TypeScript types are generated with `ts-rs` as before.

## 8. Testing

- **Engine (Rust, fake KataGo)**: the submission rate limit (a burst sends few queries; a single step is immediate; the last position is always analysed); no update for an earlier position after a later `set_position`; `analysisContinue` raises the limit per position; `limitReached`; a rejected query sets `rejected` and the next position clears it; `analysisPVLen` in the query; `summaries`.
- **Service**: `gameTrend` maps the main line to cached points; the event is pushed on open, new and rules change, and not on navigation.
- **UI (Vitest)**: candidate selection (count, threshold, the played move); tiers in both colours to move; the side-to-move view; the bar's lead hiding (measured width stubbed); the trend's runs, breaks, score range and mistake bars; hover freezing; wheel stepping from `captured`; keys; the engine card's speed.
- **Screenshot tests** (M6's `@napi-rs/canvas` setup): discs in the four tiers with and without the played ring; a hovered line with captures; a partial line with the newest-stone ring.
- **Review focus 4**: a UI test that holds → for 2 s against the fake transport and asserts the store never holds analysis for a key other than the snapshot's.

## 9. Exit check

On the Mac, with a local build (`pnpm tauri build`) and KataGo installed by the wizard:

1. Open a pro game; discs, table, bar and graph appear and update while analysing.
2. Hold → through 50 moves and release: the analysis for the final position starts within a second, and no disc from an earlier position appears on the way. Spin the wheel the same way.
3. Step through 30 moves at a normal pace; the graph fills in behind; the gaps left by a fast skim stay empty.
4. Hover the best disc: the line appears and stays still; the wheel steps it; hovering a table row shows the same.
5. Set a visit limit of 1,000; the dot turns to a hollow ring at the limit; clicking continues to 2,000.
6. Space, PageUp/PageDown, F and Z work; the engine card shows speed and names.
7. Both themes look like the mockups.
8. Optional: the same on the PC (left to M8 if skipped).

## 10. Documents this changes

- Roadmap: O1 decided (the trend graph moves into Phase 1; the variations tree stays in Phase 2); M7 status when built.
- Interface design 4.2: the bar without uncertainty and with the lead inside; the graph without the verdict line; 4.1: the engine card and the limit ring; 8: the hover preview is now designed.
- Charter 7.3: the trend graph in Phase 1 (the winrate graph row).
- Audit section 6: G7, G9 done; G8 declined for Phase 1.

## 11. Left to the builder

- Exact hover radius and hit testing of discs at small board sizes.
- The hover card's layout details beyond the mockup.
- The move-number ticks' step on short games (fewer than 50 moves: every 10).
- Where the variation-length and candidate constants live (one module, named).

## 12. Risks

- **Text measuring in the bar** depends on fonts being loaded; measure after `document.fonts.ready`.

## 13. Feedback after the first build, round 1 (2026-11-21)

The owner tried the built app on a pro game and asked for the changes below. Mockup: [`feedback-round-1.html`](../../design/mockups/m7/feedback-round-1.html) (its wood-grain section was declined; its legend still shows 失误, which was removed after it).

### 13.1 One black/white perspective **[Decided: A, everything follows]**

- A UI setting `perspective`, `black` or `white`, default `black`, stored in `settings.json` with the other interface preferences.
- The control sits at the right end of the graph's legend row: a two-part toggle, a small black stone with 黑 and a small white stone with 白; the active half is filled. Clicking a half switches every number at once.
- The discs, the table and both graph lines show the chosen side's win rate and score lead. With Black to move at 54.2% and +1.8, White's perspective shows 45.8 and −1.8.
- Unchanged by the perspective: the candidates and their order; the tiers (disc fill and ring, chip styling), which rate a move for the side that plays it; the win-rate bar, which already shows both sides' numbers with the lead in the leader's segment.
- 与最佳相比 is the difference of the shown win rates (5.7), so it can read "+" in the other side's perspective.

### 13.2 The graph

- No mistake bars, and no 失误 in the legend.
- The legend reads 胜率 and 目差 (en: Win rate, Lead); the toggle names the side.

### 13.3 The played ring

Centred half its width outside the disc's radius, so it touches the disc's ring with no wood between.

### 13.4 The variation

No ring on any variation stone while stepping with the wheel; the newest move keeps its bold number, and the row its "3 / 8".

### 13.5 The board

- No lit strip along the top edge and no dark strip along the bottom: the board is a flat surface. Interface design 5.1 changes with it.
- The grain stays as it is. A different grain comes with board themes, later **[Decided]**.
- A UI setting `showCoordinates`, default on, in 设置 → 界面 under 主题: "棋盘坐标" with 显示 / 隐藏. Hidden, the coordinate band shrinks to a thin margin of wood, so the grid and stones grow.

### 13.6 Selection

Nothing in the window can be selected as text or dragged: panel, table, header, cards, board. Text fields keep normal selection.

### 13.7 Not changed

The player name 丁浩𪚥 the owner saw comes from the test record `gb18030-rare.sgf`, which appends that rare character on purpose to test four-byte GB18030; `gbk-no-ca.sgf` reads 丁浩.
