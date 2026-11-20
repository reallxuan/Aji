import { useEffect } from 'react';
import { useOs } from '../app/useOs';
import type { NavTarget } from '../transport/generated/NavTarget';
import { openFromPicker, saveAs, startNewGame } from './actions';
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

/** Typing in a field, or working in an open menu or popover, keeps its keys. */
function busy(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement) {
    if (target.isContentEditable) return true;
    if (target.closest('input, textarea, select, [role="menu"], [role="dialog"]')) return true;
  }
  return document.querySelector('[data-radix-popper-content-wrapper]') !== null;
}

/**
 * The board's keys (design 5.7): ← ↑ previous, → ↓ next, Home first, End last; ⌘/Ctrl+O open,
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
      const to = STEPS[event.key];
      if (!to || event.altKey || event.shiftKey) return;
      event.preventDefault();
      go(to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx, os, go]);
}
