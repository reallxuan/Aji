# M4 Install Pipeline Design

- Date: 2026-11-20
- Status: Approved by the owner on 2026-11-20
- Specs: [project charter](2026-11-19-aji-project-charter-design.md) sections 3, 6.1, 6.3, 6.6 and 6.8; [interface design](2026-11-19-aji-ui-design.md) section 7; [Phase 1 roadmap](../plans/2026-11-19-phase-1-roadmap.md) sections 3.3, 5 (M4) and 6 items 1 to 3; [R1: NVIDIA runtime](../../research/r1-nvidia-runtime.md) sections 6 and 7; [M3 plan](../plans/2026-11-19-phase-1-m3-manifest-hardware.md), Deferred items carried.
- Markers follow the charter: **[Decided]** by the owner, **[Proposed]** while drafting, **[To verify]** needs a test on a real machine.

## 1. Intent

M3 taught Aji what the machine is and what to install there. M4 makes Aji install it, with nobody watching: download the engine, the NVIDIA runtime where one is needed and the network; check every file; unpack; benchmark; write a config; run a test query; and, when a backend does not work, say why and offer the next one. The result is recorded, and the active engine starts with the app.

This is the half of "easier to set up" (charter section 1) that LizzieYzy never had. The wizard that drives it is M5. M4 delivers the machinery and the protocol the wizard calls, plus a development trigger to prove it on the real machines.

## 2. Goals, non-goals, anti-goals

**Goals**

- One request installs an engine set (engine, runtime if any, network) and makes it active once it passes its benchmark and test query.
- Downloads survive a mainland network: several URLs, a configurable download source, resume after a drop, and a checksum on every file (roadmap section 6 item 2).
- A failure is named by a code with plain-language text in `zh-CN` and `en`. The next backend is offered with its download size, and installed only if the user agrees (roadmap section 6 item 3).
- A half-installed engine is never marked usable, and the engine that was active stays active when a later install fails.
- Every step is tested in CI without a GPU and without the internet.

**Non-goals for M4**

- The wizard and any other new interface. M4 adds no screen. The protocol and the failure texts are ready for M5.
- Removing old engine versions or freeing disk space after a backend change. This belongs with "run engine setup again" in M5 settings.
- TensorRT (M3 ruling R5), update notices (Phase 8), several engine profiles (Phase 2).
- Naming a third-party download proxy inside Aji. That waits for the owner's decision D1.

**Anti-goals** (charter section 2)

- Telling the user to install CUDA or cuDNN themselves.
- Changing the system: no system `PATH` edits, no files outside Aji's own folders, no admin rights.
- Re-hosting NVIDIA files, or sending an NVIDIA download through any host but NVIDIA's two (R1).

## 3. Owner decisions (2026-11-20)

| Item | Decision |
|---|---|
| First install on NVIDIA | **[Decided]** CUDA straight. Aji installs the CUDA engine, the NVIDIA runtime (1.95 GB for the CUDA 13.2 set, whole archives) and the network, then benchmarks and tests it. R1 section 6.1's "DirectML first, CUDA behind it" is not built. |
| When a backend fails | **[Decided]** Aji asks the user before installing a fallback. It does not install one on its own. If CUDA fails, the install stops, says why, and asks whether to install DirectML (24 MB, reusing the network already downloaded). **[Proposed]** The same holds for every fallback (for example DirectML to OpenCL, or ROCm to DirectML) and for a declined NVIDIA licence. |
| Where the pipeline lives | **[Decided]** In `aji-manager`, which now depends on `aji-engine` (and through it `aji-core`). M3's rule that `aji-manager` depends on no workspace crate is dropped. CLAUDE.md requires that only of `aji-core`, and `aji-engine` never depends on `aji-manager`, so there is no cycle. |

## 4. Approaches considered

### 4.1 First install on NVIDIA

