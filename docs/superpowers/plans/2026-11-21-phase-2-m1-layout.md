# Phase 2 M1 Layout, Board Styles and Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move today's screen into Aji's own panel system: five presets, drag to rearrange, and a narrow arrangement for phones and portrait windows that works by touch. Add four board and stone sets, device settings, one command registry, the sub-board, screenshots and the smaller M1 items.

**Architecture:**
- **Layout.** A pure layout model in `src/layout/`: types, presets, validation, `layoutFrame` geometry, drop-target hit testing and tree operations. A panel registry maps each panel kind to its component. `LayoutFrame` renders the wide arrangement and `NarrowFrame` the narrow one, from the same layout and the same panels.
- **Device settings.** A `DeviceSettings` store in `src/device/`, in `localStorage` behind an interface, holds the layout, styles, scale and view options. The backend keeps language, theme, the visit limit and the default rules.
- **Commands.** A command registry in `src/commands/`, with one key dispatcher in place of `useNavigationKeys` and `useAnalysisKeys`.
- **Board.** Board and stone styles become data that `drawBoard`, `woodTexture` and `makeStoneSprites` take.
- **Backend.** Only platform additions: always on top, saving image bytes, and two macOS menu actions. No `rpc` changes.

**Tech Stack:**
- Existing: Tauri 2, React 19, Zustand 5, i18next, Tailwind 4, shadcn/ui, Vitest with Testing Library, `@napi-rs/canvas` screenshot tests.
- New dependencies: none planned. Task 11 may add `tauri-plugin-clipboard-manager` (MIT or Apache-2.0) only if the webview clipboard check fails.

**Spec:** [Phase 2 M1 design](../specs/2026-11-21-p2-m1-layout-design.md), approved by the owner on 2026-11-21. Its mockups are [`board-styles.html`](../../design/mockups/p2-m1/board-styles.html) and [`layouts.html`](../../design/mockups/p2-m1/layouts.html). Section numbers below (5.1 and so on) refer to the design. The phase plan is [Phase 2 plan](2026-11-21-phase-2-roadmap.md).

**Status:** Not started.

## Global Constraints

- **Everything from Phase 1 still holds:**
  - language rules, and interface text in both locales;
  - dependency licences and Conventional Commits;
  - `aji-core` depends on no workspace crate and does no I/O;
  - protocol rules: no file paths in `rpc`, errors are `{ code, message }`, camelCase JSON.
- **No git worktrees**, for subagents too. Work in `/Users/zepher/personal/Aji` on `feat/p2-m1-layout`, which is the design branch `docs/p2-m1-design` renamed. Its design commit is the branch's first commit, and this plan its second. Push only when the owner asks.
- **Every user-visible string goes through i18n**, `zh-CN` and `en` in the same commit. Chinese strings quoted in the design or mockups are the `zh-CN` values; write natural English for `en`.
- **Colours** come from `src/styles/theme.css` tokens. The exceptions are the disc palette (`src/analysis/palette.ts`) and the board style data (`src/board/styles.ts`, Task 6). The drop outline uses a new token `--accent`: `#7fb2ff` in dark, `#2f6fd6` in light. It is never used for evaluation.
- **Panels have no borders, rounded corners or title rows of their own.** Hairlines between siblings only. A tab row appears only for a tab group (design 5.3).
- **Pointer events with pointer capture** for every drag, resize, tap and swipe. No HTML drag-and-drop for layout. A second pointer during a drag or resize is ignored.
- **Values fixed by the design**, in `src/layout/constants.ts`:

  | Constant | Value |
  |---|---|
  | Board floor | 320 px |
  | Board margin | 16 px (as `BOARD_MARGIN` today) |
  | Wizard and settings column | at least 360 px |
  | Default preset two-column threshold | the column is wider than 760 px |
  | Narrow, phone width | under 700 px |
  | Edge-split zone | the outer quarter of a panel's side |
  | Board-edge new-column band | an eighth of the board's width |
  | Hairline hit area | 8 px; 20 px for a coarse pointer |
  | Touch targets in the narrow arrangement | at least 44 px |
  | Swipe step | 40 px |
  | Sub-board follow rate | at most twice a second |
  | Layout save delay | under 1 s after a drag ends |
  | Interface scale steps | 90, 100, 110, 125, 150 % |

- **Checks before every commit:**
  - `cargo fmt --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo test --workspace`
  - `pnpm lint`, `pnpm typecheck`, `pnpm test`

## Review Focus

