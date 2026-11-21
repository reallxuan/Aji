import { useEffect } from 'react';
import { useOs } from '../app/useOs';
import type { NavTarget } from '../transport/generated/NavTarget';
import { openFromPicker, saveAs, startNewGame } from './actions';
import { busy } from './busy';
import { useGameStore } from './gameStore';
import { useActionContext } from './useActionContext';
import { useFrameNavigate } from './useFrameNavigate';

const STEPS: Record<string, NavTarget> = {
  ArrowLeft: 'previous',
  ArrowUp: 'previous',
  ArrowRight: 'next',
  ArrowDown: 'next',
  Home: 'first',
  End: 'last',
};

/** PageUp and PageDown move this many moves, clamped to the line (audit G9). */
const PAGE = 10;

/**
 * The board's keys (design 5.7): ← ↑ previous, → ↓ next, Home first, End last, PageUp and
 * PageDown ten moves (M7 design 5.10); ⌘/Ctrl+O open,
 * ⇧⌘/Ctrl+Shift+S save as, ⌘/Ctrl+N a new 19×19 game. On macOS the menu bar owns the file
 * shortcuts, so they are left to it.
 */
export function useNavigationKeys(): void {
  const ctx = useActionContext();
  const os = useOs();
  const go = useFrameNavigate();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || busy(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      if (command) {
        if (os === null || os === 'macos' || event.altKey) return;
        const key = event.key.toLowerCase();
        const run =
          key === 'o' && !event.shiftKey
            ? () => openFromPicker(ctx)
            : key === 's' && event.shiftKey
              ? () => saveAs(ctx)
              : key === 'n' && !event.shiftKey
                ? () => startNewGame(ctx, 19)
                : null;
        if (!run) return;
        event.preventDefault();
        void run();
        return;
      }
      const snapshot = useGameStore.getState().snapshot;
      const page = event.key === 'PageDown' ? PAGE : event.key === 'PageUp' ? -PAGE : 0;
      const to: NavTarget | undefined =
        page && snapshot
          ? {
              move: Math.max(0, Math.min(snapshot.mainLineLength, snapshot.moveNumber + page)),
            }
          : STEPS[event.key];
      if (!to || event.altKey || event.shiftKey) return;
      event.preventDefault();
      go(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx, os, go]);
}
