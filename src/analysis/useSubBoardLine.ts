import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../game/gameStore';
import { SUBBOARD_FOLLOW_MS } from '../layout/constants';
import { previewGame } from '../transport/api';
import { useTransport } from '../transport/TransportProvider';
import { moveKey } from './candidates';
import { useShownCandidates } from './useShownCandidates';
import { linePrefix, shownLength, type Variation } from './variation';
import { useViewStore } from './viewStore';

export interface SubBoardLine {
  /** The candidate's line from the current position; `null` without one, or while hidden. */
  line: Variation | null;
  /** How many of its moves show. */
  step: number | null;
  /** Steps the line, which freezes it until it restarts. */
  setStep(n: number): void;
  frozen: boolean;
}

type State = { line: Variation | null; step: number | null; frozen: boolean };
const EMPTY: State = { line: null, step: null, frozen: false };

/**
 * The line a sub-board shows (P2 M1 design 5.6): the rank's candidate, played out from the
 * current position. It restarts when the position or the candidate's first move changes. While
 * it shows the whole line, it follows the analysis as the line deepens, at most twice a second;
 * once stepped, it is frozen until it restarts. With the candidates hidden (F, or Z held) there
 * is no line, so a sub-board does not give the engine's answer away.
 */
export function useSubBoardLine(rank: 1 | 2 | 3): SubBoardLine {
  const transport = useTransport();
  const { shown } = useShownCandidates();
  const hidden = useViewStore((s) => s.hidden || s.held);
  const snapshot = useGameStore((s) => s.snapshot);
  const position = snapshot?.positionKey ?? null;
  const candidate = shown.find((c) => c.rank === rank) ?? null;
  const moves = useMemo(() => (candidate ? linePrefix(candidate.pv) : []), [candidate]);
  const lineKey = moves.map(moveKey).join(' ');
  const firstKey = moves.length > 0 ? moveKey(moves[0]) : '';

  const [state, setState] = useState<State>(EMPTY);
  const latest = useRef({ moves, transport });
  useLayoutEffect(() => {
    latest.current = { moves, transport };
  });
  const frozen = useRef(false);
  const lastFetch = useRef(-Infinity);
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previous = useRef<{ position: string | null; first: string } | null>(null);

  const cancelTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    const fetchLine = () => {
      const { moves: now, transport: through } = latest.current;
      const game = useGameStore.getState().snapshot;
      if (now.length === 0 || !game) return;
      lastFetch.current = Date.now();
      const id = ++request.current;
      const other = game.nextColor === 'black' ? 'white' : 'black';
      previewGame(through, now).then(
        (preview) => {
          if (id !== request.current || frozen.current) return;
          if (useGameStore.getState().snapshot?.revision !== game.revision) return;
          const line: Variation = {
            moves: now,
            colors: now.map((_, i) => (i % 2 ? other : game.nextColor)),
            captured: preview.captured,
            illegalAt: preview.illegalAt,
          };
          setState({ line, step: shownLength(line), frozen: false });
        },
        () => {
          // No line: the sub-board shows the position.
        },
      );
    };

    const restart =
      previous.current === null ||
      previous.current.position !== position ||
      previous.current.first !== firstKey;
    previous.current = { position, first: firstKey };
    if (restart) {
      cancelTimer();
      frozen.current = false;
      request.current++;
      setState(EMPTY);
      fetchLine();
      return;
    }
    if (frozen.current || lineKey === '') return;
    const wait = lastFetch.current + SUBBOARD_FOLLOW_MS - Date.now();
    if (wait <= 0) fetchLine();
    else
      timer.current ??= setTimeout(() => {
        timer.current = null;
        if (!frozen.current) fetchLine();
      }, wait);
  }, [lineKey, position, firstKey]);

  useEffect(() => cancelTimer, []);

  const setStep = useCallback((n: number) => {
    frozen.current = true;
    cancelTimer();
    setState((s) =>
      s.line ? { ...s, step: Math.min(shownLength(s.line), Math.max(1, n)), frozen: true } : s,
    );
  }, []);

  return {
    line: hidden ? null : state.line,
    step: hidden ? null : state.step,
    setStep,
    frozen: state.frozen,
  };
}