1. **A stored layout from a newer Aji** (`version: 2`), or one cut off mid-write. It reads as the default, and the stored value is not overwritten until the user changes the layout. Test in Task 1 (store) and Task 2 (validation).
2. **`localStorage` that throws or is missing**, as in a private browser window in Phase 3. Device settings fall back to in-memory defaults for the session, with no crash. Test in Task 1.
3. **The window resized, or blurred, in the middle of a drag or resize.** The drag cancels, the layout is unchanged, and no panel is left lifted. Test in Task 4.
4. **A small landscape window** (for example 560 × 420) that is not portrait but cannot fit the board's 320 px floor beside the columns. It switches to the narrow arrangement instead of drawing a board below the floor. Test in Task 2 (`layoutFrame`) and Task 8.
5. **A key pressed while a text field has focus** (the move counter, a settings input) after the dispatcher replaces the two key hooks. The field gets the key and no command runs. Test in Task 5.

---

### Task 1: Device settings store

**Files:**
- Create: `src/device/deviceSettings.ts` (type, defaults, field-by-field parsing), `src/device/storage.ts` (the storage interface and its `localStorage` and memory implementations), `src/device/deviceStore.ts` (Zustand store), `src/device/migrate.ts`
- Modify: `src/App.tsx` (first frame waits for the device store, M5 minor 5); every reader of `settings.showCoordinates`, `settings.discLines` and `settings.perspective` (`src/layout/MainFrame.tsx`, `src/analysis/useShownCandidates.ts`, `src/panel/TrendGraph.tsx`, `src/settings/SettingsPanel.tsx`, `src/dev/scenarios.ts`)
- Test: `src/device/*.test.ts`

**Interfaces:**
- Produces:
  - `interface DeviceSettings`:
    - `version: 1`
    - `layout: unknown | null` (raw; Task 2 validates it)
    - `narrowTab: string | null`
    - `keymap: Record<string, string>` (empty)
    - `boardStyle: { board: BoardId; stones: StoneId } | null` (`null` means the default for the device, Task 6)
    - `interfaceScale: 90 | 100 | 110 | 125 | 150`
    - `showCoordinates: boolean`
    - `discLines: [DiscField, DiscField]`
    - `perspective: Color`
    - `scoreWithKomi: boolean` (default `true`)
    - `alwaysOnTop: boolean`
    - `migrated: boolean`
  - `type BoardId = 'honey' | 'kaya' | 'walnut' | 'printed'` and `type StoneId = 'slate' | 'yunzi' | 'flat'`, exported from `deviceSettings.ts`.
  - `parseDeviceSettings(raw: unknown): DeviceSettings`. Field by field: a bad field gets its default, never throws.
  - `interface DeviceStorage { read(): string | null; write(value: string): void }`, with `localDeviceStorage()` and `memoryDeviceStorage()`. The local one falls back to memory if `localStorage` throws.
  - `useDeviceStore`: `{ settings: DeviceSettings; loaded: boolean; load(storage): void; update(patch: Partial<DeviceSettings>): void }`. `update` writes through.
  - `migrateFromBackend(device: DeviceSettings, ui: UiSettings): DeviceSettings`. When `migrated` is false, it copies `showCoordinates`, `discLines` and `perspective` and sets `migrated: true`.

- [ ] **Step 1: Write the failing tests:**
  - `a_bad_field_falls_back_alone`: `{ interfaceScale: 133, showCoordinates: false }` gives scale 100 and coordinates `false`.
  - `garbage_reads_as_defaults` (a string, `null`, an array).
  - `a_newer_version_reads_as_defaults_and_is_not_overwritten_by_loading`: storage holds `{"version":2,...}`; after `load`, `read()` still returns it. The first `update` replaces it.
  - `throwing_storage_falls_back_to_memory`.
  - `migration_copies_three_fields_once`: a second call after the backend changes copies nothing.
  - `the_first_frame_waits_for_device_settings` (App test, alongside the existing first-frame test).
- [ ] **Step 2: Run** `pnpm test src/device src/App`. Expected: FAIL.
- [ ] **Step 3: Implement** the four modules. Move the three readers to `useDeviceStore`. Settings controls for coordinates and disc lines call `update`, not `save`. The backend keeps the fields (design 5.8); the interface stops writing them.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Persistence check (design 4.2), on the Mac.**
  1. Build the app (`pnpm tauri build --bundles app`) and launch it.
  2. Change coordinates to hidden.
  3. Quit, bump the version in `package.json` locally (do not commit), build and install over the old app, and launch.
  4. Coordinates must still be hidden.

  Record the result in this plan's Status. If it fails, stop and report: the storage switches to a file (design 4.2 B) before Task 2.
- [ ] **Step 6: Commit** `feat: keep device settings in the interface`.

### Task 2: Layout model

