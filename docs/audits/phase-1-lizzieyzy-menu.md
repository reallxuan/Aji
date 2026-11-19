# Phase 1 LizzieYzy Menu Check

- Date: 2026-11-19
- Status: Draft for the owner's review
- Roadmap item: S5 of the M0 track in `docs/superpowers/plans/2026-11-19-phase-1-roadmap.md` (merged into `dev` in `90f1d79`; not yet on `main`, so it is cited by path rather than linked). The result feeds M5 (first-run wizard and settings). Several rows also feed M2, M6, M7 and M8.
- Charter: [section 7](../superpowers/specs/2026-11-19-aji-project-charter-design.md) requires this check at the start of each phase. Interface design: [aji-ui-design](../superpowers/specs/2026-11-19-aji-ui-design.md).
- Markers follow the charter. Everything that changes scope is **[Proposed]**; this document edits neither the charter nor the roadmap.

Chinese appears only in the second column of the tables, quoting LizzieYzy's labels to identify entries, as charter section 7 allows. No LizzieYzy code was copied. LizzieYzy is GPL-3.0 and is used as a feature reference only.

## 1. Result

- Every Phase 1 row of charter 7.2 and 7.3, and the language, high-DPI and first-run rows of 7.9, has a LizzieYzy counterpart, and the roadmap covers each. The three Phase 1 rows of 7.1 (hardware detection, in-app download, benchmark) have none, as the charter says. The audit confirms the Phase 1 scope and finds additions, plus one place where charter and roadmap pull apart (G3).
- The charter's feature list missed **11 items that belong in Phase 1** (additions G1 to G11 in section 6) and **1 item that belongs in 7.10** (X1). Eight further items belong in later phases (L1 to L8); they are recorded now and will be re-checked at the start of those phases.
- The five that matter most for the user experience:
  - **No engine, no game.** LizzieYzy can open and navigate a game with no engine loaded. The roadmap's wizard has no way out until an engine is installed (G2).
  - **Hiding candidates.** LizzieYzy can hide the candidate discs while analysis keeps running, for a player who wants to think first. The charter has no row for it (G7).
  - **"Replay" is a timed replay.** In LizzieYzy it is an animation of the hovered variation at a set interval, separate from stepping with the wheel. Roadmap M7 reads it as wheel stepping only (G8).
  - **The per-position analysis limit** is asked at LizzieYzy's first run, sits in charter Phase 4, and is hard-coded in roadmap section 3.4 (G3).
  - **Tygem `.gib` files.** LizzieYzy opens them natively. The charter and roadmap name SGF only, and the owner's own Tygem files are an M6 exit criterion (G6).
- One licensing item the charter does not mention: Aji needs a place to show the AGPL notice and the notices for KataGo, the networks and the bundled fonts (G4).

## 2. Method

### 2.1 Source

| Item | Value |
|---|---|
| Repository | https://github.com/yzyray/lizzieyzy, branch `main` |
| Commit audited | `741c301495947608b0cebc36e9c123caf0c90901` (2023-08-18) |
| Simplified Chinese strings | `src/main/resources/l10n/DisplayStrings_zh_CN.properties`, 1,995 lines, 1,986 entries, written as `\uXXXX` escapes |
| Other locale files | `DisplayStrings.properties` (the default) is byte-identical to `DisplayStrings_en_US.properties`. `_zh_TW` and `_zh_HK` are byte-identical to `_zh_CN`, so LizzieYzy has no real Traditional Chinese translation to reuse. Japanese (`_ja_JP`) and Korean (`_ko`) exist. |
| Behaviour checked in source | Where a string does not show what an entry does, the source was read for behaviour only: `Lizzie.java`, `Config.java`, `gui/LizzieFrame.java`, `gui/Menu.java`, `gui/BottomToolbar.java`, `gui/Input.java`, `gui/MoreEngines.java` and the `rules/` parsers. These are cited by file name; nothing was copied. |

**English meanings are written from the Chinese.** The `en_US` file disagrees with the Chinese in places, so it was not used as the source of meaning. Examples: `LizzieFrame.commands.keyE` (Chinese: show the command window; English: toggle evaluation colouring), `LizzieFrame.commands.rightClick` (Chinese: right-click menu for forced analysis and editing; English: undo), and the pair `Menu.leadWithKomi` / `Menu.leadJustScore`, whose English labels are crossed relative to the Chinese. Several shortcut letters also differ between the two files.

### 2.2 What was scanned

All 1,986 entries were assigned to a group. Charter section 7 says "about 390 menu and toolbar entries". Group A below holds 487 keys (443 without the keyboard help list), which include messages, hints and tooltips as well as menu items, so the charter's figure is a fair approximation.

| Group | Key prefixes | Entries | Treatment |
|---|---|---|---|
| A. Menu and toolbar entries | `Menu.*` 365, `BottomToolbar.*` 45, `LizzieFrame.commands.*` 44 (the keyboard and mouse help list), `RightClickMenu.*` 17, `menu.*` 11, `RightClickMenu2.*` 5 | 487 | Every entry read. Those touching the seven Phase 1 areas are tabulated in section 3. The rest are assigned to a phase by group (section 2.3), not row by row. |
| B. Dialogs opened from those entries | `LizzieConfig` 173, `MoreEngines` 69, `FirstUseSettings` 51, `ConfigDialog2` 39, `SetKataRules` 31, `SGFParse` 25, `StartAnaDialog` 17, `CheckVersion` 15, `AnalysisSettings` 14, `loadEngine` 14, `SuggestionInfoOrderSettings` 12, `SetKataEngines` 12, `SetKataPDA` 12, `ChooseMoreEngine` 12, `GtpConsolePane` 9, `RemoteEngineSettings` 8, `AutoPlay` 8, `SetBoardSize` 7, `WaitForAnalysis` 6, `EngineFailedMessage` 6, `GameInfoDialog` 6, `SetDelayShowCandidates` 5, `SetFrameFontSize` 4, `SetReplayTime` 3, `MovenumberDialog` 3, and four smaller ones | 567 | Read for Phase 1 content; their Phase 1 entries are in section 3. |
| C. Frame and engine messages | `LizzieFrame.*` (other than commands) 107, `Leelaz.*` 21, `AnalysisTable` 14, `Lizzie.*` 10, `EngineManager` 10, `BoardRenderer` 6, and ten smaller ones | 181 | Read for Phase 1 flows (open and save errors, engine start and failure). |
| D. Not Phase 1 | See the next table | 751 | Not read row by row; assigned by group. |

Group D, by destination:

