# M7 Analysis on the Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show KataGo's analysis the way a Go player reads it: tiered candidate discs on the board, the candidate table, a win-rate bar with the lead inside, a trend graph drawn from whatever positions have results, and the hovered candidate's line as numbered stones. Rapid navigation must never flood KataGo or paint stale analysis.

**Architecture:**
- **`aji-engine`.** A leading-and-trailing submission gate (100 ms) in the actor. Per-position visit targets, with `analysisContinue` past the limit and a `limitReached` flag on `ready`. `previousVisits` on each update, so the UI can tell a restarted search that is catching up. A `Rejected` event for a query KataGo refuses. `summaries(keys)` reads the cache for the trend. Queries ask for 20-move lines.
- **`src-tauri`.** `GameSnapshot` gains `lineIndex` and `nextMove`. New `gameTrend` request and event (one entry per main-line node), `analysisContinue`, the `analysisRejected` event, and `rejected` and `running` on the engine status.
- **Interface.** Pure model modules in `src/analysis/` (candidate selection and tiers, trend runs and mistakes, the variation board). A trend store and a view store (hover, step, hidden). A third canvas layer for discs and variation numbers. The panel becomes the bar, the graph and the table. The engine indicator gets a hover card and the limit ring, and the keys are added.

**Tech Stack:**
- Existing: Tauri 2, Tokio, serde, ts-rs, React 19, Zustand 5, i18next, Tailwind 4, shadcn/ui, Vitest, `@napi-rs/canvas` screenshot tests.
- New: shadcn `hover-card` (adds `@radix-ui/react-hover-card`, MIT). No other dependency.

**Spec:** [M7 analysis on the board design](../specs/2026-11-21-m7-analysis-on-board-design.md), approved by the owner on 2026-11-21. Its mockups are [`trend-graph.html`](../../design/mockups/m7/trend-graph.html) and [`board-analysis.html`](../../design/mockups/m7/board-analysis.html). Section numbers below (5.2 and so on) refer to the design.

**Status:** Built on 2026-11-21, except the items under Outstanding.
- **Checks.** Every check passes on the Mac: `cargo fmt --check`, clippy with `-D warnings`, 650 Rust tests, `pnpm lint`, `pnpm typecheck`, 421 TypeScript tests, `cargo deny check licenses`, the npm licence check, the notices staleness check and unchanged generated bindings.
- **Final review.** A fresh review of the whole branch found nothing critical and five important issues. Each was fixed with a test that failed first and folded into the commit it corrects:
  - the engine kept only KataGo's first 20 candidates, which could cut the move played next (it now keeps all a 19×19 board can have);
  - the hover was identified by rank, so a reorder under a still pointer counted as a new hover and the table highlight jumped rows (it is now the move);
  - a hover outlived its candidate when a deeper search dropped it or F or Z hid them, leaving the line up and swallowing the board's wheel;
  - a node that adds no move (a comment) has its parent's key, and got no trend point;
  - an open engine card counted as a busy popover, so the keys stopped while it showed.
  Twelve minor findings are deferred to M8 planning.
- **Mac exit check** with the app from `pnpm tauri build --bundles app` (11.61 MiB, not notarised):
  - Item 2's guarantee runs as automated tests: 120 snapshots in two seconds with late updates never show another position's analysis; a burst of positions sent to the engine ends on the last one, with no update for an earlier position after it; and the submission gate's leading and trailing timing has its own tests. No test yet counts the queries a burst sends (a deferred minor).
  - Discs, table, bar, graph, the hover line and the wheel stepping it, the engine card, the limit ring and Continue, the catching-up fade, Space, PageUp/PageDown, F and Z were walked in `pnpm dev` (the `analysing` scenario) in the browser pane, in light and dark, in Chinese and English, at 1024×700 and 1440×900. The walk found three faults, all fixed: the table's last column wrapped in a 360 px panel, and the fake feed missed a lowered limit and drew the lead on top of the win rate.
- **Feedback round 1** (design 13), after the owner tried the built app:
  - one black/white perspective for the discs, the table and the graph, switched from the legend;
  - no mistake bars, and the legend reads 胜率 and 目差;
  - the played ring flush with its disc, and no ring on variation stones;
  - a flat board without edge strips;
  - a setting to hide the coordinates;
  - no text selection anywhere.
  Each change has a test that failed first. The wood grain was declined until board themes. Walking it in `pnpm dev` found one more fault, now fixed: a board a few dozen pixels wide threw on a negative disc radius and blanked the window. Checks after the round: 653 Rust and 434 TypeScript tests, every other check as above.
- **Outstanding.**
  - The native-window items with real KataGo, which are the owner's steps on the built app: items 1 to 7 of design 9, the wheel and trackpad, whether the engine card opens from the indicator while it is disabled (WKWebView), and the font timing of the first discs; plus the open M6 native-window items.
  - The PC check, optional until M8.

## Global Constraints

- **Everything from M1 to M6 still holds:**
  - language rules, and interface text in both locales;
  - dependency licences and Conventional Commits;
  - `aji-core` depends on no workspace crate and does no I/O;
  - protocol rules: no file paths in `rpc`, errors are `{ code, message }`, `#[ts(type = "number")]` on every `u64`, camelCase JSON.
- **No git worktrees**, for subagents too. Work in `/Users/zepher/personal/Aji` on `feat/m7-analysis-on-board`, which starts from `main` at `467195d`; the design commit `48aff53` is its first commit. Push only when the owner asks.
- **Every user-visible string goes through i18n**, `zh-CN` and `en` in the same commit. Chinese strings quoted in the design or mockups are the `zh-CN` values; write natural English for `en`. ESLint's i18n rule stays clean.
- **Generated TypeScript types** (`src/transport/generated/`) are regenerated by `cargo test` and committed with the Rust change that made them.
- **Colours** come from `src/styles/theme.css` tokens. The only exception is the disc and chip palette of interface design 5.3, which lives in one module (`src/analysis/palette.ts`).
- **Checks before every commit:**
  - `cargo fmt --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo test --workspace`
  - `pnpm lint`, `pnpm typecheck`, `pnpm test`

  Task 10 adds a dependency, so it also runs `node scripts/check-npm-licenses.mjs` and regenerates the notices.
