# M5 First-Run Wizard and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new user goes from a fresh install to a running engine through the five-step wizard in the panel, with every failure explained, a way out at every step, minimal settings, an About page, the wooden board surface and the bundled fonts.

**Architecture:**
- **Engine side, Rust.**
  - `aji-manager` gains driver advice and CPU fallbacks in the recommendation, refreshable detection, and new job states and codes. It also gets the M4 robustness fixes and the "unused files" report and removal.
  - `aji-engine` gets a visit limit that can change while KataGo runs.
  - `src-tauri` gets settings requests, per-field lenient `settings.json`, `engineBusy`, and the removal of `AJI_DEV_INSTALL`.
- **Interface, TypeScript.**
  - New feature folders: `src/setup/` (wizard), `src/settings/` (settings store and page, About), `src/board/` (canvas surface), `src/platform/` (external links) and `src/dev/` (scenarios).
  - `App.tsx` picks the panel: wizard, analysis, or settings.
  - The wizard's step state lives in a Zustand store (design 4.1). The install job stays in the backend.

**Tech Stack:**
- Existing: Tauri 2, React 19, Zustand 5, i18next, Tailwind 4, Vitest.
- New, TypeScript: shadcn/ui (Radix primitives, MIT) and `@tauri-apps/plugin-opener`.
- New, Rust: `tauri-plugin-opener` 2.
- Fonts: Inter and LXGW WenKai, both OFL. Subsetting uses fontTools (MIT) in a script, not at runtime.

**Spec:** [M5 wizard and settings design](../specs/2026-11-20-m5-wizard-settings-design.md), approved by the owner on 2026-11-20. Section numbers below (5.2 and so on) refer to it. Mockups: `docs/design/mockups/m5/` and `docs/design/mockups/setup-*.jpg`.

**Status:** Done on 2026-11-20, except the items under Outstanding.
- **Checks.** At `fbc43a4` every check passes on the Mac: `cargo fmt --check`, clippy with `-D warnings`, 491 Rust tests, `pnpm lint`, `pnpm typecheck`, 237 TypeScript tests, `cargo deny check licenses`, the notices staleness check and unchanged generated bindings.
- **Final review.** A fresh review of the whole branch found nothing critical and two important issues, each fixed with a test that failed first and folded into the commit it corrects:
  - "delete unused files" read `installed.json` leniently, so a record that could not be read counted as "no active set" and the engine in use would have been deleted (`5948dec`);
  - the licence step showed one row per licence without the components it covers; it now names each component with its version and size (`489e920`).
  Sixteen minor findings are deferred to M6 or M7 planning.
- **Mac exit check** with the app from `pnpm tauri build --bundles app` (11.05 MiB):
  - Item 7: one position analysed for 30 minutes with no limit (`maxVisits` 2^50), on the installed `katago-v1.18.2-metal-macos-arm64` with `kata1-tf3-b11c768-s12382M-d6533M`. KataGo's RSS at 0, 5, 10, 15, 20, 25 and 30 minutes: 5.8 GB (Metal start-up), 1.9, 1.4, 1.4, 1.4, 0.5 and 0.2 GB. The drop after 20 minutes is macOS compressing pages, not freed memory: at 30 minutes `footprint` gave 826 MB, 405 MB of it compressed. Memory did not grow over the run, so no visit limit by default (G3) stands on the Mac. A first run was ended at about 4 minutes when the owner quit Aji.
  - M4 minor #14: KataGo 1.18.2 picks the model format by the file's suffix. The installed binary network loads as `.bin.gz` and as `.gz`, and fails as `.txt.gz` ("perhaps you are trying to load a .bin.gz model as a .txt.gz model?"). Imports stored every network as `.bin.gz`, so a text network would have failed; `fbc43a4` keeps `.txt.gz`. Homebrew ships only `.bin.gz` networks, so no real text network was installed through step 4.
  - Item 9: every scenario of section 7 was walked in `pnpm dev` in the browser pane, against the mockups; the layout faults found there were fixed in `a5907c3`.
  - `settings.json` was restored from its backup after item 7.
- **Outstanding.**
  - Items 3 to 6 in the native window: the wizard on empty data folders (`AJI_DATA_ROOT`), "暂不设置" at step 2 and the next launch, quitting during the network download and resuming, and the settings round trip (language and theme live, the visit limit stopping and resuming analysis, restart, stop, set up again, deleting unused files). They need clicks in the window, which the author's session could not make.
  - Item 2 (a new macOS user) and item 8 (an external screen of a different scale), the owner's steps.
  - The PC, at the owner's call: the NVIDIA panels on real hardware, and whether the `gpuDriverTooOld` pattern matches KataGo's real output (5.3, [To verify]).
  - The owner's reading of the LXGW WenKai Reserved Font Name for the bundled WOFF2 subset.
  - About's notices print "(no licence file; MIT)" for about 40 crates that package no licence file (the `objc2` family, `block2`, `ts-rs`, `webview2-com`, `dlopen2`, `jni`, `ndk` and others). MIT and BSD ask for the notice text, so this needs a fallback before the first release.

## Global Constraints

- **Everything from M1 to M4 still holds:** language, interface text in both locales, dependency licences, Conventional Commits, crate rules, and the protocol rules. Protocol rules: no file paths cross the boundary; errors are `{ code, message }`; `#[ts(type = "number")]` on every `u64`; camelCase JSON. See the earlier plans' Global Constraints.
- **No git worktrees**, for subagents too. Work in `/Users/zepher/personal/Aji` on `feat/m5-wizard-settings` (from `main` at `fbed541`; design at `b5a1b64`). Push only when the owner asks.
- **Every user-visible string goes through i18n**, in `zh-CN` and `en` in the same commit. The Chinese strings quoted in the design are the `zh-CN` values; write natural English for `en`.
- **No interface text is hard-coded**, including `aria-label`s. The ESLint i18n rule must stay clean.
- **Generated TypeScript types** (`src/transport/generated/`) are regenerated by `cargo test` and committed with the Rust change that made them.
- **Colours** come from the theme tokens in `src/styles/theme.css`. Red (`engine-error`) appears only on a failed row and the engine dot. No rounded floating cards (interface design 1.4).
- **Checks before every commit:**
  - `cargo fmt --check`;
  - `cargo clippy --workspace --all-targets -- -D warnings`;
  - `cargo test --workspace`;
  - `pnpm lint`, `pnpm typecheck` and `pnpm test`.
