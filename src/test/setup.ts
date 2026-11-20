// The screenshot tests run in the node environment, with a real canvas and no DOM.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  await import('vitest-canvas-mock');

  // Radix Select measures its content and captures the pointer; jsdom implements neither.
  class NoResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= NoResizeObserver as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

export {};