- **Values fixed by the design** (one module each: `crates/aji-engine/src/engine.rs` `EngineOptions` defaults, and `src/analysis/constants.ts`):
  - Submission gate: 100 ms. KataGo `analysisPVLen`: 19, which gives 20 moves in a line.
  - Candidates: at most 10. Each needs at least 2% of the top candidate's visits; the played move is always shown if KataGo reported it.
  - Tiers by the side to move's win-rate loss in percentage points: best; under 2 is close; 2 to 4 inclusive is doubtful; over 4 is poor.
  - Trend:
    - a node is plotted at 50 visits or more;
    - the score range is the first of ±10, ±20, ±40, ±80, ±160 that holds every plotted lead;
    - a mistake bar is drawn when the loss is 2 or more, where loss = max(win-rate drop in points, 2 × lead drop);
    - bar height is `min(18, 3 + 1.2 × loss)` px, and the bar is 2 px wide at 70% `text-muted`;
    - the graph is 150 px tall, or 100 px when the window is under 720 px tall.
  - Variation: at most 20 moves, cut before the first pass.
  - Catching up: 60% opacity, a 200 ms fade back.
  - Engine hover card opens after 300 ms; speed is measured over the last 1,000 ms.
  - Win-rate bar: 26 px tall, 4 px radius.
- **Disc and chip palette** (design 5.3), as `src/analysis/palette.ts`:

  | Tier | Fill | Ring | Text |
  |---|---|---|---|
  | best | `#FDF6E3` | 3.5 px `#B8321F`, plus a drop shadow | `#2B1D0E`, bold |
  | close | `#FBF1D9` | 1.5 px `#B8321F` | `#2B1D0E` |
  | doubtful | `#FBF1D9` at 85% | 1.5 px `#8A6A32` | `#4A3410` |
  | poor | `#FBF1D9` at 50% | 1 px `#8A6A32` at 60% | `#4A3410` |

  - The played move gets a 2.5 px `#2B1D0E` outer ring.
  - Off the board, the chips use the solid colours a translucent fill shows over `#DDB067`: `#F8EAC9` for doubtful and `#ECD0A0` for poor.

## Review Focus

1. **A record with setup nodes, comment-only nodes or a handicap.** The graph has one slot per main-line node, and colours come from each node's mover, never from alternation (tests in Task 4 and Task 9).
2. **Navigating while a candidate is hovered.** The hover and its frozen line end on the new snapshot, and no number from the old position is drawn on the new board (Task 8 test).
3. **A line with a pass or an illegal move**, for example a ko KataGo plays in a line that aji-core's simple-ko rule refuses. The shown line stops before it (Task 8 test).
4. **A 9×9 or 5×5 board.** Discs sit on the points, text fits inside them, and the hit test picks the right disc (Task 7 screenshot and hit-test tests).
5. **A KataGo restart while a search is catching up.** The trend is fetched again and keeps its points. Speed and catching up reset, with no division by zero and no stale "640 / 1,000" (Task 5 test).

---

### Task 1: Engine: submission gate and 20-move lines

**Files:**
- Create: `crates/aji-engine/src/gate.rs`
- Modify: `crates/aji-engine/src/lib.rs` (`mod gate;`), `crates/aji-engine/src/engine.rs`, `crates/aji-engine/src/query.rs`
- Test: `gate.rs` unit tests, `query.rs` unit tests, `crates/aji-engine/tests/engine.rs`

**Interfaces:**
- Produces:
  - `pub(crate) struct SubmitGate`, with `fn new(interval: Duration) -> Self`, `fn earliest(&self, now: Instant) -> Option<Instant>` (`None` means submit now; `Some(t)` means not before `t`), and `fn submitted(&mut self, now: Instant)`.
  - `EngineOptions.submit_interval: Duration`, default `Duration::from_millis(100)`.

- [ ] **Step 1: Write the failing tests.**
  - `gate.rs`:
    - `first_submission_is_immediate`
    - `a_second_within_the_interval_waits_for_the_rest` (submitted at t, asked at t+30 ms, expects `Some(t+100 ms)`)
    - `after_the_interval_it_is_immediate_again`
    - `zero_interval_never_waits`
  - `query.rs`: extend the exact-JSON test with `"analysisPVLen":19`.
  - `tests/engine.rs`. The harness `options()` sets `submit_interval: Duration::ZERO`, so older tests keep their timing. New tests use `start_with(.., EngineOptions { submit_interval: Duration::from_millis(100), ..options() })`:
    - `a_burst_ends_on_the_last_position`: alternate `p1`/`p2` 15 times within 150 ms, ending on `p2`. The last analysis event is for `p2.key()`, and after the final `set_position` returns, no update for `p1.key()` arrives.
    - `a_single_step_is_not_delayed`: `set_position(p2)` produces `analysing` and the first `p2` update within the fake's first report time, with no 100 ms gap.
    - `waiting_for_the_gate_is_analysing_and_not_a_hang`: with `stall_timeout: 150 ms`, a burst then a pause leaves no `NotResponding` crash, and the state goes from `analysing` straight to updates.
