# Phase 2 M2 Whole-Game Analysis, Cache and Review Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyse a game once and remember it. Whole-game analysis on Aji's single KataGo (with a deeper pass over big swings), a persistent SQLite cache, the swing list, the candidate list's sorting and columns, the next-move hint, ownership with the position estimate, final scoring, and LizzieYzy `LZ` import and export.

**Architecture:**
- **`aji-core`** (pure, no I/O):
  - the position key with KataGo's full rule set;
  - the scoring function for both the estimate and final scoring;
  - the `LZ` text format.
- **`aji-engine`:**
  - ownership in every query;
  - the move loss;
  - the engine identity;
  - a SQLite store on its own thread behind the actor's LRU;
  - the job queue inside the actor (design 4.1 A): the board's query first, one job query queued ahead, termination on navigation.
- **`src-tauri`:**
  - plans jobs (range, one side, the fill and boost passes);
  - stops them on the design's events;
  - pushes the incremental `TrendNodes` event with losses;
  - serves the new requests;
  - wires `LZ` into open and export.
- **The interface** adds the job panel, the strip and status, the candidate list's changes, the `swings` panel, the next-move disc, ownership and the estimate, the scoring mode, settings rows, menus and commands. It never computes a loss or a score.

**Tech Stack:**
- Existing: Tauri 2, Tokio, serde, ts-rs, React 19, Zustand 5, i18next, Tailwind 4, Vitest with Testing Library, `@napi-rs/canvas` screenshot tests, the fake KataGo.
- New dependencies:
  - `rusqlite` with the `bundled` feature (MIT; SQLite is public domain);
  - `sha2` 0.11 for the network digest (MIT or Apache-2.0). It is already used by `aji-manager` and `aji-manifest-tool`, so it adds nothing to the lockfile.

**Spec:** [Phase 2 M2 design](../specs/2026-11-23-p2-m2-analysis-design.md), approved by the owner on 2026-11-23.
- Its mockups are in [`docs/design/mockups/p2-m2/`](../../design/mockups/p2-m2/).
- Section numbers below (5.3 and so on) refer to the design.
- The phase plan is [Phase 2 plan](2026-11-21-phase-2-roadmap.md).

## Global Constraints

- **Everything from Phase 1 and P2 M1 still holds:**
  - language rules, and interface text in both locales;
  - dependency licences (`cargo deny check licenses`, the npm licence check, the notices staleness check);
  - Conventional Commits ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - `aji-core` depends on no workspace crate and does no I/O;
  - protocol rules: no file paths in `rpc`, errors are `{ code, message }`, camelCase JSON, ts-rs bindings regenerated.
