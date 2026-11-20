import { describe, expect, it } from 'vitest';
import type { AppEvent } from '../transport/generated/AppEvent';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { Request } from '../transport/generated/Request';
import { TransportError } from '../transport/transport';
import { createFakeGame } from './fakeGame';

function setUp() {
  const events: AppEvent[] = [];
  const handle = createFakeGame((event) => events.push(event));
  const ask = (request: Request) => {
    const reply = handle(request);
    if (reply?.type !== 'game') throw new Error(`no game reply to ${request.type}`);
    return reply;
  };
  return { events, handle, ask };
}

const count = (snapshot: GameSnapshot) => snapshot.stones.filter(Boolean).length;

describe('the scenarios’ fake game', () => {
  it('opens the Samsung game and plays it to the end with captures', () => {
    const { ask, events } = setUp();
    const opened = ask({ type: 'gameOpen', name: 'samsung-30-final-2.sgf', bytes: '' });
    expect(opened.snapshot).toMatchObject({ moveNumber: 0, mainLineLength: 242, atStart: true });
    expect(opened.snapshot.info.event).toBe('第30届三星杯决赛');

    const end = ask({ type: 'gameNavigate', to: 'last' }).snapshot;
    const [byBlack, byWhite] = end.captures;
    expect(byBlack + byWhite).toBeGreaterThan(0);
    // Every move leaves a stone, less the ones captured.
    expect(count(end)).toBe(242 - byBlack - byWhite);
    expect(end).toMatchObject({ atEnd: true, nextColor: 'black' });
    expect(events.map((e) => e.type)).toEqual(['gameSnapshot', 'gameSnapshot']);
  });

  it('flags a move onto an occupied point and gives it no position', () => {
    const { ask } = setUp();
    const opened = ask({ type: 'gameOpen', name: 'illegal-ko.sgf', bytes: '' });
    expect(opened.warnings).toEqual([{ code: 'illegalMoves' }]);
    const third = ask({ type: 'gameNavigate', to: { move: 3 } }).snapshot;
    expect(third).toMatchObject({ illegal: 'occupied', positionKey: null, size: 9 });
    expect(ask({ type: 'gameNavigate', to: 'next' }).snapshot.illegal).toBeNull();
  });

  it('fails the way the backend does for the canned bad files', () => {
    const { handle } = setUp();
    const open = (name: string) => () => handle({ type: 'gameOpen', name, bytes: '' });
    expect(open('size-19x13.sgf')).toThrow(
      expect.objectContaining({ code: 'sgfUnsupportedSize', detail: '19x13' }),
    );
    expect(open('not-go.sgf')).toThrow(TransportError);
  });

  it('keeps the rules it is given until restored to the file’s', () => {
    const { ask } = setUp();
    ask({ type: 'gameOpen', name: 'samsung.sgf', bytes: '' });
    const custom = { kind: 'custom', komi: 7, scoring: 'area' } as const;
    expect(ask({ type: 'gameSetRules', rules: custom }).snapshot.rules).toMatchObject({
      current: custom,
      changed: true,
    });
    expect(ask({ type: 'gameSetRules', rules: null }).snapshot.rules.changed).toBe(false);
  });
});
