# Phase 2 M3 Design: Game Editing

- Date: 2026-11-24
- Status: Approved by the owner on 2026-11-24. A builder check read it first; its seven questions are answered in sections 5.3 to 5.14 as the author's calls.
- Plan: [Phase 2 plan](../plans/2026-11-21-phase-2-roadmap.md), section 6, M3, and section 4.4 (editing in the backend)
- Mockups, approved by the owner on 2026-11-23:
  - [editing tools](../../design/mockups/p2-m3/editing-tools.html) (round 1): where the tools sit, try-out, markup, setup, comments
  - [tree, menus and game information](../../design/mockups/p2-m3/tree-and-info.html) (round 2)
- Interface design: [aji-ui-design](2026-11-19-aji-ui-design.md). This design changes it where section 12 says.
- Markers follow the charter: **[Decided]** by the owner, **[Proposed]** by the author, **[To verify]**.

## 1. Intent

Until now a record in Aji can be read but not changed. M3 makes it editable, so a whole review happens in Aji. A review here means:

- trying lines;
- keeping the good ones as variations;
- writing comments;
- marking points;
- setting up positions;
- fixing the game information;
- saving a file that other programs open with its branches and comments intact.

Every edit can be undone.

Success, in the plan's words: one of the owner's own games is reviewed with editing only, every edit undoes, the game saves and opens elsewhere intact, and quitting with unsaved changes asks first.

## 2. Goals, non-goals, anti-goals

**Goals**

- Playing moves on the board, creating or entering variations. A variation tree panel and letter badges. Promote, reorder and delete variations.
- One undo history for every edit, with redo. An unsaved-changes mark, and a prompt before open, new or quit discards changes.
- Try-out (试下), a throwaway line ended in one step.
- Comments, markup and setup, as the round 1 mockup draws them.
- Game information editing, with KataGo's full rule set under 自定义.
- View rotation and flipping.
- Move numbers on stones, auto-replay, and a setting for the move an opened record shows.
- Save in place, save one branch, and save a clean record.
- Whole-game analysis of all branches. The trend graph and the swing list follow the line the user is on.
- The backlog items listed in section 5.17.

**Non-goals**

- Storing KataGo's suggested line as a variation, by Enter or by menu. **[Decided]** The owner removed it on 2026-11-23. Playing the line out by hand still works.
- Swap colours (交换黑白). **[Decided]** The owner dropped it on 2026-11-23; it goes to charter 7.10.
- A timed replay of a hovered candidate's line (audit P2-G11). **[Decided]** The owner declined it a second time on 2026-11-23, so by the plan's rule it goes to charter 7.10.
- A left click on a stone jumping to its move, and a double click to find a stone. **[Decided]** Only the right-click item 回到这一手 does it (owner, 2026-11-23).
- "Find a move" as a separate search. 回到这一手 and today's jump to a move number cover it. **[Proposed]** It goes to 7.10 unless the owner objects.
- Rotating or flipping the record itself. Rotation and flipping only change the view. **[Proposed]**
- Saving freehand drawings (decision P11).
- Editing the handicap (`HA`) in the game information. Handicap stones are placed in setup mode.
- Session save and restore, and the shortcut editor. Both are M4.

**Anti-goals**: shipping any of these would be a failure, even if everything else works.

- An edit that cannot be undone, or an undo that leaves the record different from before the edit.
- Losing work silently: quitting, opening or creating a game with kept changes without a prompt; a save that drops branches, comments or unknown properties; an edit made during a save that is then marked as saved.
- A try-out line written into a file, or counted as an unsaved change.
- A stray click that moves the user far away in the record, or that changes the record with no visible sign.
- The board or the tree lagging behind input on a large record (plan review focus 6).
- A middle dot "·" as a separator in any interface text. **[Decided]**

## 3. Constraints

- The interface never assumes the engine is local (charter 6.1). Editing, undo and the unsaved-changes state live in the backend's game session. The interface sends edits and renders snapshots, as in Phase 1 (decision O2).
- No file path crosses the transport. The interface's platform layer reads and writes files, and holds the token of the file the game came from.
- `aji-core` depends on no workspace crate and does no I/O.
- Every user-visible string goes through i18n, in `zh-CN` and `en`, without "·".
- No new dependency is planned. Any that turns out to be needed must have an AGPL-compatible licence.
- The browser build with the fake backend (`src/dev/`) must run the new flows, because the phone-width exit check runs there (P2 M1 exit, plan section 4.2).

## 4. Approaches

### 4.1 The editable game and undo

