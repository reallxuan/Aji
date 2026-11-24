import type { TFunction } from 'i18next';
import type { CacheStats } from '../transport/generated/CacheStats';
import type { GameSnapshot } from '../transport/generated/GameSnapshot';
import type { GameWarning } from '../transport/generated/GameWarning';
import { toTransportError } from '../transport/transport';
import type { Notice } from './noticeStore';

export type NoticeContent = Omit<Notice, 'id'>;

/** An error line (design 5.8, mockup frame E): what failed, then why, from the error's code. */
export function errorNotice(title: string, error: unknown, t: TFunction): NoticeContent {
  const { code, detail } = toTransportError(error);
  // The backend names a size as `19x13`; people read `19×13`.
  const size = (detail ?? '').replace('x', '×');
  return { kind: 'error', title, detail: t(`errors.${code}`, { size }) };
}

/** The cache file can't be used (P2 M2 design 5.2): results last only for this session. */
export function cacheNotice(stats: CacheStats, t: TFunction): NoticeContent | null {
  if (stats.persistent) return null;
  return {
    kind: 'warning',
    title: t('notice.cacheMemoryOnly.title'),
    detail: t('notice.cacheMemoryOnly.detail'),
  };
}

/** Most important first: the one the notice line leads with. */
const WARNING_ORDER: GameWarning['code'][] = [
  'truncated',
  'extraGames',
  'encodingGuessed',
  'repaired',
  'illegalMoves',
  'komiUnreadable',
];

function warningValues(warning: GameWarning, snapshot: GameSnapshot) {
  switch (warning.code) {
    case 'truncated':
      return { moves: snapshot.lineLength, next: snapshot.lineLength + 1 };
    case 'extraGames':
      // The backend counts the games besides the open one; people count them all.
      return { total: warning.count + 1 };
    case 'encodingGuessed':
      return { encoding: warning.encoding };
    default:
      return {};
  }
}

/**
 * One warning line for everything reading the file repaired or guessed: the most important
 * warning's title and detail, then the other warnings' titles, a line each.
 */
export function warningNotice(
  warnings: GameWarning[],
  snapshot: GameSnapshot,
  t: TFunction,
): NoticeContent | null {
  if (warnings.length === 0) return null;
  const [first, ...rest] = [...warnings].sort(
    (a, b) => WARNING_ORDER.indexOf(a.code) - WARNING_ORDER.indexOf(b.code),
  );
  const text = (warning: GameWarning, part: 'title' | 'detail') =>
    t(`notice.warning.${warning.code}.${part}`, warningValues(warning, snapshot));
  return {
    kind: 'warning',
    title: text(first, 'title'),
    detail: [text(first, 'detail'), ...rest.map((w) => text(w, 'title'))].join('\n'),
  };
}
