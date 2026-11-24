import { act, fireEvent, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetViewStore, useViewStore } from '../analysis/viewStore';
import { useDeviceStore } from '../device/deviceStore';
import { useEngineStoreApi } from '../engine/engineStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { renderWithGame } from '../game/renderWithGame';
import { makeSnapshot } from '../game/testing';
import { NavButtons } from '../panel/NavButtons';
import type { EngineState } from '../transport/generated/EngineState';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { OsKind } from '../transport/generated/OsKind';
import { defaultKeymap } from './keymap';
import { COMMANDS, runCommand } from './registry';
import { useKeyDispatcher } from './useKeyDispatcher';

beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] }));
afterEach(() => {
  vi.useRealTimers();
  resetGameStore();
  resetViewStore();
});

/** Sets the mounted engine store's state; filled in once `Keys` mounts. */
const probe: { setEngine(state: EngineState): void } = { setEngine: () => {} };

function Keys({ main = true }: { main?: boolean }) {
  useKeyDispatcher(main);
  const engine = useEngineStoreApi();
  useEffect(() => {
    probe.setEngine = (state) =>
      engine.getState().applyEvent({ type: 'engineState', engine: state });
  }, [engine]);
  return <input aria-label="field" />;
}

function mount(
  options: { os?: OsKind; snapshot?: GameSnapshot; main?: boolean; pick?: null } = {},
) {
  return renderWithGame(<Keys main={options.main} />, {
    os: options.os ?? 'windows',
    snapshot: options.snapshot,
    files: { pick: options.pick },
  });
}

const frame = async () =>
  act(async () => {
    vi.advanceTimersToNextFrame();
  });
const navigations = (requests: { type: string }[]) =>
  requests.filter((r) => r.type === 'gameNavigate');
const space = (target: Window | Element = window) =>
  fireEvent.keyDown(target, { key: ' ', code: 'Space' });
const engine = (state: EngineState) => act(() => probe.setEngine(state));

describe('navigation keys', () => {
  it('steps with the arrows and jumps with Home and End', async () => {
    const { requests } = mount();
    for (const [key, to] of [
      ['ArrowLeft', 'previous'],
      ['ArrowUp', 'previous'],
      ['ArrowRight', 'next'],
      ['ArrowDown', 'next'],
      ['Home', 'first'],
      ['End', 'last'],
    ]) {
      fireEvent.keyDown(window, { key });
      await frame();
      expect(requests.at(-1)).toEqual({ type: 'gameNavigate', to });
    }
  });

  it('sends one request for a frame of key repeats', async () => {
    const { requests } = mount();
    for (let i = 0; i < 20; i++) fireEvent.keyDown(window, { key: 'ArrowRight', repeat: i > 0 });
    await frame();
    expect(navigations(requests)).toHaveLength(1);
  });

  it('moves ten with PageDown, clamped to the end of the line', async () => {
    const { requests } = mount({ snapshot: makeSnapshot({ moveNumber: 30, lineLength: 45 }) });
    fireEvent.keyDown(window, { key: 'PageDown' });
    await frame();
    expect(requests.at(-1)).toEqual({ type: 'gameNavigate', to: { move: 40 } });
    act(() =>
      useGameStore
        .getState()
        .apply(makeSnapshot({ revision: 500, moveNumber: 40, lineLength: 45 })),
    );
    fireEvent.keyDown(window, { key: 'PageDown' });
    await frame();
    expect(requests.at(-1)).toEqual({ type: 'gameNavigate', to: { move: 45 } });
  });

  it('moves ten back with PageUp, stopping at the start', async () => {
    const { requests } = mount({ snapshot: makeSnapshot({ moveNumber: 4, lineLength: 45 }) });
    fireEvent.keyDown(window, { key: 'PageUp' });
    await frame();
    expect(requests.at(-1)).toEqual({ type: 'gameNavigate', to: { move: 0 } });
  });

  it('a modifier makes an arrow no command', async () => {
    const { requests } = mount();
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true });
    await frame();
    expect(navigations(requests)).toEqual([]);
  });

  it('leaves the arrows alone while settings or the wizard fill the side', async () => {
    const { requests } = mount({ main: false });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await frame();
    expect(navigations(requests)).toEqual([]);
  });
});

describe('file chords', () => {
  it('opens with Ctrl+O off macOS, and leaves ⌘O to the macOS menu', async () => {
    const windows = mount({ os: 'windows', pick: null });
    await act(async () => {});
    const picked = vi.spyOn(windows.files, 'pickOpen');
    fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    await act(async () => {});
    expect(picked).toHaveBeenCalledTimes(1);
    windows.unmount();
    const mac = mount({ os: 'macos', pick: null });
    await act(async () => {});
    const macPicked = vi.spyOn(mac.files, 'pickOpen');
    fireEvent.keyDown(window, { key: 'o', metaKey: true });
    await act(async () => {});
    expect(macPicked).not.toHaveBeenCalled();
  });

  it('the default keymap has the file chords only off macOS', () => {
    expect(defaultKeymap('windows').get('Mod+O')).toBe('file.open');
    expect(defaultKeymap('windows').get('Shift+Mod+S')).toBe('file.saveAs');
    expect(defaultKeymap('linux').get('Mod+N')).toBe('file.new19');
    expect(defaultKeymap('macos').has('Mod+O')).toBe(false);
    expect(defaultKeymap(null).has('Mod+O')).toBe(false);
  });
});

