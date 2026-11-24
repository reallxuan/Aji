import { create } from 'zustand';
import { useGameStore } from '../game/gameStore';

/** Remember the visit while the comments tab mounts; a later visit must not take its focus. */
export const useCommentFocus = create<{ visit: number | null }>(() => ({ visit: null }));

export function requestCommentFocus(node: number) {
  const { snapshot, nodeVisit } = useGameStore.getState();
  if (snapshot?.node === node) useCommentFocus.setState({ visit: nodeVisit });
}