| | A. DirectML first, CUDA behind it (R1 6.1) | B. CUDA straight (chosen) |
|---|---|---|
| First analysis | Within a minute or two | After 1.95 GB from NVIDIA, plus the benchmark |
| Moving parts | Two installs, a background download during analysis, a live switch, analysis paused during the CUDA benchmark | One install; on failure, the user is asked about the fallback |
| What the Mac can test | All of the orchestration, with the fake KataGo | The same |
| What only the PC can test | Whether CUDA loads on the RTX 5070, and its speed | The same |

The owner chose B. The install unit is still "one engine set: install, verify, record, activate", so A could be added later as two units in a row.

### 4.2 Where the pipeline lives

1. **In `aji-manager`, using `aji-engine` for KataGo (chosen).** One crate owns everything the charter's diagram calls the engine manager (downloads, config, benchmarking), and the whole pipeline is tested headless.
2. Pieces in `aji-manager`, sequencing in `src-tauri`. Keeps M3's dependency rule, but puts the hardest logic (fallback, cancel, progress, never activating a half install) where tests pull in Tauri.
3. A new `aji-install` crate above both. Tests as well as 1, but splits the engine manager across two crates.

## 5. Design

### 5.1 Crates

- `aji-manager` gains an `install` module: download, unpack, layout, benchmark, config, smoke test, failure classification, the installed-engines record, and the job that runs them.
- `aji-engine` gains three things every approach needed:
  - `EngineFiles` carries the runtime folders to put first on KataGo's own `PATH`. This applies to the analysis process, the benchmark and the test query. The system `PATH` is never changed (R1 6.3).
  - A public way to run a one-shot KataGo command (the benchmark) through the existing spawner, so the Windows job object and the Linux parent-death signal protect it too. On macOS a benchmark dies at its next write once Aji is killed; this was checked on the Mac on 2026-11-20, where it exited about 1 s after its parent got `SIGKILL`.
  - `Engine` can switch to new files while it runs: stop KataGo, take the new files, start again, keeping the current position. Activation after an install uses it.
- `src-tauri` wires the requests and the progress event, owns `settings.json`, and switches the running engine on success.

### 5.2 Files on disk

All install files live under `app_local_data_dir` (roadmap 3.3), because the NVIDIA runtime is large and must not roam:

```
<app_local_data_dir>/
  engines/<engine id>/       unpacked KataGo package
  runtimes/<runtime id>/     the NVIDIA DLLs, flat in one folder
  networks/<file name>       as downloaded (.bin.gz); KataGo reads it directly
  configs/<engine id>+<network id>.cfg   Aji's generated analysis config
  katago-home/               KataGo's homeDataDir (OpenCL tuning files)
  downloads/                 .part files, kept for resume
  staging/                   unpack area, on the same volume as the final folders
  installed.json             the installed-engines record (5.9)
  manifest/                  M3's manifest cache
```

- KataGo runs with this root as its working directory. Config, model and `homeDataDir` are passed as relative paths, so a non-ASCII profile path stays off its command line (roadmap 3.3, review focus 1). The program path stays absolute, as in M2.
- Folder names come from manifest ids and file names. Those are checked before any write (5.4).
- An imported network is stored as `networks/imported-<first 16 hex of its SHA-256>.bin.gz`. The user's file name, which may be non-ASCII, never reaches KataGo.
- The NVIDIA archives are deleted once the runtime folder has been renamed into place and recorded as a verified component (5.9). That happens before the benchmark, so the archives go whatever happens to the job afterwards. A cancel or crash before that point keeps them for the next try. The DLLs themselves stay. **[Proposed]**

### 5.3 Downloads

- **Download source**, a setting. The downloader reads it at every new connection, so a change takes effect without restarting the job (5.11):
  - `direct` (the default): the manifest's URLs in order.
  - `prefix <url>`: a GitHub acceleration prefix put in front of `https://github.com/` URLs (KataGo's and Aji's Metal releases). The prefixed URL is tried first, then the plain ones.
  - `mirror <base url>`: `<base>/<file name>` is tried first for engine and network files, then the manifest's URLs.
  - NVIDIA archives never get a prefix or mirror. Their hosts are tried in manifest order, `developer.download.nvidia.com` and then `.cn` (R1).
  - No proxy is named inside Aji. Which ones the M5 selector offers waits for D1. **[Proposed]**