| | A. Edit commands with inverses **(chosen)** | B. Immutable tree snapshots | C. Copy the tree per edit |
|---|---|---|---|
| What | `aji-core`'s `Game` becomes a mutable node pool. Each edit is a command that records its inverse; undo applies the inverse. | Each edit makes a new tree that shares unchanged parts with the old one; undo swaps the root back. | Before each edit, clone the whole SGF tree; undo restores the clone. |
| Gains | Keeps today's arena and lazy board computation. Node ids stay stable through undo, so the interface's current node and selection never jump. Every command is a pure function, testable in bulk. | Undo is correct by construction. | Simplest. |
| Costs | Every edit needs a correct inverse. Tests must show that doing and undoing an edit leaves the record as it was. | Rewrites the arena and the per-node board cache; likely a new dependency. | A 20 MB record is cloned on every edit (plan review focus 6). Ruled out. |

**The owner chose A on 2026-11-24. [Decided]**

### 4.2 What a click on the board keeps

| | A. Keep by default, try-out on request **(chosen)** | B. Scratch by default, keep on request | C. Scratch until touched |
|---|---|---|---|
| What | Every move played is kept as a variation. Try-out is a mode whose line one step discards. | Moves are temporary until a "keep" action. | A line is kept once commented, marked or promoted. |
| Gains | Nothing is lost. Matches LizzieYzy (a click adds a branch, V is scratch) and interface design 6. | Clean files and tree. | Clean files with no extra step. |
| Costs | Exploring adds lines, and marks the game changed. | Forgetting to keep loses the line silently, and a new keep action reverses interface design 6. | The rule is invisible, so lines appear or vanish unexpectedly. |

**The owner chose A on 2026-11-23. [Decided]** A mistake under A is visible clutter that undo removes. A mistake under B or C is a lost line found only when the file is gone.

### 4.3 Where the editing tools sit

Round 1 of the mockups showed two options:

- a row under the header (A);
- a rail between the board and the panel (B).

**The owner chose A on 2026-11-23, with every call the mockup drew. [Decided]** The rail would add a strip outside the panel's single surface (interface design principle 4), and the setup tools would crowd it.

## 5. Design

### 5.1 The editable game (`aji-core`)

- **The node pool.** `Game` keeps its arena of nodes, each with its SGF properties, parent and ordered children. Ids are never reused.
  - An edit that removes nodes detaches them. They stay in the pool while the undo history can bring them back, and are dropped with the history entry that holds them.
  - The root is the one node with no parent. It is no longer assumed to be id 0, because flattening makes a new root (5.9).
  - The invariant "a child's id is larger than its parent's" is removed. Inserting a move breaks it.
- **The main line** is the root's first child, its first child, and so on. Promoting a variation reorders children; the main line is never stored apart from the children's order.
- **Derived state.** Each node's board, move number, player to move and illegal flag are computed when first asked for, as today. They are kept in a cache that an edit clears for the changed node's whole subtree. `OnceLock` gives way to a cache the `&mut self` edits can clear.
- **Memory (backlog M6 minor 10).** `has_illegal` no longer keeps a board for every node. Opening a record walks it once and records the illegal flags only. Boards are kept for the nodes on the current path and in a bounded cache of others. **[Proposed]** The builder picks the bound, measured on a 20 MB record.
- **Edits are commands.** `Game::apply(edit) -> Applied` returns what changed and the inverse command. Applying the inverse restores the record exactly: properties in their order, children in their order, and node ids. The commands are listed in section 6.
- **Properties Aji does not know survive every edit.** An edit changes only the properties it is about.

### 5.2 Undo, redo and unsaved changes

- **One history** in the backend's game session. It holds every edit, kept and try-out (5.4). Each entry has:
  - a unique id;
  - the edit and its inverse;
  - whether it is a kept edit;
  - the current node before and after.
- **Undo** applies the inverse and returns to the node the user was on before the edit. **Redo** applies the edit again and returns to the node after it. The node before an edit always exists once the edit is undone, so the user never lands in a removed subtree.
- **What counts as an edit:** every change that is saved into the file. That covers moves, deletes, promotes, reorders, comments, marks, setup, game information, and the rules and komi, which are written as `RU` and `KM`. A rules change is therefore undoable. **[Proposed]**
  - Navigation is not an edit.
  - Neither are view rotation, move-number display and other view options.
- **A new edit after undo** drops the redo entries.
- **An edit that changes nothing is not an entry.** Clicking the record's own next move enters it, and setting a comment, mark, field or rules value to what it already is does nothing. Neither marks the game changed.
- **The history** is cleared on open and new, and holds the last 1000 entries. **[Proposed]**
- **Unsaved changes.** The game is changed when the last applied kept edit is not the one that was last saved.
  - The session records the id of the last applied kept edit at each save. It compares that id, not the stack's length, because try-out entries sit on the same stack and a redo that is dropped can take the saved entry with it.
  - Undoing back to the saved edit clears the mark. A save point lost to a dropped redo leaves the game changed until the next save.
  - Try-out entries never change the mark. 保留为分支 (5.4) is a kept edit and does.
- **The mark** shows as 已修改 in the header (round 1 mockup, section 3), and in the window title on desktop. **[Proposed]**

### 5.3 Playing moves and moving through the tree

