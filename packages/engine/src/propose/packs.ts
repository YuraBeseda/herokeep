import type { PackPinned, PackUnpinned } from '@hk/protocol';
import type { Sheet } from '../derive/sheet.ts';
import { error } from '../diagnostics.ts';
import { ProposeError, type ProposedEvent } from './index.ts';

/**
 * Plan 15 (phase 4 slice 5) Task 1, design ruling 3 — "installed ≠ enabled": a character opts in
 * to an installed content pack by pinning it and opts out by unpinning it. Both read only the
 * derived `Sheet` (`sheet.pins`, `sheet.corePackId`), like every other `propose.*`.
 *
 * `pinPack` drafts ONE `pack.pinned@1`, carrying `previous` when the pack is already pinned (a
 * version change); re-pinning the version already pinned is a no-op (`[]`, nothing impossible).
 * A pin that changes what the character's decisions resolve against goes through `planRebase`
 * instead — this is the plain opt-in (a newly enabled pack has no decisions yet).
 */
export function pinPack(sheet: Sheet, pack: { packId: string; version: string }): ProposedEvent[] {
  const previous = sheet.pins[pack.packId];
  if (previous === pack.version) return [];
  const payload: PackPinned = {
    packId: pack.packId,
    version: pack.version,
    ...(previous !== undefined ? { previous } : {}),
  };
  return [{ type: 'pack.pinned', v: 1, payload }];
}

/**
 * Drafts ONE `pack.unpinned@1`. REFUSES the core pack (`sheet.corePackId`) with a `ProposeError`
 * (`pack.unpinCore`) — a character cannot exist without its core. An id that is not pinned is a
 * no-op (`[]`).
 */
export function unpinPack(sheet: Sheet, packId: string): ProposedEvent[] {
  if (packId === sheet.corePackId) {
    throw new ProposeError([error('pack.unpinCore', `The core pack "${packId}" cannot be unpinned`)]);
  }
  if (!Object.hasOwn(sheet.pins, packId)) return [];
  const payload: PackUnpinned = { packId };
  return [{ type: 'pack.unpinned', v: 1, payload }];
}