- **Resume.** Bytes go to `downloads/<name>.part`. A retry or a restart of Aji sends `Range: bytes=<n>-`. A `206` with a matching `Content-Range` appends. A `200` means the server ignored the range, so the file starts over. Any URL may continue any `.part`, because the digest identifies the content, not the host.
- **Checksum.** SHA-256 or MD5 (networks) is computed while streaming. On resume, the existing bytes are hashed first. After a resume, a mismatch first retries the same URL from zero, because the bad bytes may have come from an earlier host. A mismatch on a download from zero deletes the `.part` and moves to the next URL. A body longer than the manifest size is cut off and treated as a mismatch.
- **Stalls and retries.** A connection that sends nothing for 30 s is dropped. Each URL gets a few attempts with backoff before the next URL. The exact numbers are left to the plan. **[Proposed]**
- **Free space**, checked per job (one job installs one engine set, 5.8). **[Proposed]**
  - Before the first byte, the job compares what it still needs with the free space on the data volume, and fails with `notEnoughSpace` when it does not fit. What it needs is the remaining download bytes plus an estimate of the unpacked sizes plus a margin.
  - The manifest carries only compressed sizes, so the estimate is a multiple of them. For example, cuBLAS 13's 388 MB archive holds 507 MB of the DLLs Aji extracts.
  - Once an archive is downloaded, its zip central directory gives the exact uncompressed sizes of the entries to extract. The check runs again with those before unpacking.
  - No manifest schema change is needed. The probe is injectable for tests.
- **Progress** is reported per task, throttled to about 4 updates per second.
- **Cancel** stops the job at once. `.part` files stay for the next try, and nothing becomes active.

### 5.4 Path checks and unpacking

