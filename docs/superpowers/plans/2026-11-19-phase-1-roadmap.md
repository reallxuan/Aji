# Phase 1 Development Plan: Engine Manager and Basic Analysis

- Date: 2026-11-19
- Status: Draft for the owner's review
- Specs: [project charter](../specs/2026-11-19-aji-project-charter-design.md) (source of truth), [interface design](../specs/2026-11-19-aji-ui-design.md)
- Markers follow the charter: **[Decided]**, **[Proposed]**, **[To verify]**.

This is the phase-level plan. It splits Phase 1 into milestones, orders them, and names what each one must prove before the next starts. Each milestone gets its own detailed implementation plan (TDD steps, exact interfaces) when it starts, so that plan can use what earlier milestones and research spikes found. Written so far: [M1 Foundation](2026-11-19-phase-1-m1-foundation.md), [M2 Analysis walking skeleton](2026-11-19-phase-1-m2-analysis-skeleton.md), [M3 Manifest, hardware detection, recommendation](2026-11-19-phase-1-m3-manifest-hardware.md) and [M4 Install pipeline](2026-11-20-phase-1-m4-install-pipeline.md).

## 1. What Phase 1 must deliver

**Acceptance (charter section 8, verbatim):** on the Windows PC with the RTX 5070, going from downloading the installer to seeing analysis results takes no command line, no manual download and no config editing. The same holds on the development Mac.

**The two acceptance machines [Decided].** In this plan "the PC" is the Windows PC with the RTX 5070. "The Mac" is the development Mac: a MacBook Pro with an Apple M5 (10-core GPU, 24 GB unified memory, macOS 27). Every milestone exit is checked on both.

**In scope** (charter sections 7 and 8, interface design section 9):

- Tauri skeleton; CI runs checks on every push and builds installers for Windows, macOS and Linux on every push to `main`, or on demand for any branch.
- Manifest repository and format. First entries: Windows NVIDIA, Windows generic (DirectML, OpenCL), macOS Metal, CPU (Eigen), plus Linux Eigen and OpenCL.
- Hardware detection, backend recommendation, download, verification, benchmark, smoke test, fallback on failure.
- First-run wizard (interface design section 7).
- Board display, opening and saving SGF, recent files, drag and drop, navigation (buttons, keyboard, wheel, jump to move number).
- Live candidates on the board with win rate, score lead and visits; hover a candidate to show its variation, with replay; start and pause analysis.
- Light and dark themes (moved into Phase 1 by interface design section 9), high-DPI, Simplified Chinese and English.
- The UI–engine boundary of charter section 6.1, from the first line of code.

**Out of scope for Phase 1 [Proposed, see decision O1]:** the trend graph, the variations section and the letter badges that go with it (interface design 4.4 and 5.4), clicking the board to play a move, and the sortable candidate list. The interface design draws the full main screen, but the charter puts the winrate graph, variation tree, try-out and candidate list panel in Phase 2. Phase 1 builds the header row, win-rate bar, candidate table and board. The trend graph and variations sections are left out, not stubbed.

## 2. Decisions for the owner

Only O3 is needed before M1 starts, because Task 1 writes the identifier into the app. Each of the others names the milestone that needs the answer.

| ID | Decision | Proposed default | Needed by |
|---|---|---|---|
| O1 | Main-screen scope in Phase 1: follow the charter's phasing (section 1 above) or build everything the interface design draws | Follow the charter | M7 |
| O2 | Where the game record lives: in the Rust backend as a game session, with the UI receiving snapshots; or in the UI, with `aji-core` compiled to WebAssembly | Rust backend (section 3.1) | M6 |
| O3 | Bundle identifier. It becomes part of the data-directory path on every OS and is costly to change after release | `io.github.reallxuan.aji` | M1 |
| O4 | Which network the wizard preselects (interface design 7, open item) | **Decided 2026-11-19:** keep Elo order and preselect the top row, the highest-rated network on katagotraining.org that the chosen engine can load, on every machine; no GPU tiers and no local measurement | M3 |
| O5 | Sign the manifest so a mirror cannot swap checksums | **Decided 2026-11-19:** minisign (Ed25519) signature made in the manifest repository's CI from a secret the owner created; public key built into Aji, with room for a second key | M3 |
| O6 | Chinese font size (interface design 3, open item) | Subset LXGW WenKai to GB2312 plus every character in the `zh-CN` locale, WOFF2, Regular and Medium; characters outside the subset fall back to the system Chinese font | M5 |
| O7 | Failure states, settings, and the opened game library are not drawn | Designs for failure states and minimal settings are proposed at the start of M5 and shown to the owner before they are built; the library stays closed in Phase 1 (title shown, chevron inert) | M5 |
| O8 | App icon | Tauri's placeholder until the owner supplies one | M8 |

