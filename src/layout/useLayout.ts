import { useMemo } from 'react';
import { create } from 'zustand';
import { useDeviceStore } from '../device/deviceStore';
import { LAYOUT_SAVE_MS } from './constants';
import type { Layout } from './model';
import { validateLayout } from './validate';

/**
 * The layout being changed, before it is stored. One for the whole interface, so a choice in the
 * 布局 menu shows in the frame at once, and a drag's pending change cannot overwrite it later.
 */
const useDraft = create<{ draft: Layout | null }>(() => ({ draft: null }));
let timer: ReturnType<typeof setTimeout> | null = null;

/** Shows `next` at once and stores it shortly after the last change, so a drag writes once. */
export function setLayout(next: Layout) {
  useDraft.setState({ draft: next });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    useDeviceStore.getState().update({ layout: next });
    useDraft.setState({ draft: null });
  }, LAYOUT_SAVE_MS);
}

/**
 * Remembers the layout as it is now, stored and pending; the function returned puts it back,
 * so a cancelled resize leaves no trace, even of a change already stored mid-drag.
 */
export function layoutCheckpoint(): () => void {
  const draft = useDraft.getState().draft;
  const stored = useDeviceStore.getState().settings.layout;
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const device = useDeviceStore.getState();
    if (device.settings.layout !== stored) device.update({ layout: stored });
    if (draft) setLayout(draft);
    else useDraft.setState({ draft: null });
  };
}

/** Drops an unsaved change (tests start from the stored layout). */
export function resetLayoutDraft() {
  if (timer) clearTimeout(timer);
  timer = null;
  useDraft.setState({ draft: null });
}

export function currentLayout(): Layout {
  return useDraft.getState().draft ?? validateLayout(useDeviceStore.getState().settings.layout);
}

/** The device's layout, validated (design 5.1), with any change not yet stored. */
export function useLayout(): { layout: Layout; setLayout(next: Layout): void } {
  const stored = useDeviceStore((s) => s.settings.layout);
  const validated = useMemo(() => validateLayout(stored), [stored]);
  const draft = useDraft((s) => s.draft);
  return { layout: draft ?? validated, setLayout };
}
