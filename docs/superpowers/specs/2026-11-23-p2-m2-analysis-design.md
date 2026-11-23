# Phase 2 M2 Design: Whole-Game Analysis, Cache and Review Views

- Date: 2026-11-23
- Status: Approved by the owner on 2026-11-23
- Plan: [Phase 2 plan](../plans/2026-11-21-phase-2-roadmap.md), section 6, M2, and section 4.3 (the analysis cache)
- Mockups, approved by the owner on 2026-11-23:
  - [whole-game analysis controls](../../design/mockups/p2-m2/analysis-controls.html) (round 2)
  - [next-move hint and ownership](../../design/mockups/p2-m2/next-move-and-ownership.html)
  - [final scoring](../../design/mockups/p2-m2/final-scoring.html)
  - [candidate list and swing list](../../design/mockups/p2-m2/lists.html)
- Interface design: [aji-ui-design](2026-11-19-aji-ui-design.md). This design changes it where section 12 says.
- Markers follow the charter: **[Decided]** by the owner, **[Proposed]** by the author, **[To verify]**.

## 1. Intent

Phase 1 analyses only the position on screen and forgets everything when Aji quits. M2 makes a game something Aji analyses once and remembers. It adds whole-game analysis, a cache that survives restarts, and the review views built on top of them: the swing list, the next-move hint, ownership with the position estimate, and final scoring.

The owner reviews games. Success is opening a record, starting one job, and minutes later stepping through a game whose graph is complete, whose worst moves are listed, and whose numbers are still there tomorrow.

## 2. Goals, non-goals, anti-goals

**Goals**

- Whole-game analysis of the main line, a range of moves, or one side's moves, on Aji's single engine. The position on screen always goes first.
- A second, deeper pass over large win-rate swings (波动时加强). **[Decided]** The owner added it on 2026-11-23. The Phase 2 audit had filed it as Phase 5 (WA8).
- A persistent analysis cache in SQLite, with a size cap and commands to clear one position, one game, or everything.
- The swing list panel, and the candidate table's sorting, share of visits and column menu.
- The next-move hint for a move KataGo did not list.
- Ownership, the position estimate (形势判断) and final scoring (终局点目).
- LizzieYzy analysis in SGF files: `LZ` and `LZOP` read on open, and written on save when the user asks.

**Non-goals**

