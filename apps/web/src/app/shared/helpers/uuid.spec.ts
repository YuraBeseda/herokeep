import { uuidv7 } from './uuid';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('matches the UUIDv7 shape: version 7 nibble, RFC 4122 variant bits', () => {
    expect(uuidv7()).toMatch(UUID_V7);
  });

  it('the embedded timestamp prefix (first 12 hex digits) sorts ahead for a later call', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const first = uuidv7();
      vi.advanceTimersByTime(10);
      const second = uuidv7();

      const prefix = (id: string) => id.replace(/-/g, '').slice(0, 12);
      expect(prefix(second) > prefix(first)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('generates 1000 unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });
});
