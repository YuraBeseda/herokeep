import { mergeMemberPresence } from './member-presence';

const members = new Map([
  ['u-dm', { displayName: 'Alice', role: 'dm' as const, removed: false }],
  ['u-player', { displayName: 'Bob', role: 'player' as const, removed: false }],
]);

describe('mergeMemberPresence', () => {
  it('prefers the live display name and online flag over the projected member', () => {
    const rows = mergeMemberPresence(members, [
      { userId: 'u-dm', displayName: 'Alice (live)', role: 'dm', online: true },
    ]);
    expect(rows).toEqual([
      { userId: 'u-dm', displayName: 'Alice (live)', role: 'dm', removed: false, online: true },
      { userId: 'u-player', displayName: 'Bob', role: 'player', removed: false, online: false },
    ]);
  });

  it('reads every member as offline while no live list exists', () => {
    expect(mergeMemberPresence(members, null).map((r) => r.online)).toEqual([false, false]);
  });

  it('ignores a live entry for someone the projection does not know', () => {
    const rows = mergeMemberPresence(members, [
      { userId: 'stranger', displayName: 'Eve', role: 'player', online: true },
    ]);
    expect(rows.map((r) => r.userId)).toEqual(['u-dm', 'u-player']);
  });
});
