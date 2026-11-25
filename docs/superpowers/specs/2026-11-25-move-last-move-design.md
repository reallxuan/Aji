# Move the last move: design

- Date: 2026-11-25
- Status: Approved by the owner on 2026-11-25 and built on `feat/move-last-move`. Results under **Built** at the end.
- Placement: one small branch, `feat/move-last-move`, before Phase 2 M4.

## Why

The owner wants to correct where a stone was played, for example a hand-recorded game with one wrong point, without replaying the game. Today the only way to move a stone is a drag in 摆子, which writes setup at the current node (`AE` plus `AB`/`AW`) and leaves the move that placed the stone untouched. The owner wants the change made at the move itself.

Rewriting a move deep in the past would recompute every later capture and ko. To keep that under control, the owner chose: go back to the move, so it is the current position's last move, and change only that move's point. The branches after it stay exactly as they are.

## Approaches considered

| Approach | Trade-off |
|---|---|
| **A. A menu item, then a click on the new point** (chosen) | Works by mouse and touch (a long press opens the same menu). One more click than a drag. |
| B. Drag with the right button held | Fastest by mouse, but a right click must still open the menu, so the two are told apart by distance. It clashes with M4's LizzieYzy mouse scheme, where a right click steps back, and has no touch form. |
| C. Both | B's clashes remain, and the work roughly doubles. |

The owner chose A only.

## What is built

### Getting in

- The board's stone menu (right click, or a long press) gains **移动这一手** (`Move this move`), shown only on the stone placed by the current node's move.
- It is offered when the current node is a play (not a pass and not the root), in normal mode or try-out, with no line shown. It is not offered in 标记, in 摆子, or during 终局点目.
- Other stones keep their menu as it is, including 回到这一手, which is how the owner reaches an earlier move first.

### Choosing the new point

- The board waits for a point. The hover square (UI polish design 2) follows the mouse in the moved stone's colour, and a short hint says to click the new point or press Esc.
- A click or tap on a point sends the move. Esc, a right click, navigating away or starting another mode cancels. Choosing the same point does nothing.

### Rules

- The new point is checked in the position before the move, under the record's rules: it must be empty, not suicide, and not retake a ko. An illegal point is refused with the reason, through the notice Aji already uses for illegal moves. Nothing changes.
- The move's captures are recomputed from the new point.
- **Later moves (the owner's choice B).** The node keeps its children, and every later node keeps its move. Before changing anything, the backend counts the later nodes, in every branch, that are legal now and would become illegal. If there are any, the edit is refused with that count, and Aji asks:

  > 移动后，后面有 N 手会变得不合法，无法分析。仍然移动吗？ [移动] [取消]

  移动 sends the edit again, allowing it. The dialog looks like the existing 清除分析结果 confirmation. Nodes that become illegal are marked as Aji already marks illegal moves in a loaded record.
- One undo puts the move back on its old point. Redo moves it again.
- The node's comment, marks and other properties stay.

### Analysis

Cached results are keyed by position, so the positions from the moved node on are new and get analysed as usual. Results for the old positions stay in the cache, unused. A whole-game analysis already run is not restarted; the job panel shows the new positions as unanalysed.

### Unchanged

The 摆子 drag keeps its meaning: it edits setup at the current node and never changes a move.

## Constraints

- **Protocol.** A new session edit `moveLastMove { to, allowIllegal }`, and a new refusal `laterMovesIllegal { count }`. Errors stay `{ code, message }`, JSON is camelCase, and the ts-rs bindings are regenerated.
- **Core.** The edit lives in `aji-core` (`Edit` in `crates/aji-core/src/game/edit.rs`), as an invertible record operation like the others. `aji-core` depends on no workspace crate and does no I/O.
- Every string goes through i18n, in both locales, with no middle dot.

## Left to the builder

- Where the hint shows (the header's tag area or a line under the edit row).
- How the waiting-for-a-point state is held (the mode store or a small store of its own).
- Whether the count of newly illegal nodes walks the subtree directly or reuses the record's illegal-node pass.

## Exit check

On the Mac, in `pnpm dev` and `pnpm tauri dev`, both themes, mouse and touch:

- move a move to a legal point, then undo and redo;
- try an occupied point, a suicide and a ko retake, and see each refused;
- move a move so that a later move lands on the new point, see the dialog with the right count, cancel, then confirm, and see the later node marked illegal;
- check that try-out, 标记, 摆子 and 终局点目 behave as above;
- save and reopen the record in Aji and in Sabaki.

## Built

Built on 2026-11-25, from this design without a written plan.

- **Where things went (the builder's choices).**
  - The hint is a line under the edit row, with a Cancel button: in the side panel on a wide window, under the board on a phone. A first try put it over the board's top edge, where it hid about ten points of the first line and was the only Cancel a touch user had.
  - The waiting state is a small store of its own (`src/edit/moveMoveStore.ts`), not the mode store, since it is not a board mode.
  - The core reuses the record's illegal-node pass: it applies the change, compares the illegal nodes with the ones before, and undoes it.
- **Protocol.** `moveLastMove { to, allowIllegal }`. The refusal is the error code `gameLaterMovesIllegal`, with the count in `detail`, as other refusals carry their reason.
- **Checks.** Rust tests, clippy and formatting; 1010 frontend tests, lint and type checking pass. New tests cover the core edit (captures recomputed, an illegal point refused, the count across branches, a pass refused), the session (try-out, the count), the browser fake, and the interface (the item only on the current move, picking and sending, Esc, Cancel and a right click cancelling, the dialog resending, the question dropped when the position or the record changes, and a double click sending only the move).
- **Browser, `pnpm dev`, `?scenario=analysing`.** At 800 × 600 in the light theme (and in the dark theme before the hint moved): the item shows only on the current move's stone. Picking hides the candidate discs and shows the hover square in the stone's colour. A move to an empty point keeps the move number and gets new analysis. An occupied point is refused with the usual notice. Undo and redo restore each point with its cached analysis. Moving white onto black's next point opens the dialog with a count of 1, and confirming marks move 3 as breaking the rules. In try-out, a record stone has no item, and a try-out stone moves and keeps its try-out number. At 375 × 812 in the dark theme, the board does not move when the hint appears, and a move to J19 on the first line works.
- **Review.** A fresh review of the branch found nothing severe in the core or the protocol. Two interface fixes were folded into the frontend commit:
  - the second click of a double click, landing after the picking ended, could play a stray move; the board now takes no click while the move is on its way;
  - an undo, an edit or entering try-out left the picking or the question open, since only navigation and a new game ended them; they now end on any record change and on try-out.
  Left as it is: the edit names no node, so it moves the move of whatever node is current when it arrives. A navigation still in flight when 移动 is pressed in the dialog would move the new position's move without asking. `play` has the same exposure; closing it would add the node to the protocol.
- **Outstanding:** the owner's walk in `pnpm tauri dev` with KataGo; a long press on a touch screen; ko and suicide points, which the tests cover but the browser did not; save and reopen in Aji and in Sabaki.
