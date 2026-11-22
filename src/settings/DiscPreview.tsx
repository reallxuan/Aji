import { useTranslation } from 'react-i18next';
import type { DiscField } from '../transport/generated/DiscField';

/** Sample values for the preview: Black's view of a typical candidate. */
const SAMPLE: Record<DiscField, number> = { winrate: 0.542, scoreLead: 1.8, visits: 1234 };

/** A field's value as a candidate disc prints it (interface design 5.2). */
export function formatDiscValue(field: DiscField, value: number): string {
  if (field === 'winrate') return (value * 100).toFixed(1);
  if (field === 'scoreLead') return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/** A candidate disc on a patch of wood, showing the two chosen fields with sample values. */
export function DiscPreview({ lines }: { lines: [DiscField, DiscField] }) {
  const { t } = useTranslation();
  return (
    <div
      role="img"
      aria-label={t('settings.preview')}
      className="flex size-20 shrink-0 items-center justify-center rounded-sm bg-board-base"
    >
      {/* The "close candidate" disc of interface design 5.2: cream fill, thin cinnabar ring. */}
      <div className="flex size-14 flex-col items-center justify-center rounded-full border-[1.5px] border-[#B8321F] bg-[#FBF1D9] text-[#2B1D0E] leading-tight tabular-nums">
        <span className="text-[0.8125rem] font-medium">
          {formatDiscValue(lines[0], SAMPLE[lines[0]])}
        </span>
        <span className="text-[0.6875rem]">{formatDiscValue(lines[1], SAMPLE[lines[1]])}</span>
      </div>
    </div>
  );
}