- **First task of M4** (M3 review): `parse_manifest` checks every name that becomes a file or folder name.
  - It rejects `/`, `\`, `..`, absolute paths and drive prefixes in `file.name`, `extract` patterns and the ids.
  - `archive.path` is a URL path under an NVIDIA host, so its `/` separators are legitimate. It must be relative, with no empty, `.` or `..` component and no `\`. Its last component becomes the file name.
  - It checks that `textSha256` is hex.
  - A test pins that the bundled manifest still parses.
- **Zip only.** Every engine and runtime in the manifest is a `.zip` (51 of 51, checked 2026-11-20), so `.tar.gz` is dropped from the roadmap item. `zip` is used with `deflate` only (M3 licence finding).
- **Entry names are checked too**, not only manifest fields. An entry that would land outside the staging folder fails the install (`unpackFailed`), so a malicious archive cannot write elsewhere.
- **Engines** unpack into `staging/<random>/`. The folder then moves to `engines/<engine id>/` in one rename. On macOS the `katago` binary gets its executable bit. Aji also checks for a `com.apple.quarantine` attribute and removes it if present. Files downloaded by Aji's own HTTP client are not expected to carry one. **[To verify]**
- **NVIDIA archives** have only their `extract` patterns taken out, flattened into `staging/<random>/`, then renamed to `runtimes/<runtime id>/`.
- An engine package, runtime or network already recorded as a verified component (5.9) is reused, not downloaded again. A folder that exists but is not recorded (left by a crash between the rename and the record) is deleted and installed again.

### 5.5 Benchmark

- Runs `katago benchmark` with fixed thread counts (`-t`), fewer visits and positions than KataGo's default (`-v`, `-n`), and KataGo's optional extra tests switched off.
- **Budget.** KataGo's default is 800 visits × 10 positions. The preselected network runs at about 51 visits/s on the M5, so the default would take about 157 s per thread count, roughly 8 minutes for three. M4 aims for about 2 minutes on the M5 with that network. **[Proposed]** CPU backends get a smaller budget still, because they are far slower. The plan sets the visits, positions and candidate thread lists per backend from the recorded fixtures and, if it arrives in time, the PC run.
- **Parser.** It reads the `Ordered summary of results` block. When the run was cut short, it falls back to the last complete line per thread count (fixtures: `1.18.2-metal`, including the truncated `partial` file). Progress lines are joined by `\r`.
- **Choice.** The smallest thread count that reaches 95% of the best visits/s (roadmap). Within-run noise is about ±5% (fixtures), so near-ties go to fewer threads, which KataGo's own notes favour for analysis.
- **OpenCL tuning** happens inside the benchmark's first model load and is written to `katago-home/`, so the first analysis is not slow.
- The benchmark has no total time limit, only a stall limit: no output for several minutes fails it as `timedOut`. OpenCL tuning prints progress, so a long tune is not a stall.
- The result (threads, visits/s per count) is kept with the install. M7's engine indicator shows the visits/s.

### 5.6 Config generation

- Aji's own analysis config template, compiled into `aji-manager`. It never copies KataGo's example configs (roadmap).
- Search threads come from the benchmark: `numSearchThreadsPerAnalysisThread` is the chosen count. `numAnalysisThreads` is 1 in Phase 1, where one position is analysed at a time. Phase 2's whole-game analysis revisits this. **[Proposed]**
- `homeDataDir = katago-home`, and no log file (Aji already forces `logToStderr` on the command line).
- The engine's manifest `config` map is applied last (for example `onnxProvider = directml`).
- **No GPU device keys** (`cudaDeviceToUse`, `onnxDeviceToUse` and the like) in M4. **[Proposed]**
  - CUDA counts only NVIDIA cards, so a single NVIDIA card is device 0.
  - The known gap is DirectML on a laptop whose integrated GPU comes first: KataGo may run on the integrated GPU. It still works, just slowly, so no fallback fires. Neither test machine can show this. It is recorded in section 7.
- `benchmark` reads GTP-style keys (`numSearchThreads`), not the analysis engine's. So the benchmark gets its own small generated config. It has the same model-related keys, `homeDataDir`, and the engine's manifest `config` map: KataGo's ONNX builds will not run without `onnxProvider`, so a DirectML benchmark would fail without it. The fake KataGo's benchmark mode fails when a required manifest override is missing, so CI catches this.

### 5.7 Test query

- Starts the installed engine through `aji-engine` with the generated files and asks for 50 visits on the empty 19×19 board. It passes when candidates come back. It runs on the same KataGo binary, PATH and config the app will use.
- Timeout about 5 minutes. A first CUDA load may compile kernels through NVRTC, and TensorRT engine builds are not in Phase 1. **[Proposed]**

### 5.8 Failures and fallback

- **Codes.** Each failure becomes one code, from the step that failed, the exit status and the stderr tail:
  - `downloadFailed` (every URL failed), `checksumMismatch` (every URL gave a bad file), `notEnoughSpace`;
  - `unpackFailed`;
  - `missingLibrary` (a DLL not found, Windows exit 0xC0000135);
  - `gpuDriverTooOld`, `gpuError` (CUDA, DirectML, Metal or OpenCL initialisation);
  - `outOfMemory`;
  - `openclNoDevice`;
  - `licenceNotAccepted`;
  - `timedOut`, `crashed` (anything else, with its stderr kept), `cancelled`.
- **Where the patterns come from.** Never from memory (roadmap M0). **[Proposed]**
  - Recorded stderr comes first. Today the repository holds one recorded failure, the Metal missing-model run (`crates/aji-engine/tests/fixtures/katago/1.18.2-metal/bad-model.jsonl`).
  - Where nothing is recorded, a pattern may be taken from the error strings in KataGo's own source at v1.18.2 (MIT). Each such pattern cites the file and line, and stays **[To verify]**.
  - The fake KataGo's scripted failures print text copied from those same source strings. Its fixture `SOURCE.md` labels that text synthetic.
  - Windows exit 0xC0000135 (DLL not found) and the timeouts need no text pattern.
  - Real recordings replace synthetic ones when they arrive, from the owner's PC run (`scripts/benchmark-windows.ps1`) or the PC exit check. M4 does not wait for them.
  - Output that matches nothing becomes `crashed`, with the stderr tail kept.
- **Text.** Every code gets plain-language text in `zh-CN` and `en` in M4. The code and its explanation are written together. M5 shows them.
- **Fallback is offered, never automatic** (owner decision, section 3). A job installs one engine set and stops at its first failure.
  - **A failure tied to the backend** ends the job with a **fallback offer**: the next backend after the failed one in the recommendation's fallback list (charter 6.3), with its newest engine and its download size. Such failures are:
    - its engine or runtime download;
    - the benchmark or the test query;
    - `notEnoughSpace` for that backend's files (the CUDA set needs several GB during install: 1.95 GB of archives plus the extracted DLLs; DirectML needs tens of MB);
    - `licenceNotAccepted`, which is reported without downloading anything for that backend.
  - **The user's yes** is a new `setupInstall` for the offered engine. The network and any other verified component are reused, not downloaded again. A no leaves the job's result as it is. Nothing becomes active, and the previous active engine, if any, stays.
  - **A failure no backend can fix** ends the job with no offer: the network download, `notEnoughSpace` for the network itself, and `cancelled`.
  - **No offer** is made when the failed backend has no fallback left (Metal on the Mac, or the last CPU build).
  - The result carries the failed backend, its code, the stderr tail when there is one, and the offer. M5 can then say "CUDA did not work (reason). Install DirectML (24 MB) instead?"

### 5.9 The installed-engines record and activation

- `installed.json` in `app_local_data_dir` has two levels. **[Proposed]**
  - **Verified components:** engine packages, runtimes and networks. Each is recorded as soon as its checksum has passed and its folder or file is in its final place. A failed job therefore leaves its components recorded, so a retry after a driver update downloads nothing again. M5 settings can remove unused components.
  - **Usable engine sets:** an engine, its runtime, a network, the generated config and the benchmark result. A set is recorded only after its test query passes.
  - `active` names a usable set.
- **Why not `settings.json`** (a change from the roadmap's "engine registry in settings"): on Windows the config directory is the roaming profile and the data directory is local. A roaming record would point at engines that are not on another PC. **[Proposed]**
- Every write goes to a temporary file that is then renamed over the old one. A crash or a cancel before a set's test query passes may add verified components, but never adds a usable set or changes `active`. The previous active engine is untouched.
- At startup the engine to run is chosen in this order: M2's `devEngine` override (kept until M5 removes it from the user path), then `active` from the record, then none (`notConfigured`). Every launch logs KataGo's program path, so it is always clear which binary runs.
- On success, `src-tauri` switches the running engine to the new files. The M2 candidate list shows the new analysis without a restart.
- **GPU contention.** While a job benchmarks or runs its test query, any running engine is stopped, so the numbers are not skewed. If the job fails, the previous engine starts again.

### 5.10 Settings

`settings.json` (roaming) gains:

- `downloadSource` (5.3).
- `acceptedLicences`: a map from a licence's `textSha256` to the time it was accepted (R1 section 7). When NVIDIA changes the text, its hash changes and acceptance is asked again.

Aji now writes `settings.json`. A write keeps the fields Aji does not know (M5 and hand edits), and goes through a temporary file and a rename.

### 5.11 Protocol

Requests:

- `setupLicences { engine }` lists the licences that installing `engine` needs: name, URL, `textSha256`, and whether it is already accepted. Fetching and showing the licence text is M5.
- `setupInstall { engine, network, acceptLicences }` starts a job. `network` is a manifest network id or an imported one. `acceptLicences` lists hashes the user just accepted, which are recorded first. A second job while one runs gives `setupBusy`.
- `setupCancel`.
- `setupSetDownloadSource { source }` writes `downloadSource` (5.10). The interface design puts the source selector on the install step, where a slow download is noticed. So a change during a job drops the current connection, and the `.part` file continues from the new source. **[Proposed]**
- `setupStatus` returns the current or last job snapshot. A UI that opens late, or a Phase 3 remote client, can catch up. This avoids depending on the order of subscribe and status (M2 review N4).
- `setupImportNetwork`: the backend opens the native file dialog, copies the file in, checks that it is a gzip file, and records it as an imported network. No path crosses the boundary (charter 6.1, roadmap 3.1).

Event:

- `setupProgress { job }` carries the whole job snapshot, throttled: the backend, one row per task, and at the end the result with any fallback offer (5.8). The tasks are engine, runtime, network, benchmark and test query (interface design 7, step 5). Each row is waiting, running with done and total bytes, done, skipped or failed with a code. A full snapshot per event keeps the UI simple and lets a late or reconnecting client recover.

New error codes: `setupBusy`, `setupUnknownNetwork`, and the failure codes of 5.8 inside job snapshots.

### 5.12 The development trigger

- Starting the app with `AJI_DEV_INSTALL=recommended`, when no engine is configured, installs the recommendation's default backend, the newest version and the preselected network.
  - `AJI_DEV_INSTALL=<backend>` (for example `directml`) installs that backend's newest version instead. A failure logs its code and the fallback offer, and the trigger stops there, because it cannot ask. Answering yes means starting again with the offered backend named. "Configured" means a `devEngine` setting or an `active` set. The trigger does nothing when `devEngine` is set.
  - Setting the variable accepts any licence that install needs, for that job only. **[Proposed]** The acceptance is not written to `settings.json`, so M5's wizard still shows NVIDIA's licence and asks.
  - Progress goes to stderr. When the job finishes, the M2 candidate list shows analysis.
- It works in release builds, so the PC can use a CI-built installer without a Rust toolchain. It has no interface text. It is removed when the M5 wizard replaces it.

### 5.13 Folded-in review items

- **From M3, needed before the first file is written:** the path checks (5.4).
- **From M3, in this work:**
  - `refresh` returns `Result<Source, FetchError>` and logs the error.
  - `Source` serialises in lowercase.
  - Concurrent refreshes cannot replace a higher sequence with a lower one, and the cache uses unique temporary names.
  - CUDA thresholds are read from the runtime's `minDriver` and `minComputeCapability`.
  - `#[ts(skip)]` on the `Unknown` variants.
  - Probe fixes:
    - the `System32` `nvidia-smi` retry runs only on NotFound;
    - probe errors are logged;
    - Linux finds NVIDIA by PCI display class.
  - Generator checks: network hrefs must have the models prefix, and the release `prerelease` and `draft` flags are read.
  - `http_client` returns a `Result`.
  - CI verifies the manifest against `TRUSTED_KEYS`.
  - `status_carries_the_latest_analysis` is made non-flaky.
  - The missing tests the M3 review listed.
