import { MainFrame } from './layout/MainFrame';
import { VersionLine } from './panel/VersionLine';
import { useThemeSync } from './theme/useThemeSync';

export default function App() {
  useThemeSync();
  return (
    <MainFrame
      panel={
        <footer className="mt-auto">
          <VersionLine />
        </footer>
      }
    />
  );
}
