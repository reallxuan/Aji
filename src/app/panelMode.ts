import type { EngineState } from '../transport/generated/EngineState';
import type { JobSnapshot } from '../transport/generated/JobSnapshot';

export type PanelMode = 'wizard' | 'analysis' | 'settings';

/**
 * What the right-hand panel shows (M5 design 5.1). A running install always shows the wizard, so a
 * job is never left running unseen; then an explicitly opened wizard; then, with no engine set up,
 * the wizard unless it was dismissed this run; then settings if open; otherwise analysis.
 */
export function panelMode(
  engine: EngineState | null,
  wizard: { open: boolean; dismissed: boolean },
  settingsOpen: boolean,
  job: JobSnapshot | null,
): PanelMode {
  if (job && job.outcome === null) return 'wizard';
  if (wizard.open) return 'wizard';
  if (engine?.state === 'notConfigured' && !wizard.dismissed) return 'wizard';
  if (settingsOpen) return 'settings';
  return 'analysis';
}