- **From M2:**
  - a deadline after killing an unkillable KataGo (N1);
  - a throttle tolerance, admitting at about 90% of the report interval (N3);
  - startup-timeout tuning for slow first loads.

### 5.14 Testing

- **A local HTTP test server** with Range support, used for:
  - resume;
  - a server that ignores Range;
  - a bad checksum on the first URL, then a good second one;
  - a 404 on the first URL;
  - a stall;
  - cancellation;
  - not enough disk space, through the injected probe;
  - the prefix and mirror rules, including that NVIDIA URLs are never rewritten.
- **The fake KataGo** gains a `benchmark` mode that replays the recorded benchmark output. It also gains scripted failures: a missing library, out of memory, a crash mid-benchmark, and a test query that never answers.
- **End-to-end:**
  - The test server serves a zip containing the fake KataGo and a fake network. One job then downloads, verifies, unpacks, benchmarks, configures, runs the test query and records the engine as active.
  - A second scenario fails the first backend at its benchmark.
    - The job must end with the failure code and an offer of the next backend, and nothing may become active.
    - A second job for the offered engine must succeed and become active, without downloading the network again.
    - The first backend's components must stay recorded as verified, but not as a usable set.
  - A third checks that a failed reinstall leaves the old active engine in place.
- **Windows CI:** the install runs from a data folder with CJK characters and spaces (review focus 1), and the fake KataGo checks that the runtime folder is first on its `PATH`.
- Everything above runs on all three CI runners, with no GPU and no internet.

