# Dark Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the flat Graphite and Ink boards, with the inks they need, and a board choice per theme.

**Architecture:** `BoardStyle` gains an `ink` group, which the drawing reads in place of `=== 'walnut'` checks and fixed colours. Device settings hold one style per theme. `useBoardStyle` picks the resolved theme's style, read from `<html data-theme>`.

**Tech Stack:** TypeScript, React, zustand, Vitest, Skia screenshot tests (`@napi-rs/canvas`).

**Spec:** `docs/superpowers/specs/2026-11-26-dark-boards-design.md`

The owner asked for a brief plan, executed natively in this session. Done on 2026-11-26; Tasks 3 and 4 landed as one commit, because the settings control would not compile without the new device field.

## Global Constraints

- Every interface string goes through i18n, in both `zh-CN` and `en`, with no middle dot.
- Every existing screenshot baseline stays unchanged, walnut's included.
- Commits follow Conventional Commits, on `feat/dark-boards`, cut from `docs/dark-boards`.

## Review Focus

- **An old `aji.device` with a single `boardStyle`** reads as that choice for both themes. Test it in Task 3.
- **An unreadable `boardStyles` entry** falls back to the default for that theme only. Test it in Task 3.
- **Switching the theme** redraws the board with the other theme's style, without a reload. Test it in Task 3, through `useBoardStyle`.
- **Flat stones on Printed** keep today's pixels after the sprite change. The `set-printed-flat` baseline covers it in Task 2.
- **The grain slider** stays active while the other theme's board has grain. Test it in Task 4.

---

### Task 1: Board data

**Files:** `src/board/styles.ts`, `src/device/deviceSettings.ts` (`BoardId`, `BOARD_IDS`), `src/board/styles.test.ts`.

**Interfaces:**
- Produces `FlatStones { black: StoneInk; white: StoneInk }`, where `StoneInk { fill: string; edge: string; edgeWidth: number }` (edge width as a share of the radius).
- Produces `BoardInk { mark: string; badgeOutline: string; badgeFill: string; badgeLetter: string; played: string; flat: FlatStones }`.
- Produces `BoardStyle.ink: BoardInk`.
- Produces `BoardId` with `'graphite' | 'ink'`, and `SETS` gaining `{ graphite, flat }` and `{ ink, flat }` at the end.

**Values:**
- **Light ink** (honey, kaya, printed):
  - mark `#2b1d0e`, badge outline `rgba(43,29,14,.7)`;
  - badge `#1f1a14` with letter `#f3efe4`;
  - played ring `#2B1D0E`;
  - flat black `#1b1b1a`, white `#fbfaf6`, both with edge `#2a2620` at `0.07`.
- **Walnut:** the light ink, except mark and badge outline `#f3efe4`.
- **Dark ink:**
  - mark `#ECEAE4`, badge outline `rgba(236,234,228,.75)`;
  - badge `#ECEAE4` with letter `#1f1a14`;
  - played ring `#ECEAE4`;
  - flat black `#050506` with edge `#5A5A61` at `0.1`;
  - flat white `#D6D4CD` with edge `rgba(0,0,0,.5)` at `0.07`.
- **The boards** take their bases, lines, stars and labels from the spec. Both have `grain: null` and `lineWeight` 0.7.

- [x] Test: `SETS` ends with Graphite and Ink, each with flat stones, and every style has an `ink`.
- [x] Implement, then run `pnpm vitest run src/board`. Expected: PASS.

### Task 2: Drawing reads the inks

**Files:** `src/board/marks.ts`, `src/board/badges.ts`, `src/board/candidates.ts` (both the played ring and `drawNextRing`, whose view gains `style`), `src/board/stones.ts` and `src/board/BoardCanvas.tsx`.

- `makeStoneSprites(spacing, dpr, create, stones, contact, flat: FlatStones = BOARD_STYLES.honey.ink.flat)`.
- `BoardCanvas` passes the board's `ink.flat`, and its sprite memo depends on `boardStyle`.
- The best disc's shadow is drawn only when `BOARD_STYLES[style].grain` is not `null`.

- [x] Screenshot tests: add `set-graphite-flat`, `set-ink-flat` and `ink-discs-marks-badges` (discs with the played ring, marks on empty points and stones, a badge). Write the new baselines with `UPDATE_SCREENSHOTS=1`, only for these.
- [x] Run `pnpm vitest run src/board`. Expected: every old baseline passes unchanged.
- [x] Commit `feat: draw the graphite and ink boards`.

### Task 3: One board per theme

**Files:** `src/theme/useResolvedTheme.ts` (new), `src/device/deviceSettings.ts`, `src/board/styles.ts` (`effectiveStyle`), `src/board/useBoardStyle.ts`, and the tests beside them.

**Interfaces:**
- `useResolvedTheme(): Theme` uses `useSyncExternalStore` over a `MutationObserver` on `<html data-theme>`. Anything other than `'light'` is `'dark'`.
- `DeviceSettings.boardStyles: Record<Theme, StyleChoice | null>` replaces `boardStyle`.
- `parseDeviceSettings`:
  - reads `boardStyles` entry by entry;
  - without it, reads an old `boardStyle` into both themes.
- `effectiveStyle(device: Pick<DeviceSettings, 'boardStyles'>, startedNarrow: boolean, theme: Theme): StyleChoice`.
- `useBoardStyle(theme?: Theme)` defaults to `useResolvedTheme()`.

- [x] Tests:
  - the migration;
  - a bad entry for one theme;
  - `effectiveStyle` per theme;
  - `useBoardStyle` follows a `data-theme` change.
- [x] Implement, then run `pnpm vitest run src/device src/board src/theme`. Expected: PASS.
- [x] Commit `feat: choose a board for each theme`.

### Task 4: Settings (S3) and strings

**Files:** `src/settings/BoardStyleControl.tsx` and its test, `src/locales/en.json`, `src/locales/zh-CN.json`.

- **Above the tiles:** `settings.board.inTheme.{dark,light}`, "In the dark theme" / 深色主题下 (and the light pair).
- **Tiles and Custom** write `boardStyles[current theme]`.
- **Under the tiles:** the other theme's label, then a select of the six sets (`settings.board.boards.*`). It shows 自定义 when that theme's style is a mix, and choosing a set writes `boardStyles[other]`.
- **The grain slider** rests when neither theme's effective board has grain. `settings.board.noGrain` becomes "Neither theme's board has grain" / 两种主题的棋盘都没有木纹.
- **New names:** `boards.graphite` Graphite / 石墨, `boards.ink` Ink / 墨黑.

- [x] Tests:
  - a tile writes only the current theme;
  - the other-theme select writes the other theme;
  - the slider is active with dark set to Graphite and light set to Honey.
- [x] Run `pnpm vitest run src/settings src/i18n`. Expected: PASS.
- [x] Commit `feat: board style for each theme in settings`.

### Task 5: Docs and the check

- [x] Update the interface design (board section and principle 2), P2 M1 5.7, and `docs/development.md` (`boardStyle` becomes `boardStyles`). Fill in the spec's **Built** section.
- [x] Run the whole suite, typecheck and lint: `pnpm -s test --exclude '.claude/**'`, `pnpm -s typecheck`, `pnpm -s lint`.
- [x] In `pnpm dev`, at 1440 × 900, in both themes: Graphite for dark with Honey for light, switch themes, then Ink. Take screenshots.
- [x] Commit `docs: record the dark boards`.
