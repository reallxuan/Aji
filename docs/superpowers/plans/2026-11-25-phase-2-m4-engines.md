# Phase 2 M4 Part 1: Engine Profiles and the Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch between several KataGo networks in one click, add a downloaded, imported or own-files engine, and read the engine log and protocol in a console; plus four engine backlog items.

**Architecture:**
- **`aji-manager`** keeps the profiles in the install record (still schema 1): every set is a managed profile, own-file profiles sit beside the sets, and `current` names the one that runs. The `Installer` switches, renames, removes and adds profiles under its record lock, and hands new files to the engine with the existing `Engine::set_files`.
- **`aji-engine`** keeps a console log (stderr and Aji's notes always; protocol lines only while a console is open), sends console queries, and puts a deadline on a kill.
- **`src-tauri`** maps new requests and events, opens file dialogs on the engine's machine, honours `devEngine`, stops a running job and pushes a reset trend on a switch.
- **The interface** adds the profile chip and menu, the add dialog, the profile list in Settings, and the console panel (a sheet on the phone). The browser fake supports all of it.

**Tech Stack:** Rust (Tokio, serde, ts-rs), React 19, Zustand 5, radix-ui, i18next, Tailwind 4, Vitest with Testing Library. No new dependency.

**Spec:** [M4 part 1 design](../specs/2026-11-25-p2-m4-engines-design.md), approved by the owner on 2026-11-25. Mockup: [`docs/design/mockups/p2-m4/engines.html`](../../design/mockups/p2-m4/engines.html). Section numbers below (6.2 and so on) are the design's.

**Status:** Built on 2026-11-26, except the items under Outstanding.
- **Checks.** Every check passes on the Mac: `cargo fmt --check`, clippy with `-D warnings`, 994 Rust tests, `pnpm lint`, `pnpm typecheck`, 1,065 TypeScript tests in 144 files, `cargo deny check licenses`, the npm licence check and the notices test. No new dependency.
- **Browser** (`pnpm dev`, 1440 × 900 and 375 × 812, dark and light, English and 简体中文): the chip menu, a switch with and without a running job, the add dialog's three ways and a field error, an own-files profile added, the settings list with rename and remove, the console's filters, 展开, a sent `query_version`, a refusal, and the phone sheet. It found five bugs, each fixed and folded into the commit it corrects:
  - the add dialog spilled past its right edge in English (its grid track grew to the segment labels);
  - the settings list's ⋯ buttons sat off-screen (the same grid track, sized by the untruncated second line);
  - 重命名 left the cursor nowhere (the field took focus while the menu still held it; it now takes it as the menu closes, text selected);
  - the profile chip pushed the gear out of the default right column (the chip now gives way first);
  - on the phone the console opened behind the settings sheet.
- **Final review.** A fresh review of the whole branch found nothing critical and six important issues; one minor was re-graded important. Each was fixed with a test that failed first and folded into the commit it corrects:
  - Settings kept a stale install record after a switch or a remove, so 测速 measured and re-activated the previous profile, and the unused row waited for a reopen;
  - the console's single 6,000-line cap pushed every log line out after about ten minutes of analysis (the store now keeps 1,000 log and 5,000 protocol lines, as the backend does);
  - choosing the running profile in the chip menu restarted KataGo;
  - a console query carrying one of Aji's own ids could end Aji's query (typed ids now go out as `console-<id>`);
  - a refused switch or add still stopped a whole-game job, and two switches could cross (the service refuses first, and the installer holds one lock from the record write until KataGo has the files);
  - 删除未使用的文件 deleted Aji's KataGo or network when an own-files profile used it;
  - Enter that picks an input method's text saved a rename or sent a console query.
- **Deferred minors** (for Phase 2 planning):
  - the console's open count can leak on a webview reload, so protocol lines keep being captured;
  - protocol lines are cloned before the open check, and the backend and the store keep them after the last console closes;
  - the process-level kill deadline is effectively unreachable (the engine gives up first), so its console note never shows;
  - 使用自己的 KataGo accepts relative paths and does not trim them;
  - adding by download stops a running whole-game job without asking, when the download ends;
  - importing a network that already has a profile on the build again wipes its measurements;
  - the console's start note names only the KataGo path, and a switch adds no note;
  - `active` can name no set after removing the last-used managed profile while an own profile runs (an older Aji then starts unconfigured);
  - the console re-renders all its rows every 100 ms, auto-scroll stops at the cap, and 复制 can copy tens of MB;
  - the browser fake has no `devEngine` scenario, no busy switch, no batching and no long lines.
- **Outstanding:**
  - the owner's walk of design 11 on the built app: download a second network and switch both ways, an own-files profile on the Homebrew KataGo and one broken path, removing a profile and deleting its network, and the console against the real KataGo;
  - CPU use with a full console while analysing (no virtualisation yet);
  - once `fix/classic-layout-header` is on `main` with this branch, its one-row header budget (600 px) should allow for the profile chip (about 150 px).

## Global Constraints

- Everything from Phase 1 and Phase 2 M1 to M3 still holds: interface text in both locales; dependency licences (`cargo deny check licenses`, the npm licence check, the notices check); Conventional Commits ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `aji-core` depends on no workspace crate; errors are `{ code, message, detail }`, camelCase JSON, ts-rs bindings regenerated by `cargo test`.
- No git worktrees, for subagents too. Work in `/Users/zepher/personal/Aji` on `feat/p2-m4-engines`. Its first commit is the design and mockup, this plan is its second. Push only when the owner asks.
- No "·" in any interface text, in either locale or a mockup (`src/i18n/parity.test.ts`).
- Chinese strings quoted in the design or mockup are the `zh-CN` values; write natural English for `en`.
- The interface never reads a path or a file itself: paths are the engine machine's, and file dialogs open there through `FilePicker` (charter 6.1).
- The install record stays on `RECORD_SCHEMA = 1`. New fields carry `#[serde(default)]` and are skipped when empty, so v0.1.0 reads a new record and runs its `active` set (design 8).
- Values fixed by the design:

  | Value | Where |
  |---|---|
  | Kept stderr and Aji lines: 1,000 | 6.5 |
  | Kept protocol lines while a console is open: 5,000, each cut at 64 KB | 6.5 |
  | Console event batching: at most every 100 ms | 6.5 |
  | A reply shown cut at 400 characters, with 展开 | 6.5 |
  | Console ids: `console-<n>` | 6.5 |
  | Refused from the console: `terminate_all`, `terminate` of a non-console id, any query without `action` | 6.5 |
  | Switch question while a job runs: 切换引擎会停止整盘分析（已完成 {{done}} / {{total}}）。已有结果会保留，切回来时还在。仍然切换吗？ | 6.2, mockup |
  | The developer override entry: 开发引擎 (settings.json) | 6.1 |

## Review Focus

1. **A v0.1.0 record** (sets plus `active`, no `current`, no names) reads as one profile per set with the active set current, and the engine starts as before. (Task 1)
2. **Removing a profile whose network another profile uses** leaves that network out of the unused files; own-file paths are never deleted. (Task 1)
3. **Switching from any engine state** (starting, crashed, stopped, not configured) runs the new profile, and a switch while a job runs stops the job. (Tasks 2, 4)
4. **Own-files paths with spaces or non-ASCII characters** start KataGo, as `devEngine` does today (working folder at the config's folder). (Task 2)
5. **A flood of long protocol lines** never grows memory past the caps, and nothing is captured while no console is open. (Task 3)

---

### Task 1: Profiles in the install record

**Files:**
- Modify: `crates/aji-manager/src/install/record.rs`, `crates/aji-manager/src/install/unused.rs`, `crates/aji-manager/src/install/mod.rs` (exports)
- Test: the same files' `tests` modules

**Interfaces:**
- Produces:
  - `EngineSet.name: Option<String>` (`#[serde(default, skip_serializing_if = "Option::is_none")]`).
  - `pub struct OwnProfile { pub id: String, pub name: String, pub katago: PathBuf, pub model: PathBuf, pub config: PathBuf }`, serde camelCase; `Installed.own: Vec<OwnProfile>` (default, skipped when empty).
  - `#[serde(tag = "kind", rename_all = "camelCase")] pub enum ProfileKey { Set { engine: String, network: String }, Own { id: String } }`; `Installed.current: Option<ProfileKey>` (default, skipped when `None`).
  - `ProfileKey::id(&self) -> String`: `"<engine>/<network>"` for a set, the own id for an own profile. `Installed::profile_key(&self, id: &str) -> Option<ProfileKey>`.
  - `Installed::current_key(&self) -> Option<ProfileKey>`: `current`, else `active` as a `Set` key (a v0.1.0 record).
  - `Installed::set_current(&mut self, key: ProfileKey)`: sets `current`; for a `Set` key also sets `active`, so an older Aji runs the same set.
  - `pub fn profile_files(root: &InstallRoot, installed: &Installed, key: &ProfileKey) -> Option<EngineFiles>`: `engine_files` for a set; for an own profile the same layout `DevEngine::files` builds (working folder at the config's folder, config by file name, model relative when inside it). Move that layout into `aji-manager` as `pub fn own_files(katago: &Path, model: &Path, config: &Path) -> EngineFiles`, and make `DevEngine::files` call it.
  - `unused_paths` keeps the components of **every** set; `only_active` becomes `only_used(installed) -> Installed`, which drops engines, runtimes and networks no set names and keeps every set, `own` and `current`.
  - New own ids: `own-<n>`, `n` one past the highest existing.

- [ ] **Step 1: Write the failing tests** in `record.rs`:
  - `a_v010_record_reads_with_the_active_set_current`: a JSON record with `sets` and `active`, no `current` → `current_key() == Some(ProfileKey::Set { .. })` equal to the active key, and every set has `name == None`.
  - `profile_fields_round_trip_and_are_skipped_when_empty`: save a default record → the JSON has no `own`, `current` or `name` keys; save one with an own profile and a current key → it loads back equal.
  - `set_current_keeps_active_for_older_versions`: `set_current(Set)` sets both; `set_current(Own)` leaves `active` as it was.
  - `own_files_run_from_the_config_folder`: paths with a space and `棋` in them → `working_dir` is the config's folder, `config` is its file name, `model` is relative when inside it, `katago` stays absolute.

  In `unused.rs`:
  - `every_set_keeps_its_files`: two sets sharing an engine, different networks → neither network is unused.
  - `a_network_no_set_names_is_unused`: remove the second set from `sets` → its network file is in `unused_paths`; the shared engine is not.
  - `own_profiles_are_never_unused`: an own profile pointing inside the install root's `networks/` does not keep a file no set names, and nothing outside the root is listed.
- [ ] **Step 2: Run** `cargo test -q -p aji-manager record unused`. Expected: FAIL (missing fields and functions).
- [ ] **Step 3: Implement** the fields, `ProfileKey`, `OwnProfile`, `current_key`, `set_current`, `profile_key`, `own_files`, `profile_files` and `only_used` as above. `DevEngine::files` in `src-tauri/src/settings.rs` calls `aji_manager::install::own_files`.
- [ ] **Step 4: Run** `cargo test -q -p aji-manager` and `cargo test -q -p aji --lib settings`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(manager): keep engine profiles in the install record`.

### Task 2: The installer manages profiles

**Files:**
- Modify: `crates/aji-manager/src/install/job.rs`, `crates/aji-manager/src/install/unused.rs` (summaries)
- Create: `crates/aji-manager/src/install/profiles.rs` (summaries and the own-files check)
- Test: `crates/aji-manager/tests/` beside the existing installer tests, or `job.rs`'s tests module, following where `remove_unused` is tested today

**Interfaces:**
- Consumes: Task 1.
- Produces (ts-rs exported, camelCase):
  - `pub struct ProfileSummary { id: String, name: String, current: bool, source: ProfileSource }`.
  - `#[serde(tag = "kind")] pub enum ProfileSource { Managed { engine: String, version: String, backend: Backend, network: String, network_name: String, threads: u32, visits_per_second: Option<f64> }, Own { katago: String, model: String, config: String } }`. Paths are display strings.
  - `pub enum OwnFile { Katago, Model, Config }` and `pub enum OwnProblem { Missing, NotKatago, Unreadable }`, both ts-exported camelCase; `pub struct OwnRefusal { file: OwnFile, problem: OwnProblem }`.
  - `pub enum ProfileError { NoSuchProfile, Current, Busy, Own(OwnRefusal), Io(String) }`.
  - `Installer::profiles(&self) -> Vec<ProfileSummary>`: sets first in record order, then own profiles. A set's name defaults to its network's display name.
  - `async Installer::switch_profile(&self, id: &str) -> Result<(), ProfileError>`: under the record lock, `set_current`; then `profile_files` and `aji_engine::identity_for`, and `self.engine.set_files(Some(files), identity)`. Refused `Busy` while a job runs (`jobs.current.is_some()`).
  - `Installer::rename_profile(&self, id: &str, name: String) -> Result<(), ProfileError>`: trimmed; an empty name clears it (back to the default).
  - `Installer::remove_profile(&self, id: &str) -> Result<(), ProfileError>`: `Current` for the current profile; otherwise drops the set or own entry. Deletes no file.
  - `async Installer::add_own_profile(&self, katago: PathBuf, model: PathBuf, config: PathBuf, name: Option<String>) -> Result<ProfileSummary, ProfileError>`: checks in order katago, model, config. Each must exist (`Missing`). The binary must answer `katago version` within 10 s with a line starting `KataGo v` (`NotKatago`), run with `aji_engine::process::run_to_end`. `identity_of(model, config)` must succeed (`Unreadable` on the model or config, whichever fails to read). Then adds `own-<n>`, named `name` or the model's file name without `.bin.gz`/`.txt.gz`, makes it current and switches the engine to it.
  - `activate` (install jobs) calls `set_current(Set)` instead of setting `active` alone.
  - A set added by a job **without** `benchmark` takes the current managed profile's `threads` when there is one, instead of the plan's default (design 6.3); with `benchmark` it measures as today.
  - Which build a download uses is the caller's choice (Task 7 passes it); the installer does not change.
  - **M5 minor 11:** `import_network` counts itself in a new `importing: AtomicUsize` around its copy; `remove_unused` returns `RemoveError::Busy` while it is non-zero.
  - `remove_unused` and `unused_bytes` use `only_used` and the every-set `unused_paths` from Task 1.

- [ ] **Step 1: Write the failing tests:**
  - `switching_runs_the_new_profiles_files`: two sets, switch to the second → the record's `current` and `active` name it, and the fake engine got `set_files` with its network.
  - `the_current_profile_cannot_be_removed` → `ProfileError::Current`; removing the other leaves its files on disk.
  - `a_removed_profiles_network_becomes_unused_unless_shared`.
  - `an_own_profile_names_the_failing_file`: missing model → `Own(OwnRefusal { file: Model, problem: Missing })`; a shell script that prints `hello` as katago → `NotKatago`; a good fake KataGo (the test KataGo the engine tests use) → added as `own-1`, current, and the engine switched.
  - `a_job_without_benchmark_takes_the_current_threads`: current set with `threads: 6`, install another network without benchmark → the new set has `threads: 6` and an empty `benchmark`.
  - `remove_unused_waits_for_an_import`: hold an import in its copy (a test seam or a slow reader) → `remove_unused` is `Busy`.
  - `switching_while_a_job_runs_is_busy`.
- [ ] **Step 2: Run** `cargo test -q -p aji-manager profile`. Expected: FAIL.
- [ ] **Step 3: Implement** the methods above in `profiles.rs` and `job.rs`.
- [ ] **Step 4: Run** `cargo test -q -p aji-manager` and `cargo clippy -q -p aji-manager --all-targets -- -D warnings`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(manager): switch, add, rename and remove engine profiles`.

### Task 3: The console log and the kill deadline in the engine

**Files:**
- Create: `crates/aji-engine/src/console.rs`
- Modify: `crates/aji-engine/src/engine.rs`, `crates/aji-engine/src/process.rs`, `crates/aji-engine/src/lib.rs`
- Test: `console.rs` tests; engine tests with the fake KataGo

**Interfaces:**
- Produces (ts-exported, camelCase):
  - `pub enum ConsoleKind { Stderr, Aji, Sent, Received }`.
  - `pub struct ConsoleLine { seq: u64, at_ms: u64 /* Unix ms */, kind: ConsoleKind, text: String }`.
  - `pub struct ConsoleLog` (cheaply cloned, `Arc` inside): `push(kind, text)`, `lines_after(seq: u64) -> Vec<ConsoleLine>`, `set_open(open: bool)` (a count: `true` adds one, `false` takes one, never below zero), `is_open() -> bool`, `subscribe(f: impl Fn(Vec<ConsoleLine>) + Send + Sync)`, which receives new lines batched at most every 100 ms.
  - Caps: stderr and Aji lines share a ring of 1,000; sent and received lines a ring of 5,000, each cut at 64 KB with `…` appended. `Sent` and `Received` pushes are dropped while `!is_open()`.
  - `Engine::console(&self) -> ConsoleLog`.
  - `pub enum ConsoleRefusal { NotJson, Search, TerminateAll, TerminateOther }`.
  - `async Engine::console_send(&self, query: &str) -> Result<String /* the id used */, ConsoleSendError>` where `ConsoleSendError` is `Refused(ConsoleRefusal)` or `NotRunning`. Parses the JSON object; no `action` → `Search`; `terminate_all` → `TerminateAll`; `terminate` whose `terminateId` does not start with `console-` → `TerminateOther`. Sets `id` to `console-<n>` when missing. Pushes an `Aji` line saying why when refused.
- The stderr reader pushes every line to the log as well as to the tail. The actor pushes `Sent` for every line it writes (`Actor::send`) and `Received` for every stdout line (raw text, in the `read_lines` callback in `attach`). The actor pushes `Aji` lines when a process starts (the KataGo path), exits (the exit code or signal) and when files change.
- Replies to `console-` ids need no routing: the actor already ignores ids it did not send (pings, versions, errors and analysis all check their id).
- **M2 N1:** in `process::supervise`, after `start_kill`, wait at most `KILL_WAIT = 5 s`. Past it, report the exit as unknown (`code: None, signal: None`) with the tail plus `aji: KataGo did not exit after being killed`, and let the actor move on. The supervisor keeps the child handle so it is reaped if it ever exits.

- [ ] **Step 1: Write the failing tests:**
  - `console.rs`: `rings_keep_their_caps` (1,001 stderr pushes keep the last 1,000; a 70 KB line is cut to 64 KB plus `…`); `protocol_lines_are_kept_only_while_open`; `open_counts_and_never_goes_below_zero`; `subscribers_get_batches` (with Tokio's paused clock, three pushes within 100 ms arrive as one batch).
  - Engine tests with the fake KataGo: `console_sees_stderr_sent_and_received`; `console_send_fills_the_id_and_refuses` (`{"action":"query_version"}` → `console-1` and a `Received` line with that id; `{"action":"terminate_all"}`, `{"action":"terminate","terminateId":"aji-3"}`, `{"moves":[]}` and `not json` each refused with the matching `ConsoleRefusal`); `console_replies_leave_the_analysis_alone` (the board's analysis keeps updating after a console query).
  - `process.rs`: `a_child_that_ignores_kill_is_given_up` (a test seam that makes `wait` never finish after the kill) → `supervise` returns within `KILL_WAIT` plus slack, with the note in the tail.
- [ ] **Step 2: Run** `cargo test -q -p aji-engine console supervise`. Expected: FAIL.
- [ ] **Step 3: Implement** `console.rs` and the hooks above.
- [ ] **Step 4: Run** `cargo test -q -p aji-engine` and clippy. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): keep a console log, send console queries, and stop waiting on a kill`.

### Task 4: Protocol and service

**Files:**
- Modify: `src-tauri/src/protocol.rs`, `src-tauri/src/service.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/platform/` (the `FilePicker` implementation), `src-tauri/src/follow.rs` (console events)
- Generated: `src/transport/generated/*.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces requests (camelCase `type`):
  - `engineProfiles` → `Response::EngineProfiles { profiles: Vec<ProfileSummary>, dev_override: bool }`. With `devEngine` set, `profiles` still lists the record's and `devOverride` is `true`.
  - `engineProfileSwitch { id }` → `Ok`. Refused `engineDevOverride` while `devEngine` is set. Stops a running whole-game job first (`ctx.engine.stop_job()`), switches, then pushes `GameTrend { reason: Reset }` read under the new identity (`follow::trend_of`).
  - `engineProfileRename { id, name }`, `engineProfileRemove { id }` → `Ok`.
  - `engineProfileAddOwn { katago, model, config, name? }` → `EngineProfiles`. Refused `engineOwnFile` with `detail` `"<file>:<problem>"` (for example `"model:missing"`). Paths are strings from the client, used as paths on this machine.
  - `setupPickFile { purpose }` with `purpose` one of `katago`, `model`, `config` → `Response::SetupPickFile { path: Option<String> }`. `FilePicker` gains `fn pick_file(&self, purpose: PickPurpose) -> Option<PathBuf>`; the dialog filters `.gz` for `model` and `.cfg` for `config`.
  - `engineConsoleOpen { open }` → `Ok`; `engineConsoleLines { after }` → `Response::EngineConsoleLines { lines }`; `engineConsoleSend { query }` → `Response::EngineConsoleSent { id }`, refused `engineConsoleRefused` with `detail` the `ConsoleRefusal` in camelCase.
  - Event `engineConsoleLines { lines }`, from `ConsoleLog::subscribe` through the `EventSink`.
- New `ErrorCode`s: `engineProfileCurrent`, `engineNoSuchProfile`, `engineDevOverride`, `engineOwnFile`, `engineConsoleRefused`. `ProfileError::Busy` maps to the existing `setupBusy`.
- `startup_files` uses `current_key()` and `profile_files` when no `devEngine` is set. `running_engine` names the current profile's network (an own profile: the model's file name).
- `engineStatus`'s `running` gains `profile: Option<String>` (the current profile's name).

- [ ] **Step 1: Write the failing service tests:**
  - `switching_profiles_stops_the_job_and_resets_the_trend` (a running job is stopped, and a `gameTrend` event with `reset` follows).
  - `the_dev_engine_locks_the_profiles` (`devOverride: true`, a switch refused with `engineDevOverride`).
  - `an_own_profile_refusal_names_the_file` (`detail == "model:missing"`).
  - `startup_runs_the_current_profile` (an own profile current → its files).
  - `console_queries_and_refusals_cross_the_protocol`.
- [ ] **Step 2: Run** `cargo test -q -p aji --lib profile console`. Expected: FAIL.
- [ ] **Step 3: Implement** the requests, responses, event, codes, `FilePicker::pick_file` (the platform implementation follows `pick_network`), and the startup change.
- [ ] **Step 4: Run** `cargo test --workspace -q`, clippy and `cargo fmt --all`. Expected: PASS, bindings regenerated.
- [ ] **Step 5: Commit** `feat: engine profiles and the console over the protocol`.

### Task 5: Interface transport, stores and the browser fake

**Files:**
- Modify: `src/transport/api.ts`, `src/transport/transport.ts` (`KNOWN_CODES`), `src/i18n/codes.test.ts`, `src/locales/{zh-CN,en}.json` (`errors.*` for the new codes), `src/dev/fakeGame.ts`
- Create: `src/engine/profileStore.ts`, `src/engine/consoleStore.ts`
- Test: `src/engine/profileStore.test.ts`, `src/engine/consoleStore.test.ts`, `src/dev/fakeGame.test.ts`

**Interfaces:**
- Consumes: Task 4's bindings.
- Produces:
  - `api.ts`: `getProfiles(t) → { profiles, devOverride }`, `switchProfile(t, id)`, `renameProfile(t, id, name)`, `removeProfile(t, id)`, `addOwnProfile(t, { katago, model, config, name? })`, `pickFile(t, purpose) → string | null`, `openConsole(t, open)`, `getConsoleLines(t, after) → ConsoleLine[]`, `sendConsole(t, query) → string`.
  - `useProfileStore`: `{ profiles: ProfileSummary[]; devOverride: boolean; load(transport): Promise<void> }`, reloaded on start, after each profile request and after an install job ends.
  - `useConsoleStore`: `{ lines: ConsoleLine[] /* at most 6,000 kept */; filter: 'all' | 'log' | 'protocol'; paused: boolean; history: string[]; append(lines); clear(); setFilter; setPaused; remember(query) }`. `clear` hides lines up to the newest `seq` (the backend keeps them). An `engineConsoleLines` event appends.
  - `switchProfileAsking(ctx, id)`: if `jobActive(useJobStore.getState().progress)`, opens the 6.2 question in a small store and switches on confirm; otherwise switches at once. After a switch it calls `resetEstimateStore()` so no estimate from the old network stays (design 6.2); the trend is replaced by the backend's reset push. Exported for the chip, the settings list and the commands.
  - Commands `engine.profile.next` and `engine.profile.previous` in `src/commands/builtins.ts`, unbound, wrapping around the list, through `switchProfileAsking`.
  - The browser fake: two managed profiles and no own profile in `?scenario=analysing`; switch, rename, remove, add own (refuses a model path containing `missing` with `model:missing`), pick file (returns a fixed path), console lines (a few stderr lines at start, sent and received lines for each analysis query while open), console send with the same refusals as Task 3.

- [ ] **Step 1: Write the failing tests:** the stores' behaviour above; `switchProfileAsking` asks only while a job runs; the fake's refusals and console send.
- [ ] **Step 2: Run** `pnpm -s vitest run src/engine src/dev`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm -s test`, `pnpm -s lint`, `pnpm -s typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: profile and console stores, and the browser fake`.

### Task 6: The profile chip and menu

**Files:**
- Create: `src/engine/ProfileChip.tsx`, `src/engine/SwitchConfirm.tsx`
- Modify: `src/panel/PanelHeader.tsx` (the chip before `<EngineIndicator>`, not in `compact`), locales
- Test: `src/engine/ProfileChip.test.tsx`

**Interfaces:**
- Consumes: Task 5.
- The chip shows the current profile's name, middle-cut to 16 characters with `middleTruncate` from `EngineCard.tsx`; with `devOverride`, 开发引擎. Its dropdown (radix `DropdownMenu`), per 6.2 and the mockup section 1:
  - title 引擎配置;
  - one radio item per profile, the second line the network (own: 自己的文件 and the network's file name) and, when measured, 约 {{speed}} 次/秒;
  - separator; 添加引擎… (opens Task 8's dialog); 引擎控制台 (Task 9's `openConsole()`); 管理引擎… (opens Settings at the engine section).
  - With `devOverride`: one checked, disabled entry 开发引擎 (settings.json); the profiles disabled.
- `SwitchConfirm` renders the 6.2 dialog: title 切换到 {{name}}, the body from Global Constraints, buttons 取消 and 切换.

- [ ] **Step 1: Write the failing tests:** the chip names the current profile; choosing another sends `engineProfileSwitch`; with a running job the dialog shows `已完成 64 / 213` and only 切换 sends; `devOverride` disables the list; the chip is absent in the compact header.
- [ ] **Step 2: Run** `pnpm -s vitest run src/engine/ProfileChip.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, strings in both locales.
- [ ] **Step 4: Run** the frontend checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: switch engine profiles from the header`.

### Task 7: The profile list in Settings, and Restart and Stop while starting

**Files:**
- Create: `src/settings/ProfileList.tsx`
- Modify: `src/settings/SettingsPanel.tsx` (engine section), locales
- Test: `src/settings/ProfileList.test.tsx`, `src/settings/SettingsPanel.test.tsx`

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Per design 6.4 and mockup section 3:
  - one row per profile, a radio that switches through `switchProfileAsking`; the name (own: tag 自己的文件); the second line: build and backend, network, threads and speed or 未测速 (own: the KataGo path and 线程由配置文件决定);
  - a ⋯ menu with 重命名 (an inline field; Enter saves, Esc cancels) and 移除 (disabled on the current row, title 当前配置不能移除，请先切换);
  - under the list, 添加引擎… and 引擎控制台;
  - the existing benchmark row measures the current profile and is hidden for an own profile; the unused row and its confirmation stay as they are.
- On the phone (the settings sheet at narrow width) the same list, with 44 px rows.
- **M5 minor 7:** Restart and Stop are enabled while the engine is `starting` (Stop also for a hang at start); they stay disabled while a benchmark measures. The stale comment saying restart is refused while starting goes.

- [ ] **Step 1: Write the failing tests:** rows and second lines for a managed, an unmeasured and an own profile; the radio switches; rename sends `engineProfileRename` on Enter; 移除 is disabled on the current row and sends `engineProfileRemove` on another; Restart and Stop are enabled in `starting`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: manage engine profiles in Settings`.

### Task 8: Adding an engine, and the declined-licence offer

**Files:**
- Create: `src/engine/AddEngineDialog.tsx`
- Modify: `src/setup/StepLicence.tsx` (minor 10), `src/setup/StepNetwork.tsx` only if its list must be reused as a component, locales
- Test: `src/engine/AddEngineDialog.test.tsx`, `src/setup/StepLicence.test.tsx`

**Interfaces:**
- Consumes: Tasks 5 to 7; the existing `getNetworks`, `importNetwork`, `startInstall` and the install progress.
- Per design 6.3 and mockup section 2, a dialog with three segments:
  - **下载权重:** the manifest networks for the build (the current managed profile's engine, or the newest installed engine when an own profile is current), installed ones marked 已有 and not selectable; a line 使用 KataGo {{version}}（{{backend}}）; 下载并使用 runs `startInstall(engine, network, [], { benchmark: false })` and shows the existing install progress until it ends, then reloads the profiles.
  - **导入权重文件:** the existing import, then the same install with the imported network.
  - **使用自己的 KataGo:** fields KataGo 程序, 权重, 配置文件, each with 浏览… (`pickFile`), and 名字 (optional). 检查并添加 sends `engineProfileAddOwn`; an `engineOwnFile` refusal marks that field and shows 找不到这个文件。 (`missing`), 这不是 KataGo 程序。 (`notKatago`), or 读不了这个文件。 (`unreadable`). On success the dialog closes.
  - With no installed engine at all, the first two segments open the wizard instead.
- **M5 minor 10:** `nextBackend` uses the server's order, `[default, ...fallbacks]` from the recommendation, and `nextOffer` skips a backend whose newest engine needs a licence (by `textSha256`) the owner has just declined.

- [ ] **Step 1: Write the failing tests:** each segment's request; installed networks not selectable; the field error for each problem; the wizard opens with no engine; the declined offer skips a backend needing the same licence and follows default-then-fallbacks order.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add an engine from a download, a file or one's own KataGo`.

### Task 9: The console panel

**Files:**
- Create: `src/engine/ConsolePanel.tsx`, `src/engine/openConsole.ts`
- Modify: `src/layout/model.ts` (`PanelKind` gains `'console'`, appended last to `PANEL_KINDS`), `src/layout/registry.tsx`, `src/layout/constants.ts` (its minimum size), `src/layout/NarrowFrame.tsx` (the sheet), locales
- Test: `src/engine/ConsolePanel.test.tsx`, and the layout tests that enumerate panel kinds

**Interfaces:**
- Consumes: Task 5's `useConsoleStore` and API.
- `openConsole()`: on a wide layout, adds the `console` panel at the bottom of the right column if absent, else reveals it; on the narrow frame, opens the sheet. In no preset by default; an older saved layout without it still loads (review focus of M1).
- The panel (mockup section 4): the title 引擎控制台; filter chips 全部, 日志, 协议; 暂停滚动, 复制 (all shown lines as text), 清空; lines with `HH:mm:ss`, a kind label (日志, Aji, 发送, 接收) and the text, `Received` and `Sent` cut at 400 characters with 展开; the input at the bottom (Enter sends, Up and Down recall); a refusal shows as an Aji line (the store appends what the backend pushes).
- Mount sends `engineConsoleOpen { open: true }` and reads `engineConsoleLines { after: 0 }`; unmount sends `open: false`.
- The narrow sheet rises to 78% of the height with a grip, and closes by the grip or a tap outside.

- [ ] **Step 1: Write the failing tests:** open and close requests on mount and unmount; filters; a 500-character reply shows 400 and 展开 reveals it; Enter sends and Up recalls; 清空 hides earlier lines; `openConsole()` adds the panel once.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the engine console panel`.

### Task 10: Exit check, documents and the Status

**Files:**
- Modify: `docs/superpowers/specs/2026-11-25-p2-m4-engines-design.md` (a **Built** section), `docs/backlog/phase-1-deferred.md` (strike M2 N1, M5 minors 7, 10 and 11 as fixed in Phase 2 M4), this plan's Status

- [ ] **Step 1: Run** every check: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s test`, the licence and notices checks. Expected: all pass.
- [ ] **Step 2: Browser** (`pnpm dev`, `?scenario=analysing`) at 1440 × 900 and 375 × 812, both themes: the chip menu, a switch with and without a running job, the add dialog's three segments and their errors, the settings list, rename and remove, the console with filters, 展开, a sent query and a refusal. Screenshot each.
- [ ] **Step 3: Native Mac** (`pnpm tauri dev`), design section 11: download a second network and switch both ways with results coming back from the cache; an own-files profile on the Homebrew KataGo, then one broken path; remove a profile and delete its unused network; the console with `{"action":"query_version"}`, `terminate_all` and a search refused.
- [ ] **Step 4: Fresh whole-branch review**, fixes folded into the commits they correct.
- [ ] **Step 5: Record** the results in the design's **Built** section and this plan's Status, then commit `docs: record M4 engine profiles and the console`.
