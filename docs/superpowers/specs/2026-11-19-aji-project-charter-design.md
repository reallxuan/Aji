# Aji Project Charter

- Date: 2026-11-19
- Status: Approved by the owner on 2026-11-19
- Markers: **[Decided]** was decided by the project owner. **[Proposed]** was chosen while drafting and can be overturned. **[To verify]** needs testing or research before it is settled.

Chinese terms appear in this document only where they name a Chinese UI label, mostly LizzieYzy menu items, so they can be matched against the original.

## 1. What this is and why

Aji, named after the Go term for the latent potential left in a position, is a cross-platform graphical interface for KataGo, for reviewing, analysing and playing Go.

The owner has used [LizzieYzy](https://github.com/yzyray/lizzieyzy) for a long time. It is feature-rich, but its last release was 2.5.3 in June 2023. Its Java Swing interface looks dated and is awkward to use. Setting it up means downloading KataGo by hand, choosing a backend, and installing drivers and runtime libraries.

Aji is meant to supersede it: apart from not supporting other engines, everything LizzieYzy does, Aji does better. **[Decided]**

"Better" means three things **[Decided]**:

1. **Easier to set up.** Pick a KataGo version and network inside the app. Downloads, backend choice and runtime libraries are handled by the app, with no command line.
2. **Faster.** Quick startup and a fluid interface during analysis.
3. **Better looking.** A modern interface.

## 2. Goals, non-goals, anti-goals

### Goals

- Desktop: Windows, Linux, macOS. **[Decided]**
- Mobile: Android first, iOS later. The phone or tablet is a client; the computation runs on the owner's remote computer and its GPU. **[Decided]**
- KataGo only. **[Decided]**
- Feature coverage of LizzieYzy (section 7). **[Decided]**
- From a clean machine to analysis results without downloading anything by hand or editing a config file. **[Decided]**
- The interface ships in Simplified Chinese and English, with more languages added later. **[Decided]**

### Non-goals

- Other engines (Leela Zero, Zen, Pachi and so on) and generic GTP engines. **[Decided]**
- Running KataGo on the mobile device itself. Mobile is a remote client only. **[Proposed]**
- LizzieYzy's kifu sharing (分享棋谱). It depends on the original author's private server and Aji runs no such service. File export, screenshots and analysis reports replace it. **[Decided]**
- A relay service operated by the project for reaching a home computer from outside the local network. Users bring their own overlay network such as Tailscale. **[Proposed]**

### Anti-goals (shipping these would be a failure)

- **Automatic move placement into online game clients** (the two-way sync and auto-play parts of LizzieYzy's board sync). That is using an AI to play against real opponents. Aji's board sync is read-only. **[Decided]**
- A setup flow that tells the user to "install CUDA / cuDNN yourself".
- Copying LizzieYzy code. It is GPL-3.0 and serves as a feature reference only. Aji is a fresh implementation, which keeps the owner the sole copyright holder and free to change or dual-license later.
- A remote-access port that drives the GPU without authentication.

## 3. Constraints

- Development happens on macOS. The main test machine is a Windows PC with an RTX 5070. **[Decided]** Windows installers must therefore come out of CI from the first phase, not from manual builds.
- The owner's phone is Android. **[Decided]**
- The owner and, by inference, most users are in mainland China, where downloads from GitHub and katagotraining.org are unreliable. Download sources must be configurable and support mirrors. **[Proposed]**
- All repository content is written in English: commits, documentation, code and comments. Chinese is used only for Chinese UI text. **[Decided]**
- State of KataGo releases, checked in November 2026:
  - The newest CUDA build is v1.18.2; the newest for every other backend is v1.18.1. Each release has more than 60 packages. "Latest" is not one version.
  - There is no official macOS binary. The project recommends installing the Metal build through Homebrew.
  - CUDA and TensorRT packages require the user to install NVIDIA runtime libraries. OpenCL needs only a GPU driver but is slow on the transformer networks.
  - The DirectML (Windows, any DX12 GPU), OpenVINO (Intel) and Windows ROCm (AMD) packages added in v1.18 are self-contained.
  - The network page (katagotraining.org/networks) is an HTML table with no API.
  - The main-run networks are under an MIT-style license and can be redistributed with the copyright notice.
- RTX 50-series cards generally need a build against CUDA 12.8 or newer; official cuda12.8 and cuda13.2 packages exist. This comes from NVIDIA's general guidance, not from a KataGo test, and the 5070 decides. **[To verify, see R4]**

## 4. Approaches considered

| | A. Tauri 2 | B. Electron | C. Qt 6 (QML/C++) |
|---|---|---|---|
| Looks and iteration speed | High | High | Medium |
| Installer size | About 10–20 MB | Over 100 MB | About 40–60 MB |
| Engine process, downloads, checksums | Rust, a good fit | Node, adequate | C++, adequate but slow to write |
| Screen capture for board sync | Rust calls OS APIs directly | Needs a native addon | C++ calls OS APIs directly |
| Rendering consistency | Three browser engines; WebKitGTK on Linux is the weak one | Identical everywhere | Identical everywhere |
| Android and iOS | Supported, less mature than desktop | Not supported | Supported |

**Chosen: A, Tauri 2. [Decided]** Small size and fast startup match "faster and easier to set up". The two hardest parts, the engine manager and board sync, are systems work that fits Rust. The main test platform, Windows, uses the Chromium-based WebView2 and is unaffected by the Linux weakness. Tauri 2 also targets Android and iOS with the same UI and most of the same Rust code.

Accepted costs: WebKitGTK on Linux needs its own verification (R3), and Tauri's mobile targets are newer than its desktop ones (R10).

## 5. Technology choices

Rows marked Decided were chosen by the owner. Everything else in this section is **[Proposed]**.

| Layer | Choice | Reason |
|---|---|---|
| App framework | Tauri 2 | Decided |
| Core language | Rust (stable), async with tokio | Process management, downloads, parsing, OS APIs |
| Frontend | TypeScript + React 19 + Vite | Decided. Largest component ecosystem, lowest cost to build a good-looking UI |
| Styling and components | Tailwind CSS + shadcn/ui | Fully customisable, not tied to a design system |
| Frontend state | Zustand | Light, suits high-frequency analysis updates |
| Board rendering | Canvas 2D, written in-house, with rendering separated from data | A 19x19 board is a small drawing load and Canvas 2D holds 60 fps; the separation allows a later move to WebGL |
| Charts (winrate graph and others) | Drawn in-house on Canvas | They must interact with the board (hover, click to jump), which generic chart libraries get in the way of |
| Internationalisation | i18next; Simplified Chinese and English at launch | The two launch languages are Decided; i18next is proposed. More languages later |
| Local data | SQLite (rusqlite) for the analysis cache and game library; settings in a JSON file | Whole-game analysis must persist so reopening a game does not recompute it |
| Remote transport | WebSocket carrying the same JSON messages as local IPC, encrypted and token-authenticated | See 6.4; how encryption is provided on a local network is to verify (R12) |
| Package management | pnpm + cargo workspace | |
| CI | GitHub Actions: checks on every push; installers for all three desktop platforms on every push to `main`, or on demand for any branch | Decided 2026-11-19 (installers on `main` only, not every push). See section 3 |
| Auto-update | tauri-plugin-updater | |
| License | AGPL-3.0-or-later | Decided: AGPL. Anyone who distributes Aji, or offers a modified version over a network, must publish their source, which rules out closed-source commercial repackaging while keeping the project open source. The network clause matters because of remote access (6.4). "Or later" is proposed. All dependencies must be AGPL-compatible; KataGo (MIT) is |

### Minimum system requirements **[Proposed]**

- Windows 10 1809 or later, x64.
- macOS 13 or later, Apple Silicon. Intel Macs are out of scope at launch.
- Linux x64, Ubuntu 22.04 or equivalent and later (needs webkit2gtk 4.1).
- Android and iOS minimums are set when the mobile phase starts.

## 6. Architecture

```
┌──────────────── UI (React/TS): desktop, mobile, browser ────────────────┐
│ board  variation tree  winrate graph  candidate list  engine manager    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ serialisable messages over a transport:
                                │ Tauri IPC (local) or WebSocket (remote)
┌───────────────────────────────┴─────────────────────────────────────────┐
│ src-tauri: wires the crates below to the UI and hosts the remote server │
├──────────────┬────────────────────┬─────────────────────────────────────┤
│ aji-core     │ aji-engine         │ aji-manager                         │
│ SGF I/O      │ KataGo processes   │ hardware detection                  │
│ game tree    │ analysis protocol  │ manifest fetch and verification     │
│ rules        │ GTP protocol       │ engine, network, runtime downloads  │
│              │ analysis cache     │ config generation and benchmarking  │
├──────────────┴────────────────────┴─────────────────────────────────────┤
│ aji-remote (Phase 3): authenticated WebSocket server, pairing           │
│ aji-sync (Phase 6): per-platform window capture and board recognition   │
└─────────────────────────────────────────────────────────────────────────┘
```

Each crate can be tested without the UI. `aji-core` depends on no other crate.

### 6.1 The UI–engine boundary **[Decided as a consequence of the mobile goal]**

The UI never assumes the engine runs on the same machine. It talks to the engine side only through serialisable request, response and event messages, behind one transport interface with two implementations: Tauri IPC for the local case and WebSocket for the remote case.

This costs almost nothing in Phase 1, because Tauri's frontend and Rust side already communicate by messages. The rule is that nothing on the Rust side of that boundary leaks local-only assumptions into the message types, such as file paths the UI is expected to open itself.

### 6.2 Engine protocols

Because only KataGo is supported, analysis uses KataGo's **analysis engine** (JSON over stdin and stdout). It accepts a whole game in one submission, analyses positions in parallel, and supports per-position cancellation and reprioritisation. What LizzieYzy offers as an extra mode called flash analysis (闪电分析) is Aji's default path.

Playing against the AI and engine-versus-engine matches need `genmove` and time control, which use **GTP**. Each protocol gets its own KataGo process, sharing one network file. **[Proposed]**

To avoid two processes competing for GPU memory, analysis queries pause during play. Whether to drop GTP entirely and choose moves through the analysis engine is decided when Phase 4 starts. **[To verify]**

### 6.3 Engine manager

This is the core of Phase 1 and Aji's largest difference from LizzieYzy.

**Manifest.** Aji maintains its own JSON manifest listing every available engine package, network and runtime library: version, platform, backend, download URLs (several, including mirrors), size, SHA-256 and dependencies. The manifest lives in a separate public repository. Aji fetches it at startup and falls back to the copy bundled in the installer. It does not scrape GitHub's "latest", because "latest" is not one version and the network page has no API.

**Hosting. [Proposed]** Files Aji builds itself, such as the Metal build of KataGo, are published on GitHub Releases, and the manifest on GitHub Pages; both are free. Each file in the manifest may list several URLs, which Aji tries in order. Settings accept a download-acceleration prefix or a custom mirror URL for users in mainland China. Whether to pay for a mirror reachable from the mainland is the owner's decision (D1); Phase 1 does not depend on it.

**Hardware detection to backend choice.** Aji detects GPU vendor, model, driver version and memory, then recommends a default from the table below, which the user can change:

| Hardware | Default backend | Fallback |
|---|---|---|
| NVIDIA | CUDA (cuda12.8 or newer packages on 50-series), with the runtime downloaded by Aji **[To verify, see R1]** | DirectML, then OpenCL |
| AMD (Windows) | ROCm (self-contained) | DirectML, then OpenCL |
| AMD (Linux) | OpenCL | — |
| Intel GPU | ONNX + OpenVINO (self-contained) | OpenCL |
| Apple Silicon | Metal, built in Aji's own CI and hosted by Aji **[To verify, see R2]** | — |
| No usable GPU | Eigen AVX2 | Eigen |

**Post-install verification.** After a download, Aji checks the SHA-256, unpacks, runs KataGo's `benchmark` to obtain thread counts and related settings and writes them into a generated config, then sends a minimal analysis query to confirm results come back. If any step fails, Aji tries the fallback backend and explains the cause in plain language.

**Network choice.** Aji recommends a network that balances strength and speed, adjusted to the GPU tier. The user can switch in a list. The human-style network (human SL) is an optional download.

### 6.4 Remote access

The desktop app has an "allow other devices" switch. When on, `aji-remote` opens an authenticated WebSocket port and serves the same UI over HTTPS, so a phone can use Aji from its browser with nothing installed. The native mobile apps of Phase 7 connect to the same port.

- **Pairing.** The desktop shows a QR code containing the address and a one-time token. Scanning it stores a long-lived device token, which the desktop can revoke per device.
- **Security.** Encryption and token authentication are mandatory. The switch is off by default. How encryption is provided is **[To verify, see R12]**: a browser will not accept a self-signed certificate on a local IP address without warnings, and may refuse a secure WebSocket to it outright.
- **Reach.** On the same local network it works directly. Outside it, the user provides the route, for example Tailscale; Aji runs no relay.
- **Unreliable links.** The server lowers the update rate for remote clients, and a reconnecting client resumes from current state.
- **Scope on mobile.** A remote client reviews, analyses and plays. Engine installation, board sync and other machine-local features stay on the desktop.
- This replaces LizzieYzy's remote engine over SSH (远程引擎).

### 6.5 Data flow (analysis)

The UI changes position → request over the transport → `aji-engine` checks the cache and, on a miss, submits a query to the analysis process and raises the priority of the current position → KataGo streams intermediate results → `aji-engine` throttles them (about 10 per second per position locally, less for remote clients) and pushes events to the UI → the UI redraws only what changed.

### 6.6 Error handling

- Engine crash: capture the last lines of stderr, show them to the user, and offer "restart engine" and "switch backend".
- Interrupted download: resume where it stopped; on a checksum failure, move to the next URL.
- SGF parsing: tolerate non-conforming files as far as possible. Exports from Fox and Tygem often carry non-standard properties and GBK encoding. Unknown properties are kept as they are and written back on save.
- Remote connection lost: the client shows the state plainly and reconnects on its own.

### 6.7 Analysis data and SGF **[Proposed]**

- The primary store for analysis results is the SQLite cache, indexed by position. A normal save writes standard SGF without analysis data, so any other program opens it.
- LizzieYzy writes analysis into private SGF properties. This was confirmed in its source: the properties are `LZ`, `LZOP`, `LZ2` and `LZOP2`. The exact format is read in detail in Phase 2. Aji **reads** these properties in Phase 2 and imports them into the cache, so existing analysed games keep their analysis.
- "Save with analysis" is a separate export in Phase 2, writing a format LizzieYzy can read, to ease moving between the two.
- LizzieYzy's "save clean kifu" (保存纯净棋谱) is therefore Aji's default save behaviour.

### 6.8 Testing

- `aji-core`: unit tests, plus round-trip tests on a set of real game records exported from Fox, Tygem, KGS and OGS.
- `aji-engine`: protocol tests against a fake KataGo that replays recorded JSON, so CI needs no GPU.
- `aji-manager`: unit tests for manifest parsing and backend selection. Real downloads and installs can only be verified on physical machines; the 5070 PC is the primary one.
- `aji-remote`: protocol and authentication tests in CI; real-network behaviour is tested on the owner's Android phone.
- Frontend: screenshot comparison tests for board rendering.

## 7. Feature list

The source is LizzieYzy's Chinese language resource file, about 390 menu and toolbar entries, grouped by function. "Phase" refers to the roadmap in section 8.

**Coverage of LizzieYzy is the contract; this list is a working summary of it. [Follows from a decision]** At the start of each phase, the LizzieYzy menu entries belonging to that phase are checked one by one. Anything this list missed is added. Anything deliberately left out goes into 7.10 with a reason.

### 7.1 Engine and setup

| Feature | Phase | Improvement over LizzieYzy |
|---|---|---|
| Hardware detection and backend recommendation | 1 | Not in LizzieYzy |
| In-app download of KataGo, networks and runtime libraries | 1 | Not in LizzieYzy |
| Automatic benchmark and config generation | 1 | Manual commands in LizzieYzy |
| Several engine profiles (different networks and parameters) with one-click switching | 2 | Simpler interface |
| Rules, komi and board size, including sizes other than 19x19 | 2 | |
| Engine log and raw protocol console | 2 | Replaces the GTP console (Gtp控制台) |
| Engine parameters: PDA (激进度), wide root noise (广度), per-move visit or time limits | 4 | Sliders and presets instead of raw values |
| Update notices for engines and networks | 8 | |

### 7.2 Board and game records

| Feature | Phase |
|---|---|
| Open, save and save-as for SGF; recent files; drag and drop | 1 |
| Step forward and back, jump to start and end, jump to a move number, wheel and keyboard navigation | 1 |
| Coordinates and move numbers (all, last N, restart numbering inside a branch) | 2 |
| Variation tree panel: move between branches, promote to main line, delete a branch, undo delete | 2 |
| Comment panel: view and edit | 2 |
| Markup tools (triangle, square, letters and so on) and freehand drawing | 2 |
| Setup mode: add black or white stones, alternate, pass, insert a move, drag stones, swap move order | 2 |
| Try-out mode (试下) | 2 |
| Board transforms: rotate, flip, swap colours | 2 |
| Game information editing (players, ranks, rules, result) | 2 |
| Paste a game from the clipboard; copy a game to the clipboard | 2 |
| Option to keep or drop comments on save; save a single branch; save with analysis (see 6.7) | 2 |
| Save or copy screenshots of the board, sub-board and winrate graph | 2 |
| Click a stone to jump to its move, double-click to find a stone, find a move | 2 |
| Auto-replay of a game | 2 |
| Save and restore a working session with all analysis data (存档与读档) | 2 |
| Auto-complete a ladder | 5 |
| Open an online link to a game on a Go server | 6 |

### 7.3 Live analysis

| Feature | Phase |
|---|---|
| Candidate moves with winrate, score lead and visits; order and fields configurable | 1 |
| Hover a candidate to show its variation, with replay | 1 |
| Start and pause analysis | 1 |
| Candidate list panel (sortable table) | 2 |
| Winrate graph and score curve; click to jump; blunder bars | 2 |
| Move quality marks (each move coloured by loss) | 2 |
| Next-move hint (where the move actually played ranks among candidates) | 2 |
| Ownership and territory display in several styles (square size, opacity and so on) | 2 |
| Position estimate (形势判断) and final scoring (终局点目) | 2 |
| Policy heatmap (first instinct) and post-search heatmap | 2 |
| Raw network mode (no search) | 2 |
| Sub-board showing the current best variation | 2 |
| Black's perspective or alternating perspective; board score or score including komi | 2 |
| Analysis region control: analyse only some points, avoid some points, lasso a forced region | 5 |
| Write candidate information into comments | 5 |

### 7.4 Whole-game analysis

| Feature | Phase | Notes |
|---|---|---|
| Whole-game analysis (LizzieYzy's 闪电分析): whole game, a range of moves, all branches | 2 | The default path; can start in the background when a game is opened |
| Persisted results, no recomputation on reopen | 2 | |
| Automatic deeper analysis of moves with large swings | 5 | |
| Batch analysis of many games with a progress table | 5 | |
| Hawk-eye analysis (鹰眼分析): AI match rate, average loss, list of mistakes, statistics by game stage, comparison charts for both players | 5 | Thresholds configurable |
| Analysis report export | 5 | Not in LizzieYzy; covers part of what kifu sharing was used for |

### 7.5 Playing

| Feature | Phase |
|---|---|
| Play against the AI: colour, handicap, komi, rules, AI time or visit budget | 4 |
| Continue from the current position with the AI as Black or White (续弈) | 4 |
| Undo, resign, pass, let the AI play its best move | 4 |
| Show or hide analysis during a game (LizzieYzy's analysis mode versus Genmove mode) | 4 |
| AI strength adjustment, including rank levels of the human-style network | 4 |
| Stone sounds | 4 |
| Engine matches: two KataGo profiles play each other, one or many games, optional SGF opening book, winrate and Elo interval statistics; pause and intervene | 5 |
| Dual-engine mode: two profiles analyse the same position side by side | 5 |

### 7.6 Tsumego

| Feature | Phase |
|---|---|
| Tsumego mode (死活题): fill the surroundings of a local problem so the engine thinks only inside it | 5 |
| Capture a tsumego from the screen or an image (抓取死活题) | 6 |

### 7.7 Remote and mobile

| Feature | Phase | Notes |
|---|---|---|
| "Allow other devices" on the desktop, with QR pairing and per-device revocation | 3 | Replaces LizzieYzy's SSH remote engine |
| Use Aji from a phone or tablet browser against the desktop's GPU | 3 | No install; covers Android and iOS |
| Touch-friendly layouts for small screens | 3 | Designed for touch, not a shrunken desktop layout |
| Native Android app | 7 | |
| Native iOS app | 7 | After Android; needs a paid Apple developer account (D2) |

### 7.8 External integrations

| Feature | Phase | Notes |
|---|---|---|
| Board sync (棋盘同步), read-only: one-click recognition for Fox (野狐), Tygem (弈城) and Sina (新浪); region selection for other windows or images | 6 | Windows first, then macOS and Linux |
| Fox kifu download (野狐棋谱): recent games by username | 6 | Unofficial interface that may stop working |
| Yike live games and lobby (弈客直播、弈客大厅) | 6 | Same caveat |
| Floating board (浮动棋盘): a small always-on-top window | 6 | |
| KataGo distributed training: watch games, contribute | 8 | Lowest priority |

### 7.9 Interface

| Feature | Phase |
|---|---|
| High-DPI support | 1 |
| First-run wizard | 1 |
| Simplified Chinese and English | 1 |
| Light and dark themes; selectable board and stone styles | 2 |
| Dockable, resizable panel layout with presets (matching LizzieYzy's default, classic, minimal, thinking and four-panel modes) | 2 |
| Full keyboard shortcuts, customisable, with a LizzieYzy-compatible preset | 2 |
| Always on top | 2 |
| Traditional Chinese, Japanese, Korean and further languages | 8 |

### 7.10 Explicitly not done

- Other engines.
- Automatic move placement into online game clients, and two-way sync.
- Kifu sharing and lookup that depend on a private server.

## 8. Roadmap

Each phase ends with a version that installs and is usable. There are no dates; phases run in order.

### Phase 0: Charter (this document)

Git repository, this document, README, agent development rules.

### Phase 1: Engine manager and basic analysis

The riskiest part goes first. **[Decided]**

- Tauri project skeleton; CI builds installers for the three desktop platforms.
- Manifest repository and format; first entries cover Windows NVIDIA, Windows generic (DirectML, OpenCL), macOS Metal and CPU.
- Hardware detection, backend recommendation, download, verification, benchmark, smoke test.
- First-run wizard.
- Board display, opening SGF, navigation, live candidates, hover variations.
- The UI–engine boundary of 6.1 is in place from the first line of code.

**Acceptance:** on the Windows PC with the RTX 5070, going from downloading the installer to seeing analysis results takes no command line, no manual download and no config editing. The same holds on the development Mac.

**Two scope notes for Phase 1 [Proposed]:**

- **No code signing.** Signing and notarisation need paid developer accounts and certificates, and are in Phase 8. On first run, Windows shows a SmartScreen prompt and macOS needs one "Open Anyway" in System Settings; that single system prompt does not violate acceptance. The Metal build of KataGo gets a free ad-hoc signature in CI, the minimum Apple Silicon requires to run any binary, and files downloaded by Aji carry no quarantine flag, so it is not blocked a second time. **[To verify]**
- **Linux is guaranteed only as far as "installs, opens a game, analyses on CPU or OpenCL".** CI produces an AppImage and the manifest carries Linux Eigen and OpenCL entries. Linux NVIDIA CUDA entries may be listed but are marked unverified, since there is no test machine. Full Linux packaging and GPU backend verification are in Phase 8.

### Phase 2: Review core

Full game editing, variation tree, comments, winrate graph, whole-game analysis and cache, ownership display, candidate list, themes, layouts, shortcuts. Layouts and the board component are built to adapt to small screens and touch, so Phase 3 does not rework them.

**Acceptance:** daily review no longer needs LizzieYzy.

### Phase 3: Remote access

`aji-remote`, pairing and device management, the UI served to browsers, touch layouts.

**Acceptance:** on the owner's Android phone, in a browser, on the home network and over an overlay network from outside, a game can be opened and analysed using the PC's 5070.

### Phase 4: Playing

Games against the AI, continuing from a position, strength adjustment, engine parameter interface.

### Phase 5: Deep analysis

Hawk-eye, batch analysis, analysis region control, tsumego mode, engine matches, dual-engine comparison, analysis reports.

### Phase 6: External integrations

Read-only board sync, Fox kifu download, Yike live games, floating board, tsumego capture.

### Phase 7: Native mobile apps

Android app first, then iOS, both as clients of `aji-remote`.

### Phase 8: Polish and release

Auto-update, code signing and notarisation, Linux packaging (AppImage, deb), more languages, distributed-training features, user documentation.

## 9. Risks and items to verify

| ID | Item | Impact | Handling |
|---|---|---|---|
| R1 | Whether NVIDIA's CUDA and cuDNN runtimes may be downloaded and distributed by Aji has not been checked against the license terms | Decides the default backend for NVIDIA users | Check the terms first thing in Phase 1. If not allowed, the default becomes a self-contained backend such as DirectML, and CUDA becomes an advanced option with guided installation |
| R2 | No official macOS binary; Aji must build and host the Metal version | More CI and release work | Add a KataGo Metal build job to CI in Phase 1; the alternative is calling Homebrew |
| R3 | WebKitGTK rendering performance and behaviour on Linux | Linux experience | Measure board frame rate on Linux once the Phase 1 skeleton exists; the alternative for Linux alone is an embedded-Chromium runtime |
| R4 | Which CUDA builds run on the 5070, and how fast each backend is, are untested | Whether the default recommendation is the best one | Run `benchmark` for each on the real machine in Phase 1 and write the results back into the backend table |
| R5 | The Fox and Yike interfaces are unofficial | Phase 6 features may break | Build them as modules that can be disabled independently |
| R6 | Stability of board recognition across platforms and client skins | Phase 6 effort | Run a small experiment before Phase 6 starts |
| R7 | Name collisions, checked 2026-11-19: `aji` is free on crates.io and taken on npm (0.0.10); GitHub has many repositories named aji, but the only Go-related one is a 1-star project, `matteosb/aji-phoenix`. App stores and trademarks were not checked | Package name conflicts | The product is named Aji. The npm package is not published, so it is unaffected. The repository is `reallxuan/Aji`. Check the app stores before Phase 7 |
| R8 | The scope is large: about 390 LizzieYzy menu entries, plus remote and mobile | Long timeline | Deliver by phase, each one usable; revisit the order of later phases after Phase 2 acceptance |
| R9 | No Linux GPU test machine | Linux GPU backends cannot be tested | Phase 1 promises only CPU and OpenCL; extend when a machine is available |
| R10 | Tauri's Android and iOS targets are newer than desktop, and some plugins behave differently | Phase 7 effort | Phase 3's browser client already delivers phone use, so Phase 7 can slip without blocking the goal; build a minimal Android shell early in Phase 7 to surface problems |
| R11 | The remote port exposes GPU compute and game data | Security | Off by default, TLS and tokens mandatory, per-device revocation, security review before Phase 3 ships |

| R12 | Mandatory encryption conflicts with install-free browser use on a local network: self-signed certificates trigger browser warnings, and plain HTTP is not a secure context, which disables some browser features | Phase 3 acceptance | Settle at the start of Phase 3. Candidates: rely on the certificates and encryption an overlay network such as Tailscale provides; plain HTTP on the local network with authenticated encryption at the message layer; certificate pinning from the pairing QR code in the native apps |

### 9.1 Decisions for the owner that do not block work

| ID | Item | Needed by |
|---|---|---|
| D1 | Whether to pay for a download mirror reachable from mainland China | After download speeds are measured on a mainland network in Phase 1 |
| D2 | Whether to buy an Apple developer account (needed for notarisation and for any iOS build on a real device) and a Windows code-signing certificate | Before Phase 7 for iOS, before Phase 8 for signing; earlier for an earlier public release |
| D3 | Phase 2 acceptance is judged by the owner against their own habits. Before Phase 2 starts, the owner lists the features they use daily so those come first | Before Phase 2 starts |

## 10. Left to the implementer

- Module layout inside each crate and the choice of specific libraries.
- Field details of the manifest JSON and of the transport messages.
- The visual design of the board and stones. A design draft goes to the owner before Phase 2 starts.
- Default key bindings.
- The schema of the analysis cache.

## 11. Repository layout (planned, created in Phase 1)

```
Aji/
├── crates/
│   ├── aji-core/
│   ├── aji-engine/
│   ├── aji-manager/
│   ├── aji-remote/      (Phase 3)
│   └── aji-sync/        (Phase 6)
├── src-tauri/
├── src/                 (frontend)
├── docs/
└── .github/workflows/
```

The engine and network manifest lives in a separate repository, provisionally `aji-manifest`.
