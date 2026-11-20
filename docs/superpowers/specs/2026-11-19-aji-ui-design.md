# Aji Interface Design

- Date: 2026-11-19
- Status: Agreed with the owner in a design session; not yet reviewed as a written document
- Scope: the main screen and the first-run engine setup. These are the screens Phase 1 builds.
- Markers: **[Decided]** was decided by the owner. **[Proposed]** was chosen while designing and can be overturned. **[Open]** is not settled.

This document records the outcome of a visual design session. It sits beside the [project charter](2026-11-19-aji-project-charter-design.md), which remains the source of truth for scope and architecture. Chinese appears here only where it is interface text.

Reference screenshots are in [`docs/design/mockups/`](../../design/mockups/). They were rendered from static mockups and show intent, not final pixels:

| File | Shows |
|---|---|
| `main-dark.jpg` | Main screen, dark theme |
| `main-light.jpg` | Main screen, light theme |
| `setup-1-detect.jpg` to `setup-5-install.jpg` | First-run engine setup as first drawn in five steps; the first two are now one page (section 7) |

## 1. Principles

1. **The board is the interface.** It is a square on a landscape screen, so its size is set by window height. Nothing may take vertical space from it: no top bar, no bottom bar. Horizontal space is cheap and holds everything else. **[Decided]**
2. **The interface gets out of the way.** Neutral greys only. The wooden board is the one warm, saturated object on screen. **[Decided]**
3. **Colour means evaluation.** The only accent colour appears on the best candidate move. It is not reused for selection, buttons or decoration. **[Decided]**
4. **One panel, not cards.** The right side is a single surface divided by hairlines. No rounded, bordered, floating cards. **[Decided]** The owner rejected a cream background with white rounded cards as generic.
5. **Numbers are the content.** Win rates, score leads and visit counts are what users read most, so numerals get a typeface chosen for them.

## 2. Themes

Two themes, dark and light. The default follows the operating system; when the system preference cannot be read, dark is used. **[Decided]**

| Token | Dark | Light | Used for |
|---|---|---|---|
| `ground` | `#161618` | `#E3E3E0` | Window background around the board |
| `panel` | `#1E1E21` | `#F5F5F3` | Right-hand panel |
| `hairline` | `#303035` | `#D6D6D2` | Section dividers, panel edge |
| `divider-soft` | `#28282C` | `#E6E6E2` | Table row dividers, selected row fill (dark) |
| `text` | `#ECEAE4` | `#1D1D1B` | Primary text, win-rate line |
| `text-muted` | `#A3A19A` | `#5E5E5A` | Labels, secondary values, icons |
| `line` | `#5A5A61` | `#A3A39E` | Tree connectors, inactive outlines |
| `score` | `#E3A548` | `#B26A00` | Score-lead line and its axis labels |
| `engine-ok` | `#1E8E5A` | `#1E8E5A` | Engine running indicator |
| `engine-error` | `#E5484D` | `#C62828` | Engine indicator, crashed state **[Proposed]** |

The values are **[Proposed]** starting points taken from the mockups. The dark theme was reviewed more closely than the light one.

## 3. Typography

| Role | Typeface | Notes |
|---|---|---|
| Chinese text | LXGW WenKai (霞鹜文楷) | **[Decided]** All Chinese, including labels and table headers |
| Latin text and numerals | Inter | **[Decided]** With tabular figures (`font-feature-settings: 'tnum'`) everywhere |

- The font stack lists Inter first and LXGW WenKai second, so Latin letters and digits come from Inter and Chinese falls through to WenKai. Reversing the order would hand the digits to WenKai, whose figures are uneven in width.
- No monospace typeface. Tabular figures give column alignment without the loose spacing of a monospace decimal point and percent sign.
- Bundle the original LXGW WenKai, which follows mainland glyph and punctuation conventions. The mockups load the "TC" build from Google Fonts because that is the only one hosted there; it covers Simplified characters but centres its punctuation, which the shipped app must not do.
- Both typefaces are under the SIL Open Font License and may be bundled with an AGPL application.
- Bundle size: M5 bundles a subset of LXGW WenKai (GB2312 plus every character of the `zh-CN` locale, about 1.6 MB per weight as WOFF2), with a test that the subset covers the locale (roadmap O6). Characters outside it fall back to the system Chinese font.
- **[Open]** WenKai at 11 px (table headers) is looser than a sans-serif would be. If it reads poorly in the real app, raise that tier by one size before changing typeface.

