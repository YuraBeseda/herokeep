import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Entity, type Pack, formatIssues, parsePack } from '@hk/protocol';
import { loadOverlays } from './overlays/load.ts';
import { applyOverlays } from './overlays/merge.ts';
import { languageEntities } from './static/languages.ts';
import { packManifest } from './static/attribution.ts';
import { systemEntity } from './static/system.ts';
import { transformBackgrounds } from './transform/backgrounds.ts';
import { transformClasses } from './transform/classes.ts';
import { transformFeats } from './transform/feats.ts';
import {
  transformAbilities,
  transformConditions,
  transformDamageTypes,
  transformRules,
  transformSkills,
} from './transform/glossary.ts';
import { transformItems } from './transform/items.ts';
import { transformSpecies } from './transform/species.ts';
import { transformSpells } from './transform/spells.ts';
import { PACK_ID, PACK_VERSION } from './version.ts';

/**
 * Every entity of the pack, in composition order: system, languages, glossary, spells, items,
 * species (+ their traits), backgrounds, feats, classes (+ subclasses and class features). Overlays
 * are not applied here — see `buildPack`.
 */
function composeEntities(): Entity[] {
  const species = transformSpecies();
  const classes = transformClasses();
  return [
    systemEntity(),
    ...languageEntities(),
    ...transformAbilities(),
    ...transformSkills(),
    ...transformConditions(),
    ...transformDamageTypes(),
    ...transformRules(),
    ...transformSpells(),
    ...transformItems(),
    ...species.species,
    ...species.features,
    ...transformBackgrounds(),
    ...transformFeats(),
    ...classes.classes,
    ...classes.subclasses,
    ...classes.features,
  ];
}

/**
 * Builds the complete `srd-5e-2024@0.1.0` core pack: composes every transform's entities, applies
 * the six overlay files in their binding order (corrections → system-choices → species →
 * fighting-styles → fighter → wizard) over the full entity array, sorts entities by id, and parses
 * the result through `parsePack`. Deterministic: the same inputs always produce byte-identical
 * output. Throws if the composed object is not a valid `Pack`.
 */
export function buildPack(): Pack {
  const overlays = loadOverlays();
  let entities = composeEntities();
  for (const layer of [
    overlays.corrections,
    overlays.systemChoices,
    overlays.species,
    overlays.fightingStyles,
    overlays.fighter,
    overlays.wizard,
  ]) {
    entities = applyOverlays(entities, layer);
  }
  entities.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const parsed = parsePack({ ...packManifest(), entities });
  if (!parsed.ok) {
    throw new Error(`buildPack: composed pack is invalid:\n${formatIssues(parsed.issues).join('\n')}`);
  }
  return parsed.pack;
}

/**
 * Writes `pack` (by default a freshly built one) to `<outDir>/srd-5e-2024/0.1.0/pack.json` as
 * 2-space JSON plus a trailing newline, creating parent directories as needed, and returns the
 * written path.
 */
export function writePack(outDir: string, pack: Pack = buildPack()): string {
  const path = join(outDir, PACK_ID, PACK_VERSION, 'pack.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  return path;
}
