# Phase 2 M1 Design: Layout, Board Styles and Input

- Date: 2026-11-21
- Status: Approved by the owner on 2026-11-21
- Plan: [Phase 2 plan](../plans/2026-11-21-phase-2-roadmap.md), section 6, M1, and the cross-milestone decisions of its section 4
- Mockups, approved by the owner on 2026-11-21: [board and stone styles](../../design/mockups/p2-m1/board-styles.html) (decision P1), [layouts](../../design/mockups/p2-m1/layouts.html) (decision P2)
- Interface design: [aji-ui-design](2026-11-19-aji-ui-design.md). This design changes it where section 10 says.
- Markers follow the charter: **[Decided]** by the owner, **[Proposed]** by the author, **[To verify]**.

## 1. Intent

Phase 2 is planned layout first (plan section 2). The panels Phase 2 adds should be built once, inside a panel system that already works on small screens and with touch, so Phase 3 does not rework them. M1 builds that system and moves today's screen into it. It also adds the board and stone styles, and the smaller items that touch the same code.

M1 changes little about how a review feels. Its value is that M2 to M4 add panels and actions without touching layout, storage or input again.

## 2. Goals, non-goals, anti-goals

**Goals**

- Today's screen runs inside a panel system that can split, tab, resize, hide and move panels, with five presets.
- A phone-width layout, built and tested in a narrow window and in a browser with touch emulation.
- Four board and stone sets, chosen in settings.
- One command registry and keymap that every key goes through.
- The sub-board, screenshots, always on top, interface scale, capture counts, and the side to move's view on the discs.
- Settings that belong to one device are stored by that device.

**Non-goals**

- Floating or detached windows. The floating board is charter Phase 6.
- A shortcut editor. M4 adds it on top of M1's keymap.
- New analysis or editing panels: the candidate list's new features (M2), the variation tree and comments (M3), the console (M4). M1 leaves room for them.
- Serving the phone layout to a phone. That is Phase 3.
- Importing one's own board or stone images (decision P12).

**Anti-goals**: shipping any of these would be a failure, even if everything else works.

- Panels that look like floating cards, or tab bars and title rows on every panel. Interface design principle 4 is one surface divided by hairlines.
- Anything taking vertical space from the board on a landscape window (principle 1).
- An action that works with a mouse but not by touch at phone width.
- A layout that cannot be read stopping Aji from starting.

## 3. Constraints

- The interface never assumes the engine is local (charter 6.1). Layouts and other device settings live in the interface, not in the backend.
- Every user-visible string goes through i18n, in `zh-CN` and `en`.
- New dependencies must have AGPL-compatible licences. M1 plans none.
- The board stays a square sized by the window. Phase 1's sizing (`src/layout/frame.ts`) is the rule for the board slot.

## 4. Approaches

### 4.1 The panel system

| | A. Our own split-and-tab tree **(chosen)** | B. A docking library (such as dockview or FlexLayout) |
|---|---|---|
| What | A small layout tree in our code. Pointer events handle resizing and dragging. | A library that already does splits, tabs, drag-to-dock and serialisation. |
| Gains | The approved look exactly. Touch works the same as a mouse. A layout format we control. Only the features we need. | Less code up front; drag edge cases already solved. |
| Costs | More M1 work (roughly 600 to 900 lines plus tests), and we find the drag edge cases ourselves. | Its tab bars and headers fight the hairline look. Its drag usually relies on HTML drag-and-drop, which does not fire on touch screens. Saved layouts would be in its format, which Phase 3 would then depend on. |

**The owner chose A (2026-11-21). [Decided]** A library would save least on exactly what M1 is for: the look and touch.

### 4.2 Where device settings are kept

| | A. The webview's `localStorage`, behind an interface **(proposed)** | B. A file written by a Tauri plugin |
|---|---|---|
| Gains | One implementation for the desktop and Phase 3's browser client. No new dependency. | A visible file in the config folder, easy to back up. |
| Costs | Whether it survives app updates must be checked on each OS **[To verify]**. | Desktop-only, so Phase 3 needs a second implementation anyway. Adds a dependency. |

**[Proposed]** A. M1's plan checks persistence across an app update on the Mac first. Windows is checked at the Phase 2 acceptance walk, as other Windows checks are. If either fails, the same interface switches to B; nothing outside the store changes.

## 5. Design

### 5.1 The layout model

A layout describes the whole window around the board:

