import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SkipBackIcon,
  SkipForwardIcon,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useGameStore } from '../game/gameStore';
import { useRunCommand } from '../commands/useKeyDispatcher';
import type { CommandId } from '../commands/registry';
import { MoveCounter } from './MoveCounter';

/** Holding a button repeats it after this long, then at this interval (design 5.7). */
const HOLD_DELAY = 400;
const HOLD_INTERVAL = 60;

function NavButton({
  to,
  label,
  icon: Icon,
  disabled,
  className = '',
}: {
  className?: string;
  to: Step;
  label: string;
  icon: LucideIcon;
  disabled: boolean;
}) {
  const run = useRunCommand();
  const timers = useRef<{
    delay?: ReturnType<typeof setTimeout>;
    repeat?: ReturnType<typeof setInterval>;
  }>({});
  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current = {};
  };
  // The same commands as ← → Home End.
  const step = () => run(COMMAND[to]);
  // Reaching the end disables the button under the pointer; stop repeating then.
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  useEffect(() => stop, []);

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={`flex size-[26px] items-center justify-center rounded-sm text-text-muted hover:bg-divider-soft hover:text-text disabled:opacity-35 disabled:hover:bg-transparent ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        stop();
        step();
        // First and last never repeat: one press goes all the way.
        if (to !== 'next' && to !== 'previous') return;
        timers.current.delay = setTimeout(() => {
          timers.current.repeat = setInterval(step, HOLD_INTERVAL);
        }, HOLD_DELAY);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // A click without a pointer press is the keyboard's Enter or Space.
      onClick={(e) => {
        if (e.detail === 0) step();
      }}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

const WIDE_ONLY = '@max-[500px]:hidden';

const COMMAND: Record<Step, CommandId> = {
  first: 'nav.first',
  previous: 'nav.previous',
  next: 'nav.next',
  last: 'nav.last',
};

type Step = 'first' | 'previous' | 'next' | 'last';
const BACK: Array<[Step, LucideIcon]> = [
  ['first', SkipBackIcon],
  ['previous', ChevronLeftIcon],
];
const FORWARD: Array<[Step, LucideIcon]> = [
  ['next', ChevronRightIcon],
  ['last', SkipForwardIcon],
];

/** First, previous, the move counter, next and last; the ends disable their buttons. */
export function NavButtons() {
  const { t } = useTranslation();
  const atStart = useGameStore((s) => s.snapshot?.atStart ?? true);
  const atEnd = useGameStore((s) => s.snapshot?.atEnd ?? true);
  const buttons = (steps: Array<[Step, LucideIcon]>, disabled: boolean) =>
    steps.map(([to, icon]) => (
      <NavButton
        key={to}
        to={to}
        label={t(`panel.${to}`)}
        icon={icon}
        disabled={disabled}
        // The ends step aside in a narrow panel; Home, End and the counter still reach them.
        className={to === 'first' || to === 'last' ? WIDE_ONLY : ''}
      />
    ));
  return (
    <div className="flex flex-none items-center gap-0.5">
      {buttons(BACK, atStart)}
      <MoveCounter />
      {buttons(FORWARD, atEnd)}
    </div>
  );
}