- [ ] **Step 2: Run** `cargo test -p aji-engine gate query a_burst a_single waiting_for_the_gate`. Expected: FAIL (no `gate` module, no field).
- [ ] **Step 3: Implement.**
  - The actor gains `gate: SubmitGate` and `submit_at: Option<Instant>`. `analyse_or_idle` calls a new `fn submit_or_defer(&mut self, now: Instant)`. It submits at once when `gate.earliest(now)` is `None`; otherwise it sets `submit_at`.
  - `next_wake` includes `submit_at`. `on_timer` clears it, then submits if the actor still wants analysis (ready, not paused, not cleared, no `current`).
  - The state is `Analysing` while `current.is_some() || submit_at.is_some()`.
  - Pause, clear, `set_files`, stop and process end clear `submit_at`.
  - `submit()` calls `gate.submitted(now)`.
  - `analysis_query` adds `"analysisPVLen": 19`.
- [ ] **Step 4: Run** `cargo test -p aji-engine`. Expected: PASS, the older engine tests included.
- [ ] **Step 5: Commit** `feat(engine): rate-limit query submission and ask for 20-move lines`.

### Task 2: Engine: visit targets, continuing past the limit, `previousVisits`

**Files:**
- Modify: `crates/aji-engine/src/state.rs`, `crates/aji-engine/src/engine.rs`, `crates/aji-engine/src/update.rs`, every `EngineState::Ready { .. }` construction and match (`crates/aji-engine`, `crates/aji-manager`, `src-tauri`), and the TypeScript that reads `ready`
- Test: `crates/aji-engine/tests/engine.rs`, `update.rs` unit tests

**Interfaces:**
- Produces:
  - `EngineState::Ready { version: String, limit_reached: bool }` (JSON `limitReached`).
  - `AnalysisUpdate.previous_visits: u32` (JSON `previousVisits`). It is 0 from `to_update`, and for a cached result emitted on `set_position`.
  - `Engine::continue_analysis(&self) -> Result<(), EngineError>`.

- [ ] **Step 1: Write the failing tests** (fake KataGo, `visit_limit: Some(n)` with `n` below the transcript's final visits):
  - `stopping_at_the_limit_reports_limit_reached`: ends in `Ready { limit_reached: true }`.
  - `continue_searches_to_twice_the_limit`: after `continue_analysis()`, the state is `analysing`; the new query's updates carry `previous_visits` equal to the cached root visits; it ends in `limit_reached: true` with root visits ≥ cached + limit, or with the transcript's final if that is smaller.
  - `a_raised_target_survives_navigation`: continue on `p1`, go to `p2`, come back. `p1` is not searched again below its raised target.
  - `continue_without_a_limit_does_nothing`: returns `Ok`, and no query is sent (the state stays `ready`, `limit_reached: false`).
  - `set_files_clears_targets`.
  - `resume_carries_previous_visits`: pause mid-search, then resume. The new query's updates carry the old cached visits.
- [ ] **Step 2: Run** `cargo test -p aji-engine limit continue previous_visits targets`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The actor gains `targets: HashMap<PositionKey, u32>`.
  - `fn limit_for(&self, key: PositionKey) -> Option<u32>` returns `visit_limit.map(|l| l.max(targets.get(&key).copied().unwrap_or(0)))`. Use it in `wants_analysis`, in `submit` (as `maxVisits`), in `set_visit_limit`'s `reached` check and in the new `limit_reached` computation.
  - `limit_reached` is true when entering `Ready` with the position not cleared, `limit_for` is `Some(l)`, and the cached root visits are ≥ l.
  - `Command::Continue`: when `visit_limit` is `Some(l)`, set `targets[key] = cached_visits + l`, then `analyse_or_idle`. A paused engine stays paused.
  - `queries` becomes `HashMap<String, (Position, u32)>`, holding the cached visits at submit. `on_analysis` sets `update.previous_visits` from it.
  - TypeScript: `src/panel/EngineStatus.tsx` and the other readers of `ready` switch to `engine.limitReached`. The visit-limit comparison in the UI is deleted, and the status line for the limit is removed (design 5.2; the dot shows it in Task 10).
- [ ] **Step 4: Run** `cargo test --workspace && pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): continue past the visit limit and report how deep a search was`.

### Task 3: Engine: rejected queries and trend summaries

**Files:**
- Modify: `crates/aji-engine/src/engine.rs`, `crates/aji-engine/src/cache.rs`, `crates/aji-engine/src/update.rs`, `crates/aji-engine/src/lib.rs` (exports)
- Test: `crates/aji-engine/tests/engine.rs`, `cache.rs` unit tests

**Interfaces:**
- Produces:
  - `#[derive(Serialize, Deserialize, TS)] pub struct Rejection { pub position: PositionKey, pub message: String }`
  - `EngineEvent::Rejected(Rejection)`
  - `EngineStatus.rejected: Option<Rejection>`
  - `#[derive(Serialize, Deserialize, TS)] pub struct TrendStats { pub winrate: f64, pub score_lead: f64, pub visits: u32 }`
  - `Engine::summaries(&self, keys: Vec<PositionKey>) -> Vec<Option<TrendStats>>`
  - `AnalysisCache::peek(&self, key: PositionKey) -> Option<&AnalysisUpdate>` (it does not count as a use)

- [ ] **Step 1: Write the failing tests.**
  - `a_rejected_position_is_reported`: `set_position(unrecorded())` emits `Rejected { position: unrecorded().key(), message }` with a non-empty message, then `ready` with `limit_reached: false`; `status().rejected` matches.
  - `navigating_away_clears_the_rejection`: then `set_position(p1)` makes `status().rejected` `None`.
  - `a_rejection_of_a_terminated_query_is_not_reported`.
  - `summaries_read_the_cache_in_order`: after `p1`'s final, `summaries(vec![p2.key(), p1.key()])` returns `[None, Some(stats)]`, where stats is the cached root info.
  - `peek_does_not_refresh`: an LRU test.
- [ ] **Step 2: Run** `cargo test -p aji-engine rejected rejection summaries peek`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - On `KataLine::QueryError { id: Some(id), message, .. }` for the active query, before `query_ended`: store `Rejection` in the shared snapshot and emit the event.
  - `set_position` and `clear_position` clear `snapshot.rejected`.
  - `Command::Summaries(Vec<PositionKey>, Reply<Vec<Option<TrendStats>>>)` answers from `cache.peek`.
- [ ] **Step 4: Run** `cargo test -p aji-engine`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): report rejected positions and read trend summaries`.

### Task 4: Service and protocol: line, trend, continue, rejection, running engine

**Files:**
- Modify: `src-tauri/src/game.rs`, `src-tauri/src/protocol.rs`, `src-tauri/src/service.rs`, `src/transport/api.ts`, `src/game/testing.ts` (`makeSnapshot` defaults), `src/dev/fakeGame.ts` (answers the new fields and requests)
- Test: `game.rs` and `service.rs` unit tests, `protocol.rs` round-trip tests, `src/transport/api.test.ts`

**Interfaces:**
- Consumes: Task 2 `continue_analysis`; Task 3 `Rejection`, `TrendStats`, `summaries`, `EngineEvent::Rejected`.
- Produces (Rust, with the generated TypeScript):
  - `GameSnapshot.line_index: u32` and `GameSnapshot.next_move: Option<Move>`. `next_move` is the move of the first later main-line node that has one, provided every node in between has none; otherwise it is `None`.
  - `pub struct LineNode { pub move_number: u32, pub mover: Option<Color>, pub mv: Option<Move>, pub key: Option<PositionKey> }` (backend only), and `GameSession::line(&self) -> Vec<LineNode>`.
  - `#[derive(Serialize, TS)] pub struct TrendNode { move_number: u32, mover: Option<Color>, #[serde(rename = "move")] mv: Option<Move>, stats: Option<TrendStats> }`.
  - `#[derive(Serialize, TS)] pub struct RunningEngine { backend: Option<Backend>, network_name: String }`.
  - `Request::AnalysisContinue` gives `Response::Ok`. `Request::GameTrend` gives `Response::Trend { nodes: Vec<TrendNode> }`.
  - New events: `AppEvent::GameTrend { nodes }` and `AppEvent::AnalysisRejected { rejection: Rejection }`.
  - `Response::EngineStatus` gains `rejected: Option<Rejection>` and `running: Option<RunningEngine>`.
