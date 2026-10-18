import { ENTITY_TYPES, type EntityType, type Pack } from '@hk/protocol';
import type { PackImportPreview } from '@shared/services/packs/hkpack-reader.service';

/** What the trust screen and the detail screen show about a pack's contents (ADR-008 :107-109).
 * Same shape the importer computes for a preview (`PackImportPreview.summary`). */
export type PackSummary = PackImportPreview['summary'];

/** One "entities by type" row, in `ENTITY_TYPES` order. */
export interface EntityCountRow {
  readonly type: EntityType;
  readonly count: number;
}

/** `id@version` — the key `PackStore.removeContent` and the `/packs/:key` route use. */
export function packKey(pack: { readonly id: string; readonly version: string }): string {
  return `${pack.id}@${pack.version}`;
}

/** The summary of an INSTALLED pack (no import preview at hand): asset bytes are the sizes the
 * pack declares, which the importer verified against the real bytes before storing it. */
export function summarizePack(pack: Pack): PackSummary {
  const entityCounts: Partial<Record<EntityType, number>> = {};
  for (const entity of pack.entities) {
    entityCounts[entity.type] = (entityCounts[entity.type] ?? 0) + 1;
  }
  return {
    entityCounts,
    overrides: pack.overrides.map((o) => o.target),
    assetCount: pack.assets.length,
    assetBytes: pack.assets.reduce((sum, asset) => sum + asset.size, 0),
    dependencies: pack.dependencies.map((d) => ({ id: d.id, range: d.range })),
  };
}

/** Non-zero entity counts in the protocol's `ENTITY_TYPES` order (stable, locale-independent). */
export function entityCountRows(counts: Partial<Record<EntityType, number>>): EntityCountRow[] {
  return ENTITY_TYPES.flatMap((type) => {
    const count = counts[type] ?? 0;
    return count > 0 ? [{ type, count }] : [];
  });
}
