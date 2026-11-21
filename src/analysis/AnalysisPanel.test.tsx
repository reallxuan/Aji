import { act, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { AnalysisPanel } from './AnalysisPanel';

afterEach(() => {
  resetGameStore();
  vi.unstubAllGlobals();
});

const graphHeight = () => Number(document.querySelector('svg')!.getAttribute('height'));

it('keeps its layout with empty contents before the first status', () => {
  renderWithGame(<AnalysisPanel />, { snapshot: null });
  expect(screen.getByTestId('winrate-bar')).toBeEmptyDOMElement();
  expect(document.querySelector('svg')).not.toBeNull();
  expect(screen.getByTestId('trend-legend')).toBeInTheDocument();
  expect(screen.getByText('候选点')).toBeInTheDocument();
});

it('draws the graph 150 px tall, or 100 px in a window under 720 px', () => {
  vi.stubGlobal('innerHeight', 900);
  const { unmount } = renderWithGame(<AnalysisPanel />);
  expect(graphHeight()).toBe(150);
  unmount();
  vi.stubGlobal('innerHeight', 700);
  renderWithGame(<AnalysisPanel />);
  expect(graphHeight()).toBe(100);
});

it('keeps the layout on an illegal node, with an empty bar', () => {
  renderWithGame(<AnalysisPanel />);
  act(() =>
    useGameStore
      .getState()
      .apply(makeSnapshot({ revision: 9, illegal: 'occupied', positionKey: null })),
  );
  expect(screen.getByTestId('winrate-bar')).toBeEmptyDOMElement();
  expect(document.querySelector('svg')).not.toBeNull();
  expect(screen.getByText('候选点')).toBeInTheDocument();
});