- **No git worktrees**, for subagents too. Work in `/Users/zepher/personal/Aji` on `feat/p2-m2-analysis`. Its first commit is the design and mockups, and this plan is its second. Push only when the owner asks.
- **No "·" in any interface text**, in either locale, the native menu labels or a mockup (design 2, the owner's rule).
- **Every user-visible string goes through i18n**, `zh-CN` and `en` in the same commit.
  - Chinese strings quoted in the design or mockups are the `zh-CN` values; write natural English for `en`.
  - Native menu labels live in `src-tauri/src/platform/menu.rs` `Labels`, in both languages, as today.
- **LizzieYzy is a feature reference only.** The `LZ` format is implemented from design 5.11's description. LizzieYzy's code is neither copied nor translated, and none of it enters the repository.
- **Values fixed by the design**, in `crates/aji-engine/src/job.rs` or `src/job/constants.ts` as their side needs:

  | Value | Setting |
  |---|---|
  | Job budget default | 500 visits |
  | Boost default | on, swing over 10 percentage points, 3000 visits |
  | Job queries in flight | at most 2 (one queued ahead) |
  | Job progress reports from KataGo | every 1 s (watchdog only, never shown) |
  | `JobProgress` and `TrendNodes` events | at most every 250 ms |
  | Ownership quantisation | `round(v × 127)` as `i8` |
  | Settled ownership (the 0.6 rule) | \|v\| ≥ 0.6, so \|q\| ≥ 76 in quantised form |
  | Cache cap default | 1 GB; eviction in batches of 10% of rows, least recently used first |
  | Swing list thresholds | 5 percentage points (win rate), 2 points (score) |
  | Done status | `已分析全局` shows for 4 s |

- **Checks before every commit:**
  - `cargo fmt --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo test --workspace`
  - `pnpm lint`, `pnpm typecheck`, `pnpm test`

## Review Focus

1. **Holding → through the game while a job runs.** Every step terminates the job's queries and requeues their positions. In-flight job queries never exceed 2. No position is counted done twice, and the job resumes once the user stops. Test in Task 8 (`rapid_navigation_never_leaks_queries`).
2. **A late final after a terminate or a KataGo restart** (a stale id). It is stored if it is better, but it never counts as a job item done, and it is never shown as the current position's analysis. Test in Task 8 (`a_stale_final_is_stored_but_not_counted`).
3. **Malformed or truncated `LZ` text:** a missing line 2, non-numeric fields, `1.2x` visits, or an ownership list of the wrong length. The node is skipped, the rest of the file imports, and opening never fails. Test in Task 4 (`malformed_lz_is_skipped_not_fatal`).
4. **Passes, setup-only nodes, comment-only nodes and an illegal node** in a job's range and in the loss. Positions are planned per distinct position, a node without a move has no loss, and an illegal node is neither searched nor breaks the line. Test in Task 9 (`plan_skips_illegal_and_shares_comment_positions`).
5. **Lowering the cache cap below the file's size while a job is writing.** Eviction runs between batches and never deletes a row written in the same batch, and the open game's graph keeps what is in memory. Test in Task 6 (`lowering_the_cap_mid_write_keeps_the_new_batch`).

---

### Task 1: KataGo's full rule set in the position key

**Files:**
- Create: `crates/aji-core/src/katarules.rs`
- Modify: `crates/aji-core/src/position.rs` (`key()` encodes `KataRules` instead of `rules_byte`), `crates/aji-core/src/lib.rs`
- Test: in `katarules.rs` and `position.rs`

**Interfaces:**
- Produces:
  - `pub struct KataRules { pub ko: KoRule, pub scoring: ScoringRule, pub tax: TaxRule, pub suicide: bool, pub has_button: bool, pub white_handicap_bonus: HandicapBonus }`, with `KoRule { Simple, Positional, Situational }`, `ScoringRule { Area, Territory }`, `TaxRule { None, Seki, All }` and `HandicapBonus { Zero, N, NMinusOne }`.
  - `impl From<Rules> for KataRules`. Each preset gets KataGo's documented values for that rules name; the test pins them.
  - `KataRules::key_bytes(&self) -> [u8; 6]`.
  - `Position::key()` keeps its signature. Its byte layout replaces the one rules byte with the six from `key_bytes`.

- [ ] **Step 1: Write the failing tests:**
  - `presets_map_to_katagos_documented_rules` (all four presets, every field)
  - `key_is_pinned_by_a_test_vector` (one fixed position, its 16-hex-digit key written in the test)
  - `japanese_and_korean_keys_differ_only_if_their_rules_do` (they share a key exactly when KataGo's rules for them are equal)
  - `komi_and_rules_still_change_the_key`
- [ ] **Step 2: Run** `cargo test -p aji-core katarules position`. Expected: FAIL.
- [ ] **Step 3: Implement** `katarules.rs` and the new `key()`. Queries keep sending the preset's name (`Rules::katago_name`), as the fake KataGo's transcripts match on it.
- [ ] **Step 4: Run** `cargo test --workspace`. Expected: PASS. Any test that pinned an old key value is updated to the new value, and the commit message says so.
- [ ] **Step 5: Commit** `feat(core): key positions by KataGo's full rule set`.

### Task 2: Scoring for the estimate and final scoring

**Files:**
- Create: `crates/aji-core/src/game/score.rs`
- Modify: `crates/aji-core/src/game/mod.rs`
- Test: in `score.rs`

**Interfaces:**
- Consumes: `Board` (`crates/aji-core/src/game/board.rs`), `Scoring`, `Komi`, `Point`, `Color`.
- Produces:
  - `pub struct ScoreSide { pub stones: u32, pub territory: u32, pub dead: u32, pub prisoners: u32, pub total: f64 }`
  - `pub struct Score { pub black: ScoreSide, pub white: ScoreSide, pub komi: f64, pub margin: f64, pub owners: Vec<Option<Color>> }`
    - `margin` is Black's total minus White's (komi included); positive means Black wins.
    - `owners` is per point, row by row, after dead stones are removed.
  - `pub const SETTLED: i8 = 76;` (the 0.6 rule)
  - `pub fn group_of(board: &Board, at: Point) -> Vec<Point>`
  - `pub fn suggested_dead(board: &Board, ownership: &[i8]) -> Vec<Point>`: stones whose ownership is at least `SETTLED` for the other colour.
  - `pub fn final_score(board: &Board, dead: &[Point], scoring: Scoring, komi: Komi, captures: (u32, u32)) -> Score`. Regions are flood-filled after removing `dead`. A region bordered by one colour's live stones only is that colour's; any other region is neutral.
  - `pub fn estimate(board: &Board, ownership: &[i8], scoring: Scoring, komi: Komi, captures: (u32, u32)) -> Score`. Dead stones come from `suggested_dead`. Every empty or dead point goes to the side its ownership is above 0 for; exactly 0 is neutral.
  - **Area:** `total = stones + territory`.
  - **Territory:** `total = territory (empty points only) + dead (opponent stones removed) + prisoners`.
  - Komi is added to White's total in both.

- [ ] **Step 1: Write the failing tests**, on the mockup's 9×9 position (`final-scoring.html`'s `ROWS`, White C5 and Black H4 dead, captures Black 2, White 3):
  - `area_score_matches_the_mockup`: Black 40 (13 + 27), White 41 + 7.5, margin −8.5.
  - `territory_score_matches_the_mockup`: Black 26 + 1 + 2 = 29, White 27 + 1 + 3 + 6.5 = 37.5, margin −8.5.
  - `a_region_touching_both_colours_is_neutral` (H4 marked alive: area Black 41 (14 + 27), White 13 + 7.5 = 20.5, margin 20.5)
  - `toggling_a_group_toggles_every_stone` (`group_of` on C5)
  - `suggested_dead_uses_the_settled_threshold` (75 is not dead, 76 is)
  - `estimate_assigns_every_point_by_sign`
  - `empty_board_scores_komi_only`
- [ ] **Step 2: Run** `cargo test -p aji-core score`. Expected: FAIL.
- [ ] **Step 3: Implement** `score.rs`.
- [ ] **Step 4: Run** `cargo test -p aji-core`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): score a position for the estimate and final scoring`.

### Task 3: The move loss

**Files:**
- Create: `crates/aji-engine/src/loss.rs`
- Modify: `crates/aji-engine/src/lib.rs`, `crates/aji-engine/src/update.rs` (export `Loss` with ts-rs)
- Test: in `loss.rs`

**Interfaces:**
- Consumes: `TrendStats` (Black's view; `winrate` in 0..1), `AnalysisUpdate`, `Candidate`.
- Produces:
  - `#[derive(Serialize, Deserialize, TS, Clone, Copy, PartialEq, Debug)] pub struct Loss { pub winrate: f64, pub score: f64 }`
    - in percentage points and points;
    - positive is a loss for the mover, negative a gain.
  - `pub fn move_loss(before: &TrendStats, after: &TrendStats, mover: Color) -> Loss` (design 5.1).
  - `pub fn loss_from_candidates(before: &AnalysisUpdate, played: Move, mover: Color) -> Option<Loss>`
    - the before-position's root win rate and lead minus the played candidate's, in the mover's view;
    - `None` when the played move isn't listed (design 5.3, one side).

- [ ] **Step 1: Write the failing tests:**
  - `black_loses_when_blacks_winrate_drops`
  - `white_loses_when_blacks_winrate_rises`
  - `a_gain_is_negative`
  - `loss_from_candidates_uses_the_played_candidate`
  - `an_unlisted_move_has_no_candidate_loss`
- [ ] **Step 2: Run** `cargo test -p aji-engine loss`. Expected: FAIL.
- [ ] **Step 3: Implement** `loss.rs`.
- [ ] **Step 4: Run** `cargo test -p aji-engine`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): define a move's loss once`.

### Task 4: The `LZ` format

**Files:**
- Create: `crates/aji-core/src/sgf/lizzie.rs`
- Modify: `crates/aji-core/src/sgf/mod.rs`; `crates/aji-core/tests/fixtures/sgf/lizzie.sgf` (replaced); `crates/aji-core/tests/fixtures/sgf/SOURCES.md`; `crates/aji-core/tests/sgf_fixtures.rs`
- Test: in `lizzie.rs` and `sgf_fixtures.rs`

**Interfaces:**
- Produces:
  - `pub struct LzMove { pub point: String, pub visits: u32, pub winrate: f64, pub prior: f64, pub score_lead: Option<f64>, pub pv: Vec<String> }`
    - `winrate` and `prior` are 0..1, side to move;
    - `point` and `pv` are GTP coordinates as written.
  - `pub struct LzData { pub engine: String, pub mover_winrate: f64, pub visits: u32, pub score_lead: Option<f64>, pub score_stdev: Option<f64>, pub moves: Vec<LzMove>, pub ownership: Option<Vec<f64>> }`
    - `mover_winrate` is a percentage, as written: 100 minus the side to move's (design 5.11);
    - `score_lead` is the side to move's.
  - `pub fn parse_visits(text: &str) -> Option<u32>`: `"850"` → 850, `"1.3k"` → 1300, `"13k"` → 13000, `"1.5m"` → 1500000.
  - `pub fn format_visits(visits: u32) -> String`: the inverse of the design's four forms; 9,950 and up are whole thousands.
  - `pub fn parse_lz(text: &str, points: usize) -> Option<LzData>`: `None` for anything malformed, including ownership whose length isn't `points`.
  - `pub fn write_lz(data: &LzData) -> String`

