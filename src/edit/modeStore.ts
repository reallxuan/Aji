import type { Color } from '../transport/generated/Color';
import { create } from 'zustand';
import { useGameStore } from '../game/gameStore';
import { useScoringStore } from '../scoring/scoringStore';

type EditMode = 'normal' | 'markup' | 'setup';
export type MarkupTool =
  'triangle' | 'square' | 'circle' | 'cross' | 'letter' | 'number' | 'freehand';
export type SetupTool = 'black' | 'white' | 'alternate' | 'insert';

/** Queued taps keep the sequence of the alternate tool selection that received them. */
function alternateSequence() {
  let next: Color | null = null;
  return (toPlay: Color): Color => {
    const color: Color = next ?? toPlay;
    next = color === 'black' ? 'white' : 'black';
    return color;
  };
}

export const useModeStore = create<{
  mode: EditMode;
  markupTool: MarkupTool;
  setupTool: SetupTool;
  takeAlternateColor(toPlay: Color): Color;
  setMode(mode: EditMode): void;
  toggle(mode: EditMode): void;
  setMarkupTool(tool: MarkupTool): void;
  setSetupTool(tool: SetupTool): void;
}>()((set, get) => ({
  mode: 'normal',
  markupTool: 'triangle',
  setupTool: 'black',
  takeAlternateColor: alternateSequence(),
  setMode: (mode) => {
    const { active, starting } = useScoringStore.getState();
    if (
      mode !== 'normal' &&
      (useGameStore.getState().snapshot?.tryout != null || active || starting)
    )
      return;
    set({ mode, takeAlternateColor: alternateSequence() });
  },
  toggle: (mode) => get().setMode(get().mode === mode ? 'normal' : mode),
  setMarkupTool: (markupTool) => set({ markupTool }),
  setSetupTool: (setupTool) => set({ setupTool, takeAlternateColor: alternateSequence() }),
}));
