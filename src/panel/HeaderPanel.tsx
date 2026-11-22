import { useEngineStore } from '../engine/engineStore';
import { EngineStatus } from './EngineStatus';
import { NoEngine } from './NoEngine';
import { NoticeLine } from './NoticeLine';
import { PanelHeader } from './PanelHeader';

/**
 * The header panel (P2 M1 design 5.1): the header row, then the notice line, then the engine's
 * status, or the no-engine panel before an engine is set up. It cannot be hidden.
 */
export function HeaderPanel() {
  const notConfigured = useEngineStore((s) => s.engine?.state === 'notConfigured');
  return (
    <div className="flex flex-col">
      <PanelHeader />
      <NoticeLine />
      {notConfigured ? <NoEngine /> : <EngineStatus />}
    </div>
  );
}