- [ ] **Step 1: Replace the fixture.** Write `lizzie.sgf` by hand from design 5.11. It must have:
  - a root `LZOP`;
  - `LZ` on several moves, using all four visit forms;
  - one `LZ` with ` ownership ` and 361 values;
  - a move node without analysis;
  - `LZ2` and `LZOP2` on one node (kept, not read).

  Update `SOURCES.md` to say the file was written by hand from the format described in the design, after the owner asked for it to be reproduced from LizzieYzy's behaviour (2026-11-23).
- [ ] **Step 2: Write the failing tests:**
  - `visits_parse_every_form`
  - `visits_format_round_trips_at_the_boundaries` (999, 1000, 9949, 9950, 9999999, 10000000)
  - `header_winrate_is_the_movers`
  - `candidate_lines_parse_with_and_without_pv_visits`
  - `ownership_parses_when_present`
  - `write_then_parse_is_identity`
  - `malformed_lz_is_skipped_not_fatal` (review focus 3)
  - `the_fixture_parses_every_lz_node` (`sgf_fixtures.rs`)
- [ ] **Step 3: Run** `cargo test -p aji-core lizzie sgf_fixtures`. Expected: FAIL.
- [ ] **Step 4: Implement** `lizzie.rs`.
- [ ] **Step 5: Run** `cargo test -p aji-core`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(core): read and write LizzieYzy's LZ analysis format`.

### Task 5: Ownership in queries, and a synthetic fake KataGo

**Files:**
- Modify:
  - `crates/aji-engine/src/query.rs`: `analysis_query` gains `ownership: bool` and `report_every: Option<Duration>`; `None` sends no `reportDuringSearchEvery`;
  - `crates/aji-engine/src/response.rs`: `RawAnalysis.ownership: Option<Vec<f64>>`;
  - `crates/aji-engine/src/update.rs`: `AnalysisUpdate.ownership: Option<Vec<i8>>`, quantised by `round(v × 127)`, Black's view;
  - `crates/aji-engine/src/bin/fake-katago.rs`: a `synthesize` scenario field.
- Create: `crates/aji-engine/tests/fixtures/scenarios/synthetic.json`; a re-recorded transcript with ownership in `crates/aji-engine/tests/fixtures/katago/1.18.2-metal/analysis-ownership.jsonl`
- Test: `query.rs`, `response.rs`, `crates/aji-engine/tests/fake_katago.rs`

**Interfaces:**
- Produces:
  - `analysis_query(id, position, max_visits, report_every: Option<Duration>, ownership: bool) -> Result<String, CoreError>`
  - `AnalysisUpdate { …, ownership: Option<Vec<i8>> }`. The ts-rs binding is regenerated.
  - **The fake's synthetic mode:**
    - when `synthesize: true` and no recorded query matches, it answers any position;
    - the answer is deterministic, derived from a hash of the moves;
    - it has `moveInfos` with three candidates, and `ownership` when asked;
    - it reports during the search at the query's `reportDuringSearchEvery`, and finishes at `maxVisits` at the scenario's `speed` in visits per second;
    - it honours `terminate`.

- [ ] **Step 1: Record the transcript** on the Mac with Homebrew KataGo:

  ```bash
  node scripts/record-katago-transcript.mjs --katago "$(brew --prefix)/bin/katago" --model <the installed network> --config crates/aji-engine/tests/fixtures/katago/record.cfg --out-dir /tmp/aji-own
  ```

  The script's query list gains one query with `"includeOwnership": true`, and one that plays a superko-repeating move under Chinese rules (M7 minor 11). Copy the result to `analysis-ownership.jsonl` and keep it under the script's size cap.
- [ ] **Step 2: Write the failing tests:**
  - `query_asks_for_ownership_when_told`
  - `query_without_report_interval_omits_it`
  - `ownership_is_quantised_to_black_view` (from the new transcript; a White-to-move position flips sign only if the launch override did not already make it Black's: assert against the transcript's raw values)
  - `synthetic_fake_answers_any_position_deterministically`
  - `synthetic_fake_honours_terminate`
  - `real_katago_rejects_superko_as_recorded` (M7 minor 11: the recorded error answer reaches `EngineEvent::Error` and the engine stays usable)