| Destination | Prefixes | Entries |
|---|---|---|
| 7.4 Hawk-eye and statistics windows, Phase 5 (blunder thresholds also feed the 7.3 winrate graph, Phase 2) | `Movelistframe` 111, `AnalysisFrame` 21, `StatisticsThreshold` 11, `SetDiffAnalyze` 6, `AnalysisPartGame` 5, `BlunderTabel` 5, `SetThreshold` 1, `rame` 1 | 161 |
| 7.5 Playing and engine matches, Phase 4 and 5 | `EngineGameInfo` 53, `NewGameDialog` 27, `EnginePkConfig` 26, `NewAnaGameDialog` 25, `NewEngineGameDialog` 21, `SetAiTimes` 14, `Byoyomi` 10, `SetAnaGameRandomStart` 9, `Mannul` 6, `SetMatchAiPara` 3, `AdvanceTimeSettings` 2 | 196 |
| 7.8 KataGo distributed training, Phase 8 | `ContributeView` 56, `ContributeSettings` 28, `Contribute` 27, `contributeView` 2 | 113 |
| 7.10 Kifu sharing and its server login | `PrivateKifuSearch` 39, `ShareFrame` 18, `EditShareFrame` 18, `loggin` 12, `SetShareLabel` 7, `ShareMessage` 6, `BatchShareFrame` 3, `PublicKifuSearch` 2 | 105 |
| 7.8 Fox kifu, Yike and board sync, Phase 6 | `FoxKifuDownload` 30, `OnlineDialog` 10, `ReadBoard` 5, `SetBoardSyncTime` 3, `BrowserFrame` 1 | 49 |
| 7.3 Estimates and scoring, Phase 2 | `EstimateResults` 19, `ScoreResult` 15, `SetEstimateParam` 11, `KataEstimate` 2 | 47 |
| 7.6 Tsumego, Phase 5 and 6 | `TsumeGoFrame` 18, `CaptureTsumeGoSettings` 8, `CaptureTsumeGoFrame` 7, `Tsumego` 4 | 37 |
| 7.9 Layouts, panels, floating boards (floating boards are 7.8, Phase 6) | `SetCustomMode` 13, `Controller` 3, `IndependentMainBoard` 1, `IndependentSubBoard` 1, `VisualizedPanelSettings` 1 | 19 |
| 7.10 Other engines, and a quick-launch list of external programs (see X1) | `SetLeelaEngines` 9, `OtherPrograms` 5 | 14 |
| Small UI helpers (copy menu, board rotation error, font list, untitled game name, move-number input error) | `JTextPane` 3, `SpinAndMirror` 2, `FontList` 2, `GameInfo` 2, `LizzieChangeMove` 1 | 10 |
| **Total group D** | | **751** |

### 2.3 Where the rest of group A goes

Menu and toolbar entries outside the seven Phase 1 areas belong to later phases. They are listed here so the owner can see none was dropped; each phase's own start-of-phase check re-reads them.

| Entries | Destination |
|---|---|
| Edit menu: variations, delete and undo delete, insert and add stones, markup, board rotation and mirroring, swap colours, game information, board size, komi | 7.2, Phase 2 |
| Panels, layout modes (default, classic, minimal, thinking, four-panel, double-engine), themes, fonts, window position, always on top | 7.9, Phase 2 |
| Winrate graph options, blunder bars, move quality marks, ownership and estimate styles, policy and raw-network heatmaps, sub-board, score and perspective options | 7.3, Phase 2 |
| Whole-game ("flash") analysis, auto analysis | 7.4, Phase 2 |
| Batch analysis, hawk-eye, enhanced analysis | 7.4, Phase 5 |
| New game, continue against the AI, AI time, intervention, engine matches, stone sound | 7.5, Phase 4 and 5 |
| Board sync, floating boards, Yike | 7.8, Phase 6 |
| Share menu | 7.10 |
| Tsumego, capture tsumego | 7.6, Phase 5 and 6 |
| Distributed training menus | 7.8, Phase 8 |

### 2.4 Dispositions

| Disposition | Meaning |
|---|---|
| **Covered** | A charter row and a roadmap milestone deliver it. |
| **Covered differently** | The charter row is met by a different design, cited in the notes (interface design, roadmap or charter section). |
| **Later** | A charter row in a later phase takes it. |
| **7.10** | An existing bullet in charter 7.10 covers it. |
| **7.10+** | Not done on purpose, but 7.10 does not say so yet. A new bullet is proposed. |
| **Gap** | Not in charter section 7. A proposed home is given. |
| **Not a feature** | Exists only because of LizzieYzy's Java Swing implementation. No charter change needed. |

Charter rows are cited by section and the first words of the row, for example "7.2 Open, save, recent, drop". Phase is written P1 to P8, and milestone M2 to M8 as in the roadmap.

## 3. Phase 1 audit tables

### 3.1 Engine setup and configuration

