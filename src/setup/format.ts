const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** A size in binary units, as file managers show it: one decimal under ten, none above. */
export function formatBytes(bytes: number, locale: string): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  const text = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
  return `${text} ${UNITS[unit]}`;
}

/**
 * A calendar date from an ISO date or timestamp. Chinese keeps the ISO form the mockups use;
 * other languages get the locale's short month form. Text that is not a date is returned as is.
 */
export function formatDate(iso: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  if (locale.startsWith('zh')) return match[0];
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
