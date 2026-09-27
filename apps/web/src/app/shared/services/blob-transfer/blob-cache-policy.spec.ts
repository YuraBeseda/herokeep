import {
  isOrphanSweepDue,
  prioritizeAnnounceHashes,
  selectLruEvictions,
  selectOrphans,
  type CacheableBlob,
} from './blob-cache-policy';

function row(overrides: Partial<CacheableBlob> & { hash: string }): CacheableBlob {
  return { size: 100, pinned: false, lastUsedAt: 0, ...overrides };
}

describe('selectLruEvictions', () => {
  it('evicts nothing when total size is already at or under the cap', () => {
    const rows = [row({ hash: 'a', size: 50 }), row({ hash: 'b', size: 50 })];
    expect(selectLruEvictions(rows, 100)).toEqual([]);
  });

  it('evicts the LEAST recently used UNPINNED blob first, stopping once under the cap', () => {
    const rows = [
      row({ hash: 'oldest', size: 40, lastUsedAt: 1 }),
      row({ hash: 'middle', size: 40, lastUsedAt: 2 }),
      row({ hash: 'newest', size: 40, lastUsedAt: 3 }),
    ];
    // total = 120, cap = 100 -> evict exactly enough to get to <= 100: dropping "oldest" (40)
    // brings total to 80, already under cap, so eviction stops there.
    expect(selectLruEvictions(rows, 100)).toEqual(['oldest']);
  });

  it('NEVER evicts a pinned blob, even when it is the oldest and the cap is still exceeded', () => {
    const rows = [
      row({ hash: 'pinned-old', size: 90, pinned: true, lastUsedAt: 1 }),
      row({ hash: 'unpinned-new', size: 90, lastUsedAt: 2 }),
    ];
    // total = 180, cap = 100. Evicting the unpinned one (90) leaves total = 90, still over the
    // pinned blob's own 90 bytes alone is under cap... but the pinned row itself must never be a
    // candidate regardless of order/age.
    const evictions = selectLruEvictions(rows, 100);
    expect(evictions).toEqual(['unpinned-new']);
    expect(evictions).not.toContain('pinned-old');
  });

  it('stops evicting once every unpinned blob is gone, even if pinned blobs alone exceed the cap', () => {
    const rows = [
      row({ hash: 'pinned-a', size: 80, pinned: true, lastUsedAt: 1 }),
      row({ hash: 'pinned-b', size: 80, pinned: true, lastUsedAt: 2 }),
      row({ hash: 'unpinned', size: 10, lastUsedAt: 3 }),
    ];
    // total = 170, cap = 50. Only "unpinned" can ever be evicted; the two pinned rows are never
    // touched even though the cap remains exceeded afterward (doc-07: "if pinned exceeds the cap
    // the UI explains" — this function's job stops at "never evict pinned").
    expect(selectLruEvictions(rows, 50)).toEqual(['unpinned']);
  });

  it('evicts multiple blobs in strict lastUsedAt-ascending order until under the cap', () => {
    const rows = [
      row({ hash: 'a', size: 30, lastUsedAt: 3 }),
      row({ hash: 'b', size: 30, lastUsedAt: 1 }),
      row({ hash: 'c', size: 30, lastUsedAt: 2 }),
    ];
    // total = 90, cap = 20 -> must evict all three regardless of order to reach <= 20, but the
    // ORDER they're evicted in must still be oldest-first.
    expect(selectLruEvictions(rows, 20)).toEqual(['b', 'c', 'a']);
  });
});

describe('selectOrphans', () => {
  it('flags an unpinned blob referenced by nothing as an orphan', () => {
    const rows = [row({ hash: 'gone' })];
    expect(selectOrphans(rows, new Set())).toEqual(['gone']);
  });

  it('does not flag a blob whose hash is in the referenced set', () => {
    const rows = [row({ hash: 'kept' })];
    expect(selectOrphans(rows, new Set(['kept']))).toEqual([]);
  });

  it('never flags a pinned blob as an orphan, even when unreferenced', () => {
    const rows = [row({ hash: 'pinned-orphan', pinned: true })];
    expect(selectOrphans(rows, new Set())).toEqual([]);
  });

  it('returns every unreferenced, unpinned hash when several qualify', () => {
    const rows = [
      row({ hash: 'a' }),
      row({ hash: 'b', pinned: true }),
      row({ hash: 'c' }),
      row({ hash: 'd' }),
    ];
    expect(selectOrphans(rows, new Set(['d']))).toEqual(['a', 'c']);
  });
});

describe('isOrphanSweepDue', () => {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  it('is due when it has never run before', () => {
    expect(isOrphanSweepDue(undefined, 1_000_000, WEEK_MS)).toBe(true);
  });

  it('is NOT due when less than the interval has elapsed', () => {
    expect(isOrphanSweepDue(1000, 1000 + WEEK_MS - 1, WEEK_MS)).toBe(false);
  });

  it('is due exactly at the interval boundary', () => {
    expect(isOrphanSweepDue(1000, 1000 + WEEK_MS, WEEK_MS)).toBe(true);
  });

  it('is due well past the interval', () => {
    expect(isOrphanSweepDue(1000, 1000 + WEEK_MS * 3, WEEK_MS)).toBe(true);
  });
});

describe('prioritizeAnnounceHashes', () => {
  it('returns every hash, in order, when under the cap', () => {
    const entries = [
      { hash: 'a', pinned: false },
      { hash: 'b', pinned: true },
    ];
    expect(prioritizeAnnounceHashes(entries, 10)).toEqual(['b', 'a']);
  });

  it('puts every PINNED hash before any unpinned hash, preserving relative order within each group', () => {
    const entries = [
      { hash: 'unpinned-1', pinned: false },
      { hash: 'pinned-1', pinned: true },
      { hash: 'unpinned-2', pinned: false },
      { hash: 'pinned-2', pinned: true },
    ];
    expect(prioritizeAnnounceHashes(entries, 10)).toEqual([
      'pinned-1',
      'pinned-2',
      'unpinned-1',
      'unpinned-2',
    ]);
  });

  it('caps the result at the given limit, dropping unpinned hashes first', () => {
    const entries = [
      { hash: 'pinned-1', pinned: true },
      { hash: 'unpinned-1', pinned: false },
      { hash: 'unpinned-2', pinned: false },
    ];
    expect(prioritizeAnnounceHashes(entries, 2)).toEqual(['pinned-1', 'unpinned-1']);
  });

  it('caps even when EVERY hash is pinned (doc-08 server cap is per-connection, not per-priority)', () => {
    const entries = [
      { hash: 'a', pinned: true },
      { hash: 'b', pinned: true },
      { hash: 'c', pinned: true },
    ];
    expect(prioritizeAnnounceHashes(entries, 2)).toEqual(['a', 'b']);
  });

  it('returns an empty array for an empty input', () => {
    expect(prioritizeAnnounceHashes([], 512)).toEqual([]);
  });
});