## 4. Main screen layout

Reference size 1440 × 900.

```
┌──────────────────────────────────────────────┬──────────────────────────────┐
│                                              │ game title ▾   ⏮ ◀ 38/247 ▶ ⏭ ● ⚙ │
│                                              ├──────────────────────────────┤
│                                              │ win-rate bar                 │
│                                              │ trend graph                  │
│                  board                       ├──────────────────────────────┤
│               (868 × 868)                    │ candidate moves              │
│                                              │                              │
│                                              ├──────────────────────────────┤
│                                              │ variations (only when any)   │
└──────────────────────────────────────────────┴──────────────────────────────┘
```

- The board is a square as tall as the window minus a 16 px margin on each side. **[Decided]**
- The panel takes the remaining width (about 540 px at the reference size) and runs the full height, flush with the window's right edge.
- There is no application top bar. **[Decided]** The controls that used to live there are the first row of the panel.
- **[Open]** How extra width is used on wider windows: a larger board is impossible once height is exhausted, so the choice is a wider panel, a second panel column, or side margins.
- **[Open]** Small-screen and touch layouts for the remote client (charter Phase 3) are not designed.

### 4.1 Panel header row

Left to right:

- **Game title**, with a chevron. Clicking it opens the game library. **[Proposed]** The library is not a permanent sidebar; an earlier mockup with one cost the board too much room. The opened state is not designed yet. **[Open]**
- **Navigation**: first move, previous, `38 / 247`, next, last move.
- **Engine indicator**: a green dot when analysis is running. Clicking it pauses and resumes analysis; details such as version and visits per second appear on hover. **[Proposed]**
- **Settings**.

There are no "review", "play" or "tsumego" mode tabs. **[Decided]** There are no "try a move", "let the AI continue" or "pause analysis" buttons. **[Decided]**

### 4.2 Win rate and trend

- **Win-rate bar**: a black segment and a white segment whose widths are the two win rates. Each side's percentage is written inside its own segment, white on black and black on white. **[Decided]** Score lead and its uncertainty sit to the right of the bar as text (`黑领先 1.8 目 · 误差 ±6.4`).
- **Trend graph**: win rate and score lead are always drawn together, win rate against a left axis of 0–100% and score lead against a right axis in points. There is no switch between them. **[Decided]**
- Mistakes are short bars along the bottom of the graph, in the muted text colour so they do not compete with the accent.
- A dashed vertical line marks the current move.
- The line under the graph carries the legend and a one-line verdict on the previous move (`上一手 白 H8 缓手，损失 2.3 目`).

### 4.3 Candidate table

Columns: rank chip, point, win rate, score lead, visits, difference from the best move. **[Decided]** Prior ("first instinct") and the continuation were tried and removed at the owner's request. The continuation is still reachable by hovering a candidate on the board.

- The rank chip uses the same styling as that candidate's disc on the board (section 5.3).
- The move actually played in the game is labelled in the last column (`实战 −3.3%`).

### 4.4 Variations

- The section is absent when the game has no variations. It appears when the first one is created and has a "hide" control. **[Decided]**
- The main line is a horizontal row of numbered stones. Each variation drops down from the move where it departs and runs to the right, with a short label.
- The current move has an accent ring.
- The first move of every line available from the current position carries a letter: A for the main line, then B, C and so on in order of creation. The same letters appear on the board (section 5.4).

## 5. Board

### 5.1 Surface