```ts
type PanelKind = 'header' | 'winrate' | 'trend' | 'candidates' | 'subboard';
type PanelRef = {
  kind: PanelKind;
  rank?: 1 | 2 | 3;      // a sub-board's candidate
  maxRows?: number;      // a list panel's row limit (Minimal's candidates)
};
type Node =
  | { type: 'board' }                                   // exactly one, in the root row
  | { type: 'panel'; panel: PanelRef }
  | { type: 'tabs'; panels: PanelRef[]; active: number }
  | { type: 'split'; dir: 'row' | 'column'; children: Node[]; weights: number[] };
type Hidden = { panel: PanelRef; besides: PanelRef | null; side: 'before' | 'after' };
type Layout = {
  version: 1;
  preset: PresetId | 'custom';
  root: Node;
  hidden: Hidden[];                       // hidden panels, and where each goes back
  lines: 'board' | 'subboard';            // where a hovered candidate's line is drawn
};
```

- **Hidden panels** are kept in `hidden` with the panel they sat beside. Showing one again puts it back beside that panel, or at the end of the header's column if that panel is gone too. **[Proposed]**
- **`lines`** says where a hovered candidate's line is drawn: on the main board (every preset but Thinking), or on the first sub-board (Thinking, whose main board keeps its discs and never shows numbered stones, layouts mockup section 4). **[Proposed]**
- **The root is a row** that contains the board node exactly once, with columns on either side. The board's width is not a weight: it is the square the window allows (`computeFrame`'s rule, generalised to the columns' minimum widths). The other children share the rest by weight.
- **Panels have minimum sizes.** If the columns' minimum widths cannot fit, the board shrinks first, down to a floor of 320 px. Below that floor the narrow arrangement takes over (5.5).
- **Validation.** Reading a layout:
  - drops unknown panels and duplicate panels;
  - removes empty tabs and splits, and normalises the weights;
  - falls back to the default preset if no board node is left, or nothing parses.
  - It never throws. It is a pure function, tested on malformed input (plan review focus 1).
- **M1's panels.**

| Panel | Holds | Can be hidden |
|---|---|---|
| `header` | The header row, plus the notice line and engine status under it | No |
| `winrate` | The win-rate bar | Yes |
| `trend` | The graph with its legend and capture counts (5.9) | Yes |
| `candidates` | The candidate table | Yes |
| `subboard` | A board showing a candidate's line (5.6); `rank` 1, 2 or 3 | Yes |

- The version line leaves the main screen. It is on the About page already. **[Proposed]**
- M2 to M4 add kinds (`swings`, `tree`, `comments`, `console`) by registering them. M1 builds no placeholders.
- **The panel registry** maps a kind to its component, its label key, its minimum width and height, and whether it may be hidden. A panel that has nothing to show folds to zero height, as the variations section does today (interface design 4.4). M1's panels never fold; M3's tree will.
- **The wizard and settings** are not panels. While open, they take the whole area beside the board, as today. They use the column width the layout gives the header's column, at least 360 px. In the narrow arrangement they cover the whole window as a sheet with a close control (5.5). **[Proposed]**

### 5.2 Presets

These are as drawn in the layouts mockup. The window widths are examples.

| Preset | Root row |
|---|---|
| 默认 Default | board · column(header, winrate + trend, candidates) |
| 经典 Classic | column(winrate, trend) · board · column(header, candidates, subboard rank 1)¹ |
| 极简 Minimal | board · column(header, winrate, candidates limited to 3 rows) |
| 思考 Thinking | board · column(header, subboard rank 1, winrate, candidates); `lines: 'subboard'` |
| 四盘 Four boards | board · column(header, row(subboard 1, subboard 2), row(subboard 3, column(winrate, trend))) |

¹ The mockup's Classic puts the bar, the graph and comments on the left, and candidates and the tree on the right. After trying the built app the owner put the candidates above the sub-board on the right and kept the left for the bar and the graph, leaving room for more there later (owner, 2026-11-22). Comments and the tree arrive in M3, which places them.

- **Default is responsive.** While the layout is the untouched default, its column splits into two once it is wider than 760 px (layouts mockup, section 7): the analysis panels on the left, the record panels on the right. The record panels (tree, comments, sub-board) come from M3. In M1 the second column holds the sub-board. **[Proposed]**
- **Any drag, resize or hide makes the layout `custom`,** and fixes it as it is. Choosing a preset replaces it.
- Minimal's three-row limit is a panel option (`maxRows`), not a separate panel.

### 5.3 Rearranging