- [ ] **Step 3: Run** `cargo test -p aji-engine`. Expected: FAIL.
- [ ] **Step 4: Implement.** Board queries keep their 100 ms reports, and every query asks for ownership (design 5.7).
- [ ] **Step 5: Run** `cargo test -p aji-engine`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(engine): ask KataGo for ownership, and let the fake answer any position`.

### Task 6: The persistent store

**Files:**
- Create: `crates/aji-engine/src/store.rs` (the thread, schema and rules), `crates/aji-engine/src/identity.rs`
- Modify: `crates/aji-engine/Cargo.toml` (`rusqlite` bundled, `sha2 = "0.11"`), `deny.toml` only if needed, `crates/aji-engine/src/lib.rs`
- Test: in `store.rs`, `identity.rs`

**Interfaces:**
- Produces:
  - `pub struct EngineIdentity { pub network: [u8; 32], pub config: u64 }`
  - `pub fn identity_of(model: &Path, config: &Path) -> io::Result<EngineIdentity>`. Blocking.
    - `network` is the model file's SHA-256.
    - `config` hashes the config's `key = value` lines, sorted, without the performance and logging keys: `numSearchThreads*`, `numAnalysisThreads`, `nnMaxBatchSize`, `nnCacheSizePowerOfTwo`, `nnMutexPoolSizePowerOfTwo`, keys starting `log`, and device-selection keys.
  - `pub struct Row { pub update: AnalysisUpdate, pub imported: bool, pub katago_version: String }`
  - `pub fn replaces(old: &Row, new: &Row) -> bool`. A pure function holding design 5.2's rules:
    - more visits wins, or equal visits and final;
    - an imported row gives way to a fresh row with more visits, or a final one;
    - a fresh row never gives way to an imported one.
  - `pub enum ClearScope { Keys(Vec<PositionKey>), All }`
  - `pub struct CacheStats { pub used_bytes: u64, pub cap_bytes: u64, pub persistent: bool, pub reason: Option<String> }`
  - `pub struct Store`: a cloneable handle to the store thread.
    - `Store::open(path: PathBuf, cap_bytes: u64) -> Store`. Never fails. On error it runs in memory, and `stats().persistent` is false with the reason.
    - `get(&self, id: &EngineIdentity, key: PositionKey, reply: impl FnOnce(Option<Row>) + Send + 'static)`: replies on the store thread. The actor passes a closure that posts a `Report`.
    - `get_many(&self, id, keys: Vec<PositionKey>) -> oneshot::Receiver<Vec<Option<TrendStats>>>`
    - `put(&self, id, row: Row)`: batched, committed at least every 250 ms.
    - `clear(&self, id, scope)`, `set_cap(&self, bytes)`, `stats(&self) -> oneshot::Receiver<CacheStats>`
  - **The schema** is the builder's (design 11). It needs one row per `(identity, key)`, the last-used time, and the byte size for the cap. Ownership is a BLOB of `i8`.
  - **The file is opened** in WAL mode with a 5 s busy timeout. A file that fails its integrity check on open is renamed `analysis.corrupt-<unix time>.sqlite` and a new one is created.

- [ ] **Step 1: Write the failing tests**, on a temp dir:
  - `replaces_follows_the_design` (table-driven: fresh/imported × fewer/equal/more visits × final or not)
  - `a_reopened_file_keeps_its_rows`
  - `rows_are_per_identity` (another network sees none)
  - `the_cap_evicts_least_recently_used`
  - `lowering_the_cap_mid_write_keeps_the_new_batch` (review focus 5)
  - `clear_keys_and_clear_all`
  - `a_corrupt_file_is_renamed_and_replaced`
  - `an_unwritable_path_runs_in_memory_with_a_reason`
  - `two_handles_on_one_file_both_write` (WAL; two `Store::open` on the same path)
  - `identity_ignores_thread_counts`
- [ ] **Step 2: Run** `cargo test -p aji-engine store identity`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules. The thread owns the connection, and nothing else touches it.
- [ ] **Step 4: Run** `cargo test --workspace && cargo deny check licenses`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): keep analysis in a SQLite store`.

### Task 7: The store behind the actor

**Files:**
- Modify: `crates/aji-engine/src/engine.rs`, `crates/aji-engine/src/cache.rs` (the in-memory LRU stays, as the hot layer)
- Test: `crates/aji-engine/tests/engine.rs`

**Interfaces:**
- Consumes: Task 6's `Store`, `EngineIdentity`, `Row`, `replaces`.
- Produces:
  - `Engine::spawn` takes a `Store`.
  - `Engine::set_files(files: Option<EngineFiles>, identity: Option<EngineIdentity>)`. The service computes the identity on a blocking thread before calling.
  - `Engine::set_position(position: Position, next: Option<(Position, Move)>)`: the record's next position and move, for 5.6.
  - `AnalysisUpdate.next: Option<NextResult>`, with `pub struct NextResult { pub stats: TrendStats, pub loss: Loss }`, filled from the cache.
  - `EngineEvent::Stored { key: PositionKey, stats: TrendStats }`: emitted when the store accepts a better row for any position.
  - `Engine::summaries(keys)` reads LRU first, then `get_many`.
  - `Engine::clear(scope: ClearScope)`, `Engine::cache_stats() -> CacheStats`, `Engine::set_cache_cap(bytes)`.
  - **On a hot-layer miss** in `set_position`, the actor asks the store and holds the submission until the reply arrives (a new `Report::Cached`). If the reply takes over 200 ms, it submits anyway.
  - **Imported rows** are offered through `Engine::import(rows: Vec<Row>)`.

- [ ] **Step 1: Write the failing tests** (fake KataGo, `normal.json` and `synthetic.json`):
  - `a_restart_of_aji_shows_the_stored_result_without_searching` (spawn, analyse, shut down, spawn on the same file, `set_position`; no query is sent before the cached update)
  - `another_identity_searches_again`
  - `next_result_comes_with_the_update_and_follows_new_results`
  - `stored_events_fire_for_better_rows_only`
  - `a_progress_report_does_not_replace_an_imported_row` (design 5.2)
  - `clearing_the_current_position_restarts_its_search`
  - `continue_analysis_resubmits_while_a_query_is_in_flight` (M7 minor 2)
  - `a_cached_update_keeps_its_stored_previous_visits` (M7 minor 12)
  - `a_burst_of_30_positions_in_300ms_sends_at_most_4_queries` (M7 minor 11)
- [ ] **Step 2: Run** `cargo test -p aji-engine --test engine`. Expected: FAIL.
- [ ] **Step 3: Implement.** Every `offer` also goes to `Store::put` when `replaces` holds. The M2 N3 throttle re-check is recorded in this plan's Status, with any change justified by a test.
- [ ] **Step 4: Run** `cargo test --workspace`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): read and write the store from the actor`.

### Task 8: The job queue in the actor

**Files:**
- Create: `crates/aji-engine/src/job.rs` (pure queue state)
- Modify: `crates/aji-engine/src/engine.rs`, `crates/aji-engine/src/state.rs` only if a field is needed
- Test: in `job.rs`; `crates/aji-engine/tests/engine.rs`

**Interfaces:**
- Produces:
  - `pub struct JobItem { pub position: Position, pub line_index: u32, pub visits: u32 }`
  - `pub struct JobPlan { pub items: Vec<JobItem> }`
  - `Engine::run_job(plan: JobPlan) -> Result<(), EngineError>`: replaces any running job's queue. `Engine::stop_job()`.
  - `pub enum JobRun { Running, Waiting, Paused, Done, Stopped }`
  - `EngineEvent::Job(JobStatus)`, with `pub struct JobStatus { pub run: JobRun, pub done: u32, pub total: u32, pub working: Option<u32>, pub queued: Vec<u32> }`. `working` and `queued` are line indexes.
  - **Scheduling** (design 5.3):
    - The board's query runs first until the current position has `min(board limit, job budget)` visits. A board limit of 不限 counts as the budget while a job runs.
    - After that, job items run, topped up to 2 in flight.
    - `set_position` terminates both job queries and puts their items back at the front.
    - Items whose cached visits are at their target are skipped and counted done.
    - Job queries send `report_every: Some(1 s)` and `ownership: true`. Their reports feed the watchdog and the store, never `EngineEvent::Analysis`.
    - While only job queries run, the state is `Analysing`.
    - Pause holds the job. A KataGo restart keeps the queue and resubmits.

- [ ] **Step 1: Write the failing unit tests** in `job.rs`:
  - `items_at_target_are_skipped_and_counted` (imported rows included)
  - `requeue_puts_terminated_items_first`
  - `done_counts_once_per_item`
