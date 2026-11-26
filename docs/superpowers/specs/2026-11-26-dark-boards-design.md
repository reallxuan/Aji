# Dark boards: design

- Date: 2026-11-26
- Status: Approved by the owner on 2026-11-26 and built on `feat/dark-boards`. Results under **Built** at the end.
- Placement: one small branch after Phase 2 M4 part 1. The owner decides when it is built.
- Mockups: `docs/design/mockups/p2-dark-boards/` (1 base colour, 2 stones, 3 candidates, 4 settings).
- **[Decided]** marks the owner's choices in the mockups and in conversation. **[Proposed]** marks the designer's calls, which the owner may change while reading.

## Why

In the dark theme the honey board is a bright square in the middle of a dark grey window (the owner's screenshot of `pnpm tauri dev`). Walnut, the one dark board today, is still much lighter and warmer than the window. The owner asked for a new board like 印刷 (Printed), but black. **[Decided]**

## Goals

- Two new boards, **石墨 (Graphite)** and **墨黑 (Ink)**, flat like Printed.
- Stones, candidates and marks that read on them.
- A board choice per theme, so the board changes with the theme.
- Nothing changes for anyone who does not choose: Honey stays the default in both themes.

## Non-goals

- No change to the candidate discs' colours.
- No change to the existing four boards' pixels. Walnut moves onto the new data fields but draws exactly as before.
- No new stone style in the settings.

## Anti-goals

- A board that changes with the theme without the user having chosen it.
- New `=== 'walnut'`-style special cases in the drawing code.

## The look

### Boards (mockup 1)

- **[Decided]** Add both A (Graphite) and B (Ink). The third option, C (a warm black, `#25211C` with cream lines), was not taken. C was the one that kept interface design principle 2: "the wooden board is the one warm, saturated object on screen". The two chosen boards are neutral, so that principle no longer holds when a user picks one.
- **[Proposed]** Both are flat like Printed:
  - no grain, finish or rim;
  - no shadow onto the window;
  - no shadow under the best disc;
  - line weight 0.7, as Printed.

| | Graphite | Ink |
|---|---|---|
| Base | `#2A2A2E`, a step lighter than the panel | `#0E0E10`, darker than the window |
| Lines | `rgba(236,234,228,.34)` | `rgba(236,234,228,.26)` |
| Star points | `rgba(236,234,228,.6)` | `rgba(236,234,228,.55)` |
| Coordinates | `rgba(236,234,228,.5)` | `rgba(236,234,228,.45)` |

The mockup draws the outer edge a little stronger than the inner lines (`.5` and `.42`). Today the edge uses the line colour at a heavier width. The builder keeps today's rule unless the edge does not read in the owner's walk.

### Stones (mockup 2)

**[Decided]** The flat stones on a dark board use K2 and W3:

- black: fill `#050506`, edge `#5A5A61`, edge width `r × 0.1` (K2);
- white: fill `#D6D4CD`, edge `rgba(0,0,0,.5)`, edge width `r × 0.07` (W3).

**[Proposed]**
- The flat stones take these colours from the board; on a light board they stay as today.
- The other options, K1 (a light edge) and K3 (a slight sheen), are not offered. The owner chose K2 and W3 "as the default", which this design reads as the only treatment. If the owner wants K1 or K3 offered as well, that is a new stone choice and changes this design.
- Slate and Yunzi are unchanged on every board. On a dark board they are reachable only through 自定义 (Custom).

### Candidates and marks (mockup 3)

**[Decided]** D1: the candidate discs keep today's fills, rings and texts on every board (P2 M1 5.7). So do the table's rank chips.

**Unchanged by their own rule.** The last-move dot and the move numbers keep choosing their ink by the stone under them. The position estimate's squares are unchanged; the black square's light rim is what shows it on Ink.

**[Proposed]** On a dark board, the elements whose dark ink would vanish turn light. All four were shown in mockups 1 and 3:

| Element | Today | On Graphite and Ink |
|---|---|---|
| Ring of the move actually played (`PLAYED_RING`, also `drawNextRing`) | `#2B1D0E` | `#ECEAE4` |
| Variation badge | fill `#1f1a14`, letter `#f3efe4` | fill `#ECEAE4`, letter `#1f1a14` |
| Outline around a badged point | `rgba(43,29,14,.7)` (walnut `#f3efe4`) | `rgba(236,234,228,.75)` |
| Marks and labels on an empty point | `#2b1d0e` (walnut `#f3efe4`) | `#ECEAE4` |

The try-out badge stays amber. Marks on stones keep their ink by stone colour.

## A board per theme (mockup 4)

**[Decided]** Each theme has its own board and stones (option c), shown in Settings as layout S3.

Two other options were not taken:
- a: one board for both themes, as today, with the new sets added;
- b: a default that follows the theme until the user chooses.

**[Decided]** Both themes default to Honey with slate and shell, so nothing changes for anyone who does not choose.

**[Proposed]**
- A device that started in the phone layout defaults to Printed with flat stones in both themes, as today.
- The board drawn is the resolved theme's choice. It switches when the theme does, whether from the setting or from the system.
- **Settings, 设置 → 界面 → 棋盘 (S3):**
  - A small label over the tiles names the theme the window is in: 深色主题下 (`In the dark theme`) or 浅色主题下 (`In the light theme`).
  - There are six set tiles in this order: today's four, then Graphite and Ink, each with flat stones. They are followed by 自定义.
  - The tiles set the current theme's board and never touch the other theme. **[Decided, S3]**
  - One line under the tiles, 浅色主题下 [蜜色 ⌄] (or the dark one), sets the other theme's board from a select of the six sets. **[Decided, S3]**
  - If the other theme uses a Custom mix, the select shows 自定义 and keeps the mix. A mix is made only for the theme the window is in.
- **木纹强度 (Wood grain)** rests only when neither theme's board has grain. Its hint says so in both locales.
- **Migration:** a device that chose a board before this change keeps that choice in both themes.

## Approaches

| Approach | Trade-off |
|---|---|
| **A. Inks as data** (chosen) | `BoardStyle` gains the inks that depend on how dark the board is. The drawing reads them, and walnut moves onto them, which removes the two `=== 'walnut'` checks in `marks.ts` and `badges.ts`. Flat stones read their colours from the board, so there is no new stone style. The first change is a little larger, because walnut must keep its exact pixels. |
| B. More special cases | `graphite` and `ink` join a list of dark boards checked in each place, plus a fourth stone style, "dark flat". The first change is smaller, but every future board layer must remember the list. "Dark flat" would also appear in Custom, where it can be put on Honey. |
| C. Board colours as CSS theme tokens | Dropped. The board is drawn on a canvas and tested with Skia outside a browser, so it cannot read CSS variables. And a board per theme is an explicit choice, not a token that follows the theme. |

**[Decided]** The owner chose A.

## How it is built (A)

- **`BoardStyle` (`src/board/styles.ts`)** gains an ink group: the played ring, the badge fill and letter, the badged-point outline, the empty-point mark ink, and the flat stones' fills and edges.
  - Honey, kaya and printed take today's values.
  - Walnut takes today's values too: light marks and outline, but today's dark played ring, dark badge and light-board flat stones. Its screenshots must not change.
  - Graphite and Ink take the values above.
  - The ink group replaces a separate light or dark flag; nothing else needs one.
- **New `BoardId`s `graphite` and `ink`** in `BOARD_IDS`, `BOARD_STYLES` and `SETS` (appended, with `flat` stones), with names in both locale files.
- **Drawing:**
  - `marks.ts`, `badges.ts` and `candidates.ts` read the inks from the style.
  - The best disc's shadow keys off the board having no grain, not off the id `printed` (`candidates.ts`, the only `'printed'` check). The window shadow in `BoardCanvas.tsx` already keys off grain.
  - The flat stone sprites depend on the board's flat-stone colours, so their memo key includes the board (`makeStoneSprites` in `BoardCanvas.tsx`).
- **Device settings:** `boardStyle` becomes one choice per theme. An old single `boardStyle` is read as the choice for both themes. A field that cannot be read takes its default, as today.
- **`useBoardStyle`** returns the resolved theme's choice. Today it is read by:
  - the main board (`MainBoard.tsx`);
  - the sub-boards (`SubBoard.tsx`);
  - the board settings (`BoardStyleControl.tsx`, for the current tile and the grain slider; the slider's rule above needs both themes' boards).
  - The copied board image (`boardImage`) composites the layers on screen, so it follows on its own. The settings thumbnails draw their own sets.
  - The candidate-disc preview in settings (`DiscPreview.tsx`) stays on the Honey colour (`bg-board-base`), as today. **[Proposed]**

## Constraints

- Every string goes through i18n, in both `zh-CN` and `en`, with no middle dot.
- The interface still talks to the engine side only through the transport. This is an interface-only change.
- The window shadow token and the `--board-base` token are unchanged.

## Left to the builder

- How the resolved theme reaches `useBoardStyle`. Today `useThemeSync` writes it to `document.documentElement.dataset.theme` and keeps no store.
- The exact shape of the per-theme field in device settings, and whether it needs a new storage version.
- Field names in the ink group, and whether the played ring's colour stays in `analysis/palette.ts` (looked up per board) or moves onto the board style.
- Whether the outer edge needs its own colour (see Boards above).

## Exit check

- **Screenshot tests:**
  - one baseline per new set (Graphite and Ink, each with flat stones);
  - one with candidates, badges and marks on Ink;
  - every existing baseline unchanged, walnut's included.
- **On the Mac, in `pnpm dev` and `pnpm tauri dev`:**
  - set the dark theme to Graphite and the light theme to Honey, then switch themes from the setting and from the system;
  - repeat with Ink;
  - check Ink's edge against the window. The mockups put the boards on the panel colour `#1E1E21`, but the main board sits on the window colour `#161618`, which separates Ink less;
  - check the discs in every tier, the played ring, badges, marks, try-out numbers, the hovered line, ownership squares and final scoring on both boards;
  - check sub-boards, the copied board image, the settings thumbnails and the grain slider's resting rule;
  - set a Custom mix for one theme;
  - restart, and check both choices are kept;
  - start from an old `aji.device` with a single `boardStyle`;
  - check the phone layout's default.
- **Docs to update:**
  - the interface design: the board section, and principle 2's "the one warm object", which no longer holds on a dark board the user chose;
  - P2 M1 5.7: the board now follows a per-theme choice;
  - `docs/development.md`, where it describes `boardStyle`.

## Built

Built on 2026-11-26 from the plan `docs/superpowers/plans/2026-11-26-dark-boards.md`, on `feat/dark-boards`.

- **Inks.** `BoardStyle.ink` (`BoardInk`: `mark`, `badgeOutline`, `badgeFill`, `badgeLetter`, `played`, `flat`) replaces the walnut checks in `marks.ts` and `badges.ts`. The played ring's colour moved from `PLAYED_RING` to the board; `PLAYED_RING` keeps its width.
- **Flat stones.** They take the board's `ink.flat`, passed to `makeStoneSprites`.
- **The best disc's shadow** keys off grain.
- **The resolved theme** reaches `useBoardStyle` through `useResolvedTheme` (`src/theme/useResolvedTheme.ts`), which follows `<html data-theme>` with a `MutationObserver`.
- **Device settings.** `boardStyles: { dark, light }` replaces `boardStyle` within storage version 1. An older `boardStyle` reads as both themes, and an unreadable entry falls back for its theme alone.
- **The outer edge** uses the line colour at a heavier width, as on the other boards.
- **Screenshot baselines:** `set-graphite-flat`, `set-ink-flat`, `ink-discs-marks-badges@2x` and `ownership-ink@2x` are new. No existing baseline changed.
- **Checked in `pnpm dev`** at 1440 × 900:
  - Graphite, then Ink, for the dark theme;
  - switching to the light theme and back, with the board following;
  - changing the light theme's board from the other-theme select;
  - the grain slider resting with Ink and Printed;
  - the hovered line's numbers on Ink;
  - a reload keeping both choices;
  - a store holding only an old `boardStyle`, read as Ink in both themes and rewritten as `boardStyles` on the next change.
- **Seen only in the screenshot tests:** the position estimate on Ink, and marks on empty points. The development scenario gives no ownership.
- **Found:** a dead black stone under White's square fades to almost nothing on Ink. It is drawn at 45% opacity, black on near-black. Left for the owner to judge.
- **Not checked yet:**
  - `pnpm tauri dev`;
  - following the system theme;
  - sub-boards and the copied image;
  - a Custom mix;
  - final scoring;
  - the phone layout's default;
  - the settings row in the 280 px classic column and in zh-CN.