| # | LizzieYzy label (key) | English meaning | Charter row | Disposition | Notes |
|---|---|---|---|---|---|
| E1 | 引擎 (`Menu.engineConfig`) | Engines: opens the engine list | 7.1 Several engine profiles; 7.1 Hardware detection and download | Covered · P1 · M5; list Later · P2 | P1 reaches this through the first-run wizard and a settings entry that runs engine setup again (roadmap M5). |
| E2 | 设置引擎 (`MoreEngines.title`) | Engine manager: a list of engines, each with name, command line, preload flag, board width and height, komi, default flag; add, delete, reorder | 7.1 Several engine profiles; 7.1 Rules, komi, board size | Later · P2 | One active engine in P1 (roadmap M4 registry). Aji sends size, rules and komi with every analysis query (roadmap 3.1), so per-engine width, height and komi are not needed. The user types the command line by hand; Aji generates it. |
| E3 | 自动生成 (`MoreEngines.scan`) | Generate: builds the command line from an engine executable, weights file and config file the user picks | 7.1 Automatic benchmark and config generation | Covered differently · P1 · M4 · plus Gap L1 | The wizard downloads and generates. **Gap:** there is no way to point Aji at a KataGo, model or config the user already has (a custom build, a Homebrew KataGo, files from an existing LizzieYzy setup). The wizard offers only "import network file" (interface design 7). Proposed as L1 in Phase 2 with profiles. |
| E4 | 初始命令 (`MoreEngines.lblInitialCommand`); 加密命令行 (`MoreEngines.btnEncrypt`) | Initial commands sent to the engine at start, separated by semicolons; encrypt the command line | 7.10 Other engines (generic GTP) | 7.10 | Aji's settings come from its generated KataGo config, so neither field is needed. |
| E5 | 远程引擎 (`MoreEngines.chkRemoteEngine`, `RemoteEngineSettings.*`) | Remote engine over SSH: host, port, user, password or key file | 7.7 Allow other devices | Later · P3 | Charter 6.4 says remote access replaces this. The direction flips: LizzieYzy's window stays local and the engine is remote; in Aji the window is remote and the engine stays at home. |
| E6 | ikatago(远程引擎) (`MoreEngines.ikatago`) | Choose a third-party remote KataGo service as the platform, with its own user name and password | none | 7.10+ | The charter covers SSH only. Proposed as X1: add a 7.10 bullet, "no integration with third-party cloud engine services; Aji's own remote access (6.4) is the route". |
| E7 | 选择要加载的引擎 (`loadEngine.title`) | Start-up chooser: pick the engine to load, by double-click | 7.1 Several engine profiles | Later · P2 | |
| E8 | 不加载引擎 (`loadEngine.noEngine`); 未加载引擎 (`Menu.noEngine`) | Run without an engine; status text "no engine loaded" | none | **Gap** · P1 · M5 | LizzieYzy opens and navigates games with no engine. Roadmap M5 brings the wizard back "until an engine is active", and the wizard occupies the main frame, so a user who cancels, or whose download fails, cannot open an SGF. Proposed as G2. |
| E9 | 切换引擎 (`ChooseMoreEngine.ok`); 最后退出的引擎 (`ChooseMoreEngine.lblrdoLast`) | Switch engine; what to load at start: the selected one, the last one used, ask, or none | 7.1 Several engine profiles (one-click switching) | Later · P2 | In P1 the active engine always starts with the app (roadmap M4). |
| E10 | 重启当前引擎 (`Menu.restartCurrentEngine`); 重启引擎 (`EngineFailedMessage.btnRestart`) | Restart the current engine | none (6.6 mentions restart after a crash only) | **Gap** · P1 · M2 | A user-initiated restart has no row in section 7. Proposed as G1. |
| E11 | 关闭引擎 (`Menu.shutdownEngine`); 关闭所有引擎 (`Menu.shutdownAllEngine`); 关闭当前以外引擎 (`Menu.shutdownOtherEngine`) | Shut the engine down: the current one, all others, all | none | **Gap** · P1 · M2 and M5 | Pausing idles the GPU but leaves the KataGo process, with its network loaded, in memory. A "stop engine" control releases it. The "others" and "all" variants matter only with several engines (P2, P5). Proposed as G1. |
| E12 | 自动检测并重启卡死的引擎 (`LizzieConfig.chkCheckEngineAlive`) | Detect an engine that has stopped answering and restart it | 6.6 Error handling | **Gap** · P1 · M2 | Charter 6.6 covers a crash, not a hang. Roadmap section 6 item 6 says "nothing hangs" but defines no detection. Proposed as G1. |
| E13 | `EngineFailedMessage.*`, `Leelaz.engineEndUnormalHint`, `Leelaz.engineFailed`, `LizzieFrame.display.down` | Engine failed to load or died; run it in a command window to diagnose; open the GTP window to see the error | 6.6 Error handling | Covered · P1 · M2 | M2 shows the crashed state with the last stderr lines and a restart button. |
| E14 | `Leelaz.openclPlatfromNotFound`, `LizzieFrame.display.tuning`, `Leelaz.kataGoPerformance`, `LizzieFrame.display.loading`, `…leelaz-missing`, `…network-missing` | No OpenCL device; engine tuning "may take a few minutes"; first KataGo run, set search threads; engine loading; engine or network file missing | 7.1 Automatic benchmark and config generation; 6.3 | Covered · P1 · M3 and M4 | Aji runs OpenCL tuning and thread selection in the benchmark step (M4) so the first analysis is not slow, and turns each failure into plain text. |
| E15 | 引擎规则(KataGo) (`Menu.engineRules`); `SetKataRules.*` | KataGo rules: scoring (territory or area), ko, multi-stone suicide, tax, handicap bonus, button; presets for Chinese, Japanese, Tromp-Taylor and ancient Chinese rules; apply at engine start | 7.1 Rules, komi, board size | Later · P2 | P1 still needs a default for the empty board (M2) and a mapping from the SGF `RU` property for opened games (M6). LizzieYzy's flash analysis falls back to Chinese rules when none is given (`AnalysisSettings.rdoUseCurrentRules`). See K1 in section 5. |
| E16 | 引擎参数 (`Menu.engineParameters`); `SetKataEngines.*`: 搜索线程数, 激进/保守程度, 分析广度拓展, 根策略温度 | Engine parameters: search threads, PDA, wide root noise, root policy temperature; apply at start | 7.1 Engine parameters (P4); 7.1 Automatic benchmark | Threads: Covered differently · P1 · M4. PDA and wide root noise: Later · P4. Root policy temperature: **Gap** (L2) | The benchmark picks the thread count (M4); a manual override comes with profiles (P2). Root policy temperature is not in the 7.1 parameters row. |
| E17 | 激进度 (`Menu.separateLblPda`); 广度 (`Menu.separateLblWrn`); `SetKataPDA.*`: 动态PDA, 固定PDA | PDA and wide-root-noise fields on the toolbar; dynamic PDA (derived from handicap) or fixed | 7.1 Engine parameters | Later · P4 | |
| E18 | 单步分析限制 (`Menu.showTimeLimitController`, `Menu.showPlayoutLimitController`, `FirstUseSettings.lblMaxAnalyzeTime`) | Maximum analysis per move, by seconds or by visits; 0 means unlimited. Analysis stops at the limit; Space or a new move continues it | 7.1 Engine parameters (per-move limits, P4) | **Gap (conflict)** · P1 · M5 and M7 | Roadmap 3.4 already stops each position at 100,000 visits in P1, but the charter places the user-facing limit in P4 and the roadmap's minimal settings omit it. Proposed as G3. |
| E19 | Gtp控制台 (`Menu.gtpPanel`, `GtpConsolePane.*`); 记录GTP日志到文件 (`LizzieConfig.lblLogGtpToFile`) | GTP console window; log GTP traffic and console output to files | 7.1 Engine log and raw protocol console | Later · P2 | P1 keeps only the last 50 stderr lines for the crash view (roadmap M2). |
| E20 | 综合设置 (`Menu.comprehensiveSettings`) | The main settings dialog, with tabs for engine, preload, UI, theme and about; about 170 options | none | Covered differently · P1 · M5 | Aji ships minimal settings in P1 and grows them by phase on purpose (roadmap M5). |
| E21 | 预加载 (`MoreEngines.lblpreload`); `AnalysisSettings.chkPreLoad` | Load the engine when the app starts | 6.3 | Covered · P1 · M4 | The active engine starts with the app. |
| E22 | 空棋盘停止计算 (`LizzieConfig.lblStopAtEmpty`) | Stop analysis on an empty board | none | Covered differently · P1 · M2 | Aji analyses the empty board on purpose (M2 exit check); the visit cap stops it. |
| E23 | 分析结果刷新间隔 (`LizzieConfig.title.analyzeUpdateInterval`); `…SSHanalyzeUpdateInterval` | How often analysis updates reach the UI, with a separate value for remote | 6.5 Data flow | Covered differently · P1 · M2 | Fixed at about 10 per second per position (6.5), lower for remote clients in P3. No setting. |

### 3.2 Opening, saving, recent files, drag and drop