- **Values fixed by the design:**
  - The visit limit defaults to none, and stored `null` means none.
  - The disc lines default to `["winrate", "scoreLead"]`.
  - Language and theme default to `"system"`.
  - The source link is `https://github.com/reallxuan/Aji`.
  - The driver page is `https://www.nvidia.com/Download/index.aspx`, as one constant.
- **"No limit" sends `maxVisits` of 2^50** (`1 << 50`), instead of omitting the field (a refinement of design 5.9). An omitted field would fall back to whatever the generated config says, while an explicit value does not depend on the config.
- **The `gpuDriverTooOld` pattern** is NVIDIA's documented text for `cudaErrorInsufficientDriver`: `CUDA driver version is insufficient for CUDA runtime version`. KataGo prints it through `cudaGetErrorString` inside its `CUDA Error, for …` line. The pattern cites the CUDA Runtime API documentation and stays **[To verify]**. It must be checked before `GpuError`'s `CUDA Error, for ` pattern.

## Review Focus

1. **Language switch in the middle of the wizard.** It keeps the step and every choice made; only the text changes (Task 10 test).
2. **Double-clicking "开始安装" or Retry.** It sends one `setupInstall`. A `setupBusy` reply must not show an error panel (Task 11 test).
3. **Reloading the window during step 5.** It returns to step 5 showing the running job, or its outcome if the job ended meanwhile (Task 11 test).
4. **`settings.json` with a bad value in one field** (`"theme": "sepia"`, `"visitLimit": -5`, a future `downloadSource` kind). Only that field falls back to its default; the rest, and unknown fields, survive a write (Task 5 test).
5. **A canvas of zero size** (minimised window) or a device-pixel-ratio change during the wizard. Nothing throws, and the board redraws sharp (Task 9 test).

---

### Task 1: Recommendation: CPU fallbacks, driver advice, refreshable detection

**Files:**
- Modify: `crates/aji-manager/src/recommend/mod.rs`, `crates/aji-manager/src/recommend/gpu.rs`, `crates/aji-manager/src/setup.rs`
- Test: `crates/aji-manager/src/recommend/tests.rs` (or the existing table-test file), `crates/aji-manager/src/setup.rs` tests

**Interfaces:**
- Produces:
  - `pub struct DriverAdvice { pub current: Option<String>, pub required: String }` (serde camelCase, ts export), in `recommend`.
  - `BackendRecommendation.driver: Option<DriverAdvice>`.
  - `Setup::refresh(&self) -> HardwareReport`, which re-detects and replaces the stored report.
  - `Setup::with_detector(manifest: ManifestStore, detector: Arc<dyn Fn() -> HardwareReport + Send + Sync>) -> Setup`, for tests.
  - `pub fn required_driver(manifest: &Manifest, platform: Platform, gpu: &GpuReport) -> Option<String>`: the `minDriver` of the CUDA runtime that `cuda_variant` would choose if the driver were new enough.

- [ ] **Step 1: Write the failing tests**
  - `windows_gpu_rows_end_with_the_cpu_builds`: for NVIDIA (CUDA ok), NVIDIA (too old), AMD known, AMD unknown and Intel reports on Windows, the last backends are `Eigenavx2` then `Eigen` when the CPU has AVX2, else `Eigen` alone. They also appear at the end of `fallbacks`.
  - `linux_and_no_gpu_rows_are_unchanged`: compare with the current table output.
  - `macos_still_offers_only_metal`.
  - `old_driver_gives_advice_for_the_cc_variant`: driver `566.36`, compute capability `8.9`, gives `driver == Some(DriverAdvice { current: Some("566.36"), required: "580.00" })`. CC `6.1` gives `required: "572.61"`. Unknown CC gives the lowest, `"572.61"`.
  - `missing_driver_version_gives_advice_with_no_current`.
  - `usable_cuda_gives_no_advice`, and `no_cuda_engine_gives_no_advice`.
  - `refresh_runs_the_detector_again`: a detector closure that counts calls and returns a different driver the second time. `hardware()` twice calls it once; `refresh()` calls it again, and `backends()` then reflects the new driver.

- [ ] **Step 2: Run them and see them fail**

  Run: `cargo test -p aji-manager recommend setup`. Expected: compile errors for `DriverAdvice`, `driver` and `refresh`.

- [ ] **Step 3: Implement**
  - In `table()`, append `cpu()` to every non-Linux GPU row (the R20 decision). `max_fallbacks` stays `usize::MAX` there.
  - `recommend_backends` fills `driver` when `plan.notes` contains `DriverTooOldForCuda`, using `required_driver`.
  - `Setup` holds `hardware: tokio::sync::RwLock<Option<HardwareReport>>` and a detector: the system `detect()` or a test closure. `with_hardware` becomes a detector that always returns the given report.

- [ ] **Step 4: Run the tests and see them pass.** Also run `cargo test -p aji-manager` in full: the charter 6.3 table tests change where R20 adds rows. Update their expectations, not the rule.

- [ ] **Step 5: Commit:** `feat(manager): list the CPU build on GPU machines, advise on old NVIDIA drivers, and detect again on request`

### Task 2: Install job: reused rows, disk errors, the driver failure

