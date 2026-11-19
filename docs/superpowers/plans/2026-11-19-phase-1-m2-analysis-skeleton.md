# M2 Analysis Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KataGo, placed by hand, streams live candidates for the empty board into Aji on both machines. Aji shows the engine's state, lets the user pause, resume and restart it, detects a crash or a hang, and never leaves KataGo running after Aji exits.

**Architecture:**
- Two new crates join the workspace:
  - `aji-core` holds the first game types: colour, point, move, GTP coordinates, rules, komi, position, and a stable position key.
  - `aji-engine` runs KataGo's analysis engine as a child process. It is an actor behind an `Engine` handle: it spawns KataGo, routes its JSON lines, throttles and caches updates, and owns the state machine and the watchdog.
- A fake KataGo binary replays transcripts recorded from the real engine on the Mac, so CI needs no GPU and tests run on all three OSes.
- `src-tauri` adds the engine requests to the existing `rpc` dispatcher, and forwards engine events through a Tauri-independent `EventSink` to the `aji://event` channel. The UI gains `Transport.subscribe`, a Zustand store, the engine indicator, a status line and a plain candidate list.

**Tech Stack:**
- Rust: Tauri 2, tokio, serde, ts-rs, `windows-sys` (Windows) and `libc` (Linux).
- TypeScript: React 19, Zustand, i18next, Vitest.
- KataGo 1.18.2 with the Metal backend, from Homebrew, on the Mac.

**Specs:**
- [Project charter](../specs/2026-11-19-aji-project-charter-design.md), sections 6, 6.1, 6.2, 6.5, 6.6, 6.8 and 11.
- [Interface design](../specs/2026-11-19-aji-ui-design.md), sections 2 and 4.1.
- [Phase 1 roadmap](2026-11-19-phase-1-roadmap.md), sections 3.1 to 3.4, M2 and section 6.
- [Phase 1 LizzieYzy menu check](../../audits/phase-1-lizzieyzy-menu.md): G1 (approved for M2 on 2026-11-19) and K1.

**Status:** Not started.

## Global Constraints

