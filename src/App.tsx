import { panelMode } from './app/panelMode';
import { useEngineStore } from './engine/engineStore';
import { useEngineSync } from './engine/useEngineSync';
import { MainFrame } from './layout/MainFrame';
import { CandidateList } from './panel/CandidateList';
import { EngineIndicator } from './panel/EngineIndicator';
import { EngineStatus } from './panel/EngineStatus';
import { VersionLine } from './panel/VersionLine';
import { useSettingsSync } from './settings/useSettingsSync';
import { SetupPanel } from './setup/SetupPanel';
import { useSetupProgress } from './setup/useSetupProgress';
import { useWizardStore } from './setup/wizardStore';

export default function App() {
  useSettingsSync();
  useEngineSync();
  useSetupProgress();
  const engine = useEngineStore((s) => s.engine);
  const open = useWizardStore((s) => s.open);
  const dismissed = useWizardStore((s) => s.dismissed);
  const job = useWizardStore((s) => s.job);
  // Settings arrive with the settings page.
  const mode = panelMode(engine, { open, dismissed }, false, job);
  return (
    <MainFrame
      panel={
        mode === 'wizard' ? (
          <SetupPanel />
        ) : (
          <>
            <header className="flex justify-end px-6 py-4">
              <EngineIndicator />
            </header>
            <EngineStatus />
            <CandidateList />
            <footer className="mt-auto">
              <VersionLine />
            </footer>
          </>
        )
      }
    />
  );
}
