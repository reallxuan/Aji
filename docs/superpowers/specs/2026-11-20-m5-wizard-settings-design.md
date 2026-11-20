# M5 First-Run Wizard and Settings Design

- Date: 2026-11-20
- Status: Agreed with the owner in a design session on 2026-11-20; written up for approval
- Roadmap item: M5 in [the Phase 1 roadmap](../plans/2026-11-19-phase-1-roadmap.md)
- Builds on: [interface design](2026-11-19-aji-ui-design.md) section 7, [M4 install pipeline design](2026-11-20-m4-install-pipeline-design.md), [S5 audit](../../audits/phase-1-lizzieyzy-menu.md) (G1–G4, G12, K2)
- Markers: **[Decided]** was decided by the owner. **[Proposed]** is the author's call and can be overturned.
- Mockups approved in the session: [`docs/design/mockups/m5/`](../../design/mockups/m5/) (`failure-states.html`, `failure-states-v2.html`, `settings.html`). Open them in a browser; they load Inter and LXGW WenKai TC from Google Fonts, like the earlier mockups.

## 1. Intent

M4 built the machinery that installs KataGo with nobody watching. M5 puts a face on it. A new user on the PC or the Mac goes from a fresh install to a running engine through four short steps in the main screen's panel, with no command line, no manual download and no config editing. That is the setup half of Phase 1 acceptance (charter section 8).

When something goes wrong, Aji says what happened in plain words. When the user can fix it, Aji says how, before it suggests a different backend. The user is never trapped in setup. M5 also gives the app its first real settings and its first real board surface, so the main screen looks like Aji rather than a placeholder.

## 2. Goals, non-goals, anti-goals

**Goals**

- The wizard of interface design section 7, driven by the M4 protocol, including every failure state and the NVIDIA licence step.
- A way out at every step ("暂不设置", set up later), which opens the main screen with no engine (audit G2).
- Minimal settings in the panel: language, theme, the two lines on candidate discs, the per-move visit limit, engine controls (restart, stop, set up again), deleting unused downloads, and an About page (audit G1 buttons, G3, G4, G12).
- The board surface: procedural wood, grid, star points, coordinates, high-DPI.
- Bundled fonts (roadmap O6) and shadcn/ui, initialised here.
- The M4 leftovers listed in section 6.

**Non-goals**

- Stones, candidate discs on the board, the candidate table, the win-rate bar (M6, M7). The disc-lines setting is stored now and drawn in M7.
- Opening game files (M6). The no-engine main screen shows an empty board until then.
- A download-source selector. **[Decided]** The owner is not in mainland China and does not want it now. The M4 protocol and the `downloadSource` setting stay, with no interface (section 8).
- Several engine profiles, GTP, or any engine other than KataGo (charter).

**Anti-goals** (shipping these would be a failure even if setup technically works)

- Recommending another backend when the user's own fix (a driver update) would give them the faster one.
- A wizard the user cannot leave.
- A licence acceptance that is not explicit, or that downloads NVIDIA files before acceptance (R1 section 6).
- Explanatory paragraphs or a "recommended" badge in the wizard (interface design 7, **[Decided]**).
- Any interface text that is not in both `zh-CN` and `en`.

## 3. Owner decisions (2026-11-20)

| Item | Decision |
|---|---|
| R20 (M3) | **[Decided]** GPU machines also list the CPU build (Eigen AVX2, else Eigen) as their last backend, so a broken GPU always leaves a way out. Charter 6.3 gains this. |
| G2 | **[Decided]** "暂不设置" (set up later) on every wizard step opens the main screen with no engine. |
| G3 | **[Decided]** A per-move visit limit in settings. **The default is no limit.** This replaces the roadmap's proposed 100,000 cap (roadmap 3.4). |
| G4 | **[Decided]** An About page: version, AGPL-3.0-or-later notice, source link, third-party notices. |
| G12 | **[Decided]** The two disc lines can be any two of win rate, score lead and visits. |
| K2 | **[Decided]** A language switch in the wizard's top row. |
| Download source | **[Decided]** No selector in M5 (section 2). |
| M4 minors #9, #10 | **[Decided]** A "reused" state on install rows; no engine restart or resume while a job benchmarks. |
| Failure panels | **[Decided]** Mockups A1, A2, B, C and D (section 5.3). When the user can fix the failure, Retry is the main button and the fallback is the second; otherwise the fallback is the main button and Retry the second. The fallback is never the only button. |
| Settings, About, no-engine screen | **[Decided]** Mockups S, About and No engine (section 5.4), including the "unused downloaded files" row. |
| Benchmark (exit check) | **[Decided]** The install no longer runs the benchmark: on the Mac it held the install for about five minutes with little to show. A new set gets the backend's default thread count, and settings runs the benchmark on request (5.2, 5.4). |
| Install progress (exit check) | **[Decided]** A download row shows how much has arrived, the total, the speed and the time left, in brackets; a benchmark row says what it is doing. Versions and networks already on disk are tagged "已下载" (downloaded). |

