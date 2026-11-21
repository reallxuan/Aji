import { AnalysisPanel } from './analysis/AnalysisPanel';
import { useTrendSync } from './analysis/useTrendSync';
import { panelMode } from './app/panelMode';
import { usePanelStore } from './app/panelStore';
import { useEngineStore } from './engine/engineStore';
import { useEngineSync } from './engine/useEngineSync';
import { useGameSync } from './game/useGameSync';
import { DropOverlay } from './board/DropOverlay';
import { MainFrame } from './layout/MainFrame';
import { EngineStatus } from './panel/EngineStatus';
import { NoEngine } from './panel/NoEngine';
import { NoticeLine } from './panel/NoticeLine';
import { PanelHeader } from './panel/PanelHeader';
import { VersionLine } from './panel/VersionLine';
import { usePlatformSync } from './platform/usePlatformSync';
import { AboutPanel } from './settings/AboutPanel';
import { SettingsPanel } from './settings/SettingsPanel';
import { useSettingsSync } from './settings/useSettingsSync';
import { useDeviceSync } from './device/useDeviceSync';
import { useDeviceStore } from './device/deviceStore';
import { SetupPanel } from './setup/SetupPanel';
import { useSetupProgress } from './setup/useSetupProgress';
import { useWizardStore } from './setup/wizardStore';

export default function App() {
  useSettingsSync();
  useDeviceSync();
  const deviceLoaded = useDeviceStore((s) => s.loaded);
  useEngineSync();
  useSetupProgress();
  const { ready } = useGameSync();
  useTrendSync();
  usePlatformSync();
  const engine = useEngineStore((s) => s.engine);
  const open = useWizardStore((s) => s.open);
  const dismissed = useWizardStore((s) => s.dismissed);
  const job = useWizardStore((s) => s.job);
  const view = usePanelStore((s) => s.view);
  const mode = panelMode(engine, { open, dismissed }, view !== 'main', job);

  return (
    <MainFrame
      boardOverlay={<DropOverlay />}
      panel={
        // The first frame waits for both the engine status and the game, so neither flashes.
        !ready || !deviceLoaded ? null : mode === 'wizard' ? (
          <SetupPanel />
        ) : mode === 'settings' ? (
          view === 'about' ? (
            <AboutPanel />
          ) : (
            <SettingsPanel />
          )
        ) : (
          <>
            <PanelHeader />
            <NoticeLine />
            {engine?.state === 'notConfigured' ? (
              <NoEngine />
            ) : (
              <>
                <EngineStatus />
                <AnalysisPanel />
              </>
            )}
            <footer className="mt-auto">
              <VersionLine />
            </footer>
          </>
        )
      }
    />
  );
}