### 5.15 Exit check

- **Mac** (a local release build):
  - **Preparation.** On macOS the config folder and the local data folder are the same (`~/Library/Application Support/io.github.reallxuan.aji/`), so the folder is not emptied.
    - The Mac's `settings.json` has a `devEngine` pointing at Homebrew's KataGo 1.18.2 Metal. That KataGo would be indistinguishable from the installed one, so `devEngine` is taken out for the check and put back after it.
    - The install folders and `installed.json` start absent.
  - `AJI_DEV_INSTALL=recommended` installs the Metal engine and the preselected network, benchmarks, writes the config, passes the test query, and analysis appears.
  - **Proof of the binary.** The log names KataGo's program path under `engines/`, and `ps` shows the same path.
  - Quitting and starting again starts the installed engine with no variable set, again proven by the logged path.
  - Killing Aji mid-download and starting again resumes the `.part` file.
- **PC:** optional, as for M1 to M3. It is the only machine that can show CUDA working, its real failure output, and the DirectML fallback. Run it with a CI-built installer from a manual workflow run, plus the variable. The owner decides at the exit.
- **D1:** the owner measures download speeds on a mainland network. The job log prints the time and bytes per file.

## 6. Left to the builder

- Module layout inside `install`, and the choice of HTTP test server and free-space crate. Licences must pass `cargo deny`.
- Retry counts, backoff, stall limits and timeouts, within the bounds above.
- How `aji-manager`'s tests find the `fake-katago` binary built by `aji-engine`. Cargo gives `CARGO_BIN_EXE_*` only within one package.
- The exact benchmark budget and thread lists per backend, from the fixtures.
- Exact field names of the protocol types, following M2 and M3's conventions (camelCase JSON, `#[ts(type = "number")]` for byte counts).

