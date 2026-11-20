# M4 Install Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One request installs a KataGo engine set: the engine, the NVIDIA runtime where one is needed, and the network. Aji then checks every file, unpacks, benchmarks, writes a config and runs a test query, records the result and makes it active. A failure stops with a plain-language code and offers the next backend.

**Architecture:**
- `aji-manager` gains an `install` module and now depends on `aji-engine` and `aji-core`. The module holds:
  - the download source rules and the downloader;
  - free space and unpacking;
  - the benchmark and config generation;
  - failure classification and the test query;
  - the installed-engines record (`installed.json`);
  - the `Installer`, which runs one job at a time.
- `aji-engine` gains three things:
  - runtime folders on KataGo's own `PATH`;
  - a safe one-shot run (for `benchmark`) through its existing spawner;
  - `Engine::set_files`, to switch files while running.
- `src-tauri` adds the setup requests and the `setupProgress` event. It writes `settings.json` (the download source and licence acceptances), starts the installed engine at startup, and has a development trigger, `AJI_DEV_INSTALL`.
- The M2 and M3 review items deferred to M4 are folded into the first tasks.

**Tech Stack:**
- Rust: tokio, reqwest 0.13 (rustls on `ring`), serde, ts-rs, `zip` 9 (deflate only), `sha2` 0.11, `md-5` 0.11, `tokio-util` (cancellation), `tauri-plugin-dialog` 2, and a free-space crate.
- TypeScript: only generated types, locale strings and one test. There is no new UI.

**Spec:** [M4 install pipeline design](../specs/2026-11-20-m4-install-pipeline-design.md), approved by the owner on 2026-11-20. Read it with this plan: section numbers below (5.3 and so on) refer to it.

**Status:** Done on 2026-11-20, except the items under Outstanding.
- **Checks.** At `5828ad4` every check passes on the Mac: `cargo fmt --check`, clippy with `-D warnings`, 445 Rust tests, `pnpm lint`, `pnpm typecheck`, 132 TypeScript tests and `cargo deny check licenses`.
- **Final review.** A fresh review of the whole branch found nothing critical and three important issues, fixed in `2d11ed9`:
  - a URL serving another file (an error page, a truncated mirror, a server that ignores Range and drops) was retried forever;
  - an `installed.json` that could not be read was replaced by an empty one on the next write;
  - recorded files were trusted without a check, and writes were not synced before their rename.
  Thirteen minor findings are deferred to M5 planning.
- **Mac exit check** on the M5, with the app from `pnpm tauri build --bundles app` (7.57 MiB):
  - `AJI_DEV_INSTALL=recommended` chose `katago-v1.18.2-metal-macos-arm64` with `kata1-tf3-b11c768-s12382M-d6533M`. The engine came from github.com: 3934477 bytes in 3.3 s.
  - `kill -9` during the network download left a part file of 42454639 of 262041254 bytes, and no Aji or KataGo process. On the next start the download resumed: it transferred 219586615 bytes, exactly the rest, in 89.6 s from media.katagotraining.org.
  - The benchmark took 3 min 5 s: 6 threads gave 45.84 visits/s, 10 gave 36.82 and 16 gave 25.95, so 6 was chosen. The test query passed in 6 s, and the log ended `aji: install installed`.
  - `ps` showed KataGo running from `…/engines/katago-v1.18.2-metal-macos-arm64/katago`, with the config and the model as relative paths.
  - Started again without the variable, Aji logged `aji: starting the installed engine …` and the same KataGo path, and KataGo was analysing.
  - Found and fixed (`5828ad4`): every quit panicked with "no reactor running", so the shutdown on exit never ran (the code dates from M2). KataGo still exited when its stdin closed, but an install job was never cancelled. After the fix, quitting leaves no KataGo process.
  - `settings.json` was restored from its backup.
- **Outstanding.**
  - The owner's look at the candidates in the panel. The release app was left open on the installed engine.
  - The Metal benchmark counts. With the preselected network, speed falls as threads rise, so the best count may be below the list's lowest, 6. The run also took about 3 minutes, not the proposed 2. The owner decides whether to lower the Metal counts (for example 2, 4 and 6).
  - Step 5, the PC, at the owner's call. It needs the CI `workflow_dispatch`, which pushes the branch. The final review adds a check: whether a missing DLL shows a Windows system dialog.
  - Step 6, D1. The speeds above are from the owner's Mac network; the owner decides whether they stand for a mainland network.
  - A green CI run on all three OSes. It is the first compile of the Windows and Linux code, and a condition for the merge.
  - Step 8 from M3, each with the owner's OK.

## Owner decisions for M4 (2026-11-20)

| Item | Decision |
|---|---|
| First install on NVIDIA | CUDA straight: the CUDA engine, the 1.95 GB runtime and the network, then the benchmark and the test query. No DirectML bootstrap. |
| A backend that fails | Aji stops, says why, and asks before installing the next backend. It never installs a fallback on its own. |
| Where the pipeline lives | `aji-manager`, which now depends on `aji-engine`. |
| Design | Approved as written, including the calls listed in its sections 5 and 8. |

## Global Constraints

- **Everything from M1 to M3 still holds.** That covers language, interface text in both locales, dependency licences, Conventional Commits, the toolchain, and the protocol rules (no file paths cross the boundary; errors are `{ code, message }`; `#[ts(type = "number")]` on every `u64` below 2^53; camelCase JSON). See the M1, M2 and M3 plans, Global Constraints.
- **No git worktrees**, for subagents too. Every task works in `/Users/zepher/personal/Aji`.
- **Branch.**
  - Work on `feat/m4-install-pipeline`, created from `main` at `0ed0b6e`. The design is at `6e83378` and the roadmap edits at `3dde21b`.
  - Push only when the owner asks. The owner decides the merge.
  - `/Users/zepher/personal/aji-manifest` is a separate clone with one unpushed commit (`1773945`). Task 4 adds one more. Every push to it waits for the owner's OK.
- **Crate rules.**
  - `aji-core` depends on no workspace crate.
  - `aji-engine` never depends on `aji-manager`.
  - `aji-manager` depends on `aji-engine` and `aji-core`.
- **Dependencies.**
  - Every new crate passes `cargo deny check licenses`. `zip` is `{ version = "9", default-features = false, features = ["deflate"] }` (M3 finding: its default features pull in bzip2).
  - `cargo tree -i aws-lc-sys` and `cargo tree -i openssl-sys` still report nothing.
  - The free-space crate is the implementer's choice. It must report free bytes for a path on Windows, macOS and Linux, and pass `cargo deny`.
- **Facts recorded 2026-11-20, used by the tasks:**
  - Every engine and runtime archive in the bundled manifest is a `.zip` (51 of 51), and every entry is deflate (method 8).
  - KataGo's packages are flat, with no top folder. The binary is `katago.exe` on Windows and `katago` (mode 0755) on macOS and Linux. Windows packages carry their own DLLs next to the binary: DirectML ships `DirectML.dll` and `onnxruntime.dll`, while the CUDA package ships none of NVIDIA's.
  - Aji's Metal zip holds `katago`, `LICENSE`, `THIRD-PARTY-LICENSES.txt` and `README.txt`.
  - GitHub release downloads, `media.katagotraining.org`, `developer.download.nvidia.com` and `developer.download.nvidia.cn` all answer `Range: bytes=<n>-` with `206`. GitHub refuses the suffix form `bytes=-<n>` with `501`, so Aji never sends it.
  - On macOS a `katago benchmark` child exits about 1 s after its parent gets `SIGKILL`, at its next write to the closed pipe.
  - `benchmark` reads GTP-style keys (`numSearchThreads`). The analysis engine reads `numAnalysisThreads` × `numSearchThreadsPerAnalysisThread`.
  - With fixed thread counts (`-t`), `benchmark` prints no `Ordered summary of results` block. Each count's last line ends in `(EloDiff …)`. Then `Running additional tests of a few other settings` begins and re-measures the recommendation. Progress lines are joined by `\r`.
  - The bundled runtimes carry `minDriver` and `minComputeCapability`: `nvidia-cuda13.2-cudnn9.24.0-windows-x64` has 580.00 and 7.5, and `nvidia-cuda12.8-cudnn9.8.0-windows-x64` has 572.61 and 5.0. The DirectML and OpenVINO engines carry `config` `onnxProvider = directml` and `openvino`.
- **Layout** (design 5.2), under `app_local_data_dir`:
  - `engines/<engine id>/`, `runtimes/<runtime id>/`, `networks/<file name>`;
  - `configs/<engine id>+<network id>.cfg` and `.benchmark.cfg`;
  - `katago-home/`, `downloads/`, `staging/`, `installed.json`, and M3's `manifest/`.
  - KataGo's working directory is that root. Config, model and `homeDataDir` are relative to it, and the program path is absolute.
- **Values marked [Proposed] in the design, fixed here:**

  | Value | Setting |
  |---|---|
  | Download connect timeout | 15 s |
  | Download stall (no bytes) | 30 s |
  | Tries per URL | 3, with 1 s then 4 s between them |
  | Progress events | at most one per 250 ms per job |
  | Free-space margin | 256 MiB |
  | Free-space estimate for an engine zip | 4 × its size (the zip plus about 3× unpacked) |
  | Free-space estimate for an NVIDIA archive | 2.5 × its size (the archive plus extracted DLLs) |
  | Free-space estimate for a network | 1 × its size |
  | Benchmark on GPU backends | `-v 400 -n 5`. Threads: metal `6,10,16`; cuda, rocm, directml, openvino and opencl `8,16,32` |
  | Benchmark on CPU backends (eigen, eigenavx2) | `-v 100 -n 3`. Threads `max(1, cores/2)` and `cores`, deduplicated |
  | Thread choice | the smallest count with at least 95% of the best visits/s |
  | Benchmark stall (no output) | 5 min |
  | Test query | 50 visits, empty 19×19, Chinese rules, komi 7.5; timeout 5 min |
  | Kill deadline (M2 N1) | 5 s after the kill, the process is given up |
  | Throttle tolerance (M2 N3) | admit at 90% of the interval |
  | `startup_timeout` | stays 600 s. The benchmark now does OpenCL tuning first, so the analysis start is short |

- **Logging** uses `eprintln!("aji: …")`, as in M2 and M3.
  - Every KataGo launch logs its program path.
  - Every finished download logs its name, bytes, seconds and host. This line is the owner's D1 measurement.
