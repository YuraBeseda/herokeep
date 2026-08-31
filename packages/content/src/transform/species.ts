import type { Entity } from '@hk/protocol';
import { featureId, speciesId } from '../ids.ts';
import { type FixtureRecord, pkSlug, readFixture } from '../upstream.ts';
import { baseEntity, fieldNum, fieldStr, pkStr } from './common.ts';

/**
 * `SpeciesTrait.fields.type` values that mark a trait as structural (consumed to derive
 * `size`/`speed` rather than emitted as a `feature`) — verified over all 51 records: exactly
 * `'SIZE' | 'SPEED' | null` occur (non-structural traits use `null`). Any other value is a new
 * upstream shape and throws.
 */
const STRUCTURAL_TRAIT_TYPES = new Set(['SIZE', 'SPEED']);

/**
 * Placeholder-safe structural values shared by every species. SRD 5.2.1's actual per-species
 * exceptions (Goliath's 35ft speed; Halfling/Gnome's Small size, etc.) are corrected by Task 11's
 * `overlays/species.json` — this transform only needs schema-valid defaults, not the true values.
 */
const PLACEHOLDER_SIZE = 'medium';
const PLACEHOLDER_SPEED = 30;
const PLACEHOLDER_CREATURE_TYPE = 'humanoid';

/** Whether a SpeciesTrait record is structural (SIZE/SPEED); throws on an unrecognized `type`. */
function isStructuralTrait(fields: Record<string, unknown>, pk: FixtureRecord['pk']): boolean {
  const value = fields['type'];
  if (value === null) return false;
  if (typeof value === 'string' && STRUCTURAL_TRAIT_TYPES.has(value)) return true;
  throw new Error(`species: SpeciesTrait "${String(pk)}" has unrecognized type ${JSON.stringify(value)}`);
}

interface TraitRow {
  rec: FixtureRecord;
  order: number;
}

/**
 * The 9 `Species.json` records as `species` entities, plus one `feature` entity per non-structural
 * `SpeciesTrait` (SIZE/SPEED traits are consumed structurally and not emitted). Feature ids reuse
 * the trait pk slug directly (already shaped `<species>-<trait>`, e.g. `dragonborn-darkvision`);
 * each species `grants` exactly its own trait features, ordered by the fixture's `order` field.
 */
export function transformSpecies(): { species: Entity[]; features: Entity[] } {
  const traitsByParent = new Map<string, TraitRow[]>();
  for (const rec of readFixture('SpeciesTrait')) {
    const pk = pkStr(rec.pk);
    if (isStructuralTrait(rec.fields, pk)) continue;
    const parent = fieldStr(rec.fields, 'parent', pk);
    const order = fieldNum(rec.fields, 'order', pk);
    const list = traitsByParent.get(parent) ?? [];
    list.push({ rec, order });
    traitsByParent.set(parent, list);
  }
  for (const list of traitsByParent.values()) list.sort((a, b) => a.order - b.order);

  const features: Entity[] = [];
  const species = readFixture('Species').map((speciesRec): Entity => {
    const speciesPk = pkStr(speciesRec.pk);
    const slug = pkSlug(speciesPk);
    const name = fieldStr(speciesRec.fields, 'name', speciesPk);
    const traits = traitsByParent.get(speciesPk) ?? [];
    if (traits.length === 0) {
      throw new Error(`species: "${speciesPk}" has no non-structural SpeciesTrait features`);
    }
    const grants = traits.map(({ rec }): { feature: string } => {
      const traitPk = pkStr(rec.pk);
      const id = featureId(pkSlug(traitPk));
      features.push({
        type: 'feature',
        ...baseEntity(id, fieldStr(rec.fields, 'name', traitPk), fieldStr(rec.fields, 'desc', traitPk)),
      });
      return { feature: id };
    });
    return {
      type: 'species',
      ...baseEntity(speciesId(slug), name, fieldStr(speciesRec.fields, 'desc', speciesPk)),
      size: PLACEHOLDER_SIZE,
      speed: PLACEHOLDER_SPEED,
      creatureType: PLACEHOLDER_CREATURE_TYPE,
      grants,
    };
  });

  return { species, features };
}
