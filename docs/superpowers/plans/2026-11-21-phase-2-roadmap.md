# Phase 2 Development Plan: Review Core

- Date: 2026-11-21
- Status: Approved by the owner on 2026-11-21, with the proposed defaults of decisions P3 to P12. P1 and P2 are designs that go to the owner at the start of M1
- Specs: [project charter](../specs/2026-11-19-aji-project-charter-design.md) (source of truth), [interface design](../specs/2026-11-19-aji-ui-design.md)
- Inputs: [Phase 2 LizzieYzy menu check](../../audits/phase-2-lizzieyzy-menu.md), [Phase 1 deferred items](../../backlog/phase-1-deferred.md), [Phase 1 plan](2026-11-19-phase-1-roadmap.md)
- Markers follow the charter: **[Decided]**, **[Proposed]**, **[To verify]**.

This is the phase-level plan. It splits Phase 2 into four milestones, orders them, and names what each must prove before the next starts. Each milestone gets its own design and detailed plan when it starts, as in Phase 1. This document does not design the panel system, the cache schema or the editing tools. It fixes the order, the boundaries between milestones, and the few decisions that cross them.

## 1. What Phase 2 must deliver

**Acceptance (charter section 8, verbatim):** daily review no longer needs LizzieYzy.

The owner judges it against their own habits (charter D3). Before Phase 2 the owner was asked for the features they use every day. They agreed to the whole Phase 2 list instead of naming a subset (owner, 2026-11-21), so every item below counts toward acceptance and no item goes first for that reason. **[Decided]**

**The two machines** are the ones from Phase 1: the Windows PC with the RTX 5070, and the development Mac (Apple M5). **[Proposed]** Each milestone's exit is checked on the Mac with a local build. The PC is checked at Phase 2 acceptance (M4), as in Phase 1, where the Windows check waited for M8.

**In scope** (charter section 7, every row marked Phase 2, minus the three removed below):

- **7.1 Engine:** several engine profiles with one-click switching; rules, komi and board size, including sizes other than 19×19; the engine log and raw protocol console.
- **7.2 Board and records:**
  - coordinates and move-number options;
  - the variation tree;
  - the comment panel;
  - markup and freehand drawing;
  - setup mode;
  - try-out;
  - board view rotation and reflection;
  - game information editing;
  - save options, and save with analysis;
  - screenshots;
  - return to a stone's move from its menu;
  - auto-replay;
  - saving and restoring a working session.
- **7.3 Live analysis:**
  - the candidate list panel;
  - the next-move hint;
  - ownership and territory display;
  - position estimate and final scoring;
  - the sub-board;
  - the perspective and score options.
- **7.4 Whole-game analysis:** whole-game analysis (whole game, a range of moves, all branches), persisted results, the boost pass for big swings (moved from Phase 5 in M2), and the swing list.
- **7.9 Interface:** selectable board and stone styles; dockable, resizable layouts with presets; customisable shortcuts with a LizzieYzy preset; always on top.
- **Charter section 8:** layouts and the board component adapt to small screens and touch, so Phase 3 does not rework them.
- **Additions from the menu check**, once the owner approves them (section 9).

**Removed from Phase 2 and from Aji (owner, 2026-11-21) [Decided]:**

- the policy heatmap (first instinct) and the post-search heatmap;
- raw network mode (no search);
- pasting a game from the clipboard, and copying a game to the clipboard.

These move to charter 7.10 with the reason "the maintainer's decision, 2026-11-21". Copying a screenshot image to the clipboard (7.2, screenshots) is a different feature and stays.

**Already done in Phase 1:** the winrate graph with click to jump, and the candidate table (M7). The owner had the graph's mistake bars removed in M7 (M7 design 13.2), so whether they come back is decision P8. Phase 2 turns the table into the sortable candidate list panel.

## 2. Approaches

