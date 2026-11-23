import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDeviceStore } from '../device/deviceStore';
import { useGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { resetScoringStore, useScoringStore } from '../scoring/scoringStore';
import { LayoutFrame } from './LayoutFrame';
import { hidePanel } from './ops';
import type { Layout } from './model';
import { presetLayout } from './presets';

function setWindow(width: number, height: number) {
  Object.assign(window, { innerWidth: width, innerHeight: height });
}

const shown = () =>
  [...document.querySelectorAll('[data-panel]')].map((el) => el.getAttribute('data-panel'));

function mount(layout: unknown, side?: React.ReactNode) {
  useDeviceStore.getState().update({ layout });
  return renderWithGame(<LayoutFrame side={side} />);
}

describe('LayoutFrame', () => {
  beforeEach(() => setWindow(1440, 900));

  it('the default layout renders the four Phase 1 panels in order', () => {
    mount(null);
    expect(shown()).toEqual(['header', 'winrate', 'trend', 'candidates']);
    const board = document.querySelector('[data-board]') as HTMLElement;
    expect(board.style.left).toBe('16px');
    expect(board.style.width).toBe('868px');
  });

  it('each preset renders its panels', () => {
    mount(presetLayout('classic'));
    // The left column holds the bar and the graph; the candidates sit above the sub-board.
    expect(shown()).toEqual(['winrate', 'trend', 'header', 'candidates', 'subboard:1']);
  });

  it('four boards renders three sub-boards', () => {
    mount(presetLayout('four'));
    expect(shown().filter((id) => id?.startsWith('subboard'))).toEqual([
      'subboard:1',
      'subboard:2',
      'subboard:3',
    ]);
  });

  it('minimal limits the candidates to three rows', () => {
    mount(presetLayout('minimal'));
    const candidates = document.querySelector('[data-panel="candidates"]') as HTMLElement;
    expect(candidates.dataset.maxRows).toBe('3');
  });

  it('settings fill the header column and keep the board', () => {
    mount(null, <div>设置页</div>);
    expect(screen.getByText('设置页')).toBeInTheDocument();
    expect(shown()).toEqual([]);
    expect(document.querySelector('[data-board]')).not.toBeNull();
  });

  it('a corrupt stored layout renders the default', () => {
    mount({ version: 1, root: 'nonsense' });
    expect(shown()).toEqual(['header', 'winrate', 'trend', 'candidates']);
  });

  it('a tab group shows a tab row and a single panel does not', () => {
    const base = presetLayout('default');
    const tabs: Layout = {
      ...base,
      preset: 'custom',
      root: {
        ...base.root,
        children: [
          { type: 'board' },
          {
            type: 'split',
            dir: 'column',
            children: [
              { type: 'panel', panel: { kind: 'header' } },
              {
                type: 'tabs',
                panels: [{ kind: 'trend' }, { kind: 'candidates' }],
                active: 1,
              },
            ],
            weights: [0.5, 0.5],
          },
        ],
      },
    };
    mount(tabs);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: '候选' })).toHaveAttribute('aria-selected', 'true');
    // Only the active tab's panel is shown.
    expect(shown()).toEqual(['header', 'candidates']);
  });

  it('the wide default shows the sub-board in a second column', () => {
    setWindow(1920, 1080);
    mount(null);
    expect(shown()).toEqual(['header', 'winrate', 'trend', 'candidates', 'subboard:1']);
  });

  it('keeps its panels with empty contents before the first status', () => {
    useDeviceStore.getState().update({ layout: null });
    renderWithGame(<LayoutFrame />, { snapshot: null });
    expect(screen.getByTestId('winrate-bar')).toBeEmptyDOMElement();
    expect(screen.getByTestId('trend-legend')).toBeInTheDocument();
    expect(screen.getByText('候选点')).toBeInTheDocument();
  });

  it('keeps the panels on an illegal node, with an empty bar', () => {
    mount(null);
    act(() =>
      useGameStore
        .getState()
        .apply(makeSnapshot({ revision: 9, illegal: 'occupied', positionKey: null })),
    );
    expect(screen.getByTestId('winrate-bar')).toBeEmptyDOMElement();
    expect(screen.getByText('候选点')).toBeInTheDocument();
  });

  it('flexible panels share all of the free height', () => {
    // CSS gives out only part of the free space when the grow factors sum below 1.
    mount(null);
    const grows = ['trend', 'candidates'].map((id) => {
      // The slot holding the panel: a tab group's, for 候选 beside 波动.
      let wrapper = document.querySelector(`[data-panel="${id}"]`)!.parentElement!;
      while (!wrapper.style.flex) wrapper = wrapper.parentElement!;
      return Number.parseFloat(wrapper.style.flex);
    });
    expect(grows[0] + grows[1]).toBeGreaterThanOrEqual(1);
    expect(grows[1] / grows[0]).toBeCloseTo(2);
  });

  describe('while scoring', () => {
    afterEach(() => resetScoringStore());

    it('the count takes the bar and the graph, and the layout is kept', async () => {
      useScoringStore.setState({ active: true });
      mount(null);
      const stored = useDeviceStore.getState().settings.layout;
      expect(shown()).toEqual(['header', 'winrate', 'candidates']);
      expect(screen.getByTestId('scoring-card')).toBeInTheDocument();
      expect(screen.queryByTestId('winrate-bar')).toBeNull();
      // Nothing to drag while scoring: the panels have no grips.
      expect(document.querySelector('[data-grip]')).toBeNull();
      act(() => useScoringStore.setState({ active: false }));
      expect(shown()).toEqual(['header', 'winrate', 'trend', 'candidates']);
      expect(screen.getByTestId('winrate-bar')).toBeInTheDocument();
      expect(useDeviceStore.getState().settings.layout).toBe(stored);
    });

    it('the count shows even where the bar is hidden', () => {
      useScoringStore.setState({ active: true });
      mount(hidePanel(presetLayout('default'), { kind: 'winrate' }));
      expect(screen.getByTestId('scoring-card')).toBeInTheDocument();
    });
  });
});