**Files:**
- Create: `src/layout/model.ts` (types), `src/layout/constants.ts` (the values table), `src/layout/presets.ts`, `src/layout/validate.ts`, `src/layout/layoutFrame.ts`
- Modify: `src/layout/frame.ts` (keep `BOARD_MARGIN`; `computeFrame` becomes a thin wrapper over `layoutFrame` for the default, or is deleted with its callers moved)
- Test: `src/layout/*.test.ts`

**Interfaces:**
- Produces:
  - The types of design 5.1, exactly: `PanelKind`, `PanelRef`, `Node`, `Hidden`, `Layout`. Also `type PresetId = 'default' | 'classic' | 'minimal' | 'thinking' | 'four'`.
  - `presetLayout(id: PresetId): Layout`. The trees are design 5.2's table, with the M1 Classic of its footnote. Minimal's candidates get `maxRows: 3`. Thinking gets `lines: 'subboard'`.
  - `validateLayout(raw: unknown): Layout`. Never throws. It drops unknown kinds and duplicates (same kind and rank), removes empty tabs and splits, collapses single-child splits, normalises weights to sum 1, and clamps `active`. It returns `presetLayout('default')` when there is no board node in the root row, or the version is not 1.
  - `sameRef(a: PanelRef, b: PanelRef): boolean`.
  - `type Rect = { x: number; y: number; width: number; height: number }`.
  - `type Frame = { narrow: false; board: Rect; panels: Array<{ ref: PanelRef; rect: Rect; tabs?: { group: PanelRef[]; active: number } }>; hairlines: Array<{ rect: Rect; path: number[]; index: number; dir: 'row' | 'column' }> } | { narrow: true }`.
  - `layoutFrame(layout: Layout, width: number, height: number, minSize: (ref: PanelRef) => { width: number; height: number }): Frame`.
    - The board is the largest square that fits `height - 2 × BOARD_MARGIN` and leaves every column its minimum width.
    - The result is narrow when the window is portrait or the board would fall below 320.
    - The default preset, while `preset === 'default'`, splits its column into two when it is wider than 760: analysis panels (`winrate`, `trend`, `candidates`) left, and the rest right.

- [ ] **Step 1: Write the failing tests:**
  - `validate.test.ts`:
    - `every_preset_survives_validation_unchanged`
    - `unknown_kinds_and_duplicates_are_dropped`
    - `a_layout_without_the_board_is_the_default`
    - `version_2_is_the_default`
    - `weights_are_normalised`
    - `a_split_left_with_one_child_collapses`
    - `random_json_never_throws` (200 seeded random trees)
  - `layoutFrame.test.ts`:
    - `default_at_1440x900_matches_phase_1` (board 868 at x 16, panel x 900 width 540)
    - `default_at_1920x1080_has_two_columns`
    - `classic_puts_the_board_between_two_columns`
    - `portrait_is_narrow`
    - `560x420_landscape_is_narrow` (review focus 4)
    - `rects_never_overlap_and_tile_the_window` (every preset at 1024×700, 1440×900 and 2560×1440)
    - `hairlines_sit_between_siblings`
