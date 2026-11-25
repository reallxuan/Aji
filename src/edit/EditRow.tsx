import { SetupTools } from './SetupTools';
import { MarkupTools } from './MarkupTools';
import { cn } from 'cn';
import { Undo2, Redo2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEstimateStore } from '../analysis/estimateStore';
import { useOs } from '../app/useOs';
import { resolveKeymap } from '../commands/keymap';
import type { CommandId } from '../commands/registry';
import { useRunCommand } from '../commands/useKeyDispatcher';
import { useDeviceStore } from '../device/deviceStore';
import { useGameStore } from '../game/gameStore';
import { scoringInProgress, useScoringStore } from '../scoring/scoringStore';
import { useModeStore } from './modeStore';

const MODES = ['markup', 'setup'] as const;
const HISTORY = ['undo', 'redo'] as const;

/** The first key bound to a command in this device's keymap, or `null`. */
function useKeyFor(id: CommandId): string | null {
  const os = useOs();
  const overrides = useDeviceStore((s) => s.settings.keymap);
  return useMemo(() => {
    for (const [chord, command] of resolveKeymap(os, overrides)) if (command === id) return chord;
    return null;
  }, [os, overrides, id]);
}

export function EditRow({ touch = false }: { touch?: boolean }) {
  const { t } = useTranslation();
  const run = useRunCommand();
  const snapshot = useGameStore((s) => s.snapshot);
  const scoring = useScoringStore(scoringInProgress);
  const mode = useModeStore((s) => s.mode);
  const estimate = useEstimateStore((s) => s.on);
  const estimateKey = useKeyFor('estimate.toggle');
  const estimateLabel = t('estimate.title');
  const tryout = snapshot?.tryout != null;
  const button = cn(
    'inline-flex items-center justify-center rounded-md px-2 text-[13px] whitespace-nowrap hover:bg-accent disabled:opacity-40',
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
          // A narrow panel wraps the row rather than squeezing a label onto two lines.
          'flex shrink-0 flex-wrap items-center gap-1 border-b border-hairline px-3',
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
        {/* A view, not a board mode: it may stay on during any of the three (polish design 1). */}
        <span aria-hidden className={cn('mx-1 w-px bg-hairline', touch ? 'h-6' : 'h-[18px]')} />
        <button
          type="button"
          className={toggle}
          aria-pressed={estimate}
          disabled={!snapshot || scoring}
          title={
            estimateKey
              ? t('edit.withKey', { label: estimateLabel, key: estimateKey })
              : estimateLabel
          }
          onClick={() => run('estimate.toggle')}
        >
          {t('edit.estimate')}
        </button>
        {/* Undo and redo wrap together, to the right of the next line. */}
        <span className="ml-auto flex items-center gap-1">
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
        </span>
      </div>
      {mode === 'setup' && !scoring && <SetupTools touch={touch} />}
      {mode === 'markup' && !scoring && <MarkupTools touch={touch} />}
    </>
  );
}
