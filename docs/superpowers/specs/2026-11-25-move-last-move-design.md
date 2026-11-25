# Move the last move: design

- Date: 2026-11-25
- Status: Waiting for the owner's approval
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