- A wooden board in a warm honey tone (`#DDB067` base) with a straight grain, a lit top edge, and a darker lower edge that gives it thickness. **[Decided]** as a direction.
- Grid lines and star points in dark brown; coordinates (A–T without I, 1–19) in the margin on the top and left.
- The mockups build the grain from CSS gradients. Reviewed on screen it reads as a fairly even yellow panel with mechanical stripes. M5 replaced it with a procedural straight grain from summed value noise, generated once per size and pixel ratio from a fixed seed. **[Proposed]**

### 5.2 Stones

- Realistic rather than flat. **[Decided]**
- Black: matte slate, a small soft highlight toward the upper left.
- White: shell, a faint diagonal grain, inner shading at the lower edge to show curvature.
- Both cast two shadows from a light at the upper left: a tight contact shadow and a soft offset one. The contact shadow is what makes a stone sit on the board instead of floating.
- The last move is marked with a small dot in the centre of the stone.

### 5.3 Candidate moves

Candidates are paper-coloured discs carrying win rate over score lead. Quality is shown by weight, not by a colour per tier. **[Decided]** The owner rejected blue, green, and a filled red disc as clashing with the board, and approved paper discs with rings.

| Tier | Fill | Ring | Text |
|---|---|---|---|
| Best | `#FDF6E3` | 3.5 px cinnabar `#B8321F`, plus a drop shadow | `#2B1D0E`, bold |
| Close | `#FBF1D9` | 1.5 px cinnabar `#B8321F` | `#2B1D0E` |
| Doubtful | `#FBF1D9` at 85% | 1.5 px brown `#8A6A32` | `#4A3410` |
| Poor | `#FBF1D9` at 50% | 1 px brown at 60% | `#4A3410` |

- The move actually played in the game gets an additional 2.5 px dark outer ring on top of its tier. **[Decided]**
- Tier boundaries of 2 and 4 percentage points of win-rate loss are **[Proposed]**.
- **[Open]** Whether the best move's ring stays cinnabar. The owner disliked a filled cinnabar disc; the ring-only version has been shown and not objected to. A walnut-brown ring is the fallback.

### 5.4 Variation markers

When the current position has more than one recorded continuation, each one is marked on its intersection. **[Decided]**

- A small dark badge with a letter sits on the upper-right rim of the point, clear of the win-rate numbers of any candidate disc there.
- A continuation that is not among the engine's candidates also gets an empty outlined disc, so the letter is not floating over an empty intersection.
- Only continuations from the current position are marked. Branch points elsewhere in the game appear in the variation tree only.

## 6. Variation interaction

Playing a move is the only way to make a variation; there is no separate marking action. **[Decided]**

**Creating**

- Clicking an empty intersection plays there. If that move differs from the recorded continuations, a new variation is created and entered. If it matches one, that line is entered.
- Clicking a candidate disc is the same as playing on that point.
- Hovering a candidate previews the engine's continuation. Pressing Enter while hovering stores the whole continuation as one variation.

**Moving**

- Clicking a letter badge on the board, or a node in the tree, enters that line.
- Left and right arrows step through moves. Up and down arrows switch between the continuations of the current position.
- Escape returns to the move where the current variation departs.

**Managing**

- Letters are assigned automatically. Naming is optional.
- Right-clicking a badge or a line in the tree offers: make main line, delete variation, add a note.
- Deleting can be undone.

Two defaults chosen without an explicit answer from the owner, both **[Proposed]**:

- There is no "mark a point without playing" feature for now.
- Accidental clicks are handled by undo, which removes the stray variation without trace. No modifier key is required to play a move.

## 7. First-run engine setup

Setup uses the main screen's frame: the empty board on the left, the steps in the panel on the right. **[Decided]** When setup finishes, the panel becomes the analysis panel in place. An earlier version, a centred form on an empty page with everything on one screen, was rejected.

A four-segment progress line sits at the top of the panel on every step. Each step asks for one decision.