- [ ] **Step 2: Write the failing engine tests** (`synthetic.json`):
  - `a_job_runs_to_done`
  - `navigation_mid_job_answers_within_one_round_trip`
  - `an_unlimited_board_does_not_starve_the_job`
  - `one_query_is_always_queued_ahead`
  - `rapid_navigation_never_leaks_queries` (review focus 1: 40 `set_position` calls in 400 ms mid-job; at no point are more than 2 job queries in flight; the job finishes)
  - `a_stale_final_is_stored_but_not_counted` (review focus 2)
  - `a_slow_boost_query_is_not_killed_by_the_watchdog` (synthetic speed so that 3000 visits takes longer than a shortened `stall_timeout`)
  - `state_is_analysing_while_only_the_job_searches`
  - `pause_holds_the_job_and_resume_continues_it`
  - `a_kata_go_restart_resumes_the_job`
- [ ] **Step 3: Run** `cargo test -p aji-engine job --test engine`. Expected: FAIL.
- [ ] **Step 4: Implement** `job.rs` and the actor changes. `stalled_at` reads whichever query is running.
- [ ] **Step 5: Run** `cargo test --workspace`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(engine): run whole-game jobs on the one engine`.

### Task 9: Job planning, passes and the protocol

**Files:**
- Create: `src-tauri/src/job.rs`
- Modify:
  - `src-tauri/src/protocol.rs` (the requests, events and fields of design 6);
  - `src-tauri/src/service.rs` (dispatch, stop events, forwarding, `TrendNodes`);
  - `src-tauri/src/game.rs` (`LineNode` gains `position: Option<Position>` and `mv`; `GameSession::revision()` is public);
  - `src-tauri/src/settings.rs` (`UiSettings` fields, Task 10);
  - `src-tauri/src/lib.rs` (the store and identity at startup).
- Test: in `job.rs`, `service.rs`

**Interfaces:**
- Consumes: `Engine::run_job`, `stop_job`, `EngineEvent::Job`, `EngineEvent::Stored`, `move_loss`, `loss_from_candidates`, `Engine::summaries`.
- Produces:
  - **Protocol, camelCase:**
    - `JobRange = { kind: 'whole' } | { kind: 'moves', from: number, to: number }`
    - `JobSide = 'both' | 'black' | 'white'`
    - `BoostOptions { on: boolean, threshold: number, visits: number }`
    - `JobOptions { range, side, visits, boost }`
    - `Request::JobStart { options }`, `Request::JobStop`
    - `Request::CacheClear { scope: 'position' | 'game' | 'all' }`, `Request::CacheStats` → `Response::CacheStats(CacheStats)`
    - `Request::GameScore { mode: { kind: 'estimate' } | { kind: 'final', dead: Point[] } }` → `Response::Score(ScoreView)`. `ScoreView` is Task 2's `Score` plus `suggestedDead: Point[]`.
    - `AppEvent::JobProgress { progress: JobProgress }`, with `JobProgress { state: 'running' | 'waiting' | 'paused' | 'boosting' | 'done' | 'stopped', done, total, boostDone, boostTotal, working: number | null, queued: number[], etaSeconds: number | null }`
    - `AppEvent::TrendNodes { revision: number, nodes: { lineIndex: number, stats: TrendStats | null, loss: Loss | null }[] }`
    - `AppEvent::CacheStatus { status: CacheStats }`
    - `TrendNode.loss: Loss | null`
  - `pub fn plan_first_pass(line: &[LineNode], options: &JobOptions, cached: &dyn Fn(PositionKey) -> u32) -> Vec<JobItem>`
    - **Range:** `moves x..y` covers the positions from before move x to after move y.
    - **`both`:** every distinct position in the range, current position first, then in line order.
    - **`black` / `white`:** the positions where that side is to move.
    - Illegal nodes are skipped. Nodes that share a position (comment-only, setup that changes nothing) are planned once.
  - `pub fn plan_fill_pass(line: &[LineNode], side: JobSide, before: &dyn Fn(PositionKey) -> Option<AnalysisUpdate>) -> Vec<JobItem>`: one side only. These are the after-positions of the side's moves that the before-position didn't list.
  - `pub fn plan_boost(line: &[LineNode], stats: &[Option<TrendStats>], options: &JobOptions) -> Vec<JobItem>`: both positions of every move in range whose |win-rate loss| is over the threshold, at the boost budget.
  - `pub fn line_losses(line: &[LineNode], stats: &[Option<TrendStats>], before: &dyn Fn(PositionKey) -> Option<AnalysisUpdate>) -> Vec<Option<Loss>>`: 5.1's loss, falling back to `loss_from_candidates` where the after-position has no result.
  - **The service's job state:** First → Fill (one side only) → Boost (if on and any) → Done.
    - It is stopped by `JobStop`, `GameNew`, `GameOpen`, `GameSetRules`, `set_files`, and `CacheClear` of `game` or `all`.
    - `etaSeconds` comes from the engine's speed and the remaining visits; the formula is the builder's.
  - **`TrendNodes`:** on `EngineEvent::Stored` for a key on the main line, the service recomputes that node's loss and the next node's, and pushes them. It is throttled to 250 ms and carries the session's revision.

- [ ] **Step 1: Write the failing tests** in `job.rs`:
  - `whole_range_plans_every_distinct_position_current_first`
  - `moves_range_covers_before_x_to_after_y`
  - `one_side_plans_half_the_positions`
  - `fill_pass_adds_after_positions_of_unlisted_moves_only`
  - `boost_takes_both_positions_of_big_swings_in_range`
  - `plan_skips_illegal_and_shares_comment_positions` (review focus 4)
  - `line_losses_fall_back_to_candidates`
  - `passes_have_losses_and_moveless_nodes_do_not`
- [ ] **Step 2: Write the failing service tests:**
  - `job_start_runs_first_then_boost_then_done` (fake engine)
  - `each_stop_event_stops_the_job` (one case per event)
  - `trend_nodes_carry_losses_and_the_revision` (the changed node and the one after it)
  - `stored_results_reach_the_trend_without_a_refetch` (M7 minor 11's cache-to-trend wiring)
  - `game_score_estimate_and_final`
  - `cache_clear_game_clears_the_main_line_keys`
  - `job_request_json_shapes` (as `game_request_json_shapes`)
- [ ] **Step 3: Run** `cargo test -p aji job service`. Expected: FAIL.
- [ ] **Step 4: Implement**, then regenerate the bindings (`cargo test` exports ts-rs; commit `src/transport/generated`).
- [ ] **Step 5: Run** `cargo test --workspace && pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: plan whole-game jobs and push trend losses`.

### Task 10: Settings, background on open, and LizzieYzy wiring

**Files:**
- Modify: `src-tauri/src/settings.rs`, `src-tauri/src/service.rs` (`game_open`, `game_export`), `src-tauri/src/game.rs` (exposes main-line nodes' `LZ`/`LZOP` and accepts `LZ` text on export)
- Test: `settings.rs`, `service.rs`

**Interfaces:**
- Consumes: Task 4's `parse_lz` and `write_lz`; Task 7's `Engine::import`.
- Produces:
  - `UiSettings` gains:
    - `showNextMove: bool` (true)
    - `analyseOnOpen: bool` (false)
    - `cacheCapMb: u32` (1024)
    - `saveAnalysis: bool` (false)
    - `jobOptions: JobOptions` (whole, both, 500, boost on, 10, 3000)

    Old settings files read with these defaults.
  - **`game_open`:**
    - imports each main-line node's `LZ`, and the root's `LZOP`, as imported rows;
    - converts Black's view from design 5.11's sides;
    - matches candidate points by GTP coordinates;
    - when `analyseOnOpen` is on, starts a job with `jobOptions`.
  - **`game_export`:** when `saveAnalysis` is on, writes `LZOP` on the root and `LZ` on every main-line node that has a row, as `write_lz` formats them, with engine name `KataGo`.
  - **`set_settings`:** applies `cacheCapMb` through `Engine::set_cache_cap`.

- [ ] **Step 1: Write the failing tests:**
  - `old_settings_files_read_new_defaults`
  - `opening_the_lizzie_fixture_imports_its_rows_as_black_view` (the trend has stats at the analysed nodes, and the root's from `LZOP`)
  - `imported_rows_never_replace_fresh_ones`
  - `analyse_on_open_starts_a_job_with_the_saved_options`
  - `export_writes_lz_only_when_asked`
  - `export_then_open_round_trips_the_analysis`
- [ ] **Step 2: Run** the service tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cargo test --workspace && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: import and export LizzieYzy analysis, and analyse on open`.