| | Layout first | Analysis first |
|---|---|---|
| Order | M1 panel system, small screens, touch, board styles. Then analysis, editing, the rest. | M1 whole-game analysis and cache. Then editing, the rest, and layout last. |
| Gains | Every new panel (candidate list, variation tree, comments, sub-board, console) is built once, inside the panel system. Touch is designed in from the first milestone. | The owner's review improves from the first milestone. |
| Costs | M1 changes little about how a review feels. | The panels of M1 to M3 are built against today's fixed right panel and rebuilt in M4, and touch equivalents are retrofitted. |

**The owner chose layout first (2026-11-21). [Decided]** The charter's own condition decided it: Phase 3 must not rework the layouts, so they are built once, before the panels that live in them.

A third order, by the owner's daily-use list, was not available: the owner agreed to the whole list (section 1).

## 3. Decisions for the owner

| ID | Decision | Proposed default | Needed by |
|---|---|---|---|
| P1 | The board and stone visual design. The charter (section 10) owes the owner a draft before Phase 2 starts | Drawn at the start of M1 with the layout mockups and shown before anything is built | M1 |
| P2 | The layout presets and the small-screen layout | Mockups at the start of M1. The presets follow LizzieYzy's modes as far as the interface design's principles allow (section 4.1) | M1 |
| P3 | Which side the candidate discs show (backlog, first item) | The discs and the candidate list show the side to move. The bar and the graph keep the colour the user picks, so the graph does not zigzag | M1 |
| P4 | Whether a game is analysed in the background as soon as it opens | Off by default, one click to start; a setting turns it on | M2 |
| P5 | Where the analysis cache lives and how large it may grow | One SQLite file in the local data folder, with a size cap in settings and a "clear analysis" command | M2 |
| P6 | Whether the last session is restored at launch (audit P2-G3) | Ask on the first launch after a session was left open, then remember the answer | M4 |
| P7 | The Phase 2 release | `v0.2.0`, built and released like `v0.1.0` after the M4 acceptance walk. No releases between milestones | M4 |
| P8 | Mistake bars on the trend graph (audit P2-Q3). M7 removed them at the owner's request | They stay out. M2 builds the loss thresholds for the swing list only (move-quality marks were dropped at the owner's request, 2026-11-23) | M2 |
| P9 | The swing list: each side's biggest drops, click to jump (audit P2-G7, P2-Q4) | In Phase 2, in M2, since whole-game analysis feeds it | M2 |
| P10 | Try-out (audit P2-Q1) | **Settled in M3.** V or the edit-row button starts a temporary variation. End try-out discards the temporary moves in one step. Keep as branch saves a line with the record | M3 |
| P11 | Markup (audit P2-Q2) | **Settled in M3.** Triangles, squares, circles, crosses, letters and numbers belong to the node and save in SGF. Freehand strokes stay on screen | M3 |
| P12 | User-made board and stone images (audit P2-Q5) | Built-in styles only in Phase 2; importing one's own images is left for Phase 8 | M1 |

Interface areas the interface design has not drawn yet (its section 8) get a design that goes to the owner before they are built, as O7 did in Phase 1. Each milestone below names the ones it needs.

## 4. Architecture decisions for Phase 2

These are **[Proposed]**. Each milestone design restates the parts it uses.

### 4.1 Panels and layouts

