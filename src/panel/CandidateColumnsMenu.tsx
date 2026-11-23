import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { KATAGO_ORDER } from '../analysis/sortCandidates';
import {
  CANDIDATE_COUNTS,
  LINE_LENGTHS,
  type CandidateColumns,
  type CandidateCount,
} from '../device/deviceSettings';
import { useDeviceStore } from '../device/deviceStore';

/** The optional columns, in the table's order; the chip and the point always stay. */
const COLUMNS: Array<keyof CandidateColumns> = [
  'winrate',
  'scoreLead',
  'visits',
  'share',
  'vsBest',
];

const countOf = (value: string): CandidateCount =>
  CANDIDATE_COUNTS.find((c) => String(c) === value) ?? 'auto';

/**
 * The candidate list's header menu (P2 M2 design 5.5, lists mockup section 2), on a right-click of
 * the header row: the columns, how many candidates, how long a hovered line is, and KataGo's
 * order. All of them are device settings.
 */
export function CandidateColumnsMenu({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const columns = useDeviceStore((s) => s.settings.candidateColumns);
  const count = useDeviceStore((s) => s.settings.candidateCount);
  const lineLength = useDeviceStore((s) => s.settings.lineLength);
  const sorted = useDeviceStore((s) => s.settings.candidateSort.key !== 'rank');
  const update = (patch: Parameters<ReturnType<typeof useDeviceStore.getState>['update']>[0]) =>
    useDeviceStore.getState().update(patch);

  const countLabel = (c: CandidateCount) =>
    c === 'auto'
      ? t('analysis.table.menu.countAuto')
      : c === 'all'
        ? t('analysis.table.menu.countAll')
        : t('analysis.table.menu.countValue', { n: c });
  const lengthLabel = (n: number) => t('analysis.table.menu.lineMoves', { n });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-52 whitespace-nowrap">
        {COLUMNS.map((key) => (
          <ContextMenuCheckboxItem
            key={key}
            checked={columns[key]}
            // 占比 lives in the 计算量 cell.
            disabled={key === 'share' && !columns.visits}
            // Several columns are often changed at once: the menu stays open.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              update({ candidateColumns: { ...columns, [key]: checked === true } })
            }
          >
            {t(`analysis.columns.${key}`)}
          </ContextMenuCheckboxItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            {t('analysis.table.menu.count')}
            <span className="ml-auto pl-4 text-text-muted">{countLabel(count)}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={String(count)}
              onValueChange={(value) => update({ candidateCount: countOf(value) })}
            >
              {CANDIDATE_COUNTS.map((c) => (
                <ContextMenuRadioItem key={String(c)} value={String(c)}>
                  {countLabel(c)}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            {t('analysis.table.menu.lineLength')}
            <span className="ml-auto pl-4 text-text-muted">{lengthLabel(lineLength)}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={String(lineLength)}
              onValueChange={(value) => update({ lineLength: Number(value) })}
            >
              {LINE_LENGTHS.map((n) => (
                <ContextMenuRadioItem key={n} value={String(n)}>
                  {lengthLabel(n)}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="pl-8"
          disabled={!sorted}
          onSelect={() => update({ candidateSort: KATAGO_ORDER })}
        >
          {t('analysis.table.menu.katagoOrder')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