- Analysis of branches other than the main line. That is M3, with editing.
- Writing a final-scoring result into the record (`RE`). That is M3, with the game information editor and undo.
- `LZ2` and `LZOP2` (a second engine's analysis). They wait for dual-engine mode in Phase 5 (audit P2-L2). Phase 1 already keeps them on save.
- A second KataGo process for the job.
- Changing KataGo's thread layout for faster batch work. M2 keeps `numAnalysisThreads = 1` and measures first (section 4).

**Anti-goals**: shipping any of these would be a failure, even if everything else works.

- The board stalling or lagging behind navigation while a job runs.
- A cached result from another network, or other rules, shown as the current one.
- Marks drawn on played stones to grade moves. The owner rejected move-quality marks on 2026-11-23 ("No need to display 恶手 on the board"). **[Decided]**
- Mistake bars on the trend graph (decision P8, M7 design 13.2).
- A middle dot "·" as a separator in any interface text. **[Decided]** The owner's rule for the whole project, 2026-11-23.

## 3. Constraints

- The interface never assumes the engine is local (charter 6.1). The job, the cache and the scoring logic live in the backend. The interface reaches them only through requests and events.
- `aji-core` depends on no other crate in the workspace.
- Every user-visible string goes through i18n, in `zh-CN` and `en`, without "·".
- New dependencies must have AGPL-compatible licences. M2 adds `rusqlite` with its `bundled` feature: MIT, and SQLite itself is public domain.
- KataGo runs as one analysis engine with `numAnalysisThreads = 1` (`crates/aji-manager/src/install/config.rs`). It searches one position at a time.

## 4. Approaches

### 4.1 How the whole-game job shares the engine

| | A. Aji schedules, one position at a time **(chosen)** | B. KataGo batches |
|---|---|---|
| What | The engine actor keeps a job queue. It sends the next job position when the board's query no longer needs the engine, and terminates the job's query when the user moves. | One query with `analyzeTurns` over the game at low `priority`; the board's queries go at high priority. KataGo's queue interleaves them. |
| Gains | Pause, stop, progress, skipping cached positions, the boost pass and "current position first" are decided in our code and tested with the fake KataGo. A move to a new position starts searching within milliseconds. | Less of our code. No gap between job positions. |
| Costs | More state in the actor. A few milliseconds between job positions, about 1–2% at 500 visits; one query queued ahead removes it. | Coarse control: pausing or skipping means terminating and rebuilding the batch. A higher priority only reorders the queue, so the job position already running finishes first, up to about half a second of lag per move. The fake KataGo would have to imitate KataGo's scheduler. |

**The owner chose A on 2026-11-23. [Decided]** On throughput the two are equal: with one analysis thread, KataGo searches one position at a time either way. On responsiveness, A is better.

**Ruled out:** a second KataGo just for the job (LizzieYzy's way). The plan says Aji uses one engine. Two processes would also compete for the same GPU and its memory.

**Measured later, not built:** several analysis threads fill the GPU's batches better on short searches. But the setting is fixed when KataGo starts, and it takes threads from live analysis. M2 records the job's real throughput on the Mac (exit, section 10) before anyone builds a batch mode.

### 4.2 The cache store

The plan already chose one SQLite file (decision P5). The only open choice was the library. `rusqlite` with `bundled` is the plain one: synchronous, with no async runtime of its own, and the bundled build avoids depending on the system's SQLite. It runs on its own thread, so the engine actor never blocks on disk (section 5.2).

## 5. Design

### 5.1 One loss scale

A move's **loss** is the mover's win rate before the move minus after it, in percentage points. The same applies to score lead, in points. Both positions must have a result. A negative loss is a gain and is never listed. (Audit K6: one definition.)

- It is computed once, in the backend, and sent with each main-line node and with the next-move result (section 6). The interface never recomputes it.
- The swing list, the boost pass and the next-move disc of 5.6 use this loss.
- **The candidate discs' tiers are a different measure and stay as they are:** each candidate's gap from the best candidate of the same search, computed in the interface (`src/analysis/candidates.ts`; under 2, 2–4, over 4 points, interface design 5.3). When the played move is a listed candidate, its disc and its 实战 tag keep that M7 behaviour. **[Proposed]**

### 5.2 The cache

- **One SQLite file**, `analysis.sqlite`, in the app's local data folder. A dedicated thread owns the connection, and the engine actor talks to it through a channel. Writes are batched in transactions.
- **The key** is the position plus the engine identity (plan 4.3):
  - **The position:** `PositionKey` gains KataGo's full rule set: ko, scoring, tax, suicide, button and handicap bonus, as KataGo's `rules` object names them. The interface still offers only the presets until M3. Nothing was persisted before M2, so the encoding can change now without a migration.
  - **The engine identity:** the network's SHA-256, plus a hash of the config keys that change search results. **[Proposed]** The KataGo version is stored in each row but is not part of the key. A KataGo upgrade with the same network keeps the cache. A different network never shows another network's rows.
- **A row** holds:
  - the root win rate, score lead and visits;
  - the candidates, as today's `AnalysisUpdate` has them;
  - the ownership map, one signed byte per point (−127 to 127);
  - whether it was imported (5.11);
  - the KataGo version;
  - the time it was last used.

  A 19×19 row is a few kilobytes.
- **More visits wins.** A result replaces a row only if it has more root visits, or the same visits and is final (today's `AnalysisCache::offer`).
- **Imported rows** (5.11) give way to a fresh result once that result has more visits than the imported row, or once its search finishes, whatever its visits. A progress report with fewer visits never replaces them, so stepping onto an imported position does not throw its result away. A fresh row never gives way to an imported one (audit K4). **[Proposed]**
- **When the file can't be used** (it is corrupt, the disk is full, or it can't be opened), Aji keeps analysing with the in-memory layer only. A corrupt file is renamed aside and a new one created. 设置 → 分析 → 分析缓存 shows the reason, and a one-time notice line says results are not being kept (plan risk 3). Jobs still run; their results last for the session. Two copies of Aji may share the file: it is opened in WAL mode with a busy timeout, so no single-instance guard is needed. **[Proposed]**
- **A hot layer stays in memory.** The actor keeps today's LRU in front of the database, so navigating stays as fast as Phase 1. A miss reads from SQLite.
- **The size cap:** default 1 GB, set in 设置 → 分析 → 分析缓存. When the file passes the cap, the least recently used rows go first, in batches of 10%.
- **Clearing:**
  - 清除本局面的分析结果: the current position's row;
  - 清除整局的分析结果: every main-line position of the open game;
  - 设置 → 分析缓存 → 清除…: everything, after a confirmation dialog.

  Clearing the current position restarts its search.
- **Restart and crash:** the job and the board both read the cache first, so after a restart nothing already analysed is searched again.

### 5.3 Whole-game analysis

**Starting it.** 分析全局… is in the game menu, and on macOS in a new menu-bar menu, 分析 (⌘⇧A). **[Decided]** No button in the graph's legend.

**Its panel** drops from the game title, the way the rules chip opens its panel today (mockup section 2):

- 范围: 整局, or 一段 (第 x 到 y 手);
- 分析: 双方, 只黑, 只白;
- 每手计算量: default 500;
- 波动时加强: on by default, at a win-rate swing over 10%, up to 3000 visits;
- a line estimating the time from the engine's current speed, and saying how many positions are already cached and will be skipped;
- 取消 and 开始. Return starts.

Every choice is remembered for the next game. **[Proposed]** These defaults are the author's call.

**What gets analysed:**

- **Moves x to y** means the positions from just before move x to just after move y.
- **Only one side** (owner's choice, 2026-11-23): 只黑 searches only the positions where Black is to move, about half the work.
  - A Black move's loss then comes from the position before it: that position's win rate minus the played move's own win rate in its candidate list.
  - If KataGo didn't list the move, the position after it is searched too, for that move alone.
  - Where both positions have results anyway (from browsing, or an earlier job), 5.1's loss is used as usual.
  - The swing list marks a loss taken from the candidate list no differently. The progress total counts only the positions the job will search.
- **Skipping:** a position whose cached row already has at least the budget's visits is counted as done and skipped. Imported rows count too, by their stored visits, so a LizzieYzy-analysed record is not searched again.
- **Order:** the current position first, then the rest of the range from its start to its end.

**Sharing the engine** (4.1 A):

- The engine actor holds the job's queue beside the board's query.
- **The current position goes first.**
  - While a job runs, the position on screen is searched until it has the job's budget, or the board's own visit limit if that is lower.
  - Then the job takes the engine back, even when the board's limit is 不限. Otherwise an unlimited board would starve the job forever.
  - When the job ends, the board returns to its own limit and carries on.
- **Navigating** to a new position terminates the job's in-flight query and serves the new position at once. The terminated position goes back to the front of the job's queue.
- **One job query is queued ahead** of the running one, so KataGo never waits for Aji between positions.
- **Job queries** ask for ownership, and for progress reports only once a second. The reports aren't shown; they keep the stall watchdog fed, since a 3000-visit boost search on a slow machine can run past its 60 s limit. Without them KataGo would be killed as hung.
- **The engine state while only the job searches** is `analysing`, so the engine dot is green, and a click or Space pauses. The "continue to the next visit limit" action only applies when no job is running. `engineAction` learns about the job from `JobProgress` (section 6).
- **Pausing** (the engine dot, or Space) pauses the board and the job together, as it does today. **Stopping** (✕, or 停止全局分析) clears the queue. Results already stored stay.
- **What stops a job:**
  - the user;
  - opening or creating another game;
  - changing the rules (every position key changes);
  - a change of network or engine config (the engine identity changes);
  - 清除整局的分析结果.

  The status then reads `已停止`, and the user starts the job again. Cached positions are skipped, so nothing is redone.
- **A job does not outlive Aji.** On relaunch the user starts it again, and every cached position is skipped. Restoring a whole working session is M4 (decision P6). **[Proposed]**

**The boost pass (波动时加强):**

- When the first pass is done, the backend finds every move in the range whose win-rate loss or gain, in absolute value, is over the threshold.
- It queues both positions of each such move at the boost budget.
- Positions already at that budget are skipped.
- Swings are found once, from the first pass. The boost pass does not look for new swings in its own results.

**Progress** (mockup sections 3–5; owner's choice 3A):

- **A strip under the trend graph:** one cell per main-line move.
  - Solid: has a result.
  - Faint: queued.
  - Green: being searched.
  - During the boost pass, its queued cells stand taller. They drop back once done, so nothing stays behind to mark the swings.
  - The strip shows from the job's start until the game is closed.
- **The legend row's status**, after 目差:
  - `分析全局 158/248 约 2 分钟 ✕`
  - `分析全局 176/248 先算当前局面 ✕`, while the job waits on the board
  - `已暂停 158/248 ✕`
  - `加强分析 3/9 约 1 分钟 ✕`
  - `已分析全局` for a few seconds when the job finishes, then nothing.
- **The engine card** gains one line: `全局分析 176/248，正在先算第 200 手`.

**Background on open** (decision P4): 设置 → 分析 → 打开棋谱时分析全局, off by default. When it's on, opening a game starts a job with the remembered choices. Opening another game stops the previous game's job.

**The trend graph** fills in as results arrive. Today the interface writes only the on-screen position's updates into its trend store (`useTrendSync`), and `GameTrend` is a whole-line push sent only on open and similar events. M2 adds an incremental event, `TrendNodes` (section 6):

- the backend sends it whenever it stores a result for a main-line position, from the job or from the board;
- each event carries the changed nodes, with their stats and their recomputed losses, and the loss of the next node as well;
- it is throttled to one event per 250 ms;
- it carries the game's revision, so a stale push never overwrites a newer one. This also fixes M7 minor 8, the trend race.

Losses therefore follow every stored result, including the board's live search.

### 5.4 The swing list (波动)

A new panel kind, `swings`, labelled 波动 (mockup section 3).

- **Default layout:** a tab beside 候选. Like any panel, it can be moved through the layout menu (P2 M1). The other presets don't include it.
- **Controls:**
  - 按 胜率 / 目差;
  - the threshold, defaulting to 5% for win rate and 2 points for score;
  - 仅后续 (only moves after the current one).

  They are remembered per device.
- **Lists:** one per side, 黑 and 白, each sorted by loss, biggest first. A row shows 手数, 落点, the win-rate loss and the score loss.
- **The current move's row** is highlighted.
- **Clicking a row** goes to the position before that move. The board then shows KataGo's candidates there, with the move actually played ringed or shown as its own disc (5.6). **[Proposed]**
- **With partial results** (no whole-game analysis yet), the list holds what it can, and a footer says it's incomplete. **With none**, it points to 棋局菜单 → 分析全局…. It has no button of its own, since the start command is in the menus only.

### 5.5 The candidate list

These go into today's `CandidateTable` (mockup sections 1–2).

- **Sorting:**
  - Clicking 胜率, 目差 or 计算量 sorts by that column, high to low.
  - A second click reverses the order.
  - A third click goes back to KataGo's order.
  - The rank chips keep KataGo's numbers, so a chip always matches its disc on the board.
- **Share of visits** goes in the 计算量 cell, as a percentage plus a hairline bar under the number. It isn't a column of its own.
- **与最佳相比 is off by default. [Decided]** The move actually played gets a small 实战 tag beside its point instead.
- **A header menu** (right-click on the header row) has:
  - a checkbox for each of 胜率, 目差, 计算量, 占比 and 与最佳相比 (the chip and the point always stay);
  - 候选点数量 (自动, 5, 10, 全部; 自动 is today's rule);
  - 变化长度 (how many moves a hovered line shows);
  - 按 KataGo 排序.

  These are the two M7 non-goal settings (audit CA1). All of them are device settings.
- **The narrow-panel fallback** to four columns stays.

### 5.6 The next-move hint

- **The record's next move is among the discs:** unchanged from M7. The disc gets the dark outer ring.
- **It isn't** (owner's choice B):
  - It gets a disc of its own on its point, with the same outer ring.
  - The disc's numbers are the next position's cached result, seen from the side to move.
  - Its tier comes from its loss (5.1), which the backend sends with it, so a bad move looks pale. This works in variations too, where there is no trend node.
  - The candidate table gets the same row, with the 实战 tag.
  - If the next position has no result yet, the hint is the ring alone, around the empty point. The disc appears once a result arrives.
- **The candidates are hidden** (F, Z, or the engine stopped): the next move shows as the ring alone.
- **A setting,** 设置 → 分析 → 显示棋谱的下一手, on by default, turns the hint off entirely, for guessing the next move.
- **Variations:** the next move is the next node in the current branch. Its result comes from the cache like any other position.

### 5.7 Ownership and the position estimate (形势判断)

- **Every query asks for ownership** (`includeOwnership`), and every cached row keeps it (5.2). `AnalysisUpdate` carries it, quantised to one signed byte per point.
- **The switch:** 形势判断, under 显示 in the macOS menu bar and 视图 on Windows, with the key T. It is per session and follows navigation. The candidate discs stay on while it's shown.
- **The board** (owner's choice C):
  - a same-size square on every point whose ownership is at least 0.6 for one side, on KataGo's −1 to 1 scale (about 80% sure). This is "the 0.6 rule" below; **[Proposed]**, and cheap to tune;
  - nothing on contested points;
  - a stone whose ownership is at least 0.6 for the other side counts as dead: it is drawn faded, with the other side's square on top.
- **The panel:** a line under the win-rate bar, `形势判断 黑 185 白 176 贴目 7.5 黑领先 1.5 目 ✕`.
  - Every point goes to the side its ownership leans towards, so the counts add up to the board's points.
  - The count follows the rules chip: area for 中国, territory for 日韩. It uses the same scoring function as final scoring (5.8), with the dead stones from the 0.6 rule and the empty points assigned by ownership.
- **While a position has no ownership yet** (no result), the line says so and the board shows no squares.

### 5.8 Final scoring (终局点目)

- **Getting in:**
  - 终局点目 in the game menu, and in the macOS 分析 menu;
  - and, at the last move of a finished game (two passes, or a result in the record), the 形势判断 line offers a 点目 button.
- **Scoring mode:**
  - hides the candidates and pauses the board's analysis, so nothing moves while you mark stones;
  - a running job pauses too, and resumes when you leave.
- **Opening state:** the dead stones KataGo's ownership suggests (the 0.6 rule), drawn as in 5.7. Neutral points get no square.
- **Clicking a stone** toggles its whole group between dead and alive. The count is recomputed each time.
- **The count:**
  - Area (中国): live stones plus regions bordered only by one side, after dead stones are removed.
  - Territory (日韩): the points of each side's regions (a dead stone's point included), plus each dead stone again as a prisoner, plus prisoners taken during the game. A dead stone is worth two points, as in a hand count. (Corrected after the final review; the first build counted it once.)
  - **Open regions** (an empty region touching both colours: dame, or a game that was not played out, such as one decided by resignation): each point the position's ownership settles for a side (the 0.6 rule, Black's view) is that side's, dead stones included; the rest is neutral. On a played-out game the open regions are dame, which KataGo calls even, so the count is unchanged. Without ownership an open region is neutral. When ownership gave any point away, the card says `棋局未下完，未封闭的区域按 KataGo 判断。` (Added after the owner counted a resigned professional game: the flood fill alone gave Black a 7.5-point win where KataGo had White ahead.)
  - Komi is added to White.
  - The result is written `白胜 8.5 目`, or `和棋`.
- **The panel's top part** gives way to a scoring card: a table of the parts, the result, `已改动` with `恢复 KataGo 的判断` once the marking differs from KataGo's, and 退出点目.
- **The logic lives in `aji-core`:** a pure function from a board, a set of dead stones, the position's ownership when there is one, the rules, komi and captures to a score. The interface asks the backend for it through a request on every toggle. The interface never scores on its own.
- **M2 writes nothing back** to the record.

### 5.9 Settings

**Settings → Analysis**, stored by the backend with the other analysis settings:

- 显示棋谱的下一手 (on)
- 打开棋谱时分析全局 (off)
- 分析缓存: space used, the size cap (1 GB), 清除…
- 保存时写入分析结果 (off; 5.11)

**The job panel's remembered choices** are stored by the backend too. It is the backend that starts jobs on open.

**Device settings** (P2 M1's device store) hold:

- the candidate list's sort, columns, 候选点数量 and 变化长度;
- the swing list's 按, threshold and 仅后续.

### 5.10 Commands and menus

New commands, all through the M1 registry:

| Command | Menu | Default key |
|---|---|---|
| Analyse game… | game menu; macOS 分析 | ⌘⇧A on macOS; none elsewhere **[Proposed]** |
| Stop game analysis | macOS 分析 | none |
| Clear this position's analysis | game menu ▸; macOS 分析 | none |
| Clear the game's analysis | game menu ▸; macOS 分析 | none |
| Final scoring | game menu; macOS 分析 | none |
| Position estimate | macOS 显示; Windows 视图 | T |

### 5.11 LizzieYzy analysis in SGF

**The format.** It was read from LizzieYzy's SGF reader and writer on 2026-11-23, at the owner's request (`rules/SGFParser.java`, `rules/BoardData.java`, `util/Utils.java` in yzyray/lizzieyzy). It is described here in our own words. No code is copied or translated (CLAUDE.md).

- **Where it sits:**
  - `LZOP` on the root node holds the analysis of the starting position;
  - `LZ` on a move node holds the analysis of the position after that node's move.
- **Line 1:** `<engine name> <win rate> <visits>`, then, for KataGo, `<score lead> <score spread>` and sometimes a sixth number for PDA.
  - **The win rate** is a percentage with one decimal, written as 100 minus the side to move's win rate. So it is the win rate of the player who has just moved, or at the root, of the player not to move. LizzieYzy reads it back with `100 − x`.
  - **Visits** are abbreviated:
    - under 1,000, exact;
    - 1,000 to 9,949, with one decimal and `k` (`1.3k`);
    - from 9,950, a whole number of thousands (`13k`);
    - from 10 million, with one decimal and `m`.

    LizzieYzy's own reader turns `13k` into 1,300. Aji reads the numbers properly, so `13k` is 13,000.
  - **The score lead** is the side to move's, one decimal, not flipped.
- **Line 2:** the candidates, each `move <point> visits <n> winrate <w> prior <p> scoreMean <s> pv <points…>`, optionally with `pvVisits <n…>`, joined by ` info `.
  - `winrate` and `prior` are hundredths of a percent (`5420` is 54.20%), from the side to move.
  - It may end with ` ownership ` and one number per point, in KataGo's order, from the side to move.
- **[To verify]** The score lead's and ownership's side come from KataGo's `kata-analyze` output, which LizzieYzy stores as it gets it. KataGo's documentation says that output is from the side to move. A file produced by a real LizzieYzy and KataGo would confirm it. The fixture can't, since it is written from this description.

**Reading.** When a file opens, each main-line node's `LZ`, and the root's `LZOP`, become cache rows for their positions, marked imported.

- They are converted to Aji's form: Black's win rate and lead, the candidates, and ownership when present.
- A row is stored only where the cache has no row for that engine identity, or its row is also imported.
- The engine named in `LZ` is not Aji's identity. Imported rows are therefore stored under the current engine identity, flagged imported, and give way to fresh results as 5.2 says (audit K4).
- `LZ2` and `LZOP2` stay untouched (non-goal).

**Writing.** When 保存时写入分析结果 is on, 另存为… writes the same format:

- `LZOP` on the root and `LZ` on every main-line node with a cached result;
- the engine name `KataGo`;
- the abbreviations above;
- ownership when the row has it.

Imported rows are written back as they were read. Unknown properties stay as they are (Phase 1). **[Proposed]** The setting is off by default, so records stay small unless the user wants them for LizzieYzy.

**The fixture.** The invented `crates/aji-core/tests/fixtures/sgf/lizzie.sgf` is replaced by one written by hand from this description, the owner's choice of 2026-11-23. It covers every case: all four visit forms, a root `LZOP`, ownership, and a node without analysis. `SOURCES.md` records how it was made.

### 5.12 Smaller items

- **The middle dot.** These nine strings lose their "·", in both locales:
  - `versionLine`, `engine.card.engineWithBackend`, `analysis.playedBest`, `analysis.captures`, the settings `engineLine`, the board-style `set` label, `rules.fixedHint`, `rules.chip` and `rules.chipChanged`.

  The rule is added to `CLAUDE.md`'s Internationalisation section. **[Decided]** (rule); the new wording of each string is the builder's call.
- **The captures line** reads `提子 黑 3 白 5`.
- **Backlog items** in code M2 touches (plan M2):
  - M7 minor 2: `continue_analysis` resubmits even while a query is in flight;
  - M7 minor 8: the trend race between a fetch and live updates;
  - M7 minor 11's test gaps: the burst test, the cache-to-trend wiring, and superko rejection with real KataGo;
  - M7 minor 12: a cached update keeps its stored `previous_visits`, and the test placement in `update.rs`;
  - M2 N3: re-check the 100 ms throttle against the report interval.

## 6. Protocol

**New requests:**

| Request | Answer |
|---|---|
| `JobStart { range, side, visits, boost: { on, threshold, visits } }` | `Ok`, or an error when no game is open or the engine isn't configured |
| `JobStop` | `Ok` |
| `CacheClear { scope: position \| game \| all }` | `Ok` |
| `CacheStats` | the file's size and the cap |
| `GameScore { dead: Point[] }` | the counts and the result for the current position (5.8) |

**New events:**

- `JobProgress { state: running \| waiting \| paused \| boosting \| done \| stopped, done, total, boostDone, boostTotal, working, queued: lineIndex[], eta }`. It is pushed on every change and at most every 250 ms.
- `TrendNodes { revision, nodes: [{ lineIndex, stats, loss }] }`, the incremental trend update of 5.3. It is throttled to 250 ms.
- `CacheStatus { persistent, reason }` when the cache file can't be used (5.2).

**Changed shapes:**

- **`AnalysisUpdate`** gains `ownership: i8[] | null`. It also gains `next: { stats: TrendStats, loss } | null`: the record's next position's cached result and the move's loss, for the next-move disc (5.6). The backend pushes a fresh update when that result arrives.
- **`TrendNode`** gains `loss: { winrate, score } | null` for its move (5.1).
- **`UiSettings`** gains the fields of 5.9, and the job panel's remembered choices.

Pause and resume keep `AnalysisPause` and `AnalysisResume`, which now cover the job.

## 7. Engine actor changes

- **The actor's state** gains `Job { queue, in_flight: up to 2 ids, budget, boost }`.
- **Each time the board's query is done or idle,** the actor tops the job up to two queries in flight.
- **When the board needs the engine,** it terminates both job queries and puts their positions back at the queue's front.
- **Job results** go to the cache and to the trend. They aren't shown as the current position's analysis unless they happen to be for it.
- **The stall watchdog** watches whichever query is running. Job queries report progress once a second for it (5.3).
- **A crash or a restart of KataGo** keeps the job's queue in the service. The job resumes when the engine is ready again, skipping what the cache already has. Quitting Aji ends the job (5.3).

## 8. Testing

**Rust unit tests:**

- the loss calculation, including passes, missing results, and the one-side form from the candidate list;
- the position key with full rules: stable bytes, pinned by a test vector;
- the cache: more visits wins; imported rows give way only to more visits or a finished search; the size cap evicts the least recently used; the three clear scopes; a reopened file keeps its rows; and a corrupt or unwritable file falls back to memory;
- the job queue: order, skipping (imported rows included), one side (half the positions, plus the after-position for unlisted moves), a range, the boost selection, termination and requeue when the user moves, pause, stop, the events that stop it, and resuming after a KataGo restart;
- the trend's incremental event: losses recomputed for the changed node and its neighbour, and a stale revision ignored;
- the scoring function: area and territory, dead-stone toggles, seki-like regions bordered by both colours, and komi;
- `LZ` parsing of every visit form and of a root `LZOP`, the win rate's `100 − x`, and a write then read round trip on the hand-written fixture.

**Engine tests with the fake KataGo:**

- a job runs to the end;
- navigating mid-job answers within one query round trip;
- an unlimited board limit doesn't starve the job;
- one query is always queued ahead;
- a slow boost search isn't killed by the watchdog;
- the engine dot pauses, not continues, while only the job searches.

**Component tests:**

- the job panel's choices and estimate;
- the strip's cell states;
- the legend status in each state;
- the swing list's filters and its click target;
- the candidate table's sort cycle, share cell, column menu and 实战 tag;
- the next-move disc and its ring fallback;
- the 形势判断 line and the T key;
- the scoring card's toggle and reset.

**Screenshot tests:**

- ownership squares, in both board sets' lightest and darkest woods;
- the next-move disc;
- the scoring board.

**The browser check:** the dev scenarios with the fake transport, including a fake job.

## 9. Performance

- **Gaps between job positions** stay under 5 ms on average, with one query queued ahead.
- **Moving to a new position mid-job** starts its search within one query round trip. The job position already running is terminated, not waited for.
- **Opening a fully cached 300-move game** draws the whole graph from SQLite in under 200 ms on the Mac.
- **The job's real throughput** (positions per minute at 500 visits) is recorded at the exit check, as the baseline for any later batch mode (4.1).

## 10. Exit (Mac, local build)

- With 打开棋谱时分析全局 on, a game opened for the first time is analysed in the background while the user navigates. The current position always answers first.
- A job over a whole game, over a range, and over one side finishes. The boost pass searches the swings again. The strip and the status show each state, including paused and stopped.
- Quitting and reopening shows the whole graph and the swing list at once, with no new analysis. A different network shows none of the old results.
- Clearing a position, a game and everything works. The size cap evicts when lowered below the file's size.
- The hand-written LizzieYzy fixture shows its analysis in Aji: the graph, the candidates and ownership. A record saved with analysis from Aji reads back the same. Opening it in LizzieYzy itself stays [To verify] until someone runs LizzieYzy.
- The next-move hint shows for a move KataGo didn't list.
- Ownership and the estimate show on a finished game. Final scoring matches a hand count on a 9×9 game, under both rule sets.
- No "·" remains in either locale file.
- The job's throughput is recorded (section 9).

## 11. Left to the builder

- Module layout: where the job queue, the SQLite thread and the scoring function sit within the crates, subject to section 3.
- The SQLite schema and indexes, within 5.2.
- The exact time estimate's formula.
- The new wording of the nine "·" strings.
- The order of work inside M2.

## 12. Changes to other documents

- **Charter 7.3:**
  - "Move quality marks (each move coloured by loss)" is removed at the owner's request (2026-11-23);
  - the candidate list row is marked done in M2.
- **Charter 7.4:** a new Phase 2 row, the swing list (P9). "Automatic deeper analysis" (波动时加强) moves from Phase 5 to Phase 2.
- **Phase 2 plan, M2:** quality marks and their loss thresholds leave the build list and the exit. Boost analysis joins.
- **Phase 2 audit:** WA8 is marked as moved to P2-M2. CA2 is marked removed at the owner's request.
- **Interface design:**
  - section 8 no longer lists ownership and move-quality marks as undesigned;
  - section 4.1 gains the macOS 分析 menu;
  - section 4.3 gains sorting, the share of visits, the 实战 tag, and 与最佳相比 off by default.
- **`CLAUDE.md`:** the no-"·" rule (5.12).
