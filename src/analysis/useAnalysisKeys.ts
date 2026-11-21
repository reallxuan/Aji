import { useEffect } from 'react';
import { useEngineStoreApi } from '../engine/engineStore';
import { busy } from '../game/busy';
import { engineAction, runEngineAction } from '../panel/EngineIndicator';
import { useTransport } from '../transport/TransportProvider';
import { useViewStore } from './viewStore';

const plain = (event: KeyboardEvent) =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

/**
 * The analysis keys (design 5.10), with the navigation keys' focus rule: Space does what a click
 * on the engine indicator does, F shows or hides the candidates, and holding Z hides them.
 */
export function useAnalysisKeys(): void {
  const transport = useTransport();
  const engine = useEngineStoreApi();

  useEffect(() => {
    // A Space handled here must not also press the focused button when it is released.
    let spaceHandled = false;
    const onDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || busy(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.key === ' ' && plain(event)) {
        event.preventDefault();
        spaceHandled = true;
        if (event.repeat) return;
        const action = engineAction(engine.getState().engine);
        if (action !== 'setUp') runEngineAction(action, transport);
      } else if (key === 'f' && !event.repeat && plain(event)) {
        event.preventDefault();
        useViewStore.getState().toggleHidden();
      } else if (key === 'z' && plain(event)) {
        event.preventDefault();
        useViewStore.getState().setHeld(true);
      }
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key === ' ' && spaceHandled) {
        spaceHandled = false;
        event.preventDefault();
      } else if (event.key.toLowerCase() === 'z') {
        useViewStore.getState().setHeld(false);
      }
    };
    // Leaving the window loses the key-up, so a held Z lets go here.
    const onBlur = () => useViewStore.getState().setHeld(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [transport, engine]);
}