## 4. Approaches considered

### 4.1 Where the wizard's state lives

- **A. In the UI (chosen).** A Zustand store holds the step and the choices (backend, version, network). The backend stays as M4 built it: stateless requests for lists, and the install job as a snapshot that any client can fetch with `setupStatus`. Whether to show the wizard is derived from engine state: `notConfigured` shows it.
- **B. A backend setup session**, like the `GameSession` of roadmap 3.1, with the step held in Rust and the UI rendering snapshots. It survives a UI reload and suits a Phase 3 remote client, but the steps before the install are pure choices that cost nothing to redo. It would add a protocol surface for no user-visible gain.
- **C. A separate window or route for setup.** Ruled out: interface design 7 **[Decided]** that setup uses the main frame and that the panel turns into the analysis panel in place.

A is chosen because the only state worth surviving a reload, the running job, already lives in the backend.

### 4.2 Where settings live

- **A. In `settings.json`, through the protocol (chosen).** New `settingsGet` and `settingsSet` requests. One file holds everything, as roadmap 3.3 says, and the visit limit has to reach the engine side anyway.
- **B. In the webview's `localStorage`.** Simpler for language and theme, but it splits settings across two stores. A Phase 3 remote client would want per-device language and theme; that is a Phase 3 decision and can add a client-side override then.

### 4.3 How licences are shown

- **A. Link to NVIDIA's pages, with an unticked acceptance box (chosen).** R1 section 6, item 1 asks for exactly this: name each component, its size and its licence, link to the licence text, and have an unticked "I accept" control whose wording confirms the user can accept (is of legal age).
- **B. Fetch and show the text inside Aji.** The text lives inside NVIDIA's archives, which may not be downloaded before acceptance, or on web pages whose HTML is not stable enough to hash. Rejected.

## 5. Design

### 5.1 How the app decides what the panel shows

- At startup the UI asks `engineStatus`.
  - `notConfigured` with no job running: the wizard.
  - A job running (`setupStatus`): the wizard at step 4, showing that job. This happens after a window reload, not after a quit.
  - Anything else: the analysis panel.
- **Quitting during setup.** Quitting cancels a running job, as M4 does, and the job is not remembered. The next launch starts the wizard at step 1 with the usual preselections. Detection is quick, and every verified component (an engine package, a runtime, the network) is reused, so nothing finished is downloaded again, and a `.part` file resumes. **[Proposed]** Remembering the interrupted choices would need a record on disk and a new startup path, and would only save three clicks on the default rows.
- **The wizard comes back** at the next launch until an engine is active. "暂不设置" closes it for this run only. The next launch with no active engine shows the wizard again, still with "暂不设置" on every step. **[Proposed]** This keeps the roadmap's "comes back until an engine is active" and still never traps the user (G2).
- **No engine.** After "暂不设置", the analysis panel shows the no-engine state (mockup "No engine"). The engine dot is grey, and clicking it or "设置引擎" opens the wizard.
- **Set up again.** "重新设置引擎" in settings or on the crashed state (mockup D) opens the wizard over the analysis panel. The running engine keeps analysing until the downloads finish (M4 5.9 stops it before the test query, or before the benchmark when one runs, and restarts it if the job fails). Leaving the wizard with "返回" before step 5 returns to the analysis panel with nothing changed. On a re-run, "暂不设置" reads "取消" (cancel).

### 5.2 The wizard