## 3. Architecture decisions for Phase 1

These are **[Proposed]**. Each detailed plan restates the parts it uses.

### 3.1 Game state lives in the backend

The game record (tree, current node, board positions) lives in a `GameSession` held by the Rust side, built on `aji-core`. The UI sends commands (`game.open`, `game.navigate`, `game.preview`) and renders the snapshots it gets back. The engine side follows the current node by itself, so navigation does not need a separate analysis request.

Why: one implementation of SGF and rules, in Rust. Later phases (play against the AI, engine matches, board sync) have the backend produce moves, which fits a backend-owned game. The cost is one round trip per navigation step, about a millisecond locally. Remote clients pay network latency, which Phase 3 measures.

These three rules keep a later move to WebAssembly possible:

- `aji-core` stays pure: no file system, no async runtime, no OS calls, and no dependency on another workspace crate.
- Messages never carry file paths. Files travel as bytes or text. Where a desktop-only feature needs a file (importing a network), the backend opens the native dialog itself.
- Every query that `aji-engine` accepts carries a self-contained position: board size, rules, komi, setup stones and moves.

The alternative (O2) is `aji-core` compiled to WebAssembly, with the tree held in the UI.

### 3.2 One protocol, one dispatcher

- All requests go through a single Tauri command, `rpc(request) -> Result<Response, ProtocolError>`. All engine-side events go through one event channel, `aji://event`. Phase 3's WebSocket server carries the same JSON values and calls the same dispatcher.
- `Request`, `Response`, `AppEvent` and `ProtocolError` are Rust enums and structs with serde. TypeScript types are generated from them with `ts-rs` into `src/transport/generated/`. CI fails if the generated files are stale.
- The dispatcher (`service::handle`) does not depend on Tauri, so it is tested without a webview.
- Errors carry a code, never user-facing text. The UI translates codes through i18n.
- File dialogs, drag and drop, and recent files sit behind a TypeScript `PlatformFiles` interface on the UI side: Tauri plugins on desktop, browser file APIs in Phase 3.

### 3.3 Local layout

- Settings: `settings.json` in the OS config directory (`app_config_dir`).
- Engines, runtimes, networks and generated configs: in the OS local data directory (`app_local_data_dir`), not the roaming one, because CUDA runtimes are large.
- KataGo runs with its working directory set to the engine's install folder, and the model and config are passed as relative paths. This keeps non-ASCII user-profile paths, common on Chinese Windows, out of KataGo's command line.
- When Aji exits or crashes, KataGo must not keep running. Windows uses a job object with kill-on-close, and Linux uses the parent-death signal. On macOS, Aji relies on KataGo exiting when its stdin closes. This was verified on the Mac on 2026-11-19 with KataGo 1.18.2: started with `-quit-without-waiting`, KataGo exits within 0.1 s of its parent being killed with SIGKILL. Without that flag, a search that is not reporting progress survives as an orphan. Aji therefore always passes `-quit-without-waiting`, and macOS needs no orphan watchdog.

### 3.4 Engine-side defaults

- The analysis engine (JSON over stdin and stdout) is the only protocol in Phase 1. GTP waits for Phase 4.
- `reportAnalysisWinratesAs = BLACK` in the generated config. Phase 1 shows Black's perspective only.
- Intermediate results are throttled to 10 per second per position (charter 6.5).
- Each position gets a visit cap, after which the engine stops and the GPU goes idle until the user navigates. **[Proposed]** The default is 100,000 visits.
- Results are cached in memory in Phase 1. The SQLite cache is Phase 2.

## 4. Milestones

| | Milestone | Proves | Depends on |
|---|---|---|---|
| M0 | Research and owner actions (parallel track) | The unknowns that change later designs are answered | — |
| M1 | Foundation | Installers from CI open on the PC and the Mac; the transport works end to end | — |
| M2 | Analysis walking skeleton | KataGo, placed by hand, streams candidates into the installed app on both machines | M1 |
| M3 | Manifest, hardware detection, recommendation | Aji knows what the machine is and what to install | M2, S1, S2, S3 |
| M4 | Install pipeline | Download, verify, unpack, benchmark, config and smoke test work unattended; a failure offers the next backend | M3 |
| M5 | First-run wizard and settings | Phase 1 acceptance for setup, from a clean user account | M4 |
| M6 | Game records and board | SGF files open, render and navigate correctly | M1 (core work can start after M2) |
| M7 | Analysis on the board | Candidate discs, table, win-rate bar and hover variations | M5, M6 |
| M8 | Acceptance and v0.1.0 | The acceptance run passes on both machines; Linux works on CPU | M7 |

