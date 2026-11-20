import { create } from 'zustand';
import { setSettings } from '../transport/api';
import type { UiSettings } from '../transport/generated/UiSettings';
import type { Transport } from '../transport/transport';

export interface SettingsState {
  /** `null` until the first `settingsGet` answers. */
  settings: UiSettings | null;
  apply(settings: UiSettings): void;
  /**
   * Shows `settings` at once and stores them. A rejected request restores what was shown before,
   * unless a later change has replaced it in the meantime, and rethrows.
   */
  save(transport: Transport, settings: UiSettings): Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: null,
  apply: (settings) => set({ settings }),
  async save(transport, settings) {
    const previous = get().settings;
    set({ settings });
    try {
      const stored = await setSettings(transport, settings);
      if (get().settings === settings) set({ settings: stored });
    } catch (error) {
      if (get().settings === settings) set({ settings: previous });
      throw error;
    }
  },
}));