- Produces (TypeScript, `api.ts`):
  - `getTrend(t): Promise<TrendNode[]>`
  - `continueAnalysis(t): Promise<void>`
  - `EngineStatus` gains `rejected` and `running`.

- [ ] **Step 1: Write the failing tests.**
  - `game.rs`:
    - `line_has_a_node_per_main_line_node`: a record with `AB` on the root, a comment-only node after move 2 and `PL[W]` gives `move_number`s `[0, 1, 2, 2, 3]` and movers `[None, Black, White, None, White]`.
    - `line_index_and_next_move_follow_navigation`: `next_move` skips the comment-only node and is `None` at the end.
  - `service.rs`:
    - `game_trend_maps_the_line_to_cached_stats` uses the fake engine. Navigate to two nodes, wait for a final, then `GameTrend` has `stats` on exactly those nodes.
    - `game_trend_is_pushed_on_open_new_and_rules_change_not_on_navigate` uses the `Recorder` sink.
    - `analysis_continue_reaches_the_engine`.
    - `a_rejection_is_forwarded_as_analysis_rejected`.
    - `running_names_the_dev_engine_without_a_backend`.
    - `running_names_the_active_set`.
  - `protocol.rs`: JSON shape tests for `gameTrend`, `trend`, `analysisContinue`, `analysisRejected`, and `limitReached` in `ready`.
  - `api.test.ts`: `getTrend` and `continueAnalysis` with the fake transport.
- [ ] **Step 2: Run** `cargo test -p aji line_ game_trend analysis_continue rejection running && pnpm test src/transport`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `publish` stays as it is. `game_new`, `game_open` and `game_set_rules` (when changed) emit `GameTrend` after `publish`, while the session is still locked.
  - `forward_engine_events` maps `Rejected`.
  - `running` is computed when asked, from the same `load_settings` plus installed-record reading that `startup_files` uses:
    - a development engine gives `backend: None` and the model's file name;
    - an active set gives its backend and `networkName` (as `ActiveSummary` names it);
    - otherwise it is `None`.
  - `fakeGame.ts` answers `gameTrend` with one entry per node (`stats: null`) and `analysisContinue` with `ok`, and fills the new snapshot fields.
- [ ] **Step 4: Run** all checks. Expected: PASS, with the generated bindings committed.
- [ ] **Step 5: Commit** `feat: trend, continue and rejection in the protocol, and the line in game snapshots`.

### Task 5: Interface stores: trend, rejection, speed, catching up

**Files:**
- Create: `src/analysis/constants.ts`, `src/analysis/trendStore.ts`, `src/analysis/useTrendSync.ts`
- Modify: `src/engine/engineStore.tsx`, `src/App.tsx` (mount `useTrendSync`), `src/dev/scenarios.ts` and `src/dev/fakeGame.ts` (a fake analysis feed)
- Test: `src/analysis/trendStore.test.ts`, `src/analysis/useTrendSync.test.tsx`, `src/engine/engineStore.test.ts`, `src/dev/fakeGame.test.ts`

