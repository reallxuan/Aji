import { expect, it } from 'vitest';
import { formatLead, formatPercent, formatVisits } from './format';

it.each(['zh-CN', 'en'])('formats visits in %s', (lang) => {
  expect(formatVisits(840, lang)).toBe('840');
  expect(formatVisits(1234, lang)).toBe('1.2k');
  expect(formatVisits(3_100, lang)).toBe('3.1k');
  expect(formatVisits(999_960, lang)).toBe('1.0M');
  expect(formatVisits(3_400_000, lang)).toBe('3.4M');
});

it('signs a lead with a true minus, and shows zero unsigned', () => {
  expect(formatLead(3.46, 'en')).toBe('+3.5');
  expect(formatLead(-0.95, 'en')).toBe('−1.0');
  expect(formatLead(0, 'en')).toBe('0.0');
  expect(formatLead(0.04, 'zh-CN')).toBe('0.0');
  expect(formatLead(-0.04, 'zh-CN')).toBe('0.0');
});

it('formats a percentage, signed on request', () => {
  expect(formatPercent(0.3721, 'en')).toBe('37.2%');
  expect(formatPercent(-0.018, 'zh-CN', true)).toBe('−1.8%');
  expect(formatPercent(0.003, 'en', true)).toBe('+0.3%');
  expect(formatPercent(0, 'en', true)).toBe('0.0%');
});