| # | LizzieYzy label (key) | English meaning | Charter row | Disposition | Notes |
|---|---|---|---|---|---|
| F1 | 打开棋谱 (`Menu.open`, `BottomToolbar.openfile`) | Open a game record | 7.2 Open, save, recent, drop | Covered · P1 · M6 | The open dialog and the drop handler also accept `.gib`; see F9. |
| F2 | 最近打开 (`Menu.openRecent`) | Open recent: a submenu of previously opened files | 7.2 Open, save, recent, drop | Covered · P1 · M6 | LizzieYzy keeps the last 5, listed as numbered file names with the full path as a tooltip. The roadmap sets 10. |
| F3 | 保存 (`Menu.save`); 另存为 (`Menu.saveAs`); 保存 (`BottomToolbar.savefile`) | Save; save as | 7.2 Open, save, recent, drop | Covered · P1 · M6 | In P1 the record cannot change (roadmap decision O1), so Save mostly means saving a copy, or converting a GBK file to UTF-8. |
| F4 | 保存纯净棋谱 (`Menu.saveRaw`); 保存纯净棋谱(带评论) (`Menu.saveCommentRaw`); 保存纯净分支 (`Menu.saveBranchRaw`) | Save a clean record (no analysis data); clean with comments; clean single branch | 7.2 Keep or drop comments, save a branch, save with analysis (P2); 6.7 | Covered differently · P1 · M6, plus Later · P2 | Aji's default save is clean (6.7): standard SGF with every other property kept. Comments pass through from the opened file because P1 has no comment editing. The "drop comments" and "single branch" options are P2. |
| F5 | 保存主棋盘截图 (`Menu.saveMainBoardScreen`); 复制主棋盘到剪贴板 (`Menu.copyBoardScreen`); 保存胜率图截图 (`Menu.saveWinrate`) | Save or copy a screenshot of the board, sub-board or winrate graph | 7.2 Save or copy screenshots | Later · P2 | |
| F6 | 复制棋谱到剪贴板 (`Menu.copySgf`); 从剪贴板粘贴棋谱 (`Menu.pasteSgf`) | Copy the game to the clipboard; paste a game from it | 7.2 Paste, copy a game | Later · P2 | |
| F7 | `Menu.showReplaceFileConfirmDialog`, `LizzieFrame.ifReplaceFile`, `LizzieFrame.fileExists` | Confirm before overwriting a file | none needed | Covered · P1 · M6 | The native save dialog asks; "Save" over the opened file in place should confirm too. |
| F8 | `Lizzie.askOnExit1` | On exit, ask "Save SGF?" | none | Later · P2 (L4) | Nothing can change in P1, so there is no unsaved state to protect. Needed once editing exists. |
| F9 | (no label) `.gib` handling in the open dialog and `rules/GIBParser` | Open Tygem's native `.gib` record format as well as SGF | 7.2 Open, save, recent, drop (SGF only) | **Gap** · P1 · M6 | LizzieYzy reads `.gib` directly. Roadmap M6 exits on "the owner's Fox and Tygem files open". Ask the owner which format those files are in. Proposed as G6. |
| F10 | (no label) drag and drop: a drop handler on the main panel | Drop a file on the window to open it | 7.2 Open, save, recent, drop | Covered · P1 · M6 | One dropped file opens. Several dropped files start batch-analysis setup in LizzieYzy (P5 here). Roadmap M6 should define the P1 behaviour: open the first and say the rest were ignored. |
| F11 | 新建 (`Menu.newBoard`); 清空棋盘 (`Menu.clearBoard`); 新建空白棋盘 (`Menu.btnNewFile.toolTipText`); `LizzieFrame.confirmNewBoard` | New empty board, with a confirmation that analysis is cleared | none | **Gap** · P1 · M6 | Charter 7.2 has no "new game" row, but roadmap M6 already has `game.new`. Board size choice (`SetBoardSize.*`: 19, 15, 13, 9, other) is Later · P2 under 7.1 Rules, komi, board size. Proposed as G5. |
| F12 | 加载SGF棋谱中的贴目 (`Menu.loadKomi`) | Switch: take komi from the SGF | 7.2 Open, save, recent, drop | Covered differently · P1 · M6 | Aji always reads `KM`; no switch. |
| F13 | 加载棋谱后跳转到最后 (`LizzieConfig.lblKifuLoadLast`) | After loading, jump to the last move | none | Gap, small · P1 · M6 | Choose a default for the position shown after opening. A setting is P2. See K3 in section 5. |
| F14 | 打开在线链接 (`Menu.openUrl`) | Open a game from an online link | 7.2 Open an online link | Later · P6 | |
| F15 | 存档与读档 (`Menu.saveAndLoad`, `LizzieFrame.saveAndLoad.*`) | Named session records with thumbnails; auto-save on exit; auto-resume at launch | 7.2 Save and restore a working session | Later · P2 (L4) | The charter row does not say whether the last session is restored at launch. Decide at the start of P2. |
| F16 | 分享当前棋谱 (`Menu.shareCurrentSgf`); 批量分享棋谱 (`Menu.shareBatchSgf`); 公开棋谱查询 (`Menu.shareSearch`) | Share a game to LizzieYzy's server; look up shared games | 7.10 Kifu sharing | 7.10 | Not done: depends on the original author's private server (charter 2). The local share history belongs to the same feature. |
| F17 | 编辑棋局信息 (`Menu.setInfo`, `GameInfoDialog.*`); 棋盘下方显示黑白名字 (`Menu.showNameInBoard`) | Edit game information; show player names under the board | 7.2 Game information editing | Later · P2 | The interface design shows only a game title in P1. Decide in M6 whether the title is the file name or the players (K4 in section 5). |
| F18 | `SGFParse.*` | Strings for reading LizzieYzy's own analysis out of an SGF: accuracy, top-10 mismatches, PDA, wide root noise, per-move time, two-engine records | 6.7; 7.2 Save with analysis | Later · P2; P1 must preserve | Charter 6.7 imports the `LZ`, `LZOP`, `LZ2` and `LZOP2` properties in P2. P1 must keep them untouched on save, so a P1 save does not destroy an analysed game. Add a LizzieYzy-analysed SGF to the S4 fixtures (G10). The two-engine hint is P5. |
| F19 | `LizzieFrame.prompt.failedToOpenFile`; `LizzieFrame.saveFileFailed` | Failed to open or save a file | 6.6 SGF parsing | Covered · P1 · M6 | "Aji either opens the file or says why" (roadmap section 6 item 5). |

### 3.3 Navigation