### Task 11: Interface plumbing: job, trend and engine state

**Files:**
- Create: `src/job/jobStore.ts`, `src/job/useJobSync.ts`
- Modify: `src/transport/api.ts`, `src/transport/fake.ts`, `src/analysis/trendStore.ts`, `src/analysis/useTrendSync.ts`, `src/engine/engineAction.ts`, `src/App.tsx`, `src/dev/scenarios.ts` (a running job and a done job)
- Test: alongside each

**Interfaces:**
- Produces:
  - **API:** `startJob(t, options: JobOptions)`, `stopJob(t)`, `clearCache(t, scope)`, `getCacheStats(t)`, `scoreGame(t, mode) => Promise<ScoreView>`.
  - **`useJobStore`:** `{ progress: JobProgress | null; doneUntil: number | null }`. `doneUntil` keeps the done status for 4 s.
  - **`trendStore`** applies `TrendNodes` by `lineIndex`, and ignores an event whose revision is older than the stored one (M7 minor 8). `GameTrend` still replaces everything.
  - **`engineAction(engine, job)`:** returns `'pause'` whenever a job's state is `running`, `waiting` or `boosting`, even at a visit limit.
  - **The fake transport** emits a scripted job: progress, trend nodes, and done.

- [ ] **Step 1: Write the failing tests:**
  - `trend_nodes_merge_by_line_index`
  - `an_older_revision_is_ignored`
  - `engine_action_pauses_during_a_job`
  - `job_store_keeps_done_for_four_seconds`
  - `api_shapes_match_the_protocol`
