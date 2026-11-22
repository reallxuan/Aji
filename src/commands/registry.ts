import type { EngineStore } from '../engine/engineStore';
import type { ActionContext } from '../game/actions';
import type { NavTarget } from '../transport/generated/NavTarget';
import type { OsKind } from '../transport/generated/OsKind';
import { BUILTINS } from './builtins';

export type CommandId =
  | 'nav.previous'
  | 'nav.next'
  | 'nav.first'
  | 'nav.last'
  | 'nav.pageBack'
  | 'nav.pageForward'
  | 'file.open'
  | 'file.saveAs'
  | 'file.new19'
  | 'analysis.toggle'
  | 'candidates.toggleHidden'
  | 'candidates.peek';

export type Phase = 'down' | 'up';

/** What a command acts on: what the old key hooks took from their providers. */
export type CommandContext = {
  actions: ActionContext;
  engine: EngineStore;
  /** Navigation at most once per animation frame, the latest target winning. */
  go(to: NavTarget): void;
  os: OsKind | null;
};

/**
 * One thing the interface can do, whatever runs it: a key, a button, or a touch control (P2 M1
 * design 5.11). A `press` command ignores `up`; a `hold` command lasts from `down` to `up`.
 */
export interface Command {
  id: CommandId;
  labelKey: string;
  kind: 'press' | 'hold';
  /** Whether a held key's repeats run it again. */
  repeats: boolean;
  /** `main` commands rest while the wizard, settings or About fill the side. */
  scope: 'main' | 'always';
  run(ctx: CommandContext, phase: Phase): void;
}

export const COMMANDS: ReadonlyMap<CommandId, Command> = new Map(BUILTINS.map((c) => [c.id, c]));

export function isCommandId(id: string): id is CommandId {
  return COMMANDS.has(id as CommandId);
}

/** The context the key dispatcher last registered, for `runCommand`. */
let current: CommandContext | null = null;

export function setCommandContext(ctx: CommandContext | null) {
  current = ctx;
}

/** Runs a command from outside React's providers (touch controls); nothing before the app is up. */
export function runCommand(id: CommandId, phase: Phase = 'down'): void {
  const command = COMMANDS.get(id);
  if (!command || !current) return;
  if (command.kind === 'press' && phase === 'up') return;
  command.run(current, phase);
}
