import { useRef } from 'react';
import { captureReplayVisit, stopReplay } from '../game/replayStore';
import { useTransport } from '../transport/TransportProvider';
import { ReplayButton } from './ReplayButton';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  type LucideIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CommandId } from '../commands/registry';
import { useRunCommand } from '../commands/useKeyDispatcher';
import { useGameStore } from '../game/gameStore';

const BUTTONS: Array<[CommandId, string, LucideIcon, 'start' | 'end']> = [
  ['nav.first', 'panel.first', SkipBackIcon, 'start'],
  ['nav.previous', 'panel.previous', ChevronLeftIcon, 'start'],
  ['nav.next', 'panel.next', ChevronRightIcon, 'end'],
  ['nav.last', 'panel.last', SkipForwardIcon, 'end'],
];

/**
 * The phone's navigation along the bottom edge, in thumb reach (P2 M1 design 5.5): first,
 * previous, next and last, as large buttons running the same commands as the keys.
 */
export function BottomNav() {
  const { t } = useTranslation();
  const run = useRunCommand();
  const transport = useTransport();
  const press = useRef<{ id: CommandId; pointer: number; stillHere?: () => boolean } | null>(null);
  const atStart = useGameStore((s) => s.snapshot?.atStart ?? true);
  const atEnd = useGameStore((s) => s.snapshot?.atEnd ?? true);
  return (
    <nav
      aria-label={t('layout.narrow.nav')}
      className="flex h-[72px] flex-none items-center justify-around border-t border-hairline px-4"
    >
      {BUTTONS.map(([id, label, Icon, end]) => (
        <button
          key={id}
          type="button"
          aria-label={t(label)}
          disabled={end === 'start' ? atStart : atEnd}
          className="flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-md text-text hover:bg-divider-soft disabled:opacity-35"
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            press.current = {
              id,
              pointer: event.pointerId,
              stillHere: captureReplayVisit(transport),
            };
            stopReplay();
          }}
          onPointerCancel={(event) => {
            if (event.pointerId === press.current?.pointer) press.current = null;
          }}
          onClick={(event) => {
            const origin = press.current;
            press.current = null;
            // Keyboard and assistive activation have no pointer press.
            if (event.detail === 0 || (origin?.id === id && origin.stillHere?.() !== false))
              run(id);
          }}
        >
          <Icon className="size-6" aria-hidden />
        </button>
      ))}
      <ReplayButton bottom />
    </nav>
  );
}
