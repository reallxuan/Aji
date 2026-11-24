import { PauseIcon, PlayIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from 'cn';
import { useRunCommand } from '../commands/useKeyDispatcher';
import { useGameStore } from '../game/gameStore';
import { useReplayStore } from '../game/replayStore';

export function ReplayButton({
  touch = false,
  bottom = false,
}: {
  touch?: boolean;
  bottom?: boolean;
}) {
  const { t } = useTranslation();
  const run = useRunCommand();
  const playing = useReplayStore((s) => s.playing);
  const atEnd = useGameStore((s) => s.snapshot?.atEnd ?? true);
  const Icon = playing ? PauseIcon : PlayIcon;
  return (
    <button
      type="button"
      aria-label={t(playing ? 'panel.pauseReplay' : 'panel.startReplay')}
      disabled={!playing && atEnd}
      className={cn(
        'flex size-[26px] items-center justify-center rounded-sm text-text-muted hover:bg-divider-soft hover:text-text disabled:opacity-35',
        (touch || bottom) && 'min-h-11 min-w-11',
        bottom && 'flex-1',
      )}
      onClick={() => run('replay.toggle')}
    >
      <Icon className={bottom ? 'size-6' : 'size-4'} aria-hidden />
    </button>
  );
}
