import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useOs } from '../app/useOs';
import { useDeviceStore } from '../device/deviceStore';
import { useEngineStoreApi } from '../engine/engineStore';
import { busy } from '../game/busy';
import { useActionContext } from '../game/useActionContext';
import { useFrameNavigate } from '../game/useFrameNavigate';
import { chordOf, keyName, resolveKeymap } from './keymap';
import {
  COMMANDS,
  type Command,
  type CommandContext,
  type CommandId,
  type Phase,
  setCommandContext,
} from './registry';

/** The context a command runs in, from the providers around the caller. */
export function useCommandContext(): CommandContext {
  const actions = useActionContext();
  const engine = useEngineStoreApi();
  const go = useFrameNavigate();
  const os = useOs();
  return useMemo(() => ({ actions, engine, go, os }), [actions, engine, go, os]);
}

/** Runs commands from a button: the same commands the keys run, in the button's own context. */
export function useRunCommand(): (id: CommandId, phase?: Phase) => void {
  const ctx = useCommandContext();
  return useCallback(
    (id, phase = 'down') => {
      const command = COMMANDS.get(id);
      if (command && !(command.kind === 'press' && phase === 'up')) command.run(ctx, phase);
    },
    [ctx],
  );
}

/**
 * Every key goes through here (P2 M1 design 5.11): a chord is looked up in the keymap and runs
 * its command. Keys typed in a field, or in an open menu or dialog, run nothing. `main` is false
 * while the wizard, settings or About fill the side; the board's commands rest then. A held
 * command lets go on its key's release, when a ⌘ or Ctrl chord starts (macOS swallows the
 * release then), and when the window loses focus.
 */
export function useKeyDispatcher(main: boolean): void {
  const ctx = useCommandContext();
  const overrides = useDeviceStore((s) => s.settings.keymap);
  const keymap = useMemo(() => resolveKeymap(ctx.os, overrides), [ctx.os, overrides]);
  const state = useRef({ ctx, keymap, main });
  useLayoutEffect(() => {
    state.current = { ctx, keymap, main };
    setCommandContext(ctx);
  });
  useEffect(() => () => setCommandContext(null), []);

  useEffect(() => {
    // Held commands by key, and keys whose release must not reach a focused button.
    const held = new Map<string, Command>();
    const handled = new Set<string>();
    const release = () => {
      for (const command of held.values()) command.run(state.current.ctx, 'up');
      held.clear();
    };

    const onDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) release();
      if (event.defaultPrevented || busy(event.target)) return;
      const { ctx, keymap, main } = state.current;
      const id = keymap.get(chordOf(event, ctx.os));
      const command = id && COMMANDS.get(id);
      if (!command || (command.scope === 'main' && !main)) return;
      event.preventDefault();
      const key = keyName(event.key);
      handled.add(key);
      if (event.repeat && !command.repeats) return;
      if (command.kind === 'hold') held.set(key, command);
      command.run(ctx, 'down');
    };
    const onUp = (event: KeyboardEvent) => {
      const key = keyName(event.key);
      const command = held.get(key);
      if (command) {
        held.delete(key);
        command.run(state.current.ctx, 'up');
      }
      // A Space handled on its way down must not also press the focused button on its way up.
      if (handled.delete(key)) event.preventDefault();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', release);
      release();
    };
  }, []);
}
