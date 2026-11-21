import type { AnalysisUpdate } from '../transport/generated/AnalysisUpdate';

/**
 * True while a new search has fewer visits than the cached one it replaces (design 5.2): the
 * interface fades the numbers and shows how far it has come.
 */
export function catchingUp(update: AnalysisUpdate): boolean {
  return update.rootVisits < update.previousVisits;
}
