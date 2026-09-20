import { formatRelativeTime } from './format-relative-time';

const NOW = new Date('2026-09-20T12:00:00.000Z').getTime();

describe('formatRelativeTime', () => {
  it('formats sub-minute gaps as "now"', () => {
    expect(formatRelativeTime(NOW - 30_000, 'en', NOW)).toBe('now');
  });

  it('formats minutes for a gap under an hour', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, 'en', NOW)).toBe('5 minutes ago');
  });

  it('formats hours for a gap under a day', () => {
    expect(formatRelativeTime(NOW - 3 * 60 * 60_000, 'en', NOW)).toBe('3 hours ago');
  });

  it('formats days for a gap under a week', () => {
    expect(formatRelativeTime(NOW - 2 * 24 * 60 * 60_000, 'en', NOW)).toBe('2 days ago');
  });

  it('formats weeks/months/years for larger gaps', () => {
    expect(formatRelativeTime(NOW - 14 * 24 * 60 * 60_000, 'en', NOW)).toBe('2 weeks ago');
    expect(formatRelativeTime(NOW - 400 * 24 * 60 * 60_000, 'en', NOW)).toBe('last year');
  });

  it('formats through the given locale', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, 'ru', NOW)).toContain('5');
    expect(formatRelativeTime(NOW - 5 * 60_000, 'uk', NOW)).toContain('5');
  });

  it('defaults `now` to Date.now() when omitted', () => {
    const result = formatRelativeTime(Date.now() - 1000, 'en');
    expect(result).toBe('now');
  });
});