| # | LizzieYzy label (key) | English meaning | Charter row | Disposition | Notes |
|---|---|---|---|---|---|
| N1 | 跳转到最前 (`Menu.jumpToFirst`); 跳转到最后 (`Menu.jumpToLast`) | Go to the first move (Home); go to the last move (End) | 7.2 Step, jump, wheel, keys | Covered · P1 · M6 | |
| N2 | 回退一手 (`RightClickMenu.previousMove`); `LizzieFrame.commands.keyUpDownArrow` | Step back and forward one move. In LizzieYzy the Up and Down arrows step; the Left and Right arrows switch to the previous or next branch (`Menu.jumpToLeft`, `Menu.jumpToRight`) | 7.2 Step, jump, wheel, keys | Covered · P1 · M6 | Aji's interface design 6 inverts this: Left and Right step, Up and Down switch continuations. A user coming from LizzieYzy will press the wrong keys until the P2 LizzieYzy-compatible preset (7.9 Full keyboard shortcuts). See K4 in section 5. |
| N3 | 跳转 (`BottomToolbar.gotomove`) with a move-number box | Go to a typed move number | 7.2 Step, jump, wheel, keys | Covered · P1 · M6 | Roadmap M6's move counter accepts a typed number. Out-of-range or non-numeric input needs a message (K7). |
| N4 | 滚轮 (`LizzieFrame.commands.mouseWheelScroll`); `FirstUseSettings.lblHint` | The wheel steps through the game; over a hovered variation it steps through the variation. First-run shows a hint about this | 7.2 Step, jump, wheel, keys | Covered · P1 · M6 and M7 | M6: wheel over the board. M7: wheel over a hovered variation. Aji has no first-run hint (K7 in section 5). |
| N5 | Ctrl+↑/↓, PageUp, PageDown (`LizzieFrame.commands.keyControl`; `gui/Input.java`) | Move ten moves back or forward | 7.2 Step, jump, wheel, keys | **Gap** · P1 · M6 | The charter row does not list it; roadmap M6 keys are Left, Right, Home, End. Aji's Up and Down are reserved for continuations (interface design 6), so PageUp and PageDown fit. Proposed in G9. |
| N6 | 返回主分支 (`Menu.backToMainBranch`); 设为主分支 (`Menu.setAsMain`) | Back to the main line; make this branch the main line | 7.2 Variation tree panel | Later · P2 | Files with variations open in P1: navigation follows the main line and the branches are kept on save (roadmap section 1, decision O1). |
| N7 | 点击棋子回看 (`Menu.allowClickReview`); 启用双击找子 (`Menu.allowDoubleClick`); 跳到此步 (`RightClickMenu2.findStone`); 查找棋步 (`RightClickMenu.findMove`) | Click a stone to review from that move; double-click to find a move; jump to a move | 7.2 Click a stone to jump | Later · P2 | |
| N8 | 手数 (`Menu.moveMenu`, `BottomToolbar.move`); `MovenumberDialog.*` | Move numbers on the board: none, last 1, 5, 10, all, or a custom count | 7.2 Coordinates and move numbers | Later · P2 | P1 draws only the last-move dot (interface design 5.2). |
| N9 | 坐标 (`Menu.coordsMenu`, `BottomToolbar.coords`); `ConfigDialog2.SpecialCoords*` | Show coordinates; styles: default, with I, Fox style, numbers from the top or bottom | 7.2 Coordinates and move numbers | Later · P2 | P1 always draws A to T without I, with 1 to 19 (interface design 5.1; roadmap M5). |
| N10 | 自动播放 (`Menu.makeAutoPlay`, `AutoPlay.*`) | Auto-replay the game at an interval | 7.2 Auto-replay of a game | Later · P2 | |
| N11 | 试下 (`BottomToolbar.tryPlay`) | Try-out mode: play moves that are not kept | 7.2 Try-out mode | Later · P2 | P1 previews a hovered line through `game.preview` and has no try-out (interface design 4.1). |
| N12 | 有新的一手时总是跳转到最新一手 (`Menu.alwaysGoToLastMove`) | Always jump to the newest move when one is played | 7.5 Playing; 7.8 Board sync | Later · P4 and P6 | |

### 3.4 Live candidates and what they show

| # | LizzieYzy label (key) | English meaning | Charter row | Disposition | Notes |
|---|---|---|---|---|---|
| C1 | 选点信息 (`Menu.Suggestions`); `SuggestionInfoOrderSettings.*`; `FirstUseSettings.lblSuggestionInfo` | Choose which of win rate, visits and score lead appear on a candidate, and in which of up to three rows; at least one must be on; a preview | 7.3 Candidate moves, order and fields configurable | Covered · P1 · M5 and M7 | Roadmap M5 offers "the two lines shown on candidate discs". LizzieYzy allows one to three lines from the three fields. Confirm that Aji's two lines can be any two of win rate, score lead and visits. See G12 in section 6, a question not a gap. |
| C2 | 限制选点个数 (`FirstUseSettings.lblLimitSuggestion`) | Limit the number of candidates drawn | 7.3 Candidate moves | Covered · P1 · M7 | Roadmap M7 plan decides "how many candidates to show". A setting is P2. |
| C3 | 不显示低于最高计算量(%)的选点信息 (`LizzieConfig.lblNotShowMinPlayoutRatio`); 超限制选点依然显示推荐圈 (`LizzieConfig.lblShowCircleForOutOfLimit`) | Hide candidates below a percentage of the top visit count; still draw a plain ring for them | 7.3 Candidate moves | Covered · P1 · M7 | Roadmap M7: "the visit threshold". The "Poor" tier of interface design 5.3 plays the role of the ring. |
| C4 | 选点颜色集中程度 (`LizzieConfig.lblSuggestionMoveColorConcentration`); 第一选点上显示蓝圈 (`LizzieConfig.showBlueRing`); 最高胜率-计算量-目数 反色显示 (`Menu.showMaxValueReverse`) | Candidate colour concentration; a blue ring on the best move; reversed colours on the maximum values | 7.3 Candidate moves | Covered differently · P1 · M7 | Interface design 5.3 fixes the tiers (win-rate loss at 2 and 4 points) and one accent colour. Not configurable. Revisit with themes (P2) if the owner wants options. |
| C5 | 显示选点右上方角标 (`Menu.showSuggestionOrder`) | Show each candidate's rank number on its corner | 7.3 Candidate moves | Covered differently · P1 · M7 | The rank chip lives in the table (interface design 4.3). The disc carries none. |
| C6 | 选点 (`Menu.lblShowCandidate`); `LizzieFrame.commands.keyF`; `keyZ`; `keyShiftZ` | Show or hide the candidates on the board (F); hide them while a key is held (Z); hide all analysis results (Shift+Z). Separate from pausing analysis | none | **Gap** · P1 · M7 | Lets a player think before seeing the engine's suggestion, while analysis keeps running. Interface design 4.1 has only the indicator toggle for pause. Proposed as G7. |
| C7 | 延迟显示 (`Menu.setCandidatesDelay`, `SetDelayShowCandidates.*`) | Delay before candidates appear, in seconds; zero or negative means manual only (F) | 7.3 Candidate moves | Covered by C6 (manual); timed delay Later · P2 | |
| C8 | 目数显示 (`Menu.kataScolreLead`); 计算贴目后目数差 (`Menu.leadWithKomi`); 盘面目数差 (`Menu.leadJustScore`); `FirstUseSettings.lblShowScore` | Score lead display: after komi, or the board score | 7.3 Black's perspective or alternating; board score or score including komi | Later · P2 | P1 shows KataGo's reported score lead, Black's perspective (roadmap 3.4). The English labels of the two entries are crossed relative to the Chinese; define the options from KataGo's `scoreLead`, not from the labels. |
| C9 | 黑方视角 (`Menu.winrateMode0`); 双方视角 (`Menu.winrateMode1`); 目数视角 (`Menu.kataScoreLeadPerspective`); `FirstUseSettings.lblWinratePerspective` | Win rate and score from Black's side, or alternating by the player to move | 7.3 Black's perspective or alternating | Later · P2 | P1 is fixed to Black (roadmap 3.4). |
| C10 | 选点列表面板 (`Menu.listPane`); 独立选点列表 (`Menu.SuggestionList`); 选点列表 (`BottomToolbar.analyzeList`) | Candidate list panel; an independent candidate list window | 7.3 Candidate list panel (sortable table) | Covered differently · P1 · M7, plus Later · P2 | Charter 7.3 puts the table in P2; roadmap section 1 and interface design 4.3 put a basic table in P1 and leave sorting and the separate window to P2. |
| C11 | 下一手提示 (`Menu.nextMoveHint`) | Next-move hint: a circle or the win-rate difference where the move actually played ranks | 7.3 Next-move hint | Covered in part · P1 · M7; rest Later · P2 | Roadmap M7 already draws the outer ring on the move actually played and labels it in the table. |
| C12 | 落子评价标记 (`Menu.moveRankMenu`) | Move quality marks on stones | 7.3 Move quality marks | Later · P2 | |
| C13 | 纯网络 (`Menu.showHeatmap`); 策略网络 (`Menu.showPolicy`); 形势判断 (`Menu.estimateStones`); Kata评估显示 (`Menu.kataEstimate`) | Raw network, policy heatmap, estimate, ownership display | 7.3 Heatmaps; Raw network; Ownership; Estimate | Later · P2 | |
| C14 | 增加分析此点 (`RightClickMenu.allow2`); 不分析此点 (`RightClickMenu.avoid`); 优先分析此点 (`RightClickMenu.priority`) | Analyse only this point; avoid this point; analyse this point with priority | 7.3 Analysis region control | Later · P5 (L6) | "Priority for a point" is not in the charter row. |
| C15 | 记录选点信息到评论中 (`Menu.appendWinrateToComment`) | Write candidate information into the comment | 7.3 Write candidate information into comments | Later · P5 | |
| C16 | 清除Lizzie缓存(此手) (`Menu.clearThisLizzieCache`); 清除分析信息(全局) (`Menu.clearAllLizzieBestmoves`); 是否启用Lizzie缓存 (`FirstUseSettings.lblLizzieCache`) | Clear the cached or analysed results for this move or for all; switch the cache on or off | 7.4 Persisted results | Covered differently · P1 · M2 | Aji's in-memory cache is always on (roadmap 3.4); the SQLite cache is P2. A "clear analysis" command is not in the charter; decide at the start of P2. |

