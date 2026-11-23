import { useTranslation } from 'react-i18next';
import { useGameStore } from '../game/gameStore';

/** The stones each side has captured (P2 M1 design 5.9): 提子 黑 3 白 5. */
export function CapturesLine({ className }: { className?: string }) {
  const { t } = useTranslation();
  const captures = useGameStore((s) => s.snapshot?.captures ?? null);
  if (!captures) return null;
  return (
    <span data-captures className={className}>
      {t('analysis.captures', { black: captures[0], white: captures[1] })}
    </span>
  );
}