describe('analysis keys', () => {
  it('Space pauses, resumes and continues, and ignores a repeat', () => {
    const { requests } = mount();
    engine({ state: 'analysing', version: '1' });
    space();
    fireEvent.keyDown(window, { key: ' ', code: 'Space', repeat: true });
    engine({ state: 'paused', version: '1' });
    space();
    engine({ state: 'ready', version: '1', limitReached: true });
    space();
    engine({ state: 'ready', version: '1', limitReached: false });
    space();
    expect(requests.map((r) => r.type).filter((t) => t.startsWith('analysis'))).toEqual([
      'analysisPause',
      'analysisResume',
      'analysisContinue',
    ]);
  });

  it('Space keeps working while settings fill the side', () => {
    const { requests } = mount({ main: false });
    engine({ state: 'analysing', version: '1' });
    space();
    expect(requests.map((r) => r.type)).toContain('analysisPause');
  });

  it('F toggles the candidates, ignoring a held key', () => {
    mount();
    fireEvent.keyDown(window, { key: 'f' });
    expect(useViewStore.getState().hidden).toBe(true);
    fireEvent.keyDown(window, { key: 'f', repeat: true });
    expect(useViewStore.getState().hidden).toBe(true);
    fireEvent.keyDown(window, { key: 'F' });
    expect(useViewStore.getState().hidden).toBe(false);
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(useViewStore.getState().hidden).toBe(false);
  });

  it('Z hides the candidates while held, and ⌘Z is not Z', () => {
    mount();
    fireEvent.keyDown(window, { key: 'z' });
    expect(useViewStore.getState().held).toBe(true);
    fireEvent.keyUp(window, { key: 'z' });
    expect(useViewStore.getState().held).toBe(false);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(useViewStore.getState().held).toBe(false);
  });

  it('Z releases on blur', () => {
    mount();
    fireEvent.keyDown(window, { key: 'z' });
    fireEvent.blur(window);
    expect(useViewStore.getState().held).toBe(false);
  });

  it('Z releases when a ⌘ chord starts', () => {
    // macOS swallows Z's key-up once ⌘ is down (M7 minor 9).
    mount();
    fireEvent.keyDown(window, { key: 'z' });
    fireEvent.keyDown(window, { key: 'Meta', metaKey: true });
    expect(useViewStore.getState().held).toBe(false);
  });
});

describe('the dispatcher', () => {
  it('keys in a text field run nothing', async () => {
    const { requests } = mount();
    engine({ state: 'analysing', version: '1' });
    const field = screen.getByRole('textbox', { name: 'field' });
    for (const key of ['ArrowRight', ' ', 'f', 'z', 'Home']) fireEvent.keyDown(field, { key });
    fireEvent.keyDown(field, { key: 'o', ctrlKey: true });
    await frame();
    expect(requests.filter((r) => r.type !== 'appInfo')).toEqual([]);
    expect(useViewStore.getState()).toMatchObject({ hidden: false, held: false });
  });

  it('a key the device keymap binds runs its command; an unknown command is ignored', async () => {
    useDeviceStore.getState().update({ keymap: { J: 'nav.next', K: 'nav.nowhere' } });
    const { requests } = mount();
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    await frame();
    expect(navigations(requests)).toEqual([{ type: 'gameNavigate', to: 'next' }]);
  });

  it('a button and its key run the same command', async () => {
    const snapshot = makeSnapshot({ atStart: false, atEnd: false, hasMoves: true });
    const next = vi.spyOn(COMMANDS.get('nav.next')!, 'run');
    const { requests } = renderWithGame(
      <>
        <Keys />
        <NavButtons />
      </>,
      { snapshot },
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await frame();
    const button = screen.getByRole('button', { name: '下一手' });
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(button);
    await frame();
    expect(next).toHaveBeenCalledTimes(2);
    expect(navigations(requests)).toEqual([
      { type: 'gameNavigate', to: 'next' },
      { type: 'gameNavigate', to: 'next' },
    ]);
    next.mockRestore();
  });

  it('runCommand runs a command for touch controls', async () => {
    const { requests } = mount();
    act(() => runCommand('nav.last'));
    await frame();
    expect(requests.at(-1)).toEqual({ type: 'gameNavigate', to: 'last' });
  });
});