- [ ] **Step 2: Run** `pnpm test src/layout`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules. Rows are laid out by weights after the board's fixed width. Each panel's minimum width and height come from `minSize`. When minima cannot be met in a column, rects shrink proportionally (the narrow switch has already caught the board case).
- [ ] **Step 4: Run** `pnpm test src/layout`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(layout): add the layout model, presets and geometry`.

### Task 3: Panel registry and the wide frame

**Files:**
- Create: `src/layout/registry.tsx`, `src/layout/LayoutFrame.tsx`, `src/layout/useLayout.ts`, `src/panel/HeaderPanel.tsx` (header row plus `NoticeLine` and `EngineStatus`), `src/panel/TabRow.tsx`
- Modify: `src/App.tsx` (renders `LayoutFrame`; the wizard, settings and About fill the side area as today, at least 360 wide), `src/analysis/AnalysisPanel.tsx` (split into the `winrate`, `trend` and `candidates` panels, then removed), `src/settings/AboutPanel.tsx` (the version line moves here), `src/panel/CandidateTable.tsx` (`maxRows` prop), `src/layout/MainFrame.tsx` (deleted once `LayoutFrame` replaces it)
- Test: `src/layout/LayoutFrame.test.tsx`, `src/App.test.tsx`

**Interfaces:**
- Consumes: Task 2's `layoutFrame`, `validateLayout` and `presetLayout`; Task 1's `useDeviceStore`.
- Produces:
  - `interface PanelSpec { kind: PanelKind; labelKey: string; hideable: boolean; minSize: { width: number; height: number }; Component: (props: { panel: PanelRef; width: number; height: number }) => ReactNode }`
  - `panelSpec(kind: PanelKind): PanelSpec`
  - `useLayout(): { layout: Layout; setLayout(next: Layout): void }`. It reads and validates `device.layout`, and saves with a debounce under 1 s.
  - `<LayoutFrame boardOverlay?: ReactNode side?: ReactNode />`. `side`, when given, replaces every panel with one area beside the board (the wizard or settings).
  - Panels stay mounted per `kind` and `rank` across layout changes (React `key` from the ref).

- [ ] **Step 1: Write the failing tests:**
  - `the_default_layout_renders_the_four_phase_1_panels_in_order`.
  - `each_preset_renders_its_panels`: Minimal shows 3 candidate rows; Four boards shows three sub-board placeholders until Task 7.
  - `settings_fill_the_side_area_and_keep_the_board`.
  - `a_corrupt_stored_layout_renders_the_default`.
  - `a_tab_group_shows_a_tab_row_and_a_single_panel_does_not`.
  - `the_version_line_is_on_the_about_page`.
- [ ] **Step 2: Run** `pnpm test src/layout src/App`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Panels are absolutely positioned from `layoutFrame`. Hairlines are 1 px `--hairline` lines.
  - The trend graph's height is the panel's height minus its legend line. This replaces `GRAPH_HEIGHT` and `COMPACT_WINDOW_HEIGHT`, which are removed.
  - Until Task 7, the `subboard` kind renders an empty panel.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS. Then walk `pnpm dev` (the `analysing` scenario) at 1440×900 and 1920×1080 in the browser pane, and compare with the layouts mockup sections 1 and 7.
- [ ] **Step 5: Commit** `feat(layout): render the screen from the layout`.

### Task 4: Rearranging and the 布局 menu

**Files:**
- Create: `src/layout/ops.ts` (pure tree operations), `src/layout/dropTarget.ts` (pure hit testing), `src/layout/useDragPanel.ts`, `src/layout/Hairline.tsx`, `src/layout/Grip.tsx`, `src/layout/LayoutMenu.tsx`
- Modify: `src/layout/LayoutFrame.tsx`, `src/panel/GameMenu.tsx` (a 布局 entry), `src/settings/SettingsPanel.tsx` (界面 → 布局), `src/styles/theme.css` (`--accent`), `src-tauri/src/platform/mod.rs` (`MenuAction::Layout(String)`), `src-tauri/src/platform/menu.rs` (a 布局 submenu under 显示 on macOS, labels in both languages), `src/platform/files.ts` (`MenuCommand` gains the layout action), the locale files
- Test: `src/layout/ops.test.ts`, `src/layout/dropTarget.test.ts`, `src/layout/LayoutFrame.drag.test.tsx`, `menu.rs` unit tests

**Interfaces:**
- Produces:
  - `type Drop = { kind: 'split'; target: PanelRef; side: 'left' | 'right' | 'top' | 'bottom' } | { kind: 'tab'; target: PanelRef } | { kind: 'column'; side: 'left' | 'right' } | null`
  - `dropTarget(frame: Frame, point: { x: number; y: number }, dragged: PanelRef): Drop`. Uses the outer quarter of each side of a panel, and an eighth of the board's width at its left and right edges. Elsewhere over the board it is `null`, as it is for the dragged panel itself.
  - Operations in `ops.ts`, each returning a new custom layout (`preset: 'custom'`), and each followed by `validateLayout`:
    - `movePanel(layout: Layout, ref: PanelRef, drop: Drop): Layout`. A column left empty is removed.
    - `resize(layout: Layout, path: number[], index: number, delta: number, frame: Frame): Layout`. Minimum sizes hold.
    - `evenSplit(layout: Layout, path: number[], index: number): Layout`
    - `hidePanel(layout: Layout, ref: PanelRef): Layout`. Records `besides` and `side`.
    - `showPanel(layout: Layout, ref: PanelRef): Layout`. Returns the panel beside `besides`, or at the end of the header's column.
    - `selectTab(layout: Layout, ref: PanelRef): Layout`
  - `MenuAction::Layout(String)`, with item id `layout:<presetId>`.

- [ ] **Step 1: Write the failing tests:**
  - `ops.test.ts`:
    - `moving_to_an_edge_splits_in_that_direction`
    - `moving_to_the_middle_makes_tabs`
    - `moving_the_last_panel_out_removes_its_column`
    - `dropping_on_the_board_edge_adds_a_column`
    - `resize_respects_minimum_sizes`
    - `hide_then_show_returns_the_panel_beside_its_neighbour`
    - `show_after_the_neighbour_is_gone_appends_to_the_header_column`
    - `the_header_cannot_be_hidden`
  - `dropTarget.test.ts`:
    - `edge_quarter_and_middle`
    - `board_band_and_board_middle`
    - `over_itself_is_null`
  - `LayoutFrame.drag.test.tsx`, with `fireEvent.pointerDown`/`pointerMove`/`pointerUp` and `pointerId`:
    - `dragging_the_grip_moves_the_panel_and_saves`
    - `the_accent_outline_shows_the_drop`
    - `a_second_pointer_is_ignored`
    - `resize_or_blur_mid_drag_cancels_and_leaves_the_layout` (review focus 3)
    - `double_click_on_a_hairline_evens_it`
    - `grips_show_on_hover_and_always_for_a_coarse_pointer` (mock `matchMedia`)
  - `menu.rs`: `layout_ids_round_trip`.
- [ ] **Step 2: Run** `pnpm test src/layout && cargo test -p aji menu`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `useDragPanel` captures the pointer on the grip. It renders a ghost and the accent outline from `dropTarget`. It commits on up, and cancels on `pointercancel`, window `resize` or `blur`.
  - `LayoutMenu` lists the five presets, a checkbox for each hideable panel, and 恢复默认. Choosing a preset sets `presetLayout(id)`.
  - The macOS menu items send `layout:<id>`. The interface applies them through `onMenu`.
- [ ] **Step 4: Run** the full checks. Expected: PASS. Walk a drag, a resize and each preset in `pnpm dev`.
- [ ] **Step 5: Commit** `feat(layout): rearrange panels and choose presets`.

### Task 5: Commands and the key dispatcher

**Files:**
- Create: `src/commands/registry.ts`, `src/commands/keymap.ts`, `src/commands/useKeyDispatcher.ts`, `src/commands/builtins.ts` (today's commands)
- Modify: `src/App.tsx`; `src/game/useNavigationKeys.ts` and `src/analysis/useAnalysisKeys.ts` (deleted, their tests moved to the dispatcher); the buttons that run these actions (`NavButtons`, `EngineIndicator`) call commands
- Test: `src/commands/*.test.ts(x)`

**Interfaces:**
- Produces:
  - `interface Command { id: CommandId; labelKey: string; kind: 'press' | 'hold'; run(ctx: CommandContext, phase: 'down' | 'up'): void }`. A `press` command ignores `up`.
  - `type CommandId = 'nav.previous' | 'nav.next' | 'nav.first' | 'nav.last' | 'nav.pageBack' | 'nav.pageForward' | 'file.open' | 'file.saveAs' | 'file.new19' | 'analysis.toggle' | 'candidates.toggleHidden' | 'candidates.peek'`
  - `CommandContext` carries what the old hooks had: the transport, the engine store, `useActionContext()`, `useFrameNavigate()`, the OS.
  - `defaultKeymap(os: OsKind): Map<string, CommandId>`, chord strings such as `ArrowLeft`, `Mod+O` or `Shift+Mod+S`. On macOS the `Mod+…` file chords are absent, because the native menu owns them (design 5.11).
  - `runCommand(id: CommandId, phase?: 'down' | 'up'): void`, a module-level dispatcher used by buttons and touch controls.
  - `useKeyDispatcher(): void`.

- [ ] **Step 1: Write the failing tests:**
  - Move every existing test of the two hooks over unchanged in intent: arrows, Home, End, PageUp and PageDown, Space with a repeat, F, Z held, file chords off macOS.
  - New:
    - `keys_in_a_text_field_run_nothing` (review focus 5)
    - `z_releases_when_a_cmd_chord_starts` (M7 minor 9)
    - `z_releases_on_blur`
    - `a_button_and_its_key_run_the_same_command`
- [ ] **Step 2: Run** `pnpm test src/commands`. Expected: FAIL.
- [ ] **Step 3: Implement** the registry, keymap and dispatcher. Device `keymap` overrides are read but empty until M4.
- [ ] **Step 4: Run** the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: route every key through commands`.

### Task 6: Board and stone styles

**Files:**
- Create: `src/board/styles.ts`, `src/settings/BoardStyleControl.tsx`
- Modify: `src/board/wood.ts` (takes a `BoardStyle`, caches per style, size and ratio), `src/board/drawBoard.ts` (`BoardView.style`; the line, star and label inks come from the style), `src/board/stones.ts` (`makeStoneSprites(spacing, dpr, create, stones: StoneId)`; Yunzi and flat recipes), `src/board/candidates.ts` (no best-disc shadow on `printed`), `src/board/BoardCanvas.tsx` (a `style` prop), `src/board/screenshots.test.ts` (new baselines), `src/settings/SettingsPanel.tsx`, the locale files
- Test: `src/board/styles.test.ts`, `src/board/screenshots.test.ts`, `src/settings/BoardStyleControl.test.tsx`

**Interfaces:**
- Produces:
  - `interface BoardStyle { id: BoardId; base: string; grain: { dark: string; light: string; density: number; amplitude: number } | null; line: string; star: string; label: string; lineWeight: number }`
  - `BOARD_STYLES: Record<BoardId, BoardStyle>`. Honey is today's values. The others are from the board styles mockup:
    - kaya: base `#E9C98A`, lines `#4A3518`;
    - walnut: base `#6E4A2C`, lines `rgba(236,220,190,.78)`, labels `rgba(236,220,190,.7)`;
    - printed: base `#F1E7CF`, lines `#4F4232`, no grain, line weight 0.7.
  - `SETS: Array<{ board: BoardId; stones: StoneId }>`: honey with slate, kaya with Yunzi, walnut with slate, printed with flat (design 5.7).
  - `effectiveStyle(device: DeviceSettings, startedNarrow: boolean): { board: BoardId; stones: StoneId }`. A `null` style is printed with flat on a device that started narrow, and honey with slate otherwise.
  - The stone recipes:
    - Yunzi: black gradient `#3a3e3b → #222624 → #181b19`, edge `#2c3a32`; white `#fbf5e4 → #efe4c8 → #dccca5 → #cdbb92`; no highlight or grain; a lighter shadow.
    - Flat: fills `#1b1b1a` and `#fbfaf6`, an outline `#2a2620` at 0.07 r, no shadow.

- [ ] **Step 1: Write the failing tests:**
  - `honey_is_pixel_identical_to_phase_1`: the existing baselines pass unchanged.
  - One new baseline per set, plus `walnut_draws_light_coordinates`, `printed_best_disc_has_no_shadow` and `flat_stones_have_no_shadow_pixels_outside_the_outline`.
  - `the_default_style_depends_on_the_device`.
  - `choosing_a_set_and_custom_mixing_update_the_device_settings`.
- [ ] **Step 2: Run** `pnpm test src/board src/settings`. Expected: FAIL (missing baselines are written with `UPDATE_SCREENSHOTS=1` only after the images are checked by eye against the mockup).
- [ ] **Step 3: Implement.** The settings control shows four thumbnails (each a small `BoardCanvas` crop) and a 自定义 choice with two selects.
- [ ] **Step 4: Run** the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat(board): add the board and stone sets`.

### Task 7: The sub-board

**Files:**
- Create: `src/panel/SubBoard.tsx`, `src/analysis/useSubBoardLine.ts`
- Modify: `src/layout/registry.tsx` (the `subboard` kind), `src/board/useWheelNavigation.ts` and `src/board/BoardCanvas.tsx` (scoped to their own element; no window-level listeners that two boards would share), `src/analysis/useVariation.ts` (with `layout.lines === 'subboard'` the hovered line goes to sub-board rank 1 and the main board keeps its discs), the locale files
- Test: `src/panel/SubBoard.test.tsx`, `src/analysis/useSubBoardLine.test.ts`

**Interfaces:**
- Consumes: `shownCandidates`, `variationBoard`, the existing `previewGame` path used by `useVariation`.
- Produces:
  - `useSubBoardLine(rank: 1 | 2 | 3): { line: Variation | null; step: number | null; setStep(n: number): void; frozen: boolean }`.
    - It follows the analysis at most twice a second while not frozen.
    - Stepping freezes it.
    - A new position, or a new first move for that rank, restarts it.
    - With candidates hidden (F, or Z held) the line is `null`.
  - `<SubBoard rank />`: a label row (rank chip, point, win rate, lead), then the board. Clicking the label sets the main board's hover to that candidate. With no candidate at that rank it shows the position and a quiet 无候选 line.

- [ ] **Step 1: Write the failing tests:**
  - `follows_the_deepening_line_at_most_twice_a_second` (fake timers, five updates in 400 ms give at most one refresh)
  - `stepping_freezes_until_the_position_changes`
  - `a_new_first_move_restarts`
  - `hidden_candidates_hide_the_line`
  - `rank_3_without_a_third_candidate_shows_the_position`
  - `the_wheel_over_the_sub_board_does_not_navigate_the_game`
  - `in_thinking_the_hovered_line_goes_to_the_sub_board_and_the_main_board_keeps_its_discs`
- [ ] **Step 2: Run** `pnpm test src/panel/SubBoard src/analysis`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full checks. Expected: PASS. Walk Thinking and Four boards in `pnpm dev`.
- [ ] **Step 5: Commit** `feat: add the sub-board`.

### Task 8: The narrow arrangement

**Files:**
- Create: `src/layout/NarrowFrame.tsx`, `src/layout/Sheet.tsx`, `src/panel/BottomNav.tsx`
- Modify: `src/App.tsx` (chooses `NarrowFrame` when `layoutFrame` says narrow; the wizard, settings and About render in `Sheet`), `src/panel/HeaderPanel.tsx` (a compact form: title, move counter, engine dot, ⚙), the locale files
- Test: `src/layout/NarrowFrame.test.tsx`

**Interfaces:**
- Consumes: `useLayout`, `panelSpec`, `useDeviceStore` (`narrowTab`).
- Produces:
  - `<NarrowFrame />`, laid out top to bottom:
    1. the compact header;
    2. the notice line and engine status, when they have something;
    3. the board at the full width minus 4 px each side;
    4. the win-rate bar, with capture counts under it (Task 10);
    5. the tabs;
    6. the bottom navigation.
  - Tabs: the layout's visible panels other than `header` and `winrate`, in layout order.
  - Under 700 px wide: one tab at a time and `BottomNav` (⏮ ◀ ▶ ⏭, 44 px targets, calling Task 5's commands).
  - From 700 px: the first two tabs side by side, the strip only if there are more, the full navigation in the header, and no `BottomNav`.
  - `<Sheet onClose>`: full-window, with a close control.

- [ ] **Step 1: Write the failing tests:**
  - `375x812_shows_tabs_and_bottom_nav`
  - `768x1024_shows_two_panels_side_by_side_without_bottom_nav`
  - `tabs_follow_layout_order_and_skip_hidden_panels`
  - `the_active_tab_is_remembered`
  - `settings_open_as_a_sheet_and_close`
  - `first_run_wizard_shows_in_the_sheet`
  - `touch_targets_are_at_least_44px`
  - `the_desktop_layout_is_unchanged_after_a_narrow_session`
- [ ] **Step 2: Run** `pnpm test src/layout/NarrowFrame`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat(layout): add the narrow arrangement`.

### Task 9: Touch gestures and the eye button

**Files:**
- Create: `src/board/useBoardGestures.ts`, `src/panel/EyeButton.tsx`
- Modify: `src/board/BoardCanvas.tsx` (pointer handling split by `pointerType`; mouse keeps hover), `src/analysis/viewStore.ts` (a `pinned` hover from a tap), `src/layout/registry.tsx` (the candidates panel's top row gets the eye button), the locale files
- Test: `src/board/useBoardGestures.test.tsx`, `src/panel/EyeButton.test.tsx`

**Interfaces:**
- Consumes: Task 5's `runCommand`, `useViewStore`.
- Produces: the gestures of design 5.6, M1 column:

| Gesture | Effect |
|---|---|
| Tap a candidate | Shows its line, pinned until a tap elsewhere or a navigation |
| Tap an empty point | Clears the line |
| Horizontal swipe | Steps the line, or the game when no line shows. One step per 40 px, direction as the wheel |

- The second tap on a candidate and the long press are reserved for M3 and do nothing yet.
- `EyeButton`: a tap runs `candidates.toggleHidden`. Pressing and holding runs `candidates.peek` (down, then up).

- [ ] **Step 1: Write the failing tests** (`pointerType: 'touch'` events):
  - `tap_a_candidate_pins_its_line`
  - `tap_empty_clears_it`
  - `navigation_clears_a_pinned_line`
  - `swipe_120px_left_steps_three`
  - `swipe_without_a_line_navigates_the_game`
  - `mouse_hover_is_unchanged` (the M7 hover tests still pass)
  - `a_second_tap_on_the_same_candidate_does_nothing_yet`
  - `eye_tap_toggles_and_hold_peeks`
- [ ] **Step 2: Run** `pnpm test src/board/useBoardGestures src/panel/EyeButton`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat(board): add touch gestures`.

### Task 10: Side to move, score option, capture counts, scale, and the number fixes

**Files:**
- Modify:
  - `src/analysis/useShownCandidates.ts` (discs and table in the side to move's view: `shownCandidates(update, toPlay, nextMove, toPlay)`)
  - `src/panel/WinrateBar.tsx` and `src/panel/TrendGraph.tsx` (keep `device.perspective`; the toggle's label says it applies to the graph and bar; capture counts in the legend line)
  - `src/analysis/format.ts` (`formatLead` takes the score option; the bar's percentages use the locale's number format; an even lead reads 均势 / Even)
  - `src/settings/SettingsPanel.tsx` (分析 → 目差: 含贴目 / 盘面; 界面 → 界面缩放)
  - `src/main.tsx` or `src/App.tsx` (the root font size from `interfaceScale`)
  - the locale files
- Test: the existing tests of these modules, extended

**Interfaces:**
- Produces:
  - `boardLead(scoreLead: number, komi: number, side: Color): number`. With `scoreWithKomi: false`, Black's lead is `scoreLead + komi` and White's is `scoreLead − komi`, each from its own side.
  - `CapturesLine` in the trend legend: 提子 黑 n · 白 m.

- [ ] **Step 1: Write the failing tests:**
  - `discs_show_the_side_to_move_with_white_to_play` (the win rate is White's even with the perspective on black)
  - `the_graph_keeps_the_chosen_colour`
  - `board_lead_adds_komi_for_black_and_subtracts_for_white`
  - `even_lead_reads_even_in_both_languages`
  - `percentages_use_the_locale_format`
  - `captures_show_in_the_legend`
  - `scale_125_sets_the_root_font_size_at_once`
- [ ] **Step 2: Run** `pnpm test src/analysis src/panel src/settings`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full checks. Expected: PASS.
- [ ] **Step 5: Commit** `feat: show the side to move on the discs, and the score and scale options`.

### Task 11: Screenshots, always on top, and the remaining minors

**Files:**
- Create: `src/board/snapshotImage.ts` (composites a `BoardCanvas`'s layers at 2× into PNG bytes), `src/panel/graphImage.ts` (the trend SVG to PNG bytes), `src/panel/ScreenshotMenu.tsx`
- Modify:
  - `src/platform/files.ts`, `src/platform/tauriFiles.ts`, `src/platform/fakeFiles.ts`: `saveImage(suggestedName: string, bytes: Uint8Array): Promise<boolean>` and `setAlwaysOnTop(on: boolean): Promise<void>`
  - `src-tauri/src/lib.rs` and `src-tauri/src/platform/`: a `save_image` command that opens the save dialog and writes the bytes; the window permission `core:window:allow-set-always-on-top` in `src-tauri/capabilities`; `MenuAction::AlwaysOnTop` in the macOS 窗口 menu
  - `src/panel/GameMenu.tsx`: 截图 with 棋盘, 副盘 and 走势图, each with 保存… and 复制; and 总在最前
  - `src/panel/CandidateTable.tsx`: M7 minor 7, the wheel over a row steps the hovered line
  - `src/board/BoardCanvas.tsx`: M7 minor 10, the discs wait for every face they use
  - `src/settings/SettingsPanel.tsx`: M5 minor 1, a failed save shows 保存失败 beside the control before it snaps back
  - the locale files
- Test: `snapshotImage.test.ts`, `ScreenshotMenu.test.tsx`, `CandidateTable.test.tsx`, `SettingsPanel.test.tsx`, a `save_image` unit test on the Rust side for the write path

**Interfaces:**
- Produces:
  - `boardImage(canvasHost: HTMLElement): Promise<Uint8Array>`
  - `graphImage(svg: SVGSVGElement, theme: 'light' | 'dark'): Promise<Uint8Array>`
  - `copyImage(bytes: Uint8Array): Promise<boolean>`. It uses `navigator.clipboard.write` with an `image/png` `ClipboardItem` and returns `false` when that is unavailable. The menu then shows 无法复制 for two seconds.

- [ ] **Step 1: Write the failing tests:**
  - `board_image_is_twice_the_css_size_and_includes_discs`
  - `save_cancelled_returns_false`
  - `copy_falls_back_with_a_message`
  - `always_on_top_is_remembered_per_device_and_applied_at_start`
  - `wheel_over_a_row_steps_the_line`
  - `discs_wait_for_all_fonts`
  - `a_failed_save_shows_the_message`
  - Rust: `save_image_writes_the_bytes`
- [ ] **Step 2: Run** `pnpm test && cargo test -p aji`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Clipboard check (design 5.9).** In the built app on the Mac, copy the board and paste it into Preview. If it fails on WKWebView, add `tauri-plugin-clipboard-manager` behind `copyImage`, run `node scripts/check-npm-licenses.mjs` and `cargo deny check licenses`, and regenerate the notices. Record the result in the Status.
- [ ] **Step 5: Run** the full checks. Expected: PASS.
- [ ] **Step 6: Commit** `feat: add screenshots and always on top`.

### Task 12: Documents, final review and the Mac exit check

**Files:**
- Modify: this plan's Status, `docs/superpowers/plans/2026-11-21-phase-2-roadmap.md` (M1 Status), `docs/backlog/phase-1-deferred.md` (strike the six minors M1 fixed), `docs/development.md` (device settings and the narrow arrangement in the dev scenarios)

- [ ] **Step 1: Final review.** A fresh reviewer on the most capable model reads the whole branch against the design. Fix every critical and important finding with a test that fails first, folded into the commit it corrects.
- [ ] **Step 2: The Mac exit check** (design 8), with the app from `pnpm tauri build --bundles app` and with `pnpm dev` in the browser pane at 375 × 812 with touch emulation. Walk every bullet of design 8 and record each result.
- [ ] **Step 3: Update the documents**, then commit `docs: record Phase 2 M1`.
- [ ] **Step 4: Report to the owner** with the branch, the checks, and what is left for the owner's own look at the built app. The merge target is the owner's call.