**Interfaces:**
- Consumes: Task 4 types and `getTrend`.
- Produces:
  - `constants.ts` exports every value in Global Constraints under these names:
    - `MAX_CANDIDATES = 10`, `MIN_VISIT_SHARE = 0.02`, `CLOSE_LOSS = 2`, `DOUBTFUL_LOSS = 4`
    - `TREND_MIN_VISITS = 50`, `SCORE_RANGES = [10, 20, 40, 80, 160]`
    - `MISTAKE_MIN_LOSS = 2`, `MAX_VARIATION = 20`
    - `CATCHING_UP_OPACITY = 0.6`, `SPEED_WINDOW_MS = 1000`, `HOVER_CARD_DELAY_MS = 300`
  - `useTrendStore` (Zustand) with `nodes: TrendNode[]`, `setNodes(nodes: TrendNode[])`, and `record(lineIndex: number, stats: TrendStats)`. `record` keeps the stats with more visits, and ignores an out-of-range index.
  - `useTrendSync(): void`:
    - fetches on mount;
    - replaces the nodes on a `gameTrend` event;
    - fetches again whenever an `engineState` event enters `starting`;
    - on every `analysisUpdate` whose position equals the game snapshot's `positionKey`, records `{ winrate, scoreLead, visits: rootVisits }` at `snapshot.lineIndex`.
  - The engine store gains:
    - `rejected: Rejection | null`. It is set from an `analysisRejected` event or a status whose position matches, and cleared by `setPosition` and `clearPosition`.
    - `speed: number | null`, in visits per second over the last `SPEED_WINDOW_MS` of updates for the current position. It is `null` with fewer than two samples, a zero time span, or a state other than `analysing`.
    - `createEngineStore(now: () => number = () => performance.now())`.
  - `catchingUp(update: AnalysisUpdate): boolean` in `src/analysis/candidates.ts`, created here and extended in Task 6. It returns `update.rootVisits < update.previousVisits`.
  - Dev scenarios: `fakeAnalysis(snapshot: GameSnapshot): AnalysisUpdate` gives six candidates with PVs on empty points, deterministic per `positionKey`, emitted every 100 ms with rising visits while the dev scenario `analysing` runs, so `pnpm dev` shows discs, the graph and hovering.

- [ ] **Step 1: Write the failing tests.**
  - `trendStore`: `record_keeps_the_deeper_stats`; `record_ignores_a_bad_index`.
  - `useTrendSync`:
    - `fetches_on_mount_and_replaces_on_event`;
    - `refetches_when_the_engine_starts`. A restart refetch that returns the same stats keeps the points (Review Focus 5).
    - `records_only_updates_for_the_current_key`: an update for another key changes nothing.
  - `held_arrow_never_shows_another_positions_analysis` (design 8, review focus 4): over 2 s, 120 snapshots and interleaved analysis updates for earlier keys go into the stores through the fake transport. After every event, the engine store's analysis key is null or equal to the snapshot's key, and the trend store recorded nothing at a wrong `lineIndex`.
  - `engineStore`:
    - `speed_over_the_last_second` with an injected clock: samples at 0 ms with 100 visits and at 500 ms with 600 give 1000.
    - `speed_is_null_after_a_restart_and_on_one_sample`.
    - `rejection_follows_the_position`.
  - `fakeGame`: `fake_analysis_is_deterministic_and_on_empty_points`.
- [ ] **Step 2: Run** `pnpm test src/analysis src/engine src/dev`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified above. Speed samples are dropped on a position change and on any engine state other than `analysing`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: trend, rejection and speed in the interface stores`.

### Task 6: Candidate model and the candidate table

**Files:**
- Create: `src/analysis/palette.ts`, `src/analysis/format.ts`, `src/analysis/viewStore.ts`, `src/panel/RankChip.tsx`, `src/panel/CandidateTable.tsx`
- Modify: `src/analysis/candidates.ts`, `src/App.tsx` (replace `CandidateList`), `src/game/gameStore.ts` (call the view store's `reset()` on a new revision), the locales
- Delete: `src/panel/CandidateList.tsx`, `src/panel/CandidateList.test.tsx`
- Test: `src/analysis/candidates.test.ts`, `src/analysis/format.test.ts`, `src/panel/CandidateTable.test.tsx`

**Interfaces:**
- Consumes: Task 5 constants, the engine store and `catchingUp`; `GameSnapshot.nextColor` and `nextMove`.
- Produces:
  - `type Tier = 'best' | 'close' | 'doubtful' | 'poor'`.
  - `interface ShownCandidate { move: Move; rank: number; tier: Tier; winrate: number; scoreLead: number; visits: number; loss: number; played: boolean; pv: Move[] }`. `rank` is 1-based over the shown set. `winrate` (0–1) and `scoreLead` are in the side to move's view. `loss` is in percentage points, against the best.
  - `shownCandidates(update: AnalysisUpdate, toPlay: Color, nextMove: Move | null): ShownCandidate[]`.
  - `tierFor(loss: number, isBest: boolean): Tier`.
  - `palette.ts`: `TIER_STYLE: Record<Tier, { fill: string; fillAlpha: number; ring: string; ringAlpha: number; ringWidth: number; text: string; bold: boolean; shadow: boolean }>`, plus `PLAYED_RING = { color: '#2B1D0E', width: 2.5 }` and `CHIP_FILL: Record<Tier, string>`.
  - `format.ts`:
    - `formatVisits(n: number, lang: string)`: `840`, `1.2k`, `3.4M`.
    - `formatLead(n: number, lang: string)`: signed with one decimal, using U+2212 for minus.
    - `formatPercent(x: number, lang: string, withSign?: boolean)`.
  - `useViewStore` (Zustand):
    - `hidden: boolean`, `toggleHidden()`, `held: boolean`, `setHeld(b)`;
    - `hover: { rank: number; source: 'board' | 'table' } | null`, `setHover(h)`;
    - `reset()`, which clears `hover` (and, from Task 8, the variation). `useGameStore.apply` calls it on every new revision.

    Task 8 adds `variation` and `step`.
  - `<RankChip tier rank played />` and `<CandidateTable />`.

- [ ] **Step 1: Write the failing tests.**
  - `candidates.test.ts`:
    - `keeps_at_most_ten_with_two_percent_of_top_visits`;
    - `adds_the_played_move_below_the_threshold`;
    - `white_to_move_flips_winrate_and_lead`: Black 0.458 becomes 0.542 for White, and the best is the lowest Black win rate;
    - `tiers_at_two_and_four`: loss 1.99 is close, 2 and 4 are doubtful, 4.01 is poor;
    - `played_is_marked`;
    - `catching_up_compares_previous_visits`.
  - `format.test.ts`: visits in both locales, the U+2212 minus, and `+0.0` shown as `0.0`.
  - `CandidateTable.test.tsx`:
    - the header shows `总计算量 3.1k`, or `640 / 1,000` while catching up;
    - the columns appear in design 4.3 order;
    - `最佳` on the best row, `实战 −1.1%` in bold on the played row, and `实战 · 最佳` when they are the same;
    - rows have `data-catching-up` at 60% opacity while catching up;
    - hidden shows `已隐藏（F）` and no rows;
    - hovering a row sets `hover = { rank, source: 'table' }`, and a board hover (`source: 'board'`) highlights the matching row;
    - a rejected position shows `KataGo 无法分析这个局面` with the message as the title.
- [ ] **Step 2: Run** `pnpm test src/analysis src/panel/CandidateTable`. Expected: FAIL.
- [ ] **Step 3: Implement.** Layout as in mockup section 1 (`board-analysis.html` `.tbl`, `.tr`, `.rk`). The chip copies its disc's tier through `CHIP_FILL` and `TIER_STYLE`. The table body scrolls when it overflows, and the header line stays.
- [ ] **Step 4: Run** all TypeScript checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: candidate selection, tiers and the candidate table`.

