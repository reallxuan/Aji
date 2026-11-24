import { afterEach, describe, expect, it } from 'vitest';
import { createI18n } from '../i18n/createI18n';
import { createEngineStore } from '../engine/engineStore';
import { resetGameStore, useGameStore } from '../game/gameStore';
import { makeSnapshot } from '../game/testing';
import { createFakeTransport } from '../transport/fake';
import type { EngineState } from '../transport/generated/EngineState';
import type { Point } from '../transport/generated/Point';
import type { Request } from '../transport/generated/Request';
import type { ScoreMode } from '../transport/generated/ScoreMode';
import type { ScoreView } from '../transport/generated/ScoreView';
import { resetScoringStore, useScoringStore } from './scoringStore';
import { C5, finishedStones, H4 } from './testing';

const side = { stones: 0, territory: 0, dead: 0, prisoners: 0, total: 0 };
const view = (dead: Point[], suggested: Point[] = [C5, H4]): ScoreView => ({
  suggestedDead: suggested,
  black: { ...side, total: 40 + dead.length },
  white: { ...side, total: 48.5 },
  komi: 7.5,
  margin: dead.length - 8.5,
  owners: [],
  openByOwnership: false,
});

function setUp(
  state: EngineState['state'] = 'analysing',
  slow: (dead: Point[]) => number = () => 0,
) {
  const sent: Request[] = [];
  const transport = createFakeTransport(async (request) => {
    sent.push(request);
    if (request.type === 'gameScore') {
      const mode = request.mode as Extract<ScoreMode, { kind: 'final' }>;
      const wait = slow(mode.dead);
      if (wait < 0) throw new Error('no count');
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      return { type: 'score', ...view(mode.dead) };
    }
    return { type: 'ok' };
  });
  const engine = createEngineStore();
  engine.setState({ engine: { state, version: '1.16' } as EngineState });
  useGameStore.setState({ snapshot: makeSnapshot({ size: 9, stones: finishedStones() }) });
  const t = createI18n('en').t;
  const types = () => sent.map((r) => r.type);
  const scored = () =>
    sent
      .filter((r) => r.type === 'gameScore')
      .map((r) => (r as Extract<Request, { type: 'gameScore' }>).mode);
  return { transport, engine, ctx: { transport, engine, t }, types, scored };
}

const sorted = (points: Point[]) =>
  points.map((p) => `${p.x},${p.y}`).sort((a, b) => a.localeCompare(b));

