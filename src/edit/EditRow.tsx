import { MarkupTools } from './MarkupTools';
import { cn } from 'cn';
import { Undo2, Redo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRunCommand } from '../commands/useKeyDispatcher';
import { useGameStore } from '../game/gameStore';
import { scoringInProgress, useScoringStore } from '../scoring/scoringStore';
import { useModeStore } from './modeStore';

const MODES = ['markup', 'setup'] as const;
const HISTORY = ['undo', 'redo'] as const;

export function EditRow({ touch = false }: { touch?: boolean }) {
  const { t } = useTranslation();
  const run = useRunCommand();
  const snapshot = useGameStore((s) => s.snapshot);
  const scoring = useScoringStore(scoringInProgress);
  const mode = useModeStore((s) => s.mode);
  const tryout = snapshot?.tryout != null;
  const button = cn(
    'inline-flex items-center justify-center rounded-md px-2 text-[13px] hover:bg-accent disabled:opacity-40',
    touch ? 'min-h-11 min-w-11' : 'h-7 min-w-7',
  );
  const toggle = cn(
    button,
    'border border-hairline bg-panel text-text aria-pressed:border-text aria-pressed:bg-text aria-pressed:text-panel',
  );
  return (
    <>
      <div
        role="group"
        aria-label={t('edit.tools')}
        className={cn(
          'flex shrink-0 items-center gap-1 border-b border-hairline px-3',
          !touch && 'py-1.5',
        )}
      >
        <button
          type="button"
          className={toggle}
          aria-pressed={tryout}
          disabled={!snapshot || scoring}
          onClick={() => run('edit.tryout')}
        >
          {t('edit.tryout')}
        </button>
        {MODES.map((tool) => (
          <button
            type="button"
            key={tool}
            className={toggle}
            aria-pressed={mode === tool}
            disabled={!snapshot || tryout || scoring}
            title={tryout ? t('notice.endTryoutFirst') : undefined}
            onClick={() => useModeStore.getState().toggle(tool)}
          >
            {t(`edit.${tool}`)}
          </button>
        ))}
        <span className="flex-1" />
        {HISTORY.map((action) => {
          const Icon = action === 'undo' ? Undo2 : Redo2;
          const label = t(`commands.edit.${action}`);
          return (
            <button
              type="button"
              key={action}
              className={button}
              title={label}
              aria-label={label}
              disabled={!(action === 'undo' ? snapshot?.canUndo : snapshot?.canRedo)}
              onClick={() => run(`edit.${action}`)}
            >
              <Icon aria-hidden className="size-4" />
            </button>
          );
        })}
      </div>
      {mode === 'markup' && !scoring && <MarkupTools touch={touch} />}
    </>
  );
}