### 3.5 Hover variations and replay

| # | LizzieYzy label (key) | English meaning | Charter row | Disposition | Notes |
|---|---|---|---|---|---|
| H1 | 鼠标悬停显示变化图 (`Menu.showVariationOnMouse`); `LizzieFrame.commands.keyShiftF` | Show the variation of the candidate under the pointer; a key toggles it | 7.3 Hover a candidate to show its variation | Covered · P1 · M7 | LizzieYzy can switch it off; Aji's hover is on. A switch is optional. |
| H2 | 鼠标悬停显示变化图时,变化图不刷新 (`Menu.noRefreshOnMouse`); `FirstUseSettings.lblMouseOverSuggestion`; `LizzieFrame.commands.keyG` | While hovering, either keep refreshing the variation as the engine updates, or freeze it until the pointer leaves and returns (or G is pressed) | 7.3 Hover a candidate | Covered · P1 · M7, as a design requirement | KataGo updates arrive about 10 per second, and the principal variation changes as they do, so a live-refreshing preview jitters and makes replay unusable. Freeze the line at hover start and refresh on re-entry. No setting. See K5 in section 5. |
| H3 | 设置选点变化图回放间隔 (`Menu.setReplayInterval`, `SetReplayTime.*`); `LizzieFrame.commands.keyR` | Hover a candidate and press R: the variation plays out move by move at a set interval in milliseconds | 7.3 Hover a candidate to show its variation, with replay | **Covered, wording differs** · P1 · M7 | Roadmap M7 reads "with replay" as the wheel stepping through the line. In LizzieYzy replay is a timed animation; stepping by wheel or keys is separate. Proposed as G8: M7 delivers both. |
| H4 | `LizzieFrame.commands.key123456789`; PageUp and PageDown while a variation shows (`gui/Input.java`) | Keys 1 to 9 show candidate N's variation; PageUp and PageDown step through the variation shown | 7.3 Hover a candidate | Covered · P1 · M7, keys to decide | Keyboard access to the hover preview. Decide the keys in the M7 plan. |
| H5 | 限制变化图长度 (`FirstUseSettings.lblLimitVariation`); 限制整个搜索过程 (`Menu.selectLimitAllMoves`); 仅限制第一手 (`Menu.selectLimitOneMove`); 自定义限制手数 (`Menu.selectLimitCustomMoves`) | Limit the variation length: a custom number of moves, the whole search line, or the first move only | 7.3 Hover a candidate | Covered · P1 · M7 | Roadmap M7 does not name it. Add "variation length" to the M7 plan's list of limits. A setting is P2. |
| H6 | 变化图剩余计算量 (`FirstUseSettings.lblShowPvVists`); 显示变化图剩余计算量 (`ConfigDialog2.lblShowPvVisits`) | Show the visits remaining along the variation: none, last move, every move | 7.3 Hover a candidate | Later · P2 (L5) | Not in the charter. |
| H7 | 显示变化图时提取死子 (`ConfigDialog2.lblVariationRemoveDeadChain`) | Remove captured stones while a variation is shown | 7.3 Hover a candidate | Covered · P1 · M7 | Roadmap M7: "captures applied through `game.preview`". |
| H8 | 添加为分支 (`RightClickMenu.addSuggestionAsBranch`); `LizzieFrame.commands.keyComma` | Add the candidate's line as a branch; play the best move, or play to the end of the hovered variation | 7.2 Variation tree panel; 7.5 Let the AI play its best move | Later · P2 and P4 | Interface design 6 stores the hovered line with Enter. Clicking to play is P2 (roadmap decision O1). |
| H9 | 小棋盘 (`Menu.subBoard`); 变化图 (`Menu.subBoardShowVar`) | Sub-board showing the best variation | 7.3 Sub-board | Later · P2 | |

### 3.6 Starting and pausing analysis

| # | LizzieYzy label (key) | English meaning | Charter row | Disposition | Notes |
|---|---|---|---|---|---|
| A1 | 开始/停止 分析 (`Menu.togglePonder`); 继续分析 (`BottomToolbar.analyse`); 暂停分析 (`BottomToolbar.pauseAnalyse`) | Start or stop analysis with Space; the toolbar button's two labels, "continue analysis" and "pause analysis" | 7.3 Start and pause analysis | Covered · P1 · M2 and M7 | M2: `analysis.resume` and `analysis.pause`. M7: the engine indicator toggles pause (interface design 4.1). LizzieYzy's Space key is not in the roadmap; proposed in G9. |
| A2 | `FirstUseSettings.maxAnalyzeTimeDiscribe` | When the limit is reached, analysis stops; Space or a new move continues it | 7.3 Start and pause analysis | Covered · P1 · M7, with G3 | Roadmap 3.4 stops at the cap and idles "until the user navigates". The indicator should show "stopped at limit" apart from "paused", and the same control should resume it. |
| A3 | 选点分析控制 (`Menu.showAnalyzeController`); 分析 (`Menu.lblShowAnalyze`); 选点显示控制 (`Menu.showCandidateController`) | Two toolbar controls: whether analysis runs, and whether candidates are shown | 7.3 Start and pause analysis | Covered · P1 · M7, with C6 | LizzieYzy separates running from showing. Aji needs the same separation: pause is the indicator, hide is G7. |
| A4 | 自动分析 (`Menu.autoAnalyze`); 闪电分析 (`Menu.flashAnalyzeAllGame`); `StartAnaDialog.*`; `AnalysisSettings.*`; `WaitForAnalysis.*` | Whole-game analysis with a start move, end move, per-move limits, and options to analyse Black only or White only | 7.4 Whole-game analysis | Later · P2 (L3) | The charter row names whole game, a range of moves and all branches. "Only Black's or only White's moves" is not listed. It is how a player reviews their own play. |
| A5 | 批量分析 (`Menu.batchAnalyze`); 批量分析进度表 (`Menu.batchAnalyzeTable`) | Batch analysis of many games, with a progress table | 7.4 Batch analysis | Later · P5 | |
| A6 | 波动过大时加强分析 (`StartAnaDialog.lblDiffAnalyze`) | Re-analyse deeper when a move swings a lot | 7.4 Automatic deeper analysis | Later · P5 | |
| A7 | `LizzieFrame.display.pondering`; `LizzieFrame.speedUnit`; `LizzieFrame.visits` | Status text: analysis on or off, visits per second, visits | 7.3 Start and pause analysis | Covered · P1 · M7 | Interface design 4.1: the indicator, with version and visits per second on hover. |

