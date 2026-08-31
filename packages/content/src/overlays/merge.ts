import { type Choice, type Entity, EntitySchema, type FeatureGrant } from '@hk/protocol';

/**
 * A patch to one `levels[]` progression row, addressed by `level`. `grants`/`choices` concatenate
 * onto the matching row's arrays (upstream entries first); `extra` shallow-merges onto the row's
 * `extra` map (patch values win on key collision). A `level` with no matching row is inserted as a
 * new row (using only the fields given here), keeping `levels` ascending.
 */
export interface OverlayRow {
  level: number;
  grants?: FeatureGrant[];
  choices?: Choice[];
  extra?: Record<string, number | string>;
}

/**
 * A patch targeting one entity by `id`. `set` replaces named top-level fields wholesale; `merge`
 * deep-merges named top-level fields (arrays concatenate, plain objects recurse, scalars from the
 * overlay win). `rows` merges into the entity's `levels[]` progression rows (class/subclass only —
 * see `OverlayRow`); it exists because `set`/`merge` address only whole top-level fields and so
 * cannot target one row inside `levels` without clobbering every other row's upstream grants.
 * `cite`/`note` are documentation only and never reach the entity.
 */
export interface Overlay {
  id: string;
  note?: string;
  cite?: string;
  set?: Record<string, unknown>;
  merge?: Record<string, unknown>;
  rows?: OverlayRow[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges `patch` onto `target`: two arrays concatenate (target elements first), two plain
 * objects recurse key by key, and any other combination (including a patch object shadowing a
 * target of a different shape) is replaced wholesale by the patch value.
 */
function deepMerge(target: unknown, patch: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(patch)) {
    return [...(target as unknown[]), ...(patch as unknown[])];
  }
  if (isPlainObject(target) && isPlainObject(patch)) {
    const merged: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(patch)) {
      merged[key] = key in target ? deepMerge(target[key], value) : value;
    }
    return merged;
  }
  return patch;
}

interface LevelRow {
  level: number;
  grants: unknown[];
  choices: unknown[];
  extra?: Record<string, unknown>;
}

/**
 * Merges `rows` into `entity.levels`. Only `class`/`subclass` entities carry `levels`; any other
 * entity type throws (`rows on non-progression entity`). Each `OverlayRow` either merges into the
 * `level` it names (grants/choices concat, extra shallow-merges) or, when no row at that level
 * exists yet, is inserted as a new row at the position that keeps `levels` ascending.
 */
function applyRows(entity: Record<string, unknown>, rows: OverlayRow[], overlayId: string): Record<string, unknown> {
  const type = entity['type'];
  if (type !== 'class' && type !== 'subclass') {
    throw new Error(
      `applyOverlays: "${overlayId}" has "rows" but targets a "${String(type)}" entity (rows require levels[], only class/subclass have it)`,
    );
  }
  const levels = (entity['levels'] as LevelRow[]).map((row) => ({
    ...row,
    grants: [...row.grants],
    choices: [...row.choices],
    ...(row.extra ? { extra: { ...row.extra } } : {}),
  }));

  for (const row of rows) {
    const existing = levels.find((r) => r.level === row.level);
    if (existing) {
      if (row.grants) existing.grants = [...existing.grants, ...row.grants];
      if (row.choices) existing.choices = [...existing.choices, ...row.choices];
      if (row.extra) existing.extra = { ...existing.extra, ...row.extra };
    } else {
      const insertAt = levels.findIndex((r) => r.level > row.level);
      const newRow: LevelRow = {
        level: row.level,
        grants: row.grants ? [...row.grants] : [],
        choices: row.choices ? [...row.choices] : [],
        ...(row.extra ? { extra: { ...row.extra } } : {}),
      };
      levels.splice(insertAt === -1 ? levels.length : insertAt, 0, newRow);
    }
  }

  return { ...entity, levels };
}

/**
 * Applies each overlay to its target entity (matched by `id`) in `entities`. For each overlay:
 * `set` fields replace the entity's same-named top-level fields wholesale, then `merge` fields are
 * deep-merged in (see `deepMerge`), then `rows` are merged into `levels[]` (see `applyRows`). The
 * patched entity is re-validated with `EntitySchema` — an invalid result throws with the Zod issue.
 * An overlay whose `id` matches no entity throws (`Unmatched overlay: <id>`), so a stale correction
 * can never silently rot. Pure: neither `entities` nor its elements are mutated — a fresh array of
 * fresh entities is returned.
 */
export function applyOverlays(entities: Entity[], overlays: Overlay[]): Entity[] {
  const result: Entity[] = entities.map((e) => structuredClone(e));
  const indexById = new Map(result.map((e, i) => [e.id, i]));

  for (const overlay of overlays) {
    const index = indexById.get(overlay.id);
    if (index === undefined) {
      throw new Error(`Unmatched overlay: ${overlay.id}`);
    }
    let patched: unknown = result[index];
    if (overlay.set) patched = { ...(patched as Record<string, unknown>), ...overlay.set };
    if (overlay.merge) patched = deepMerge(patched, overlay.merge);
    if (overlay.rows) patched = applyRows(patched as Record<string, unknown>, overlay.rows, overlay.id);

    const parsed = EntitySchema.safeParse(patched);
    if (!parsed.success) {
      throw new Error(
        `applyOverlays: "${overlay.id}" failed validation after patching: ${JSON.stringify(parsed.error.issues[0])}`,
      );
    }
    result[index] = parsed.data;
  }

  return result;
}