- **The grip.** A panel shows a grip at its top left while the pointer is over it. On a device whose primary pointer is coarse (`(pointer: coarse)`), the grips show at all times, faintly. Dragging a grip lifts the panel. The board has no grip.
- **Drop targets.** Over another panel, the outer quarter of each edge splits that place in that direction, and the middle adds the panel as a tab. Over the board, a band along its left or right edge (an eighth of its width) makes a new column on that side of the board; the rest of the board cancels the drop. A column whose last panel leaves is removed, and the board takes the room. **[Proposed]** A blue outline (`--accent`, a new theme token that is not the evaluation colour) shows where it would land.
- **Tabs** show a quiet tab row (layouts mockup, section 1). A panel alone in its place has no title row.
- **Resizing.** The hairline between two siblings is draggable with an 8 px hit area, or 20 px for a coarse pointer. Minimum sizes hold. A double-click or double-tap on a hairline evens the two sides.
- **Everything uses pointer events with pointer capture,** so mouse, pen and touch behave the same. HTML drag-and-drop is not used.
- **The 布局 menu**, in 设置 → 界面, and on Windows and in the browser in the header's 视图 button, offers (owner, 2026-11-22: the game menu keeps to the game):
  - the five presets;
  - a checkbox for each panel that can be hidden;
  - 恢复默认.
  - On macOS there is no 视图 button: the native menu bar's 显示 → 布局 has the presets. **[Decided]**
- Layout changes save within a second of the drag ending.

### 5.4 Rendering

- `layoutFrame(layout, width, height) → rects` is a pure function, like today's `computeFrame`. It returns the board's square and each visible panel's rectangle. The frame positions panels absolutely from it.
- Hairlines are drawn between siblings. Panels never get borders or rounded corners of their own.
- Panels are mounted once per kind and instance, and keep their state when moved.

### 5.5 The phone layout

- **When:** the window is taller than it is wide, or the board would fall below its 320 px floor in the layout (5.1). This is the only switch. A desktop window resized past it switches back and forth, so a narrow window tests it (plan M1 exit). **[Proposed]**
- **Two widths, one arrangement.** Narrower than 700 px, it is the phone arrangement below. From 700 px up (a tablet in portrait), the bottom navigation bar goes and the header keeps the full navigation; the first two tabs show side by side under the bar, and the tab strip appears only when there are more (layouts mockup, section 8, tablet). **[Proposed]**
- **Arrangement** (layouts mockup, section 8):
  - a header with the title, the move counter, the engine dot and ⚙ (settings);
  - the notice line and the engine status, when they have something to say, between the header and the board;
  - the board at the full width, minus 4 px each side;
  - the win-rate bar;
  - a tab strip of the layout's other visible panels, in layout order (trend as 走势, candidates as 候选, sub-boards as 副盘), and the active tab's panel under it;
  - a bar of large navigation buttons along the bottom.
- **The wizard, settings and About** open as a full-window sheet with a close control. First-run setup on a narrow window works in this sheet. `panelMode` decides what shows, as today; the narrow arrangement only changes where it shows. **[Proposed]**
- **It renders the same panels.** Whatever M2 to M4 register appears as a tab with no extra work.
- **The desktop layout is untouched by it.** The active tab is remembered separately.
- **Touch targets** are at least 44 px in this layout.
- **Board style.** A device that starts in the phone layout gets the printed board and flat stones as its default style (board styles mockup, section 3). A desktop window narrowed later keeps its style. **[Proposed]**

### 5.6 Touch gestures, and the sub-board

The board's gestures are fixed here for all of Phase 2 (plan 4.2). Pointer type comes from the pointer event, so a touchscreen laptop gets touch behaviour from a finger and mouse behaviour from the mouse.

| Gesture | M1 | Later |
|---|---|---|
| Tap a candidate | Shows its line, as hovering does. The line stays until a tap elsewhere or a navigation | — |
| Tap the shown candidate again | Nothing yet | M3: plays it, as a click does |
| Tap an empty point | Clears a shown line | M3: plays there |
| Swipe left or right across the board | Steps the shown line, or the game when no line shows. One step per 40 px | — |
| Long press | Nothing yet | M3: the menu a right-click opens |

- **Hiding candidates by touch.** The F toggle and the hold-Z peek get a touch control: an eye button at the right of the candidates panel's top. A tap toggles; press and hold peeks.
- **The sub-board** is a second `BoardCanvas` showing a candidate's line from the current position: the best one for rank 1, the second and third for ranks 2 and 3. Over it:
  - the wheel or a swipe steps the line;
  - the line restarts when the position changes or the candidate's first move changes. While it shows the whole line, it follows the analysis as the line deepens, at most twice a second. Once the user steps it, it is frozen, as a hovered line is (M7 design), until it restarts. **[Proposed]**
  - With the candidates hidden (F, or the Z peek), sub-boards show the bare position, so they do not give away the engine's answer. **[Proposed]**
  - It shows numbered stones as the hovered line does (M7 design), and no discs.
  - Clicking or tapping its label shows that line on the main board, as a hover would. The label names its rank only when the layout has more than one sub-board (owner, 2026-11-22).
  - A sub-board with no such candidate shows the position with a quiet "no candidate" line.