| Step | Content | Controls |
|---|---|---|
| 1. Hardware and backend | Under a small "本机硬件" label, four compact rows: graphics card, memory, operating system, driver, each a spinner while checking and a tick when found. Below them, once detection finishes, a radio list: CUDA, TensorRT, DirectML, OpenCL. Each row is a name and a tag of a few characters (`最快`, `启动较慢`, `免运行库`, `兼容性最好，最慢`). **[Decided 2026-11-20]** one page, replacing a detect step that advanced on its own | Next |
| 2. KataGo version | A list of releases, newest first: version and release date. The newest is selected and tagged `最新`. The chosen backend and platform are one small line under the title **[Decided]** that the step exists | Next |
| 3. Network | A list ranked by Elo: rank, name, Elo, release date. The top row is selected **[Decided]** | Import network file; Start install |
| 4. Install | One row per task: engine, runtime, network, test query. Done, already there, running with a percentage and a bar, waiting, or failed. A download shows its amount, total, speed and time left: "604 MB / 1000 MB（2 MB/s，还需 4 分钟）". **[Decided 2026-11-20]** no benchmark: the backend's default thread count, measured later from settings | Cancel |

- No explanatory paragraphs, no "recommended configuration" summary, no "recommended" badge. **[Decided]** The default option is simply preselected.
- The backend list depends on detected hardware (charter section 6.3). The four options above are what an NVIDIA card on Windows shows.
- The version step comes after the backend step because the available versions depend on the backend. **[Proposed]** At the time of writing the newest CUDA build is 1.18.2 while every other backend stops at 1.18.1, and 1.17.2 exists for TensorRT only. The list shows only versions that ship the chosen backend for the detected platform. The versions and dates in the mockup are real, read from the KataGo releases on 2026-11-19.
- Versions and networks already on disk carry a muted "已下载" (downloaded) tag. **[Decided 2026-11-20]**
- The network list comes from Aji's manifest, which is built from katagotraining.org. The names, ratings and dates in the mockup are real values read from that page on 2026-11-19.
- There is no download-source selector in the wizard. **[Decided 2026-11-20]** (M5): the owner set mirrors aside for now; the `downloadSource` setting remains for development.
- Every step has "暂不设置" (set up later) on the left of the footer, "取消" (cancel) when setup was opened again over a working engine. While a job runs, Cancel is the only control. The title row has a compact `中文 · EN` switch. When CUDA's licences have not been accepted, a licence panel comes before the install (M5 design 5.2).
- **[Decided 2026-11-19]** Which network is preselected: the top row, the highest-rated network on katagotraining.org that the chosen KataGo version can load, on every machine. There are no GPU tiers and no local measurement. On 2026-11-19 that is the transformer `kata1-tf3-b11c768-s12382M-d6533M`.
- **[Open]** The list has no size or speed column, because the source page publishes neither. Both should be added once the manifest carries them, since strength against speed is the real choice.
- Failure states are designed and built (M5 design 5.3, mockups `docs/design/mockups/m5/failure-states-v2.html`): A1 for an old driver (Retry first, the fallback second), A2 for other backend failures with a fallback (the fallback first), B when nothing else would help (Retry and Back), and D for an engine that crashes later, in the analysis panel.

## 8. Not designed yet

- The opened game library.
- Settings beyond M5's (`docs/design/mockups/m5/settings.html`: interface, analysis, engine, About). Changing backend or network after setup goes through the wizard again ("重新设置引擎"). The engine section's "搜索线程" line and its "测速" button run the benchmark in place (M5 design 5.4).
- Hover preview of a candidate's continuation, and the right-click menus of section 6.
- Ownership and territory display, policy heatmap, move-quality marks on stones.
- Playing against the AI.
- Layouts for windows wider or smaller than the reference size, and for touch.
- Error and empty states outside setup. The setup failures, the no-engine panel and the crashed engine are designed (M5).

## 9. Effect on the charter

- Charter section 7.9 lists light and dark themes under Phase 2. The design assumes both exist from Phase 1, because every colour is already a token.
- Bundled fonts add to the installer size estimated in charter section 4.
- Charter section 5 names Tailwind CSS and shadcn/ui. Nothing here conflicts with that, but the design uses few stock components; most of the screen is custom drawing.