- [ ] **Step 2: Run** `pnpm test src/job src/analysis src/engine src/transport`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: follow whole-game jobs in the interface`.

### Task 12: Menus, commands and the job panel

**Files:**
- Create: `src/job/JobPanel.tsx`
- Modify:
  - `src/commands/registry.ts`, `src/commands/builtins.ts`, `src/commands/keymap.ts`;
  - `src/panel/GameMenu.tsx`, `src/panel/ViewMenu.tsx`;
  - `src/game/actions.ts` (`runMenuCommand`);
  - `src-tauri/src/platform/mod.rs` (`MenuAction` variants), `src-tauri/src/platform/menu.rs` (the 分析 menu and 显示 → 形势判断, `Labels` in both languages);
  - the locales.
- Test: `src/job/JobPanel.test.tsx`, `src/panel/GameMenu.test.tsx`, `src/commands/*.test.ts`, `menu.rs` tests

**Interfaces:**
- Produces:
  - **Command ids:** `analysis.game`, `analysis.stopGame`, `analysis.clearPosition`, `analysis.clearGame`, `scoring.start`, `estimate.toggle`.
  - **Keymap:**
    - `T` → `estimate.toggle`;
    - `Shift+Mod+A` → `analysis.game` on macOS, left to the native menu as ⌘O is today;
    - no key elsewhere.
  - **`MenuAction` variants:** `AnalyseGame`, `StopGame`, `ClearPosition`, `ClearGame`, `FinalScoring`, `Estimate`.
  - **`JobPanel`:**
    - drops from the game title, as `GameInfoPopover` drops from the rules chip;
    - has the rows of design 5.3: 范围, 分析, 每手计算量, 波动时加强 with its threshold and visits, the estimate line, 取消 and 开始;
    - reads and saves `jobOptions`;
    - Return starts.
  - **The game menu:** 分析全局…, 清除分析结果 ▸ (本局面 / 整局), 终局点目. Windows' 视图 gains 形势判断.

- [ ] **Step 1: Write the failing tests:**
  - `game_menu_has_the_m2_items_in_order`
  - `job_panel_starts_with_the_saved_options`
  - `job_panel_one_section_shows_the_move_fields`
  - `job_panel_estimate_follows_range_side_and_boost` (positions to search and the rough time)
  - `return_starts_the_job`
  - `t_toggles_the_estimate`
  - `menu_labels_have_no_middle_dot` (both languages, in `menu.rs`)
- [ ] **Step 2: Run** `pnpm test src/job src/panel src/commands && cargo test -p aji menu`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: start and stop whole-game analysis from the menus`.

### Task 13: The strip, the legend status and the engine card

**Files:**
- Create: `src/panel/CoverageStrip.tsx` (drawn inside the graph's SVG), `src/panel/JobStatus.tsx`
- Modify: `src/panel/TrendGraph.tsx`, `src/panel/EngineCard.tsx`, `src/panel/CapturesLine.tsx` (no "·")
- Test: alongside each, and the M7 graph tests

**Interfaces:**
- Consumes: `useJobStore`, `trendStore`.
- Produces:
  - **The strip:**
    - one cell per main-line move, under the 0% line;
    - solid with a result, faint when queued, green for `working`;
    - taller for queued boost items while `boosting`.
    - It shows from a job's start until the game changes.
  - **`JobStatus`,** after 目差, with ✕ calling `stopJob`:
    - `分析全局 {{done}}/{{total}}` plus `约 {{n}} 分钟`;
    - `先算当前局面` while waiting;
    - `已暂停`;
    - `加强分析 {{done}}/{{total}}`;
    - `已分析全局` for 4 s.
  - **The engine card's line:** `全局分析 {{done}}/{{total}}，正在先算第 {{n}} 手` while waiting, or `全局分析 {{done}}/{{total}}` otherwise.

- [ ] **Step 1: Write the failing tests:**
  - `strip_cells_follow_progress`
  - `boost_cells_stand_taller`
  - `status_reads_each_state`
  - `the_x_stops_the_job`
  - `engine_card_shows_the_job_line`
  - `captures_line_has_no_middle_dot`
- [ ] **Step 2: Run** `pnpm test src/panel`. Expected: FAIL.
- [ ] **Step 3: Implement**, matching `analysis-controls.html` sections 3–5.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: show whole-game progress under the graph`.

### Task 14: The candidate list

**Files:**
- Create: `src/analysis/sortCandidates.ts`, `src/panel/CandidateColumnsMenu.tsx`
- Modify: `src/panel/CandidateTable.tsx`, `src/device/deviceSettings.ts` (`candidateSort`, `candidateColumns`, `candidateCount`, `lineLength`), `src/analysis/useShownCandidates.ts` (count), `src/analysis/variation.ts` (line length)
- Test: alongside each

**Interfaces:**
- Produces:
  - `type CandidateSortKey = 'rank' | 'winrate' | 'scoreLead' | 'visits'`
  - `sortCandidates(rows, key, descending): rows`. The rank chips keep KataGo's order.
  - **Device fields:**
    - `candidateSort: { key, descending }` (rank)
    - `candidateColumns: { winrate, scoreLead, visits, share, vsBest: boolean }` (all true but `vsBest`)
    - `candidateCount: 'auto' | 5 | 10 | 'all'` (auto)
    - `lineLength: number` (today's value)
  - **The 计算量 cell** with `share`: the percentage, plus a hairline bar sized by share.
  - **The 实战 tag** beside the point when `vsBest` is off.

- [ ] **Step 1: Write the failing tests:**
  - `header_click_cycles_descending_ascending_rank`
  - `chips_keep_katago_numbers_when_sorted`
  - `vs_best_is_off_by_default_and_played_gets_a_tag`
  - `share_shows_in_the_visits_cell`
  - `column_menu_toggles_columns_and_count`
  - `narrow_panel_still_falls_back_to_four_columns`
- [ ] **Step 2: Run** `pnpm test src/panel src/analysis src/device`. Expected: FAIL.
- [ ] **Step 3: Implement**, matching `lists.html` sections 1–2.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sort the candidate list and choose its columns`.

### Task 15: The swing list panel

**Files:**
- Create: `src/analysis/swings.ts`, `src/panel/SwingList.tsx`
- Modify: `src/layout/model.ts` (`PanelKind` gains `'swings'`), `src/layout/registry.tsx`, `src/layout/presets.ts` (default: a tab beside `candidates`), `src/device/deviceSettings.ts` (`swingBy: 'winrate' | 'score'`, `swingThreshold: { winrate: 5, score: 2 }`, `swingAfterOnly: false`), the locales
- Test: alongside each, and `validate.test.ts`

**Interfaces:**
- Consumes: `TrendNode.loss`, `useGameStore`'s current line index, `navigateGame`.
- Produces:
  - `swings(nodes: TrendNode[], by, threshold, afterIndex: number | null): { black: SwingRow[]; white: SwingRow[] }`, each list sorted by loss, descending.
  - `SwingRow { lineIndex, moveNumber, move, loss: Loss }`.
  - **Clicking a row** navigates to `lineIndex − 1`.
  - **The empty state's** text is design 5.4's.

- [ ] **Step 1: Write the failing tests:**
  - `swings_filter_by_threshold_and_side`
  - `after_only_drops_earlier_moves`
  - `click_goes_to_the_position_before`
  - `current_move_row_is_highlighted`
  - `partial_results_show_the_footer`
  - `no_results_show_the_empty_state`
  - `stored_layouts_without_swings_still_validate`
- [ ] **Step 2: Run** `pnpm test src/analysis src/panel src/layout`. Expected: FAIL.
- [ ] **Step 3: Implement**, matching `lists.html` sections 3–4.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: list each side's biggest swings`.

### Task 16: The next-move hint

**Files:**
- Modify: `src/analysis/candidates.ts` (a shown entry for the played move from `update.next`), `src/board/candidates.ts` (`drawNextRing`), `src/board/BoardCanvas.tsx`, `src/panel/CandidateTable.tsx` (the row), `src/settings/SettingsPanel.tsx` (显示棋谱的下一手), the locales
- Test: alongside each; a screenshot test

**Interfaces:**
- Consumes: `AnalysisUpdate.next`, `GameSnapshot.nextMove`, `UiSettings.showNextMove`.
- Produces:
  - **When the next move isn't among the shown discs and `next` is present:**
    - a disc on its point with the played ring;
    - numbers from `next.stats` in the side to move's view;
    - its tier from `next.loss.winrate`, on the same 2 and 4 point bands as `tierFor`.
  - **With `next` absent, or the candidates hidden:** `drawNextRing(ctx, view, point)`, the 2.5 px `PLAYED_RING` alone.
  - **With `showNextMove` off:** neither.

- [ ] **Step 1: Write the failing tests:**
  - `unlisted_next_move_gets_a_disc_with_the_ring`
  - `without_a_result_it_is_a_ring_alone`
  - `hidden_candidates_leave_the_ring`
  - `the_setting_hides_both`
  - `the_table_shows_the_played_row`
  - screenshot `next-move-disc`
- [ ] **Step 2: Run** `pnpm test src/analysis src/board src/panel`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: show the record's next move when KataGo did not list it`.

### Task 17: Ownership and the position estimate

**Files:**
- Create: `src/board/ownership.ts`, `src/analysis/estimateStore.ts`, `src/panel/EstimateLine.tsx`
- Modify: `src/board/BoardCanvas.tsx` (an ownership layer between the stones and the discs), `src/panel/WinrateBar.tsx` (hosts `EstimateLine`), `src/commands/builtins.ts`, the locales
- Test: alongside each; screenshot tests

**Interfaces:**
- Consumes: `AnalysisUpdate.ownership`, `scoreGame(t, { kind: 'estimate' })`, the `estimate.toggle` command.
- Produces:
  - `drawOwnership(ctx, view, owners: (Color | null)[], dead: Point[])`:
    - same-size squares (side `0.36 × spacing`) on owned points;
    - dead stones faded to 45% opacity, with the owner's square on top.
  - **`useEstimateStore`:** `{ on: boolean; score: ScoreView | null }`. It refetches on each new ownership, throttled to 500 ms.
  - **`EstimateLine`:**
    - `形势判断 黑 {{b}} 白 {{w}} 贴目 {{komi}} {{verdict}} ✕`;
    - the verdict is `黑领先 {{n}} 目`, `白领先 {{n}} 目` or `均势`;
    - with no ownership yet, a waiting line;
    - at the last move of a finished game (two passes, or `RE`), a 点目 button calling `scoring.start`.
  - **The board** draws only settled points: |q| ≥ 76, from `ownership` directly, the backend's `owners` for estimate counts.

- [ ] **Step 1: Write the failing tests:**
  - `t_shows_and_hides_the_line_and_squares`
  - `only_settled_points_get_squares`
  - `dead_stones_fade_under_the_owner_square`
  - `the_line_reads_the_backends_score`
  - `finished_game_offers_scoring`
  - screenshots `ownership-honey-light` and `ownership-walnut-dark`
- [ ] **Step 2: Run** `pnpm test src/board src/analysis src/panel`. Expected: FAIL.
- [ ] **Step 3: Implement**, matching `next-move-and-ownership.html` sections 4–5.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: show ownership and the position estimate`.

### Task 18: Final scoring

**Files:**
- Create: `src/scoring/scoringStore.ts`, `src/scoring/ScoringCard.tsx`
- Modify: `src/layout/LayoutFrame.tsx` and `NarrowFrame.tsx` (the card replaces the win-rate and trend panels while scoring), `src/board/useBoardGestures.ts` (a tap toggles a group while scoring), `src/board/BoardCanvas.tsx`, the locales
- Test: alongside each; a screenshot test

**Interfaces:**
- Consumes: `scoreGame(t, { kind: 'final', dead })`, `pauseAnalysis` and `resumeAnalysis`, the `scoring.start` command.
- Produces:
  - **`useScoringStore`:** `{ active: boolean; dead: Point[]; suggested: Point[]; score: ScoreView | null; start(); toggle(point); reset(); exit() }`.
    - `start` pauses analysis (and so the job), asks for the estimate's `suggestedDead`, and scores.
    - `toggle` flips the group the backend reports and rescores.
    - `exit` resumes, only if analysis wasn't paused before `start`.
  - **`ScoringCard`:**
    - the table of design 5.8: area columns 棋子 地 贴目 合计, or territory columns 地 死子 提子 贴目 合计, following the rules chip;
    - the verdict `白胜 {{n}} 目`, `黑胜 {{n}} 目` or `和棋`;
    - `已改动` with `恢复 KataGo 的判断` when `dead ≠ suggested`;
    - 退出点目.
  - **While scoring,** the candidates are hidden, and navigation keys exit scoring first.

- [ ] **Step 1: Write the failing tests:**
  - `start_pauses_and_marks_katagos_dead`
  - `tapping_a_stone_toggles_its_group_and_rescores`
  - `changed_marking_offers_reset`
  - `exit_resumes_only_if_it_paused`
  - `territory_rules_show_territory_columns`
  - screenshot `final-scoring-9x9`
- [ ] **Step 2: Run** `pnpm test src/scoring src/board src/layout`. Expected: FAIL.
- [ ] **Step 3: Implement**, matching `final-scoring.html`.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: count a finished game with dead stones marked by hand`.

### Task 19: Settings rows and the cache notice

**Files:**
- Modify: `src/settings/SettingsPanel.tsx`, `src/game/notices.ts` (a cache notice), the locales
- Test: `SettingsPanel.test.tsx`, `notices.test.ts`

**Interfaces:**
- Consumes: `UiSettings` fields (Task 10), `getCacheStats`, `clearCache`, `AppEvent::CacheStatus`.
- Produces:
  - **Settings → Analysis rows:**
    - 显示棋谱的下一手;
    - 打开棋谱时分析全局, with its sub-line;
    - 分析缓存: `已用 {{used}}，上限 {{cap}}`, a cap selector (256 MB, 512 MB, 1 GB, 2 GB, 4 GB), and 清除… with a confirmation dialog;
    - 保存时写入分析结果.
  - **When the cache is not persistent:** the row shows the reason, and one notice line per session says results aren't being kept.

- [ ] **Step 1: Write the failing tests:**
  - `cache_row_shows_used_and_cap`
  - `clear_all_asks_first`
  - `a_memory_only_cache_shows_its_reason_and_one_notice`
  - `the_new_toggles_save`
- [ ] **Step 2: Run** `pnpm test src/settings src/game`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the M2 analysis settings`.

### Task 20: The middle dot, and the documents

**Files:**
- Modify:
  - `src/locales/zh-CN.json`, `src/locales/en.json`: the nine strings of design 5.12;
  - `CLAUDE.md`;
  - the charter;
  - the Phase 2 plan;
  - the Phase 2 audit;
  - the interface design;
  - `docs/backlog/phase-1-deferred.md`.
- Test: `src/i18n/parity.test.ts`

- [ ] **Step 1: Write the failing test** `no_locale_string_contains_a_middle_dot` in `parity.test.ts`.
- [ ] **Step 2: Run** `pnpm test src/i18n`. Expected: FAIL (nine strings).
- [ ] **Step 3: Rewrite the nine strings** without "·". The wording is the builder's (design 11), using a space, a comma or parentheses as the mockups do. For example, the rules chip reads `中国 7.5`.
- [ ] **Step 4: Update the documents**, as design 12 lists:
  - **`CLAUDE.md`:** under Internationalisation, add "Never use the middle dot "·" as a separator in interface text, in any language."
  - **Charter 7.3:** remove the quality marks row; mark the candidate list done in M2.
  - **Charter 7.4:** a Phase 2 row for the swing list; boost analysis moves to Phase 2.
  - **Phase 2 plan, M2:** remove the quality marks and their thresholds; add the boost pass.
  - **Audit:** WA8 moved to P2-M2; CA2 removed at the owner's request.
  - **Interface design:** 4.1, 4.3 and 8.
  - **Backlog:** strike M7 minors 2, 8, 11 and 12 as fixed in P2 M2. Note M2 N3's re-check result.
- [ ] **Step 5: Run** all checks. Expected: PASS.
- [ ] **Step 6: Commit** `docs: drop the middle dot and record Phase 2 M2 in the documents`.

### Task 21: Exit check (Mac, local build)

- [ ] **Step 1:** The browser check: `pnpm dev` with the fake transport's scenarios, including the running and done jobs, in both themes and at narrow width.
- [ ] **Step 2:** Build with `pnpm tauri build --bundles app`. Walk design 10 on the Mac with the owner's KataGo:
  - analyse on open;
  - whole, range and one-side jobs, with the boost pass;
  - pause and stop;
  - quit and reopen with the graph and swings shown at once;
  - another network showing none of the old results;
  - each clear scope, and the cap evicting when lowered;
  - the LizzieYzy fixture's analysis in Aji, and a save-with-analysis round trip;
  - the next-move hint on an unlisted move;
  - ownership and the estimate on a finished game;
  - final scoring against a hand count on a 9×9 game under both rule sets;
  - no "·" anywhere in the interface.
- [ ] **Step 3:** Record the job's throughput (positions per minute at 500 visits, the network's name) and the gap between job positions, from the engine log, in this plan's Status (design 9).
- [ ] **Step 4:** Record the results, and anything outstanding (opening a saved file in LizzieYzy itself stays [To verify]), in a **Status** section at the top of this plan, as the M1 plan does.
- [ ] **Step 5: Commit** `docs: record Phase 2 M2`.
