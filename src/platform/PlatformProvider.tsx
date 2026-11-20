import { createContext, useContext, type ReactNode } from 'react';
import type { PlatformFiles } from './files';

const PlatformContext = createContext<PlatformFiles | null>(null);

export function PlatformProvider({
  files,
  children,
}: {
  files: PlatformFiles;
  children: ReactNode;
}) {
  return <PlatformContext.Provider value={files}>{children}</PlatformContext.Provider>;
}

export function usePlatformFiles(): PlatformFiles {
  const files = useContext(PlatformContext);
  if (!files) throw new Error('usePlatformFiles must be used inside a PlatformProvider');
  return files;
}