describe('useScoringStore', () => {
  afterEach(() => {
    resetScoringStore();
    resetGameStore();
  });

  it('start_pauses_and_marks_katagos_dead', async () => {
    const { ctx, types, scored } = setUp('analysing');
    await useScoringStore.getState().start(ctx);
    const state = useScoringStore.getState();
    expect(state.active).toBe(true);
    expect(types()[0]).toBe('analysisPause');
    // First the suggestion, then the count with KataGo's dead stones marked.
    expect(scored().at(-1)).toEqual({ kind: 'final', dead: [C5, H4] });
    expect(state.suggested).toEqual([C5, H4]);
    expect(state.dead).toEqual([C5, H4]);
    expect(state.score?.margin).toBe(2 - 8.5);
  });

  it.each(['ends', 'refused', 'superseded'] as const)(
    'starts only after the current try-out ends (%s)',
    async (result) => {
      const { ctx, engine } = setUp('ready');
      const requests: Request[] = [];
      let finish!: () => void;
      const pending = new Promise<void>((r) => {
        finish = r;
      });
      useGameStore.getState().apply(makeSnapshot({ revision: 2, tryout: 0 }));
      const transport = createFakeTransport(async (request) => {
        requests.push(request);
        if (request.type === 'gameEdit') {
          await pending;
          if (result === 'refused') throw new Error('refused');
          return { type: 'game', warnings: [], snapshot: makeSnapshot({ revision: 3 }) };
        }
        return { type: 'score', ...view([]) };
      });
      const scoring = useScoringStore.getState();
      const first = scoring.start({ transport, engine, t: ctx.t });
      const second = scoring.start({ transport, engine, t: ctx.t });
      expect(requests).toEqual([{ type: 'gameEdit', edit: { kind: 'tryoutEnd' } }]);
      expect(useScoringStore.getState().active).toBe(false);
      if (result === 'superseded')
        useGameStore.getState().apply(makeSnapshot({ revision: 4, tryout: 7 }));
      finish();
      await Promise.all([first, second]);
      expect(useScoringStore.getState().active).toBe(result === 'ends');
      expect(requests.filter((r) => r.type === 'gameScore')).toHaveLength(
        result === 'ends' ? 2 : 0,
      );
    },
  );

  it('leaving while the pause is pending cannot start a late count', async () => {
    const { ctx, engine } = setUp();
    const requests: Request[] = [];
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const transport = createFakeTransport(async (request) => {
      requests.push(request);
      if (request.type === 'analysisPause') await pending;
      return { type: 'ok' };
    });
    const first = useScoringStore.getState().start({ transport, engine, t: ctx.t });
    await useScoringStore.getState().exit(transport);
    finish();
    await first;
    expect(requests.map((r) => r.type)).toEqual(['analysisPause', 'analysisResume']);
  });

  it('a pushed try-out cancels an in-flight scoring session and drops its answer', async () => {
    const { ctx, engine } = setUp('ready');
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const requests: Request[] = [];
    const transport = createFakeTransport(async (request) => {
      requests.push(request);
      await pending;
      return { type: 'score', ...view([]) };
    });
    const start = useScoringStore.getState().start({ transport, engine, t: ctx.t });
    useGameStore.getState().apply(makeSnapshot({ revision: 2, tryout: 0 }));
    finish();
    await start;
    expect(requests).toHaveLength(1);
    expect(useScoringStore.getState()).toMatchObject({ active: false, score: null });
  });

  it('tapping_a_stone_toggles_its_group_and_rescores', async () => {
    const { ctx, scored } = setUp();
    await useScoringStore.getState().start(ctx);
    // H4 is alone: tapping it brings it back to life.
    await useScoringStore.getState().toggle(ctx.transport, H4);
    expect(useScoringStore.getState().dead).toEqual([C5]);
    // D9 belongs to Black's wall from D9 to D1: all 13 of its stones go, H4 stays alive.
    await useScoringStore.getState().toggle(ctx.transport, { x: 3, y: 0 });
    const dead = useScoringStore.getState().dead;
    expect(dead).toHaveLength(1 + 13);
    expect(sorted(dead)).toEqual(expect.arrayContaining(['2,3', '4,5', '5,6', '3,8']));
    expect(sorted(dead)).not.toContain('7,5');
    expect(scored().at(-1)).toEqual({ kind: 'final', dead });
    expect(useScoringStore.getState().score?.margin).toBe(14 - 8.5);
    // An empty point is no group.
    const asked = scored().length;
    await useScoringStore.getState().toggle(ctx.transport, { x: 0, y: 0 });
    expect(scored()).toHaveLength(asked);
  });

  it('changed_marking_offers_reset', async () => {
    const { ctx } = setUp();
    await useScoringStore.getState().start(ctx);
    expect(useScoringStore.getState().changed()).toBe(false);
    await useScoringStore.getState().toggle(ctx.transport, H4);
    expect(useScoringStore.getState().changed()).toBe(true);
    // Back by hand, in another order, is not a change.
    await useScoringStore.getState().toggle(ctx.transport, H4);
    expect(useScoringStore.getState().dead).toEqual([C5, H4]);
    expect(useScoringStore.getState().changed()).toBe(false);
    await useScoringStore.getState().toggle(ctx.transport, C5);
    await useScoringStore.getState().reset(ctx.transport);
    expect(useScoringStore.getState().dead).toEqual([C5, H4]);
    expect(useScoringStore.getState().changed()).toBe(false);
  });

  it('exit_resumes_only_if_it_paused', async () => {
    const running = setUp('analysing');
    await useScoringStore.getState().start(running.ctx);
    await useScoringStore.getState().exit(running.transport);
    expect(running.types().at(-1)).toBe('analysisResume');
    expect(useScoringStore.getState()).toMatchObject({ active: false, score: null, dead: [] });

    const paused = setUp('paused');
    await useScoringStore.getState().start(paused.ctx);
    await useScoringStore.getState().exit(paused.transport);
    expect(paused.types()).not.toContain('analysisPause');
    expect(paused.types()).not.toContain('analysisResume');
  });

  it('a slow count does not overwrite a newer one', async () => {
    // The count with H4 alive answers last.
    const { ctx } = setUp('analysing', (dead) => (dead.length === 1 ? 20 : 0));
    await useScoringStore.getState().start(ctx);
    const first = useScoringStore.getState().toggle(ctx.transport, H4);
    const second = useScoringStore.getState().toggle(ctx.transport, H4);
    await Promise.all([first, second]);
    expect(useScoringStore.getState().score?.margin).toBe(2 - 8.5);
  });

  it('a failed count is kept, not thrown', async () => {
    const { ctx } = setUp('analysing', (dead) => (dead.length === 1 ? -1 : 0));
    await useScoringStore.getState().start(ctx);
    await useScoringStore.getState().toggle(ctx.transport, H4);
    expect(useScoringStore.getState()).toMatchObject({ active: true, failed: true });
    // The next count that answers clears it.
    await useScoringStore.getState().toggle(ctx.transport, H4);
    expect(useScoringStore.getState()).toMatchObject({ failed: false });
    expect(useScoringStore.getState().score?.margin).toBe(2 - 8.5);
  });
});
