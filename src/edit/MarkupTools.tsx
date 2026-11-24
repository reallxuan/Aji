import { stopReplay } from '../game/replayStore';
import { cn } from 'cn';
import { useTranslation } from 'react-i18next';
import { useActionContext } from '../game/useActionContext';
import { useGameStore } from '../game/gameStore';
import { useMarkEdit } from './useMarkEdit';
import { scoringInProgress } from '../scoring/scoringStore';
import { useModeStore } from './modeStore';
import { useFreehandStore } from './freehandStore';

const tools = {
  triangle: '△',
  square: '□',
  circle: '○',
  cross: '✕',
  letter: 'A',
  number: '1',
  freehand: '✎',
} as const;
export function MarkupTools({ touch }: { touch: boolean }) {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const markEdit = useMarkEdit(ctx);
  const selected = useModeStore((s) => s.markupTool);
  const button = cn('shrink-0 rounded-md hover:bg-accent', touch ? 'h-11 min-w-11' : 'h-7 min-w-7');
  const clear = () => {
    const snapshot = useGameStore.getState().snapshot;
    if (!snapshot || snapshot.tryout !== null || scoringInProgress()) return;
    stopReplay();
    if (selected === 'freehand') useFreehandStore.getState().clear();
    else void markEdit({ kind: 'clear' });
  };
  return (
    <div
      role="group"
      aria-label={t('edit.markup')}
      className={cn(
        'flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-hairline bg-accent/40 px-2 text-text-muted',
        !touch && 'flex-wrap py-1 pl-4',
      )}
    >
      {(Object.keys(tools) as (keyof typeof tools)[]).map((tool) => (
        <button
          key={tool}
          type="button"
          className={cn(
            button,
            'aria-pressed:bg-accent aria-pressed:text-text aria-pressed:outline aria-pressed:outline-hairline',
            tool === 'freehand' && 'ml-1 border-l border-hairline',
          )}
          aria-label={t(`edit.${tool}`)}
          title={t(`edit.${tool}`)}
          aria-pressed={tool === selected}
          onClick={() => useModeStore.getState().setMarkupTool(tool)}
        >
          {tools[tool]}
        </button>
      ))}
      <button
        type="button"
        className={cn(button, 'ml-auto px-2 text-xs whitespace-nowrap')}
        onClick={clear}
      >
        {t(selected === 'freehand' ? 'edit.clearFreehand' : 'edit.clearMarks')}
      </button>
    </div>
  );
}
