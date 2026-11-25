import { useTrendSync } from './analysis/useTrendSync';
import { useCacheSync } from './cache/useCacheSync';
import { useJobSync } from './job/useJobSync';
import { panelMode } from './app/panelMode';
import { usePanelStore } from './app/panelStore';
import { useKeyDispatcher } from './commands/useKeyDispatcher';
import { useEngineStore } from './engine/engineStore';
import { useEngineSync } from './engine/useEngineSync';
import { useConsoleSync } from './engine/consoleStore';
import { useProfileSync } from './engine/profileStore';
import { SwitchConfirm } from './engine/SwitchConfirm';
import { useGameSync } from './game/useGameSync';
import { DropOverlay } from './board/DropOverlay';
import { LayoutFrame } from './layout/LayoutFrame';
import { usePlatformSync } from './platform/usePlatformSync';
import { AboutPanel } from './settings/AboutPanel';
import { SettingsPanel } from './settings/SettingsPanel';
import { useSettingsSync } from './settings/useSettingsSync';
import { useDeviceSync } from './device/useDeviceSync';
import { useDeviceStore } from './device/deviceStore';
import { useInterfaceScale } from './settings/useInterfaceScale';
import { SetupPanel } from './setup/SetupPanel';
import { useSetupProgress } from './setup/useSetupProgress';
import { useWizardStore } from './setup/wizardStore';

export default function App() {
  useSettingsSync();
  useDeviceSync();
  const deviceLoaded = useDeviceStore((s) => s.loaded);
  useInterfaceScale();
  useEngineSync();
  useSetupProgress();
  const { ready } = useGameSync();
  useTrendSync();
  useJobSync();
  useProfileSync();
  useConsoleSync();
  useCacheSync();
  usePlatformSync();
  const engine = useEngineStore((s) => s.engine);
  const open = useWizardStore((s) => s.open);
  const dismissed = useWizardStore((s) => s.dismissed);
  const job = useWizardStore((s) => s.job);
  const starting = useWizardStore((s) => s.starting);
  const view = usePanelStore((s) => s.view);
  const mode = panelMode(engine, { open, dismissed }, view !== 'main', job);
  const sideOpen = !ready || !deviceLoaded || mode === 'wizard' || mode === 'settings';
  // The board's keys rest while the wizard, settings or About fill the side.
  useKeyDispatcher(!sideOpen);

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

  // In the narrow arrangement the side is a sheet, closed as its own back control would close it.
  // A running install keeps the wizard, from pressing install on: its next progress would only
  // bring the sheet back.
  const installing = mode === 'wizard' && (starting || (job !== null && job.outcome === null));
  const closeSide =
    sideOpen && ready && deviceLoaded
      ? () =>
          mode === 'wizard'
            ? useWizardStore.getState().close()
            : usePanelStore.getState().show('main')
      : undefined;

  return (
    <>
      <LayoutFrame
        boardOverlay={<DropOverlay />}
        side={side}
        onCloseSide={closeSide}
        sideLocked={installing}
      />
      <SwitchConfirm />
    </>
  );
}
