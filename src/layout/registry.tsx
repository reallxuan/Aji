import type { ReactNode } from 'react';
import { CandidateTable } from '../panel/CandidateTable';
import { HeaderPanel } from '../panel/HeaderPanel';
import { TrendGraph } from '../panel/TrendGraph';
import { WinrateBar } from '../panel/WinrateBar';
import { MIN_SIZES } from './constants';
import type { PanelKind, PanelRef } from './model';
import { SubBoard } from '../panel/SubBoard';
import { SwingList } from '../panel/SwingList';

export interface PanelSpec {
  kind: PanelKind;
  labelKey: string;
  hideable: boolean;
  minSize: { width: number; height: number };
  Component(props: { panel: PanelRef; width: number; height: number }): ReactNode;
}

const SPECS: Record<PanelKind, PanelSpec> = {
  header: {
    kind: 'header',
    labelKey: 'layout.panels.header',
    hideable: false,
    minSize: MIN_SIZES.header,
    Component: () => <HeaderPanel />,
  },
  winrate: {
    kind: 'winrate',
    labelKey: 'layout.panels.winrate',
    hideable: true,
    minSize: MIN_SIZES.winrate,
    Component: () => <WinrateBar />,
  },
  trend: {
    kind: 'trend',
    labelKey: 'layout.panels.trend',
    hideable: true,
    minSize: MIN_SIZES.trend,
    Component: ({ height }) => <TrendGraph height={height} />,
  },
  candidates: {
    kind: 'candidates',
    labelKey: 'layout.panels.candidates',
    hideable: true,
    minSize: MIN_SIZES.candidates,
    Component: ({ panel }) => <CandidateTable maxRows={panel.maxRows} />,
  },
  swings: {
    kind: 'swings',
    labelKey: 'layout.panels.swings',
    hideable: true,
    minSize: MIN_SIZES.swings,
    Component: () => <SwingList />,
  },
  subboard: {
    kind: 'subboard',
    labelKey: 'layout.panels.subboard',
    hideable: true,
    minSize: MIN_SIZES.subboard,
    Component: ({ panel }) => <SubBoard rank={panel.rank ?? 1} />,
  },
};

export function panelSpec(kind: PanelKind): PanelSpec {
  return SPECS[kind];
}

export function panelLabelKey(ref: PanelRef): string {
  return SPECS[ref.kind].labelKey;
}

export function panelMinSize(ref: PanelRef): { width: number; height: number } {
  return SPECS[ref.kind].minSize;
}