### 3.7 Interface language, high-DPI, first run, about

| # | LizzieYzy label (key) | English meaning | Charter row | Disposition | Notes |
|---|---|---|---|---|---|
| I1 | 语言 (`menu.language`); 默认 (`menu.language.default`) | Interface language: default, Chinese, English, Korean, Japanese | 7.9 Simplified Chinese and English; 7.9 More languages | Covered · P1 · M1 and M5; Korean and Japanese Later · P8 | M1 already detects the OS language and ships both locales. M5 adds the switch. LizzieYzy applies a change only after a restart (`Lizzie.hint.restart`); Aji can switch live. |
| I2 | 语言(Language) (`FirstUseSettings.lblLanguage`) | The first thing asked at first run | 7.9 First-run wizard | Covered differently · P1 · M1 and M5 | Aji detects the OS language and the wizard has no language step (interface design 7). If the guess is wrong the user needs a way to change it mid-wizard. See K2 in section 5. |
| I3 | 界面字体大小 (`menu.frameFontSize`, `SetFrameFontSize.*`) | Interface text size: small, medium, large or a value from 12 to 20; applied after a restart | none | **Gap** · P2 (L7) | The charter's High-DPI row covers sharp rendering, not a user-chosen text size. Propose a P2 setting for interface scale. |
| I4 | (no label) high-DPI handling | Scale factors are detected at start-up in code; the font size above is the manual fallback | 7.9 High-DPI support | Covered · P1 · M5, plus Gap G11 | Roadmap M5 redraws the canvas when the device pixel ratio changes. Roadmap M8's checklist has no DPI check. Proposed as G11: test 100, 150 and 200 percent and dragging the window between screens of different scale. |
| I5 | 界面外观 (`menu.frameLooks`); 系统默认 (`menu.frameLooksSystem`); 界面样式 (`FirstUseSettings.lblLooks`) | Switch between the system look and Java's own look, with a help text about clipped buttons | none | Not a feature | A Swing look-and-feel switch. |
| I6 | 主题 (`Menu.theme`); `ConfigDialog2.addTheme`, `ConfigDialog2.lblBestMoveColor` | Themes: user-created, with colours and background, board and stone images | 7.9 Light and dark themes; board and stone styles | Later · P2 (L7) | Interface design 9 moves light and dark into P1. User-made themes with their own images are not in the charter; decide at the start of P2. |
| I7 | 初始化设置 (`Menu.initSettings`); `FirstUseSettings.*` | The first-run form, reopenable from the menu | 7.9 First-run wizard | See section 4 | It asks about preferences, not about installing an engine. It fires on first load, and again when the computer's host name changes (a portable copy moved to another PC). |
| I8 | 总在最前 (`Menu.alwaysOnTop`) | Keep the window on top | 7.9 Always on top | Later · P2 | |
| I9 | 默认模式 (`Menu.defaultView`); 经典模式 (`Menu.classicView`); 精简模式 (`Menu.minView`); 思考模式 (`Menu.extraMode3`); 四方图模式 (`Menu.extraMode1`); 重置界面位置 (`Menu.deletePersistFile`) | Layout presets and a reset of window positions | 7.9 Dockable, resizable panel layout with presets | Later · P2 | P1's panel is fixed (interface design 4). |
| I10 | 顶部工具栏 (`Menu.topToolBar`); 底部工具栏 (`Menu.bottomToolBar`); 自定义内容 (`Menu.customToolbar`) | Where the toolbars sit, and which buttons they show | none | Covered differently · P1 | Aji has no toolbar by design (interface design 1 and 4). Each toolbar button is accounted for as a feature, either in section 3 or in section 2.3. |
| I11 | 简介 (`Menu.introduction`); 关于 (`Menu.about`) | Manual (a PDF) and the about dialog | 8 Phase 8: user documentation | **Gap** · P1 · M5 | Aji needs somewhere to show the AGPL-3.0-or-later notice with a source link (the network clause matters once Phase 3 opens a port), and the notices for KataGo, the networks (charter 3: redistributable with their copyright notice) and the bundled OFL fonts. Proposed as G4. The manual itself is P8. |
| I12 | 检查更新 (`Menu.checkUpdate`); `CheckVersion.*` | Check for updates, with a daily automatic check and a backup download link | 7.1 Update notices; 8 Phase 8 auto-update | Later · P8 | |
| I13 | 退出 (`Menu.exit`); 强制退出 (`Menu.forceExit`) | Exit; force exit | none | Exit: Covered · P1 · M2. Force exit: Not a feature | M2's exit check is "quitting Aji leaves no KataGo process behind". If that holds, a separate force-exit entry has no job to do. |
| I14 | 播放落子声 (`Menu.playSound`) | Stone sounds | 7.5 Stone sounds | Later · P4 | |
| I15 | 所有命令 (`FastCommands.title`); `LizzieFrame.commands.*` | The list of all keyboard and mouse commands (44 entries), also shown by holding X | 7.9 Full keyboard shortcuts | Later · P2 | The list is the source for the P2 LizzieYzy-compatible preset. |
| I16 | 快速启动 (`Menu.quickLinks`); `OtherPrograms.*` | A quick-launch list of external programs | none | 7.10+ | Not a Go feature. Proposed as part of X1. |

## 4. The first-run form, question by question

LizzieYzy's first-run form (`FirstUseSettings`) has twelve questions and one hint. Its trigger is the first load, or a change of host name. It never installs an engine: with no engine configured LizzieYzy runs in "empty engine" mode (`Lizzie.engineFailed`). Aji's wizard does the engine part (charter 6.3 and interface design 7), so the question is which of LizzieYzy's preference questions survive.

