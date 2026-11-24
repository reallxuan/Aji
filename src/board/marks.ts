import type { MarkAt } from '../transport/generated/MarkAt';
import { branchLetter } from './badges';

/** Select the first unused label on the node, including labels loaded from its SGF. */
export function nextLabel(marks: readonly MarkAt[], kind: 'letter' | 'number'): string {
  const used = new Set(marks.flatMap(({ mark }) => (mark.kind === 'label' ? [mark.text] : [])));
  for (let i = 0; ; i++) {
    const text = kind === 'letter' ? branchLetter(i) : String(i + 1);
    if (!used.has(text)) return text;
  }
}
