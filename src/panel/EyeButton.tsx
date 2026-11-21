import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { type PointerEvent, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useViewStore } from '../analysis/viewStore';
import { runCommand as run } from '../commands/registry';

/** A press this long is a hold: a peek, not a toggle. */
const HOLD_MS = 300;

/**
 * The touch control for hiding candidates (P2 M1 design 5.6), at the right of the candidates
 * panel's top row: a tap toggles them as F does, and pressing and holding hides them while held,
 * as Z does. Its target reaches 44 px around a 20 px icon. It runs the commands the key
 * dispatcher registered, so it needs no providers of its own.
 */
export function EyeButton() {
  const { t } = useTranslation();
  const hidden = useViewStore((s) => s.hidden);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  /** The click that ends a hold is not a tap. */
  const swallowClick = useRef(false);

  const release = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (!holding.current) return false;
    holding.current = false;
    run('candidates.peek', 'up');
    return true;
  };
  const latestRelease = useRef(release);
  useEffect(() => {
    latestRelease.current = release;
  });
  // Unmounted mid-hold: the candidates come back.
  useEffect(() => () => void latestRelease.current(), []);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    swallowClick.current = false;
    timer.current = setTimeout(() => {
      timer.current = null;
      holding.current = true;
      run('candidates.peek', 'down');
    }, HOLD_MS);
  };
  const onPointerEnd = () => {
    if (release()) swallowClick.current = true;
  };

  const Icon = hidden ? EyeOffIcon : EyeIcon;
  return (
    <button
      type="button"
      aria-label={t('analysis.eye.label')}
      aria-pressed={hidden}
      title={t('analysis.eye.hint')}
      className="relative flex size-5 flex-none items-center justify-center rounded-sm text-text-muted select-none after:absolute after:-inset-3 after:content-[''] hover:text-text"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={onPointerEnd}
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        if (swallowClick.current) swallowClick.current = false;
        else run('candidates.toggleHidden');
      }}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