- **Everything from M1 still holds.** That covers language, interface text in both locales, dependency licences, Conventional Commits, the toolchain and the theme tokens. See [M1](2026-11-19-phase-1-m1-foundation.md), Global Constraints.
- **Branch.** Work on `feat/m2-analysis-skeleton`, created from `dev` at `4080498`. M1 is only on `dev` until the owner merges `dev` into `main`, so branching from `main` would lose it. At the finish, merge into `dev` locally (the owner's standing instruction). Push only when the owner asks.
- **Crates.**
  - `crates/aji-core` and `crates/aji-engine` join the workspace `members`, and both use `version.workspace`, `edition.workspace` and `license.workspace`.
  - `aji-core` depends on no workspace crate, and does no file I/O, async or OS calls (roadmap 3.1). It may depend on `serde` and `ts-rs`.
  - `aji-engine` depends on `aji-core`.
- **Protocol.**
  - Messages never carry file paths for the UI to use.
  - KataGo's stderr tail crosses the boundary as opaque diagnostic text for display only. It may contain paths.
  - Errors cross the boundary as `{ code, message }`. The UI shows text looked up from `code`.
  - Types that cross the boundary derive `ts_rs::TS` with `#[ts(export)]` in whichever crate defines them. All of them generate into `src/transport/generated/`.
  - JSON numbers that can exceed 2^53 are strings.
- **KataGo launch.** The program is the KataGo binary, with these arguments in this order: `analysis -config <config> -model <model> -quit-without-waiting -override-config reportAnalysisWinratesAs=BLACK,logToStderr=true`. The working directory is given explicitly. On Windows, the process is created with `CREATE_NO_WINDOW` (`0x08000000`).
- **KataGo facts.** These were recorded on the Mac on 2026-11-19 with Homebrew KataGo 1.18.2 (Metal) and `kata1-b18c384nbt-s9996604416-d4316597426`. Tests assert these, not recalled formats.
  - **Ready.** KataGo logs `Started, ready to begin handling requests` on stderr. Aji does not parse stderr; it treats the reply to `{"id":"aji-version","action":"query_version"}` as ready. The reply is `{"action":"query_version","git_hash":"<omitted>","id":"aji-version","version":"1.18.2"}`.
  - **Analysis response.** Top-level keys `id`, `isDuringSearch`, `moveInfos`, `rootInfo`, `turnNumber`. Each `moveInfos` entry has `move`, `order`, `visits`, `winrate`, `scoreLead`, `prior`, `pv` and more. Entries for symmetric moves carry `isSymmetryOf`: on the empty board, 285 of 338 entries, and one response is 125 KB. `rootInfo` has `visits`, `winrate`, `scoreLead` and `currentPlayer`.
  - **Terminate.** The acknowledgement echoes the query, for example `{"action":"terminate","id":"t2","terminateId":"q2"}`. Then a final response (`isDuringSearch:false`) carries the partial results. A query terminated before it started answers `{"id":"q3c","isDuringSearch":false,"noResults":true,"turnNumber":1}`.
  - **Errors.**
    - A general error: `{"error":"…"}`.
    - A field error: `{"error":"Illegal move 1: Q16","field":"moves","id":"e2"}`.
    - A warning, after which analysis still runs: `{"field":"notAField","id":"e4","warning":"Unexpected or unused field, …"}`.
  - **Exit on stdin EOF.** With `-quit-without-waiting`, KataGo exits with code 0 about 0.15 s after stdin closes, even mid-search. Without the flag it first finishes every queued query.
  - **Orphans.** The parent was killed with SIGKILL during a long search:

    | Launch | KataGo after the parent's SIGKILL |
    |---|---|
    | `-quit-without-waiting` | exits within 0.1 s |
    | no flag, reporting progress | exits within 0.1 s (SIGPIPE) |
    | no flag, silent search | **keeps running, re-parented to PID 1** |

  - **Startup failure.** A missing model, a missing config or a bad config value aborts KataGo: exit status 134 (signal 6 on Unix). The last stderr line starts `libc++abi: terminating due to uncaught exception of type`.
  - **Config.** `nnMaxBatchSize` is required. KataGo writes its log to stderr even when the config does not set `logToStderr`.
  - **Metal warm-up.** The first query on a new process waited 3 s for its first report, then sat at 1 to 6 visits for another 3 s. Reports kept arriving every 0.1 s throughout.
  - **Paths.** A working directory named with Chinese characters and a space, with relative `-config` and `-model`, worked on macOS.
- **Engine defaults [Proposed].** Each is a constant in `EngineOptions::default()`:

  | Option | Value | Source |
  |---|---|---|
  | `visit_cap` | 100,000 visits per position | roadmap 3.4 |
  | `report_every` | 100 ms (`reportDuringSearchEvery` 0.1) | charter 6.5 |
  | `throttle` | at most one non-final update per 100 ms per position | charter 6.5 |
  | `max_candidates` | 20, by KataGo's `order` | new |
  | `stderr_lines` | 50 | roadmap M2 |
  | `ping_every` | 5 s | new (G1) |
  | `ping_timeout` | 20 s | new (G1) |
  | `startup_timeout` | 600 s (allows TensorRT engine builds; M4 revisits) | new (G1) |
  | `hang_window` | 10 min: a second hang inside it is not restarted | new (G1) |
  | `stall_timeout` | 60 s: while analysing, no increase in the active query's root visits within it is a hang | new (ruling R5, 2026-11-19) |
  | `shutdown_grace` | 2 s between closing stdin and killing | new |

- **Default position [Proposed] (audit K1).** An empty 19×19 board, Chinese rules, komi 7.5.
- **Dependencies.** New crates and npm packages must pass `cargo deny check licenses` and `scripts/check-npm-licenses.mjs`. Expected additions:
  - Rust: `tokio`, `libc` (Linux only), `windows-sys` (Windows only) and `tempfile` (dev only).
  - npm: `zustand`.

## Review Focus

1. **KataGo dies at startup** (bad model or config) **or mid-analysis.** Aji shows the crashed state with the last 50 stderr lines, ending with the `libc++abi` line. Restart works, and nothing hangs. (Task 4: `startup_failure_reports_crash_with_stderr_tail`, `crash_mid_analysis_keeps_the_last_50_lines`, `restart_after_crash_returns_to_analysing`)
2. **Aji is force-quit.** No KataGo survives, through each OS's own mechanism: stdin EOF on macOS, the parent-death signal on Linux, the job object on Windows. (Task 4: `force_quit_leaves_no_engine`, a three-process test)
3. **KataGo stops answering**, for example on a wedged GPU driver. The watchdog kills it and restarts it once; a second hang within 10 minutes is reported as not responding. (Task 4: `hang_restarts_once_then_reports_not_responding`)
4. **The engine folder's path contains Chinese characters and spaces**, as on a Chinese Windows user profile. KataGo still starts. (Task 4: `starts_from_a_folder_with_cjk_and_spaces`, run on all three OSes in CI)
5. **Late or stale updates** never reach the UI, and an older status never overwrites a newer state:
   - an update for a position that is no longer current, arriving after a position change;
   - a late result from a search that has already been replaced, for example the final of a paused search arriving after resume;
   - a status reply that resolves after a newer event.

   After a resume or a restart, the new search is shown from its first report. KataGo starts every query from zero visits, so holding updates back until they passed the previous count froze the panel for minutes (found in the Mac exit check, 2026-11-19).

   (Task 4: `stale_position_updates_are_not_emitted`, `resume_shows_the_live_search`, `restart_after_crash_shows_the_live_search`; Task 6: `status reply never overwrites a newer event`)

---

### Task 0: Record KataGo transcripts on the Mac

The fake KataGo replays these files, and the parser tests assert their exact lines. Homebrew KataGo 1.18.2 is already installed: `/opt/homebrew/bin/katago`, with networks in `/opt/homebrew/share/katago/`.

**Files:**
- Create: `scripts/record-katago-transcript.mjs`.
- Create: `crates/aji-engine/tests/fixtures/katago/1.18.2-metal/analysis.jsonl` and `.../bad-model.jsonl`.
- Create: `crates/aji-engine/tests/fixtures/katago/record.cfg`, the config used for recording.

**Interfaces:**
- Produces: the transcript format, one JSON object per line: `{"t": <seconds since spawn, 3 decimals>, "s": "in" | "out" | "err" | "ctl", "line": "<text>"}`. `ctl` lines record recorder actions and `exit code=<n|null> signal=<name|null>`.
- Produces: the recorded positions, which later tasks reuse by name:

  | Name (query ids) | Position (19×19, komi 7.5) | Query | Purpose |
  |---|---|---|---|
  | P1 (`p1`) | moves B Q16, W D4; Chinese | `maxVisits` 300, `reportDuringSearchEvery` 0.25 | streaming replay |
  | P0 (`p0`) | empty; Chinese | `maxVisits` 200, no reports | symmetry trimming |
  | P2 (`p2`) | move B R4; Chinese | `maxVisits` 100000, reports every 0.25, terminated after 1 s | terminate replay |
  | — (`ta1` to `ta3`) | empty, then B C3, then B C4, sent together | `maxVisits` 100000 each, then `terminate_all` after 0.3 s. `record.cfg` runs two at a time, so `ta3` never starts | `noResults` |
  | — (`e1` to `e5`) | the five error cases of the recording on 2026-11-19 | `maxVisits` 10 | error and warning lines |

- [ ] **Step 1: Write the recorder** `scripts/record-katago-transcript.mjs`
  - Usage: `node scripts/record-katago-transcript.mjs --katago <path> --model <path> --config <path> --out-dir <dir>`.
  - It spawns KataGo with exactly the Global Constraints launch arguments and sends `query_version` immediately, before the ready line, which records the real ordering.
  - It then runs a 9×9, 50-visit warm-up query (Metal warm-up), followed by the table's queries in order.
  - The error cases are, in order: the line `this is not json`, a query without `boardXSize`, the illegal move `[["B","Q16"],["W","Q16"]]`, `"rules":"nonsense"`, and an unknown field `notAField`.
  - Finally it closes stdin and records the exit. It writes `analysis.jsonl`.
  - A second run with `-model <out-dir>/missing.bin.gz` writes `bad-model.jsonl`.
  - Every recorded line has `os.homedir()` replaced by `~`.
  - It prints each file's size and a summary per query id: the number of reports, whether a final arrived, and how many `moveInfos` the final has.
  - It fails (non-zero exit) unless all of these hold:
    - the two files together are ≤ 1 MB;
    - `p1` has at least 3 reports and a final;
    - `p0`'s final has more than 20 `moveInfos`;
    - a `noResults` line exists;
    - the `query_version` reply comes after the ready line.
- [ ] **Step 2: Write `record.cfg`**: `numAnalysisThreads = 2`, `numSearchThreadsPerAnalysisThread = 16`, `nnMaxBatchSize = 64`, `nnCacheSizePowerOfTwo = 20`, `nnMutexPoolSizePowerOfTwo = 14`, `nnRandomize = true`.
- [ ] **Step 3: Record**

  Run: `node scripts/record-katago-transcript.mjs --katago /opt/homebrew/bin/katago --model /opt/homebrew/share/katago/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz --config crates/aji-engine/tests/fixtures/katago/record.cfg --out-dir crates/aji-engine/tests/fixtures/katago/1.18.2-metal`

  Expected:
  - The recorder exits 0, so all of its checks passed.
  - `analysis.jsonl` ends with `exit code=0`.
  - `bad-model.jsonl`'s last `err` line starts `libc++abi: terminating`, and its `ctl` exit line shows signal `SIGABRT` (Node reports the signal by name).
  - If the ordering check failed (the `query_version` reply arrived before the ready line), stop: Aji's ready signal (Global Constraints) is wrong, and Task 4's state machine needs a ruling.
- [ ] **Step 4: Check that no home path leaked**

  Run: `! grep -rqF "$HOME" crates/aji-engine/tests/fixtures`

  Expected: exit 0.
- [ ] **Step 5: Commit**

```bash
git add scripts/record-katago-transcript.mjs crates/aji-engine/tests/fixtures
git commit -m "test: record KataGo 1.18.2 analysis transcripts on Apple Silicon"
```

### Task 1: `aji-core` first types

**Files:**
- Create: `crates/aji-core/Cargo.toml`, `crates/aji-core/src/lib.rs`, `src/coords.rs`, `src/position.rs`.
- Modify: `Cargo.toml` (workspace members).
- Generate and commit: `src/transport/generated/{Color,Point,Move,PositionKey}.ts`.

**Interfaces:**
- Produces. Every type derives `Debug, Clone, PartialEq, Eq, Hash`, and `Copy` where it holds no `Vec`. `Komi` can derive `Hash` because it stores an integer:
  - `enum Color { Black, White }`.
    - serde `"black"`/`"white"`.
    - `fn opponent(self) -> Color`; `fn gtp(self) -> &'static str` returns `"B"` or `"W"`.
  - `struct BoardSize(u8)`, square, 2 to 19 (KataGo's limit).
    - `BoardSize::new(n: u8) -> Result<BoardSize, CoreError>`; `const NINETEEN`; `fn get(self) -> u8`.
    - serde as a number.
  - `struct Point { pub x: u8, pub y: u8 }`. (0,0) is the top-left corner, x grows rightwards and y downwards: the order of SGF and of KataGo's row-major arrays.
  - `enum Move { Play(Point), Pass }`, serde `{"type":"play","x":15,"y":3}` and `{"type":"pass"}`.
  - `fn move_to_gtp(mv: Move, size: BoardSize) -> String` and `fn move_from_gtp(s: &str, size: BoardSize) -> Result<Move, CoreError>`.
    - The columns are `ABCDEFGHJKLMNOPQRST` (no I), and the row is `size - y`.
    - Parsing ignores case. The `(x,y)` form is not supported.
  - `enum Rules { Chinese, Japanese, Korean, TrompTaylor }`, with `fn katago_name(self) -> &'static str` returning `chinese`, `japanese`, `korean` or `tromp-taylor`.
  - `struct Komi`, stored as an `i16` count of half-points.
    - `Komi::new(points: f64) -> Result<Komi, CoreError>` accepts multiples of 0.5 in [-400, 400].
    - `fn points(self) -> f64`. serde as a number.
  - `struct Position { pub size: BoardSize, pub rules: Rules, pub komi: Komi, pub setup: Vec<(Color, Point)>, pub moves: Vec<(Color, Move)> }`.
    - `Position::empty(size, rules, komi)`.
    - `fn validate(&self) -> Result<(), CoreError>` checks that every point is on the board.
    - `fn key(&self) -> PositionKey`.
  - `struct PositionKey(pub u64)`.
    - serde and `Display` as 16 lowercase hex digits; the TypeScript type is `string`.
    - Computed as FNV-1a 64 (offset `0xcbf29ce484222325`, prime `0x100000001b3`) over this encoding:
      - `size u8`;
      - `rules u8` (Chinese 0, Japanese 1, Korean 2, TrompTaylor 3);
      - `komi half-points i16 LE`;
      - `setup count u16 LE`, then each stone sorted by `(y, x, color)` as `color u8 (B 0, W 1), x u8, y u8`;
      - `moves count u16 LE`, then each move as `color u8` followed by `x, y`, or `0xFF 0xFF` for a pass.
  - `enum CoreError { BoardSizeOutOfRange(u8), KomiInvalid, PointOffBoard(Point), BadCoordinate(String) }`, which implements `std::error::Error`.
- TypeScript export: `Color`, `Point`, `Move` and `PositionKey`.

- [ ] **Step 1: Write the failing tests** (unit tests in each module)
  - `gtp_round_trip` on 19×19:
    - (0,0) ↔ `A19`;
    - (18,18) ↔ `T1`;
    - (8,0) ↔ `J19`;
    - (15,3) ↔ `Q16`;
    - on 9×9, (4,4) ↔ `E5`;
    - `pass`, `PASS` and `Pass` ↔ `Move::Pass`.
  - `gtp_rejects`: `i5` on 9, `T19` on 9, `A0`, `A20` on 19, the empty string, and `(0,13)`. Each is `Err(BadCoordinate)`.
  - `board_size_range`: 1 and 20 are rejected; 2 and 19 are accepted.
  - `komi_validation`: 7.5, -7.5, 0 and 400 are accepted; 7.25, 400.5 and NaN are rejected. JSON `7.5` round-trips.
  - `move_json_shape`: the two shapes above.
  - `position_key_is_pinned`, literal values from the encoding above:

    | Position (19×19) | Key |
    |---|---|
    | empty, Chinese, 7.5 | `4d325c64abd378a1` |
    | empty, Chinese, 6.5 | `065f24ca87b70513` |
    | empty, Japanese, 7.5 | `e6fe7ebd69fca626` |
    | B Q16, W D4; Chinese, 7.5 | `f588b40db0c2ff10` |
    | W D4, B Q16; Chinese, 7.5 | `7b7a98bb0b960a1a` |
    | B pass; Chinese, 7.5 | `af9ffa44758edc9e` |
    | setup B D4 and B Q16; Chinese, 0.5 | `87ca92a0a8996f5d` |

  - `setup_order_does_not_change_the_key`.
  - `validate_rejects_off_board`: a move at (19,0) on 19×19 gives `Err(PointOffBoard)`.
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji-core`. Expected: compile errors for the missing items.
- [ ] **Step 3: Implement**, and add `"crates/aji-core"` to the workspace members.
- [ ] **Step 4: Run them to verify they pass.** Run `cargo test -p aji-core`. Expected: PASS, and `src/transport/generated/Move.ts` exists.
- [ ] **Step 5: Lint.** Run `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings`. Expected: exit 0.
- [ ] **Step 6: Commit**

```bash
git add Cargo.toml Cargo.lock crates/aji-core src/transport/generated
git commit -m "feat(core): add board, move, GTP coordinate and position types"
```

### Task 2: `aji-engine` protocol layer (pure)

Everything here works on strings and values, with no process involved.

**Files:**
- Create: `crates/aji-engine/Cargo.toml`, `src/lib.rs`, `src/query.rs`, `src/response.rs`, `src/update.rs`, `src/throttle.rs`, `src/cache.rs`, and `tests/fixtures_parse.rs`.
- Modify: `Cargo.toml` (members).

**Interfaces:**
- Consumes: Task 1 types; Task 0 transcripts.
- Produces:
  - `fn analysis_query(id: &str, position: &Position, max_visits: u32, report_every: Duration) -> String`.
    - One line of JSON with these fields: `id`, `moves` (`[["B","Q16"],…]`), `initialStones` (omitted when empty), `rules`, `komi`, `boardXSize`, `boardYSize`, `maxVisits`, `reportDuringSearchEvery` (seconds).
  - `fn action_query(id: &str, action: &str) -> String` and `fn terminate_query(id: &str, target: &str) -> String`.
  - `enum KataLine`, built by `fn parse_line(line: &str) -> KataLine`. The variants:
    - `Analysis(RawAnalysis)`;
    - `NoResults { id: String }`;
    - `Ack { id: String, action: String, version: Option<String> }`;
    - `QueryError { id: Option<String>, field: Option<String>, message: String }`;
    - `Warning { id: Option<String>, field: Option<String>, message: String }`;
    - `Unrecognised(String)`.
    
    The checks run in this order: `error` key, `warning` key, `action` key, `noResults:true`, then `moveInfos` with `rootInfo`. Anything else, including non-JSON, is `Unrecognised`. Unknown fields are ignored.
  - `struct RawAnalysis`: serde mirror of the response, with only the fields used: `id`, `is_during_search`, `turn_number`, `root_info { visits, winrate, score_lead }` and `move_infos[] { move, order, visits, winrate, score_lead, prior, pv }`.
  - `struct AnalysisUpdate`, serde camelCase, TypeScript export:
    - `position: PositionKey`, `board_size: u8`, `root_visits: u32`, `winrate: f64`, `score_lead: f64`, `is_final: bool`, `candidates: Vec<Candidate>`.
    - Winrate and score lead are Black's, guaranteed by the launch override.
  - `struct Candidate`, TypeScript export:
    - `#[serde(rename = "move")] mv: Move`, `order: u32`, `visits: u32`, `winrate: f64`, `score_lead: f64`, `prior: f64`, `pv: Vec<Move>`.
  - `fn to_update(raw: &RawAnalysis, position: &Position, max_candidates: usize) -> AnalysisUpdate`.
    - Candidates are sorted by `order` and truncated. Symmetry copies are kept; M7 decides how to draw them.
    - A move or PV entry that fails `move_from_gtp` is dropped, together with the rest of that PV.
  - `struct Throttle` with `fn new(min_interval: Duration)` and `fn admit(&mut self, now: Instant, is_final: bool) -> bool`. Finals always pass.
  - `struct AnalysisCache` with `fn offer(&mut self, update: AnalysisUpdate) -> bool` and `fn get(&self, key: PositionKey) -> Option<&AnalysisUpdate>`.
    - An offer is stored, returning `true`, when there is no entry, when the new `root_visits` is higher, or when visits are equal and only the new one is final.

- [ ] **Step 1: Write the failing tests**
  - `query_json_shape`: `analysis_query("aji-1", P1, 100_000, 100 ms)` parses to exactly `{"id":"aji-1","moves":[["B","Q16"],["W","D4"]],"rules":"chinese","komi":7.5,"boardXSize":19,"boardYSize":19,"maxVisits":100000,"reportDuringSearchEvery":0.1}`. The result contains no newline.
  - `initial_stones_are_sent_when_present`: a setup stone produces `"initialStones":[["B","D4"]]`.
  - In `tests/fixtures_parse.rs`, every `out` line of `analysis.jsonl` parses to a variant other than `Unrecognised`. Specific lines map to specific variants:
    - the `query_version` reply → `Ack` with version `1.18.2`;
    - the `terminate` echo → `Ack`;
    - the `noResults` line → `NoResults`;
    - the non-JSON error → `QueryError` with `id: None`;
    - the illegal-move error → `QueryError` with field `moves`;
    - the unused-field line → `Warning`;
    - P1's reports → `Analysis`.
  - `parse_line("garbage")` and `parse_line("{}")` give `Unrecognised`.
  - `p0_update_is_trimmed`: P0's final response gives 20 candidates, `order` 0 to 19 ascending, `is_final` true, `board_size` 19, and `position` equal to `Position::empty(...).key()`. Candidate 0's move and visits equal the fixture's `order: 0` entry.
  - `pv_is_converted`: candidate 0's `pv[0]` equals its own move.
  - `throttle`: a non-final at 0 ms passes, one at 50 ms is rejected, one at 120 ms passes, and a final at 121 ms passes.
  - `cache_keeps_the_most_visited`: offer 300 visits (true), then 200 (false), then 300 final (true), then 300 final again (false).
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji-engine`. Expected: compile errors.
- [ ] **Step 3: Implement.** Dependencies: `aji-core`, `serde`, `serde_json`, `ts-rs`.
- [ ] **Step 4: Run them to verify they pass.** Run `cargo test -p aji-engine`. Expected: PASS.
- [ ] **Step 5: Lint**, as in Task 1.
- [ ] **Step 6: Commit**

```bash
git add Cargo.toml Cargo.lock crates/aji-engine src/transport/generated
git commit -m "feat(engine): parse KataGo analysis lines into throttled, cached updates"
```

### Task 3: Fake KataGo

**Files:**
- Create: `crates/aji-engine/src/bin/fake-katago.rs`, `crates/aji-engine/tests/fake_katago.rs`.
- Create: `crates/aji-engine/tests/fixtures/scenarios/{normal,slow,startup-failure,crash,hang,ignore-eof}.json`.
  - `slow` is `normal` with `speed` 2, so P1's reports arrive about 125 ms apart. The mid-stream tests (pause, resume and position change) need that window, even on a slow CI runner.

**Interfaces:**
- Consumes: the Task 0 transcripts; `parse_line` is not used (the fake stays independent of the code it tests).
- Produces: the binary `fake-katago`, which integration tests reach through `env!("CARGO_BIN_EXE_fake-katago")`.
  - **CLI.** It accepts KataGo's command line unchanged: `analysis -config <scenario.json> -model <ignored> [-quit-without-waiting] [-override-config <ignored>]`. The `-config` value is the scenario file, resolved against the working directory, so Aji's real launch code drives it.
  - **Scenario JSON.** `transcript` is resolved against the scenario's folder. The fields and their defaults:
    - `"transcript": "<path>"`;
    - `"speed": 20.0` (recorded delays are divided by it);
    - `"onEof": "exit"` or `"ignore"`;
    - `"failStartup": false`;
    - `"crashAfterReports": null` or `n`;
    - `"crashStderrLines": 0`;
    - `"hangAfterReady": false`.
  - **Behaviour:**
    - **Start.** It prints the transcript's `err` lines up to and including `Started, ready to begin handling requests`, with the scaled delays.
      - With `failStartup`, it prints all `err` lines of the transcript instead, then calls `std::process::abort()`.
    - **`query_version`.** It replies with the recorded reply, with `id` replaced.
      - With `hangAfterReady`, it answers the first one only. After that it never writes again and never reads stdin.
    - **An analysis query.** It finds the first recorded query with the same `moves`, `initialStones`, `rules`, `komi` and board size. It replays that query's recorded `out` lines with their relative delays scaled and `id` replaced, each on its own thread.
      - With no match, it replies `{"error":"fake-katago: no recorded query for this position","field":"moves","id":…}`.
      - With `crashAfterReports: n`, after the nth report it prints `crashStderrLines` lines `fake crash line 1` … `fake crash line N`, then `libc++abi: terminating due to uncaught exception of type StringError: fake crash`, and aborts.
    - **`terminate` and `terminate_all`.** It echoes the query as the acknowledgement. Then, for each matching replay in progress, it writes a final: the last report sent, with `"isDuringSearch":false`, or `{"id":…,"isDuringSearch":false,"noResults":true,"turnNumber":…}` if none was sent.
    - **stdin EOF.** With `onEof: "exit"` it exits with code 0 within 200 ms. With `"ignore"` it sleeps forever.

- [ ] **Step 1: Write the failing tests** in `tests/fake_katago.rs`. Each one spawns the binary directly with `std::process::Command`.
  - `answers_query_version_after_the_ready_line`: the version is `1.18.2`, and stderr contains the ready line before the reply arrives.
  - `replays_p1_with_reports_then_a_final`: there are ≥ 3 lines with `isDuringSearch:true` and then exactly one final, all with the query's `id`.
  - `terminate_returns_partial_final`: P2, then `terminate` after the first report. The acknowledgement comes first, then a final with `isDuringSearch:false`.
  - `exits_on_eof`: closing stdin gives exit code 0 within 1 s.
  - `startup_failure_aborts`: the exit is not a success, and the last stderr line starts `libc++abi`.
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji-engine --test fake_katago`. Expected: the binary is missing.
- [ ] **Step 3: Implement**, using only `std`, `serde` and `serde_json`.
- [ ] **Step 4: Run them to verify they pass.** Same command. Expected: PASS, in under 10 s in total.
- [ ] **Step 5: Lint and commit**

```bash
git add crates/aji-engine
git commit -m "test(engine): add a fake KataGo that replays recorded transcripts"
```

### Task 4: Engine process, state machine and watchdog

**Files:**
- Create: `crates/aji-engine/src/process.rs`, `src/engine.rs`, `src/state.rs`, `src/bin/engine-host.rs`, `tests/engine.rs`.

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces (`process.rs`):
  - `struct EngineFiles { pub katago: PathBuf, pub model: PathBuf, pub config: PathBuf, pub working_dir: PathBuf }`.
  - `struct LaunchSpec { pub program: PathBuf, pub args: Vec<OsString>, pub working_dir: PathBuf }`.
  - `fn katago_launch(files: &EngineFiles) -> LaunchSpec`, with exactly the Global Constraints arguments.
  - Spawning pipes all three streams and sets `kill_on_drop`. Per OS:
    - **Windows:** `CREATE_NO_WINDOW`. Right after spawn, the process is assigned to a job object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, whose handle lives as long as the process handle.
    - **Linux:** a `pre_exec` hook calls `prctl(PR_SET_PDEATHSIG, SIGKILL)`, then exits the child if `getppid()` is no longer the spawner's pid. The signal fires when the spawning *thread* exits, not the process. Tokio retires worker threads (after `block_in_place`) and blocking-pool threads, so all spawning happens on one dedicated `std::thread` named `aji-engine-spawner`, which lives for the whole process. The actor sends it spawn requests over a channel.
    - **macOS:** nothing extra. `-quit-without-waiting` plus stdin EOF is the mechanism (Global Constraints, Orphans).
  - stdout and stderr are read as lines, decoded as lossy UTF-8.
  - stderr is drained continuously into a ring of `stderr_lines`. A pipe nobody reads would block KataGo.
  - stdin is written by its own task, fed through a channel. The actor never awaits a write, so a hung KataGo with a full pipe cannot stall the watchdog.
- Produces (`state.rs`), serde and TypeScript export:
  - `enum EngineState`, tagged `state`, camelCase. The JSON shapes:
    - `{"state":"notConfigured"}`
    - `{"state":"starting"}`
    - `{"state":"ready","version":"1.18.2"}`
    - `{"state":"analysing","version":"1.18.2"}`
    - `{"state":"paused","version":"1.18.2"}`
    - `{"state":"stopped"}`
    - `{"state":"crashed","reason":"exited","exit":{"code":null,"signal":6},"stderrTail":["…"]}`
  - `enum CrashReason { SpawnFailed, Exited, NotResponding }`.
  - `struct ExitInfo { code: Option<i32>, signal: Option<i32> }`.
  - For `spawnFailed`, `stderrTail` holds one line, `aji: could not start KataGo: <io::ErrorKind>`.
- Produces (`engine.rs`):
  - `struct EngineOptions`, with the Global Constraints defaults in `Default`.
  - `enum EngineEvent { State(EngineState), Analysis(AnalysisUpdate) }`.
  - `enum EngineError { NotConfigured, NotRunning }`.
  - `struct Engine`, a cloneable handle to the actor task:
    - `Engine::spawn(files: Option<EngineFiles>, position: Position, options: EngineOptions, on_event: impl Fn(EngineEvent) + Send + Sync + 'static) -> Engine`. It must run inside a Tokio runtime. `None` gives `notConfigured`.
    - `fn state(&self) -> EngineState`
    - `fn pid(&self) -> Option<u32>`
    - `async fn set_position(&self, position: Position)`
    - `async fn pause(&self) -> Result<(), EngineError>`
    - `async fn resume(&self) -> Result<(), EngineError>`
    - `async fn restart(&self) -> Result<(), EngineError>`
    - `async fn stop(&self) -> Result<(), EngineError>`
    - `async fn shutdown(&self)`
  - The binary `engine-host <fake-katago> <scenario>` starts an `Engine` on P1, prints `pid <n>` once the state is `analysing`, then sleeps.
- **State machine.** One `State` event is emitted per transition, never per update.

  | From | Event | To |
  |---|---|---|
  | — | `spawn` with `None` | `notConfigured` |
  | — | `spawn` with files | `starting`; send `query_version` with id `aji-version` |
  | `starting` | the version reply | `analysing` if the position's cached visits are below the cap and the engine is not paused; `paused` if it is paused; otherwise `ready` |
  | `analysing` | a final for a query that was not terminated | `ready` (the cap was reached) |
  | `analysing` | a `QueryError` for the current query | `ready` |
  | `analysing` | `pause` | `paused`; terminate the query |
  | `paused` | `resume` | `analysing` (resubmit with `maxVisits` = cap), or `ready` if the cap is reached |
  | `starting` | `pause` / `resume` | stays `starting`; sets or clears the paused flag |
  | any running state | unexpected exit | `crashed` / `exited`, with exit info and stderr tail |
  | `starting` | spawn error | `crashed` / `spawnFailed` |
  | any running state | `stop` | close stdin, wait up to `shutdown_grace`, kill, then `stopped` |
  | any state except `notConfigured` | `restart` | `stop`, then `starting` |
  | `starting` | no version reply within `startup_timeout` | a hang |
  | after the version reply | a ping (`aji-ping-<n>`, every `ping_every`) unanswered after `ping_timeout` | a hang |
  | `analysing` | no increase in the active query's root visits within `stall_timeout` | a hang |
  | — | a hang | kill. A hang counts as the second one (`crashed` / `notResponding`) when the killed process is the automatically restarted one and it never answered its version query, or when it happens within `hang_window` measured from the moment that restarted process answered. Otherwise the engine restarts on its own (`starting`). A process that ran healthily for a full `hang_window` earns a fresh automatic restart |

  - `pause` and `resume` return `NotRunning` in `notConfigured`, `stopped` and `crashed`.
  - `restart` returns `NotConfigured` in `notConfigured`.
  - `stop` returns `NotConfigured` in `notConfigured`, and `Ok` when already stopped or crashed.
- **Analysis flow.**
  - Analysis query ids are `aji-<n>`.
  - Every `Analysis` line is converted with `to_update` against the position its query was submitted for, and offered to the cache.
  - An event is emitted when the update comes from the active query (or from the last query, when none is active), its position is the current one, and the throttle admits it. The cache keeps the most-visited result for the cap and for `set_position`; it does not filter what is shown.
  - `set_position` terminates any query for another position. If the cache holds the new position, its entry is emitted at once. A query is submitted unless the engine is paused or the cap is reached.
  - A `QueryError` for one of Aji's ids ends that query. Neither errors nor warnings are shown in M2; KataGo already writes both to stderr because of `logToStderr=true`.
- **Shutdown.** Close stdin, wait up to `shutdown_grace`, then kill. The app calls this on exit.

- [ ] **Step 1: Write the failing tests** in `tests/engine.rs`.
  - Use `EngineOptions` with `ping_every` 50 ms, `ping_timeout` 400 ms, `startup_timeout` 5 s, `shutdown_grace` 500 ms and `throttle` 0. At `speed` 20, P1's reports arrive about 12 ms apart, and the default 100 ms throttle would swallow them.
  - `throttle` itself is tested in Task 2.
  - The pause, resume and position-change tests use scenario `slow`; the others use `normal`.
  - Collect events into a channel. The deadline for every wait is 10 s.
  - `launch_args_are_exact`: a unit test of `katago_launch` against the Global Constraints argument list.
  - `reaches_analysing_and_streams_updates`: scenario `normal`, position P1. The events are `starting`, then `analysing` with version `1.18.2`, then ≥ 2 non-final `Analysis` events with rising `root_visits`, then a final, then `ready`.
  - `startup_failure_reports_crash_with_stderr_tail`: scenario `startup-failure` gives `crashed`/`exited`. The exit is not code 0; on Unix it is `signal: Some(6)`. The last `stderrTail` line starts `libc++abi`.
  - `missing_binary_reports_spawn_failed`.
  - `crash_mid_analysis_keeps_the_last_50_lines`: scenario `crash` with `crashAfterReports: 2` and `crashStderrLines: 60`. The tail has exactly 50 lines: `fake crash line 12` to `fake crash line 60`, then the `libc++abi` line.
  - `restart_after_crash_returns_to_analysing`.
  - `pause_then_resume`: pause gives `paused`. The final emitted after the pause has `is_final` true.
  - `resume_shows_the_live_search`: after resume, the first emitted update has fewer `root_visits` than the last one before the pause (the fake replays from low visits), and the resumed search only rises.
  - `restart_after_crash_shows_the_live_search`: after a restart, the new process's reports are emitted although the crashed search had shown more visits.
  - `stale_position_updates_are_not_emitted`: start on P1, then `set_position(P2)` after the first update. No event after that call carries P1's key.
  - `stop_ends_the_process`: the state is `stopped`, and `pid` is no longer alive.
  - `hang_restarts_once_then_reports_not_responding`: scenario `hang`. The events are `starting`, `analysing`, `starting` (the automatic restart), `analysing`, then `crashed`/`notResponding`.
  - `starts_from_a_folder_with_cjk_and_spaces`:
    - Copy `fake-katago`, the scenario and the transcript into a temporary folder named `棋谱 测试`.
    - Use `EngineFiles` with `working_dir` set to that folder, and relative `config` and `model`.
    - Expected: the state reaches `analysing`.
  - `force_quit_leaves_no_engine`:
    - Spawn `engine-host` with scenario `normal` on macOS, and `ignore-eof` on Linux and Windows, which proves the OS mechanism rather than the fake's EOF handling.
    - Read the KataGo pid from its output, then kill the host with `Child::kill`.
    - Expected: the pid is gone within 5 s. Check with `kill(pid, 0)` on Unix and `OpenProcess` plus `GetExitCodeProcess` on Windows.
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji-engine --test engine`. Expected: compile errors.
- [ ] **Step 3: Implement.** Dependencies:
  - `tokio`, with `rt`, `macros`, `process`, `io-util`, `sync` and `time`;
  - on Linux, `libc`;
  - on Windows, `windows-sys` with `Win32_Foundation`, `Win32_System_JobObjects` and `Win32_System_Threading`;
  - as a dev-dependency, `tempfile`.
- [ ] **Step 4: Run them to verify they pass.** Run `cargo test -p aji-engine`. Expected: PASS. Run the whole suite three times in a row to shake out timing flakes.
- [ ] **Step 5: Compile-check the other OSes locally** (optional; the owner approves the target download)

  Run `rustup target add x86_64-pc-windows-msvc x86_64-unknown-linux-gnu`, then `cargo check -p aji-engine --all-targets --target x86_64-pc-windows-msvc` and the same for `x86_64-unknown-linux-gnu`. Expected: no errors. CI in Task 7 is the real check.
- [ ] **Step 6: Lint and commit**

```bash
git add Cargo.lock crates/aji-engine src/transport/generated
git commit -m "feat(engine): run KataGo with crash, hang and orphan protection"
```

### Task 5: Protocol, dispatcher, events and the development engine setting

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/{protocol,service,ipc,lib}.rs`, `src-tauri/tests/ipc.rs`, `src-tauri/capabilities/default.json`.
- Create: `src-tauri/src/settings.rs`, `src-tauri/src/window.rs`, `src-tauri/tests/capabilities.rs`, `docs/development.md`.

**Interfaces:**
- Consumes: Task 4's `Engine`, `EngineState`, `EngineEvent`, `EngineError` and `AnalysisUpdate`.
- Produces (`protocol.rs`):
  - New `Request` variants: `EngineStatus`, `EngineRestart`, `EngineStop`, `AnalysisPause`, `AnalysisResume`. JSON: `{"type":"engineStatus"}` and so on.
  - New `Response` variants: `EngineStatus { engine: EngineState }` → `{"type":"engineStatus","engine":{…}}`, and `Ok` → `{"type":"ok"}`.
  - `enum AppEvent`, tagged `type`, camelCase, `Serialize`, TypeScript export. The variants are `EngineState { engine: EngineState }` → `{"type":"engineState","engine":{…}}` and `AnalysisUpdate { analysis: AnalysisUpdate }` → `{"type":"analysisUpdate","analysis":{…}}`.
  - `ErrorCode` gains `EngineNotConfigured` → `"engineNotConfigured"` and `EngineNotRunning` → `"engineNotRunning"`.
- Produces (`service.rs`, still free of Tauri):
  - `trait EventSink: Send + Sync + 'static { fn emit(&self, event: AppEvent); }`.
  - `fn forward_engine_events(sink: Arc<dyn EventSink>) -> impl Fn(EngineEvent) + Send + Sync + 'static`.
  - `AppContext` gains `pub engine: Engine`, and `AppContext::detect(version: String, engine: Engine)` takes it.
  - `handle` maps the engine requests onto `Engine`, and maps `EngineError` onto the two codes.
- Produces (`ipc.rs`): `struct TauriEventSink<R: Runtime>(AppHandle<R>)`, which emits on `aji://event`.
- Produces (`lib.rs`):
  - `configure(builder)` registers `rpc` only; tests call `.manage(ctx)` themselves.
  - `run()` uses `setup` to do three things:
    1. Fit the window (`window.rs`).
    2. Load `settings.json` from `app_config_dir`.
    3. Build `EngineFiles` from the setting, start `Engine::spawn` inside `tauri::async_runtime::block_on` on the default position, and manage the `AppContext`.
    
    On `RunEvent::Exit` it calls `engine.shutdown()`.
- Produces (`settings.rs`):
  - `struct Settings { dev_engine: Option<DevEngine> }`, serde camelCase, unknown fields ignored.
  - `struct DevEngine { katago: PathBuf, model: PathBuf, config: PathBuf }`. All three must be absolute; the working directory is the config's folder. `EngineFiles` gets the config's file name, and the model relative to the config's folder when it lives there (otherwise its absolute path). The KataGo binary stays absolute (final review I1).
  - `fn load_settings(path: &Path) -> Result<Settings, SettingsError>`.
    - A missing file gives `Ok(Settings::default())`.
    - Malformed JSON or a relative path gives `Err`. `run()` then logs it with `eprintln!` and starts with no engine.
- Produces (`window.rs`, deferred finding 10):
  - `fn fit_window(default: (f64, f64), min: (f64, f64), work_area: (f64, f64)) -> (f64, f64)`, in logical pixels. Each side is the smaller of its default and the work area, but no smaller than the minimum.
  - `setup` applies it to the main window from `current_monitor()`'s work area divided by its scale factor, and centres the window when the size changed. If `work_area()` is unavailable in the Tauri version in use, use the monitor size; record that choice in the ledger.
- Capability (deferred finding 9): `"permissions": ["core:event:default"]` replaces `core:default`.

- [ ] **Step 1: Write the failing tests**
  - `protocol.rs`: JSON shapes for each new request, `Response::EngineStatus`, `Response::Ok`, both `AppEvent` variants, and both new error codes.
  - `service.rs`, with an `Engine` spawned with `None`:
    - `engineStatus` → `notConfigured`;
    - `engineRestart` → `Err(engineNotConfigured)`;
    - `analysisPause` → `Err(engineNotRunning)`;
    - `forward_engine_events` turns `EngineEvent::State(Starting)` into `AppEvent::EngineState`, checked with a recording sink.
  - `settings.rs`:
    - a missing file gives the default;
    - a valid file gives `DevEngine` with the three paths;
    - `{"devEngine":{"katago":"katago",…}}` (relative) gives `Err`;
    - `{not json` gives `Err`;
    - an unknown top-level field is ignored.
  - `window.rs`:
    - `fit_window((1440,900),(1024,640),(1280,688))` = `(1280,688)`;
    - with a work area of `(2560,1400)` the result is `(1440,900)`;
    - with a work area of `(800,600)` it is `(1024,640)`.
  - `tests/ipc.rs`:
    - `rpc` with `{"request":{"type":"engineStatus"}}` against a not-configured engine returns `{"type":"engineStatus","engine":{"state":"notConfigured"}}`;
    - `engine_events_reach_the_webview_channel`: emitting through `TauriEventSink` reaches a listener on `aji://event` with the JSON payload.
  - `tests/capabilities.rs`: the main window's permissions are exactly `["core:event:default"]`.
- [ ] **Step 2: Run them to verify they fail.** Run `cargo test -p aji`. Expected: compile errors.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Write `docs/development.md`.** It covers:
  - where `settings.json` lives on each OS (`app_config_dir` of `io.github.reallxuan.aji`);
  - the `devEngine` JSON, and that paths must be absolute;
  - on the Mac, `brew install katago` and the b18 network path;
  - a config to copy (`/opt/homebrew/share/katago/configs/analysis_example.cfg`, into a folder the user owns), noting that `nnMaxBatchSize` is required;
  - that Aji forces `-quit-without-waiting` and `reportAnalysisWinratesAs=BLACK,logToStderr=true`;
  - on Windows, unzipping a KataGo release and a network by hand;
  - that the setting goes away once M5's wizard exists.
- [ ] **Step 5: Run them to verify they pass.** Run `cargo test --workspace`. Expected: PASS. `src/transport/generated/` gains `AppEvent.ts`, `EngineState.ts`, `AnalysisUpdate.ts`, `Candidate.ts` and the related types.
- [ ] **Step 6: Lint and commit**

```bash
git add src-tauri Cargo.lock docs/development.md src/transport/generated
git commit -m "feat: expose engine state, analysis events and engine controls over rpc"
```

### Task 6: UI: subscription, engine store, indicator, status and candidates

**Files:**
- Modify:
  - `src/transport/{transport,tauri,fake,api}.ts` and their tests;
  - `src/App.tsx`;
  - `src/locales/{en,zh-CN}.json`;
  - `src/styles/theme.css`;
  - `package.json` and `pnpm-lock.yaml`.
- Create:
  - `src/engine/engineStore.ts`, `src/engine/useEngineSync.ts`, `src/board/coordinates.ts`;
  - `src/panel/{EngineIndicator,EngineStatus,CandidateList}.tsx`;
  - tests next to each.

**Interfaces:**
- Consumes: the generated `AppEvent`, `EngineState`, `AnalysisUpdate`, `Candidate`, `Move` and `Point`.
- Produces:
  - In `Transport`, `subscribe(listener: (event: AppEvent) => void): () => void`.
    - Tauri: `listen('aji://event')`. An unsubscribe that runs before `listen` resolves still unlistens once it does.
    - Fake: `createFakeTransport(handler)` returns `FakeTransport = Transport & { emit(event: AppEvent): void }`.
  - `KNOWN_CODES` gains `engineNotConfigured` and `engineNotRunning`.
  - `api.ts`: `getEngineStatus`, `pauseAnalysis`, `resumeAnalysis`, `restartEngine`. Each throws `TransportError` on an unexpected response type, like `getAppInfo`.
  - `createEngineStore()`: a Zustand vanilla store.
    - State: `{ engine: EngineState | null; analysis: AnalysisUpdate | null; sawEvent: boolean }`.
    - `applyEvent(event)` sets `sawEvent`.
    - `applyStatus(state)` is ignored once `sawEvent` is true.
    - `EngineStoreProvider` and `useEngineStore(selector)` share one store through React context. `main.tsx` creates the app's store; tests create their own.
    - `useEngineSync()` subscribes first, then requests `engineStatus`. `App` calls it once.
  - `pointLabel(point: Point, size: number): string` and `moveLabel(move: Move, size: number): string`. The labels match Task 1's GTP table, with `pass` → `t('analysis.pass')`.
- UI (interface design 4.1):
  - **Panel header.** A right-aligned engine indicator, a 10 px round button.
    - Colour: `engine-ok` when analysing; `engine-error` when crashed; `line` otherwise.
    - Click: analysing → `analysisPause`; paused → `analysisResume`; otherwise disabled.
    - Its `aria-label` is the action (`engine.action.pause` or `engine.action.resume`), else the state text. Its `title` is the state text.
  - **Status line.** Shown for every state except analysing and paused.
    - It shows the state text.
    - When crashed, it adds the reason text and the exit line (`engine.crash.exitCode` or `engine.crash.signal`), the stderr tail in a scrollable `<pre>` headed `engine.crash.details`, and a `engine.action.restart` button.
  - **Candidate list.** A header row of the four column labels, then up to 10 rows: move label, win rate, score lead and visits.
    - Win rate uses `Intl.NumberFormat(lang, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })`.
    - Score lead uses exactly one decimal (`minimumFractionDigits` and `maximumFractionDigits` 1) with `signDisplay: 'exceptZero'`.
    - Visits use grouping.
- Theme:
  - A new token, `engine-error`: `#e5484d` dark, `#c62828` light **[Proposed]**, mapped in `@theme inline`.
  - Deferred finding 5: the dark tokens apply under `:root, :root[data-theme='dark']`, so the first frame before `main.tsx` runs is already dark.
- Locale strings, exact:

  | Key | en | zh-CN |
  |---|---|---|
  | `engine.state.notConfigured` | No engine is set up. | 尚未设置引擎。 |
  | `engine.state.starting` | Starting KataGo… | 正在启动 KataGo… |
  | `engine.state.ready` | KataGo is ready. | KataGo 已就绪。 |
  | `engine.state.analysing` | Analysing | 分析中 |
  | `engine.state.paused` | Analysis paused | 分析已暂停 |
  | `engine.state.stopped` | KataGo is stopped. | KataGo 已停止。 |
  | `engine.state.crashed` | KataGo has stopped. | KataGo 已停止运行。 |
  | `engine.crash.exited` | KataGo quit unexpectedly. | KataGo 意外退出。 |
  | `engine.crash.notResponding` | KataGo stopped responding. | KataGo 没有响应。 |
  | `engine.crash.spawnFailed` | KataGo could not be started. | 无法启动 KataGo。 |
  | `engine.crash.exitCode` | Exit code {{code}} | 退出代码 {{code}} |
  | `engine.crash.signal` | Ended by signal {{signal}} | 被信号 {{signal}} 终止 |
  | `engine.crash.details` | Last lines from KataGo | KataGo 最后的输出 |
  | `engine.action.pause` | Pause analysis | 暂停分析 |
  | `engine.action.resume` | Resume analysis | 继续分析 |
  | `engine.action.restart` | Restart engine | 重启引擎 |
  | `analysis.columns.move` | Move | 落点 |
  | `analysis.columns.winrate` | Black win rate | 黑方胜率 |
  | `analysis.columns.scoreLead` | Black lead | 黑方领先 |
  | `analysis.columns.visits` | Visits | 计算量 |
  | `analysis.pass` | Pass | 停一手 |
  | `errors.engineNotConfigured` | No engine is set up. | 尚未设置引擎。 |
  | `errors.engineNotRunning` | KataGo is not running. | KataGo 未在运行。 |

- [ ] **Step 1: Write the failing tests**
  - `tauri.test.ts`:
    - with `mockIPC(…, { shouldMockEvents: true })`, an `emit('aji://event', payload)` reaches the listener;
    - unsubscribing before `listen` resolves delivers nothing afterwards.
  - `fake.test.ts`: `emit` reaches subscribers, and unsubscribe stops it.
  - `engineStore.test.ts`:
    - `status reply never overwrites a newer event`: `applyEvent(analysing)`, then `applyStatus(starting)`, leaves `analysing`;
    - `applyStatus` before any event applies.
  - `coordinates.test.ts`: the same table as Task 1's `gtp_round_trip`, in the formatting direction.
  - `EngineIndicator.test.tsx`:
    - analysing renders a button named "Pause analysis", and clicking it sends `{"type":"analysisPause"}`;
    - paused gives "Resume analysis";
    - crashed gives a disabled button with `data-state="crashed"`.
  - `EngineStatus.test.tsx`:
    - crashed, `exited`, with `exit {code:null, signal:6}` and two tail lines, shows "KataGo quit unexpectedly.", "Ended by signal 6" and both lines; Restart sends `engineRestart`;
    - `notConfigured` in `zh-CN` shows "尚未设置引擎。".
  - `CandidateList.test.tsx`: an update whose candidate 0 is Q16 with winrate 0.3721, scoreLead -0.95 and 1234 visits shows `Q16`, `37.2%`, `-1.0` and `1,234` (en). The list stops at 10 rows when there are 20 candidates.
  - The locale parity test passes with the new keys.
- [ ] **Step 2: Run them to verify they fail.** Run `pnpm test`. Expected: failures for the missing modules.
- [ ] **Step 3: Implement.** Add `zustand`. In `App.tsx`, the panel holds the header (indicator), then the status line, then the candidate list, then the version line in the footer.
- [ ] **Step 4: Run them to verify they pass.** Run `pnpm lint && pnpm typecheck && pnpm test && node scripts/check-npm-licenses.mjs`. Expected: all pass.
- [ ] **Step 5: Commit**

```bash
git add src package.json pnpm-lock.yaml
git commit -m "feat(ui): show engine state and live candidates"
```

### Task 7: CI on three OSes

**Files:**
- Modify: `.github/workflows/ci.yml`.

- [ ] **Step 1: Matrix the `rust` job**
  - `strategy.matrix.os: [ubuntu-24.04, macos-15, windows-latest]`, with `fail-fast: false`.
  - The Tauri Linux prerequisites step runs only on Linux.
  - `cargo fmt --all --check` runs only on Linux.
  - `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` run on all three. Clippy runs per OS because the Windows and Linux process code compiles only there.
- [ ] **Step 2: Fix the generated-bindings gate** (deferred finding 4). On Linux only, run `rm -rf src/transport/generated` before `cargo test --workspace`, then keep the existing `git diff --exit-code` and porcelain checks, so orphaned files fail too.
- [ ] **Step 3: Check the workflow locally.** Run `pnpm exec prettier --check .github/workflows/ci.yml`, and read the matrix back. Expected: valid YAML; the `bundle` job still `needs: [frontend, rust, licenses]`.
- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run Rust checks and tests on Windows, macOS and Linux"
```

- [ ] **Step 5: Push and watch CI.** Stop here and ask the owner to approve the push of `feat/m2-analysis-skeleton`. Expected: every job is green on all three OSes. On Windows and Linux, `force_quit_leaves_no_engine` and `starts_from_a_folder_with_cjk_and_spaces` are the only evidence for the job object, `CREATE_NO_WINDOW` and the parent-death signal. Read their output in the logs rather than trusting the green tick.

### Task 8: Exit check on the real machines

- [ ] **Step 1: Mac setup**
  - Copy `analysis_example.cfg` to `~/Aji-dev/analysis.cfg`.
  - Write `settings.json` per `docs/development.md`, pointing at `/opt/homebrew/bin/katago`, the b18 network and that config.
- [ ] **Step 2: Build locally**, as the owner prefers. Run `pnpm tauri build --bundles app`, then open `target/release/bundle/macos/Aji.app`.

  Expected:
  - The indicator turns green within a minute, after the Metal warm-up.
  - The candidate list for the empty board updates several times a second, with win rates near 37% (the recorded value for Black with komi 7.5).
  - The top rows are the four 4-4 points (Q16, Q4, D16, D4) and then the 3-4 points, all showing the same numbers within each group. KataGo copies symmetric moves (`isSymmetryOf`); this is not a bug. M7 decides how to draw them.
- [ ] **Step 3: Controls**
  - Click the indicator: `Analysis paused`, and the numbers freeze.
  - Click again: it resumes. The visits restart from a low number and climb, because KataGo starts every query from zero.
- [ ] **Step 4: Crash.** Run `pkill -9 katago`. Expected: the crashed state appears, with `Ended by signal 9` and the stderr tail. Restart returns to analysing.
- [ ] **Step 5: Quit and force-quit**
  - Quit Aji with ⌘Q. `pgrep -x katago` prints nothing within 3 s.
  - Force-quit Aji while the indicator still shows "Starting KataGo…". `pgrep -x katago` prints nothing within 3 s.
  - Reopen it, then run `pkill -9 -f 'Aji.app/Contents/MacOS/'`. `pgrep -x katago` prints nothing within 3 s.
- [ ] **Step 6: Windows PC (the owner may skip, as in M1).** Repeat Steps 2 to 5 with a manual-dispatch CI installer and a hand-unzipped KataGo, using Task Manager instead of `pgrep`.
- [ ] **Step 7: Update the docs**
  - Mark M2 done in this plan and in the roadmap, with the date and what was checked.
  - Record anything learned that M3 to M5 need, such as the real Metal warm-up time inside the app.
  - Commit: `docs: mark M2 analysis skeleton done`.

## Deferred items carried

- The M1 deferred findings folded in here are 4 (Task 7), 5 (Task 6), 9 (Task 5) and 10 (Task 5). Findings 1, 2, 3, 6, 7, 8 and 11 stay with the owner.
- The audit proposals other than G1 stay open. K1's default (Chinese, 7.5) is used here as **[Proposed]**.