- Every area of the right side becomes a panel with an id: the header row, the win-rate bar, the trend graph, the candidate list, the variation tree, comments, the sub-board, the engine console. The main board is not a panel; it is always present.
- **Extra boards are panels.** The board component draws any position it is given, so a board-view panel can appear more than once. The sub-board (the current best variation) is the first, and is built in M1. LizzieYzy's thinking mode (a second large board) and four-panel mode (three sub-boards) are presets made of board-view panels, as charter 7.9 lists them. **[Proposed, the author's call]**
- A layout is a serialisable tree of splits and tab groups that names panels by id. Presets are layouts that ship with Aji. A layout that names an unknown panel, or cannot be read, falls back to the default.
- **Client settings are stored by the interface, per client, not in the backend's settings.** A phone and the desktop show different layouts of the same engine (charter 6.1), and want different keymaps, scales and styles. M1 adds a client settings store, and these go in it: layouts, the keymap, board and stone styles, the interface scale, the perspective and score options, coordinates and the disc lines. Language and theme stay shared backend settings, because the desktop's native menu and dialogs need the language ([M1 design 5.8](../specs/2026-11-21-p2-m1-layout-design.md)). The display settings in today's backend `UiSettings` (`src-tauri/src/settings.rs`) move there in M1, once, so Phase 3 does not move them again. Engine and analysis settings (the visit limit, profiles, the cache cap) stay in the backend, shared by every client. The desktop keeps client settings in the webview's storage, or in a file through `PlatformFiles` **[To verify]**. **[Proposed, the author's call]**
- The interface design's principles still hold. Principle 1: no panel takes vertical space from the board on a landscape screen. Principle 4: one surface divided by hairlines, not floating cards. A docked layout is several panels side by side or stacked in that surface. Floating windows are not in Phase 2; the charter's floating board is Phase 6.
- **Small screens.** Below a width breakpoint, the board takes the full width and the panels sit below it, as tabs. This is a layout of its own, designed for touch, not the desktop layout shrunk (charter 7.7). Phase 2 builds and tests it in the desktop window and in a browser. Phase 3 serves it to phones.

### 4.2 Commands and input

- Every user action becomes a named command: navigate, play, undo, toggle a panel, start analysis. Keys, menus, buttons and touch gestures all call commands.
- A keymap binds keys to commands. M1 moves today's hard-coded keys onto it. M4 adds the editor and the LizzieYzy preset, so no milestone hard-codes keys that M4 must find later.
- **Every action has a touch path.** An action reached only by hover, right-click, the wheel or a key also needs a tap, a long press or a visible control. Each milestone's exit checks this for what it adds. Examples: the hovered candidate's line (M1), the right-click menus (M3), dragging stones in setup mode (M3).
- **The board's touch gestures are fixed in M1 for all of Phase 2.** A tap on a candidate shows its line, as hover does with a mouse. A second tap on the same candidate plays it, as a click does (interface design section 6, built in M3). A tap on an empty point plays there (M3). A long press opens the menu a right-click opens (M3). A swipe across the board steps through the shown line, or through the game when no line shows. M1 builds the first and the last; M3 adds the rest without changing them. **[Proposed, the author's call]**

### 4.3 The analysis cache

