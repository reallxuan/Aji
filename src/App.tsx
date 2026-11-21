import { useAnalysisKeys } from './analysis/useAnalysisKeys';
import { useTrendSync } from './analysis/useTrendSync';
import { panelMode } from './app/panelMode';
import { usePanelStore } from './app/panelStore';
import { useEngineStore } from './engine/engineStore';
import { useEngineSync } from './engine/useEngineSync';
import { useGameSync } from './game/useGameSync';
import { DropOverlay } from './board/DropOverlay';
import { LayoutFrame } from './layout/LayoutFrame';
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
  useAnalysisKeys();
  const engine = useEngineStore((s) => s.engine);
  const open = useWizardStore((s) => s.open);
  const dismissed = useWizardStore((s) => s.dismissed);
  const job = useWizardStore((s) => s.job);
  const view = usePanelStore((s) => s.view);
  const mode = panelMode(engine, { open, dismissed }, view !== 'main', job);

  // Before the first frame is ready the side area stays empty, so nothing flashes (M5 minor 5).
  const side =
    !ready || !deviceLoaded ? (
      <div />
    ) : mode === 'wizard' ? (
      <SetupPanel />
    ) : mode === 'settings' ? (
      view === 'about' ? (
        <AboutPanel />
      ) : (
        <SettingsPanel />
      )
    ) : undefined;

  return <LayoutFrame boardOverlay={<DropOverlay />} side={side} />;
}
