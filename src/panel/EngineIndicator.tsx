import { cn } from 'cn';
import { useTranslation } from 'react-i18next';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { HOVER_CARD_DELAY_MS } from '../analysis/constants';
import { useEngineStore } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import { useJobStore } from '../job/jobStore';
import { useTransport } from '../transport/TransportProvider';
import { useRunCommand } from '../commands/useKeyDispatcher';
import { engineAction, runEngineAction } from '../engine/engineAction';
import { EngineCard } from './EngineCard';

/**
 * The 10 px round engine button in the panel header: colour shows the state, a hollow ring that
 * the position stopped at its visit limit. Click pauses, resumes or searches further; hovering
 * opens the engine card.
 */
export function EngineIndicator({ touch = false }: { touch?: boolean } = {}) {
  const transport = useTransport();
  const run = useRunCommand();
  const { t } = useTranslation();
  const engine = useEngineStore((s) => s.engine);
  const state = engine?.state ?? null;
  // On an illegal node KataGo has no position: the dot greys out, whatever the state.
  const illegal = useGameStore((s) => s.snapshot?.illegal ?? null);
  const job = useJobStore((s) => s.progress);

  const atLimit = engine?.state === 'ready' && engine.limitReached && !illegal;
  const stateText = atLimit ? t('engine.limitReached') : state ? t(`engine.state.${state}`) : '';
  const action = engineAction(engine, job);
  const colour =
    state === 'crashed'
      ? 'bg-engine-error'
      : atLimit
        ? 'bg-transparent ring-2 ring-engine-ok ring-inset'
        : state === 'analysing' && !illegal
          ? 'bg-engine-ok'
          : 'bg-line';

  return (
    <HoverCard openDelay={HOVER_CARD_DELAY_MS} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            'size-2.5 flex-none rounded-full disabled:cursor-default',
            colour,
            // On a touch screen the dot keeps its size and takes a 44 px target around it.
            touch && "relative after:absolute after:-inset-[17px] after:content-['']",
          )}
          data-engine-dot
          data-state={atLimit ? 'limitReached' : (state ?? 'unknown')}
          aria-label={
            action === 'setUp'
              ? t('noEngine.setup')
              : action
                ? t(`engine.action.${action}`)
                : stateText
          }
          disabled={!action}
          // Opening the wizard is the button's alone; the rest is the Space command.
          onClick={() =>
            action === 'setUp' ? runEngineAction(action, transport) : run('analysis.toggle')
          }
        />
      </HoverCardTrigger>
      {engine && engine.state !== 'notConfigured' && (
        <HoverCardContent
          align="end"
          className="w-auto rounded-lg border-hairline bg-pop px-3.5 py-3 text-text"
        >
          <EngineCard />
        </HoverCardContent>
      )}
    </HoverCard>
  );
}