The layout follows interface design 7 and the mockups in `docs/design/mockups/setup-*.jpg`. The empty board is on the left, and the panel holds a four-segment progress line, then the step.

- **Top row.** The title "准备 AI 引擎" (prepare the AI engine) with a compact `中文 · EN` switch on the right (K2). The switch writes the language setting, as the settings page does.
- **Step 1, hardware and backend.** One page: what detection found, then the backends to choose from. **[Decided 2026-11-20]** The owner merged the separate detect step into this page during the exit check, so the user sees the hardware while choosing. It replaces an earlier step 1 that advanced by itself after detection and left only one line about the card on the backend step.
  - **Hardware.** Under a small "本机硬件" (this computer) label, four compact rows (graphics card, memory, operating system, driver), each with a spinner and then a tick. A failed probe shows its row as "未检测到" (not found) in muted text; detection never blocks. A failed `setupDetect` shows the error with Retry, and no backend list.
  - **Backends.** Once `setupDetect` has answered, a radio list from `setupBackends`, with tags as in the generated `BackendTag` comment.
  - **New: driver advice.** When the recommendation carries `driverTooOldForCuda`, CUDA stays in the list as a disabled row tagged "需要更新驱动" (needs a driver update), instead of disappearing as it does in M3's recommendation today. A small line names the current driver and the version CUDA needs, with a "下载驱动 ↗" (download driver) link to NVIDIA's driver page and a "重新检测" (detect again) button. Detect again re-runs hardware detection and the recommendation, refreshing the hardware rows too, so a user who has just updated the driver gets CUDA without relaunching Aji. This is the step-1 form of the owner's point on panel A1: the user learns that a driver update gives them the faster backend before they settle for DirectML. **[Proposed]**
  - "The version CUDA needs" is the `minDriver` of the CUDA runtime the recommendation would pick for this GPU if the driver allowed it: 580 for compute capability 7.5 or newer (CUDA 13.2), else 572.61 (CUDA 12.8). Charter 6.3's thresholds therefore come from the manifest, not from code.
  - Hardware detection, held once per process today (`Setup.hardware`), becomes refreshable for this.
  - With R20, GPU machines list the CPU build last.
- **Step 2, version.** The list from `setupVersions`, newest first, newest preselected and tagged "最新" (latest).
- **Downloaded tag (steps 2 and 3).** A version or network already installed on disk carries a muted "已下载" (downloaded) tag, so the user can see which choice costs no download. The lists' `installed` flag comes from the installer's records. **[Decided 2026-11-20]**
- **Step 3, network.** The list from `setupNetworks`, in Elo order, top row preselected **[Decided]**. "导入权重文件" (import network file) calls `setupImportNetwork`, and the imported network joins the top of the list, selected. "开始安装" (start install) moves on.
- **Licence step (mockup C).** If `setupLicences` lists a licence not yet accepted, step 4 first shows the licence panel:
  - each component's name, its size and a "查看 ↗" (view) link that opens the licence URL in the system browser;
  - an unticked box: "我已年满法定年龄，并接受以上 NVIDIA 许可条款" (I am of legal age and accept the NVIDIA licence terms above); "接受并安装" (accept and install) is disabled until it is ticked;
  - "不接受" (decline) does not download anything. It shows panel A2 with the fallback offer for `licenceNotAccepted`, using the next backend from the recommendation. **[Proposed]** The mockup drew no box; R1 requires one.
- **Step 4, install (mockup `setup-5-install.jpg`).** One row per task from `setupProgress`: waiting, running with a percentage and a bar, done, reused (new state, section 6), or failed.
  - **No benchmark.** **[Decided 2026-11-20]** The rows are the engine, the runtime, the network and the test query. The new set gets the backend's default thread count: Metal 6, the other GPU backends 16, and the CPU builds one thread per core. Settings measures it on request (5.4).
  - **Download line.** A running download shows "已下载 / 总大小（速度/s，还需 时间）" (done / total (speed, time left)), for example "604 MB / 1000 MB（2 MB/s，还需 4 分钟）". The speed is the average over the last three seconds and the line samples on its own each second, so a stalled download falls to 0 B/s and the time left goes. The time left reads in seconds under a minute, whole minutes rounded up under an hour, then hours and minutes.
  - **Benchmark line.** When a job measures (from settings), its row says what KataGo is doing: "正在启动 KataGo，加载权重" (starting, loading the network), then "正在测试 N 个搜索线程" (testing N search threads) with each finished count's speed under it, then "正在选出最合适的线程数" (choosing the best count). The bar counts positions across all thread counts. These come from `JobSnapshot.benchmark`, parsed from KataGo's progress lines. Cancel calls `setupCancel`, and the step then shows "已取消" (cancelled) with Retry, Back and "暂不设置". There is no download-source selector (section 2).
  - While a job runs, Cancel is the footer's only control, so "暂不设置" never leaves a job running unseen. It returns once the job is cancelled, has failed or has finished. **[Proposed]** The user is still never trapped, because Cancel is always there.