```
M0 (parallel) ─────────────┬──────────────┐
                           ▼              ▼
M1 ──► M2 ──► M3 ──► M4 ──► M5 ──────────► M7 ──► M8
        │                                 ▲
        └──► M6 (aji-core SGF, rules) ────┘
```

The riskiest part comes first, as the charter requires: the engine path (M2) and the engine manager (M3, M4) are built before the board gets attention. The `aji-core` SGF and rules work in M6 touches no other crate, so it can run in parallel with M3 and M4.

Branch per milestone, named for example `feat/m1-foundation`. Each milestone ends in one pull request, with CI green and the exit criteria checked on the real machines.

## 5. Milestone details

### M0. Research and owner actions (starts now, runs alongside M1 and M2)

| ID | Item | Owner of the work | Output | Blocks |
|---|---|---|---|---|
| S1 | **R1**: whether NVIDIA's CUDA, cuDNN and TensorRT runtimes may be downloaded by Aji, from NVIDIA's servers or from Aji's own | Agent (desk research) | `docs/research/r1-nvidia-runtime.md` with the terms quoted, a conclusion, and the NVIDIA default backend that follows | M3 recommendation table, M4 runtime download |
| S2 | **R2**: build KataGo with the Metal backend in CI | Agent: first as a local build on the M5 (needs A1), then in the manifest repository once A2 exists | A workflow on a `macos-15` runner (arm64; the `macos-14` label is now an x64 image and deprecated) that builds with a macOS 13 deployment target, ad-hoc signs, zips (with KataGo's licence), records the SHA-256 and publishes a release. The runner is older Apple hardware, so the proof is on the M5: download the binary without a browser, then run `katago version` and `benchmark` | macOS entries in M3, macOS install in M4. **Status:** done on 2026-11-20. The release `katago-v1.18.2-metal` of `reallxuan/aji-manifest` was built by `katago-metal.yml` on a `macos-15` runner and proved on the M5 (details in the M3 plan). |
| S3 | **R4**: backend benchmarks on both machines | PC: owner runs, agent prepares the script. M5: agent runs | PC: visits per second for the cuda12.8, cuda13.2, TensorRT, DirectML and OpenCL packages of the newest release, with the same network. M5: the S2 Metal build with several networks, to set the Mac's network preselect. Charter 6.3 lists no fallback backend for Apple Silicon. From both: raw stdout of `benchmark` and an analysis-engine session transcript, saved as test fixtures | M2 fake KataGo, M3 defaults, M4 benchmark parser. **Status:** the Mac half is done. The PC half (R4) awaits the owner's run of `scripts/benchmark-windows.ps1`. |
| S4 | Real SGF fixtures from Fox, Tygem, KGS and OGS, including GBK-encoded files | Owner supplies, confirms they may be committed | `crates/aji-core/tests/fixtures/sgf/` | M6 |
| S5 | Check the Phase 1 LizzieYzy menu entries one by one, as charter section 7 requires at the start of each phase | Agent | `docs/audits/phase-1-lizzieyzy-menu.md`: each entry mapped to a Phase 1 item, or to a later phase, or to 7.10 with a reason. Anything missed is added to this roadmap | M5 |
| A1 | Install the Rust toolchain (M1 Task 0), and CMake and Ninja for S2 (`brew install cmake ninja`), on the M5 | Owner | `rustc`, `cargo`, `cmake` and `ninja` on the PATH | M1, S2 |
| A2 | Create the public repository `reallxuan/aji-manifest` with GitHub Pages enabled | Owner (outward-facing) | Empty repository | S2, M3 |

Analysis-engine and benchmark formats are taken from recorded runs (S3, and the Mac's KataGo), not written from memory.

### M1. Foundation

Detailed plan: [2026-11-19-phase-1-m1-foundation.md](2026-11-19-phase-1-m1-foundation.md).

**Status:** done on 2026-11-19. The Mac exit check passed; the Windows installer check moves to M8.

- Cargo workspace and the Tauri 2 app in `src-tauri`. Vite, React 19, TypeScript, Tailwind CSS 4, Vitest, ESLint and Prettier. Zustand arrives in M2 with the first shared state.
- The main frame layout of interface design section 4 (board square from window height, panel takes the rest).
- Theme tokens for both themes; the theme follows the OS, and dark is used when the OS preference cannot be read.
- i18next with `zh-CN` and `en`; language follows the OS; a key-parity test; a lint rule against literal JSX text.
- The protocol (`rpc`, `Request::AppInfo`), TypeScript generation, and the TypeScript `Transport` with Tauri and fake implementations.
- CI: checks on every push. Windows NSIS, macOS DMG and Linux AppImage installers as artifacts on every push to `main`, or from a manual run on any branch. Licence checks for Rust and npm dependencies.

**Exit:** the CI installers install and open on the PC and the Mac. The panel shows the version line from the Rust side in the OS language, and the theme follows the OS.

### M2. Analysis walking skeleton

Detailed plan: [2026-11-19-phase-1-m2-analysis-skeleton.md](2026-11-19-phase-1-m2-analysis-skeleton.md).

**Status:** done on 2026-11-19. The Mac exit check passed on a local build; the Windows PC check moves to M8. The `main` CI run failed on Windows before the engine tests ran, so it built no installers (details in the M2 plan). The fix is in M3.

- Engine lifecycle (audit G1, approved by the owner on 2026-11-19): the protocol also gets `engine.restart` and `engine.stop`, and a watchdog treats an engine that stops answering like a crash, restarting it once. The settings buttons for these come in M5.
- `aji-core` (first types only): colour, point, move, GTP coordinates (no I column), rules, komi, `Position`, and a `PositionKey` hash for the cache.
- `aji-engine`: an analysis-engine process wrapper. It spawns KataGo as in 3.3 (with `CREATE_NO_WINDOW` on Windows), reads line-delimited JSON, routes responses by query id, terminates stale queries, keeps the last 50 lines of stderr, detects exits, throttles updates and caches results in memory.
- A fake KataGo binary that replays recorded transcripts, so CI needs no GPU. Tests run on all three OS runners from here on.
- Protocol: `engine.status`, `analysis.resume`, `analysis.pause`; events `engine.state` (starting, ready, analysing, paused, crashed with the stderr tail) and `analysis.update`. `Transport.subscribe` is added on the TypeScript side.
- A development-only engine override in `settings.json` (binary, model, config paths), written up in `docs/development.md`. It disappears from the user path once M5 lands.
- UI: the engine indicator dot (interface design 4.1), and a plain text list of the top candidates for the empty board.

**Exit:** on both machines, the CI-built app with a hand-placed KataGo shows live candidates for the empty board. Killing KataGo shows the crashed state with its stderr. Quitting Aji leaves no KataGo process behind.

### M3. Manifest, hardware detection, recommendation

Detailed plan: [2026-11-19-phase-1-m3-manifest-hardware.md](2026-11-19-phase-1-m3-manifest-hardware.md). S2 (the Metal build) and the Mac half of S3 are part of it; A1 and A2 are done.

**Status:** done on 2026-11-20. The Mac exit check passed on the M5, and the charter 6.3 table tests pass. The PC report from a real capture, the PC benchmark run, and the first live fetch of the manifest and the Windows CI run (both after the merge into `main`) are still outstanding (details in the M3 plan). S2 (the Metal build) and the Mac half of S3 are part of it; A1 and A2 are done.

- Manifest schema v1: engines (version, release date, platform, backend, CUDA version where relevant, files, required runtimes), runtimes, and networks (name, Elo, release date, size, kind: main or human SL). Every file has one or more URLs, a size and a digest: SHA-256 for engines and NVIDIA archives, and the model server's MD5 for networks. A copy is bundled into the app at build time. The fetched copy is used only if its signature checks (O5).
- Manifest repository content: a generator script that reads KataGo release assets and the network list, takes each file's checksum from what the sources publish (KataGo's releases, NVIDIA's redistributable data and the network server's MD5) instead of downloading it, and writes the manifest.
- Hardware detection, `HardwareReport`: OS and version, CPU (name, cores, AVX2), memory, and GPUs (vendor, name, memory, driver version).
  - Windows: DXGI adapters, plus `nvidia-smi` when present.
  - macOS: `system_profiler -json`.
  - Linux: `/sys/class/drm`, `/proc`, and `nvidia-smi`.
  - The parsers are tested on outputs captured from the real machines, including the M5's `system_profiler` output.
  - Apple chips are classified by GPU core count and memory, not by a list of chip names, so the M5 and later chips work without an update to Aji.
- Recommendation is a pure function from `HardwareReport` and the manifest to the backend list, with tags and a default, following the table in charter 6.3 as amended by S1 and S3. It also gives the versions for a backend (newest first) and the networks in Elo order, preselected per O4. A Microsoft Basic Render Driver (remote desktop or a VM) counts as no GPU.
- Protocol: `setup.detect`, `setup.backends`, `setup.versions`, `setup.networks`.

**Exit:** on the PC and the Mac, a development command prints the correct report and recommendation. The table tests cover every row of charter 6.3.

### M4. Install pipeline

Design: [2026-11-20-m4-install-pipeline-design.md](../specs/2026-11-20-m4-install-pipeline-design.md), approved by the owner on 2026-11-20. It decides two things: on NVIDIA, CUDA is installed straight, with no DirectML bootstrap; and the pipeline lives in `aji-manager`, which now depends on `aji-engine`.

- Downloader:
  - Tries the URLs in order, with the mirror prefix or custom mirror from settings applied.
  - Resumes `.part` files with HTTP Range, and starts over cleanly when the server ignores Range.
  - Verifies the digest (SHA-256, or MD5 for networks) while streaming and moves to the next URL on a mismatch.
  - Throttles progress events, supports cancellation, and checks free disk space before starting.
- Unpacks zip (every archive in the manifest is a zip) into a staging folder and moves it into place in one rename. A half-installed engine is never marked usable. On Windows, runtime DLLs are found through the child process's `PATH`, not by copying. On macOS, Aji checks that downloaded binaries carry no quarantine flag **[To verify]** and sets the executable bit.
- Benchmark: runs KataGo's `benchmark` and parses the visits per second for each thread count. It picks the smallest thread count that reaches 95% of the best **[Proposed]**. The run is shorter than KataGo's default of 800 visits × 10 positions: about 2 minutes on the M5 with the preselected network **[Proposed]**. OpenCL tuning happens here, so the first analysis is not slow.
- Config generation from Aji's own template, not a copy of KataGo's example configs.
- Smoke test: a 50-visit query on the empty 19×19 board must return candidates within a timeout that allows for TensorRT engine builds.
- Fallback: failures are classified from exit status and stderr (missing DLL, CUDA or driver error, out of memory, OpenCL failure) into a code with plain-language text. The next backend in the recommendation's fallback list is offered, with its download size, and installed only if the user agrees (owner decision, 2026-11-20).
- Installed-engines record: `installed.json` in the local data folder, not in settings, because the settings folder roams on Windows. It holds verified components (engine packages, runtimes, networks), usable engine sets, and the active one. The active engine starts with the app.
- Protocol: `setup.licences`, `setup.install`, `setup.cancel`, `setup.status`, `setup.setDownloadSource`, `setup.importNetwork` (the backend opens the file dialog), and `setup.progress` events.
- Integration tests run against a local HTTP server with Range support: resume, bad checksum, 404 on the first URL, cancellation, and not enough disk space.

**Exit:** on the Mac, and optionally on the PC, a development trigger installs an engine with no manual step, and analysis starts. Owner measures download speeds on a mainland network (D1).

### M5. First-run wizard and settings

- Board surface renderer on Canvas 2D: a procedural wood texture (replacing the gradient grain, interface design 5.1), grid, star points, coordinates, and high-DPI scaling that redraws when the device pixel ratio changes. Rendering is a function of view data, kept separate from state (charter section 5).
- Bundled fonts per O6, with a CI check that the WenKai subset covers every character of `zh-CN.json`.
- shadcn/ui is initialised here, the first place stock controls are needed.
- The wizard, as in interface design section 7:
  - Five steps, with the progress line.
  - Detection advances on its own.
  - Backend, version and network lists.
  - Install task rows, the download-source selector, and Cancel.
  - The panel becomes the analysis panel in place when setup finishes.
  - The wizard comes back after a cancel or a quit until an engine is active.
- Failure-state and settings designs (O7) go to the owner first. Minimal settings, shown in the panel: language, theme, download source, the two lines shown on candidate discs (charter 7.3, "fields configurable"), and running engine setup again.

**Exit:** the setup half of Phase 1 acceptance, on the PC and the Mac, each from a new OS user account.

### M6. Game records and board

- `aji-core` SGF parsing:
  - Detects the encoding from `CA`, then by heuristics, so GBK and GB18030 files without `CA` read correctly.
  - Keeps unknown properties and recovers from malformed input.
- `aji-core` SGF writing: UTF-8 with `CA[UTF-8]`, unknown properties written back. Round-trip tests run on the S4 fixtures.
- Game tree; captures, suicide and simple ko; board positions per node; game information.
- Board sizes: square sizes from 5 to 19 open and analyse. Anything else gets a clear message **[Proposed]**.
- `GameSession` in the backend. Protocol: `game.new`, `game.open` (name and bytes), `game.navigate` (first, last, previous, next, move number), `game.preview` (a move sequence from the current node), `game.export`; `game.snapshot` events.
- `PlatformFiles`: open dialog, drag and drop, save and save-as, and the ten most recent files.
- Stones (interface design 5.2) and the last-move dot.
- Header row: title, navigation buttons, a move counter that accepts a typed move number, keyboard (Left, Right, Home, End), and the mouse wheel over the board.
- Screenshot tests for board rendering (charter 6.8). The tool is chosen in the M6 plan.

**Exit:** the owner's Fox and Tygem files open on both machines, navigation is fluid, and save-as round-trips.

### M7. Analysis on the board

- Analysis follows the current node. Rapid navigation debounces requests and terminates stale queries, and updates for any other position are never drawn.
- Candidate discs per interface design 5.3: tiers at 2 and 4 points of win-rate loss, and the outer ring on the move actually played. How many candidates to show, and the visit threshold, are proposed in the M7 plan.
- Candidate table (4.3), the win-rate bar with score lead and uncertainty (4.2), and engine-indicator hover details (version, visits per second).
- Hovering a candidate shows its principal variation as numbered stones, with captures applied through `game.preview`. The wheel steps through it while hovering ("with replay").

**Exit:** the whole acceptance path works on both machines.

### M8. Acceptance and v0.1.0

- Run the acceptance checklist on the PC and the Mac from new OS user accounts, and record the results and any system prompts (SmartScreen, "Open Anyway") in `docs/acceptance/phase-1.md`.
- Linux: the AppImage installs on Ubuntu 22.04, opens a game and analyses on CPU or OpenCL. Measure board frame rate under WebKitGTK (R3).
- Update the README status. The owner tags `v0.1.0`, and the release carries the CI installers.

## 6. Phase-level review focus

These are the inputs most likely to break Phase 1 for a real user, each with the milestone whose tests must cover it.

1. **A Windows user name with Chinese characters**, so every Aji path contains them. Engine launch, model loading and downloads must still work. The fake KataGo is run from a CJK-named folder in Windows CI. (M2, M4)
2. **Slow, dropped or blocked downloads on a mainland network.** Aji resumes, moves to the next URL, honours the mirror, and never leaves a half-installed engine marked active. (M4)
3. **A GPU that looks usable but is not, or that Aji does not know by name.** Examples: an old driver, an RTX 50-series card with a pre-12.8 CUDA build, a remote-desktop session, a laptop whose integrated GPU is listed first, or an Apple chip newer than any in Aji's tests (the M5 today). Aji must detect the problem, offer a fallback, and explain it in plain words, and it must not mistake a new chip for no GPU. (M3, M4; the laptop case is left to M8, because M4 sets no GPU device)
4. **Holding an arrow key or spinning the wheel during analysis.** The engine is not flooded, and no update for an earlier position is painted on the current one. (M7)
5. **Non-conforming SGF.** Cases: GBK without `CA`, truncated files, sizes other than 19, large comments. Aji either opens the file or says why, and unknown properties survive a save. (M6)
6. **KataGo crashes or runs out of memory mid-analysis.** Aji shows the crashed state with stderr and lets the user restart; nothing hangs. (M2)
7. **Aji is force-quit.** No orphaned KataGo keeps the GPU busy. (M2)
8. **A tampered or stale manifest from a mirror.** The bad copy is rejected and the bundled copy is used. (M3)

## 7. Charter risks touched in Phase 1

| Risk | Where it is handled |
|---|---|
| R1 NVIDIA runtime licence | S1, before M3 |
| R2 Metal build | S2, before M3 |
| R3 WebKitGTK on Linux | Measured in M8 |
| R4 Backend speed on the 5070 | S3; results written back into charter 6.3 |
| D1 Mainland mirror | Measured at the end of M4; the owner decides |
