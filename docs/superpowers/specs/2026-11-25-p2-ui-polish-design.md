# Phase 2 UI polish: design

- Date: 2026-11-25
- Status: Waiting for the owner's approval
- Placement: one small branch, `feat/p2-ui-polish`, between Phase 2 M3 and M4. It does not change M4's scope.
- Mockup: [`docs/design/mockups/p2-polish/ui-polish.html`](../../design/mockups/p2-polish/ui-polish.html), sections 1 and 2. Section 3 there (thickness, inlaid lines) was superseded by the photographed-grain spike described in section 3 below.

## Why

The owner asked for three interface changes before M4, all about how a review feels:

1. Reaching 形势判断 takes the T key or a menu. It should be one click away, next to the try-out button.
2. Before clicking, the user cannot see which point a click lands on.
3. The wood boards look flat. The goal is material quality (质感): the board should read as real wood. Adding thickness was tried and rejected because it did not achieve that.

## 1. 形势判断 in the edit row

- A toggle button labelled 形势判断 in [`EditRow`](../../../src/edit/EditRow.tsx), after 摆子, with a thin divider before it (mockup option B, the owner's pick). The divider marks that 试下, 标记 and 摆子 exclude each other while 形势判断 is a view that can stay on during any of them.
- It is the same switch as T, the 显示 (视图) menu item and the ✕ on the estimate line: it runs the `estimate.toggle` command, and its pressed state comes from the estimate store.
- Disabled during 终局点目 and when no game is open, like the other three.
- Hover text: 形势判断 with its key from the keymap, `形势判断 (T)`. Every string goes through i18n, in both locales.
- Touch layout: the same button in the same row, at the 44 px target size. The mockup shows it fits on one line with undo and redo at 375 px.

## 2. The point under the mouse

- A filled square on the empty point under the mouse, in the colour that a click there would place. This replaces the ghost stone first proposed; the owner asked for squares like Fox (野狐).
- **Size and rim:** 52% of the line spacing, with a contrasting rim: light on a black square, dark on a white one (mockup option B, the owner's pick). The position estimate's territory squares are 36% (`OWNER_SQUARE` in `src/board/ownership.ts`); the larger size and the rim keep the hover square distinct when the estimate is on.
- **Colour:** the side to move. In 摆子 mode, the colour the setup tool places (black, white, or the alternation's next colour).
- **Not shown:** on a stone, on a candidate disc (the disc's own hover shows its line), in 标记 mode, during 终局点目, and on touch input. It disappears when the mouse leaves the board.
- It is drawn on a layer above the board and stones, not into the cached board image, so moving the mouse never redraws the wood.

## 3. Material quality for the wood boards

Applies to 蜜色 (honey), 榧木 (kaya) and 胡桃 (walnut). 印刷 (printed) stays flat, as do flat stones.

### Approaches considered

| Approach | Trade-off |
|---|---|
| **A. Photographed grain** (chosen) | Real wood detail, the largest gain. Costs about 0.2 to 0.5 MB per board in the bundle and a licence record. |
| B. Better procedural grain (noise-based rings and pores) | No assets, sharp at any size, but much tuning, and procedural wood rarely reads as real. |
| C. Keep today's grain; add only lighting and finish | Cheapest, but leaves the cause of the flat look in place. |

The owner compared A against today's boards in a throwaway page and chose it, with the grain turned down to almost the lowest setting.

### What is built

- **Grain from photographs.** One CC0 photograph per board from Poly Haven. Only its light and dark are used: the photo's luminance is normalised to a mean of 1 and a fixed contrast, then multiplied into the board's own base colour. Each board keeps its colour; the photo supplies only the grain. The grain runs top to bottom.

  | Board | Photograph | Character |
  |---|---|---|
  | 蜜色 | `okoume_veneer` | flowing grain (板目) |
  | 榧木 | `ash_veneer` | straight grain (柾目) |
  | 胡桃 | `natural_walnut_veneer` | walnut |

- **Grain strength.** The owner found the spike most comfortable near its lowest setting (0.3 to 0.4 on its slider). The spike's luminance contrast (standard deviation) at full strength was 0.10 for okoume, 0.07 for ash and 0.13 for walnut. **[Proposed]** The default is 0.35 of those: about 0.035, 0.025 and 0.045. The owner checks all three boards in the built app and the default is tuned then.
- **A setting for the grain (the owner's request, 2026-11-25).** 设置 → 界面 → 棋盘 gains a 木纹强度 slider under the style tiles:
  - from 0 (no grain: the board's plain colour with its finish) to 1 (the spike's full strength), in steps of 0.05, default 0.35;
  - one value for every wood board, since the photographs are already brought to matching contrasts;
  - the board and the style thumbnails follow it live while dragging;
  - shown but disabled with the 印刷 board, which has no grain;
  - stored per device with the board style, in the client settings store (P2 M1 design 5.8), so a phone and the desktop can differ. Saving follows the store's existing rules; a stored value outside 0 to 1 falls back to the default.
  - **[Proposed]** The finish (sheen, light, rim, shadow, contact shadow) has no switch of its own; it is faint, and the slider covers the part people disagree about.
- **Finish,** drawn into the cached board image, so it costs nothing per frame:
  - a varnish sheen: a broad, faint reflection across the upper left;
  - light from the upper left across the surface, and a bevelled rim (light top and left edges, dark bottom and right);
  - a soft shadow from the board onto the window, as a CSS shadow outside the canvas, so the board's geometry and hit testing do not change. Its colour follows the theme.
- **Stone contact shadow:** a tight dark ring where a slate or yunzi stone meets the wood, added to the pre-rendered stone images. Flat stones get none.
- **Not built:** board thickness and inlaid grid lines (tried in the mockup, rejected), a choice of photograph per board, and a switch for the finish.

### Assets and licence

- The three photographs ship as pre-processed greyscale detail maps (normalised luminance, no colour) in `src/assets/wood/`, at a size the builder picks so a desktop board at 2× density stays sharp (about 1600 to 2048 px). Greyscale JPEG keeps each file small.
- Poly Haven assets are CC0, compatible with AGPL-3.0-or-later. `src/assets/wood/SOURCE.md` records each asset's page, the downloaded file, its SHA-256 and the processing, as `src/assets/fonts/SOURCE.md` does for fonts. Whether the third-party notices and the About page need an entry for CC0 assets is checked against how the notices are generated.

## Constraints

- Every string through i18n, both locales, no middle dot.
- The board image stays a pure function of the view and style (`drawBoard`). Screenshot tests under `src/board/__screenshots__` are regenerated and reviewed.
- Nothing changes for printed boards or flat stones.

## Left to the builder

- Texture resolution and JPEG quality.
- How the detail maps load (bundled import, decoded once) and how `wood.ts` caches the tinted result per size.
- Exact sheen, light and shadow values, starting from the spike's.
- The layer used for the hover square.

## Exit check

On the Mac, in `pnpm dev` and the built app: the button by mouse and by touch, at desktop and phone widths, both themes; the hover square in each state above, with the estimate on and off; the three wood boards in both themes, compared against today's; the 木纹强度 slider at 0, the default and 1, surviving a restart. Then the owner's walk.