- Results persist in SQLite in the backend, replacing Phase 1's in-memory cache (charter 6.7). The library is chosen in M2 (for example `rusqlite` with its bundled SQLite, MIT).
- **The key is the position plus the engine identity, complete from M2,** so M3 and M4 never migrate or wipe the cache.
  - **The position:** `PositionKey` already hashes size, komi, setup stones and moves, but stores the rules as one of four presets (`rules_byte` in `crates/aji-core/src/position.rs`). M2 makes the key carry KataGo's full rule set (ko, scoring, suicide, tax, handicap bonus, button), although the interface offers only the presets until M3 edits them.
  - **The engine identity:** the network's digest, plus a hash of the config settings that change search results. A profile with the user's own config (M4, audit P2-G1) then gets its own rows. Whether the KataGo version also counts is decided in M2.
  - **[Proposed, the author's call]**
- Ownership is requested and stored in M2, because it changes the size of every row. M2 decides whether the whole map or a summary is kept for every position.
- Whole-game analysis is a queue in the backend. The position the user is looking at always goes first, and the queue skips positions already analysed to the target visits.
- The interface never reads the cache directly. It gets results through the existing `rpc` and events, as a remote client will (charter 6.1).

### 4.4 Editing in the backend

- Editing extends `GameSession`: play a move (creating or entering a variation), delete and promote branches, set up stones, markup, comments and game information. The interface sends commands and renders snapshots, as in Phase 1 (decision O2).
- Undo and redo live in the backend, so a remote client sees the same history.
- The session tracks unsaved changes. Open, new and quit ask before discarding them (audit P2-G3).
- Saving keeps unknown SGF properties and comments, as in Phase 1. "Save with analysis" is a separate export (charter 6.7).

## 5. Milestones

| | Milestone | Proves | Depends on |
|---|---|---|---|
| M1 | Layout, board styles and input | Today's screen runs inside the panel system, with the sub-board. It works at phone width with touch, and the board and stones have their new styles | — |
| M2 | Whole-game analysis and cache | A game is analysed once and remembered. The candidate list, swing list, next-move hint and ownership come from that analysis | M1 |
| M3 | Game editing | A review can branch, comment, mark up and set up positions, with undo, and save cleanly | M1, M2 |
| M4 | Engines, shortcuts, session, acceptance | Engine profiles and the console, the shortcut editor and sessions. Phase 2 acceptance on both machines, and `v0.2.0` | M1, M2, M3 |

```
M1 ──► M2 ──► M3 ──► M4 ──► acceptance, v0.2.0
```

The order is linear. M3 depends on M2 because whole-game analysis of all branches, and the graph stepping by node, need both the tree and the queue. The `aji-core` editing work of M3 touches no other crate. It can start once M2's cache design is settled, if the M2 plan has room.

One branch per milestone, for example `feat/p2-m1-layout`. Each ends with CI green and its exit checked. Finished branches merge locally; the owner decides the target (`dev` or `main`) for each.

## 6. Milestone details

### M1. Layout, board styles and input

**Status:** built on 2026-11-22. Detailed plan and design: [2026-11-21-phase-2-m1-layout.md](2026-11-21-phase-2-m1-layout.md), [the M1 design](../specs/2026-11-21-p2-m1-layout-design.md). The exit check results and what is left for the built app are in the plan's Status.

**Before building, to the owner:**

- the board and stone visual designs (P1);
- the layout mockups: presets and the small-screen layout (P2);
- the menu check's Phase 2 additions (section 9).

**Build:**

- **The panel system** (4.1): the split and tab tree, resizing by dragging the hairlines, moving a panel to another place, hiding and showing panels. Today's header row, win-rate bar, trend graph and candidate table become the first panels. The presets, and a reset to the default layout.
- **The small-screen layout** (4.1), and the touch paths for everything Phase 1 shipped:
  - a tap on a candidate shows its line, and the line steps by tapping or swiping;
  - navigation by swipe and buttons;
  - Phase 1's hold-Z peek gets a touch control.
- **Board and stone styles:** the new designs, with at least two selectable sets in each theme (P12). An interface scale setting, applied without a restart (audit P2-G5).
- **Capture counts** for both sides (audit P2-G9).
- **Commands and keymap** (4.2): today's keys move onto it; nothing new is bound by hand.
- **The side to move's view** (P3, backlog first item), and the 7.3 perspective and score options.
- **The sub-board** (4.1): a board-view panel showing the current best variation. It is needed by the thinking and four-panel presets.
- **Screenshots:** save or copy the board, the sub-board and the graph as an image (charter 7.2).
- **Always on top** (desktop only).
- **Backlog items in code M1 touches:**
  - M7 minor 7 (the wheel over a table row);
  - M7 minor 9 (Z sticking on macOS);
  - M7 minor 10 (font loading);
  - M7 minor 12's locale-aware bar and the "0.0" lead;
  - M5 minor 1 (a failed settings save gives no message);
  - M5 minor 5 (the first frame before settings arrive).

**Exit (Mac):**

- Panels can be rearranged, and each preset applies. A restart keeps the layout, and a corrupted layout falls back to the default.
- Narrowing the window to phone width switches to the small-screen layout. The same build runs in a browser with the fake transport at 375×812 with touch emulation, and every Phase 1 action works by touch.
- The styles switch in both themes. A screenshot of the board and the graph saves.

### M2. Whole-game analysis and cache

**Before building, to the owner:** the designs for the whole-game analysis controls and progress, the next-move hint, and the ownership display (interface design section 8). Move-quality marks were dropped at the owner's request (2026-11-23, P2 M2 design 12).

**Build:**

- **The persisted cache** (4.3) with its size cap and "clear analysis" for a position or the whole game (P5, audit P2-G6). The engine identity is part of the key.
- **Whole-game analysis:** the main line, a range of moves, and only Black's or only White's moves (audit P2-G2). LizzieYzy runs it on a separate engine; Aji uses its one analysis engine. Background on open, per P4. It can be paused, shows progress, and puts the current position first. All branches come in M3.
- **The boost pass** (波动时加强, moved from Phase 5): after the job's first pass, moves whose loss passes a threshold are searched again with more visits. Mistake bars only if P8 brings them back.
- **The swing list** (P9, audit P2-G7): each side's biggest win-rate or score drops above a threshold, with "only after this move"; a click jumps to the move.
- **The candidate list panel:** sortable, with the fields of 7.3.
- The **next-move hint**.
- **Ownership and territory display**, in the styles the design settles. **Position estimate** (形势判断), and the count of **final scoring** (终局点目): the user marks dead stones and sees the result. Writing that result into the record (`RE`) comes in M3, with the game information editor and undo. **[Proposed, the author's call]**
- **LizzieYzy analysis import:** the `LZ` and `LZOP` properties are read into the cache when a file opens (charter 6.7). `LZ2` and `LZOP2` hold a second engine's analysis and wait for dual-engine mode in Phase 5 (audit P2-L2). LizzieYzy stores visits abbreviated (such as `1.2k`), so imported results are marked as imported, and any fresh analysis of the position replaces them. The importer confirms whose side each stored win rate is from. **Save with analysis** writes `LZ` and `LZOP`, so LizzieYzy reads Aji's analysis.
- **Backlog items in code M2 touches:**
  - M7 minor 2 (`continue_analysis` while a query is in flight);
  - M7 minor 8 (the trend race);
  - M7 minor 11's test gaps;
  - M7 minor 12's stored `previous_visits`;
  - M2 N3 (the throttle; re-check first).

**Exit (Mac):**

- With background analysis on open turned on (P4), a game opened for the first time is analysed in the background while the user navigates, and the current position always answers first.
- Quitting and reopening shows the whole graph and the swing list at once, with no new analysis.
- A record analysed in LizzieYzy shows its analysis in Aji. A record saved with analysis from Aji opens in LizzieYzy with its analysis.
- Ownership and the estimate show on a finished game.

### M3. Game editing

**Status:** Built and reviewed on 2026-11-24. The browser and native Mac checks passed, and Sabaki Web reopened the edited game. The arm64 app is ready for the maintainer's walk. Test results and outstanding physical-device checks are recorded in the [M3 plan](2026-11-24-phase-2-m3-editing.md).

**Before building, to the owner:** the designs for the variation tree and the variations section (interface design 4.4 and 5.4), the comment panel, the markup and setup tools, and the right-click menus (interface design section 6).

**Build:**

- **Playing moves on the board**, creating or entering variations (interface design section 6). The **variation tree** panel and the letter badges: move between branches, promote to the main line, delete a branch, and undo the delete.
- **Undo and redo** of every edit, and the **unsaved-changes prompt** (4.4, audit P2-G3).
- **The comment panel:** view and edit.
- **Markup tools** and freehand drawing, as P11 settles.
- **Setup mode:** add black or white stones, alternate, pass, insert a move, drag stones, change the side to move. Remove one stone, flip one stone's colour, and flatten the position into a new start (audit P2-G8).
- **Try-out** (试下), as P10 settles.
- **Board view:** rotate and flip.
- **Game information editing:** players, ranks, rules (including KataGo's full rule options, audit EN6), komi, result. Final scoring's count, from M2, can be written as the result. A board size for a new game, including the non-19 sizes Phase 1 opens.
- **Coordinates and move numbers:** all, the last N, and restarting the numbering inside a branch. A stone's menu returns to the move that placed it. Auto-replay steps through the current game line. The maintainer declined timed replay of a hovered line (P2-G11, charter 7.10).
- A setting for whether an opened record shows its first or its last move (audit P2-G12).
- **Save options:** keep or drop comments, and save one branch.
- **Whole-game analysis of all branches.** The trend graph steps by node, not by move number (M7 minor 4).
- **Backlog items in code M3 touches:**
  - M6 minor 2 (the komiUnreadable detail);
  - M6 minor 3 (the encodingGuessed title);
  - M6 minor 4 (Custom rules rewriting `KM`);
  - M6 minor 5 (missing recent files);
  - M6 minor 6 (a drop opens `paths[0]`);
  - M6 minor 9 (a header-only first game);
  - M6 minor 10 (`has_illegal` memory);
  - M7 minor 5 (PageDown on a trailing comment node);
  - M7 minor 6 (`next_move` skips `PL` nodes).

**Exit (Mac):**

- One of the owner's own games is reviewed with editing only: try-out lines, a promoted variation, comments, markup, a setup position.
- Every edit undoes.
- The game saves, and the file opens in another program with its branches and comments intact.
- Quitting with unsaved changes asks first.
- Each new action works by touch at phone width.

### M4. Engines, shortcuts, session and acceptance

**Before building, to the owner:** the designs for the engine profile list and the console, the shortcut editor, and the session save and restore.

**Build:**

- **Engine profiles:** several networks and parameter sets, switched in one click. A profile can point at a KataGo, model and config the user already has (audit P2-G1). LizzieYzy keeps separate engines for the estimate and for fast switching; Aji's profiles replace them with one engine at a time. Switching profiles never shows another network's cached results as current (4.3).
- **The engine log and raw protocol console.**
- **The shortcut editor** and the LizzieYzy-compatible preset (4.2). Mouse bindings are part of the scheme (right-click steps back, middle-click plays the best move), and holding a key shows a shortcut overview (audit P2-G10).
- **Saving and restoring a working session** (存档与读档), and restoring the last session at launch (P6, audit P2-G3). A session is the open game with its edits, the current node and the whole-game analysis state. Its analysis rows are copied into the session file, so the cache's size cap (P5) may still evict them from the cache. Layouts are not part of it; they belong to each client (4.1). **[Proposed, the author's call]**
- **Visits along the hovered line** (audit P2-G4).
- **Backlog items in code M4 touches:**
  - M2 N1 (no deadline after a kill; re-check first);
  - M5 minor 7 (Restart and Stop while starting);
  - M5 minor 10 (the declined-licence offer);
  - M5 minor 11 (`remove_unused` and import racing).
- **The Phase 2 coverage check:** every row of the menu check marked Phase 2 is delivered, or moved with the owner's agreement.
- **The acceptance walk** on the PC and the Mac, recorded in `docs/acceptance/phase-2.md`. Then `v0.2.0` (P7).

**Exit:** the owner does their daily reviews in Aji instead of LizzieYzy for a period they choose, on both machines, and accepts Phase 2. Anything that sent them back to LizzieYzy is fixed or recorded with their agreement.

## 7. Backlog items not taken into Phase 2

These stay in [`docs/backlog/phase-1-deferred.md`](../../backlog/phase-1-deferred.md): the Platforms (Phase 8) and CI items, the manifest generator items, R4 in full, the PC hardware capture, D1, and the engine-manager items that no milestone above touches. "(re-check)" items are checked in code before a milestone takes them.

## 8. Phase-level review focus

These are the inputs most likely to break Phase 2 for a real user, each with the milestone whose tests must cover it.

1. **A layout from an older version, or one that cannot be read.** Aji falls back to the default and does not fail to start. (M1)
2. **Actions that need hover, right-click, the wheel or a key.** Each has a touch path, checked at phone width. (M1 to M4)
3. **The cache file is corrupt, locked by a second Aji, or the disk is full.** Aji keeps analysing in memory and says why results are not kept. (M2)
4. **Results from another network or other rules.** They are never shown as current. (M2, M4)
5. **Editing or navigating while whole-game analysis runs.** The current position goes first, and no update for another position is drawn on it. (M2, M3)
6. **A large record:** hundreds of branches, long comments, or a 20 MB file. The tree panel stays responsive and memory stays bounded. (M3; M6 minor 10)
7. **Malformed or huge `LZ` properties.** The file still opens, and the bad analysis is skipped with a note. (M2)
8. **Saving after editing.** Unknown properties, comments and branches survive, and nothing is lost on quit without a prompt. (M3)

## 9. Additions from the menu check

The [Phase 2 menu check](../../audits/phase-2-lizzieyzy-menu.md) read the LizzieYzy entries for every Phase 2 area: 101 rows, plus 22 re-checks of Phase 1's open items. It found 12 gaps, 5 questions, 5 additions to 7.10, 3 charter wording fixes and 4 later-phase items. It also found that Phase 1's check filed LizzieYzy's candidate list window (选点列表, 21 `AnalysisFrame` keys) under Hawk-eye. It is the Phase 2 candidate list panel.

| Gap | Milestone |
|---|---|
| P2-G1 A profile from an existing KataGo, network and config | M4 |
| P2-G2 Analyse only Black's or only White's moves | M2 |
| P2-G3 The unsaved-changes prompt; the session at launch is P6 | M3, M4 |
| P2-G4 Visits along the hovered line | M4 |
| P2-G5 Interface scale | M1 |
| P2-G6 Clear analysis | M2 |
| P2-G7 The swing list (P9) | M2 |
| P2-G8 Setup extras: remove, flip, flatten | M3 |
| P2-G9 Capture counts | M1 |
| P2-G10 Mouse bindings and a held-key shortcut overview | M4 |
| P2-G11 Timed replay of the hovered line | Declined on 2026-11-23, charter 7.10 |
| P2-G12 Open a record at its first or last move | M3 |

The audit's questions are decisions P8 to P12 in section 3. Its later-phase items stay in the audit for those phases' checks.

## 10. Changes this plan makes to the charter

- **7.2:** the row "Paste a game from the clipboard; copy a game to the clipboard" is removed.
- **7.3:** the rows "Policy heatmap (first instinct) and post-search heatmap" and "Raw network mode (no search)" are removed.
- **7.10:** one bullet for the three, with the reason "the maintainer's decision, 2026-11-21" (audit P2-X1 to P2-X3).

Proposed by the menu check and applied with the owner's approval of this plan (2026-11-21):

- **7.10 (P2-X4):** square boards only, from 5×5 to 19×19; no rectangular boards and none above 19. KataGo's standard builds stop at 19, and LizzieYzy itself cannot rotate rectangular boards.
- **7.10 (P2-X5):** no Gomoku.
- **7.3 (P2-W1):** "blunder bars" leaves the winrate graph row, which M7 shipped without them, or moves to Phase 2 if P8 brings them back.
- **7.3 (P2-W2):** the candidate list row notes that Phase 1 shipped the table, and Phase 2 adds sorting, columns and docking.
- **7.2 (P2-W3):** "swap move order" in the setup row becomes "change the side to move", which is what LizzieYzy's entry does.
- **Section 9.1, D3:** answered. The owner agreed to the whole Phase 2 list rather than naming daily-use features.
- **Section 10:** the board and stone design moves to the start of M1 (P1).
