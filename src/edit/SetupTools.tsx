import { cn } from 'cn';
import { useTranslation } from 'react-i18next';
import { useGameStore } from '../game/gameStore';
import { useActionContext } from '../game/useActionContext';
import { useModeStore } from './modeStore';
import { setupEdit } from './setupEdit';

const stones = [
  ['black', 'placeBlack', '●'],
  ['white', 'placeWhite', '○'],
  ['alternate', 'alternate', '◐'],
] as const;

export function SetupTools({ touch }: { touch: boolean }) {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const color = useGameStore((s) => s.snapshot?.nextColor ?? 'black');
  const tool = useModeStore((s) => s.setupTool);
  const select = useModeStore((s) => s.setSetupTool);
  const button = cn(
    'shrink-0 rounded-md px-1 whitespace-nowrap hover:bg-accent aria-pressed:bg-accent aria-pressed:text-text aria-pressed:outline aria-pressed:outline-hairline',
    touch ? 'h-11 min-w-11' : 'h-7 min-w-7',
  );
  return (
    <div
      role="group"
      aria-label={t('edit.setup')}
      className={cn(
        'flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-hairline bg-accent/40 px-2 text-xs text-text-muted',
        !touch && 'flex-wrap py-1 pl-4',
      )}
    >
      {stones.map(([value, key, symbol]) => (
        <button
          type="button"
          key={value}
          className={cn(button, 'text-base')}
          aria-pressed={tool === value}
          aria-label={t(`edit.${key}`)}
          title={t(`edit.${key}`)}
          onClick={() => select(value)}
        >
          {symbol}
        </button>
      ))}
      <span aria-hidden className="mx-1 h-4 shrink-0 border-l border-hairline" />
      <button
        type="button"
        className={button}
        onClick={() =>
          setupEdit(ctx, (s) => ({
            kind: 'setToPlay',
            color: s.nextColor === 'black' ? 'white' : 'black',
          }))
        }
      >
        {t('edit.toPlay', { color: t(`gameInfo.${color}`), symbol: color === 'black' ? '●' : '○' })}
      </button>
      <button
        type="button"
        className={button}
        onClick={() => setupEdit(ctx, () => ({ kind: 'pass' }))}
      >
        {t('analysis.pass')}
      </button>
      <button
        type="button"
        className={button}
        aria-pressed={tool === 'insert'}
        onClick={() => select(tool === 'insert' ? 'black' : 'insert')}
      >
        {t('edit.insert')}
      </button>
      <button
        type="button"
        className={button}
        onClick={() => setupEdit(ctx, () => ({ kind: 'flatten' }))}
      >
        {t('edit.flatten')}
      </button>
    </div>
  );
}