- **A click on an empty point plays there** for the player to move (interface design 6).
  - If the move matches one of the current node's children, Aji enters that child.
  - Otherwise it adds a new child after the existing ones and enters it.
  - A click on a candidate disc is the same as a click on its point. On touch, a tap on an empty point plays, and a second tap on a candidate plays it (plan 4.2).
- **An illegal move** (an occupied point, a suicide, or retaking a simple ko at once) is refused with a short notice, and nothing changes. **[Proposed]**
  - The record's own board keeps today's fixed rules, whatever rules KataGo analyses with. So a suicide is refused even under custom rules that allow it.
  - The record's derived state never depends on the rules, and a rules edit clears no board.
  - Superko is left to KataGo, which rejects such a position through M7's existing path.
- **A click on a stone does nothing.** **[Decided]** Its right-click menu has 回到这一手 (5.6).
- **The current line** is the line the user is on. It is remembered, as Sabaki does it. **[Proposed]**
  - The session keeps the line's last node, its *tip*. The current line runs from the root to the tip, then on through first children to the end.
  - Stepping back along the line, PageUp, the trend graph and jumping to an earlier move all keep the tip. So going back into the main part of a game and forward again returns into variation B, and the graph does not change under the cursor.
  - The tip moves when the user leaves the line:
    - entering a node off it (a click in the tree, a letter badge, [ or ], B);
    - playing a move;
    - undo or redo landing off the line.

    The tip becomes that node.
  - A delete that removes the tip moves it to the deepest node left on the old line.

  The current line replaces "the main line" for:
  - the move counter (`38 / 247`);
  - first, last, previous, next, page back and forward;
  - jump to a move number;
  - the trend graph and the swing list;
  - the next-move hint.

  On the main line, nothing changes from today.
