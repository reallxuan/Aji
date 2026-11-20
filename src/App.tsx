import { useEngineSync } from './engine/useEngineSync';
import { MainFrame } from './layout/MainFrame';
import { CandidateList } from './panel/CandidateList';
import { EngineIndicator } from './panel/EngineIndicator';
import { EngineStatus } from './panel/EngineStatus';
import { VersionLine } from './panel/VersionLine';
import { useSettingsSync } from './settings/useSettingsSync';

export default function App() {
  useSettingsSync();
  useEngineSync();
  return (
    <MainFrame
      panel={
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
      }
    />
  );
}