| Question | Label (key) | Disposition in Aji |
|---|---|---|
| Interface look | 界面样式 (`FirstUseSettings.lblLooks`) | Not a feature (I5). |
| Language | 语言(Language) (`FirstUseSettings.lblLanguage`) | OS detection (M1), a switch in settings (M5), reachable during the wizard (K2 in section 5). |
| Which fields appear on a candidate | 选点信息 (`FirstUseSettings.lblSuggestionInfo`) | An M5 setting for the two disc lines (C1). |
| Maximum analysis per move | 单步最大分析限制 (`FirstUseSettings.lblMaxAnalyzeTime`) | G3: an M5 setting for visits per position. |
| Wheel hint | `FirstUseSettings.lblHint` | Wheel works in M6. A one-time hint is optional (K7 in section 5). |
| Variation visits left | 变化图剩余计算量 (`FirstUseSettings.lblShowPvVists`) | Later · P2 (H6). |
| Hover behaviour on a candidate | 鼠标悬停在选点上时,变化图 (`FirstUseSettings.lblMouseOverSuggestion`) | Fixed: freeze while hovering (H2). No setting. |
| Hover behaviour on the sub-board | 鼠标悬停在小棋盘上时,小棋盘 (`FirstUseSettings.lblMouseOverSubboard`) | Later · P2 (H9). |
| Limit on candidates | 限制选点个数 (`FirstUseSettings.lblLimitSuggestion`) | M7 plan default (C2). |
| Limit on variation length | 限制变化图长度 (`FirstUseSettings.lblLimitVariation`) | M7 plan default (H5). |
| Score on the board | 目数在选点上显示为 (`FirstUseSettings.lblShowScore`) | Later · P2 (C8). Fixed in P1. |
| Win-rate and score perspective | 胜率(目数)视角 (`FirstUseSettings.lblWinratePerspective`) | Later · P2 (C9). Fixed to Black in P1. |
| Cache on or off | 是否启用Lizzie缓存 (`FirstUseSettings.lblLizzieCache`) | Always on (C16). |

One behaviour worth noting. A host-name change makes LizzieYzy run first-run again, because its settings travel with a portable copy. Aji's settings and engines live in per-user OS folders (roadmap 3.3), so that case does not arise. What must still work is the neighbouring case: an installed engine that stops starting after a driver or hardware change must lead back to the wizard or the fallback of charter 6.6. Roadmap M4 and M5 already cover this.

## 5. Notes for the milestone plans

These need no approval. They are details the M2, M5, M6 and M7 plans should settle, found while reading the entries.

| # | Milestone | Note |
|---|---|---|
| K1 | M2, M6 | **Default rules.** Pick the rules used on the empty board (M2) and for an SGF with no `RU` property (M6). LizzieYzy falls back to Chinese rules (E15). |
| K2 | M5 | **Language inside the wizard.** Make the language switch reachable while the wizard runs, since the OS guess can be wrong and the wizard has no language step. |
| K3 | M6 | **Opening behaviour.** Decide whether a loaded game shows the first or the last move (F13). Several files dropped at once: open the first and say the rest were ignored (F10). Files with variations: navigate the main line, keep the branches on save (N6). |
| K4 | M6 | **Keys.** Aji's arrows are inverted relative to LizzieYzy (N2). Say so in the v0.1.0 notes until the P2 compatibility preset exists. The game title (F17) shows the file name or the players: decide. |
| K5 | M7 | **Hover preview.** Freeze the previewed line while the pointer stays on a candidate (H2). Decide the variation length limit (H5) and the keys for the preview (H4). |
| K6 | M7 | **Indicator states.** Distinguish "paused" from "stopped at limit" (A2). |
| K7 | M6, M7 | **Small hints.** Reject invalid input in the move-number box with a message (N3). Optionally show a one-time hint that the wheel steps through the game (N4). |

## 6. Additions for the owner to approve

All are **[Proposed]**. Nothing here changes the charter or the roadmap until the owner says so.

### Phase 1 additions

| # | Change | Where | From | Milestone |
|---|---|---|---|---|
| G1 | Engine lifecycle: restart, stop (free GPU memory), and detect a hung engine | New 7.1 row, Phase 1 | E10, E11, E12 | M2 (protocol and watchdog), M5 (buttons in settings) |
| G2 | Run without an engine: the wizard gets a "skip for now" that opens the app with analysis off, so a game can still be opened and navigated | 7.9 First-run wizard; roadmap M5 | E8 | M5 |
| G3 | Analysis limit as a visible setting: visits per position, 0 for no limit, plus a "stopped at limit" indicator state that the same control resumes. Time limits and play limits stay in Phase 4 | Split 7.1 Engine parameters; roadmap M5 settings and M7 | E18, A2 | M5, M7 |
| G4 | An About screen: version, AGPL-3.0-or-later and the source link, notices for KataGo, the networks and the bundled fonts | New 7.9 row, Phase 1 | I11 | M5 |
| G5 | "New empty game" | Add to the 7.2 Phase 1 row (roadmap M6 already has `game.new`) | F11 | M6 |
| G6 | Tygem `.gib` files: the owner confirms which format the Tygem files for S4 are. If `.gib`, add "open `.gib`" to 7.2 Phase 1; if SGF, add it to 7.2 in Phase 2 | 7.2; roadmap S4 and M6 | F9 | M6 |
| G7 | Show or hide candidates on the board, and hold a key to hide them, while analysis keeps running | New 7.3 row, Phase 1 | C6, A3 | M7 |
| G8 | Say what "replay" means: a timed replay of the hovered variation at a set interval, in addition to stepping through it with the wheel | 7.3 hover row; roadmap M7 | H3 | M7 |
| G9 | Phase 1 keys: PageUp and PageDown move ten moves (M6); Space pauses and resumes analysis (M7) | 7.2 navigation row; 7.3 start and pause row | N5, A1 | M6, M7 |
| G10 | Add a LizzieYzy-analysed SGF (with `LZ`, `LZOP`, `LZ2`, `LZOP2`) to the S4 fixtures, so M6's round-trip tests prove that a Phase 1 save keeps the analysis | Roadmap S4 and M6 | F18 | M6 |
| G11 | Add a DPI check to the M8 acceptance list: 100, 150 and 200 percent, and moving the window between screens of different scale | Roadmap M8 | I4 | M8 |
| G12 | **Question, not a gap:** can Aji's two disc lines be any two of win rate, score lead and visits? LizzieYzy allows one to three lines from those fields | Roadmap M5 settings | C1 | M5 |

### Addition to 7.10

| # | Change | From |
|---|---|---|
| X1 | Add a bullet: no integration with third-party cloud engine services (such as ikatago), and no quick-launch list of external programs. Aji's own remote access (6.4) is the route | E6, I16 |

### Later-phase additions

These are recorded now. Each phase's own start-of-phase check will re-read them.

| # | Phase | Change | From |
|---|---|---|---|
| L1 | 2 | 7.1 profiles: a profile may point at an existing KataGo binary, model and config | E3 |
| L2 | 4 | 7.1 Engine parameters: add root policy temperature | E16 |
| L3 | 2 | 7.4 Whole-game analysis: add "only Black's or only White's moves" | A4 |
| L4 | 2 | 7.2: an unsaved-changes prompt on close, open and new once editing exists; decide whether the last session is restored at launch | F8, F15 |
| L5 | 2 | 7.3 hover variation: visits along the line | H6 |
| L6 | 5 | 7.3 Analysis region control: "analyse this point with priority" | C14 |
| L7 | 2 | 7.9: an interface scale or text size setting; a decision on user-made themes with their own images | I3, I6 |
| L8 | 2 | 7.3 or 7.4: a "clear analysis" command for the cache | C16 |