- **Keys** (defaults; the M4 shortcut editor can change them):
  - ← and ↑ go back one move; → and ↓ go forward, along the current line. Today's behaviour. **[Decided]** (owner, 2026-11-23, keeping ↑ ↓ as moves).
  - [ and ] switch to the previous and next sibling of the current node: the other continuations from the move before. **[Decided]** (owner, 2026-11-23).
  - B goes back to the main line, at the nearest main-line node on the way to the root (LizzieYzy's 返回主分支).
  - Esc goes back to the node where the current variation leaves its parent line, when nothing else claims Esc (5.15).
  - ⌘Z and ⇧⌘Z undo and redo on macOS; Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y elsewhere. **[Proposed]** When a text field has focus, these keys edit the text instead (5.15).
  - Delete and Backspace remove the current move and everything after it (LizzieYzy's Delete), as an undoable edit. **[Proposed]**
  - V toggles try-out (5.4).
- **Touch:**
  - a tap on a node in the tree, or on a letter badge, enters that line;
  - the swipe of M1 steps along the current line.

### 5.4 Try-out (试下)

The owner's choices on 2026-11-23: a variation marked as try-out, which one step discards (P10), with a button as well as V. **[Decided]**

- **Starting.** Press the 试下 button in the edit row, or V, or choose 在这里试下 on an empty point. The node the user is on becomes the try-out's start, and 试下中 appears in the header. 在这里试下 also plays the move.
- **While it is on:**
  - Every move played is a try-out node. It is drawn on the board with its number in a dashed amber ring, and dashed in the tree.
  - The user can move anywhere in the tree. Moves played from any node, kept or try-out, add try-out nodes.
  - Try-out nodes are analysed like any other, and never enter whole-game jobs (5.14).
- **Ending.** Press 试下 again, or V, or Esc (5.15), or 结束试下 in a try-out stone's menu. Every try-out node goes in one undoable step, and the user is back on the start node.
- **Starting is in the history too,** not as a change. Undo walks back through the try-out moves, then the start (try-out turns off), then the kept edits before it.
- **保留为分支.** Turns the try-out line under the stone into kept nodes, as one kept edit. The line then counts as a change and is saved. If no try-out nodes are left, try-out ends.
- **Try-out is a sandbox.** **[Proposed]**
  - While try-out is on, only try-out edits are allowed:
    - playing moves, which adds try-out nodes;
    - deleting try-out nodes;
    - comments on try-out nodes;
    - 保留为分支;
    - ending try-out.
  - Every edit to a kept node waits until try-out ends, and its control is disabled with the tooltip 先结束试下:
    - delete, promote and reorder;
    - comments;
    - markup and setup;
    - game information and rules;
    - Delete on a kept node.
  - Navigation is free.
  - This keeps two invariants:
    - try-out nodes exist only while try-out is on;
    - its start node always exists.
- **Comments on try-out nodes** go with the node. They are kept by 保留为分支 and dropped with the line. They never count as a change.
- **What 保留为分支 keeps:** the try-out nodes on the path from the start to the chosen stone, and every try-out node below that stone. Other try-out lines stay try-out.
- **Undo across try-out.**
  - Undoing 结束试下 brings the nodes back and turns try-out on again, with the same start.
  - Undoing 保留为分支 makes those nodes try-out again, and turns try-out on if it had ended.
  - Redo does the reverse.
- **Opening or creating a game** ends try-out silently, because nothing in it is ever saved.
- **Saving during try-out** leaves the try-out nodes out of the file.

### 5.5 The variation tree (分支 panel)

As in the round 2 mockup.

- **The panel kind** is `tree`. It folds to nothing when the record has no variations, and appears with the first (interface design 4.4).
- **Its shape follows its panel.** Moves run left to right when the panel is wider than tall, and top to bottom otherwise. **[Proposed]**
- **What it draws:**
  - each node as a small stone of its colour;
  - a ring on the current node;
  - a dot on nodes with a comment;
  - letter tags on the current node's children: A for the first, then B, C and so on;
  - try-out nodes dashed in amber;
  - every fifth main-line move numbered.

  Nodes without a move (setup or comment only) are drawn as a small hollow square. **[Proposed]**
- **Layout** is a pure function from the tree payload (6) to positions. It places each variation in the first lane free from its branch point. Only the visible window is drawn, and the panel scrolls to keep the current node in view.
- **A click on a node** goes to it. A right-click or long press opens the node menu (5.6).
- **Where it sits** in the presets: **[Proposed]**
  - **默认:** 评论 and 分支 join the tab group of 候选 and 波动.
  - **The wide default:** the record column becomes a tab group of 分支 and 评论 above the sub-board (round 2 mockup), weighted 2 to 1. The analysis column keeps 候选 and 波动.
  - **经典:** a tab group of 分支 and 评论 goes under the trend graph in the left column. That is the room the owner kept there in M1.
  - **极简, 思考 and 四盘:** neither panel; 显示 → 布局 shows them.
  - A layout saved before M3 has neither panel, and gets them the same way, or by a reset, as M2's 波动 did.
- **Empty.** Alone in its place, an empty tree folds to nothing. As a tab it shows 还没有分支.

### 5.6 Right-click menus

Every item is an undoable edit or a navigation, so none asks for confirmation. On touch a long press opens the same menu.

- **A kept stone in the tree, or a letter badge on the board:**
  - 设为主分支: moves the line to be the first child at every branch point up to the root;
  - 上移一位: swaps the variation with its previous sibling, so the letters reorder without touching the main line;
  - 删除这个分支: removes the whole variation the stone is in, from where it leaves its parent line, as LizzieYzy's 删除分支 does;
  - 删除这一手及之后: removes the stone's node and everything after it;
  - 编辑评论: opens 评论 on that node with the cursor in it.
  - **The variation** a stone is in starts at its nearest ancestor (or itself) that is not its parent's first child. 设为主分支 and 删除这个分支 are disabled on the main line. 上移一位 is disabled on a first child. **[Proposed]**
- **A try-out stone:** 结束试下 (回到第 N 手), and 保留为分支.
- **A stone on the board, normal mode:** 回到这一手 (第 N 手), and the move-number toggle. 回到这一手 goes to the node on the current path that placed the stone. **[Decided]** The label is the owner's wording, 2026-11-23.
- **An empty point, normal mode:** 在这里试下, 停一手, and 标记 ▸ to put one mark without entering markup mode.
- **In setup mode, a stone:** 删除这颗子, 改为黑子 or 改为白子, and a hint that stones are dragged.

### 5.7 Comments (评论 panel)

- **The panel kind** is `comments`. It shows the current node's `C`, edited in place.
- **Editing.** A click puts the cursor in it. The text is kept when the field loses focus, when the user moves to another node, or on Esc, as one undoable edit per visit. **[Proposed]** Clearing the text removes `C`.
- **While the field has focus,** keys type text, and the board's shortcuts wait (today's focus rule).
- **Labels.** The panel's line names the move (第 38 手 白 N17), or 开局前 on the root.
- **On a phone** the panel is a tab, and the on-screen keyboard edits it.

### 5.8 Markup (标记)

Decision P11, with the round 1 mockup. **[Decided]**

- **Marks in opened files are always drawn** (`TR`, `SQ`, `CR`, `MA`, `LB`). Outside markup mode, a candidate disc on a marked point draws over the mark.
- **The tools:** triangle, square, circle, cross, letter and number. A click places the chosen mark; a second click with the same tool removes it.
  - The letter tool places the next free letter (A, then B), and the number tool the next free number.
  - A point holds one mark. A different tool replaces the mark there.
- **Discs while marking.** While 标记 is on, the candidate discs hide; analysis and the table go on.
- **清除标记** removes every mark on the current node, as one edit.
- **Freehand (✎)** draws in the interface only. It is never sent to the backend or saved. It clears on navigation and with 清除涂鸦. While ✎ is on, a swipe draws instead of navigating. **[Proposed]**
- **Each mark is an edit.** Marks belong to the node they were placed on.

### 5.9 Setup (摆子)

The round 1 mockup, and audit P2-G8.

- **Where setup stones go.** **[Decided]** with the mockup.
  - A node with a move (`B` or `W`) is not changed. The first setup edit adds a new child setup node and enters it, so the record's later moves never change under the user.
  - A node without a move, such as the root or a setup node, is edited in place.
- **The tools:**
  - ● and ○ add stones of one colour, ◐ alternates. A click on a stone of the chosen colour removes it.
  - Dragging a stone moves it.
  - A stone's menu removes it or flips its colour.
- **The setup properties.** A stone added is `AB` or `AW`. A stone removed is `AE` when the parent's board had it; otherwise it is taken out of `AB`/`AW`. A move is an `AE` at the old point plus an `AB`/`AW` at the new one.
- **轮到** sets `PL`.
- **停一手** adds a pass for the player to move. It works outside setup too, through the empty-point menu.
- **插入一手** toggles an insert tool. The next click puts a move of the chosen colour between the current node and all its children, and enters it. Later moves keep their colours. A move that becomes illegal is flagged, as illegal moves in files are today.
- **折叠为新局面** (flatten):
  - makes a new root holding the current board as `AB`/`AW`, the player to move as `PL`, and the old root's game information;
  - keeps the current node's continuations under it, and drops the moves before it and other branches;
  - can be undone. **[Proposed]** in its details.
- **Discs while placing.** While 摆子 is on, the candidate discs hide, as in markup.

### 5.10 Board view: rotation and flipping

- **The view options** are 显示 → 旋转 ▸: 顺时针 90°, 逆时针 90°, 水平翻转, 垂直翻转, 还原. On Windows and in the browser they are in the header's 视图 button; on a phone, in the header menu.
- **Only the drawing changes.** The record, the cache and every coordinate stay as they are.
  - The margin's letters and numbers move with their lines, so Q16 is still labelled Q16 wherever it is drawn.
  - The candidate table, the swing list and comments keep matching the board.

  **[Proposed]**
- **Not kept.** It resets when another game opens. It applies to the main board and the sub-boards.

### 5.11 Game information and rules

As in the round 2 mockup.

- **Where it opens.** The title's chevron menu and the rules chip open the popover. On a phone it is a sheet.
- **Fields, edited in place,** each change one undoable edit:
  - 黑方 and 白方 with ranks (`PB`, `BR`, `PW`, `WR`);
  - the result (`RE`);
  - 日期, 赛事, 轮次 and 地点 (`DT`, `EV`, `RO`, `PC`);
  - the game name (`GN`), which the title shows when present. **[Proposed]**
- **The result** is built from a winner (黑胜, 白胜, 和棋, 无结果) and a margin in points, or 中盘, 超时 or 弃权. It is written as `B+2.5`, `W+R`, `B+T`, `B+F`, `0`, or removed.
  - An `RE` that does not fit these shows as text and stays until changed.
  - **填入点目结果** appears when M2's final scoring has a count for this game, and writes it in.
- **Rules and komi** are the M6 control. 自定义 adds KataGo's full rule set: scoring, ko, suicide, tax, handicap bonus and button.
  - Changing them is an undoable edit (5.2). It changes every position key, so it stops a whole-game job, as in M2.
  - On save, `RU` is the preset's name (`Chinese`, `Japanese`), or KataGo's rule string for a custom set (for example `koPOSITIONALscoreAREAtaxNONEsui1button0whbN`). **[Proposed]** `KM` is the komi.
  - **Backlog M6 minor 4.** The rules count as changed only when the effective rule set differs from the file's reading. That means every KataGo field (scoring, ko, suicide, tax, handicap bonus, button) and the komi. So choosing 自定义 without editing no longer rewrites `RU` or `KM`, and Fox's `KM[375]` stays as it was.
  - **Fields the popover does not show,** such as KataGo's `friendlyPassOk`, carry over from the preset the custom set started from.
  - **Reading `RU`.**
    - A KataGo rule string, as Aji writes it, is read back as that exact custom set.
    - Every other name is read as today, with M6's two presets and custom (`RU[AGA]`, `Korean` and the rest keep their current reading and position keys).
  - **Counting.** Final scoring (M2) counts with the scoring and komi only, as today. Tax and handicap bonus do not change the count in M3, and 填入点目结果 writes what the count shows.
- **The handicap** (`HA`) shows as text, not edited.
- **New games.** 新建棋局 gets 其他路数 ▸ with sizes 5 to 18, beside 19, 13 and 9. **[Proposed]**

### 5.12 Move numbers, auto-replay and opening

- **Move numbers on stones,** in 显示 → 手数 ▸: 不显示, 全部, 最近 N 手 (N in settings, 10 by default), and 分支内从 1 开始. These are device settings (P2 M1 design 4.2). N toggles between off and the last chosen mode. **[Proposed]**
- **Auto-replay.** A ▶ button beside the navigation, and in the phone's bottom bar.
  - It steps along the current line at an interval set in 设置 → 界面 (1.5 s by default).
  - Any navigation, edit or click on the board stops it, and so does the end of the line.
  - It has no key by default. **[Proposed]**
- **Opening a record** shows its first move or its last, by a setting in 设置 → 界面 (audit P2-G12). The default is today's behaviour, the start of the game. **[Proposed]**

### 5.13 Saving

- **Save in place.** 保存 (⌘S, Ctrl+S) writes back to the file the game came from, through a new `PlatformFiles.save(token, bytes)`.
  - With no file (a new game, or the browser) it is Save As.
  - A record that opened with the `Truncated` or `Repaired` warning goes to Save As the first time, so the original stays as it was. **[Proposed]**
  - **Saving in place keeps the file's encoding.** **[Proposed]**
    - A GBK file is written back in GBK, with its `CA` as it was, or none if it had none.
    - If a character does not fit that encoding (a new comment in another script, say), the file is written as UTF-8 with `CA[UTF-8]`, and a notice says so.
    - Why: when Aji guessed the encoding wrong but the bytes still decoded cleanly, writing the same text back in the same encoding restores each property's original bytes. The layout of the file (line breaks, `FF` and `GM`) may change; the text does not. A UTF-8 conversion would make the wrong guess permanent.
    - **[To verify]** with real short GBK records that Aji reads as EUC-KR. If their text does not come back intact, a file whose encoding was guessed goes to Save As the first time instead, and the owner is told.
    - After a Save As, or a fallback to UTF-8, the file is UTF-8, so later saves write UTF-8 with no further notice. A new game is UTF-8.
    - Fox's GBK records, the owner's usual source, need no extra dialog.
  - Save As writes UTF-8, as today.
- **The handshake.** The backend owns the unsaved-changes state; the interface writes the file.
  - The export response carries the id of the last kept edit it contains.
  - After writing, the interface sends `gameSaved` with that id and the file's token.
  - An edit made while the file was being written is therefore still unsaved.
  - A failed write sends nothing, and shows today's failure notice.
- **Save options.** 文件 gets 另存当前分支… and 另存为纯净棋谱….
  - The branch option writes only the root's path to the current node and its line onwards.
  - The clean option writes no comments and no analysis.
  - Both are Save As, and leave the game's file and its unsaved state alone. **[Proposed]**
  - The M2 setting 保存时写入分析结果 applies to 保存, 另存为 and 另存当前分支.
- **Try-out nodes** are never written.
- **Analysis on branches.** `LZ` and `LZOP` are written on every node with a cached result, branches included, and read from every node on open.
- **Backlog M6 minor 9.** A game with no moves can be saved: header only, or with setup or comments.
- **The prompt.** Open, 新建棋局 and quit (closing the window, ⌘Q, the native Quit) ask when the game is changed: 保存, 不保存, 取消.
  - Desktop uses a native three-button dialog where the dialog plugin offers custom labels, else an in-app one.
  - Quitting waits for the answer. A failed save cancels the quit.

### 5.14 Whole-game analysis, the trend and branches

- **Job scope.** 分析全局… (M2 design 5.3) gets a scope choice: 当前路线 (the current line; on the main line this is M2's behaviour), or 所有分支.
  - Range and side apply to both.
  - Positions are de-duplicated by key, as today. Try-out nodes are never planned.
  - **[Proposed]** All branches is the whole tree in depth-first order. The current position still goes first.
- **The job plans positions by key, not by line index.** Edits do not re-plan or stop it, except a rules or komi change, as in M2. Its results go into the cache by key, and so stay right after any edit. New positions created by edits are analysed live, or by the next job. **[Proposed]**
- **The trend graph and the swing list** show the current line, by node (backlog M7 minor 4). A click on the graph goes to that node.
  - The service computes trend updates against the current line when a result arrives, matching by key.
  - Updates carry the line's revision (6), and the interface drops updates for any other revision (plan review focus 5).
- **Progress.** `JobProgress` names the positions being searched and queued by key, not by main-line index. The strip under the graph shows the current line's part of the job, matched by key. The counts (done and total) cover the whole job. **[Proposed]**
- **The next-move hint** uses the next node on the current line that has a move. Nodes that only set `PL` or comments are skipped (backlog M7 minor 6).
- **清除整局的分析结果** clears every position in the tree.

### 5.15 Modes and Esc

- **Modes.** Normal, 试下, 标记 and 摆子. At most one of the last three is on.
  - Pressing a lit mode button turns it off.
  - Pressing another switches to it, except that 标记 and 摆子 are disabled during try-out (5.4).
  - M2's final-scoring mode stays separate, and turns the edit modes off while it is on.
- **Esc** does the first of these that applies:
  1. close an open menu, popover or dialog;
  2. finish editing the comment field (its text is kept);
  3. turn off 标记 or 摆子;
  4. end try-out (undoable);
  5. go back to where the current variation leaves its parent line.
- **Text fields own their keys.** While a text field has focus, ⌘Z and ⇧⌘Z undo text, and the board's keys wait. The macOS 编辑 menu's 撤销 and 重做 follow the same rule. **[To verify]** The native menu routes to the webview's text undo when a field has focus.

### 5.16 Touch paths

Plan section 4.2 requires one for each action. M3's:

| Action | Touch |
|---|---|
| Play, enter a candidate's point | Tap; a second tap on a candidate (M1) |
| Modes, undo, redo | The edit row's buttons, under the board on a phone |
| Every right-click menu | Long press |
| Switch continuations ([ ]) | Tap a letter badge or a tree node |
| Esc's step 5 | The node menu, or a tap in the tree |
| Freehand, drag a stone | Finger drag; swipe navigation is off in those tools |
| Comments, game information | The on-screen keyboard; game information as a sheet |
| Rotation, move numbers | The header menu |
| Auto-replay | ▶ in the bottom bar |

### 5.17 Backlog items

- **M6 minor 2:** the komiUnreadable detail names the rules actually used.
- **M6 minor 3:** the encodingGuessed title also covers a declared `CA` that failed.
- **M6 minor 4:** in 5.11.
- **M6 minor 5:** a missing recent file can be clicked to remove it, in the macOS menu as elsewhere.
- **M6 minor 6:** a drop opens the first `.sgf` among the dropped paths.
- **M6 minor 9:** in 5.13.
- **M6 minor 10:** in 5.1.
- **M7 minor 4:** in 5.14.
- **M7 minor 5:** PageDown stops on a trailing node with only a comment, and held PageUp and PageDown do not queue a burst.
- **M7 minor 6:** in 5.14.

### 5.18 The browser fake

- `src/dev/fakeGame.ts` gains a small tree of its own:
  - moves and variations, navigation, undo and redo;
  - try-out, comments, marks, setup stones and game information;
  - the unsaved mark and the save handshake.

  It is enough for every M3 flow to be tried in the browser, at phone width.
- It does not apply the rules beyond captures, and does no analysis of branches.
- The rules of record editing are tested in Rust. The fake is only for the interface.

## 6. Protocol

The changes, in the style of the existing `Request`, `Response` and `AppEvent`. Names are the builder's to finish; shapes are what matter.

- **Addressing by node.** `NodeId` becomes part of the protocol.
  - `NavTarget` gains `Node(id)`, `Sibling(±1)`, `BranchPoint` and `MainLine`. `Move(n)` and the rest follow the current line.
  - The snapshot carries:
    - `node`;
    - `lineIndex` and `lineLength` (moves on the current line), in place of `lineIndex` and `mainLineLength`;
    - `lineRevision`, which changes when the current line's nodes change (a new tip, or an edit on the line).
  - Today's main-line-only `index` goes.
- **The snapshot also carries:**
  - `comment`, and the node's marks;
  - `continuations` (each child's node, move and whether it is try-out, in letter order);
  - `tryout` (its start node, or none);
  - `changed`, `canUndo` and `canRedo`;
  - `treeRevision`;
  - `placed`: each stone on the board that a move placed, with that move's node, number and number within the variation (for 回到这一手 and move numbers);
  - `saveAsFirst` (5.13).
- **`GameOpen`** gains `atEnd` (5.12).
- **`GameTree`**, a request, and an event on every structure change, carries `treeRevision` and the tree in a compact form, in depth-first preorder. For each node:
  - its id and parent;
  - its colour and move;
  - flags: comment, try-out, no move, illegal.

  Children's order is their order in the list. It is not part of the snapshot, so navigation never re-sends it.
- **`GameEdit { edit }`**, answered with the snapshot. The edits:
  - `Play { mv }`, `Pass`, `InsertMove { color, mv }`;
  - `Delete { node }` (the node and its subtree);
  - `Promote { node }`, `MoveUp { node }`;
  - `SetComment { node, text }`;
  - `SetMark { node, point, mark }`, `ClearMarks { node }`;
  - `SetupStone { point, stone }`, `MoveStone { from, to }`, `SetToPlay { color }`, `Flatten`;
  - `SetInfo { field, value }`, `SetRules { rules }`;
  - `TryoutStart`, `TryoutEnd`, `TryoutKeep { node }`.
- **`GameUndo`** and **`GameRedo`**, answered with the snapshot.
- **`GameExport { options }`**, where the options are the branch-only, clean and in-place flags. The response gains `editId`, and for an in-place save the bytes in the file's encoding (base64) instead of text. **`GameSaved { editId, utf8 }`** marks the game saved, and says whether the file is now UTF-8.
- **`GameSetRules`** becomes `GameEdit { SetRules }`.
- **`JobOptions`** gains `scope: Line | AllBranches`. `JobProgress` names positions by key (5.14).
- **`TrendNodes`** carries `lineRevision`, and `GameTrend` answers for the current line, by node.
- **`PlatformFiles`** (interface only) gains `save(token, bytes)` and `confirmDiscard()`, the three-button prompt.

## 7. Testing

- **`aji-core`:**
  - For each edit, and for random sequences of edits on real records: applying then undoing leaves the record identical (properties, order, ids, written SGF), and redo matches the first application.
  - Setup placement (5.9), insert, flatten, and promote.
  - The removal of the child-id invariant.
  - The memory bound on a generated 20 MB record.
- **The game session:**
  - the history and the unsaved mark, including try-out entries, 保留为分支, a dropped redo across the save point, and a save with an edit in flight;
  - the current node after undo and redo;
  - the current line, its tip through navigation, undo and deletes, and the navigation targets;
  - the try-out invariants: kept edits refused during try-out, and undo of 结束试下 and 保留为分支;
  - saving in place in the file's encoding, and the UTF-8 fallback;
  - `LZ` on branch nodes, read and written.
- **The service:**
  - an all-branches job;
  - trend updates after an edit, and their revision;
  - the rules edit stopping a job;
  - the export and `gameSaved` handshake.
- **The interface:**
  - the tree layout function (both shapes, lanes, a 10 000-node tree);
  - the modes and Esc order;
  - the menus and the comment panel's keep-on-blur;
  - the marks drawn on the board (screenshot tests, as M1's);
  - the save, open and quit prompts;
  - touch paths at 375 × 812.
- **Interoperability [To verify]:** a record edited and saved by Aji opens with its branches, comments and marks in Sabaki and LizzieYzy. Fox's client is checked if it opens local files.

## 8. Performance

- A node edit, undo or redo answers within 50 ms on the Mac, on a 300-move game with 50 variations. **[Proposed]**
- The tree payload of a 10 000-node record builds in under 100 ms. The tree panel scrolls at the display's frame rate, drawing only what is visible.
- Opening a 20 MB record keeps memory within the bound of 5.1.

## 9. Exit (Mac, local build)

From the plan, made concrete:

- One of the owner's own games is reviewed with editing only:
  - try-out lines, ended and kept;
  - a promoted variation;
  - comments;
  - markup;
  - a setup position.
- Every edit undoes and redoes. Undoing to the saved state clears 已修改.
- The game saves in place. The file opens in Sabaki or LizzieYzy with its branches, comments and marks intact.
- Quitting, opening and 新建棋局 with unsaved changes ask first. Quitting with only try-out lines does not.
- An all-branches job analyses the variations. The graph follows the line the user is on.
- Each new action works by touch at 375 × 812 in the browser with the fake.
- Both themes.

## 10. Left to the builder

- The names in the protocol, and how the tree payload is packed.
- The board cache's bound (5.1), measured.
- The tree's lane algorithm, within 5.5.
- How the native quit waits for the interface's prompt on each platform.
- Icons for the edit row and its tools.

## 11. Decisions log

The owner's, during the design (2026-11-23 unless marked):

- A click keeps the move; try-out discards its line in one step, on V and a button (4.2).
- No stored engine line, by key or menu.
- No swap colours.
- The editing tools in a row under the header, and every call of the round 1 mockup (4.3).
- The round 2 mockup as drawn.
- 回到这一手, on the right-click menu only; a left click on a stone does nothing.
- ↑ ↓ keep stepping moves; [ ] switch continuations.
- No timed replay of a hovered line (P2-G11 declined again).
- Edit commands with inverses for the editable game (4.1), 2026-11-24.

## 12. Changes to other documents

- **Interface design:**
  - **4.1:** the edit row (试下, 标记, 摆子, undo, redo) under the header, and 试下中. The "no try-a-move button" rule is withdrawn (P10).
  - **4.4:** the tree is a panel whose shape follows its panel.
  - **5.4:** the try-out's letter is amber.
  - **6:**
    - no Enter to store a hovered line;
    - [ ] switch continuations, and ↑ ↓ step;
    - the right-click menus of 5.6;
    - marks now exist without playing (P11);
    - undo covers every edit.
  - **8:** the right-click menus are designed.
- **Charter:**
  - **7.2:**
    - "Board transforms: rotate, flip, swap colours" becomes "Board view: rotate and flip".
    - "Click a stone to jump to its move, double-click to find a stone, find a move" becomes "Go back to a stone's move from its menu".
  - **7.3:** "Hover a candidate to show its variation, with replay" becomes "…, stepped with the wheel". The Phase 1 audit (H3, G8) read "replay" as the timed replay, now in 7.10.
  - **7.10** gains, with the reason "the maintainer's decision, 2026-11-23":
    - swap colours;
    - the timed replay of a hovered line;
    - storing the engine's line as a variation;
    - double-click to find a stone, and find a move.
- **Phase 2 plan:** P10 and P11 marked settled by this design, P2-G11 declined and moved to 7.10, and M3's status updated when it is built.