## 7. Risks and unknowns

- Windows failure patterns for CUDA and DirectML are unrecorded (5.8). Until they are, unknown output still leads to the fallback offer, but under the generic `crashed` text.
- The first CUDA load time on the RTX 5070 is unknown, and the 5-minute test-query timeout is a guess.
- The quarantine flag on macOS (5.4) and Unicode in the child's `PATH` on Windows (5.1) are **[To verify]** on the real machines.
- On a laptop whose integrated GPU comes first, DirectML may run on that GPU (5.6). Roadmap review focus 3 names this case. M4 does not set a device, and the case is left to M8, or to a laptop if one becomes available.
- 1.95 GB from NVIDIA on a mainland link may take a long time. With CUDA straight, the user sees no analysis until it finishes. The owner accepted this trade-off (section 3).

## 8. Departures from the roadmap

Once this design is approved, roadmap section 5 (M4) is edited to match:

- **The M4 exit wording changes.** The roadmap says the next backend is "offered", which this design keeps (owner decision, section 3). But its exit line says fallback works "unattended", and that becomes "is offered".
- **Charter 6.3 needs an edit.** It says Aji "tries the fallback backend". With the owner's agreement, that becomes "offers the fallback backend". Charter 6.6 ("offer restart engine and switch backend") already fits.
- **`.tar.gz` is dropped.** Every archive in the manifest is a zip (5.4).
- **The installed-engines record is `installed.json` in the local data folder**, not part of `settings.json` (5.9).
- **The benchmark budget is smaller than KataGo's default** (5.5).
- **Three new requests:** `setupLicences`, `setupStatus` and `setupSetDownloadSource` (5.11).
- **One review focus case moves out.** The laptop with the integrated GPU listed first (review focus 3) leaves M4, because M4 sets no GPU device (5.6, section 7).
