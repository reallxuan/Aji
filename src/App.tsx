import { MainFrame } from './layout/MainFrame';
import { useThemeSync } from './theme/useThemeSync';

export default function App() {
  useThemeSync();
  return <MainFrame panel={null} />;
}
