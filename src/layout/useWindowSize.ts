import { useEffect, useState } from 'react';

export type WindowSize = { width: number; height: number };

function readWindowSize(): WindowSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function useWindowSize(): WindowSize {
  const [size, setSize] = useState(readWindowSize);
  useEffect(() => {
    const onResize = () => setSize(readWindowSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}