**Files:**
- Modify: `crates/aji-manager/src/install/job.rs`, `crates/aji-manager/src/install/classify.rs`, `crates/aji-manager/tests/fixtures/katago-errors/SOURCE.md` (and the fake KataGo's scripted failure list, if it enumerates codes)
- Test: the existing job integration tests and `classify` unit tests

**Interfaces:**
- Consumes: `DriverAdvice`, `required_driver` (Task 1).
- Produces:
  - `TaskState::Reused`, serialised `{"state":"reused"}`.
  - `FailureCode::DiskError`.
  - `JobOutcome::Failed { failure, stderr_tail, offer, driver: Option<DriverAdvice> }`.
  - `LicenceInfo` gains `components: Vec<LicensedComponent>`, where `LicensedComponent { name: String, version: String, bytes: u64 }` (ts export, `bytes` as number).

- [ ] **Step 1: Write the failing tests**
  - `a_verified_component_shows_reused`: run a job, then a second job for the same engine and network. Its engine and network rows go `waiting → reused`, never `running`.
  - `insufficient_driver_text_is_gpu_driver_too_old`: a line `CUDA Error, for cudaMalloc file x.cu, line 1: CUDA driver version is insufficient for CUDA runtime version` classifies as `GpuDriverTooOld`, not `GpuError`.
  - `a_driver_failure_carries_the_advice`: the fake KataGo prints that line during the benchmark of a CUDA engine on an NVIDIA report with driver `575.0`. The outcome is `Failed { failure: GpuDriverTooOld, driver: Some({current: "575.0", required: <runtime minDriver>}), offer: Some(DirectML…) }`.
  - `other_failures_carry_no_driver`.
  - `a_write_failure_in_the_root_is_disk_error`: make `engines/` read-only (Unix; `#[cfg(unix)]`) and run a job. The outcome is `DiskError` with `offer: None`.
  - `licences_list_their_components`: the CUDA 13.2 engine's licences list each runtime component with its manifest version and archive size.

- [ ] **Step 2: Run them and see them fail**

- [ ] **Step 3: Implement**
  - `Reused` replaces `Done` wherever a step finds its component already verified.
  - A `std::io::Error` from writing, renaming or creating inside the install root maps to `DiskError` with no offer. Download, checksum and space failures keep their codes.
  - Add the pattern with its documentation citation (Global Constraints) ahead of `GpuError`.
  - `driver` comes from the engine's runtime `minDriver` and the GPU in `setup.hardware()`. It is `None` unless the code is `GpuDriverTooOld`.

- [ ] **Step 4: Run `cargo test -p aji-manager` and see it pass**

- [ ] **Step 5: Commit:** `feat(manager): reused task rows, a disk-error code, and driver advice on an old-driver failure`

### Task 3: Install job robustness, and unused files

M4 minors #1, #2, #3, #7, #11 (design section 6), plus the report and removal behind the settings row (design 5.4).

**Files:**
- Modify: `crates/aji-manager/src/install/job.rs`, `crates/aji-manager/src/install/record.rs`, `crates/aji-manager/src/install/import.rs`, `crates/aji-manager/src/install/layout.rs`
- Create: `crates/aji-manager/src/install/unused.rs`

**Interfaces:**
- Produces:
  - `pub struct ActiveSummary { pub engine: String, pub version: String, pub backend: Backend, pub network: String, pub network_name: String, pub threads: u32 }` (ts export).
  - `Installer::active_summary(&self) -> Option<ActiveSummary>`.
  - `Installer::unused_bytes(&self) -> u64`.
  - `Installer::remove_unused(&self) -> Result<u64, RemoveError>`, where `pub enum RemoveError { Busy, Io(String) }`. It returns the bytes freed.
  - `Installer::holds_engine(&self) -> bool`: true from the moment a job stops the engine for the benchmark until it restarts or switches it.
  - `StartError` gains no variants; platform and network-fit failures reuse `UnknownEngine` and `UnknownNetwork`.

- [ ] **Step 1: Write the failing tests**
  - `a_same_set_reinstall_keeps_the_active_config_until_its_test_passes` (#1): make the second job's test query fail. The active set's config file is byte-identical to before.
  - `a_panicking_job_restarts_the_previous_engine` (#3): use a test seam that panics inside `work()`. Afterwards the engine is back in its previous files and running, and the outcome is `Failed { failure: Crashed }`.
  - `importing_does_not_block_status` (#7): while an import copies a large file, run a blocking test file reader through a channel. `installer.status()` and `installed()` return without waiting for the copy.
  - `start_refuses_an_engine_for_another_platform` and `start_refuses_a_network_the_engine_cannot_load` (#11).
  - `unused_counts_everything_outside_the_active_set`: record two sets and one stray runtime, add a `staging/x/` folder and a `downloads/y.part`. `unused_bytes` sums all but the active set's engine, runtime and network.
  - `remove_unused_deletes_them_and_keeps_the_active_set`: the active engine still starts, and the record lists only the active set's components.
  - `remove_unused_with_no_active_set_removes_everything`.
  - `remove_unused_is_refused_while_a_job_runs`: gives `RemoveError::Busy`.
  - `holds_engine_is_true_only_during_the_benchmark_and_test`.

- [ ] **Step 2: Run them and see them fail**

- [ ] **Step 3: Implement**
  - #1: `activate()` writes the new config under a temporary name and renames it into place only after the test query passes.
  - #3: `run()` wraps `work()` in `catch_unwind` (`FutureExt::catch_unwind` with `AssertUnwindSafe`) and restores the engine.
  - #7: copy outside the record lock; take the lock only to record.
  - Removal runs in `spawn_blocking`.

- [ ] **Step 4: Run `cargo test -p aji-manager` and see it pass**

- [ ] **Step 5: Commit:** `fix(manager): keep the active config until a reinstall passes, recover from a panicking job, and remove unused files`

### Task 4: `aji-engine`: a visit limit that changes while running

**Files:**
- Modify: `crates/aji-engine/src/engine.rs`, `crates/aji-engine/src/query.rs`
- Test: `crates/aji-engine/tests/` (the existing fake-KataGo engine tests)

**Interfaces:**
- Produces:
  - `EngineOptions.visit_limit: Option<u32>` replaces `visit_cap: u32`, and the default is `None`.
  - `pub const UNLIMITED_VISITS: u64 = 1 << 50`.
  - `analysis_query(id, position, max_visits: Option<u32>, report_every)`, where `None` writes `UNLIMITED_VISITS`.
  - `Engine::set_visit_limit(&self, limit: Option<u32>) -> Result<(), EngineError>`. It succeeds in every state, including not configured, and is stored for later queries.

- [ ] **Step 1: Write the failing tests**
  - `unlimited_query_sends_two_to_the_fifty`: `maxVisits` is `1125899906842624`.
  - `lowering_the_limit_below_current_visits_terminates_the_query`: the fake transcript reports 400 visits, then `set_visit_limit(Some(100))`. A terminate line is sent, and the state goes to `Ready`.
  - `raising_the_limit_resubmits_a_capped_position`: cap 100, run to its final, raise to 1000. A new query for the same position is sent with `maxVisits` 1000.
  - `removing_the_limit_resubmits_a_capped_position`: the new query carries `UNLIMITED_VISITS`.
  - `a_limit_change_while_paused_does_not_submit`.
  - `the_limit_is_kept_across_restart_and_set_files`.

- [ ] **Step 2: Run them and see them fail**

- [ ] **Step 3: Implement.** Add `Command::SetVisitLimit(Option<u32>, Reply<Outcome>)`.
  - When it applies to the current position, compare the new limit with the active query's visits (lower: `terminate_current`), or call `analyse_or_idle` (raised, with no active query).
  - `wants_analysis` compares the cached visits with the current limit, and `None` never caps.

- [ ] **Step 4: Run `cargo test -p aji-engine` and see it pass.** Fix the callers that named `visit_cap` (`src-tauri`).

- [ ] **Step 5: Commit:** `feat(engine): a visit limit that can be lowered, raised or removed while KataGo runs`

### Task 5: Settings: interface preferences, read leniently

**Files:**
- Modify: `src-tauri/src/settings.rs`
- Test: `src-tauri/src/settings.rs` tests

**Interfaces:**
- Produces, all ts export and camelCase:
  - `pub enum LanguagePreference { System, ZhCn /* "zh-CN" */, En }`;
  - `pub enum ThemePreference { System, Dark, Light }`;
  - `pub enum DiscField { Winrate, ScoreLead, Visits }`;
  - `pub struct UiSettings { pub language, pub theme, pub disc_lines: [DiscField; 2], pub visit_limit: Option<u32> }`, with `Default` = system, system, `[Winrate, ScoreLead]`, `None`.
- `Settings` gains `ui: UiSettings`, stored flat in `settings.json` as `language`, `theme`, `discLines` and `visitLimit`.
- `pub fn save_ui_settings(path: &Path, ui: &UiSettings) -> Result<(), SettingsError>` writes those four keys through `update_settings`.
- `load_settings` reads each field on its own: a field that does not parse is logged and takes its default. A malformed file (not JSON, or not an object) is still an error, and a relative `devEngine` path is still an error.

- [ ] **Step 1: Write the failing tests**
  - `a_bad_field_falls_back_alone`: `{"theme":"sepia","language":"en","visitLimit":-5,"downloadSource":{"kind":"future"}}` gives theme system, language en, visit limit none and source direct.
  - `equal_disc_lines_fall_back_to_the_default`: `["visits","visits"]` gives the default.
  - `zero_visit_limit_reads_as_none`.
  - `saving_ui_settings_keeps_unknown_fields`.
  - `ui_settings_json_shape`: `{"language":"zh-CN","theme":"dark","discLines":["winrate","visits"],"visitLimit":5000}`.

- [ ] **Step 2: Run them and see them fail**

- [ ] **Step 3: Implement.** Parse into a `serde_json::Map`, then `from_value` per field.

- [ ] **Step 4: Run `cargo test -p aji` (the `src-tauri` crate) and see it pass**

- [ ] **Step 5: Commit:** `feat: language, theme, disc lines and visit limit in settings.json, read field by field`

### Task 6: Protocol and service: settings, installed summary, busy engine; remove the dev trigger

**Files:**
- Modify: `src-tauri/src/protocol.rs`, `src-tauri/src/service.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`, `src/transport/transport.ts` (`KNOWN_CODES`), `src/transport/api.ts`, both locale files (`errors.engineBusy`, `setup.failure.diskError`), `docs/development.md`
- Delete: `src-tauri/src/dev_install.rs`

**Interfaces:**
- Consumes: Tasks 1 to 5.
- Produces (protocol):
  - Requests:
    - `SetupDetect { #[serde(default)] refresh: bool }`, where `{"type":"setupDetect"}` still parses;
    - `SettingsGet`;
    - `SettingsSet { settings: UiSettings }`;
    - `SetupInstalled`;
    - `SetupRemoveUnused`.
  - Responses:
    - `Settings { settings: UiSettings }`;
    - `SetupInstalled { active: Option<ActiveSummary>, unused_bytes: u64 }`;
    - `SetupRemoved { freed_bytes: u64 }`.
  - Event: `SettingsChanged { settings: UiSettings }`.
  - `ErrorCode::EngineBusy`.
- Behaviour:
  - `settingsSet` saves, calls `engine.set_visit_limit`, emits `settingsChanged`, and returns `Settings`.
  - `engineRestart` and `analysisResume` return `EngineBusy` while `installer.holds_engine()`.
  - `setupRemoveUnused` maps `Busy` to `SetupBusy` and `Io` to `Internal`.
  - `setupDetect { refresh: true }` calls `setup.refresh()`.
- Startup:
  - The engine starts with `EngineOptions { visit_limit: settings.ui.visit_limit, .. }`.
  - **`AJI_DATA_ROOT`**: when set to an absolute path, the config folder becomes `<root>/config` and the data folder `<root>/data`. It is honoured in every build, logged when used, and documented in `docs/development.md` as the way to see first-run setup without touching your real data (design section 8, item 3).
  - Register `tauri_plugin_opener`, and allow `opener:allow-open-url` for `https://*` only.
- TS API helpers in `api.ts`:
  - `getSettings`, `setSettings`, `detectHardware(transport, refresh)`, `getBackends`, `getVersions`, `getNetworks`, `getLicences`, `startInstall`, `cancelInstall`, `getInstallStatus`, `importNetwork`, `getInstalled`, `removeUnused` and `stopEngine`;
  - each checks the response type as `getEngineStatus` does.

- [ ] **Step 1: Write the failing tests**
  - Rust JSON-shape tests for every new request, response, event and code.
  - `settings_set_saves_applies_and_emits`, using a recording `EventSink`.
  - `restart_is_refused_while_the_installer_holds_the_engine`.
  - `detect_with_refresh_redetects`.
  - `the_data_root_override_moves_both_folders`: a pure function `data_dirs(override: Option<&Path>, config: PathBuf, data: PathBuf) -> (PathBuf, PathBuf)`.
  - TS: `api.test.ts` covers each new helper's happy path and a wrong response type.

- [ ] **Step 2: Run them and see them fail**

- [ ] **Step 3: Implement.** Delete `dev_install.rs` and its wiring and logging in `lib.rs`. Rewrite the `AJI_DEV_INSTALL` part of `docs/development.md` around the wizard and `AJI_DATA_ROOT`, and keep the `devEngine` section.

- [ ] **Step 4: Run all checks (Global Constraints) and see them pass.** The generated TS types change: commit them.

- [ ] **Step 5: Commit:** `feat: settings and installed-engine requests, a busy-engine code, and a data-root override; remove the development install trigger`

### Task 7: Fonts

**Step 1 is the controller's**, done with the owner's go-ahead before this task is dispatched. It downloads the Inter release and the LXGW WenKai release (the mainland original, not the TC build) into the scratchpad. It also installs `fonttools` and `brotli` into a virtual environment in the scratchpad. It then gives the implementer the two source paths, the releases' versions and their SHA-256.

**Files:**
- Create:
  - `scripts/subset-fonts.py` (fontTools; takes the source paths, writes WOFF2);
  - `src/assets/fonts/` (`Inter-Regular.woff2`, `Inter-Medium.woff2`, `LXGWWenKai-Regular.woff2`, `LXGWWenKai-Medium.woff2`, `OFL-Inter.txt`, `OFL-LXGWWenKai.txt`, `SOURCE.md` with versions, URLs and hashes);
  - `src/styles/fonts.css`;
  - `src/assets/fonts/coverage.test.ts`.
- Modify: `src/styles/index.css`.

- [ ] **Step 1 (controller):** download and verify the sources, as above.
- [ ] **Step 2: Write the failing test** `coverage.test.ts`. It reads the WenKai Regular and Medium WOFF2 files and decodes each cmap, using fontTools output stored by the script as `src/assets/fonts/wenkai-codepoints.json`, since decoding WOFF2 in Node needs a dependency. It asserts that every character in `zh-CN.json` (keys excluded, values only, ASCII excluded) is covered. To prove the test bites, a sample character outside GB2312 that is not in the locale (`𠀀`) must not be in the list.
- [ ] **Step 3: Run it and see it fail**, because the files are missing.
- [ ] **Step 4: Implement.**
  - The script subsets WenKai to GB2312 plus the locale's characters plus ASCII and CJK punctuation, writes `wenkai-codepoints.json`, and subsets Inter to Latin-1 plus the punctuation the locales use.
  - `fonts.css` declares `@font-face` for both families at weights 400 and 500, with `font-display: block`.
  - The stack is `Inter, 'LXGW WenKai', system-ui, sans-serif`, with `font-feature-settings: 'tnum'` on `body`.
- [ ] **Step 5: Run `pnpm test` and see it pass.** Record each WOFF2's size in `SOURCE.md`. If the two WenKai files together exceed 8 MB, drop Medium (design risk), map weight 500 to Regular, and note it there.
- [ ] **Step 6: Commit:** `feat: bundle Inter and a GB2312 subset of LXGW WenKai, with a coverage test`

### Task 8: shadcn/ui, the settings store, live language and theme

**Files:**
- Create:
  - `components.json` and `src/components/ui/*` (radio-group, select, toggle-group, checkbox, button, collapsible, dialog);
  - `src/settings/settingsStore.ts` and `src/settings/useSettingsSync.ts`;
  - `src/platform/openExternal.ts`.
- Modify: `src/main.tsx`, `src/App.tsx`, `src/theme/useThemeSync.ts`, `src/i18n/createI18n.ts` (if needed), `package.json`, `src/styles/index.css`.

**Interfaces:**
- Produces:
  - `useSettingsStore` (Zustand) with `{ settings: UiSettings | null; apply(settings): void; save(transport, settings): Promise<void> }`. `save` is optimistic: it applies first, and reverts on error.
  - `useSettingsSync()`: on mount it calls `getSettings` and subscribes to `settingsChanged`. When `language` changes it calls `i18n.changeLanguage(resolveLanguage(pref, navigator.languages))` and sets `document.documentElement.lang`. It passes `theme` to `useThemeSync(preference)`.
  - `useThemeSync(preference: ThemePreference)`: the existing hook, parameterised.
  - `openExternal(url: string): Promise<void>`: `@tauri-apps/plugin-opener`'s `openUrl`. It refuses anything that is not `https:`.

- [ ] **Step 1: Write the failing tests**
  - `settingsStore.test.ts`: `save` applies at once and reverts after a rejected request.
  - `useSettingsSync.test.tsx`: a `settingsChanged` event with `language: 'en'` switches a rendered `t()` string from Chinese to English. With `theme: 'light'`, `data-theme` becomes `light` even though the system query says dark.
  - `openExternal.test.ts`: `http:` and `file:` are refused.
- [ ] **Step 2: Run them and see them fail**
- [ ] **Step 3: Implement.** Initialise shadcn with Tailwind 4 and the CSS-variable theme, then map its variables onto Aji's tokens:
  - `--background` is `--panel`;
  - `--foreground` is `--text`;
  - `--border` is `--hairline`;
  - `--muted-foreground` is `--text-muted`.

  Set `--radius` to 6px. No card component.
- [ ] **Step 4: Run the checks and see them pass.** `pnpm licenses list` must show only allowed licences (`deny.toml`'s npm counterpart, as in M1).
- [ ] **Step 5: Commit:** `feat: shadcn/ui, a settings store, and live language and theme switching`

### Task 9: The board surface

**Files:**
- Create:
  - `src/board/geometry.ts`: the pure layout of grid, star points and coordinate labels;
  - `src/board/wood.ts`: the procedural texture into an `OffscreenCanvas` or `HTMLCanvasElement`, with a seeded PRNG;
  - `src/board/drawBoard.ts`;
  - `src/board/BoardCanvas.tsx`;
  - `src/board/useDevicePixelRatio.ts`.
- Modify: `src/layout/MainFrame.tsx`, which replaces its placeholder with `<BoardCanvas size={19} />`.

**Interfaces:**
- Produces:
  - `boardGeometry(cssSize: number, boardSize: number): { margin: number; spacing: number; lines: number[]; stars: Array<[number, number]>; columns: Array<{ label: string; x: number }>; rows: Array<{ label: string; y: number }> }`;
  - `drawBoard(ctx: CanvasRenderingContext2D, view: { cssSize: number; dpr: number; boardSize: number; theme: Theme }): void`;
  - `<BoardCanvas boardSize={19} />`, which fills its parent square.

- [ ] **Step 1: Write the failing tests**
  - `geometry.test.ts`:
    - 19×19 has columns `A…T` without `I`, and rows `19…1` from the top;
    - star points `D4 D10 D16 K4 K10 K16 Q4 Q10 Q16`;
    - 13×13 has 5 stars, and 9×9 has 5;
    - every line is inside the board;
    - the spacing at 868 px matches the mockup within 1 px (the mockup's grid runs from x 56 to 844 for a 868 board drawn at 16 px offset).
  - `useDevicePixelRatio.test.ts`: a fake `matchMedia` change re-renders with the new ratio.
  - `BoardCanvas.test.tsx`:
    - with jsdom's canvas mocked, the backing store is `cssSize × dpr`;
    - `cssSize` 0 draws nothing and does not throw (Review Focus 5).
- [ ] **Step 2: Run them and see them fail**
- [ ] **Step 3: Implement.**
  - The wood uses the `#DDB067` base, a straight grain made from summed 1-D value noise along y with slight per-line variation, a lighter top-edge band and a darker 6 px lower edge. The seed is fixed. It is cached per `(cssSize, dpr)`.
  - Lines and stars are dark brown (`#3A2A14`), and labels use Inter at 12 px CSS.
  - Add `vitest-canvas-mock` (MIT) as a dev dependency if jsdom needs it.
- [ ] **Step 4: Run the checks and see them pass, then look at it.** Run `pnpm dev` and compare against `docs/design/mockups/setup-5-install.jpg`.
- [ ] **Step 5: Commit:** `feat: the board surface: procedural wood, grid, star points and coordinates, sharp on any display`

### Task 10: Wizard store, panel switch, and steps 1 to 4

**Files:**
- Create:
  - `src/setup/wizardStore.ts`;
  - `src/setup/SetupPanel.tsx`, the frame: progress line, title row with language switch, body and footer;
  - `src/setup/StepDetect.tsx`, `src/setup/StepBackend.tsx`, `src/setup/StepVersion.tsx`, `src/setup/StepNetwork.tsx`;
  - `src/setup/format.ts`, for bytes and dates by locale.
- Create: `src/app/panelMode.ts`.
- Modify: `src/App.tsx`, both locale files (`setup.*`).

**Interfaces:**
- Produces:
  - `type WizardStep = 'detect' | 'backend' | 'version' | 'network' | 'licence' | 'install'`.
  - `useWizardStore` with:
    - state: `{ open: boolean; rerun: boolean; step; hardware; recommendation; backend; versions; engine; networks; network; job: JobSnapshot | null; starting: boolean }`;
    - actions: `openWizard(rerun: boolean)`, `close()`, `goTo(step)`, `chooseBackend(b)`, `chooseEngine(id)`, `chooseNetwork(id)`, `applyProgress(job)`.
  - `panelMode(engine: EngineState | null, wizardOpen: boolean, settingsOpen: boolean, job: JobSnapshot | null): 'wizard' | 'analysis' | 'settings'`. These are the design 5.1 rules: `notConfigured` with the wizard not dismissed this run gives the wizard; a job with no outcome gives the wizard.
- Copy (zh-CN values from the design and the mockups):
  - the title "准备 AI 引擎";
  - step titles "检测硬件", "选择后端", "选择 KataGo 版本", "选择权重" and "正在安装";
  - the tags: `fastest` 最快, `noRuntimeDownload` 免运行库, `mostCompatible` + `slowest` 兼容性最好，最慢, `cpuOnly` 仅用处理器, `latest` 最新, needs-driver 需要更新驱动;
  - "下载驱动 ↗", "重新检测", "导入权重文件", "开始安装", "下一步", "暂不设置", "取消" and "未检测到".

- [ ] **Step 1: Write the failing tests** (fake transport, Testing Library)
  - `panelMode.test.ts`: every row of design 5.1.
  - `StepDetect`: it shows four rows with spinners, then ticks, then moves to `backend` by itself. A `problems` entry shows that row as "未检测到".
  - `StepBackend`:
    - lists the recommendation in order with tags, with the default preselected;
    - with `driver` set, shows a disabled CUDA row tagged 需要更新驱动, a line naming `566.36` and `580.00`, a link that calls `openExternal` with the driver page, and "重新检测", which sends `setupDetect { refresh: true }` and re-renders from the new recommendation.
  - `StepVersion`: newest first, preselected and tagged 最新.
  - `StepNetwork`:
    - Elo order with the top row preselected;
    - an import adds the imported network at the top, selected;
    - a cancelled dialog changes nothing;
    - `setupImportFailed` shows its error text inline.
  - **Review Focus 1:** at step `version` with a non-default backend chosen, clicking `EN` in the title row switches the text. The step and the chosen backend are unchanged, and a `settingsSet` was sent.
  - "暂不设置" closes the wizard into the no-engine analysis panel. With `rerun`, it reads "取消" and returns to analysis.
- [ ] **Step 2: Run them and see them fail**
- [ ] **Step 3: Implement.** Layout per the mockups `setup-1` to `setup-4`: a radio list with hairline rows, no cards. The footer sits at the bottom, with the text link left and the button right.
- [ ] **Step 4: Run the checks and see them pass**
- [ ] **Step 5: Commit:** `feat: the setup wizard: panel switch, detection, backend, version and network steps`

### Task 11: Licence step, install step, failure panels

**Files:**
- Create: `src/setup/StepLicence.tsx`, `src/setup/StepInstall.tsx`, `src/setup/FailurePanel.tsx`, `src/setup/failureActions.ts`, `src/setup/useSetupProgress.ts`.
- Modify: both locale files, `src/setup/wizardStore.ts`.

**Interfaces:**
- Consumes: `getLicences`, `startInstall`, `cancelInstall`, `getInstallStatus` (Task 6) and the store (Task 10).
- Produces:
  - `failureActions(outcome: Extract<JobOutcome, { outcome: 'failed' }>): { primary: 'retry' | 'fallback'; secondary: 'retry' | 'fallback' | 'back' | null }`. Its rules:
    - `gpuDriverTooOld` gives retry, fallback (or back when there is no offer);
    - any other code with an offer gives fallback, retry;
    - `licenceNotAccepted` gives fallback, null;
    - no offer gives retry, back.
  - `useSetupProgress()` subscribes to `setupProgress` and calls `applyProgress`. On mount it calls `setupStatus` and resumes step 5 if a job is running, or has an outcome the user has not seen yet.

- [ ] **Step 1: Write the failing tests**
  - `failureActions.test.ts`: every row of the design 5.3 table.
  - `StepLicence`:
    - one row per licence with its components' total size and a "查看 ↗" link;
    - "接受并安装" is disabled until the box is ticked;
    - accepting sends `setupInstall` with those hashes;
    - "不接受" sends nothing to the network and shows panel A2 for `licenceNotAccepted`, with the next backend from the recommendation.
  - `StepInstall`:
    - the rows follow the snapshot: waiting, running with percent and bar, done, reused (shows "已有" (already there)), failed (red);
    - Cancel sends `setupCancel`, and a `cancelled` outcome shows "已取消" with Retry, Back and "暂不设置";
    - while the job runs, the footer has only Cancel.
  - `FailurePanel`:
    - A1 names `driver.current` and `driver.required`, links to the driver page, and has Retry as the primary button;
    - Retry sends `setupDetect { refresh: true }` and then `setupInstall` with the same engine and network;
    - A2 offers "改用 {{backend}}（{{size}}）" as the primary button, and accepting sends `setupInstall` for `offer.engine` with the same network;
    - B has Retry and Back;
    - the stderr fold-out shows `stderrTail` lines.
  - **Review Focus 2:** two fast clicks on "开始安装" send one `setupInstall`. A `setupBusy` rejection leaves step 5 showing the running job.
  - **Review Focus 3:** mounting with `setupStatus` returning a running job opens step 5. When it returns a failed outcome, the failure panel opens.
  - An `installed` outcome closes the wizard, and the panel mode becomes analysis.
- [ ] **Step 2: Run them and see them fail**
- [ ] **Step 3: Implement.** Layout per mockups C, `setup-5-install.jpg`, A1, A2 and B.
  - The acceptance label is "我已年满法定年龄，并接受以上 NVIDIA 许可条款", in `en` "I am of legal age and accept the NVIDIA licence terms above".
  - Backend display names are a fixed map (CUDA, DirectML, OpenCL, Metal, ROCm, OpenVINO, Eigen AVX2, Eigen). Product names are the same in both locales but still go through i18n keys.
- [ ] **Step 4: Run the checks and see them pass**
- [ ] **Step 5: Commit:** `feat: licence acceptance, install progress and failure panels with retry and fallback`

### Task 12: Settings page, About, no-engine and crashed states

**Files:**
- Create:
  - `src/settings/SettingsPanel.tsx`, `src/settings/DiscPreview.tsx`, `src/settings/AboutPanel.tsx`, `src/settings/NoticeView.tsx`;
  - `src/panel/NoEngine.tsx`, `src/panel/PanelHeader.tsx` (title placeholder "未命名棋局", inert navigation placeholders, engine dot, gear);
  - `scripts/third-party-notices.mjs`;
  - `src/assets/notices/` (`katago.txt`, `networks.txt`, `third-party.txt`).
- Modify: `src/panel/EngineStatus.tsx` (crashed state gains "重新设置引擎"; a ready state at the limit says "已达到每步上限"), `src/panel/EngineIndicator.tsx` (a grey dot for not configured; clicking it opens the wizard; disabled while busy), `src/App.tsx`, the locale files, `.github/workflows/ci.yml` (a notices staleness check).

**Interfaces:**
- Consumes: settings store (Task 8), `getInstalled`, `removeUnused`, `stopEngine`, `restartEngine` (Task 6), `openWizard(true)` (Task 10).
- Produces: `node scripts/third-party-notices.mjs [--check]`.
  - It walks the normal (non-dev, non-build) dependency graph of package `aji` from `cargo metadata --format-version 1`, and the production dependencies from `pnpm licenses list --prod --json`.
  - For each package it writes name, version, licence expression and the text of its licence files (`LICENSE*`, `COPYING*`, `NOTICE*` in the package folder).
  - The output goes to `src/assets/notices/third-party.txt`. `--check` exits non-zero when the file is stale.

- [ ] **Step 1 (controller, before dispatch):** copy KataGo's `LICENSE` from the installed Metal engine folder (`~/Library/Application Support/io.github.reallxuan.aji/engines/katago-v1.18.2-metal-macos-arm64/LICENSE`, no download) into `katago.txt`. Fetch the network licence text from katagotraining.org with the owner's go-ahead into `networks.txt`, with its URL and date at the top.
- [ ] **Step 2: Write the failing tests**
  - `SettingsPanel`:
    - the language and theme toggles send `settingsSet` and apply at once;
    - choosing the other line's field in a disc-line select swaps the two lines;
    - the preview disc shows the formatted sample values for the chosen fields;
    - the visit limit input is empty for `null`, accepts only positive integers, and sends `null` when cleared;
    - the engine section shows the active summary;
    - restart, stop and "set up again" call their actions;
    - with `engineBusy` (the engine `starting`, or the request rejected with `engineBusy`), restart is disabled or shows the error text.
  - Unused files:
    - the row shows the formatted size and is hidden at 0;
    - delete opens a confirmation dialog;
    - confirming sends `setupRemoveUnused` and refreshes the size.
  - `AboutPanel`:
    - shows the version line, the AGPL sentence and the source link, which calls `openExternal`;
    - each third-party row opens `NoticeView` with the bundled text.
  - `NoEngine`: "尚未设置引擎" with "设置引擎", which opens the wizard (non-rerun). The grey dot does the same.
  - `EngineStatus`: the crashed state shows "重新设置引擎", which opens the wizard with `rerun: true`. Ready with `analysis.rootVisits >= visitLimit` shows "已达到每步上限".
  - `third-party-notices.mjs --check` on the committed file passes (a Vitest test that spawns it with `--check`).
- [ ] **Step 3: Run them and see them fail**
- [ ] **Step 4: Implement.** Layout per mockups S, About and No engine. The gear and "←" switch `settingsOpen`. Imports of the `.txt` notices use Vite's `?raw`.
- [ ] **Step 5: Run the checks and see them pass, and run `node scripts/third-party-notices.mjs` to generate the file**
- [ ] **Step 6: Commit:** `feat: settings, About with licence notices, and the no-engine and crashed panels`

### Task 13: Development scenarios

**Files:**
- Create: `src/dev/scenarios.ts`, `src/dev/scenarios.test.ts`.
- Modify: `src/main.tsx`, `docs/development.md`.

**Interfaces:**
- Produces: `scenarioTransport(name: string): FakeTransport | null`. Its names:
  - `pc-cuda`: Windows, RTX 5070, driver 581.0, CUDA default; the install succeeds;
  - `pc-old-driver`: step 2 shows the disabled CUDA row;
  - `cuda-licence`;
  - `a1-driver`, `a2-gpu-error`, `b-download-failed`, `d-crashed`, `no-engine`;
  - `mac`: the Metal path, ending installed.

  Scripted progress is emitted on timers.
- `main.tsx` uses it only under `import.meta.env.DEV` and when `?scenario=` is present, so a production build tree-shakes it out.

- [ ] **Step 1: Write the failing test.** Each named scenario answers every request the wizard sends, without throwing an unhandled request, and reaches its intended panel when driven by the real components (render `App` with it).
- [ ] **Step 2: Run it and see it fail**
- [ ] **Step 3: Implement.** Build the fixtures from the generated types, with real manifest ids and sizes from the bundled manifest where a scenario names them.
- [ ] **Step 4: Run the checks, then `pnpm build`, and see them pass. Confirm that `grep -r "b-download-failed" dist/` finds nothing.**
- [ ] **Step 5: Commit:** `feat: development-only setup scenarios for the panels the Mac cannot reach`

### Task 14: Documents, and the exit check

**Files:**
- Modify:
  - `docs/superpowers/specs/2026-11-19-aji-project-charter-design.md` (6.3, 7.1, 7.9);
  - `docs/superpowers/plans/2026-11-19-phase-1-roadmap.md` (3.4, M5 status);
  - `docs/superpowers/specs/2026-11-19-aji-ui-design.md` (7, 8);
  - `docs/audits/phase-1-lizzieyzy-menu.md` (G1–G4, G12, K2 status);
  - this plan's Status.

- [ ] **Step 1: Make the document edits** listed in design section 9.
- [ ] **Step 2: Whole-branch checks**, all from Global Constraints, plus `cargo deny check licenses` and `node scripts/third-party-notices.mjs --check`.
- [ ] **Step 3: Build** with `pnpm tauri build --bundles app`.
- [ ] **Step 4: Run the exit check**, design section 8 items 3 to 9, in the author's account.
  - Use `AJI_DATA_ROOT` pointing at an empty scratch folder.
  - Item 7 runs with no limit for 30 minutes. Record KataGo's RSS every 5 minutes.
  - M4 minor #14: import a `.txt.gz` network through step 4, using one of Homebrew's networks in `/opt/homebrew/share/katago/` if one is `.txt.gz`, or a local recompression of a `.bin.gz` otherwise. Install with it and see analysis start. If KataGo refuses the file stored as `.bin.gz`, keep the original suffix in `import.rs` and add a test.
  - Record results in this plan's Status.
- [ ] **Step 5: Hand items 2 and 8 to the owner** (a new macOS user; an external screen), and optionally the PC.
- [ ] **Step 6: Commit:** `docs: mark M5 wizard and settings done`