- **Success.** When the job outcome is `installed`, the panel becomes the analysis panel in place (interface design 7 **[Decided]**). The engine starts from the new set (M4 5.9).

### 5.3 Failure states

The heading names the backend and what happened. The failed row turns red; finished rows keep their ticks. The text comes from the M4 failure codes (`setup.failure.*`, already in both locales). "KataGo 最后的输出" (KataGo's last output) is a fold-out with the stderr tail when there is one.

| Failure | Panel | Main button | Second button |
|---|---|---|---|
| `gpuDriverTooOld` | A1: names the current and the required driver, links to NVIDIA's driver page, says Retry reuses everything | 重试 (retry) | 改用 X（size） (switch to X) |
| Other backend failures with an offer (`gpuError`, `missingLibrary`, `openclNoDevice`, `outOfMemory`, `timedOut`, `crashed`, a backend's own download or disk failure) | A2 | 改用 X（size） | 重试 |
| `licenceNotAccepted` (declined at the licence step) | A2 without Retry | 改用 X（size） | — |
| No offer: the network download, `notEnoughSpace` for the network, a backend with no fallback left (Metal on the Mac, the last CPU build) | B | 重试 | 返回 (back) |
| The active engine crashes later (analysis panel, not the wizard) | D: M2's crashed state | 重启引擎 (restart engine) | 重新设置引擎 (set up again) |

- Every wizard failure panel also has "返回选择后端" (back to backends) or "暂不设置" as a text link on the left of the footer.
- **Retry** is a new `setupInstall` with the same engine and network. Verified components are reused (M4 5.9). Retry re-runs detection first, so the driver line sees an updated driver, but it keeps the same engine even if the new recommendation would pick another CUDA build. **[Proposed]**
- **How A1 is reached.** Step 1 keeps CUDA unselectable when detection already sees an old driver, so A1 is for the case detection misses: the driver passes the threshold, or reads wrong, and CUDA still refuses. M5 classifies CUDA's own `cudaErrorInsufficientDriver` text ("CUDA driver version is insufficient for CUDA runtime version", printed through KataGo's CUDA error handler) as `gpuDriverTooOld`. It follows M4 5.8's sourcing rule: the pattern cites KataGo's source at v1.18.2 and stays **[To verify]** until a real recording arrives from the PC.
- **The required driver version** (A1, step 1) comes from the manifest runtime's `minDriver` (R1 section 7). The protocol exposes it with the recommendation and with a `gpuDriverTooOld` outcome. The exact field is left to the plan. This also closes the M3 deferral "read the CUDA thresholds from `minDriver` instead of hard-coding them".
- **Driver links** go to NVIDIA's driver download page. AMD and Intel get no driver advice in M5 (no `driverTooOld` classification exists for them).
- **Disk errors.** A new failure code `diskError` covers a write or rename failure inside Aji's own folders (M4 minor #4). It has its own text and panel B, with no offer, since another backend would hit the same disk.

### 5.4 Settings and About

The gear in the panel header swaps the panel body for settings; "←" returns. The board stays. Every change applies at once, with no Save button and no restart. Layout as in mockup S.

- **Interface.**
  - Language: 跟随系统 / 简体中文 / English (follow system, Simplified Chinese, English). It switches live. This also fixes M1's finding that WKWebView exposes only the first preferred language.
  - Theme: 跟随系统 / 深色 / 浅色 (follow system, dark, light).
- **Analysis.**
  - Disc line 1 and disc line 2: each a select of win rate, score lead and visits. Choosing the value already on the other line swaps them, so the two lines stay distinct. A preview disc on wood shows the result. The default is win rate over score lead. Stored now; drawn in M7.
  - Visit limit per move: empty means no limit, which is the default **[Decided]**. A positive number caps each position. A note under it reads "达到上限后停止分析，显卡空闲；换一步时重新开始" (analysis stops at the limit and the GPU idles; it starts again on the next move). A change applies at once to the position under analysis. **[Proposed]**
    - **Lowered** below the current visits: the search stops, and the result already reached is kept.
    - **Raised or removed:** a search that had stopped at the old limit continues.
    - Section 5.9 has the engine side.
- **Engine.**
  - One line: KataGo version and backend. A second line: the network name. Both come from the active set.
  - **Search threads.** **[Decided 2026-11-20]** A third line, "搜索线程：6（默认值，未测速）" (search threads: 6, default, not measured) or "搜索线程：10（已测速，25 次/秒）" (measured, 25 visits per second), with a "测速" (measure speed) button. The button runs the benchmark on the active set (`setupInstall` with `benchmark: true`): everything is reused, the engine stops, KataGo measures, the test query runs and the engine restarts on the chosen count. The rows and the benchmark line of 5.2 show here, the button becomes "取消" (cancel), and the wizard never opens. A failure reads "测速失败：<reason>" (speed test failed) and leaves the previous set active. While it runs, restart, stop, set up again and delete are disabled, as the backend would refuse them.
  - Buttons: 重启引擎 (restart, `engineRestart`), 停止引擎 (stop, `engineStop`), 重新设置引擎 (set up again, section 5.1). While a job benchmarks or runs its test query, restart and resume are refused with a new error code `engineBusy` (M4 minor #10), and the buttons are disabled.
  - **Unused downloaded files**, with the total size and "删除" (delete). "Unused" means every recorded engine, runtime, network and usable set that is not part of the active set, plus leftover `staging/` folders and `.part` files (M4 minor #2). Delete asks for confirmation and is refused while a job runs. With no active engine, everything installed counts as unused. **[Proposed]**
- **About (G4).** The version line, the AGPL-3.0-or-later notice, and the source link `https://github.com/reallxuan/Aji`. Below that, one row each for KataGo, the KataGo networks, Inter, LXGW WenKai and "other open-source components". Each row opens the licence text, which ships inside Aji so it works offline. The other components' list is generated from the Rust and npm dependency licences at build time, not written by hand. The generator is left to the plan; it must pass `cargo deny`. **[Proposed]**

### 5.5 Board surface

- Canvas 2D, drawn from view data (board size, theme). It is a pure function of its inputs, and state stays outside (charter section 5).
- **Wood.** A procedural straight grain in the `#DDB067` honey tone, with a lit top edge and a darker lower edge (interface design 5.1). It replaces the gradient grain. The texture is generated once per size and device pixel ratio into an offscreen canvas, with a fixed seed so every launch looks the same. **[Proposed]**
- Grid lines and star points in dark brown. Coordinates A–T without I and 1–19 on the top and left, as in the mockups.
- **High-DPI.** The backing store is the CSS size times `devicePixelRatio`. A `matchMedia` resolution listener redraws when the ratio changes, for example when the window moves to another screen.
- The empty 19×19 board is shown in the wizard and the no-engine screen. Stones arrive in M6.

### 5.6 Fonts (roadmap O6)

- **Inter**, Regular and Medium, as WOFF2, and **LXGW WenKai** (the mainland original, not the TC build), Regular and Medium, subset to GB2312 plus every character in `zh-CN.json`. Headings use Medium. The mockups' bold headings become Medium, since O6 bundles no Bold. **[Proposed]**
- The font files and their OFL licence texts are committed under `src/assets/fonts/`, and the subset is made by a script in `scripts/` using fontTools (MIT). The script records the source release and its hash.
- A CI test fails when a character in `zh-CN.json` is missing from the WenKai subset.
- Downloading the source font releases (from the Inter and LXGW WenKai GitHub releases) happens once, in the plan, with the owner's go-ahead.

### 5.7 shadcn/ui

Initialised here for the stock controls: radio group, select, segmented toggle, checkbox, button, collapsible, dialog (delete confirmation). Components are restyled with the existing theme tokens. Rounded floating cards stay out (interface design 1.4 **[Decided]**).

### 5.8 Protocol changes

Requests:

- `settingsGet` → the stored settings that the UI owns: `language`, `theme`, `discLines`, `visitLimit` (`null` for none).
- `settingsSet { patch }` writes the given fields and returns the new settings. A `visitLimit` change reaches the engine side for the next query.
- `setupInstalled` → the active set's summary (engine version, backend, network name, threads, and the measured visits per second when the count was measured) or none, and the unused size in bytes.
- `setupInstall` gains `benchmark` (default `false`). The wizard leaves it off; settings sets it. The `JobSnapshot` says whether the job `measures`, so the interface sends its progress to settings and not to the wizard, and carries `benchmark` progress (the thread count under test, positions done, the speeds found).
- `setupVersions` and `setupNetworks` mark each entry `installed`.
- `setupRemoveUnused` deletes the unused files of 5.4 and returns the bytes freed. It is refused with `setupBusy` while a job runs.
- `setupLicences` gains each component's download size, as R1 section 6 requires.
- The recommendation and the `gpuDriverTooOld` outcome carry the current and the required driver version (5.3).

Events: `settingsChanged { settings }`, so a second window or a Phase 3 client follows a change.

Error codes: `engineBusy` and the failure code `diskError`, both with text in both locales.

The `TaskState` gains `reused` (M4 minor #9, M4 design 5.11 already promised a skipped state).

Removed from the user path: the `AJI_DEV_INSTALL` trigger is deleted (M4 5.12 says the wizard replaces it). `devEngine` stays as a developer override documented in `docs/development.md`; nothing in the interface mentions it.

### 5.9 Engine visit limit

`EngineOptions::visit_cap` becomes a value the service can change while the engine runs, and `None` means no limit. With no limit, a query omits `maxVisits`, so KataGo searches until the position changes or analysis is paused. **[Proposed]**

- **A change acts on the current position** (5.4). Lowering it below the current visits terminates the query. Raising or removing it resubmits a position whose search had stopped at the old limit. The cache rule in `wants_analysis` (no resubmission at or above the cap) compares against the new value.
- **At the limit**, the final result arrives and the engine reports itself idle. The panel's status line says "已达到每步上限" (reached the per-move limit), and the GPU idles. M5 adds no new `EngineState` and no "continue past the limit" action. Audit G3's indicator state, which the same control resumes, belongs with the M7 indicator work. **[Proposed]** With no limit by default, few users meet this before M7. The consequence: KataGo's search tree, and its memory, grows for as long as one position is analysed. The exit check leaves the Mac on one position for 30 minutes and records KataGo's memory, so the owner can judge whether a ceiling is needed later. Aji does not add a hidden ceiling.

## 6. M4 leftovers and other deferrals

M4's final review left 14 minors (`m4-deferred-review-findings` in the author's notes):

| # | Item | M5 |
|---|---|---|
| 1 | A same-set reinstall rewrites the active config before its test passes | **Fix**: Retry and "set up again" hit it. Rename into place in `activate()`. |
| 2 | `staging/` never cleaned | **Fix** inside "delete unused files" (5.4), skipping a folder a running job holds. |
| 3 | A panic in the job leaves the engine stopped | **Fix**: restart the previous engine from `run()`. |
| 4 | Disk errors get misleading codes | **Fix**: `diskError` (5.3). |
| 5 | Re-sending the same download source resets the download | **Drop**: no selector in M5. |
| 6 | One unknown value makes `settings.json` unreadable | **Fix**: M5 adds four fields, so read each field leniently and fall back to its default. |
| 7 | `import_network` holds the record lock while copying | **Fix**: import is now reachable from step 3. |
| 8 | No "Text file busy" retry | Defer to M8 (Linux). |
| 9 | No skipped state | **Fix**: `reused` (5.8). |
| 10 | Nothing blocks restart or resume during the benchmark | **Fix**: `engineBusy` (5.4). |
| 11 | `Installer::start` checks neither platform nor network fit | **Fix**: refuse with `setupUnknownEngine` or `setupUnknownNetwork`. |
| 12 | The fake KataGo is built in release | Defer to M8 (packaging). |
| 13 | An HTTP client build failure stops the app from starting | Defer to M8. |
| 14 | An imported `.txt.gz` may not load once stored as `.bin.gz` | **Verify** on the Mac with KataGo; fix the stored name if it fails. |

From M3: R20 (section 3) and `minDriver` (5.3) land here.

## 7. Testing

- **UI.** Vitest and Testing Library, through the fake transport: the panel switch (5.1), every wizard step, every row of the failure table (5.3), the licence box gating its button, settings round trips, and live language and theme changes. The i18n parity and lint rules cover every new string.
- **Seeing the NVIDIA panels on the Mac.** These cannot be reached on the Mac with real hardware. In `pnpm dev`, a development-only `?scenario=<name>` URL parameter swaps in the fake transport with a scripted scenario: PC detection, CUDA licence, A1 driver too old, A2 GPU error, B download failed, D crashed. The owner can look at each in a browser. It is compiled out of production builds. **[Proposed]**
- **Backend.** Unit tests for the new requests, lenient settings, `reused`, `engineBusy`, `diskError`, removal of unused files, and the visit limit (`maxVisits` omitted when unlimited). Integration tests extend M4's local HTTP server tests: retry reuses components, and a declined licence downloads nothing.
- **Board.** Unit tests for the geometry (coordinates, star points per size) and the DPR listener. Screenshot tests wait for M6 (roadmap).
- **Fonts.** The coverage test of 5.6.

## 8. Exit check

The setup half of Phase 1 acceptance, on the Mac (and optionally the PC, per the owner's standing preference):

1. Build locally (`pnpm tauri build`).
2. **The owner's step:** log in as a new macOS user, install, and open Aji. The wizard runs from detection to analysis with no command line, no manual download and no config editing.
3. Before that, the author checks the same path in the author's account by pointing Aji at empty data folders. The plan names how, for example a development-only environment variable for the config and data directories.
4. "暂不设置" at step 1 opens the no-engine screen, and the next launch shows the wizard again.
5. Quit during the network download. The next launch starts the wizard at step 1, and the new install reuses the engine package and resumes the network's `.part` file.
6. Settings: switch language and theme live; lower the visit limit below the current visits and see analysis stop, then remove it and see analysis continue; restart, stop, set up again; delete unused files after a second install.
7. Leave one position analysing for 30 minutes with no limit, and record KataGo's memory (5.9).
8. Look at the board on the built-in display and on an external screen of a different scale, moving the window between them (audit G11).
9. In `pnpm dev`, walk the NVIDIA scenarios of section 7.

## 9. Documents this changes

- **Charter 6.3:** add the CPU build to every GPU row (R20). Note that the NVIDIA rows install after in-app licence acceptance (R1).
- **Charter 7.1, 7.9:** add the visit limit (G3), the About page (G4) and "set up later" (G2).
- **Roadmap 3.4:** the visit cap default becomes no limit (G3). **Roadmap M5:** no download-source selector; the exit names the 30-minute memory check.
- **Interface design 7:** the download-source selector leaves step 5; the failure states are designed (close the **[Open]** item). **Section 8:** settings and error states are designed.
- **Audit:** G1 (buttons), G2, G4, G12 and K2 are done in M5. G3 is done except its "stopped at limit" indicator state, which moves to M7.

## 10. Left to the builder

- The exact field names and shapes of the new protocol messages, and how the required driver version travels (5.3, 5.8).
- The licence generator for "other open-source components" (5.4), subject to `cargo deny`.
- The procedural wood algorithm, within 5.5.
- The development-only mechanism for empty data folders (section 8, item 3).
- Which shadcn/ui components are installed, within 5.7.

## 11. Risks

- **No default visit limit** may let KataGo's memory grow without bound on a long session (5.9). Measured at the exit check.
- **WenKai subset size.** GB2312 is 6,763 characters. Two weights may still be several MB. Measured when the script first runs; if it is too large, Medium is dropped and headings use Regular.
- **NVIDIA panels are only seen through scenarios on the Mac** until the owner's PC run.
- **The driver link** points at a page NVIDIA may move. It is one constant, and a broken link costs a search, not a broken install.
