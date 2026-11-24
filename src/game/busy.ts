/**
 * Typing in a field, or working in an open menu or popover, keeps its keys. A hover card (the
 * engine card) only shows: it takes no keys, so its popper does not count.
 */
export function busy(target: EventTarget | null): boolean {
  if (target instanceof Element) {
    if (target instanceof HTMLElement && target.isContentEditable) return true;
    const editor = target.closest('[contenteditable]');
    if (editor && editor.getAttribute('contenteditable') !== 'false') return true;
    if (target.closest('input, textarea, select, [role="menu"], [role="dialog"]')) return true;
  }
  if (
    document.querySelector(
      'dialog[open], [role="dialog"][aria-modal="true"]:not([hidden], [data-state="closed"])',
    )
  )
    return true;
  const poppers = document.querySelectorAll('[data-radix-popper-content-wrapper]');
  return Array.from(poppers).some(
    (wrapper) => wrapper.querySelector('[data-slot="hover-card-content"]') === null,
  );
}