- `useWheelNavigation` and the board's hover handling are scoped to their own board instance, so two boards do not fight. **[Proposed]**

### 5.7 Board and stone styles

- **Boards:** honey (today's), kaya, walnut, printed. **Stones:** slate and shell (today's), Yunzi, flat. **Sets:**
  - honey with slate and shell;
  - kaya with Yunzi;
  - walnut with slate and shell;
  - printed with flat.
  - These are as approved in the board styles mockup. **[Decided]**
- **Settings, 设置 → 界面 → 棋盘:** four thumbnails, one per set, and a 自定义 tile of the same size (a dashed square, or the mix in use) that shows two selects, board and stones. The default is honey with slate and shell, in both themes. Since the [dark boards design](2026-11-26-dark-boards-design.md) the settings show six sets and the choice is kept per theme; the tiles set the current theme's board, and one line under them the other's.
- **A board style is data:**
  - the base colour;
  - the grain colours, density and amplitude, or none;
  - the line, star-point and coordinate colours;
  - the line weight.
  - Today's procedural grain (M5) takes these parameters, and stays seeded and cached per size and pixel ratio.
- **Walnut** draws light lines, star points and coordinates. **Printed** draws no grain, thinner lines, and no shadow under the best candidate's disc.
- **A stone style** is a sprite recipe for `makeStoneSprites`. Flat stones get no shadow.
- **What stays the same on every board:** the candidate discs, the last-move dot and the numbered-line colours (board styles mockup, section 4).
- **Screenshot tests** (`src/board/screenshots.test.ts`) get one baseline per set.

### 5.8 Device settings

- **A `DeviceSettings` store** in the interface, behind an interface with a `localStorage` implementation (4.2). It holds JSON with a version number. A value that cannot be read falls back to its default, field by field, and never fails the app.
- **It holds:**
  - the layout;
  - the phone layout's active tab;
  - the keymap overrides (empty until M4);
  - the board and stone style;
  - the interface scale;
  - coordinates;
  - the disc lines;
  - the perspective (5.10) and the score option;
  - always on top.
- **Language and theme stay in the backend's shared settings.** The desktop's native menu and file dialogs use the language (`src-tauri/src/lib.rs`), so the backend must know it. This narrows the plan's 4.1, which listed them as device settings; the plan is corrected with this design. A Phase 3 browser client may later override them locally. **[Proposed]**
- **Migration.** On the first launch of M1's build, an empty device store copies three backend fields:
  - `showCoordinates`;
  - `discLines`;
  - `perspective`.
  - The backend keeps reading and writing these fields through M1, so an older Aji on the same machine still works. M4 removes them. **[Proposed]**

### 5.9 Smaller items

- **Interface scale:** 设置 → 界面 → 界面缩放, with steps of 90, 100, 110, 125 and 150%. It sets the root font size, so the panels' text and controls scale (Tailwind sizes in rem). The board is unaffected, since the window sizes it. It applies at once, with no restart (audit P2-G5).
- **Capture counts:** read from the snapshot's `captures`. They appear in the trend panel's legend line as 提子 黑 3 · 白 5, and under the win-rate bar in the phone layout (audit P2-G9).
- **Always on top:** desktop only, via Tauri's window API. It is set in 设置 → 界面 only (owner, 2026-11-22). Stored per device.
- **Screenshots:**
  - 截图 has three targets (棋盘, 副盘, 走势图) and two actions each (保存…, 复制). On macOS it is the menu bar's 文件 → 导出图片, which says when a target is not on screen; on Windows and in the browser it is in the header's 视图 button (owner, 2026-11-22).
  - The board image composites its layers at twice the CSS size, as currently shown: discs, a shown line, coordinates.
  - The graph image renders its SVG to PNG.
  - Saving goes through `PlatformFiles` as bytes.
  - In the desktop app, copying writes the system clipboard through Tauri's clipboard plugin (`tauri-plugin-clipboard-manager`, MIT or Apache-2.0; its Windows crates are BSL-1.0), since a menu-bar click is no click in the page and WebKit refuses the page's clipboard write. The browser uses the webview's clipboard API. **[Decided]** (owner, 2026-11-22)
  - Copying a game record stays out (charter 7.10).

### 5.10 The side to move's view, and the score option

