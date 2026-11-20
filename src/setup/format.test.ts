import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate } from './format';

describe('formatBytes', () => {
  it('uses binary units with one decimal under ten', () => {
    expect(formatBytes(12 * 1024 ** 3, 'en')).toBe('12 GB');
    expect(formatBytes(1.25 * 1024 ** 3, 'en')).toBe('1.3 GB');
    expect(formatBytes(180_000_000, 'zh-CN')).toBe('172 MB');
    expect(formatBytes(512, 'en')).toBe('512 B');
  });
});

describe('formatDate', () => {
  it('writes ISO dates in Chinese, as the mockups do, and a short month in English', () => {
    expect(formatDate('2026-08-30', 'zh-CN')).toBe('2026-08-30');
    expect(formatDate('2026-08-30T12:00:00Z', 'zh-CN')).toBe('2026-08-30');
    expect(formatDate('2026-08-30', 'en')).toBe('Aug 30, 2026');
  });

  it('passes through text it cannot read', () => {
    expect(formatDate('', 'en')).toBe('');
    expect(formatDate('soon', 'en')).toBe('soon');
  });
});