- **Linux `ETXTBSY`.** A binary that was just written can fail to start with "Text file busy" when another thread forks at that moment (seen in M2's CJK test). `run_to_end` and the installer's switch to new files retry such a spawn up to 3 times, 100 ms apart.

## Review Focus

1. **A Windows user name with CJK characters** puts every Aji path under it. The install, the benchmark, the test query and analysis must all work from such a root. (Task 6: `runtime_folder_with_cjk_reaches_the_path`; Task 12: `installs_from_a_root_with_cjk_and_spaces`.)
2. **A download that drops, stalls or turns slow on a mainland network.** Aji resumes, moves on to the next URL, and honours a source changed mid-download. (Task 8: `a_stalled_connection_is_dropped_and_resumed`, `changing_the_source_drops_the_connection_and_continues`, `a_mismatch_after_resume_retries_the_same_url_from_zero`.)
3. **A crash, power cut or cancel at any moment of an install.** No half-installed set becomes usable or active, a leftover folder is replaced on the next try, and a verified download is not fetched again. (Task 7: `saving_twice_concurrently_leaves_a_valid_file`; Task 9: `an_unrecorded_leftover_folder_is_replaced`; Task 12: `cancel_ends_the_job_and_keeps_part_files`, `a_verified_download_is_reused_after_a_restart`.)
4. **A hostile or broken entry in a signed manifest or an archive:** `../` in a name, an absolute path, a zip entry escaping its folder, or a config value with a line break. Nothing is written outside Aji's folders, and nothing reaches KataGo's config as an extra line. (Task 1: `unsafe_names_are_rejected`, `config_overrides_are_single_lines`; Task 9: `an_entry_escaping_the_folder_fails_the_unpack`.)
5. **A reinstall while an engine is running.** The running engine stops for the benchmark, and comes back with its old files when the new install fails or is cancelled. (Task 12: `a_failed_reinstall_keeps_the_active_engine`.)

---

### Task 1: Reject unsafe names in the manifest

M3's review requires this before any file is written (design 5.4).

**Files:**
- Modify: `crates/aji-manager/src/manifest/schema.rs` (`validate` and its tests)

**Interfaces:**
- Produces:
  - `pub fn is_plain_name(s: &str) -> bool` in `schema.rs`, re-exported from `manifest`. It is true for a non-empty name that is not `.` or `..` and has no `/`, `\`, `:` or NUL. Task 9 (zip entries) and Task 12 (imports) use it.
  - `pub fn archive_file_name(path: &str) -> &str`, the last `/` component of an `archive.path`.

- [ ] **Step 1: Write the failing tests** (in `schema.rs` `mod tests`, mutating `sample()` as the existing tests do)

```rust
#[test]
fn unsafe_names_are_rejected() {
    for bad in ["../x.zip", "a/b.zip", "a\\b.zip", "/x.zip", "C:x.zip", "..", ".", ""] {
        for field in ["/engines/0/file/name", "/networks/0/file/name", "/engines/0/id",
                      "/runtimes/0/id", "/networks/0/id"] {
            let mut v = sample();
            *v.pointer_mut(field).unwrap() = json!(bad);
            assert!(matches!(parse(&v), Err(ManifestError::Invalid(_))), "{field} = {bad:?}");
        }
    }
}

#[test]
fn archive_paths_keep_their_slashes() {
    let ok = "compute/cuda/redist/libcublas/windows-x86_64/x-archive.zip";
    // set /runtimes/0/components/0/archive/path to `ok`: parses
    for bad in ["../x.zip", "/x.zip", "a//b.zip", "a/./b.zip", "a\\b.zip", "a/../b.zip"] {
        // set the same pointer to `bad`: Err(ManifestError::Invalid(_))
    }
}

#[test]
fn extract_patterns_are_plain_names() { /* "bin/x.dll", "..", "a\\b.dll" each rejected; "cudnn*64_9.dll" accepted */ }

#[test]
fn licence_text_hash_must_be_hex() { /* textSha256 "xyz" and 63 hex digits rejected */ }

#[test]
fn config_overrides_are_single_lines() {
    // engines/0/config {"onnxProvider": "directml\nlogDir = /tmp"} rejected;
    // key "bad key" rejected; {"onnxProvider": "directml"} accepted
}

#[test]
fn the_bundled_manifest_still_parses() {
    let m = parse_manifest(BUNDLED).unwrap();
    assert_eq!((m.engines.len(), m.runtimes.len(), m.networks.len()), (45, 2, 9));
}
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-manager --lib manifest::schema`
Expected: the five new rejection tests FAIL; `the_bundled_manifest_still_parses` passes.

- [ ] **Step 3: Implement the checks in `validate`**

The rules:
- `file.name` and every id must pass `is_plain_name`.
- `archive.path` must be relative. Each `/` component must be non-empty, not `.` or `..`, and contain no `\` or `:`.
- Each `extract` pattern must pass `is_plain_name`.
- `textSha256` must be 64 lowercase hex digits.
- Each `config` key must match `^[A-Za-z][A-Za-z0-9_]*$`, and each value must contain no `\r`, `\n` or `#`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p aji-manager`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/aji-manager/src/manifest/schema.rs
git commit -m "fix(manager): reject unsafe names and config values in the manifest"
```

### Task 2: Manifest fetch, store and cache review items

**Files:**
- Modify:
  - `crates/aji-manager/src/manifest/fetch.rs`
  - `crates/aji-manager/src/manifest/store.rs`
  - `crates/aji-manager/src/manifest/cache.rs`
  - `crates/aji-manager/src/manifest/select.rs`
  - `crates/aji-manager/src/manifest/schema.rs` (`#[ts(skip)]`)
  - `crates/aji-manager/src/bin/aji-setup-report.rs`
  - `src-tauri/src/lib.rs` (`start_setup`)
- Test:
  - `crates/aji-manager/tests/manifest_fetch.rs`
  - `crates/aji-manager/tests/manifest_select.rs`
  - `crates/aji-manager/tests/common/http.rs`

**Interfaces:**
- Produces:
  - `pub fn http_client(user_agent: &str, options: ClientOptions) -> Result<reqwest::Client, FetchError>`, with a new `FetchError::Client(String)`.
  - `ClientOptions { timeout: Option<Duration>, connect_timeout: Duration }`. The manifest keeps `Some(10 s)`. Task 8's download client uses `None` (no limit on a whole body) with 15 s to connect. `Default` keeps today's manifest values.
  - `ManifestStore::refresh(&self, client, bases) -> Result<Source, FetchError>`.
  - `Source` derives `Serialize` with `rename_all = "lowercase"`.
  - `tests/common/http.rs` gains a chunked reply with no `Content-Length`, and one whose `Content-Length` is wrong. Task 8 extends the file further.

- [ ] **Step 1: Write the failing tests**

```rust
// manifest_fetch.rs
#[tokio::test] async fn refresh_reports_a_failed_fetch()
    // store.refresh(&client, &[serve_404_base]) is Err(FetchError::Status(404)); current().source unchanged
#[tokio::test] async fn an_older_fetched_copy_never_replaces_a_newer_current_one()
    // cache holds a signed copy with sequence S+2; the server serves S+1: after refresh, current().manifest.sequence == S+2
#[tokio::test] async fn a_body_over_4_mib_without_content_length_is_rejected()   // FetchError::TooLarge
#[tokio::test] async fn a_body_over_4_mib_with_a_wrong_content_length_is_rejected() // header says 100, body 4 MiB + 1
#[test] fn http_client_builds() // http_client("Aji/test", ClientOptions::default()).is_ok()

// manifest_select.rs
#[test] fn a_legacy_signature_is_rejected()   // minisign 0.10 `sign(.., prehashed = false)`: Rejection::BadSignature
#[test] fn invalid_entries() // existing test: now asserts matches!(.., Rejection::Invalid(ManifestError::Invalid(_)))
#[test] fn unknown_runtime_platform_and_network_kind_are_dropped()
#[test] fn source_serialises_in_lowercase() // serde_json::to_value(Source::Bundled) == json!("bundled")

// cache.rs unit test
#[test] fn cache_writes_use_unique_temporary_names()
    // two threads store_cache into one dir behind a Barrier: both Ok; load_cache verifies
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-manager`
Expected: the new tests FAIL or do not compile.

- [ ] **Step 3: Implement**
  - `refresh` returns the fetch error. After fetching, it takes the lock, selects again with the copy current *at that moment* as the rival, and swaps under the same lock. A slower refresh then cannot overwrite a newer copy.
  - `store_cache` writes to `<name>.<pid>-<counter>.tmp`, where the counter is a process-wide `AtomicU64`, then renames.
  - `#[ts(skip)]` goes on each `#[serde(other)] Unknown` variant (`Platform`, `Backend` and any other exported enum).
  - The callers log the error with `eprintln!("aji: manifest fetch failed: {e}")`, and `aji-setup-report` prints the source through serde.

- [ ] **Step 4: Run the tests and check the ts-rs warnings are gone**

Run: `cargo test -p aji-manager 2>&1 | grep -c "serde(other)"`
Expected: `0`, and every test passes.

Run: `cargo test --workspace`
Expected: all pass. `src/transport/generated/Backend.ts` and `Platform.ts` lose their `"Unknown"` member. `pnpm typecheck` passes.

- [ ] **Step 5: Commit**

```bash
git add crates/aji-manager src-tauri/src/lib.rs src/transport/generated
git commit -m "fix(manager): report fetch errors, keep the newest manifest and harden the cache"
```

### Task 3: Recommendation and hardware review items

**Files:**
- Modify:
  - `crates/aji-manager/src/recommend/gpu.rs`
  - `crates/aji-manager/src/hardware/windows.rs`
  - `crates/aji-manager/src/hardware/linux.rs`
  - `crates/aji-manager/src/hardware/mod.rs`
- Create: `crates/aji-manager/tests/fixtures/hardware/linux-synthetic/sys/bus/pci/devices/0000:01:00.0/{class,vendor,device}`, plus a `SOURCE.md` line for them.
- Test:
  - `crates/aji-manager/tests/recommend_table.rs`
  - `crates/aji-manager/src/hardware/tests.rs`

**Interfaces:**
- Produces:
  - `gpu.rs` reads the CUDA thresholds from the manifest. For each CUDA variant it uses the runtime named by that variant's engines (`minDriver`, `minComputeCapability`). The constants `CUDA13_DRIVER`, `CUDA13_COMPUTE_CAPABILITY` and `CUDA12_DRIVER` are deleted.
  - A runtime that lacks `minDriver` makes its variant unusable.

- [ ] **Step 1: Write the failing tests**

```rust
// recommend_table.rs (driver strings and capability on an RTX card, bundled manifest)
#[test] fn cuda13_needs_driver_580_00()     // "580.00" -> default variant cuda13.2; "579.99" -> cuda12.8
#[test] fn cuda12_needs_driver_572_61()     // "572.61" -> cuda12.8; "572.60" -> default directml
#[test] fn cuda13_needs_compute_capability_7_5() // "7.5" -> cuda13.2; "7.4" -> cuda12.8
#[test] fn thresholds_come_from_the_manifest()
    // bundled manifest with cuda13.2 runtime minDriver edited to "600.00": driver 591.44 -> cuda12.8

// hardware/tests.rs
#[test] fn system32_retry_only_on_not_found()
    // should_retry_in_system32(&io::Error::from(ErrorKind::NotFound)) == true; PermissionDenied -> false
#[test] fn linux_finds_nvidia_by_pci_class_without_drm()
    // a sys root with only bus/pci/devices/0000:01:00.0 (class 0x030000, vendor 0x10de): one NVIDIA GpuReport
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-manager --test recommend_table && cargo test -p aji-manager --lib hardware`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**
  - `fn should_retry_in_system32(e: &io::Error) -> bool` in `windows.rs`.
  - Linux also scans `sys/bus/pci/devices/*`. A device counts when its class starts with `0x03` (display controller). A device already found through `class/drm` is not counted twice.
  - Each failed probe logs `eprintln!("aji: hardware probe {probe:?} failed: {error}")` before it is recorded in `problems`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p aji-manager`
Expected: all pass, including all 36 earlier table tests.

- [ ] **Step 5: Commit**

```bash
git add crates/aji-manager
git commit -m "fix(manager): read CUDA limits from the manifest and tighten the hardware probes"
```

### Task 4: Manifest generator checks, and a key check in the publish workflow

**Files:**
- Modify:
  - `crates/aji-manifest-tool/src/networks.rs`
  - `crates/aji-manifest-tool/src/releases.rs`
  - `/Users/zepher/personal/aji-manifest/.github/workflows/manifest.yml` (the other repository)
- Test: `crates/aji-manifest-tool/tests/generator.rs`

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn network_links_outside_the_models_prefix_are_rejected()
    // a row whose href is https://example.com/x.bin.gz: generation errors naming the row
#[test] fn draft_and_prerelease_releases_are_skipped()
    // a release JSON with "draft": true and one with "prerelease": true contribute no engines
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-manifest-tool`
Expected: FAIL.

- [ ] **Step 3: Implement.** The models prefix is `https://media.katagotraining.org/uploaded/networks/models/` (`models_extra/` is allowed for the human SL network). `prerelease` and `draft` are read as `bool` with `#[serde(default)]`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p aji-manifest-tool`
Expected: all pass.

- [ ] **Step 5: Add the key check to the publish workflow.** In `manifest.yml`, after signing, a step reads every string literal matching `RW[A-Za-z0-9+/]{54}` (a 56-character minisign public key, such as today's `RWTCsDC3…`) from Aji's `crates/aji-manager/src/manifest/keys.rs` at the same `aji_ref` the job checks out. It runs `minisign -V -P <key> -m manifest.json` and passes if any key verifies. The job fails when none does. The workflow is not run here.

- [ ] **Step 6: Commit both repositories**

```bash
git add crates/aji-manifest-tool
git commit -m "fix(manifest-tool): check network links and skip draft and prerelease releases"
git -C /Users/zepher/personal/aji-manifest add .github/workflows/manifest.yml
git -C /Users/zepher/personal/aji-manifest commit -m "ci: verify the signed manifest against the keys Aji trusts"
```

### Task 5: `aji-engine`: runtime PATH, switching files, and M2 review items

**Files:**
- Modify:
  - `crates/aji-engine/src/process.rs`
  - `crates/aji-engine/src/engine.rs`
  - `crates/aji-engine/src/throttle.rs`
  - `src-tauri/src/settings.rs` (`DevEngine::files` sets `path_prepend: Vec::new()`)
- Test: `crates/aji-engine/tests/engine.rs`, plus unit tests in `process.rs` and `throttle.rs`

**Interfaces:**
- Produces:
  - `EngineFiles` gains `pub path_prepend: Vec<PathBuf>`.
  - `LaunchSpec` gains `pub env: Vec<(OsString, OsString)>`.
  - `katago_launch` puts `path_prepend` before the inherited `PATH`, through `std::env::join_paths`. With no entries, the environment is untouched.
  - `pub async fn set_files(&self, files: Option<EngineFiles>) -> Result<(), EngineError>` on `Engine`:
    - it returns once the new KataGo is `starting`, or `notConfigured` for `None`;
    - it keeps the position;
    - it clears the analysis cache and the shown analysis, because another network gives other numbers.
  - `EngineOptions` gains `pub kill_deadline: Duration`, 5 s by default.
  - `start_process` logs `aji: starting KataGo <program path>`.

- [ ] **Step 1: Write the failing tests**

```rust
// process.rs
#[test] fn path_prepend_goes_before_the_inherited_path()
    // katago_launch(files with path_prepend [a, b]).env == [("PATH", join_paths([a, b, ..inherited]))]
#[test] fn no_path_prepend_leaves_the_environment_alone() // env.is_empty()

// throttle.rs
#[test] fn an_update_at_ninety_percent_of_the_interval_is_admitted()
    // interval 100 ms: admitted at +90 ms, refused at +89 ms

// tests/engine.rs
#[tokio::test] async fn set_files_switches_to_the_new_files()
    // running on scenario "normal"; set_files(Some(files("slow"))) -> state goes starting -> ready; pid changes
#[tokio::test] async fn set_files_none_stops_and_reports_not_configured()
#[tokio::test] async fn set_files_drops_the_old_analysis()
    // after the switch, status().analysis is None until a new update arrives
#[tokio::test] async fn an_unkillable_process_is_given_up_after_the_kill_deadline()
    // through a test seam the process never reports its exit; stop() returns within
    // shutdown_grace + kill_deadline + 1 s, and the state is `stopped`
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-engine`
Expected: the new tests FAIL or do not compile.

- [ ] **Step 3: Implement**
  - `Command::SetFiles` replaces `self.files`, clears the cache and the snapshot's analysis, then restarts as `restart()` does.
  - For N1: once the kill has been sent, the actor waits at most `kill_deadline` for the exit report. Then it drops the process handle, logs `aji: KataGo did not exit after kill; giving it up`, and carries on as if the process had exited. The seam that lets the test hold back the exit report is the implementer's choice, compiled only under `cfg(test)` or a test feature.
  - For N3: `Throttle::admit` accepts once at least 90% of the interval has passed.

- [ ] **Step 4: Make `status_carries_the_latest_analysis` deterministic.** Today it compares `status()` with the first update, but a second update can land in between (M3 review). Pause first, wait for `paused`, and compare `status().analysis` with the *last* analysis event received before the pause.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p aji-engine && cargo test -p aji`
Expected: all pass. `status_carries_the_latest_analysis` passes 20 runs in a row: `for i in $(seq 20); do cargo test -p aji-engine --test engine status_carries -q || break; done`.

- [ ] **Step 6: Commit**

```bash
git add crates/aji-engine src-tauri/src/settings.rs
git commit -m "feat(engine): switch files while running, put runtime folders first on PATH, and bound kills"
```

### Task 6: `aji-engine`: one-shot KataGo runs, and the fake KataGo's install mode

**Files:**
- Modify:
  - `crates/aji-engine/src/process.rs`
  - `crates/aji-engine/src/lib.rs`
  - `crates/aji-engine/src/bin/fake-katago.rs`
- Create:
  - `crates/aji-engine/tests/run.rs`
  - `crates/aji-engine/tests/fixtures/install/` (scenario JSON for install mode, plus `SOURCE.md` saying which stderr lines are synthetic and where each was copied from)

**Interfaces:**
- Produces:

```rust
pub struct RunLimits { pub stall: Duration, pub stderr_lines: usize }
pub struct RunOutput { pub exit: ExitInfo, pub stdout: String, pub stderr_tail: Vec<String>, pub stalled: bool }
/// Runs `spec` to its end through the spawner thread (job object, parent-death signal), with
/// stdin closed. Reads raw bytes, since KataGo's benchmark progress uses `\r`. No bytes on stdout
/// or stderr for `limits.stall` kills the process and sets `stalled`. Dropping the future kills it.
pub async fn run_to_end(spec: LaunchSpec, limits: RunLimits) -> io::Result<RunOutput>
pub fn katago_benchmark_launch(files: &EngineFiles, visits: u32, positions: u32, threads: &[u32]) -> LaunchSpec
```

- `katago_benchmark_launch` builds `benchmark -config <config> -model <model> -v <visits> -n <positions> -t <a,b,c> -no-server-thread-test -no-half-batch-size-test`. The last two flags skip KataGo's extra tests after the main run (findings 5). It applies the same `PATH` rule as `katago_launch`.
- **The fake KataGo's install mode.** When the `-config` file is not JSON, the fake is running as an installed engine:
  - it reads its scenario from `fake-katago-scenario.json` next to its own executable, with the transcript relative to that file;
  - it reads the config as `key = value` lines.
- **New scenario fields:**
  - `requireConfig: { key: value }`. A missing or different key prints `fake-katago: missing config <key>` and exits 1.
  - `requirePathEntry: "<folder name>"`. The first `PATH` entry must end with this name. Otherwise the fake prints `fake-katago: library not found` and exits with `missingLibraryExit`, which defaults to 127.
  - `benchmark: { visitsPerSecond: { "<threads>": f64 } }`. The `benchmark` subcommand prints, for each count in `-t`, its progress lines joined by `\r` and a final line in KataGo's format, copied from the `fixed-threads` fixture. Then it exits 0.
  - `failure: { during: "startup" | "benchmark" | "query", stderr: [..], exitCode: i32 }`.
  - The `-model` path must exist relative to the working directory. Otherwise the fake prints `fake-katago: model not found` and exits 1.
  - **KataGo's own config rules,** with KataGo's exact messages, so CI catches a bad template (findings 4a):
    - `benchmark` needs `numSearchThreads`;
    - `analysis` needs `numAnalysisThreads`, `numSearchThreadsPerAnalysisThread` and `nnMaxBatchSize`;
    - `analysis` fails when both `numSearchThreads` and `numSearchThreadsPerAnalysisThread` are set.

- [ ] **Step 1: Write the failing tests** (`tests/run.rs`, against `CARGO_BIN_EXE_fake-katago`)

```rust
#[tokio::test] async fn run_to_end_collects_benchmark_output()
    // install-mode dir with visitsPerSecond {8: 100.0, 16: 180.0}; -t 8,16:
    // exit code 0, stdout contains "numSearchThreads = 16: 5 / 5 positions, visits/s = 180.00"
#[tokio::test] async fn run_to_end_kills_a_stalled_process()   // scenario that sleeps: stalled == true within stall + 2 s
#[tokio::test] async fn dropping_the_run_kills_the_process()    // pid no longer alive 2 s after dropping the future
#[tokio::test] async fn a_missing_required_config_key_fails()   // exit 1, stderr tail has "missing config onnxProvider"
#[tokio::test] async fn katago_config_rules_are_enforced()
    // benchmark without numSearchThreads: "Could not find key 'numSearchThreads'"; analysis with both thread keys:
    // "Cannot specify both numSearchThreadsPerAnalysisThread and numSearchThreads in the same config"
#[tokio::test] async fn runtime_folder_with_cjk_reaches_the_path()
    // path_prepend [root/"运行库 x"], requirePathEntry "运行库 x": exit 0
#[tokio::test] async fn a_failure_prints_its_stderr_and_exit_code()
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-engine --test run`
Expected: FAIL.

- [ ] **Step 3: Implement `run_to_end`, `katago_benchmark_launch` and the fake's install mode.** `run_to_end` retries a spawn failing with `ETXTBSY` (Global Constraints).

- [ ] **Step 4: Run all aji-engine tests**

Run: `cargo test -p aji-engine`
Expected: all pass. M2's JSON scenarios behave as before.

- [ ] **Step 5: Commit**

```bash
git add crates/aji-engine
git commit -m "feat(engine): run one-shot KataGo commands safely and give the fake KataGo an install mode"
```

### Task 7: Install layout and the installed-engines record

**Files:**
- Modify:
  - `crates/aji-manager/Cargo.toml`: add `aji-engine` and `aji-core` (path dependencies), and a `[[bin]]` named `aji-manager-fake-katago` with `path = "../aji-engine/src/bin/fake-katago.rs"`, `test = false`, `doc = false`. That gives this package's tests `CARGO_BIN_EXE_aji-manager-fake-katago`.
  - `crates/aji-manager/src/lib.rs`: `pub mod install;`
- Create:
  - `crates/aji-manager/src/install/mod.rs`
  - `crates/aji-manager/src/install/layout.rs`
  - `crates/aji-manager/src/install/record.rs`

**Interfaces:**
- Produces:

```rust
pub struct InstallRoot { /* root: PathBuf */ }
impl InstallRoot {
    pub fn new(root: PathBuf) -> InstallRoot;
    pub fn root(&self) -> &Path;
    pub fn engine_dir(&self, engine: &str) -> PathBuf;          // engines/<id>
    pub fn runtime_dir(&self, runtime: &str) -> PathBuf;        // runtimes/<id>
    pub fn network_file(&self, file_name: &str) -> PathBuf;     // networks/<name>
    pub fn config_rel(&self, engine: &str, network: &str) -> PathBuf;           // configs/<e>+<n>.cfg
    pub fn benchmark_config_rel(&self, engine: &str, network: &str) -> PathBuf; // configs/<e>+<n>.benchmark.cfg
    pub fn downloads_dir(&self) -> PathBuf;
    pub fn new_staging_dir(&self) -> io::Result<PathBuf>;       // staging/<random>, created
    pub fn record_file(&self) -> PathBuf;                       // installed.json
    pub fn katago_home_rel() -> &'static str;                   // "katago-home"
}

#[derive(Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct Installed {
    pub schema: u32, // 1
    pub engines: BTreeMap<String, InstalledEngine>,
    pub runtimes: BTreeMap<String, InstalledRuntime>,
    pub networks: BTreeMap<String, InstalledNetwork>,
    pub sets: Vec<EngineSet>,
    pub active: Option<SetKey>,
}
pub struct InstalledEngine { pub backend: Backend, pub version: String, pub binary: String }
pub struct InstalledRuntime { pub archives: Vec<String> }
pub struct InstalledNetwork { pub file: String, pub name: String, pub imported: bool }
pub struct ThreadSpeed { pub threads: u32, pub visits_per_second: f64 }
pub struct EngineSet { pub engine: String, pub network: String, pub runtime: Option<String>,
                       pub config: String, pub threads: u32, pub benchmark: Vec<ThreadSpeed> }
pub struct SetKey { pub engine: String, pub network: String }

pub fn load_installed(path: &Path) -> Installed;
pub fn save_installed(path: &Path, installed: &Installed) -> io::Result<()>;
impl Installed {
    pub fn put_set(&mut self, set: EngineSet); // replaces the set with the same key
    pub fn active_set(&self) -> Option<&EngineSet>;
}
pub fn engine_files(root: &InstallRoot, installed: &Installed, set: &EngineSet) -> Option<EngineFiles>;
```

- `load_installed` behaviour:
  - a missing file gives an empty record;
  - a malformed file, or a newer `schema`, is renamed to `installed.json.bad-<unix seconds>`, logged, and an empty record is returned, so nothing is silently overwritten.
- `save_installed` writes to a unique temporary name and renames it, as in Task 2.
- `engine_files` returns:
  - `katago` = `root/engines/<id>/<binary>`, absolute;
  - `working_dir` = root;
  - `config` = `configs/…cfg` and `model` = `networks/<file>`, both relative;
  - `path_prepend` = `[root/runtimes/<runtime>]` when the set has a runtime.

- [ ] **Step 1: Write the failing tests** (unit tests in `record.rs` and `layout.rs`)

```rust
#[test] fn a_missing_record_is_empty()
#[test] fn the_record_round_trips()
#[test] fn a_malformed_record_is_kept_aside()          // file "{" -> empty record; installed.json.bad-* exists
#[test] fn a_newer_schema_is_kept_aside()
#[test] fn saving_twice_concurrently_leaves_a_valid_file()
#[test] fn engine_files_are_relative_to_the_root()
    // config == "configs/e+n.cfg", model == "networks/n.bin.gz", working_dir == root, katago absolute
#[test] fn a_runtime_folder_goes_on_the_path()
#[test] fn put_set_replaces_the_same_key()
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-manager --lib install`
Expected: FAIL.

- [ ] **Step 3: Implement `layout.rs` and `record.rs`**

- [ ] **Step 4: Run the tests and the licence check**

Run: `cargo test -p aji-manager && cargo deny check licenses`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/aji-manager Cargo.lock
git commit -m "feat(manager): lay out the install folders and record what is installed"
```

### Task 8: Download source and the downloader

**Files:**
- Create:
  - `crates/aji-manager/src/install/source.rs`
  - `crates/aji-manager/src/install/download.rs`
  - `crates/aji-manager/tests/download.rs`
- Modify:
  - `crates/aji-manager/tests/common/http.rs` (Range and behaviours)
  - `crates/aji-manager/Cargo.toml` (`sha2`, `md-5`, `tokio-util`, and tokio `fs` and `io-util`)

**Interfaces:**
- Produces:

```rust
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")] #[ts(export)]
pub enum DownloadSource { #[default] Direct, Prefix { url: String }, Mirror { url: String } }
impl DownloadSource { pub fn validate(&self) -> Result<(), String> } // url must start with http:// or https://

#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum Origin { Package, Nvidia }
/// design 5.3: Direct keeps `urls`; Prefix puts `<prefix><url>` first for each https://github.com/ URL;
/// Mirror puts `<mirror>/<file_name>` first; Nvidia is never rewritten.
pub fn candidate_urls(source: &DownloadSource, origin: Origin, file_name: &str, urls: &[String]) -> Vec<String>;

pub struct DownloadItem { pub name: String, pub size: u64, pub digest: Digest, pub urls: Vec<String>, pub origin: Origin }
pub struct DownloadOptions { pub stall: Duration, pub tries_per_url: u32, pub backoff: Vec<Duration> }
pub enum DownloadError { Failed { last: String }, Checksum, Cancelled, Io(String) }
pub struct Downloader { /* client, options, source: watch::Receiver<DownloadSource> */ }
impl Downloader {
    pub fn new(client: reqwest::Client, options: DownloadOptions, source: watch::Receiver<DownloadSource>) -> Downloader;
    /// Into `dir/<name>.part`, then renamed to `dir/<name>` once its digest matches. A complete
    /// `dir/<name>` already there is hashed and reused when it matches.
    pub async fn fetch(&self, item: &DownloadItem, dir: &Path, cancel: &CancellationToken,
                       progress: &mut (dyn FnMut(u64, u64) + Send)) -> Result<PathBuf, DownloadError>;
}
```

- **Rules** (design 5.3 and Global Constraints):
  - The digest is computed while streaming. On resume, the existing bytes are hashed first.
  - After a resume, a mismatch retries the same URL from zero once. A mismatch on a download from zero deletes the `.part` and moves to the next URL.
  - A body longer than `size` is a mismatch.
  - `206` appends only when `Content-Range` starts at the `.part` length. `200` truncates and starts over.
  - A change of `source` drops the current connection, and the next connection uses the new URL list, keeping the `.part`.
  - A finished file logs `aji: downloaded <name>: <transferred> of <size> bytes in <secs> s from <host>`. `<transferred>` counts only this run's bytes, so a resumed file shows less than its size.
- **The test server** (`common/http.rs`) gains:
  - `serve_files(routes: Vec<(&str, FileReply)>) -> TestServer { base, requests: Arc<Mutex<Vec<RecordedRequest>>> }`;
  - `FileReply { body, mode: Normal | IgnoreRange | NotFound | Corrupt | StallAfter(usize) }`;
  - `RecordedRequest { path, range: Option<String> }`.

- [ ] **Step 1: Write the failing tests**

```rust
// source.rs unit tests
#[test] fn direct_keeps_the_manifest_order()
#[test] fn a_prefix_goes_first_for_github_urls_only()
    // Prefix{"https://p.example/"}: ["https://p.example/https://github.com/a/b.zip", "https://github.com/a/b.zip"];
    // a media.katagotraining.org URL is unchanged
#[test] fn a_mirror_goes_first_for_packages()     // ["https://m.example/net.bin.gz", ..original]
#[test] fn nvidia_urls_are_never_rewritten()      // Prefix and Mirror: output == input
#[test] fn a_source_url_must_be_http_or_https()   // Mirror{"ftp://x"} and Prefix{""} -> Err

// tests/download.rs
#[tokio::test] async fn downloads_and_verifies_sha256()
#[tokio::test] async fn verifies_md5_for_networks()
#[tokio::test] async fn resumes_a_part_file_with_range()         // requests[0].range == Some("bytes=<half>-")
#[tokio::test] async fn starts_over_when_the_server_ignores_range()
#[tokio::test] async fn a_bad_checksum_moves_to_the_next_url()
#[tokio::test] async fn a_mismatch_after_resume_retries_the_same_url_from_zero()
    // wrong bytes pre-written in .part: ranges seen == [Some("bytes=N-"), None]; result Ok
#[tokio::test] async fn a_404_moves_to_the_next_url()
#[tokio::test] async fn a_stalled_connection_is_dropped_and_resumed() // stall 200 ms; second request has a Range
#[tokio::test] async fn cancel_keeps_the_part_file()               // Err(Cancelled); <name>.part exists
#[tokio::test] async fn a_body_longer_than_the_size_is_a_mismatch()
#[tokio::test] async fn every_url_failing_is_download_failed()
#[tokio::test] async fn a_verified_file_is_reused_without_a_request() // requests.is_empty()
#[tokio::test] async fn changing_the_source_drops_the_connection_and_continues()
    // server A stalls after half; the test sends Mirror{B} on the watch channel; B gets a Range request; Ok
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-manager --test download && cargo test -p aji-manager --lib install::source`
Expected: FAIL.

- [ ] **Step 3: Implement `source.rs` and `download.rs`**

- [ ] **Step 4: Run the tests and the dependency checks**

Run: `cargo test -p aji-manager && cargo deny check licenses && cargo tree -i aws-lc-sys`
Expected: all pass; `cargo tree` reports no match.

- [ ] **Step 5: Commit**

```bash
git add crates/aji-manager Cargo.lock
git commit -m "feat(manager): download with resume, checksums, download sources and cancellation"
```

### Task 9: Free space and unpacking

**Files:**
- Create:
  - `crates/aji-manager/src/install/space.rs`
  - `crates/aji-manager/src/install/unpack.rs`
- Modify: `crates/aji-manager/Cargo.toml` (`zip`, the free-space crate, `libc` on macOS)

**Interfaces:**
- Produces:

```rust
pub trait FreeSpace: Send + Sync { fn available(&self, path: &Path) -> io::Result<u64>; }
pub struct SystemFreeSpace;
pub const SPACE_MARGIN: u64 = 256 * 1024 * 1024;
pub struct NotEnoughSpace { pub need: u64, pub available: u64 }
pub fn check_space(space: &dyn FreeSpace, root: &Path, need: u64) -> Result<(), NotEnoughSpace>; // adds SPACE_MARGIN

pub enum UnpackError { UnsafeEntry(String), NoKatago, PatternMatchedNothing(String), Zip(String), Io(String) }
/// Uncompressed bytes of the entries `unpack_runtime` would take (or every entry when `patterns` is None).
pub fn extract_size(zip: &Path, patterns: Option<&[String]>) -> Result<u64, UnpackError>;
/// Unpacks into a new staging dir, then renames it to engines/<engine>. Returns the binary's file name.
pub fn unpack_engine(zip: &Path, root: &InstallRoot, engine: &str) -> Result<String, UnpackError>;
/// Takes each archive's entries whose last path component matches one of its patterns
/// (`*` wildcard, ASCII case-insensitive), flat, then renames the staging dir to runtimes/<runtime>.
pub fn unpack_runtime(archives: &[(PathBuf, Vec<String>)], root: &InstallRoot, runtime: &str) -> Result<(), UnpackError>;
```

- Rules:
  - Each entry is checked with `ZipFile::enclosed_name()` and with Task 1's `is_plain_name` on every component.
  - A destination folder that exists is removed before the rename. The caller only unpacks what is not recorded, so such a folder is a leftover.
  - On Unix the binary is made executable (`0o755`).
  - On macOS a `com.apple.quarantine` attribute on any unpacked file is removed with `libc::removexattr`, and its presence is logged, which answers design 5.4's **[To verify]**.
  - Every file is closed before the rename.

- [ ] **Step 1: Write the failing tests** (unit tests that build zips with the `zip` writer)

```rust
#[test] fn an_engine_unpacks_into_its_folder_in_one_rename()   // engines/e/katago(.exe) exists; staging empty
#[test] fn an_entry_escaping_the_folder_fails_the_unpack()
    // entries "../evil", "/abs", "a/../../evil": Err(UnsafeEntry); no file outside root; engines/e absent
#[test] fn a_package_without_katago_fails()                     // Err(NoKatago)
#[cfg(unix)] #[test] fn the_katago_binary_is_executable()       // mode & 0o111 != 0
#[test] fn runtime_dlls_are_extracted_flat_by_pattern()         // "lib/bin/x64/cudnn_ops64_9.dll" ~ "cudnn*64_9.dll"
#[test] fn a_pattern_matching_nothing_fails()
#[test] fn an_unrecorded_leftover_folder_is_replaced()
#[cfg(target_os = "macos")] #[test] fn quarantine_is_removed()  // setxattr in the test, unpack, attribute gone
#[test] fn extract_size_reads_the_central_directory()
#[test] fn not_enough_space_names_need_and_available()          // fake FreeSpace(100): need 50 -> Err{need: 50 + margin, available: 100}
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-manager --lib install::`
Expected: FAIL.

- [ ] **Step 3: Implement `space.rs` and `unpack.rs`**

- [ ] **Step 4: Run the tests and the licence check**

Run: `cargo test -p aji-manager && cargo deny check licenses && cargo tree -p aji-manager -i bzip2`
Expected: all pass; no `bzip2`.

- [ ] **Step 5: Commit**

```bash
git add crates/aji-manager Cargo.lock
git commit -m "feat(manager): unpack engines and NVIDIA runtimes safely, and check free space"
```

### Task 10: Failure classification and the test query

**Files:**
- Create:
  - `crates/aji-manager/src/install/classify.rs`
  - `crates/aji-manager/src/install/smoke.rs`
  - `crates/aji-manager/tests/smoke.rs`. Cargo sets `CARGO_BIN_EXE_*` only for integration tests, so the fake-driven tests live here.
  - `crates/aji-manager/tests/fixtures/katago-errors/SOURCE.md` (each synthetic line, with the KataGo file and line it is copied from)

**Interfaces:**
- Produces:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")] #[ts(export)]
pub enum FailureCode { DownloadFailed, ChecksumMismatch, NotEnoughSpace, UnpackFailed, MissingLibrary,
    GpuDriverTooOld, GpuError, OutOfMemory, OpenclNoDevice, LicenceNotAccepted, TimedOut, Crashed }
pub struct StepFailure { pub code: FailureCode, pub stderr_tail: Vec<String> }
/// From the exit status and output lines: the stderr tail, plus stdout's last 20 lines for the
/// benchmark, whose log goes to stdout (findings 4c). Windows 0xC0000135 (-1073741515) is MissingLibrary.
pub fn classify(exit: Option<ExitInfo>, lines: &[String]) -> FailureCode;
/// Starts `files` through `aji_engine::Engine` with visit cap 50 on the empty 19×19 board, Chinese, 7.5.
/// Ok once an update with at least one candidate arrives; a crash is classified; no update in `timeout` is TimedOut.
pub async fn run_test_query(files: EngineFiles, timeout: Duration) -> Result<(), StepFailure>;
```

- **Patterns.** Each one is a case-sensitive substring of a line, checked in this order; the first match wins. Each carries a comment citing its KataGo file and line from the findings, and `[To verify]` until a real recording confirms it.

  | Code | Substrings (findings 1) |
  |---|---|
  | `missingLibrary` | exit code -1073741515 (0xC0000135) on Windows; no text pattern |
  | `gpuDriverTooOld` | none yet: KataGo has no text of its own, and CUDA's comes from NVIDIA's library. It waits for a recording |
  | `outOfMemory` | `CL_MEM_OBJECT_ALLOCATION_FAILURE`, `CL_OUT_OF_RESOURCES`, `CL_OUT_OF_HOST_MEMORY`, `CUBLAS_STATUS_ALLOC_FAILED`, `CUDA Error, for Buffers `, `CUDA Error, for ScratchBuffers ` (`cudaMalloc` failures) |
  | `openclNoDevice` | `No OpenCL devices were found on your system`, `CL_PLATFORM_NOT_FOUND_KHR`, `CL_DEVICE_NOT_FOUND` |
  | `gpuError` | `CUDA Error, for `, `CUBLAS Error, for `, `CUDNN Error, for `, `OpenCL error at `, `failed - could not find any working configuration`, `ONNX backend: DirectML init failed`, `ONNX backend: DirectML execution provider is not available`, `Metal backend: Failed to create`, `Metal backend: GPU error`, `Metal backend: Logic error`, then the catch-all `ERROR: NN server thread failed` |
  | `crashed` | everything else, including model-load and config errors, which are Aji's or the network's problem, not the backend's |


- [ ] **Step 1: Write the failing tests**

```rust
// classify.rs: one test per pattern, using the exact line from SOURCE.md
#[test] fn windows_dll_not_found_is_missing_library()   // ExitInfo{code: Some(-1073741515)} -> MissingLibrary
#[test] fn unknown_output_is_crashed()
#[test] fn the_recorded_metal_bad_model_run_is_crashed() // stderr lines of aji-engine's bad-model.jsonl
#[test] fn out_of_memory_beats_the_generic_server_thread_error()
    // "ERROR: NN server thread failed: CUDA Error, for Buffers file x, func cudaMalloc(..), line 1, error (library text)" -> OutOfMemory
#[test] fn every_pattern_maps_to_its_code() // a table test: one synthetic line per substring above -> its code

// tests/smoke.rs, through CARGO_BIN_EXE_aji-manager-fake-katago in install mode. The M2 transcript has the
// empty 19×19 Chinese 7.5 query (`p0`), and the fake matches on the position, not on maxVisits
#[tokio::test] async fn the_test_query_passes_when_candidates_arrive()
#[tokio::test] async fn a_failure_during_the_query_is_classified()
    // failure {during: "query", stderr: [<an out-of-memory line from the findings>]} -> Err(code OutOfMemory)
#[tokio::test] async fn a_silent_engine_times_out()      // hangAfterReady, timeout 1 s -> Err(code TimedOut)
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-manager --lib install:: && cargo test -p aji-manager --test smoke`
Expected: FAIL.

- [ ] **Step 3: Implement `classify.rs` and `smoke.rs`**

- [ ] **Step 4: Run the tests**

Run: `cargo test -p aji-manager`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/aji-manager
git commit -m "feat(manager): classify KataGo failures and run the test query"
```

### Task 11: Benchmark and config generation

**Files:**
- Create:
  - `crates/aji-manager/src/install/benchmark.rs`
  - `crates/aji-manager/src/install/config.rs`
- Test: unit tests against `crates/aji-manager/tests/fixtures/benchmark/1.18.2-metal/`

**Interfaces:**
- Consumes: `aji_engine::{run_to_end, katago_benchmark_launch, RunLimits, EngineFiles}` (Task 6), `ThreadSpeed` (Task 7), `StepFailure` and `classify` (Task 10).
- Produces:

```rust
pub struct BenchmarkPlan { pub visits: u32, pub positions: u32, pub threads: Vec<u32> }
pub fn benchmark_plan(backend: Backend, cpu_cores: u32) -> BenchmarkPlan;   // values: Global Constraints
pub enum BenchmarkParseError { NoResults }
/// Per thread count, the last `k / k positions, visits/s = X` line before "Running additional tests"
/// (or the end). Works for the auto-tuned, fixed-thread and truncated fixtures.
pub fn parse_benchmark(stdout: &str) -> Result<Vec<ThreadSpeed>, BenchmarkParseError>;
pub fn choose_threads(speeds: &[ThreadSpeed]) -> Option<u32>;
pub async fn run_benchmark(files: &EngineFiles, plan: &BenchmarkPlan, stall: Duration) -> Result<Vec<ThreadSpeed>, StepFailure>;

pub fn analysis_config(threads: u32, overrides: &BTreeMap<String, String>) -> String;
pub fn benchmark_config(overrides: &BTreeMap<String, String>) -> String;
```

- `StepFailure` and `classify` come from Task 10. A benchmark that exits non-zero or stalls becomes a `StepFailure` through `classify`; a stall is `timedOut`.
- **Config contents.** Keys first, then the manifest overrides last:
  - **Both configs:** a header comment `# Generated by Aji. It is rewritten when the engine is set up again.` and `homeDataDir = katago-home`.
  - **`analysis_config`:** adds `numAnalysisThreads = 1`, `numSearchThreadsPerAnalysisThread = <threads>`, `nnMaxBatchSize = <threads>`, `nnCacheSizePowerOfTwo = 20` and `nnMutexPoolSizePowerOfTwo = 14`.
  - **`benchmark_config`:** `numSearchThreads = <the plan's first count>`. `benchmark` requires the key, then sweeps `-t` (findings 4a).
  - **No `numSearchThreads` in the analysis config:** the analysis engine fails when it is set together with `numSearchThreadsPerAnalysisThread` (findings 4a). Every analysis key must be one KataGo reads, because it warns about unused keys on stderr (findings 4b).
  - **No logging keys.** None is required. The analysis engine logs to stderr by default, and Aji forces `logToStderr` anyway; `benchmark` logs to stdout (findings 4c).

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn parses_the_auto_tuned_run()        // tf2-b10c384: 6 counts; 6 -> 234.99, 10 -> 244.33
#[test] fn parses_the_fixed_thread_run()      // tf3-b11c768 fixed: [(6, 51.03), (8, 50.81), (10, 50.82)]; the re-measure after
                                              // "Running additional tests" is ignored
#[test] fn parses_a_truncated_run()           // b28c512nbt partial: [(5, 78.47), (12, 82.74)]
#[test] fn garbage_is_an_error()              // Err(NoResults)
#[test] fn the_smallest_count_within_95_percent_wins()
    // tf2 counts 6, 8, 10 -> 6; tf3 fixed -> 6; [(5, 100.0), (10, 200.0)] -> 10; [] -> None
#[test] fn cpu_threads_follow_the_cores()     // eigenavx2 cores 8 -> [4, 8]; cores 1 -> [1]
#[test] fn gpu_plans()                         // metal -> v400 n5 [6, 10, 16]; cuda -> [8, 16, 32]
#[test] fn the_analysis_config_has_the_threads_and_the_overrides()
    // contains "numSearchThreadsPerAnalysisThread = 8\n", "numAnalysisThreads = 1\n",
    // "homeDataDir = katago-home\n", and "onnxProvider = directml\n" after every Aji key; no "numSearchThreads ="
#[test] fn the_benchmark_config_carries_the_manifest_overrides() // and "numSearchThreads = 6\n" for metal's plan
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-manager --lib install::`
Expected: FAIL.

- [ ] **Step 3: Implement `benchmark.rs` and `config.rs`.** A failed benchmark passes the stderr tail and stdout's last 20 lines to `classify`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p aji-manager`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/aji-manager
git commit -m "feat(manager): benchmark thread counts and generate KataGo's configs"
```

### Task 12: The install job

**Files:**
- Create:
  - `crates/aji-manager/src/install/job.rs`
  - `crates/aji-manager/src/install/import.rs`
  - `crates/aji-manager/tests/install_job.rs`
  - `crates/aji-manager/tests/common/engine_zip.rs` (builds an installable zip around the fake KataGo)
- Modify: `crates/aji-manager/src/install/mod.rs`

**Interfaces:**
- Consumes: everything from Tasks 7 to 11, `Setup` (M3), and `aji_engine::Engine` (Task 5). In `aji-manager`, `Engine` alone means the manifest's `manifest::Engine`; the running engine is always written `aji_engine::Engine`.
- Produces:

```rust
pub struct InstallRequest { pub engine: String, pub network: String, pub accepted_licences: BTreeSet<String> }
pub struct InstallOptions { pub download: DownloadOptions, pub benchmark_stall: Duration,
                            pub test_query_timeout: Duration, pub progress_every: Duration }  // Default: Global Constraints
pub struct InstallerParts { pub root: InstallRoot, pub setup: Arc<Setup>, pub engine: aji_engine::Engine,
    pub client: reqwest::Client, pub source: watch::Receiver<DownloadSource>,
    pub space: Arc<dyn FreeSpace>, pub options: InstallOptions }
// `client` is the download client: http_client("Aji/<version>", ClientOptions { timeout: None,
// connect_timeout: 15 s }). The manifest's 10 s whole-request limit would cut every large download.
pub enum StartError { Busy, UnknownEngine, UnknownNetwork }
pub struct Installer { /* one job at a time */ }
impl Installer {
    pub fn new(parts: InstallerParts, on_progress: impl Fn(JobSnapshot) + Send + Sync + 'static) -> Arc<Installer>;
    pub fn start(self: &Arc<Self>, request: InstallRequest) -> Result<(), StartError>;
    pub fn cancel(&self);
    pub fn status(&self) -> Option<JobSnapshot>;      // the running or last job
    pub async fn finished(&self) -> Option<JobSnapshot>; // resolves when the current job ends
    pub fn licences(&self, engine: &str) -> Option<Vec<LicenceInfo>>;
    pub fn import_network(&self, file: &Path) -> Result<ImportedNetwork, ImportError>;
    pub fn installed(&self) -> Installed;
}

#[derive(Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub struct JobSnapshot { #[ts(type = "number")] pub id: u64, pub engine: String, pub backend: Backend,
    pub network: String, pub tasks: Vec<TaskRow>, pub outcome: Option<JobOutcome> }
pub struct TaskRow { pub task: TaskKind, pub state: TaskState }
pub enum TaskKind { Engine, Runtime, Network, Benchmark, TestQuery }            // camelCase
#[serde(tag = "state")] pub enum TaskState { Waiting,
    Running { #[ts(type = "number")] done: u64, #[ts(type = "number")] total: u64 }, Done, Failed { failure: FailureCode } }
#[serde(tag = "outcome")] pub enum JobOutcome {
    Installed,
    Failed { failure: FailureCode, stderr_tail: Vec<String>, offer: Option<FallbackOffer> },
    Cancelled }
pub struct FallbackOffer { pub backend: Backend, pub engine: String,
    #[ts(type = "number")] pub download_bytes: u64, #[ts(type = "number | null")] pub runtime_bytes: Option<u64> }
pub struct LicenceInfo { pub name: String, pub url: String, pub text_sha256: String }
pub struct ImportedNetwork { pub id: String, pub name: String, #[ts(type = "number")] pub size_bytes: u64 }
pub enum ImportError { NotGzip, Io(String) }
```

- **Task rows**, in order: engine, runtime (only when the engine has one), network, benchmark, test query.
  - Byte rows report `done` and `total` bytes.
  - The benchmark row counts thread counts done out of the plan's.
  - The test query is `0` of `1`.
  - A component already recorded is `Done` at once.
- **The job's sequence** (design 5.3 to 5.9):
  1. Take a manifest snapshot (`setup.manifest().current()`), and resolve the engine, its runtime and the network. The network is a manifest network, or an imported one from the record.
  2. **Licences.** Every `requiresAcceptance` licence of the runtime's components must be in `accepted_licences`. Otherwise fail with `licenceNotAccepted` and an offer, before any request is made.
  3. **Free space**, using the estimates in Global Constraints. If the network alone does not fit, fail with `notEnoughSpace` and no offer. If the whole set does not fit, fail with `notEnoughSpace` and an offer.
  4. **Engine.** Download it to `downloads/`, unpack it, record the component, and delete the zip.
  5. **Runtime.** Download each archive, check space again with `extract_size`, unpack, record the component, then delete the archives.
  6. **Network.** Download it, rename it into `networks/`, and record the component.
  7. **Stop the running engine.** Remember whether one was running.
  8. **Benchmark.** Write the benchmark config, run the benchmark, and choose the threads.
  9. **Test query.** Write the analysis config and run the test query.
  10. **Activate.** `put_set`, set `active`, save, then `engine.set_files(Some(engine_files(..)))`.
- **On a failure in steps 7 to 9, or a cancel at any point:**
  - an engine stopped in step 7 is restarted with its old files;
  - downloads that are part-way keep their `.part` files.
- **Offer.** The offer is the first backend after the failed one in `[default] + fallbacks` of `setup.backends()` that has versions. Its engine is `setup.versions(backend)[0]`.
  - Failures that end with no offer: a failed network download, `notEnoughSpace` for the network, a cancel, and a backend with nothing after it.
- **Import.** The file must start with the gzip magic `1f 8b`. It is copied while hashing to `networks/imported-<first 16 hex of SHA-256>.bin.gz` and recorded with `imported: true`. Its name is the source file's stem, kept only in the record.

- **The test fixture** (`common/engine_zip.rs`):
  - `engine_zip(scenario: serde_json::Value) -> Vec<u8>` returns a deflate zip holding:
    - `katago` (or `katago.exe` on Windows), copied from `CARGO_BIN_EXE_aji-manager-fake-katago`;
    - `fake-katago-scenario.json`;
    - the M2 transcript `analysis.jsonl`.
  - The tests serve it from the Task 8 server, in a manifest built in code with `http://` URLs. They hand it to `Setup` through `ManifestStore::fixed(manifest: Manifest) -> ManifestStore`, a new constructor in `manifest/store.rs`.
    - The fixed store's source is `bundled`, and its `refresh` fetches nothing and returns `Ok(Source::Bundled)`.
    - `parse_manifest`'s https rule stays as it is. Only this in-code path skips it.
  - The hardware report is a synthetic Linux x64 machine with a GPU, so the recommendation is `opencl`, then `eigenavx2`, on every host OS.

- [ ] **Step 1: Write the failing tests** (`tests/install_job.rs`)

```rust
#[tokio::test] async fn installs_and_activates_an_engine()
    // outcome Installed; every row Done; installed.json active == {opencl engine, net};
    // configs/<e>+<n>.cfg has the thread count chosen from the fake's speeds; engine reaches ready
#[tokio::test] async fn a_backend_failure_offers_the_next_backend()
    // opencl scenario fails during benchmark with an outOfMemory line: Failed{OutOfMemory, offer: eigenavx2 engine};
    // active None; opencl engine and network recorded as components, no set
#[tokio::test] async fn accepting_the_offer_reuses_the_network()
    // a second start() for the offered engine: Installed; the network path was requested once in total
#[tokio::test] async fn a_failed_reinstall_keeps_the_active_engine()
    // after a success, a failing install of another engine: active unchanged; the engine runs the old files again
#[tokio::test] async fn a_network_download_failure_offers_nothing()      // 404 everywhere: Failed{DownloadFailed, offer None}
#[tokio::test] async fn an_unaccepted_licence_fails_before_downloading() // requests.is_empty(); offer Some
#[tokio::test] async fn not_enough_space_for_the_backend_offers_the_next()
#[tokio::test] async fn not_enough_space_for_the_network_offers_nothing()
#[tokio::test] async fn cancel_ends_the_job_and_keeps_part_files()      // stalling server; Cancelled; .part exists
#[tokio::test] async fn a_verified_download_is_reused_after_a_restart()
    // a complete verified file left in downloads/ by a "crash": a new Installer finishes with no request for it
#[tokio::test] async fn a_second_job_while_one_runs_is_busy()           // Err(StartError::Busy)
#[tokio::test] async fn the_benchmark_gets_the_manifest_overrides()
    // engine config {"onnxProvider": "directml"}, fake requireConfig the same: Installed
#[tokio::test] async fn a_runtime_folder_is_first_on_the_path()
    // engine with a runtime whose archive zip holds "bin/x.dll"; requirePathEntry = runtime id: Installed
#[tokio::test] async fn installs_from_a_root_with_cjk_and_spaces()      // root = tempdir/"数据 文件夹"
#[tokio::test] async fn progress_is_throttled_and_ends_with_the_outcome()
#[test] fn import_network_copies_a_gzip_file()                          // id "imported-<16 hex>", file in networks/
#[test] fn import_network_rejects_other_files()                         // Err(NotGzip)
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji-manager --test install_job`
Expected: FAIL.

- [ ] **Step 3: Implement `job.rs` and `import.rs`**

- [ ] **Step 4: Run every aji-manager test**

Run: `cargo test -p aji-manager`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/aji-manager
git commit -m "feat(manager): run an install job with progress, cancel, activation and fallback offers"
```

### Task 13: The app: settings, setup requests, progress events and startup

**Files:**
- Modify:
  - `src-tauri/Cargo.toml` (`tauri-plugin-dialog = "2"`)
  - `src-tauri/src/settings.rs`
  - `src-tauri/src/protocol.rs`
  - `src-tauri/src/service.rs`
  - `src-tauri/src/lib.rs`
  - `src/locales/en.json`, `src/locales/zh-CN.json`
- Create: `src/i18n/codes.test.ts`
- Test:
  - `src-tauri/src/settings.rs` and `service.rs` unit tests
  - `src-tauri/tests/ipc.rs`
- Regenerated: `src/transport/generated/*`

**Interfaces:**
- Consumes: `Installer`, `JobSnapshot`, `DownloadSource`, `FailureCode`, `load_installed`, `engine_files` and `InstallRoot` (Tasks 7 to 12).
- Produces:
  - `Settings` gains `download_source: DownloadSource` (default `Direct`) and `accepted_licences: BTreeMap<String, String>` (hash to RFC 3339 time).
  - `pub fn update_settings(path: &Path, f: impl FnOnce(&mut serde_json::Map<String, Value>)) -> Result<(), SettingsError>`. It keeps unknown fields and writes through a temporary file and a rename.
  - `AppContext` gains `installer: Arc<Installer>`, `settings_path: PathBuf`, `files: Arc<dyn FilePicker>` and `source: watch::Sender<DownloadSource>`.
  - `pub trait FilePicker: Send + Sync { fn pick_network(&self) -> Option<PathBuf>; }`. It is blocking and is called through `spawn_blocking`. The Tauri implementation uses `tauri_plugin_dialog` with a `*.gz` filter.
  - `pub fn startup_files(settings: &Settings, installed: &Installed, root: &InstallRoot) -> Option<EngineFiles>`. The order is `devEngine`, then `active`, then `None`.
- **Protocol:**

| Request | Response | Errors |
|---|---|---|
| `setupLicences { engine }` | `setupLicences { licences: LicenceInfo[], accepted: string[] }` | `setupUnknownEngine` |
| `setupInstall { engine, network, acceptLicences: string[] }` | `ok`, after recording `acceptLicences` in settings | `setupBusy`, `setupUnknownEngine`, `setupUnknownNetwork` |
| `setupCancel` | `ok` | |
| `setupStatus` | `setupStatus { job: JobSnapshot \| null }` | |
| `setupSetDownloadSource { source: DownloadSource }` | `ok`, after the settings write and the watch update | `setupInvalidSource` |
| `setupImportNetwork` | `setupImportNetwork { network: ImportedNetwork \| null }` (`null` when the dialog is cancelled) | `setupImportFailed` |

  Event: `setupProgress { job: JobSnapshot }`. New `ErrorCode`s: `setupBusy`, `setupUnknownNetwork`, `setupImportFailed` and `setupInvalidSource`.

- **Locale strings** (exact copy, added to both files):

| Key | en | zh-CN |
|---|---|---|
| `errors.setupBusy` | An install is already running. | 已有安装正在进行。 |
| `errors.setupUnknownNetwork` | That network is not in the list. | 列表中没有这个网络。 |
| `errors.setupImportFailed` | That file is not a KataGo network. | 该文件不是 KataGo 网络文件。 |
| `errors.setupInvalidSource` | A download source must be a web address starting with http:// or https://. | 下载源必须是以 http:// 或 https:// 开头的网址。 |
| `setup.failure.downloadFailed` | The download failed from every source. Check the network connection, or try another download source. | 所有下载源都下载失败。请检查网络连接，或换一个下载源。 |
| `setup.failure.checksumMismatch` | Every source gave a damaged or altered file, so Aji did not use it. | 所有下载源给出的文件都已损坏或被改动，Aji 没有使用它。 |
| `setup.failure.notEnoughSpace` | There is not enough free disk space for this install. | 磁盘空间不足，无法完成安装。 |
| `setup.failure.unpackFailed` | A downloaded package could not be unpacked. | 下载的安装包无法解压。 |
| `setup.failure.missingLibrary` | KataGo could not find a library it needs. | KataGo 找不到所需的运行库。 |
| `setup.failure.gpuDriverTooOld` | The graphics driver is too old for this backend. Updating the driver may fix this. | 显卡驱动版本过旧，无法使用此后端。更新驱动可能解决这个问题。 |
| `setup.failure.gpuError` | KataGo could not use the graphics card with this backend. | KataGo 无法通过此后端使用显卡。 |
| `setup.failure.outOfMemory` | The graphics card ran out of memory. | 显卡内存不足。 |
| `setup.failure.openclNoDevice` | No graphics card could be used through OpenCL. | 没有可以通过 OpenCL 使用的显卡。 |
| `setup.failure.licenceNotAccepted` | This backend needs a licence that has not been accepted. | 此后端需要的许可协议尚未接受。 |
| `setup.failure.timedOut` | KataGo took too long to answer. | KataGo 响应超时。 |
| `setup.failure.crashed` | KataGo stopped with an error. | KataGo 出错退出。 |

- [ ] **Step 1: Write the failing tests**

```rust
// settings.rs
#[test] fn the_download_source_defaults_to_direct()
#[test] fn update_settings_keeps_unknown_fields()     // {"devEngine": {...}, "future": 1}: both survive a write
#[test] fn a_missing_settings_file_is_created_by_an_update()
// service.rs
#[tokio::test] async fn setup_status_is_empty_before_any_job()
#[tokio::test] async fn setup_install_with_an_unknown_engine_is_an_error()   // code SetupUnknownEngine
#[tokio::test] async fn setting_the_download_source_writes_settings()
#[tokio::test] async fn an_invalid_download_source_is_rejected()            // Mirror{"ftp://x"} -> SetupInvalidSource
#[tokio::test] async fn accepted_licences_are_recorded_with_a_time()
#[test] fn startup_prefers_the_dev_engine_then_the_active_set()
// protocol.rs
#[test] fn setup_request_json_shapes()   // {"type":"setupInstall","engine":"e","network":"n","acceptLicences":[]}, …
#[test] fn setup_progress_event_json_shape()
```

```ts
// src/i18n/codes.test.ts
import type { ErrorCode } from '../transport/generated/ErrorCode';
import type { FailureCode } from '../transport/generated/FailureCode';
// Record<Union, true> fails typecheck when a code is missing, so the lists stay complete.
const ERROR_CODES: Record<ErrorCode, true> = { internal: true, /* … every code */ };
const FAILURE_CODES: Record<FailureCode, true> = { downloadFailed: true, /* … every code */ };
it('every error code has text in both locales', () => { /* errors.<code> in en and zh-CN */ });
it('every failure code has text in both locales', () => { /* setup.failure.<code> */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji && pnpm test`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - `lib.rs` startup:
    1. Load the settings and the record.
    2. Choose the files with `startup_files`.
    3. Build the `Installer` with its own download client, with no whole-request timeout and 15 s to connect (Task 12). Do not reuse the manifest client and its 10 s limit. Its `on_progress` emits `setupProgress`.
    4. Register `tauri_plugin_dialog::init()`.
  - The `aji://event` channel carries the new event. The UI store ignores it today; M5 reads it.

- [ ] **Step 4: Run every check**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && pnpm lint && pnpm typecheck && pnpm test && cargo deny check licenses`
Expected: all pass. The generated files are up to date (`git status src/transport/generated` shows only the intended changes).

- [ ] **Step 5: Commit**

```bash
git add src-tauri src/locales src/i18n/codes.test.ts src/transport/generated Cargo.lock
git commit -m "feat: setup install requests, progress events and the installed engine at startup"
```

### Task 14: The development trigger and the development docs

**Files:**
- Create: `src-tauri/src/dev_install.rs`
- Modify:
  - `src-tauri/src/lib.rs`
  - `docs/development.md`

**Interfaces:**
- Produces:
  - `pub async fn dev_install_request(value: &str, configured: bool, setup: &Setup, installer: &Installer) -> Result<Option<InstallRequest>, String>`:
    - `configured`, meaning a `devEngine` or an `active` set, gives `Ok(None)`;
    - `recommended` gives the default backend's newest engine and its preselected network;
    - any other value must be a backend name (`directml`, `opencl` and so on) that the recommendation lists;
    - the request accepts every licence the engine needs, for that job only. Nothing is written to `settings.json`.
  - `pub fn progress_lines(before: Option<&JobSnapshot>, now: &JobSnapshot) -> Vec<String>`: one log line per row whose state changed (not per byte), and one for the outcome. A failure's line includes the offer, for example `aji: install failed: outOfMemory; offer: directml (katago-v1.18.1-onnx…, 23584379 bytes)`.

- [ ] **Step 1: Write the failing tests** (`dev_install.rs`, with the bundled manifest and M3's synthetic reports)

```rust
#[tokio::test] async fn the_trigger_does_nothing_when_an_engine_is_configured()
#[tokio::test] async fn recommended_on_the_m5_picks_metal_and_the_top_network()
    // engine "katago-v1.18.2-metal-macos-arm64", network "kata1-tf3-b11c768-s12382M-d6533M"
#[tokio::test] async fn a_named_backend_picks_its_newest_engine()          // synthetic RTX 5070: "directml" -> 1.18.1 DirectML
#[tokio::test] async fn an_unlisted_backend_is_an_error()                   // "metal" on the PC report -> Err
#[tokio::test] async fn the_trigger_accepts_licences_for_its_job_only()    // cuda request: accepted has both NVIDIA hashes
#[test] fn progress_lines_report_changes_and_the_offer()
```

- [ ] **Step 2: Run them and see them fail**

Run: `cargo test -p aji dev_install`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `lib.rs`, after the context is managed: when `AJI_DEV_INSTALL` is set, the trigger runs on the async runtime. It builds the request, logs `aji: dev install <engine> with <network>`, starts the job, and logs `progress_lines` from the progress callback.

- [ ] **Step 4: Update `docs/development.md`.** New sections:
  - the install folders and `installed.json`;
  - `AJI_DEV_INSTALL` (`recommended` or a backend name, release builds included, licence acceptance for that job only);
  - which engine starts (`devEngine`, then the active set), and the `aji: starting KataGo <path>` line;
  - `downloadSource` in `settings.json`.

- [ ] **Step 5: Run every check**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && pnpm lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri docs/development.md
git commit -m "feat: a development trigger that installs the recommended engine"
```

### Task 15: Exit check and docs

- [ ] **Step 1: Every check on the Mac**

Run: `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace --no-fail-fast && pnpm lint && pnpm typecheck && pnpm test && cargo deny check licenses`
Expected: all pass.

- [ ] **Step 2: Prepare the Mac** (design 5.15). The data folder is `~/Library/Application Support/io.github.reallxuan.aji/`. On macOS it is also the config folder.
  - Copy `settings.json` to `settings.json.m4-backup`, and remove `devEngine` from `settings.json`.
  - Confirm `engines/`, `runtimes/`, `networks/`, `configs/`, `downloads/`, `staging/` and `installed.json` are absent. Move any that exist aside.

- [ ] **Step 3: Install on the Mac, with a kill mid-download**
  - Build with `pnpm tauri build --bundles app`.
  - Run `AJI_DEV_INSTALL=recommended target/release/bundle/macos/Aji.app/Contents/MacOS/aji 2>&1 | tee m4-install.log` from a terminal. Keep the log out of the repository.
  - While the network (262 MB) is downloading, kill the app with `pkill -9 aji`. Nothing is active yet, so the trigger still fires on the next start. Note the size of `downloads/*.part`.
  - Start it again the same way. The network continues from that size (the `.part` grows from it, and the finished file's `aji: downloaded` line shows fewer transferred bytes than its size), and the install finishes.
  - Expected:
    - lines for engine, network, benchmark and test query, ending `aji: install installed`;
    - one `aji: downloaded …` line per file;
    - `aji: starting KataGo …/engines/katago-v1.18.2-metal-macos-arm64/katago`;
    - candidates in the panel.
  - `ps -o command= -p $(pgrep -f engines/katago-v1.18.2-metal)` shows the same path.
  - Record the benchmark time and the chosen threads.

- [ ] **Step 4: Restart**
  - Quit, then start again without the variable. The log names the installed engine's path, and analysis appears.
  - Restore `settings.json` from the backup.

- [ ] **Step 5: The PC (optional, the owner's call)**
  - Run the CI `workflow_dispatch` for this branch only with the owner's OK, because it pushes the branch.
  - Install the Windows artifact, and start `aji.exe` with `AJI_DEV_INSTALL=recommended` from a console, logging to a file.
  - Expected: cuda (cuda13.2 on the RTX 5070) installs and analysis appears. Otherwise, the log shows a code and an offer of directml, and a restart with `AJI_DEV_INSTALL=directml` installs that.
  - Copy any CUDA or DirectML failure stderr into `crates/aji-manager/tests/fixtures/katago-errors/` as a real recording, and replace the synthetic patterns it confirms.

- [ ] **Step 6: D1.** The owner measures download speeds on a mainland network from the `aji: downloaded …` lines. Record the numbers in the roadmap's D1 row.

- [ ] **Step 7: Docs**
  - Mark M4 done in this plan's Status and in roadmap section 5 (M4), with what was checked and what is outstanding.
  - Commit `docs: mark M4 install pipeline done`.

- [ ] **Step 8: Still waiting on the owner** (from M3, each with the owner's OK):
  1. Push `aji-manifest` (`1773945` and Task 4's commit).
  2. Run `manifest.yml`.
  3. Check that the app's fetch reports source `fetched`.
  4. Check that a one-byte change to the cache falls back to the bundled copy.

## KataGo source findings (v1.18.2)

Read from KataGo's source at tag v1.18.2 (commit `fd0723f`) on 2026-11-20. Paths are under `cpp/`.

1. **Error text.**
   - **GPU errors from the neural-net thread.** These cover CUDA, cuDNN, cuBLAS, ONNX Runtime, Metal handles, and OpenCL buffers and kernels. They print `ERROR: NN server thread failed: <what>` to stderr (`neuralnet/nneval.cpp:399-404`). The process then ends in `std::terminate`, so `main` never catches them.
   - **CUDA wrappers** (`neuralnet/cudaerrorcheck.h:10,37,44`):
     - `CUDA Error, for <op> file <f>, func <x>, line <n>, error <cudaGetErrorString>`, and the same shape for `CUBLAS Error, for` and `CUDNN Error, for`.
     - The error text after `error` comes from NVIDIA's libraries, not KataGo's source.
     - `cudaMalloc` failures use the op names `Buffers` and `ScratchBuffers` (`cudaandrocmbackend.inc:4724-4771, 868`).
     - KataGo prints nothing of its own for a too-old driver or a missing CUDA device (`cudaandrocmbackend.inc:5099-5102`).
   - **OpenCL** (`neuralnet/openclhelpers.cpp`):
     - errors read `OpenCL error at <f>, func <x>, line <n>, error <name>` (88);
     - the names include `CL_MEM_OBJECT_ALLOCATION_FAILURE (possibly ran out of GPU memory?)` (19), `CL_OUT_OF_RESOURCES …` (20), `CL_OUT_OF_HOST_MEMORY` (21), `CL_DEVICE_NOT_FOUND` (16) and `CL_PLATFORM_NOT_FOUND_KHR` (77);
     - no device: `No OpenCL devices were found on your system. …` (503-506);
     - a failed tuning stage: `Tuning <stage> failed - could not find any working configuration` (`opencltuner.cpp:2647` and others).
   - **ONNX / DirectML** (`neuralnet/onnxbackend.cpp`):
     - a missing `onnxProvider` is fatal at startup (147-153);
     - `ONNX backend: DirectML execution provider is not available …` (681-682);
     - `ONNX backend: DirectML init failed: <ORT text>. …` (697-714);
     - `useFP16 = true` is fatal (215-219).
   - **Metal** (`metalbackend.swift`):
     - `Metal backend: Failed to create Metal device` (441) and `… command queue` (447);
     - `Metal backend: GPU error: …` (656-657, Swift `fatalError`);
     - then `Metal backend: Logic error - expected exactly one compute handle …` (`metalbackend.cpp:679-681`).
   - **A model that cannot load:** `Error loading or parsing model file <file>: <inner>` (`neuralnet/desc.cpp:2859-2860`).
   - **A missing DLL or dylib:** no KataGo text. The OS loader fails before `main`.
2. **Exit.**
   - On Windows, a main-thread exception prints `Uncaught exception: <what>` and returns 1 (`main.cpp:222-237`).
   - Elsewhere the C++ runtime terminates the process with its own message, which still carries the `what()` text.
   - Neither command sets an exit code for a failure on the neural-net thread.
3. **`homeDataDir`** (`program/setup.cpp:396-403`, `dataio/homedata.cpp`).
   - A relative value is used as-is against the working directory, and is created with a non-recursive `mkdir`, so its parent must exist.
   - It holds OpenCL tuning files (`opencltuning/`) and TensorRT's cache, nothing else. CUDA, ONNX and Metal ignore it.
   - Without it, Windows uses `<folder of katago.exe>/KataGoData`, and Unix uses `$HOME/.katago`.
4. **Config keys.**
   - (a) **Thread counts.**
     - Both commands require `numSearchThreads` (`setup.cpp:498-499`); `analysis` maps `numSearchThreadsPerAnalysisThread` onto it (`analysis.cpp:98`).
     - Setting both is fatal: `Cannot specify both numSearchThreadsPerAnalysisThread and numSearchThreads in the same config` (`config_parser.cpp:353-354`).
     - `analysis` also requires `numAnalysisThreads` (`analysis.cpp:100-105`) and `nnMaxBatchSize` (`setup.cpp:307-310`).
     - A missing key: `Could not find key '<k>' in config file <f>` (`config_parser.cpp:536`).
   - (b) **Unused keys.** `analysis` warns about them on stderr (`config_parser.cpp:459-479`). `benchmark` does not.
   - (c) **Logging.** No logging key is required. `analysis` logs to stderr by default (`analysis.cpp:112-114`), and `benchmark` logs to stdout (`benchmark.cpp:295-296`). Setting more than one of `logFile`, `logDir` and `logDirDated` is fatal (`logger.cpp:43`).
   - (d) **`benchmark` accepts `-override-config`** (`benchmark.cpp:224`).
   - (e) **`onnxProvider`** is required for ONNX builds. It takes `cpu`, `openvino`, `cuda`, `tensorrt`, `migraphx`, `coreml` or `directml`.
5. **Benchmark output** (`program/playutils.cpp:834-869, 976, 1008-1011`).
   - Progress lines are `\r`-prefixed with no newline: `numSearchThreads = %2d: <n> / <m> positions, visits/s = %.2f (%.1f secs)`.
   - The final line per count ends in a newline and adds `nnEvals/s`, `nnBatches/s` and `avgBatchSize`. It also adds `(EloDiff …)` when shown with Elo.
   - The `Ordered summary of results:` block exists only when the counts are auto-tuned (`benchmark.cpp:909-913`).
   - `-no-server-thread-test` and `-no-half-batch-size-test` skip the extra tests (`benchmark.cpp:210-211`). Those tests start with `Running additional tests of a few other settings`.
6. **Default device with no device key** (`setup.cpp:202-239`).
   - CUDA uses device 0.
   - OpenCL scores the devices and prefers AMD or NVIDIA GPUs over Intel, and GPUs over CPUs (`openclhelpers.cpp:407-497`).
   - ONNX/DirectML uses device 0, whichever adapter ONNX Runtime puts first (`onnxbackend.cpp:686`).
   - Metal uses the system default device.
   - So only DirectML can pick a laptop's integrated GPU, which matches design section 7.
