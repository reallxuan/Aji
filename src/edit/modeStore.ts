import type { Color } from '../transport/generated/Color';
import { create } from 'zustand';
import { useGameStore } from '../game/gameStore';
import { useScoringStore } from '../scoring/scoringStore';

type EditMode = 'normal' | 'markup' | 'setup';
export type MarkupTool =
  'triangle' | 'square' | 'circle' | 'cross' | 'letter' | 'number' | 'freehand';
export type SetupTool = 'black' | 'white' | 'alternate' | 'insert';

/** The alternate tool's colours: `peek` shows the next one without taking it. */
export interface AlternateSequence {
  (toPlay: Color): Color;
  peek(toPlay: Color): Color;
}

/** Queued taps keep the sequence of the alternate tool selection that received them. */
function alternateSequence(onTake: () => void): AlternateSequence {
  let next: Color | null = null;
  const take = (toPlay: Color): Color => {
    const color: Color = next ?? toPlay;
    next = color === 'black' ? 'white' : 'black';
    onTake();
    return color;
  };
  return Object.assign(take, { peek: (toPlay: Color) => next ?? toPlay });
}

export const useModeStore = create<{
  mode: EditMode;
  markupTool: MarkupTool;
  setupTool: SetupTool;
  takeAlternateColor: AlternateSequence;
  /** Counts takes, so a view of `takeAlternateColor.peek` redraws after each one. */
  alternateTaken: number;
  setMode(mode: EditMode): void;
  toggle(mode: EditMode): void;
  setMarkupTool(tool: MarkupTool): void;
  setSetupTool(tool: SetupTool): void;
}>()((set, get) => {
  const sequence = () =>
    alternateSequence(() => set((s) => ({ alternateTaken: s.alternateTaken + 1 })));
  return {
    mode: 'normal',
    markupTool: 'triangle',
    setupTool: 'black',
    takeAlternateColor: sequence(),
    alternateTaken: 0,
    setMode: (mode) => {
      const { active, starting } = useScoringStore.getState();
      if (
        mode !== 'normal' &&
        (useGameStore.getState().snapshot?.tryout != null || active || starting)
      )
        return;
      set({ mode, takeAlternateColor: sequence() });
    },
    toggle: (mode) => get().setMode(get().mode === mode ? 'normal' : mode),
    setMarkupTool: (markupTool) => set({ markupTool }),
    setSetupTool: (setupTool) => set({ setupTool, takeAlternateColor: sequence() }),
  };
});
