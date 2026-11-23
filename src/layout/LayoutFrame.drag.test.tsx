import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeviceStore } from '../device/deviceStore';
import { renderWithGame } from '../game/renderWithGame';
import { LayoutFrame } from './LayoutFrame';
import { type SplitNode } from './model';
import { validateLayout } from './validate';

type Box = { x: number; y: number; width: number; height: number };

/** The default layout at 1440 × 900, as the screen would measure it. */
const BOXES: Record<string, Box> = {
  board: { x: 16, y: 16, width: 868, height: 868 },
  header: { x: 900, y: 0, width: 540, height: 80 },
  winrate: { x: 900, y: 80, width: 540, height: 44 },
  trend: { x: 900, y: 124, width: 540, height: 250 },
  candidates: { x: 900, y: 374, width: 540, height: 526 },
};

function placeBox(el: Element, box: Box) {
  el.getBoundingClientRect = () =>
    ({
      ...box,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
    }) as DOMRect;
}

/**
 * The column slot a panel sits in: the wrapper its hairline measures and its flex share sits on,
 * whether the panel stands alone or in a tab group.
 */
function slotOf(el: Element): HTMLElement {
  let node = el.parentElement!;
  while (!node.style.flex) node = node.parentElement!;
  return node;
}

function place() {
  placeBox(document.querySelector('[data-board]')!, BOXES.board);
  for (const el of document.querySelectorAll('[data-panel]')) {
    const box = BOXES[el.getAttribute('data-panel')!];
    placeBox(el, box);
    // A hairline measures the wrapper its panel sits in.
    placeBox(slotOf(el), box);
  }
}

const panel = (id: string) => document.querySelector(`[data-panel="${id}"]`) as HTMLElement;
const grip = (id: string) => document.querySelector(`[data-grip="${id}"]`) as HTMLElement | null;
const outline = () => document.querySelector('[data-drop-outline]') as HTMLElement | null;
const stored = () => validateLayout(useDeviceStore.getState().settings.layout);
const column = () => stored().root.children[1] as SplitNode;

function mount() {
  renderWithGame(<LayoutFrame />);
  place();
}

/** Hovers `id`, then presses its grip with pointer `pointerId`. */
function pressGrip(id: string, pointerId = 1) {
  fireEvent.pointerEnter(panel(id));
  fireEvent.pointerDown(grip(id)!, { pointerId, button: 0, clientX: 910, clientY: 130 });
}

const move = (x: number, y: number, pointerId = 1) =>
  fireEvent.pointerMove(window, { pointerId, clientX: x, clientY: y });
const up = (x: number, y: number, pointerId = 1) =>
  fireEvent.pointerUp(window, { pointerId, clientX: x, clientY: y });

function setCoarse(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('LayoutFrame rearranging', () => {
  beforeEach(() => {
    Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
    setCoarse(false);
  });
  afterEach(() => {
    delete (window as Partial<Window>).matchMedia;
  });

  it('dragging the grip moves the panel and saves', async () => {
    mount();
    pressGrip('trend');
    move(1170, 640);
    up(1170, 640);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    await waitFor(() => expect(stored().preset).toBe('custom'));
    expect(column().children.at(-1)).toMatchObject({ type: 'tabs' });
  });

  it('the accent outline shows the drop', () => {
    mount();
    pressGrip('trend');
    expect(outline()).toBeNull();
    move(1170, 640);
    expect(outline()?.dataset.dropKind).toBe('tab');
    expect(outline()?.style.top).toBe('374px');
    move(1170, 890);
    expect(outline()?.dataset.dropKind).toBe('split');
    // The lower half of the candidates.
    expect(outline()?.style.top).toBe('637px');
    move(400, 400);
    expect(outline()).toBeNull();
    move(30, 400);
    expect(outline()?.dataset.dropKind).toBe('column');
  });

  it('a second pointer is ignored', () => {
    mount();
    pressGrip('trend', 1);
    move(1170, 640, 1);
    fireEvent.pointerEnter(panel('candidates'));
    fireEvent.pointerDown(grip('candidates')!, { pointerId: 2, button: 0 });
    move(30, 400, 2);
    expect(outline()?.dataset.dropKind).toBe('tab');
    up(30, 400, 2);
    expect(outline()?.dataset.dropKind).toBe('tab');
    up(1170, 640, 1);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('resize or blur mid drag cancels and leaves the layout', () => {
    mount();
    for (const cancel of [
      () => fireEvent(window, new Event('resize')),
      () => fireEvent.blur(window),
    ]) {
      pressGrip('trend');
      move(1170, 640);
      act(() => {
        cancel();
      });
      expect(outline()).toBeNull();
      up(1170, 640);
      // No drop happened: the default's one tab group (候选, 波动) is all there is.
      expect(screen.getAllByRole('tablist')).toHaveLength(1);
    }
    expect(useDeviceStore.getState().settings.layout).toBeNull();
  });

  it('double click on a hairline evens it', async () => {
    mount();
    const line = slotOf(panel('candidates')).querySelector('[data-hairline]')!;
    fireEvent.doubleClick(line);
    await waitFor(() => expect(stored().preset).toBe('custom'));
    const [, , trend, candidates] = column().weights;
    expect(trend).toBeCloseTo(candidates);
  });

  it('dragging a hairline resizes its neighbours', async () => {
    mount();
    const line = slotOf(panel('candidates')).querySelector('[data-hairline]')!;
    fireEvent.pointerDown(line, { pointerId: 1, button: 0, clientX: 1000, clientY: 374 });
    // The pointer leaves the 8 px line at once; the drag follows it anywhere in the window.
    move(1000, 424);
    up(1000, 424);
    await waitFor(() => expect(stored().preset).toBe('custom'));
    const [, , trend, candidates] = column().weights;
    // 250 : 526 becomes 300 : 476.
    expect(trend / (trend + candidates)).toBeCloseTo(300 / 776);
  });

  it('a hairline resize cancelled by blur, a window resize or Escape is undone', async () => {
    // Review Focus 3, for resizing.
    mount();
    const wrapper = slotOf(panel('candidates'));
    const flex = wrapper.style.flex;
    for (const cancel of [
      () => fireEvent.blur(window),
      () => fireEvent(window, new Event('resize')),
      () => fireEvent.keyDown(window, { key: 'Escape' }),
    ]) {
      place();
      const line = wrapper.querySelector('[data-hairline]')!;
      fireEvent.pointerDown(line, { pointerId: 1, button: 0, clientX: 1000, clientY: 374 });
      move(1000, 424);
      expect(slotOf(panel('candidates')).style.flex).not.toBe(flex);
      act(() => {
        cancel();
      });
      expect(slotOf(panel('candidates')).style.flex).toBe(flex);
      // The drag is over: the pointer no longer moves the line.
      move(1000, 474);
      up(1000, 474);
      expect(slotOf(panel('candidates')).style.flex).toBe(flex);
    }
    await new Promise((r) => setTimeout(r, 600));
    expect(useDeviceStore.getState().settings.layout).toBeNull();
  });

  it('grips show on hover and always for a coarse pointer', () => {
    mount();
    expect(grip('trend')).toBeNull();
    fireEvent.pointerEnter(panel('trend'));
    expect(grip('trend')).not.toBeNull();
    fireEvent.pointerLeave(panel('trend'));
    expect(grip('trend')).toBeNull();
  });

  it('a coarse pointer shows every grip', () => {
    setCoarse(true);
    mount();
    expect(grip('trend')).not.toBeNull();
    expect(grip('candidates')).not.toBeNull();
    expect(grip('header')).not.toBeNull();
  });
});
