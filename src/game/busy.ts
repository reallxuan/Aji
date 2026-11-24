/** The focused control has its own text undo history. */
export function isTextEditor(target: Element | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement)
    return ['text', 'search', 'number', 'email', 'url', 'tel', 'password'].includes(target.type);
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const editor = target?.closest('[contenteditable]');
  return !!editor && editor.getAttribute('contenteditable') !== 'false';
}

/**
 * Typing in a field, or working in an open menu or popover, keeps its keys. A hover card (the
 * engine card) only shows: it takes no keys, so its popper does not count.
 */
export function busy(target: EventTarget | null): boolean {
  if (target instanceof Element) {
    if (isTextEditor(target)) return true;
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