### Task 7: Candidate discs on the board

**Files:**
- Create: `src/board/candidates.ts`
- Modify: `src/board/BoardCanvas.tsx` (a third canvas and pointer handling), `src/layout/MainFrame.tsx` (passes the candidates), `src/board/screenshots.test.ts`, `src/board/__screenshots__/` (new baselines)
- Test: `src/board/candidates.test.ts`, `src/board/screenshots.test.ts`

**Interfaces:**
- Consumes: Task 6 `ShownCandidate`, `TIER_STYLE`, `PLAYED_RING`, `formatPercent` and `formatLead`, and the view store; settings `discLines`.
- Produces:
  - `drawCandidates(ctx: CanvasRenderingContext2D, view: BoardView, discs: readonly ShownCandidate[], lines: [DiscField, DiscField], lang: string): void`. Pure: it clears the layer, then draws each disc at its point with a radius equal to `stoneRadius`.
  - `candidateAt(cssX: number, cssY: number, view: Pick<BoardView, 'cssSize' | 'boardSize'>, discs: readonly ShownCandidate[]): number | null`. It returns the rank within the disc's radius.
  - `BoardCanvas` gains `candidates?: readonly ShownCandidate[]`, `discLines`, `onHoverCandidate?(rank: number | null)`.

- [ ] **Step 1: Write the failing tests.**
  - `candidates.test.ts`: `hit_test_inside_and_outside_the_radius` on 19×19 and 9×9 (Review Focus 4); `no_hit_between_points`.
  - Screenshots on `SAMSUNG_58` with the mockup's six candidates (L14 best; M13 played and close; K12; Q10; C10; N11):
    - `discs_in_four_tiers`;
    - `discs_visits_lines` (visits over win rate);
    - `discs_on_9x9` and `discs_on_5x5`.

  Write the baselines with `UPDATE_SCREENSHOTS=1`, look at each PNG against the mockup section 1, then run again without the flag.
- [ ] **Step 2: Run** `pnpm test src/board`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The text is Inter: 600 weight (700 for best) at `0.62 × r` for the top line, and 500 at `0.48 × r` for the bottom line. Win rate has one decimal and no `%`; the lead is signed; visits use `formatVisits`.
  - Discs are drawn only when the analysis key equals the snapshot's `positionKey`, the node is legal, and neither `hidden` nor `held` is set.
  - Pointer move and leave on the board area call `candidateAt` and set or clear `hover = { rank, source: 'board' }`.
  - While `catchingUp(update)` is true, the candidate canvas has CSS `opacity: 0.6`, with `transition: opacity 200ms`. A test asserts the style on both sides of the threshold.
- [ ] **Step 4: Run** all TypeScript checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat(board): candidate discs in four tiers with the played ring`.

### Task 8: Hovering a candidate: the variation and wheel stepping

**Files:**
- Create: `src/analysis/variation.ts`, `src/analysis/useVariation.ts`
- Modify: `src/board/candidates.ts` (`drawVariationNumbers`), `src/board/BoardCanvas.tsx`, `src/layout/MainFrame.tsx`, `src/board/useWheelNavigation.ts`, `src/panel/CandidateTable.tsx` (the `3 / 8` beside the point), `src/analysis/viewStore.ts` (adds `variation: Variation | null` and `step: number | null` with setters; `reset()` clears them), `src/board/screenshots.test.ts`
- Test: `src/analysis/variation.test.ts`, `src/analysis/useVariation.test.tsx`, `src/board/useWheelNavigation.test.tsx`, screenshots

**Interfaces:**
- Consumes: Task 6 view store and `ShownCandidate.pv`, the M6 `previewGame`, Task 7 layers.
- Produces:
  - `linePrefix(pv: Move[]): Move[]`: up to `MAX_VARIATION` moves, cut before the first pass.
  - `interface Variation { moves: Move[]; colors: Color[]; captured: Point[][]; illegalAt: number | null }`.
  - `variationBoard(base: readonly (Color | null)[], size: number, v: Variation, step: number): { stones: (Color | null)[]; numbers: Array<{ point: Point; n: number }>; newest: Point | null }`. It places moves `1..step`, removes each move's `captured` points, and keeps the later number on a point played twice. `newest` is set only when `step < shownLength`. `shownLength` is `illegalAt ?? moves.length`.
  - `useVariation(): void`, mounted in `MainFrame`:
    - when `hover` starts, it freezes the hovered candidate's `linePrefix(pv)` and calls `previewGame`;
    - it drops a reply that arrives after the hover changed or the revision moved;
    - it sets `variation` and `step = shownLength`.
  - `drawVariationNumbers(ctx, view, numbers, newest, stones)`: Inter 600 at `0.42 × spacing`, `#f4f1ea` on black and `#1d1b17` on white. The newest is bold, with a 1.5 px ring at radius `0.37 × spacing`.
  - While a variation shows, `BoardCanvas` draws the variation's stones, hides the last-move dot, and draws no discs.

