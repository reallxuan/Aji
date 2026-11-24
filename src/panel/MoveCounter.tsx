import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { navigate } from '../game/actions';
import { useGameStore } from '../game/gameStore';
import { useActionContext } from '../game/useActionContext';

/**
 * `58 / 171` (mockup frame D). Clicking the current number turns it into a field with the number
 * selected: Enter jumps there, Escape or clicking away cancels, and only digits can be typed.
 */
export function MoveCounter() {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const current = useGameStore((s) => s.snapshot?.moveNumber ?? 0);
  const total = useGameStore((s) => s.snapshot?.lineLength ?? 0);
  const canJump = useGameStore((s) => (s.snapshot?.lineLength ?? 0) > 0);
  const [draft, setDraft] = useState<string | null>(null);
  const done = useRef(false);

  const finish = (jump: boolean) => {
    if (done.current) return;
    done.current = true;
    const move = draft ? Number(draft) : NaN;
    setDraft(null);
    if (jump && Number.isInteger(move)) void navigate(ctx, { move });
  };

  return (
    <span className="flex items-center gap-1 px-1.5 text-[0.8125rem] whitespace-nowrap tabular-nums">
      {draft === null ? (
        <button
          type="button"
          className="rounded-sm px-1 py-px hover:bg-divider-soft disabled:hover:bg-transparent"
          aria-label={t('panel.jumpFrom', { current })}
          disabled={!canJump}
          onClick={() => {
            done.current = false;
            setDraft(String(current));
          }}
        >
          {current}
        </button>
      ) : (
        <input
          aria-label={t('panel.jumpTo')}
          inputMode="numeric"
          className="h-6 w-11 rounded-sm border border-text bg-panel px-0.5 text-center outline-2 outline-text/20"
          value={draft}
          ref={(input) => input?.select()}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(true);
            if (e.key === 'Escape') finish(false);
          }}
          onBlur={() => finish(false)}
        />
      )}
      <span className="text-text-muted">{`/ ${total}`}</span>
    </span>
  );
}
