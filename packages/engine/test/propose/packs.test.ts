import { describe, expect, it } from 'vitest';
import { propose } from '../../src/propose/index.ts';
import { pinPack, unpinPack } from '../../src/propose/packs.ts';
import { baseSheet, captureProposeError } from './support.ts';

/** Plan 15 (phase 4 slice 5) Task 1, ruling 3 — a character opts in/out of a content pack. */
const sheet = () => baseSheet({ pins: { 'core-mini': '1.0.0', homebrew: '0.1.0' }, corePackId: 'core-mini' });

describe('propose.pinPack', () => {
  it('pins a new pack without previous', () => {
    expect(pinPack(sheet(), { packId: 'rebase-mini', version: '1.0.0' })).toEqual([
      { type: 'pack.pinned', v: 1, payload: { packId: 'rebase-mini', version: '1.0.0' } },
    ]);
  });

  it('re-pins an already pinned pack with previous = the current pin', () => {
    expect(propose.pinPack(sheet(), { packId: 'homebrew', version: '0.1.1' })).toEqual([
      { type: 'pack.pinned', v: 1, payload: { packId: 'homebrew', version: '0.1.1', previous: '0.1.0' } },
    ]);
  });

  it('the same version already pinned → no events', () => {
    expect(pinPack(sheet(), { packId: 'homebrew', version: '0.1.0' })).toEqual([]);
  });
});

describe('propose.unpinPack', () => {
  it('unpins a pinned content pack', () => {
    expect(propose.unpinPack(sheet(), 'homebrew')).toEqual([
      { type: 'pack.unpinned', v: 1, payload: { packId: 'homebrew' } },
    ]);
  });

  it('refuses the core pack', () => {
    const err = captureProposeError(() => unpinPack(sheet(), 'core-mini'));
    expect(err.diagnostics.map((d) => d.code)).toEqual(['pack.unpinCore']);
  });

  it('an id that is not pinned → no events', () => {
    expect(unpinPack(sheet(), 'nope')).toEqual([]);
  });
});
