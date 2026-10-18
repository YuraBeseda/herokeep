import type { Pins } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import semver from 'semver';

/** One pinned pack this device can move to a newer version (plan 15 Task 5). */
export interface PackUpdate {
  readonly packId: string;
  /** The version the character pins now. */
  readonly from: string;
  /** The version the update pins. */
  readonly to: string;
  /**
   * `'core'`: the pinned core is older than the core this app ships (plan ruling 6). The old core is
   * not kept on the device, so the update is reported validation-only (no sheet diff).
   */
  readonly kind: 'content' | 'core';
}

const byPackId = (a: PackUpdate, b: PackUpdate): number =>
  a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0;

/**
 * The updates available for a character pinned to `pins` on a device with `installed` packs.
 *
 * - Content: for each pinned content pack, the HIGHEST installed version strictly above the pin,
 *   by semver precedence (the engine's own `selectPackVersions` order, same `semver` package). A
 *   prerelease ranks below its release and above the previous release (`1.0.0 < 1.1.0-beta.1 <
 *   1.1.0`), so it is offered like any other higher version. The pinned version itself need not be
 *   installed.
 * - Core: an update to `shippedCore.version` only when it is strictly NEWER than the pinned core
 *   (the app serves only the shipped core). A pinned core newer than the shipped one (a character
 *   made on a newer app) gets no update: that would be a downgrade; the missing-pack banner reports
 *   the mismatch instead.
 * - A pin that is not valid semver gets no update (never throws).
 *
 * Pure and deterministic; sorted by `packId`.
 */
export function updatesFor(
  pins: Pins,
  installed: readonly Pack[],
  shippedCore: { readonly id: string; readonly version: string },
): PackUpdate[] {
  const updates: PackUpdate[] = [];
  for (const [packId, from] of Object.entries(pins)) {
    // A malformed pin (not valid semver) has no "newer"; it must never throw here.
    if (semver.valid(from) === null) continue;
    if (packId === shippedCore.id) {
      // Only an OLDER pinned core updates; a newer one (made on a newer app) would be a downgrade.
      if (semver.gt(shippedCore.version, from)) {
        updates.push({ packId, from, to: shippedCore.version, kind: 'core' });
      }
      continue;
    }
    let to: string | undefined;
    for (const pack of installed) {
      if (pack.id !== packId || pack.kind !== 'content') continue;
      if (!semver.gt(pack.version, from)) continue;
      if (to === undefined || semver.gt(pack.version, to)) to = pack.version;
    }
    if (to !== undefined) updates.push({ packId, from, to, kind: 'content' });
  }
  return updates.sort(byPackId);
}
