import { useEffect, useRef } from 'react';
import { useGameStore } from '../game/gameStore';
import { useTransport } from '../transport/TransportProvider';
import { useScoringStore } from './scoringStore';

/**
 * Keeps final scoring on the position it counts (P2 M2 design 5.8): any move elsewhere (a key,
 * the wheel, a click in a list or on the graph) leaves scoring, and new rules count again.
 */
export function useScoringSync(): void {
  const transport = useTransport();
  const active = useScoringStore((s) => s.active);
  const place = useGameStore((s) =>
    s.snapshot
      ? `${s.snapshot.lineIndex}:${s.snapshot.moveNumber}:${s.snapshot.stones.map((c) => c?.[0] ?? '.').join('')}`
      : null,
  );
  const rules = useGameStore((s) => (s.snapshot ? JSON.stringify(s.snapshot.rules.current) : null));
  const counted = useRef<{ place: string | null; rules: string | null } | null>(null);

  useEffect(() => {
    if (!active) {
      counted.current = null;
      return;
    }
    if (!counted.current) {
      counted.current = { place, rules };
    } else if (place !== counted.current.place) {
      void useScoringStore.getState().exit(transport);
    } else if (rules !== counted.current.rules) {
      counted.current.rules = rules;
      void useScoringStore.getState().rescore(transport);
    }
  }, [active, place, rules, transport]);
}