- [ ] **Step 1: Write the failing tests.**
  - `variation.test.ts`:
    - `prefix_stops_before_a_pass_and_at_twenty`;
    - `captures_are_applied_per_step`, with a constructed capture;
    - `a_point_played_twice_shows_the_later_number`;
    - `illegal_at_limits_the_line` (Review Focus 3);
    - `newest_only_on_a_partial_line`.
  - `useVariation.test.tsx`:
    - `the_line_is_frozen_while_hovering`: a later update with a different PV changes nothing;
    - `leaving_and_returning_takes_the_new_line`;
    - `a_new_snapshot_ends_the_hover_and_drops_a_late_preview` (Review Focus 2).
  - `useWheelNavigation.test.tsx`:
    - `wheel_steps_the_variation_while_hovering`: down from the full line stays at full; up removes one; it never goes below 1;
    - `wheel_with_ctrl_is_ignored` (M6 minor #7);
    - `wheel_navigates_when_not_hovering` (existing behaviour).
  - Screenshots: `variation_full` (L14 line on `SAMSUNG_58`) and `variation_step_3`.
- [ ] **Step 2: Run** `pnpm test src/analysis src/board`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified. The hovered table row shows `step / shownLength` in muted 12 px beside the point while `step < shownLength`.
- [ ] **Step 4: Run** all TypeScript checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: show a hovered candidate's line as numbered stones and step it with the wheel`.

### Task 9: Win-rate bar and trend graph

**Files:**
- Create: `src/analysis/trend.ts`, `src/panel/WinrateBar.tsx`, `src/panel/TrendGraph.tsx`
- Modify: the locales
- Test: `src/analysis/trend.test.ts`, `src/panel/WinrateBar.test.tsx`, `src/panel/TrendGraph.test.tsx`

**Interfaces:**
- Consumes: Task 5 trend store and constants, the engine store and `catchingUp`, the game snapshot, `useFrameNavigate`.
- Produces:
  - `plotRuns(nodes: TrendNode[]): number[][]`: runs of consecutive node indices with `stats.visits >= TREND_MIN_VISITS`.
  - `scoreRange(nodes: TrendNode[]): number`.
  - `mistakes(nodes: TrendNode[]): Array<{ index: number; loss: number }>`: only nodes with a `mover` whose own stats and the previous node's are plotted. The loss is computed in the mover's view.
  - `barTexts(blackWinrate: number, lead: number, segmentPx: { black: number; white: number }, measure: (text: string) => number): { black: string[]; white: string[] }`. The lead text goes into the leader's segment only when `percent + lead + 3 × 9 px padding` fits. It is hidden when the lead is 0.0.
  - `<WinrateBar />` and `<TrendGraph height: number />`.

- [ ] **Step 1: Write the failing tests.**
  - `trend.test.ts`:
    - `runs_break_at_gaps_and_low_visits`;
    - `score_range_steps`: max |lead| 9.9 gives 10, and 10.1 gives 20;
    - `mistakes_use_the_mover_not_alternation`: two White moves in a row after `PL[W]` (Review Focus 1);
    - `mistakes_need_both_neighbours`;
    - `lead_loss_counts_double`.
  - `WinrateBar.test.tsx`:
    - `lead_sits_in_the_leaders_segment`;
    - `lead_hides_when_the_segment_is_too_narrow`, with a stubbed measure and a 360 px panel;
    - `empty_track_before_any_result`;
    - `numbers_fade_while_catching_up`.
  - `TrendGraph.test.tsx`:
    - one `path` per run for each line;
    - a single isolated node is a dot;
    - the dashed current line sits at `lineIndex`;
    - hovering shows `第 72 手 白 R14` and `黑胜率 49.5% · 白领先 0.1 目`, or `尚未分析`;
    - a click navigates to `{ move: node.moveNumber }`;
    - dragging sends at most one navigation per frame;
    - the legend has three items and no verdict text.
- [ ] **Step 2: Run** `pnpm test src/analysis/trend src/panel/WinrateBar src/panel/TrendGraph`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The SVG follows `trend-graph.html` section 2:
    - plot margins: left 52, right 44, top 12, bottom 22;
    - axis labels at 10.5 px;
    - move ticks every 50 nodes (every 10 below 50), in `line`;
    - win rate in `text` at 1.6 px; lead in `score` at 1.4 px;
    - gridlines at 0%, 50% and 100% in `divider-soft` and `hairline`.
  - Measure bar text with a canvas `measureText` in the bar's computed font, after `document.fonts.ready`.
- [ ] **Step 4: Run** all TypeScript checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the win-rate bar and the trend graph`.

### Task 10: Engine indicator: hover card and the limit ring

**Files:**
- Create: `src/components/ui/hover-card.tsx` (via `pnpm dlx shadcn@latest add hover-card`), `src/panel/EngineCard.tsx`
- Modify: `src/panel/EngineIndicator.tsx`, `src/panel/EngineStatus.tsx` (the limit line goes; the rejected line moved to the table in Task 6), the locales, `package.json` and `pnpm-lock.yaml`, `src/assets/notices/third-party.txt` (regenerated)
- Test: `src/panel/EngineIndicator.test.tsx`, `src/panel/EngineCard.test.tsx`

**Interfaces:**
- Consumes: Task 2 `limitReached` and `continueAnalysis`, Task 4 `running`, Task 5 `speed`.
- Produces: `<EngineCard />`, and `engineAction(state: EngineState | null): 'pause' | 'resume' | 'continue' | 'setUp' | null`. This is exported, because Task 11's Space key uses it.

- [ ] **Step 1: Write the failing tests.**
  - `EngineIndicator.test.tsx`:
    - `limit_reached_is_a_hollow_ring` (`data-state="limitReached"`, ring classes);
    - `click_at_the_limit_continues`;
    - `engine_action_table` over every state.
  - `EngineCard.test.tsx`:
    - `analysing_shows_speed_visits_engine_network_and_hint`;
    - `limit_shows_the_continue_hint_with_the_limit` (`点击继续计算 10,000 次`);
    - `dev_engine_has_no_backend_row`;
    - `card_asks_for_the_status_when_it_opens`.
- [ ] **Step 2: Run** `pnpm test src/panel/Engine`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Card layout as in mockup section 5.
  - The network name is truncated in the middle to 24 characters.
  - The card opens after `HOVER_CARD_DELAY_MS`.
  - Run `node scripts/check-npm-licenses.mjs` and regenerate the notices as M5 does.
- [ ] **Step 4: Run** all TypeScript checks and the licence check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: engine card on hover and the stopped-at-limit ring`.

### Task 11: Panel assembly, keys and folded minors

**Files:**
- Create: `src/analysis/AnalysisPanel.tsx`, `src/analysis/useAnalysisKeys.ts`
- Modify:
  - `src/App.tsx` (the panel: header, notice, `AnalysisPanel`, footer);
  - `src/game/useNavigationKeys.ts` (PageUp and PageDown);
  - `src/panel/GameMenu.tsx` (focus returns to the board area after a selection, M6 minor #8);
  - `src/board/DropOverlay.tsx` and `src/styles/theme.css` (overlay tokens, M6 minor #11);
  - the locales.
- Test: `src/analysis/AnalysisPanel.test.tsx`, `src/analysis/useAnalysisKeys.test.tsx`, `src/game/useNavigationKeys.test.tsx`, `src/panel/GameMenu.test.tsx`, `src/App.test.tsx`

**Interfaces:**
- Consumes: Tasks 6, 9 and 10 components; `engineAction`; the view store.
- Produces:
  - `<AnalysisPanel />`: the bar, then the graph (150 px, or 100 px when `window.innerHeight < 720`) with its legend, then the table. It keeps this layout with empty contents before the first status and analysis (M5 minor #5), so nothing jumps.
  - `useAnalysisKeys()`:
    - Space runs `engineAction` (pause, resume or continue);
    - `F` calls `toggleHidden`;
    - `Z` down and up call `setHeld`;
    - it ignores repeats for `F`, and keys in fields and menus, with the same `busy()` rule (moved to `src/game/busy.ts` and shared).

- [ ] **Step 1: Write the failing tests.**
  - `useNavigationKeys.test.tsx`: `page_down_moves_ten_and_clamps`, which sends `{ move: moveNumber + 10 }`, and `page_up_stops_at_zero`.
  - `useAnalysisKeys.test.tsx`:
    - `space_pauses_resumes_and_continues`;
    - `space_in_a_text_field_types`;
    - `f_toggles_hidden`;
    - `z_hides_while_held`.
  - `GameMenu.test.tsx`: `arrow_down_after_choosing_does_not_reopen_the_menu`.
  - `AnalysisPanel.test.tsx`:
    - `empty_layout_before_the_first_status`;
    - `graph_is_100px_under_720`;
    - `illegal_node_keeps_the_layout_with_an_empty_bar`.
  - `App.test.tsx`: update the panel assertions.
- [ ] **Step 2: Run** `pnpm test src/analysis src/game src/panel src/App`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified. The illegal-node line (M6) stays above the bar.
- [ ] **Step 4: Run** all checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the analysis panel, Space, PageUp/PageDown, F and Z`.

### Task 12: Documents, final review and the Mac exit check

**Files:**
- Modify:
  - `docs/superpowers/plans/2026-11-19-phase-1-roadmap.md`: O1 decided, and the M7 status;
  - `docs/superpowers/specs/2026-11-19-aji-ui-design.md`: 4.1 for the engine card and limit ring; 4.2 for the bar without uncertainty, the lead inside, and the graph without a verdict line; 8, where the hover preview is now designed;
  - `docs/superpowers/specs/2026-11-19-aji-project-charter-design.md`: 7.3, the winrate graph in Phase 1;
  - `docs/audits/phase-1-lizzieyzy-menu.md`: G7 and G9 done, G8 declined for Phase 1;
  - this plan's Status.

- [ ] **Step 1: Update the documents** listed above, with the exact wording of design section 10.
- [ ] **Step 2: Run every check.** Paste the counts into this plan's Status: `cargo fmt --check`, clippy, `cargo test --workspace`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `cargo deny check licenses`, the npm licence check, the notices staleness check and unchanged generated bindings.
- [ ] **Step 3: Final review.** Hand a fresh reviewer the whole branch, the design and this plan's Review Focus. Fix each important finding with a test that fails first, and fold the fix into the commit it corrects. Record the deferred minors in memory for M8.
- [ ] **Step 4: Walk the dev build.** Run `pnpm dev` in the browser pane with the fake analysis feed, in both themes, in Chinese and English, at 1024×700 and 1440×900. Check every frame of both mockups, and fix what differs.
- [ ] **Step 5: Mac exit check.** Run design section 9 against `pnpm tauri build --bundles app`. Items that need the owner's hands (holding keys against a real KataGo, the trackpad, the native card) go to the owner as a list.
- [ ] **Step 6: Commit** `docs: mark M7 analysis on the board done`.