- **The discs and the candidate table** show the win rate and lead of the player to move (decision P3). The engine keeps reporting Black's numbers; the interface converts them.
- **The trend graph** keeps the colour chosen by the legend's toggle (black or white), so it does not zigzag. The toggle is labelled 走势图视角 (Graph perspective). The win-rate bar keeps Black on the left and shows both sides' numbers, so it never zigzags either and needs no toggle (decided while building M1; see the [M1 plan](../plans/2026-11-21-phase-2-m1-layout.md)'s Status).
- **The score option**, in 设置 → 分析 → 目差: 含贴目 (KataGo's lead, the default) or 盘面 (the board count without komi). It applies everywhere a lead is shown. This covers charter 7.3's "Black's perspective or alternating; board score or score including komi".

### 5.11 Commands and the keymap

- **A command** has an id, a label key, a kind (`press`, or `hold` for keys like Z that act on press and on release), and a run function.
- **Every key goes through one dispatcher.**
  - It keeps the focus rule of today's hooks (`busy(target)`).
  - It replaces `useNavigationKeys` and `useAnalysisKeys`, but keeps their behaviour.
  - The default keymap is exactly today's keys.
- **Buttons, menus and touch controls** call the same commands.
- **On macOS** the native menu keeps its accelerators (⌘O, ⇧⌘S, ⌘N), and the keymap leaves those chords to it, as today.
- **M4 adds the editor, the LizzieYzy preset and mouse bindings** on top. M1 binds nothing new.

### 5.12 Backlog items

- **M7 minor 7:** the wheel over a table row steps the hovered line instead of scrolling the table.
- **M7 minor 9:** Z no longer sticks on macOS while Cmd is held. The hold command is released on any keyup of Z, on blur, and when a Cmd chord starts.
- **M7 minor 10:** the discs wait for every font face they use, not only 12 px Inter 400.
- **M7 minor 12:**
  - the bar's percentages use the locale's number format;
  - an even lead reads 均势 / Even, not 黑领先 0.0 目.
- **M5 minor 1:** a failed settings save shows a short message beside the control before it snaps back.
- **M5 minor 5:** the first frame waits for the device store and the backend settings, so no frame uses the wrong theme or language.

## 6. Protocol

- No new requests or events.
- The backend's `UiSettings` keeps its fields through M1 (5.8).
- Always on top and screenshots use the platform layer: a window call, and `PlatformFiles` with bytes (`files_save_image`, `files_copy_image`).

## 7. Testing

- **Pure functions, unit-tested:**
  - layout validation on malformed and old input;
  - `layoutFrame` at the reference size, at wide and narrow sizes, and at minimum sizes;
  - drop-target hit testing;
  - preset trees;
  - the side-to-move conversion and the score option;
  - keymap dispatch.
- **Component tests with pointer events:**
  - dragging a panel to an edge and to a middle;
  - resizing a hairline;
  - hiding and restoring a panel;
  - the narrow arrangement's tabs, at phone and tablet widths, and its settings sheet;
  - tapping and swiping the board;
  - the eye button.
- **Screenshot tests:** one baseline per board and stone set, and one with walnut's light lines.
- **The browser check:** the dev scenarios (`src/dev`) run in a browser with the fake transport at 375 × 812 with touch emulation.

## 8. Exit (Mac, local build)

- Panels can be rearranged by dragging and resized. Each of the five presets applies. A restart keeps the layout. A corrupted layout in storage falls back to the default.
- At 1920 × 1080 the default splits into two columns.
- Making the window taller than wide switches to the narrow arrangement, and back. In a browser at 375 × 812 with touch emulation, every Phase 1 action works by touch, and settings open as a sheet:
  - showing and stepping a line;
  - navigating;
  - hiding candidates;
  - pausing analysis.
- The four sets switch in both themes. A screenshot of the board, the sub-board and the graph saves and copies.
- Always on top, interface scale and capture counts work. The discs show the side to move, and the graph keeps its colour.
- Device settings survive an app update (4.2's check).

## 9. Left to the builder

- Module layout, component names, and how the registry is wired.
- Exact minimum panel sizes, beyond the 320 px board floor and the 360 px wizard column.
- The grip and accent drawing details, within the mockups.
- The order of work inside M1, within the dependencies above.

## 10. Changes to other documents

- **Interface design:**
  - section 4's [Open] items on wider windows and on small-screen and touch layouts are answered by 5.2 and 5.5;
  - section 5.1 gets the board styles;
  - section 4.2's toggle applies to the graph only (5.10).
- **Phase 2 plan, 4.1:** language and theme stay shared settings (5.8).
- **Charter:** none.
