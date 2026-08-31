# Phase 1a (plan 2 of 3) — SRD 5.2.1 Content Import (`@hk/content`) + R23 Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `srd-5e-2024` core pack — the entire SRD 5.2.1 as data in our pack vocabulary, generated from a vendored open5e snapshot plus hand-authored system data, corrections and mechanical overlays — validated by the engine and pinned by golden tests; and close the three R23 hardening gaps in the engine (entity-level formula validation, predicate depth cap, translation-pack field-level merge).

**Architecture:** `packages/content` is a build-time package: `upstream/` holds a pinned open5e fixture snapshot (CC-BY-4.0 data, never fetched at build/test time); `src/transform/*` converts each fixture family into our entities; `src/static/*` holds hand-authored data open5e lacks (the system entity, languages, attribution); `src/overlays/*` holds corrections (upstream errors, each citing the SRD) and mechanical enrichment (effects/choices for the Fighter/Champion and Wizard/Evoker 1–5 path); `src/build.ts` composes everything into a `Pack`, which `@hk/engine`'s `validatePack` must pass with zero diagnostics. Tests pin counts and hand-checked SRD facts (spot goldens), so upstream data-quality issues surface as test failures, not silent corruption.

**Tech Stack:** The plan-1 toolchain unchanged (Node 24, pnpm 11, TS ~6.0.3, Vitest 4); `@hk/protocol` + `@hk/engine` as workspace deps. No new runtime dependencies.

**Spec:** `docs/03-roadmap/phase-1-solo-builder.md` § 1a deliverable 4 (and the sample-RU-pack data half of deliverable 8), implementing `docs/02-architecture/04-content-packs.md`; hardening scope from the plan-1 final review (ruling R23 in the plan-1 execution record): entity-level formula validation, predicate nesting-depth cap, translation-pack field-level merge. Reference facts: `docs/04-reference/srd-content-and-licensing.md` (counts, license, attribution text) and `docs/04-reference/legal-attribution.md`.

## Global Constraints

- Pack identity: `id: "srd-5e-2024"`, `version: "0.1.0"`, `format: 1`, `kind: "core"`, `system: "5e-2024"`, `locale: "en"`, `license: "CC-BY-4.0"`; every entity id is `srd-5e-2024:<type>/<slug>` with slugs `^[a-z0-9][a-z0-9-]*$`.
- **Attribution (verbatim, non-negotiable)** — the pack's `attribution` field is exactly: `This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.`
- Upstream: open5e-api fixtures, repo `open5e/open5e-api`, commit `4b314adb19b52ae6caf705f6620311d90ed10a74`, directory `data/v2/wizards-of-the-coast/srd-2024/` — vendored into the repo once (Task 1); **no network access at build or test time**; the `Creature*`, `Service*`, `AlignmentDescription`, `CreatureTypeDescription`, `CrossReference`, `Document`, `ItemCategory` fixtures are out of scope (no monsters in v1).
- Pinned upstream counts (verified 2026-08-30 against that commit): Spell 339, CharacterClass 24 (12 classes + 12 subclasses via `subclass_of`), ClassFeature 352, ClassFeatureItem 1811, Species 9, SpeciesTrait 51, Background 4, BackgroundBenefit 20, Feat 17, FeatBenefit 35, Weapon 38, WeaponProperty 17, WeaponPropertyAssignment 108, Armor 13, Item 203, ConditionDescription 15, SkillDescription 18, AbilityDescription 6, DamageTypeDescription 13, Rule 56, RuleSet 11. Fixture record shape is Django-style: `{ model, pk, fields }`, pks prefixed `srd-2024_`.
- **Upstream is not trusted on facts.** Where open5e contradicts the SRD 5.2.1 text, a correction overlay entry fixes our output and cites the SRD (known example: CharacterClass fighter `saving_throws` is `["dex","str"]` upstream; SRD 5.2.1 Fighter saves are STR and CON). Spot-golden tests pin SRD truth.
- The generated pack is **not committed**; `pnpm --filter @hk/content build` writes `packages/content/dist/packs/srd-5e-2024/0.1.0/pack.json`; tests build in-process. Build output is deterministic: entities sorted by id, stable JSON key order from our schemas.
- The built pack must pass `validatePack(pack, [])` with **zero diagnostics** (warnings included) and stay within `PACK_LIMITS` (≤ 5 MB, ≤ 5,000 entities). If the size cap is exceeded, stop and escalate — do not trim SRD text silently.
- R23 hardening values: formula sites at entity level are `feature.uses.count`, `item.charges.max`, class-row `extra` string values, plus every predicate `formula` reachable through entity/choice `prerequisites` and grant `when` (effects were already covered); predicate depth cap = 16 nesting levels, `all`/`any` arrays ≤ 32 entries (codes `predicate.tooDeep`, `predicate.tooWide`); translation-pack merge is per-field within a key (later pack overrides only the fields it provides).
- Toolchain rules from plan 1 (unchanged): TS ~6.0.3 with `erasableSyntaxOnly` (no parameter properties/enums), `.ts` relative import extensions, cross-package imports by name, no ESLint suppressions, engine determinism rules, Prettier 120/single/trailing, Conventional Commits with scope, TDD (failing test first), every task ends with a commit. Repo conventions in `CLAUDE.md`.

## File structure (what this plan creates)

```
packages/content/
  package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts
  upstream/open5e-srd-2024/
    SOURCE.md                 provenance: repo, commit, date, license, file list, counts
    *.json                    27 vendored fixture files (creatures/services etc. excluded)
  src/
    version.ts                PACK_ID, PACK_VERSION, SYSTEM_ID constants
    upstream.ts               readFixture(name) → FixtureRecord[]; pk → slug helpers
    ids.ts                    entity-id builders (spellId(slug), itemId(slug), …)
    static/system.ts          the 5e-2024 system entity (hand-authored, verbatim below)
    static/languages.ts       language entities (hand-authored; open5e has none)
    static/attribution.ts     attribution + pack manifest fields
    transform/glossary.ts     abilities, skills, conditions, damage types, rules
    transform/spells.ts       Spell → spell entities
    transform/items.ts        Weapon+WeaponPropertyAssignment+Armor+Item+MagicItem → item entities
    transform/species.ts      Species+SpeciesTrait → species + feature entities
    transform/backgrounds.ts  Background+BackgroundBenefit → background entities
    transform/feats.ts        Feat+FeatBenefit → feat entities
    transform/classes.ts      CharacterClass+ClassFeature+ClassFeatureItem → class/subclass/feature entities
    overlays/merge.ts         applyOverlays(entities, overlays): replace/deep-merge by id + unmatched-overlay error
    overlays/corrections.json upstream-vs-SRD fixes, each with a "cite" note
    overlays/system-choices.json   creation choices (species/background/class/ability-scores)
    overlays/species.json     size/speed + mechanical effects (darkvision …)
    overlays/backgrounds.json structured abilityScores/originFeat/skillProficiencies per background
    overlays/fighting-styles.json  tags + effects for the 4 fighting-style feats
    overlays/fighter.json     Fighter + Champion levels 1–5 mechanics
    overlays/wizard.json      Wizard + Evoker levels 1–5 mechanics
    icons/icons-map.json      entity/category → gi:<slug> mapping
    build.ts                  buildPack(): Pack (compose + sort + manifest)
    cli.ts                    node src/cli.ts [--out dir] → writes + validates the pack
  test/
    upstream.test.ts  glossary.test.ts  spells.test.ts  items.test.ts
    species-backgrounds-feats.test.ts  classes.test.ts  overlays.test.ts
    build.test.ts  icons.test.ts  ru-sample.test.ts
  translations/srd-5e-2024-ru-sample.json
packages/engine/src/content/entity-formulas.ts     (R23a) collectEntityFormulas
packages/engine/src/predicate/depth.ts             (R23b) checkPredicateShape
packages/engine/src/{content/validate.ts,effects/validate.ts,i18n/localizer.ts}  (R23 wiring)
```

Transform-task ground rule: upstream field access is written against the **vendored files** (shapes documented in `SOURCE.md` by Task 1 and in the counts above); each transform task specifies its exact output contract and verbatim tests — if a field's real content differs from the task's stated assumption, the golden test fails and the fix is a corrections-overlay entry or a documented transform adjustment, never a weakened test.

---

### Task 1: Package skeleton, vendored upstream snapshot, fixture loader

**Files:**
- Create: `packages/content/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `upstream/open5e-srd-2024/SOURCE.md` + 27 vendored `*.json` files, `src/version.ts`, `src/upstream.ts`, `src/ids.ts`
- Modify: root `tsconfig.json` (add reference)
- Test: `packages/content/test/upstream.test.ts`

**Interfaces:**
- Produces: `PACK_ID = 'srd-5e-2024'`, `PACK_VERSION = '0.1.0'`, `SYSTEM_ID = '5e-2024'` (version.ts); `FixtureRecord = { model: string; pk: string | number; fields: Record<string, unknown> }`, `readFixture(name: string): FixtureRecord[]` (reads `upstream/open5e-srd-2024/<name>.json`, cached per name), `pkSlug(pk: string): string` (strips the `srd-2024_` prefix; validates against `SLUG_RE` after replacing `_` → `-`), (upstream.ts); id builders `entityId(type: EntityType, slug: string): string` plus typed shorthands `spellId`, `itemId`, `featureId`, `classId`, `subclassId`, `speciesId`, `backgroundId`, `featId`, `conditionId`, `skillId`, `abilityId`, `languageId`, `ruleId` (ids.ts, all `entityId` partial applications).

- [ ] **Step 1: Package skeleton** — copy the `@hk/pack-tools` config shapes exactly (package.json with `"@hk/protocol": "workspace:*"`, `"@hk/engine": "workspace:*"`, scripts `typecheck`/`build`/`test` plus `"build:pack": "node src/cli.ts"`; tsconfig.json with `paths` to both sibling sources and their `src` dirs in `include`; tsconfig.build.json with references; vitest.config.ts with both aliases and `test.name: 'content'`). Name: `@hk/content`. Add `{ "path": "packages/content/tsconfig.build.json" }` to the root tsconfig references. Run `pnpm install`.

- [ ] **Step 2: Vendor the snapshot** — download each needed fixture from `https://raw.githubusercontent.com/open5e/open5e-api/4b314adb19b52ae6caf705f6620311d90ed10a74/data/v2/wizards-of-the-coast/srd-2024/<File>.json` into `upstream/open5e-srd-2024/`. Files (27): AbilityDescription, Armor, Background, BackgroundBenefit, CharacterClass, ClassFeature, ClassFeatureItem, ConditionDescription, DamageTypeDescription, Feat, FeatBenefit, Item, MagicItem, Rule, RuleSet, SkillDescription, Species, SpeciesTrait, Spell, SpellCastingOption, Weapon, WeaponProperty, WeaponPropertyAssignment. (That is 23 — also vendor Document.json for the license record, and skip nothing else; final count in SOURCE.md is authoritative.) Write `SOURCE.md`: repo URL, commit `4b314adb19b52ae6caf705f6620311d90ed10a74`, retrieval date, CC-BY-4.0 data license note, the open5e project credit line from `docs/04-reference/legal-attribution.md`, a table of file → record count → the record's `fields` keys (generate it with a small throwaway script; paste the output). These are the only network operations in the whole plan; everything after reads the vendored files.

- [ ] **Step 3: Write the failing test**

```ts
// packages/content/test/upstream.test.ts
import { describe, expect, it } from 'vitest';
import { pkSlug, readFixture } from '../src/upstream.ts';
import { classId, spellId } from '../src/ids.ts';

const COUNTS: Record<string, number> = {
  Spell: 339, CharacterClass: 24, ClassFeature: 352, ClassFeatureItem: 1811,
  Species: 9, SpeciesTrait: 51, Background: 4, BackgroundBenefit: 20,
  Feat: 17, FeatBenefit: 35, Weapon: 38, WeaponProperty: 17, WeaponPropertyAssignment: 108,
  Armor: 13, Item: 203, ConditionDescription: 15, SkillDescription: 18,
  AbilityDescription: 6, DamageTypeDescription: 13, Rule: 56, RuleSet: 11,
};

describe('vendored upstream snapshot', () => {
  it('has the pinned record counts', () => {
    for (const [name, n] of Object.entries(COUNTS)) expect(readFixture(name), name).toHaveLength(n);
  });
  it('every record is {model, pk, fields} with an srd-2024 pk where prefixed', () => {
    for (const name of Object.keys(COUNTS)) {
      for (const r of readFixture(name)) {
        expect(typeof r.model).toBe('string');
        expect(r.fields).toBeTypeOf('object');
      }
    }
  });
  it('pkSlug strips the prefix and normalizes to slug charset', () => {
    expect(pkSlug('srd-2024_acid-arrow')).toBe('acid-arrow');
    expect(pkSlug('srd-2024_alert_1_initative-proficiency')).toBe('alert-1-initative-proficiency');
    expect(() => pkSlug('srd-2024_Bad Slug!')).toThrow();
  });
  it('id builders compose namespaced ids', () => {
    expect(spellId('fireball')).toBe('srd-5e-2024:spell/fireball');
    expect(classId('fighter')).toBe('srd-5e-2024:class/fighter');
  });
});
```

- [ ] **Step 4: Run to verify failure**, then implement `version.ts`, `upstream.ts` (JSON read + in-memory cache; `pkSlug` = strip leading `srd-2024_`, lowercase, `_` → `-`, then assert `SLUG_RE` from `@hk/protocol`), `ids.ts` (thin wrappers over `makeEntityId(PACK_ID, type, slug)` — import `makeEntityId` from `@hk/protocol`).

- [ ] **Step 5: Run `pnpm vitest run --project content`, `pnpm typecheck`, `pnpm lint`, `pnpm format:fix`** until clean. Confirm the vendored directory is committed (it is NOT in `.gitignore`; `.prettierignore` gains the line `packages/content/upstream/`).

- [ ] **Step 6: Commit** — `git add packages/content tsconfig.json pnpm-lock.yaml .prettierignore && git commit -m "feat(content): package skeleton and vendored open5e srd-2024 snapshot"`

### Task 2: R23a — entity-level formula validation (`@hk/engine`)

**Files:**
- Create: `packages/engine/src/content/entity-formulas.ts`
- Modify: `packages/engine/src/content/validate.ts` (wire into `validatePack`), `packages/engine/src/index.ts`
- Test: `packages/engine/test/content/entity-formulas.test.ts`

**Interfaces:**
- Consumes: `FormulaSite` and `validateFormula` (engine, Tasks 12/14 of plan 1), `collectPredicateFormulas` (predicate/evaluate.ts), `Entity`, `Choice` (`@hk/protocol`).
- Produces: `collectEntityFormulas(entity: Entity): FormulaSite[]` — every formula site an entity carries OUTSIDE its `effects` array (effects are already covered by `collectEffectFormulas`): `feature.uses.count` (`allowComparison: false`), `item.charges.max` (false), class/subclass `levels[i].extra.<key>` string values (false), predicate formulas in entity `prerequisites[]`, `grants[].when`, and choice `prerequisites[]` — including choices inside class/subclass level rows — (`allowComparison: true`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/test/content/entity-formulas.test.ts
import type { Entity } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { collectEntityFormulas } from '../../src/content/entity-formulas.ts';
import { validatePack } from '../../src/content/validate.ts';
import { loadFixturePack } from '../support/fixtures.ts';

describe('collectEntityFormulas', () => {
  it('collects uses.count, charges.max, row extra values, and prerequisite/when predicate formulas', () => {
    const feature = {
      id: 'x-pack:feature/f', type: 'feature', name: 'F', tags: [], prerequisites: [{ formula: 'level >= 2' }],
      effects: [], grants: [{ feature: 'x-pack:feature/g', when: { formula: 'prof >= 3' } }], choices: [],
      uses: { count: 'prof', per: 'longRest' },
    } as unknown as Entity;
    expect(collectEntityFormulas(feature)).toEqual([
      { path: 'prerequisites.0.formula', src: 'level >= 2', allowComparison: true },
      { path: 'grants.0.when.formula', src: 'prof >= 3', allowComparison: true },
      { path: 'uses.count', src: 'prof', allowComparison: false },
    ]);

    const item = {
      id: 'x-pack:item/i', type: 'item', name: 'I', tags: [], prerequisites: [], effects: [], grants: [], choices: [],
      category: 'magic', charges: { max: 'classLevel(wizard)', reset: 'dawn' },
    } as unknown as Entity;
    expect(collectEntityFormulas(item)).toEqual([{ path: 'charges.max', src: 'classLevel(wizard)', allowComparison: false }]);

    const cls = {
      id: 'x-pack:class/c', type: 'class', name: 'C', tags: [], prerequisites: [], effects: [], grants: [], choices: [],
      hitDie: 8, primaryAbility: ['int'], saves: ['int'], armorTraining: [], weaponProficiencies: [], toolProficiencies: [],
      skillChoice: { from: ['arcana'], count: 1 }, subclassLevel: 3,
      levels: [{ level: 1, grants: [], choices: [{ id: 'x-pack:class/c@1/pick', prompt: 'P', at: { kind: 'classLevel', class: 'c', level: 1 }, pick: { literal: 'text' }, count: 1, unique: true, repeatableAt: [], prerequisites: [{ formula: 'mod(int) >= 1' }] }], extra: { sneak: 'ceil(classLevel(c) / 2)', flat: 3 } }],
    } as unknown as Entity;
    expect(collectEntityFormulas(cls)).toEqual([
      { path: 'levels.0.choices.0.prerequisites.0.formula', src: 'mod(int) >= 1', allowComparison: true },
      { path: 'levels.0.extra.sneak', src: 'ceil(classLevel(c) / 2)', allowComparison: false },
    ]);
  });
});

describe('validatePack wires entity formulas', () => {
  it('reports a syntax error in feature.uses.count with the entity path', () => {
    const pack = loadFixturePack('core-mini');
    const sw = pack.entities.find((e) => e.id === 'core-mini:feature/second-wind');
    if (!sw || sw.type !== 'feature') throw new Error('fixture drift');
    (sw as { uses?: { count: string; per: string } }).uses = { count: 'prof +', per: 'shortRest' };
    const d = validatePack(pack, []);
    expect(d.map((x) => [x.code, x.path])).toEqual([['formula.syntax', expect.stringMatching(/^entities\.\d+\.uses\.count$/)]]);
    expect(d[0]?.entityId).toBe('core-mini:feature/second-wind');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run --project engine` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/engine/src/content/entity-formulas.ts
import type { Choice, Entity } from '@hk/protocol';
import type { FormulaSite } from '../effects/validate.ts';
import { collectPredicateFormulas } from '../predicate/evaluate.ts';

const pred = (sites: FormulaSite[], p: Parameters<typeof collectPredicateFormulas>[0], path: string): void => {
  for (const f of collectPredicateFormulas(p, path)) sites.push({ ...f, allowComparison: true });
};

const choiceSites = (sites: FormulaSite[], c: Choice, path: string): void => {
  c.prerequisites.forEach((p, i) => pred(sites, p, `${path}.prerequisites.${i}`));
};

export function collectEntityFormulas(e: Entity): FormulaSite[] {
  const sites: FormulaSite[] = [];
  e.prerequisites.forEach((p, i) => pred(sites, p, `prerequisites.${i}`));
  e.grants.forEach((g, i) => {
    if (g.when) pred(sites, g.when, `grants.${i}.when`);
  });
  e.choices.forEach((c, i) => choiceSites(sites, c, `choices.${i}`));
  if (e.type === 'feature' && e.uses) sites.push({ path: 'uses.count', src: e.uses.count, allowComparison: false });
  if (e.type === 'item' && e.charges) sites.push({ path: 'charges.max', src: e.charges.max, allowComparison: false });
  if (e.type === 'class' || e.type === 'subclass') {
    e.levels.forEach((row, r) => {
      row.choices.forEach((c, i) => choiceSites(sites, c, `levels.${r}.choices.${i}`));
      for (const [key, value] of Object.entries(row.extra ?? {})) {
        if (typeof value === 'string') sites.push({ path: `levels.${r}.extra.${key}`, src: value, allowComparison: false });
      }
    });
  }
  return sites;
}
```

Wire into `validatePack` (in `packages/engine/src/content/validate.ts`, inside the per-entity loop, next to the existing `validateEffects` call):

```ts
for (const s of collectEntityFormulas(e)) {
  out.push(...validateFormula(s.src, { allowComparison: s.allowComparison, path: `${base}.${s.path}`, entityId: e.id }));
}
```

(import `collectEntityFormulas` from `./entity-formulas.ts` and `validateFormula` from `../formula/validate.ts`). Add `export * from './content/entity-formulas.ts';` to the engine barrel. Note: the ordering of sites in the first test matches the collection order above (entity prerequisites → grants → top-level choices → type-specific) — keep that order.

- [ ] **Step 4: Run tests, typecheck, lint, format** — the full engine project must stay green (the core-mini fixture has no entity-level formulas today, so `validatePack` fixtures remain clean).

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "feat(engine): validate entity-level formula sites (R23a)"`

---

### Task 3: R23b — predicate depth and width caps (`@hk/engine`)

**Files:**
- Create: `packages/engine/src/predicate/depth.ts`
- Modify: `packages/engine/src/content/validate.ts`, `packages/engine/src/effects/validate.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/test/predicate/depth.test.ts`

**Interfaces:**
- Produces: `PREDICATE_MAX_DEPTH = 16`, `PREDICATE_MAX_WIDTH = 32`, `checkPredicateShape(p: Predicate, path: string, entityId?: string): Diagnostic[]` — walks `all`/`any`/`not`; nesting deeper than 16 → error `predicate.tooDeep` (one diagnostic at the first offending node, no descent past it); an `all`/`any` array longer than 32 → error `predicate.tooWide`.
- Wiring: `validateEffect` additionally runs `checkPredicateShape(effect.when, `${path}.when`, entityId)` when `when` is present; `validatePack`'s per-entity loop runs it over the same predicate sites Task 2 walks (entity `prerequisites`, `grants[].when`, choice `prerequisites` incl. level rows) — implement a shared `collectEntityPredicates(e): { path: string; p: Predicate }[]` in `entity-formulas.ts` and reuse it from `collectEntityFormulas` so the two walkers cannot drift.

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/test/predicate/depth.test.ts
import type { Predicate } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { PREDICATE_MAX_DEPTH, checkPredicateShape } from '../../src/predicate/depth.ts';
import { validateEffects } from '../../src/effects/validate.ts';

const nest = (depth: number): Predicate => {
  let p: Predicate = { tag: 'leaf' };
  for (let i = 0; i < depth; i++) p = { not: p };
  return p;
};

describe('checkPredicateShape', () => {
  it('accepts nesting up to the cap and flags beyond it', () => {
    expect(checkPredicateShape(nest(PREDICATE_MAX_DEPTH), 'when')).toEqual([]);
    const d = checkPredicateShape(nest(PREDICATE_MAX_DEPTH + 1), 'when', 'x:feat/y');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'error', code: 'predicate.tooDeep', entityId: 'x:feat/y' });
  });
  it('flags all/any wider than 32', () => {
    const wide: Predicate = { any: Array.from({ length: 33 }, () => ({ tag: 't' })) };
    expect(checkPredicateShape(wide, 'when')[0]?.code).toBe('predicate.tooWide');
    expect(checkPredicateShape({ any: Array.from({ length: 32 }, () => ({ tag: 't' })) }, 'when')).toEqual([]);
  });
  it('is wired into effect validation via when', () => {
    const d = validateEffects([{ type: 'ac.bonus', value: 1, when: nest(20) }], 'effects', 'x:feat/y');
    expect(d.map((x) => x.code)).toContain('predicate.tooDeep');
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```ts
// packages/engine/src/predicate/depth.ts
import type { Predicate } from '@hk/protocol';
import { type Diagnostic, error } from '../diagnostics.ts';

export const PREDICATE_MAX_DEPTH = 16;
export const PREDICATE_MAX_WIDTH = 32;

export function checkPredicateShape(p: Predicate, path: string, entityId?: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const extra = entityId !== undefined ? { entityId } : {};
  const walk = (node: Predicate, nodePath: string, depth: number): void => {
    if (depth > PREDICATE_MAX_DEPTH) {
      out.push(error('predicate.tooDeep', `Predicate nesting exceeds ${PREDICATE_MAX_DEPTH}`, { path: nodePath, ...extra }));
      return;
    }
    if ('all' in node || 'any' in node) {
      const key = 'all' in node ? 'all' : 'any';
      const arr = ('all' in node ? node.all : (node as { any: Predicate[] }).any);
      if (arr.length > PREDICATE_MAX_WIDTH) {
        out.push(error('predicate.tooWide', `Predicate ${key} has ${arr.length} entries; limit is ${PREDICATE_MAX_WIDTH}`, { path: `${nodePath}.${key}`, ...extra }));
      }
      arr.forEach((q, i) => walk(q, `${nodePath}.${key}.${i}`, depth + 1));
    } else if ('not' in node) {
      walk(node.not, `${nodePath}.not`, depth + 1);
    }
  };
  walk(p, path, 1);
  return out;
}
```

Wiring: in `effects/validate.ts`'s `validateEffect`, after the schema parse succeeds and before returning the formula diagnostics, prepend `...(parsed.data.when ? checkPredicateShape(parsed.data.when, `${path}.when`, entityId) : [])`. In `content/validate.ts`, refactor Task 2's walker: `entity-formulas.ts` gains `export function collectEntityPredicates(e: Entity): { path: string; p: Predicate }[]` (same traversal as the predicate half of `collectEntityFormulas`, which now delegates to it), and `validatePack`'s loop adds `for (const s of collectEntityPredicates(e)) out.push(...checkPredicateShape(s.p, `${base}.${s.path}`, e.id));`. Barrel-export `predicate/depth.ts`.

- [ ] **Step 4: Run tests, typecheck, lint, format** — full engine green (fixtures are shallow).

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "feat(engine): cap predicate nesting depth and width (R23b)"`

---

### Task 4: R23c — translation-pack field-level merge (`@hk/engine`)

**Files:**
- Modify: `packages/engine/src/i18n/localizer.ts`
- Test: `packages/engine/test/i18n/localizer-merge.test.ts`

**Interfaces:**
- Consumes/keeps: everything `createLocalizer` already exposes — no API change.
- Behavior change: when several translation packs target the same pack and locale, later packs (dependency order) override **per field**, not per key: `merged[key] = { ...earlier[key], ...later[key] }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/test/i18n/localizer-merge.test.ts
import type { Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { createLocalizer } from '../../src/i18n/localizer.ts';
import { loadFixturePack } from '../support/fixtures.ts';

describe('translation packs merge per field', () => {
  it('a later pack overriding one field keeps the earlier pack\'s other fields', () => {
    const core = loadFixturePack('core-mini');
    const ru = loadFixturePack('translation-mini'); // has spell/fireball {name, description}
    const patch: Pack = {
      ...ru,
      id: 'core-mini-ru-patch',
      version: '1.0.0',
      dependencies: [{ id: 'core-mini-ru', range: '^1' }],
      strings: { 'spell/fireball': { name: 'Огненный шар (испр.)' } },
    };
    const index = createContentIndex([core, ru, patch]);
    const loc = createLocalizer(index, 'ru');
    expect(loc.text('core-mini:spell/fireball', 'name').text).toBe('Огненный шар (испр.)');
    // the description from the EARLIER pack must survive:
    expect(loc.text('core-mini:spell/fireball', 'description')).toEqual({ text: 'Яркая вспышка.', locale: 'ru', isFallback: false });
  });
});
```

- [ ] **Step 2: Run to verify failure** — the description assertion fails under the current key-level merge (`isFallback: true`, English text).

- [ ] **Step 3: Implement** — in `createLocalizer`'s translation-pack loop, replace the key-level spread with a field-level merge:

```ts
const existing = byLocale.get(t.locale) ?? {};
const merged: Strings = { ...existing };
for (const [key, fields] of Object.entries(t.strings)) merged[key] = { ...(existing[key] ?? {}), ...fields };
byLocale.set(t.locale, merged);
```

- [ ] **Step 4: Run tests, typecheck, lint, format** — all prior localizer tests must still pass (single-pack behavior is unchanged).

- [ ] **Step 5: Commit** — `git add packages/engine && git commit -m "fix(engine): merge translation packs per field, not per key (R23c)"`

### Task 5: Static data — the 5e-2024 system entity, languages, attribution (`@hk/content`)

**Files:**
- Create: `packages/content/src/static/system.ts`, `src/static/languages.ts`, `src/static/attribution.ts`
- Test: `packages/content/test/static.test.ts`

**Interfaces:**
- Produces: `systemEntity(): Entity` (the complete `srd-5e-2024:system/5e-2024` entity, WITHOUT creation choices — those are overlaid in Task 11), `languageEntities(): Entity[]`, `ATTRIBUTION` (the verbatim string from Global Constraints), `packManifest()` → `{ format: 1, id, version, kind: 'core', system, name, description, authors, license, attribution, locale: 'en' }`.
- The system data below is hand-checked against the SRD 5.2.1 and is normative — transcribe it verbatim.

- [ ] **Step 1: Write the failing test**

```ts
// packages/content/test/static.test.ts
import { SystemEntitySchema, parseEntityId } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION, packManifest } from '../src/static/attribution.ts';
import { languageEntities } from '../src/static/languages.ts';
import { systemEntity } from '../src/static/system.ts';

describe('system entity', () => {
  const sys = systemEntity();
  it('validates and carries the 2024 shape', () => {
    const r = SystemEntitySchema.safeParse(sys);
    expect(r.success, JSON.stringify(r.success ? '' : r.error.issues)).toBe(true);
    if (sys.type !== 'system') throw new Error();
    expect(sys.abilities.map((a) => a.id)).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
    expect(sys.skills).toHaveLength(18);
    expect(sys.skills.find((s) => s.id === 'sleight-of-hand')?.ability).toBe('dex');
    expect(sys.compositionSlots.map((s) => s.id)).toEqual(['species', 'background', 'class']);
    expect(sys.tables.xp).toHaveLength(20);
    expect(sys.tables.xp[4]).toBe(6500);
    expect(sys.tables.xp[19]).toBe(355000);
    expect(sys.tables.proficiency).toEqual([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6]);
    expect(sys.tables.spellSlots['full']).toHaveLength(20);
    expect(sys.tables.spellSlots['full']?.[0]).toEqual([2]);
    expect(sys.tables.spellSlots['full']?.[4]).toEqual([4, 3, 2]);
    expect(sys.tables.spellSlots['full']?.[19]).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
    expect(sys.abilityGeneration.standardArray).toEqual([15, 14, 13, 12, 10, 8]);
    expect(sys.abilityGeneration.pointBuy).toEqual({ budget: 27, min: 8, max: 15, costs: { '8': 0, '9': 1, '10': 2, '11': 3, '12': 4, '13': 5, '14': 7, '15': 9 } });
    expect(sys.attunementMax).toBe(3);
    expect(sys.conditions).toHaveLength(15);
  });
});

describe('languages and manifest', () => {
  it('ships the SRD language list as entities', () => {
    const langs = languageEntities();
    expect(langs.length).toBeGreaterThanOrEqual(16);
    for (const l of langs) expect(parseEntityId(l.id)?.type).toBe('language');
    expect(langs.map((l) => l.name)).toContain('Common');
    expect(langs.map((l) => l.name)).toContain('Draconic');
  });
  it('attribution is the exact SRD 5.2.1 statement', () => {
    expect(ATTRIBUTION.startsWith('This work includes material from the System Reference Document 5.2.1')).toBe(true);
    expect(ATTRIBUTION).toContain('https://www.dndbeyond.com/srd');
    expect(ATTRIBUTION).toContain('https://creativecommons.org/licenses/by/4.0/legalcode');
    expect(packManifest()).toMatchObject({ format: 1, id: 'srd-5e-2024', version: '0.1.0', kind: 'core', system: '5e-2024', license: 'CC-BY-4.0', locale: 'en' });
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement. Normative data for `system.ts` (the entity id is `srd-5e-2024:system/5e-2024`, `name: 'D&D 5e (2024 rules)'`):

- `abilities`: str/Strength, dex/Dexterity, con/Constitution, int/Intelligence, wis/Wisdom, cha/Charisma.
- `skills` (18, id → ability): acrobatics→dex, animal-handling→wis, arcana→int, athletics→str, deception→cha, history→int, insight→wis, intimidation→cha, investigation→int, medicine→wis, nature→int, perception→wis, performance→cha, persuasion→cha, religion→int, sleight-of-hand→dex, stealth→dex, survival→wis. Names in Title Case ("Sleight of Hand", "Animal Handling").
- `saves`: all six ability keys.
- `compositionSlots`: `[{ id: 'species', entityType: 'species', count: 1, at: 'creation' }, { id: 'background', entityType: 'background', count: 1, at: 'creation' }, { id: 'class', entityType: 'class', count: 'many', at: 'levelUp' }]`.
- `restTypes`: `['shortRest', 'longRest']`.
- `tables.xp` (index i = XP to BE level i+1): `[0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000]`.
- `tables.proficiency`: as in the test above.
- `tables.spellSlots.full` (rows = levels 1–20; columns = slots for spell levels 1..9):
  `[[2],[3],[4,2],[4,3],[4,3,2],[4,3,3],[4,3,3,1],[4,3,3,2],[4,3,3,3,1],[4,3,3,3,2],[4,3,3,3,2,1],[4,3,3,3,2,1],[4,3,3,3,2,1,1],[4,3,3,3,2,1,1],[4,3,3,3,2,1,1,1],[4,3,3,3,2,1,1,1],[4,3,3,3,2,1,1,1,1],[4,3,3,3,3,1,1,1,1],[4,3,3,3,3,2,1,1,1],[4,3,3,3,3,2,2,1,1]]`
  and `tables.spellSlots.none`: twenty empty arrays. (half/third/pact come in Phase 4.)
- `currencies`: cp/Copper (inCopper 1), sp/Silver (10), ep/Electrum (50), gp/Gold (100), pp/Platinum (1000).
- `damageTypes` (13 slugs): acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder.
- `sizes`: tiny, small, medium, large, huge, gargantuan.
- `conditions`: the 15 condition entity ids that Task 6's transform produces (blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious) as `srd-5e-2024:condition/<slug>`.
- `restRules`: `{ shortRest: { allowHitDice: true }, longRest: { hpToMax: true, restoreAllSlots: true, hitDiceRegainDivisor: 2, hitDiceRegainMin: 1, exhaustionReduce: 1 } }`.
- `hpRules`: `{ firstLevelMaxHitDie: true, averageRounding: 'up' }`.
- `attunementMax`: 3.
- `abilityGeneration`: `{ standardArray: [15,14,13,12,10,8], pointBuy: { budget: 27, min: 8, max: 15, costs: { '8':0,'9':1,'10':2,'11':3,'12':4,'13':5,'14':7,'15':9 } }, roll: '4d6kh3', manual: { min: 3, max: 18 } }`.
- `description`: one sentence ("The D&D 5e 2024 ruleset as defined by the SRD 5.2.1."); `choices: []` here (Task 11 overlays them).

`languages.ts` — language entities with names: Common, Common Sign Language, Draconic, Dwarvish, Elvish, Giant, Gnomish, Goblin, Halfling, Orc, Abyssal, Celestial, Deep Speech, Infernal, Primordial, Sylvan, Undercommon, Druidic, Thieves' Cant (slugs kebab-cased; Druidic and Thieves' Cant get `tags: ['secret']`). **Verify this list against the vendored `Rule.json` language rules / the SRD 5.2.1 Languages table and adjust to exactly what the SRD lists** — the test's floor (≥16, Common, Draconic) tolerates the correction; document any change in the report.

`attribution.ts` — `ATTRIBUTION` exactly as in Global Constraints; `packManifest()` also sets `name: 'SRD 5.2.1 (2024 rules)'`, `description`, `authors: ['Wizards of the Coast (SRD 5.2.1)', 'Herokeep contributors']`.

- [ ] **Step 3: Run tests, typecheck, lint, format** until clean.

- [ ] **Step 4: Commit** — `git add packages/content && git commit -m "feat(content): 5e-2024 system entity, languages, attribution"`

---

### Task 6: Glossary transforms — abilities, skills, conditions, damage types, rules (`@hk/content`)

**Files:**
- Create: `packages/content/src/transform/glossary.ts`
- Test: `packages/content/test/glossary.test.ts`

**Interfaces:**
- Consumes: `readFixture`, `pkSlug`, id builders (Task 1); `Entity` (`@hk/protocol`).
- Produces: `transformAbilities(): Entity[]` (6 `ability` entities; `abbreviation` = the 3-letter pk slug, e.g. `cha`; slug = full lowercase name derived from the `name` field, e.g. `charisma`), `transformSkills(): Entity[]` (18 `skill` entities; `ability` from the fixture's `describes`/pk mapping), `transformConditions(): Entity[]` (15 `condition` entities; `exhaustion` gets `levels: 6`), `transformDamageTypes(): Entity[]` — damage types are represented in the system entity's `damageTypes` slugs; this transform emits them as `rule` entities named `Damage type: <Name>` carrying the SRD description (they are glossary text, not a schema entity type), `transformRules(): Entity[]` (56 `rule` entities from Rule.json; the RuleSet grouping goes into `tags: ['ruleset:<slug>']`).
- All transforms: `description` from the fixture's `desc`, trimmed; every entity gets `source: { book: 'SRD 5.2.1' }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/content/test/glossary.test.ts
import { EntitySchema } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { transformAbilities, transformConditions, transformDamageTypes, transformRules, transformSkills } from '../src/transform/glossary.ts';

const allValid = (entities: { id: string }[]) => {
  for (const e of entities) {
    const r = EntitySchema.safeParse(e);
    expect(r.success, e.id + ': ' + JSON.stringify(r.success ? '' : r.error.issues[0])).toBe(true);
  }
};

describe('glossary transforms', () => {
  it('abilities: 6, with 3-letter abbreviations', () => {
    const a = transformAbilities();
    expect(a).toHaveLength(6);
    allValid(a);
    const cha = a.find((e) => e.id === 'srd-5e-2024:ability/charisma');
    expect(cha).toBeDefined();
    expect((cha as { abbreviation?: string }).abbreviation).toBe('cha');
  });
  it('skills: 18, each mapped to an ability key', () => {
    const s = transformSkills();
    expect(s).toHaveLength(18);
    allValid(s);
    expect((s.find((e) => e.id === 'srd-5e-2024:skill/stealth') as { ability?: string })?.ability).toBe('dex');
    expect((s.find((e) => e.id === 'srd-5e-2024:skill/athletics') as { ability?: string })?.ability).toBe('str');
  });
  it('conditions: 15, exhaustion has 6 levels', () => {
    const c = transformConditions();
    expect(c).toHaveLength(15);
    allValid(c);
    expect((c.find((e) => e.id === 'srd-5e-2024:condition/exhaustion') as { levels?: number })?.levels).toBe(6);
    expect(c.map((e) => e.id)).toContain('srd-5e-2024:condition/prone');
  });
  it('damage types: 13 rule entities with descriptions', () => {
    const d = transformDamageTypes();
    expect(d).toHaveLength(13);
    allValid(d);
    expect(d.map((e) => e.name)).toContain('Damage type: Fire');
  });
  it('rules: 56, tagged by ruleset', () => {
    const r = transformRules();
    expect(r).toHaveLength(56);
    allValid(r);
    expect(r.every((e) => e.tags.some((t) => t.startsWith('ruleset:')))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `glossary.ts`. Input notes from the vendored shapes: `AbilityDescription` pks are `srd-2024_cha` style with `fields.desc` and `fields.describes` naming the ability; `SkillDescription` pks are `srd-2024_acrobatics` with `fields.describes` carrying the skill key — derive the ability mapping from the system entity's skill table in Task 5 (import `systemEntity()` and look the slug up there; the fixture's own ability linkage is via `describes` keys like `srd-2024_acrobatics` → verify and prefer the Task-5 table as truth). `ConditionDescription` pks are `srd-2024_blinded` style. `Rule.json` fields: `name`, `desc`, `ruleset`, `index`. Skill/ability/condition ids and names are Title-Cased from the slug where the fixture lacks a `name` field.

- [ ] **Step 3: Run tests, typecheck, lint, format** until clean.

- [ ] **Step 4: Commit** — `git add packages/content && git commit -m "feat(content): glossary transforms (abilities, skills, conditions, damage types, rules)"`

### Task 7: Spell transform (`@hk/content`)

**Files:**
- Create: `packages/content/src/transform/spells.ts`
- Test: `packages/content/test/spells.test.ts`

**Interfaces:**
- Consumes: `readFixture('Spell')` — fields (verified): `name, desc, level, school, higher_level, range, range_unit, range_text, ritual, casting_time, reaction_condition, verbal, somatic, material, material_specified, saving_throw_ability, attack_roll, damage_roll, damage_types, duration, concentration, classes`.
- Produces: `transformSpells(): Entity[]` — 339 `spell` entities. Mapping contract:
  - `level` → `level` (0–9); `school` → slug (`evocation` etc., lowercased).
  - `casting_time` upstream values like `action`/`bonus-action`/`reaction`/`1-minute` → our `castingTime {value, unit}` (`action|bonus|reaction|minute|hour`; parse leading integers, default 1); `reaction_condition` → `castingTime.condition`.
  - `range`+`range_unit` → our `range`: 0/self → `{kind:'self'}`, touch → `{kind:'touch'}`, feet → `{kind:'feet', distance}`, miles → `{kind:'miles', distance}`; anything unmappable → `{kind:'special'}` (count these; the test caps them).
  - `verbal/somatic/material` → `components {v,s,m}`; `material_specified` → `materialText`.
  - `duration` strings (`instantaneous`, `1 minute`, `10 minutes`, `1 hour`, `8 hours`, `24 hours`, `1 round`, `until dispelled`, …) → our `duration {kind, value?, unit?}`; unmappable → `{kind:'special'}`.
  - `concentration`/`ritual` → booleans; `classes` (array of class keys like `srd-2024_wizard`) → our `classes` as slugs (`wizard`).
  - `damage_roll` (dice string) + first of `damage_types` → `damage {dice, type}` when both present and the dice string matches our `DiceSchema`; `saving_throw_ability` → `save`; `attack_roll` truthy → `attack: 'melee' | 'ranged'` — upstream does not distinguish, so map any truthy value to `'ranged'` and add a corrections-overlay hook for the handful of melee spell attacks (documented in Task 11).
  - `desc` → `description`; `higher_level` → `higherLevels` when non-empty.

- [ ] **Step 1: Write the failing test**

```ts
// packages/content/test/spells.test.ts
import { EntitySchema } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { transformSpells } from '../src/transform/spells.ts';

describe('spell transform', () => {
  const spells = transformSpells();
  const byId = new Map(spells.map((s) => [s.id, s]));

  it('produces 339 schema-valid spells', () => {
    expect(spells).toHaveLength(339);
    for (const s of spells) {
      const r = EntitySchema.safeParse(s);
      expect(r.success, s.id + ': ' + JSON.stringify(r.success ? '' : r.error.issues[0])).toBe(true);
    }
  });

  it('spot golden: Fireball (hand-checked against SRD 5.2.1)', () => {
    const f = byId.get('srd-5e-2024:spell/fireball');
    expect(f).toMatchObject({
      type: 'spell', name: 'Fireball', level: 3, school: 'evocation',
      concentration: false, ritual: false,
      components: { v: true, s: true, m: true },
      range: { kind: 'feet', distance: 150 },
      damage: { dice: '8d6', type: 'fire' },
      save: 'dex',
    });
    expect((f as { classes?: string[] })?.classes).toContain('wizard');
    expect((f as { higherLevels?: string })?.higherLevels).toBeTruthy();
  });

  it('spot golden: Mage Armor and a cantrip', () => {
    expect(byId.get('srd-5e-2024:spell/mage-armor')).toMatchObject({ level: 1, range: { kind: 'touch' } });
    const cantrips = spells.filter((s) => (s as { level?: number }).level === 0);
    expect(cantrips.length).toBeGreaterThanOrEqual(30);
  });

  it('keeps special-cased ranges/durations rare', () => {
    const specialRange = spells.filter((s) => (s as { range?: { kind: string } }).range?.kind === 'special').length;
    const specialDuration = spells.filter((s) => (s as { duration?: { kind: string } }).duration?.kind === 'special').length;
    expect(specialRange, 'range special-cases').toBeLessThanOrEqual(30);
    expect(specialDuration, 'duration special-cases').toBeLessThanOrEqual(40);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `spells.ts` against the vendored data. Where an upstream value fails to map, prefer an explicit small lookup table over regex cleverness; every fall-through to `'special'` must be deliberate. If a spot-golden value disagrees with upstream (e.g. Fireball's range), the SRD is right: fix via the corrections overlay hook (export `transformSpells(corrections?)` is NOT needed — Task 11's overlay machinery patches after all transforms; just let the test fail until Task 11 if upstream is wrong, and note it in the report; if it blocks this task's gate, move that one assertion into `build.test.ts` in Task 13 and document why).

- [ ] **Step 3: Run tests, typecheck, lint, format** until clean.

- [ ] **Step 4: Commit** — `git add packages/content && git commit -m "feat(content): spell transform (339 spells) with SRD spot goldens"`

---

### Task 8: Item transform — weapons, armor, gear, magic items (`@hk/content`)

**Files:**
- Create: `packages/content/src/transform/items.ts`
- Test: `packages/content/test/items.test.ts`

**Interfaces:**
- Consumes: `readFixture` for `Item` (203; fields incl. `name, desc, cost, weight, category, weapon, armor`), `Weapon` (38; `damage_dice, damage_type, is_simple, range, long_range, distance_unit, is_improvised`), `WeaponProperty` (17; `name, type, desc`), `WeaponPropertyAssignment` (108; `weapon, property, detail`), `Armor` (13; `ac_base, ac_add_dexmod, ac_cap_dexmod, grants_stealth_disadvantage, strength_score_required`), `MagicItem` (open it in Task 1's SOURCE.md discovery; expect `name, desc, rarity, requires_attunement`-style fields — pin the exact count N_MAGIC in this task's test from the vendored file's length, then hard-code that literal).
- Produces: `transformItems(): Entity[]` — one `item` entity per mundane Item and per MagicItem. Mapping contract:
  - An Item whose `weapon` links a Weapon becomes `category: 'weapon'` with `weapon: { kind: melee|ranged (ranged iff the Weapon has a nonzero `range`... verify: thrown melee weapons also carry range — decide by the weapon's property set: `ammunition` or upstream range with no `thrown` → ranged; document the rule in code comments), category: is_simple ? 'simple' : 'martial', damage: damage_dice, damageType: damage_type slug, properties: [property slugs from assignments where WeaponProperty.type is a normal property], mastery: the assignment whose WeaponProperty.type marks it a mastery property (exactly one per weapon — assert), versatile: the `versatile` assignment's `detail` dice when present, range: {normal, long} when the weapon has distances }`.
  - An Item whose `armor` links an Armor becomes `category: 'armor'` (or `'shield'` when the name is Shield) with `armor: { category: light|medium|heavy — derive: ac_add_dexmod && no cap → light; cap 2 → medium; !ac_add_dexmod → heavy, ac: ac_base, dexCap: ac_cap_dexmod ?? omitted, strength: strength_score_required ?? omitted, stealthDisadvantage: grants_stealth_disadvantage }`; shields map to `shield: { ac: 2 }`.
  - Other Items → `category: 'gear'` (tools keep `category: 'tool'` when the name/desc marks them as tools — a small explicit name list is fine).
  - MagicItems → `category: 'magic'`, `rarity` mapped to our enum (`very rare` → `veryRare`), `attunement: { required: true }` when upstream requires it.
  - `cost` (upstream decimal string in gp) → `{ amount: <integer in the smallest fitting unit>, currency }`: whole gp → gp; tenths → sp; hundredths → cp. `weight` → number.
- Every entity: `description` from `desc`, `source: { book: 'SRD 5.2.1' }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/content/test/items.test.ts
import { EntitySchema } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { transformItems } from '../src/transform/items.ts';
import { readFixture } from '../src/upstream.ts';

describe('item transform', () => {
  const items = transformItems();
  const byId = new Map(items.map((i) => [i.id, i]));

  it('every item validates; mundane + magic counts add up', () => {
    for (const i of items) {
      const r = EntitySchema.safeParse(i);
      expect(r.success, i.id + ': ' + JSON.stringify(r.success ? '' : r.error.issues[0])).toBe(true);
    }
    const nMagic = readFixture('MagicItem').length; // then REPLACE this with the literal you observe and assert both
    expect(items).toHaveLength(203 + nMagic);
    expect(nMagic).toBeGreaterThanOrEqual(200);
  });

  it('spot golden: Longsword (SRD 5.2.1)', () => {
    expect(byId.get('srd-5e-2024:item/longsword')).toMatchObject({
      category: 'weapon',
      weapon: { kind: 'melee', category: 'martial', damage: '1d8', damageType: 'slashing', versatile: '1d10', mastery: 'sap' },
      cost: { amount: 15, currency: 'gp' },
    });
  });

  it('spot golden: Chain Mail and Shield (SRD 5.2.1)', () => {
    expect(byId.get('srd-5e-2024:item/chain-mail')).toMatchObject({
      category: 'armor',
      armor: { category: 'heavy', ac: 16, strength: 13, stealthDisadvantage: true },
      cost: { amount: 75, currency: 'gp' },
    });
    expect(byId.get('srd-5e-2024:item/shield')).toMatchObject({ category: 'shield', shield: { ac: 2 } });
  });

  it('every weapon has exactly one mastery and a valid dice string', () => {
    const weapons = items.filter((i) => (i as { category?: string }).category === 'weapon');
    expect(weapons.length).toBeGreaterThanOrEqual(30);
    for (const w of weapons) {
      const wp = (w as { weapon?: { mastery?: string; damage?: string } }).weapon;
      expect(wp?.mastery, w.id).toBeTruthy();
      expect(wp?.damage, w.id).toMatch(/^\d{1,2}d(4|6|8|10|12|20|100)([+-]\d{1,3})?$/);
    }
  });

  it('magic items carry rarity and attunement where required', () => {
    const magic = items.filter((i) => (i as { category?: string }).category === 'magic');
    expect(magic.some((m) => (m as { attunement?: { required: boolean } }).attunement?.required)).toBe(true);
    for (const m of magic) expect((m as { rarity?: string }).rarity, m.id).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `items.ts` (three-way join Item↔Weapon/Armor via the link fields; WeaponPropertyAssignment grouped by weapon pk; distinguish mastery vs ordinary properties via `WeaponProperty.fields.type` — inspect the vendored values and document the discriminator in a code comment). Replace the `nMagic` read-back with the literal count once observed (keep both assertions). If a spot golden disagrees with upstream, same corrections rule as Task 7.

- [ ] **Step 3: Run tests, typecheck, lint, format** until clean.

- [ ] **Step 4: Commit** — `git add packages/content && git commit -m "feat(content): item transform (weapons, armor, gear, magic items)"`

### Task 9: Species, background and feat transforms (`@hk/content`)

**Files:**
- Create: `packages/content/src/transform/species.ts`, `src/transform/backgrounds.ts`, `src/transform/feats.ts`
- Test: `packages/content/test/species-backgrounds-feats.test.ts`

**Interfaces:**
- Consumes: `Species` (9; `name, desc, subspecies_of`), `SpeciesTrait` (51; `name, desc, type, order, parent`), `Background` (4; `name, desc`), `BackgroundBenefit` (20; `name, desc, type, parent`), `Feat` (17; `name, desc, type, prerequisite`), `FeatBenefit` (35; `name, desc, type, parent`).
- Produces:
  - `transformSpecies(): { species: Entity[]; features: Entity[] }` — 9 `species` entities plus one `feature` entity per non-structural SpeciesTrait (traits whose `type` marks size/speed are consumed structurally, not emitted). Species `size`/`speed`/`creatureType` come FROM THE TRAIT TEXT where parseable, but the normative values are supplied by Task 11's `overlays/species.json` — the transform emits placeholder-safe values (`size: 'medium'`, `speed: 30`, `creatureType: 'humanoid'`) and the overlay corrects the exceptions (e.g. Goliath speed 35, Halfling/Gnome small). Feature ids: `srd-5e-2024:feature/<species>-<trait-slug>`; each species `grants` its features.
  - `transformBackgrounds(): Entity[]` — 4 `background` entities. The structured fields (`abilityScores`, `originFeat`, `skillProficiencies`, `toolProficiency`) are hand-encoded per background from the SRD (normative table below) and cross-checked in tests against the BackgroundBenefit `desc` text (the test asserts the benefit text CONTAINS the encoded ability names, catching drift):
    | background | abilityScores | originFeat | skillProficiencies |
    |---|---|---|---|
    | acolyte | int, wis, cha | magic-initiate-cleric | insight, religion |
    | criminal | dex, con, int | alert | sleight-of-hand, stealth |
    | sage | con, int, wis | magic-initiate-wizard | arcana, history |
    | soldier | str, dex, con | savage-attacker | athletics, intimidation |
    (Verify each row against the vendored BackgroundBenefit descs; if the SRD text disagrees with a row, fix the TABLE in code and this plan's report — the SRD is normative. `originFeat` ids must exist among the transformed feats; magic-initiate variants: check how the Feat fixture names them — if there is a single `magic-initiate` feat, point both at it and note it.)
  - `transformFeats(): Entity[]` — 17 `feat` entities; `category` from the fixture `type` (map upstream values to our `origin | general | fightingStyle | epicBoon`); FeatBenefit descs appended to the feat description as `**<benefit name>.** <desc>` blocks; `prerequisite` text (when present) kept in the description's tail (structured predicates for feats are Phase 4).

- [ ] **Step 1: Write the failing test**

```ts
// packages/content/test/species-backgrounds-feats.test.ts
import { EntitySchema } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { transformBackgrounds } from '../src/transform/backgrounds.ts';
import { transformFeats } from '../src/transform/feats.ts';
import { transformSpecies } from '../src/transform/species.ts';
import { readFixture } from '../src/upstream.ts';

const valid = (entities: { id: string }[]) => {
  for (const e of entities) {
    const r = EntitySchema.safeParse(e);
    expect(r.success, e.id + ': ' + JSON.stringify(r.success ? '' : r.error.issues[0])).toBe(true);
  }
};

describe('species', () => {
  const { species, features } = transformSpecies();
  it('9 species, each granting its trait features; all valid', () => {
    expect(species).toHaveLength(9);
    valid(species);
    valid(features);
    expect(species.map((s) => s.id)).toContain('srd-5e-2024:species/dragonborn');
    for (const s of species) expect((s as { grants: unknown[] }).grants.length, s.id).toBeGreaterThanOrEqual(1);
    const granted = new Set(species.flatMap((s) => (s as { grants: { feature: string }[] }).grants.map((g) => g.feature)));
    for (const id of granted) expect(features.map((f) => f.id), id).toContain(id);
  });
});

describe('backgrounds', () => {
  const backgrounds = transformBackgrounds();
  it('4 backgrounds with the SRD structured fields, cross-checked against benefit text', () => {
    expect(backgrounds).toHaveLength(4);
    valid(backgrounds);
    const acolyte = backgrounds.find((b) => b.id === 'srd-5e-2024:background/acolyte') as {
      abilityScores?: string[]; originFeat?: string; skillProficiencies?: string[];
    };
    expect(acolyte?.abilityScores).toEqual(['int', 'wis', 'cha']);
    expect(acolyte?.skillProficiencies).toEqual(['insight', 'religion']);
    const benefits = readFixture('BackgroundBenefit').filter((r) => String(r.pk).startsWith('srd-2024_acolyte'));
    const abilityBenefit = benefits.find((r) => String(r.pk).includes('ability'));
    const text = String((abilityBenefit?.fields as { desc?: string })?.desc ?? '');
    for (const word of ['Intelligence', 'Wisdom', 'Charisma']) expect(text).toContain(word);
  });
});

describe('feats', () => {
  const feats = transformFeats();
  it('17 feats with mapped categories; fighting styles present', () => {
    expect(feats).toHaveLength(17);
    valid(feats);
    const cats = new Set(feats.map((f) => (f as { category?: string }).category));
    expect(cats).toContain('origin');
    expect(cats).toContain('fightingStyle');
    expect(cats).toContain('epicBoon');
    expect(feats.map((f) => f.id)).toContain('srd-5e-2024:feat/alert');
    expect(feats.filter((f) => (f as { category?: string }).category === 'fightingStyle')).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement the three transforms. Inspect `Feat.fields.type` and `SpeciesTrait.fields.type` values in the vendored data first and write the explicit mapping tables in code (unknown upstream value → throw with a clear message, so new values surface loudly).

- [ ] **Step 3: Run tests, typecheck, lint, format** until clean.

- [ ] **Step 4: Commit** — `git add packages/content && git commit -m "feat(content): species, background and feat transforms"`

---

### Task 10: Class, subclass and progression transform (`@hk/content`)

**Files:**
- Create: `packages/content/src/transform/classes.ts`
- Test: `packages/content/test/classes.test.ts`

**Interfaces:**
- Consumes: `CharacterClass` (24; `name, hit_dice ('D10'), caster_type ('NONE'|'FULL'|…), primary_abilities, saving_throws, subclass_of`), `ClassFeature` (352; `name, desc, parent`), `ClassFeatureItem` (1811; `parent (feature pk), level, column_value, detail`).
- Produces: `transformClasses(): { classes: Entity[]; subclasses: Entity[]; features: Entity[] }`:
  - 12 `class` entities (records with `subclass_of: null`) and 12 `subclass` entities (`class` pointing at the parent's id; `subclassLevel` for all 2024 classes is 3).
  - One `feature` entity per ClassFeature: id `srd-5e-2024:feature/<pkSlug>` (pk already encodes `<class>_<feature>`), description from `desc`.
  - Progression rows: for each class/subclass, `levels[]` built from its features' ClassFeatureItems — a feature F with an item at level L yields `{ feature: <F id> }` in row L's `grants`; rows sorted ascending, only levels that grant something; a feature with items at several levels appears in each (scaling entries keep `column_value`/`detail` in the row's `extra` as `{ '<feature-slug>': <column_value or detail> }` when the value is a plain number or short string — numbers as numbers, dice/strings as strings).
  - Structural class fields: `hitDie` from `hit_dice` (strip `D`); `saves` from `saving_throws`; `primaryAbility` from `primary_abilities` (may be empty upstream — leave empty; corrections overlay may fill); `armorTraining`/`weaponProficiencies`/`toolProficiencies`/`skillChoice` are NOT in upstream fixtures — emit safe defaults (`[]`, `{ from: [], count: 0 }`) for Task 11/12 overlays to fill (Fighter and Wizard get real values there; the remaining ten stay defaults until Phase 4, which is acceptable — their features are browsable data).
- KNOWN UPSTREAM DEFECT (verified during planning): fighter `saving_throws` is `["dex","str"]`; the SRD says STR and CON. Do NOT fix it here — Task 11's corrections overlay does, with the citation. The spot test for fighter saves therefore lives in Task 13's build test (post-overlay), not here.

- [ ] **Step 1: Write the failing test**

```ts
// packages/content/test/classes.test.ts
import { EntitySchema } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { transformClasses } from '../src/transform/classes.ts';

describe('class transform', () => {
  const { classes, subclasses, features } = transformClasses();
  const valid = (entities: { id: string }[]) => {
    for (const e of entities) {
      const r = EntitySchema.safeParse(e);
      expect(r.success, e.id + ': ' + JSON.stringify(r.success ? '' : r.error.issues[0])).toBe(true);
    }
  };

  it('12 classes, 12 subclasses, all features linked', () => {
    expect(classes).toHaveLength(12);
    expect(subclasses).toHaveLength(12);
    valid(classes); valid(subclasses); valid(features);
    expect(classes.map((c) => c.id)).toContain('srd-5e-2024:class/fighter');
    expect(subclasses.map((s) => s.id)).toContain('srd-5e-2024:subclass/champion');
    const champion = subclasses.find((s) => s.id === 'srd-5e-2024:subclass/champion') as { class?: string };
    expect(champion?.class).toBe('srd-5e-2024:class/fighter');
  });

  it('progression rows reference existing features, ascending levels', () => {
    const featureIds = new Set(features.map((f) => f.id));
    for (const c of [...classes, ...subclasses] as { id: string; levels: { level: number; grants: { feature: string }[] }[] }[]) {
      let prev = 0;
      for (const row of c.levels) {
        expect(row.level, c.id).toBeGreaterThan(prev);
        prev = row.level;
        for (const g of row.grants) expect(featureIds.has(g.feature), `${c.id} L${row.level} → ${g.feature}`).toBe(true);
      }
      expect(c.levels.length, c.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('spot golden: Fighter structure (pre-overlay)', () => {
    const fighter = classes.find((c) => c.id === 'srd-5e-2024:class/fighter') as {
      hitDie?: number; subclassLevel?: number; levels?: { level: number; grants: { feature: string }[] }[];
    };
    expect(fighter?.hitDie).toBe(10);
    expect(fighter?.subclassLevel).toBe(3);
    const l1 = fighter?.levels?.find((r) => r.level === 1);
    expect(l1?.grants.map((g) => g.feature)).toContain('srd-5e-2024:feature/fighter-second-wind');
    const l5 = fighter?.levels?.find((r) => r.level === 5);
    expect(l5?.grants.map((g) => g.feature)).toContain('srd-5e-2024:feature/fighter-extra-attack');
  });

  it('spot golden: Wizard is a full caster with a d6', () => {
    const wizard = classes.find((c) => c.id === 'srd-5e-2024:class/wizard') as { hitDie?: number };
    expect(wizard?.hitDie).toBe(6);
  });
});
```

Note on feature-id slugs: pks look like `srd-2024_fighter_second-wind` → `pkSlug` yields `fighter-second-wind`; the test's expected ids assume that. If actual pks differ (inspect!), adjust the id derivation to keep the `<class>-<feature>` shape and update the two literals here — the shape, not the exact literal, is the contract.

- [ ] **Step 2: Run to verify failure**, then implement `classes.ts` (group ClassFeature by `parent` class pk; group ClassFeatureItem by `parent` feature pk; assemble rows; subclass detection via `subclass_of`).

- [ ] **Step 3: Run tests, typecheck, lint, format** until clean.

- [ ] **Step 4: Commit** — `git add packages/content && git commit -m "feat(content): class, subclass and progression transform"`

### Task 11: Overlay machinery, corrections, system choices, species and fighting-style overlays (`@hk/content`)

**Files:**
- Create: `packages/content/src/overlays/merge.ts`, `overlays/corrections.json`, `overlays/system-choices.json`, `overlays/species.json`, `overlays/fighting-styles.json`
- Test: `packages/content/test/overlays.test.ts`

**Interfaces:**
- Produces: `Overlay = { id: string; note?: string; cite?: string; set?: Record<string, unknown>; merge?: Record<string, unknown> }` and `applyOverlays(entities: Entity[], overlays: Overlay[]): Entity[]` — for each overlay, the target entity (by `id`) is patched: `set` replaces top-level fields wholesale; `merge` deep-merges plain objects and CONCATENATES arrays (`grants`, `effects`, `choices`, `tags`); an overlay whose `id` matches nothing THROWS (`Unmatched overlay: <id>` — silent dead overlays are how corrections rot); output entities re-validated with `EntitySchema` (invalid → throw with the issue). Pure: input array not mutated.
- Overlay files (JSON arrays of `Overlay`) with this content contract:
  - `corrections.json` — upstream-vs-SRD fixes, each entry with `cite` naming the SRD 5.2.1 section. Seed entries: fighter saves → `{ "id": "srd-5e-2024:class/fighter", "cite": "SRD 5.2.1, Fighter class table", "set": { "saves": ["str", "con"] } }`; add wizard saves `["int","wis"]` with the same treatment IF upstream disagrees (inspect; the SRD says INT and WIS); melee spell-attack corrections from Task 7's note (e.g. `srd-5e-2024:spell/steel-wind-strike` is not in the SRD — inspect which spells with `attack` are melee per their SRD text, minimum: none if none exist; document the sweep in the report).
  - `system-choices.json` — one overlay for `srd-5e-2024:system/5e-2024` merging the four creation choices: `@0/species` (pick query type species), `@0/background` (query type background), `@0/class` (query type class), `@0/ability-scores` (`{ "abilityGeneration": true }`), prompts "Species" / "Background" / "Class" / "Ability scores", all `at {kind: 'creation'}`.
  - `species.json` — per-species `set` for `size`/`speed`/`creatureType` where they differ from the transform defaults (Halfling and Gnome `size: 'small'`; Goliath `speed: 35`; Dwarf `speed: 30`; verify each against the SRD species text and cite), plus `merge.effects` for mechanically simple universal traits: darkvision (`sense.grant` 60 — dwarf, elf, gnome, orc, tiefling; goliath? verify list against SRD; dragonborn darkvision 60), speed-affecting traits, and `language.grant` Common for all (2024 languages: Common + two of choice — model as Common grant only; the choice comes in Phase 4).
  - `fighting-styles.json` — for the 4 fighting-style feats: `merge.tags: ["fighting-style"]` and effects: Archery `{attack.bonus +2, filter weapon ranged}`; Defense `{ac.bonus +1, key 'defense', when not armor none}`; Great Weapon Fighting `{damage.rerollBelow 3, filter property two-handed}` — NOTE: 2024 GWF changed to "treat 1s and 2s as 3s"; our vocabulary has only `damage.rerollBelow`, which is the closest declarative fit — set `value: 2` (reroll 1s and 2s) and add `note` that exact 2024 semantics land with Phase 4 vocabulary; Two-Weapon Fighting `{feature.text}` only (its mechanic needs off-hand context we don't model yet).
- Consumed by: Task 13's `buildPack` (applies corrections FIRST, then enrichment overlays, order: corrections → system-choices → species → fighting-styles → fighter → wizard).

- [ ] **Step 1: Write the failing test**

```ts
// packages/content/test/overlays.test.ts
import { describe, expect, it } from 'vitest';
import { applyOverlays } from '../src/overlays/merge.ts';
import corrections from '../src/overlays/corrections.json' with { type: 'json' };
import systemChoices from '../src/overlays/system-choices.json' with { type: 'json' };
import speciesOverlay from '../src/overlays/species.json' with { type: 'json' };
import fightingStyles from '../src/overlays/fighting-styles.json' with { type: 'json' };
import { transformClasses } from '../src/transform/classes.ts';
import { transformFeats } from '../src/transform/feats.ts';
import { transformSpecies } from '../src/transform/species.ts';
import { systemEntity } from '../src/static/system.ts';

describe('applyOverlays', () => {
  it('set replaces, merge concatenates arrays, unmatched throws, input not mutated', () => {
    const { classes } = transformClasses();
    const fighter = classes.find((c) => c.id === 'srd-5e-2024:class/fighter')!;
    const before = JSON.stringify(fighter);
    const [patched] = applyOverlays([fighter], [{ id: fighter.id, set: { saves: ['str', 'con'] }, merge: { tags: ['martial'] } }]);
    expect((patched as { saves?: string[] }).saves).toEqual(['str', 'con']);
    expect(patched!.tags).toContain('martial');
    expect(JSON.stringify(fighter)).toBe(before);
    expect(() => applyOverlays([fighter], [{ id: 'srd-5e-2024:class/nope', set: {} }])).toThrow(/Unmatched overlay/);
  });

  it('corrections fix fighter saves with a citation', () => {
    const entry = (corrections as { id: string; cite?: string }[]).find((o) => o.id === 'srd-5e-2024:class/fighter');
    expect(entry?.cite).toMatch(/SRD 5\.2\.1/);
    const { classes } = transformClasses();
    const [fighter] = applyOverlays(classes.filter((c) => c.id === 'srd-5e-2024:class/fighter'), [entry!]);
    expect((fighter as { saves?: string[] }).saves).toEqual(['str', 'con']);
  });

  it('system gains the four creation choices', () => {
    const [sys] = applyOverlays([systemEntity()], systemChoices as never[]);
    const ids = (sys as { choices: { id: string }[] }).choices.map((c) => c.id);
    expect(ids.sort()).toEqual([
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      'srd-5e-2024:system/5e-2024@0/background',
      'srd-5e-2024:system/5e-2024@0/class',
      'srd-5e-2024:system/5e-2024@0/species',
    ]);
  });

  it('species overlay: small halfling, darkvision dwarf', () => {
    const { species } = transformSpecies();
    const patched = applyOverlays(species, (speciesOverlay as { id: string }[]).filter((o) => species.some((s) => s.id === o.id)));
    expect((patched.find((s) => s.id === 'srd-5e-2024:species/halfling') as { size?: string })?.size).toBe('small');
    const dwarf = patched.find((s) => s.id === 'srd-5e-2024:species/dwarf') as { effects?: { type: string; sense?: string }[] };
    expect(dwarf?.effects?.some((e) => e.type === 'sense.grant' && e.sense === 'darkvision')).toBe(true);
  });

  it('fighting styles are tagged and mechanized', () => {
    const feats = transformFeats();
    const patched = applyOverlays(feats, (fightingStyles as { id: string }[]).filter((o) => feats.some((f) => f.id === o.id)));
    const tagged = patched.filter((f) => f.tags.includes('fighting-style'));
    expect(tagged).toHaveLength(4);
    const archery = tagged.find((f) => f.id === 'srd-5e-2024:feat/archery') as { effects?: { type: string }[] };
    expect(archery?.effects?.some((e) => e.type === 'attack.bonus')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `merge.ts` (deep-merge rule: arrays concat, plain objects recurse, scalars from overlay win; `set` bypasses merging; re-validate each patched entity with `EntitySchema.safeParse` and throw on failure) and author the four JSON files per the content contract, verifying each factual value against the vendored SRD text (`Species`/`SpeciesTrait` descs for sizes/speeds/darkvision; feat descs for the styles) and citing in `cite` where a value contradicts or supplements upstream. If `import ... with { type: 'json' }` trips the toolchain, load the JSONs via `readFileSync` + `JSON.parse` in a tiny `overlays/load.ts` helper instead — keep the same exported names in tests.

- [ ] **Step 3: Run tests, typecheck, lint, format** until clean.

- [ ] **Step 4: Commit** — `git add packages/content && git commit -m "feat(content): overlay machinery, SRD corrections, system choices, species and fighting-style overlays"`

---

### Task 12: Fighter/Champion and Wizard/Evoker 1–5 mechanical overlays (`@hk/content`)

**Files:**
- Create: `packages/content/src/overlays/fighter.json`, `overlays/wizard.json`
- Test: `packages/content/test/mechanics.test.ts`

**Interfaces:**
- Produces the mechanical data that plan 3's Library shows and Phase 1b's engine consumes. Content contract (verify every feature-id literal against Task 10's output before authoring; the mechanics below are the normative SRD 5.2.1 values):
  - `fighter.json` overlays:
    - Class structure (`set`): `armorTraining: ['light','medium','heavy','shields']`, `weaponProficiencies: ['simple','martial']`, `skillChoice: { from: ['acrobatics','animal-handling','athletics','history','insight','intimidation','persuasion','perception','survival'], count: 2 }`.
    - L1 row (`merge` into `levels`— the merge machinery cannot address rows; instead the overlay uses `set` on `levels` is forbidden (would clobber upstream grants). Extend `merge.ts` in THIS task: an overlay may carry `rows: [{ level, grants?, choices?, extra? }]` which merges into the matching `levels[]` row (grants/choices concat, extra shallow-merge; missing row → created in order). Add a unit test for `rows` in `mechanics.test.ts`.)
    - Via `rows`: L1 choices `@1/fighting-style` (query feat tag fighting-style), `@1/weapon-masteries` (prompt 'Weapon Masteries', pick query type item tag — impractical; instead `literal: 'text'` with note, Phase 4 structures it), `@1/skills` (query is not expressible for system skills — use `literal:'text'`? NO: skills are chosen via `skillChoice` structure, no choice entity needed — omit); L1 second-wind effects on the FEATURE entity `srd-5e-2024:feature/fighter-second-wind` (`merge.effects`: `resource.define { id: 'second-wind', name: 'Second Wind', max: '2', reset: 'shortRest' }` with `note` that 2024 regains one use per short rest — vocabulary approximation); L2 feature `fighter-action-surge` gets `action.define { id: 'action-surge', kind: 'free', uses: { count: '1', per: 'shortRest' } }`; L3 row choice `@3/subclass` (query type subclass classes ['fighter']); L4 row choice `@4/feat` (query type feat tags ['general']... 2024 ASI-at-4 grants the Ability Score Improvement feat or another general feat: pick query `{ type: 'feat' }` with prompt 'Feat (Ability Score Improvement or other)'; `repeatableAt: [6]` omitted — 1–5 scope); L5 feature `fighter-extra-attack` gets `extraAttack.set { count: 2 }`; weapon-mastery count: class-level effect `mastery.grant { count: '3' }` on the L1 feature `fighter-weapon-mastery`.
    - Champion (`rows` on `srd-5e-2024:subclass/champion`): L3 `champion-improved-critical` gets `tag.grant improved-critical`.
  - `wizard.json` overlays:
    - Class structure (`set`): `armorTraining: []`, `weaponProficiencies: ['simple']`, `skillChoice: { from: ['arcana','history','insight','investigation','medicine','nature','religion'], count: 2 }`.
    - L1 feature `wizard-spellcasting` gets `spellcasting.define { class: 'wizard', ability: 'int', list: 'wizard', preparation: 'spellbook', slots: 'full', ritual: true, focus: true, cantripsKnown: '3 + floor(classLevel(wizard) / 4)' }` (no `preparedCount` formula — the 2024 prepared-spells column is a table; it goes in `rows[].extra.preparedSpells`: L1 4, L2 5, L3 6, L4 7, L5 9 — 1b's derive reads row extra first, documented in the overlay `note`).
    - L3 row choice `@3/subclass` (query type subclass classes ['wizard']); L4 row choice `@4/feat` (same shape as fighter's).
    - Evoker (`rows` on `srd-5e-2024:subclass/evoker`): L3 features tagged (`tag.grant` `evocation-savant`, `potent-cantrip`) — text-level for 1a.
  - Verify feature-id literals (`fighter-second-wind`, `wizard-spellcasting`, `champion-improved-critical`, …) against `transformClasses()` output; where a name differs (e.g. `evoker` vs `wizard-evoker` slugs), use the actual id and update the test literals — shape over literal, as in Task 10.

- [ ] **Step 1: Write the failing test**

```ts
// packages/content/test/mechanics.test.ts
import { describe, expect, it } from 'vitest';
import { applyOverlays } from '../src/overlays/merge.ts';
import { loadOverlays } from '../src/overlays/load.ts'; // { corrections, systemChoices, species, fightingStyles, fighter, wizard }
import { transformClasses } from '../src/transform/classes.ts';

describe('rows merging', () => {
  it('merges grants/choices/extra into the matching level row without clobbering', () => {
    const { classes } = transformClasses();
    const fighter = classes.find((c) => c.id === 'srd-5e-2024:class/fighter')!;
    const upstreamL1 = (fighter as { levels: { level: number; grants: unknown[] }[] }).levels.find((r) => r.level === 1)!.grants.length;
    const [patched] = applyOverlays([fighter], [{ id: fighter.id, rows: [{ level: 1, choices: [{ id: 'srd-5e-2024:class/fighter@1/x', prompt: 'X', at: { kind: 'classLevel', class: 'fighter', level: 1 }, pick: { literal: 'text' }, count: 1, unique: true, repeatableAt: [], prerequisites: [] }] }] } as never]);
    const l1 = (patched as { levels: { level: number; grants: unknown[]; choices: unknown[] }[] }).levels.find((r) => r.level === 1)!;
    expect(l1.grants).toHaveLength(upstreamL1);
    expect(l1.choices).toHaveLength(1);
  });
});

describe('fighter and wizard 1–5 mechanics', () => {
  const { classes, subclasses, features } = transformClasses();
  const o = loadOverlays();
  const patchedClasses = applyOverlays(classes, [...o.corrections, ...o.fighter, ...o.wizard].filter((x) => classes.some((c) => c.id === x.id)));
  const patchedFeatures = applyOverlays(features, [...o.fighter, ...o.wizard].filter((x) => features.some((f) => f.id === x.id)));

  it('fighter: structure, fighting-style and subclass choices, second wind resource, extra attack', () => {
    const f = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/fighter') as {
      saves: string[]; armorTraining: string[]; skillChoice: { count: number };
      levels: { level: number; choices: { id: string; pick: unknown }[] }[];
    };
    expect(f.saves).toEqual(['str', 'con']);
    expect(f.armorTraining).toContain('heavy');
    expect(f.skillChoice.count).toBe(2);
    const choiceIds = f.levels.flatMap((r) => r.choices.map((c) => c.id));
    expect(choiceIds).toContain('srd-5e-2024:class/fighter@1/fighting-style');
    expect(choiceIds).toContain('srd-5e-2024:class/fighter@3/subclass');
    expect(choiceIds).toContain('srd-5e-2024:class/fighter@4/feat');
    const secondWind = patchedFeatures.find((x) => x.id.endsWith('second-wind')) as { effects: { type: string }[] };
    expect(secondWind.effects.some((e) => e.type === 'resource.define')).toBe(true);
    const extraAttack = patchedFeatures.find((x) => x.id.includes('fighter') && x.id.includes('extra-attack')) as { effects: { type: string }[] };
    expect(extraAttack.effects.some((e) => e.type === 'extraAttack.set')).toBe(true);
  });

  it('wizard: spellbook full caster with cantrip formula and preparedSpells row extras', () => {
    const spellcasting = patchedFeatures.find((x) => x.id.includes('wizard') && x.id.includes('spellcasting')) as { effects: { type: string; cantripsKnown?: string }[] };
    const sc = spellcasting.effects.find((e) => e.type === 'spellcasting.define');
    expect(sc).toMatchObject({ preparation: 'spellbook', slots: 'full', ritual: true, ability: 'int' });
    expect(sc?.cantripsKnown).toBe('3 + floor(classLevel(wizard) / 4)');
    const w = patchedClasses.find((c) => c.id === 'srd-5e-2024:class/wizard') as { levels: { level: number; extra?: Record<string, unknown> }[] };
    expect(w.levels.find((r) => r.level === 1)?.extra?.['preparedSpells']).toBe(4);
    expect(w.levels.find((r) => r.level === 5)?.extra?.['preparedSpells']).toBe(9);
  });

  it('subclass overlays land on champion and the wizard subclass', () => {
    const patchedSubs = applyOverlays(subclasses, [...o.fighter, ...o.wizard].filter((x) => subclasses.some((s) => s.id === x.id)));
    const champion = patchedSubs.find((s) => s.id.includes('champion')) as { levels: { level: number }[] };
    expect(champion.levels.some((r) => r.level === 3)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then: extend `merge.ts` with the `rows` overlay field (typed `rows?: { level: number; grants?: unknown[]; choices?: unknown[]; extra?: Record<string, unknown> }[]`, applied only to class/subclass entities — anything else throws), add `overlays/load.ts` (reads all six JSON files, returns them typed), author `fighter.json` and `wizard.json` per the contract, adjusting feature-id literals to the transform's real output.

- [ ] **Step 3: Run tests, typecheck, lint, format** until clean.

- [ ] **Step 4: Commit** — `git add packages/content && git commit -m "feat(content): fighter/champion and wizard/evoker 1-5 mechanical overlays; row-level overlay merging"`

### Task 13: `buildPack`, CLI, icons map, full validation goldens (`@hk/content`)

**Files:**
- Create: `packages/content/src/build.ts`, `src/cli.ts`, `src/icons/icons-map.json`
- Test: `packages/content/test/build.test.ts`, `packages/content/test/icons.test.ts`

**Interfaces:**
- Produces: `buildPack(): Pack` — composes: `packManifest()` + entities in this order before sorting: system, languages, glossary (abilities, skills, conditions, damage-type rules, rules), spells, items, species + species features, backgrounds, feats, classes + subclasses + class features; then `applyOverlays` with ALL overlays in order corrections → system-choices → species → fighting-styles → fighter → wizard; then sorts entities by id and returns the `Pack` (parse the final object through `parsePack` — throw on failure). `writePack(outDir: string): string` — writes `<outDir>/srd-5e-2024/0.1.0/pack.json` (2-space JSON + newline), returns the path. `cli.ts`: `node src/cli.ts [--out packages/content/dist/packs]` → `writePack` + `validatePack` + prints `OK srd-5e-2024@0.1.0: <n> entities, <bytes> bytes, 0 diagnostics` or exits 1 listing diagnostics.
- `icons-map.json`: `{ "categories": { "spell-school:evocation": "gi:fire-ray", ... }, "entities": { "srd-5e-2024:class/fighter": "gi:crossed-swords", ... } }` — category keys for the 8 spell schools (`spell-school:<slug>`), weapon kinds (`item:weapon-melee`, `item:weapon-ranged`), `item:armor`, `item:shield`, `item:gear`, `item:magic`, `condition`, `rule`; entity keys minimum: the 12 classes and 9 species. Values match `^gi:[a-z0-9-]+$` (real game-icons slugs get verified when plan 3 vendors the sprite; pick plausible names, e.g. `gi:wizard-staff`, `gi:elf-ear`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/content/test/build.test.ts
import { validatePack } from '@hk/engine';
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION } from '../src/static/attribution.ts';
import { buildPack } from '../src/build.ts';

describe('the srd-5e-2024 pack', () => {
  const pack = buildPack();

  it('validates with zero diagnostics', () => {
    const d = validatePack(pack, []);
    expect(d, JSON.stringify(d.slice(0, 5))).toEqual([]);
  });

  it('carries the manifest and exact attribution', () => {
    expect(pack).toMatchObject({ format: 1, id: 'srd-5e-2024', version: '0.1.0', kind: 'core', system: '5e-2024', license: 'CC-BY-4.0' });
    expect(pack.attribution).toBe(ATTRIBUTION);
  });

  it('has the pinned entity counts by type', () => {
    const byType = new Map<string, number>();
    for (const e of pack.entities) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    expect(byType.get('system')).toBe(1);
    expect(byType.get('spell')).toBe(339);
    expect(byType.get('species')).toBe(9);
    expect(byType.get('background')).toBe(4);
    expect(byType.get('feat')).toBe(17);
    expect(byType.get('class')).toBe(12);
    expect(byType.get('subclass')).toBe(12);
    expect(byType.get('condition')).toBe(15);
    expect(byType.get('skill')).toBe(18);
    expect(byType.get('ability')).toBe(6);
    expect((byType.get('language') ?? 0)).toBeGreaterThanOrEqual(16);
    expect((byType.get('item') ?? 0)).toBeGreaterThanOrEqual(400);
    expect((byType.get('feature') ?? 0)).toBeGreaterThanOrEqual(350);
    expect(pack.entities.length).toBeLessThanOrEqual(5000);
  });

  it('post-overlay spot goldens (SRD truth): fighter saves, system choices, size budget', () => {
    const fighter = pack.entities.find((e) => e.id === 'srd-5e-2024:class/fighter') as { saves?: string[] };
    expect(fighter?.saves).toEqual(['str', 'con']);
    const sys = pack.entities.find((e) => e.type === 'system')!;
    expect(sys.choices.map((c) => c.id)).toContain('srd-5e-2024:system/5e-2024@0/ability-scores');
    const bytes = new TextEncoder().encode(JSON.stringify(pack)).length;
    expect(bytes, 'PACK_LIMITS.maxBytes').toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it('entities are sorted by id (deterministic output)', () => {
    const ids = pack.entities.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
  });
});
```

```ts
// packages/content/test/icons.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

describe('icons map', () => {
  const map = JSON.parse(readFileSync(new URL('../src/icons/icons-map.json', import.meta.url), 'utf8')) as {
    categories: Record<string, string>; entities: Record<string, string>;
  };
  it('all values are gi: slugs and all entity keys exist in the pack', () => {
    const pack = buildPack();
    const ids = new Set(pack.entities.map((e) => e.id));
    for (const v of [...Object.values(map.categories), ...Object.values(map.entities)]) expect(v).toMatch(/^gi:[a-z0-9-]+$/);
    for (const k of Object.keys(map.entities)) expect(ids.has(k), k).toBe(true);
  });
  it('covers the 8 spell schools and all 12 classes', () => {
    const schools = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];
    for (const s of schools) expect(map.categories[`spell-school:${s}`], s).toBeTruthy();
    const classes = Object.keys(map.entities).filter((k) => k.includes(':class/'));
    expect(classes).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `build.ts`, `cli.ts`, and author `icons-map.json`. Expect the zero-diagnostics test to surface real dangling refs on the first run (e.g. background `originFeat` naming a feat slug that differs, species features granted but not emitted) — fix them at the SOURCE (transform or overlay), never by loosening the test. This task is where the whole pack becomes internally consistent; budget fix iterations for it.

- [ ] **Step 3: Run the CLI end-to-end**: `pnpm --filter @hk/content build:pack` → `OK srd-5e-2024@0.1.0 …` and the file exists under `packages/content/dist/packs/`. Confirm `dist/` is git-ignored (plan-1 `.gitignore` already covers `dist/`).

- [ ] **Step 4: Run all tests, typecheck, lint, format** until clean (full repo `pnpm test`).

- [ ] **Step 5: Commit** — `git add packages/content && git commit -m "feat(content): buildPack composition, CLI, icons map; pack validates clean"`

---

### Task 14: RU sample translation pack + repo docs (`@hk/content`)

**Files:**
- Create: `packages/content/translations/srd-5e-2024-ru-sample.json`
- Modify: `README.md`, `CLAUDE.md` (one line each)
- Test: `packages/content/test/ru-sample.test.ts`

**Interfaces:**
- Produces: a valid `kind: 'translation'` pack `{ id: 'srd-5e-2024-ru-sample', version: '0.1.0', system: '5e-2024', locale: 'ru', translates: { id: 'srd-5e-2024', range: '^0' }, strings: … }` with ≥ 20 translated entries covering: the 12 class names (Воин, Волшебник, Бард, Варвар, Жрец, Друид, Монах, Паладин, Следопыт, Плут, Чародей, Колдун), the 9 species names (Драконорождённый, Дварф, Эльф, Гном, Голиаф, Полурослик, Человек, Орк, Тифлинг), the 4 backgrounds (Послушник, Преступник, Мудрец, Солдат), 3 spells with name+description (Fireball → Огненный шар, Magic Missile → Волшебная стрела, Mage Armor → Доспехи мага), 2 conditions (prone → Сбит с ног, poisoned → Отравлен), and the system's ability-scores choice prompt (Значения характеристик). Terminology follows dnd.su conventions (ADR-009).
- Purpose: proves the full translation pipeline (validatePack accepts it; localizer resolves per-field with fallback) and ships as plan-3 demo data.

- [ ] **Step 1: Write the failing test**

```ts
// packages/content/test/ru-sample.test.ts
import { readFileSync } from 'node:fs';
import { createContentIndex, createLocalizer, validatePack } from '@hk/engine';
import { parsePack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

describe('srd-5e-2024-ru-sample', () => {
  const raw = JSON.parse(readFileSync(new URL('../translations/srd-5e-2024-ru-sample.json', import.meta.url), 'utf8')) as unknown;
  const parsed = parsePack(raw);
  const core = buildPack();

  it('parses and validates against the built core pack', () => {
    expect(parsed.ok, JSON.stringify(parsed.ok ? '' : parsed.issues.slice(0, 3))).toBe(true);
    if (!parsed.ok) return;
    expect(validatePack(parsed.pack, [core])).toEqual([]);
    expect(Object.keys(parsed.pack.strings ?? {}).length).toBeGreaterThanOrEqual(20);
  });

  it('localizes names with per-field fallback', () => {
    if (!parsed.ok) return;
    const index = createContentIndex([core, parsed.pack]);
    const ru = createLocalizer(index, 'ru');
    expect(ru.name('srd-5e-2024:spell/fireball')).toBe('Огненный шар');
    expect(ru.text('srd-5e-2024:spell/fireball', 'description').isFallback).toBe(false);
    expect(ru.name('srd-5e-2024:class/fighter')).toBe('Воин');
    // untranslated spell falls back to English:
    expect(ru.text('srd-5e-2024:spell/acid-arrow', 'name')).toMatchObject({ isFallback: true });
    expect(ru.choicePrompt('srd-5e-2024:system/5e-2024@0/ability-scores').text).toBe('Значения характеристик');
  });
});
```

- [ ] **Step 2: Run to verify failure**, then author the translation pack (keys are entity ids without the pack prefix, e.g. `"spell/fireball": { "name": "Огненный шар", "description": "…" }`; choice keys like `"system/5e-2024@0/ability-scores": { "prompt": "Значения характеристик" }`). Spell descriptions: translate the first paragraph faithfully, 2–4 sentences each.

- [ ] **Step 3: Docs touch** — append to `README.md` under "Pack tools": `Content: \`pnpm --filter @hk/content build:pack\` generates the SRD 5.2.1 core pack from the vendored open5e snapshot (see \`packages/content/upstream/open5e-srd-2024/SOURCE.md\`).` Append to `CLAUDE.md` Commands: `pnpm --filter @hk/content build:pack — regenerate the SRD pack (never edit dist output by hand; fix transforms/overlays instead)`.

- [ ] **Step 4: Run all tests (full repo), typecheck, lint, format** until clean.

- [ ] **Step 5: Commit** — `git add packages/content README.md CLAUDE.md && git commit -m "feat(content): Russian sample translation pack; document the content build"`

---

## Self-review (performed 2026-08-30 while writing this plan)

**Spec coverage** (`docs/03-roadmap/phase-1-solo-builder.md` § 1a deliverable 4 + R23):

| Requirement | Tasks |
|---|---|
| Import tool from open5e srd-2024 JSON → `srd-5e-2024` core pack | 1, 6–10, 13 |
| All entity types as data | 5 (system, languages), 6 (glossary), 7 (spells), 8 (items), 9 (species/backgrounds/feats), 10 (classes/features) |
| Class progression rows including choices | 10 (rows from upstream), 11–12 (choices via overlays) |
| System entity with 2024 composition slots and tables | 5 + 11 (creation choices) |
| `icons.json` mapping to the game-icons subset | 13 (`icons-map.json`; actual SVGs are plan 3) |
| Attribution | 5, verified verbatim in 13 |
| Validation in CI | 13 (zero-diagnostics test runs in the normal suite; CI already runs `pnpm test`) |
| Sample RU translation pack (data half of deliverable 8) | 14 |
| R23a entity-level formula validation | 2 |
| R23b predicate depth/width cap | 3 |
| R23c translation-pack field-level merge | 4 |

**Deliberate scope notes:** monsters/creatures, services, alignment text — out (no combat tracker in v1); the ten non-Fighter/Wizard classes ship with real features and progression rows but default structural fields and no mechanical effects (Phase 4 per the roadmap); `spellSlots.half/third/pact` tables Phase 4; feat prerequisites stay text (Phase 4); the 2024 "regain one use per short rest" resource semantics and exact Great Weapon Fighting rule are vocabulary approximations flagged with `note` fields (Phase 4 vocabulary work).

**Upstream-uncertainty policy (restated):** every factual literal in tests marked "spot golden" is SRD truth; where upstream disagrees, corrections overlays fix it with citations. Field names verified against the vendored snapshot at commit `4b314adb` on 2026-08-30; if a shape differs at execution time, the vendored file (not this plan's assumption) governs and the report documents the delta.

**Placeholder scan:** no TBD/TODO/"similar to Task N"; each task carries verbatim tests and either verbatim implementation or an explicit output contract with normative data tables. Type consistency checked: `FixtureRecord`/`readFixture`/`pkSlug` (T1) used by T6–T10; `FormulaSite` reused from plan 1's engine (T2); `Overlay`/`applyOverlays`/`rows` (T11, extended T12) consumed by T13; `buildPack` (T13) consumed by T14; `loadOverlays` introduced in T12 and used there and in T13's build composition.

**Known risks for the executor:** T13's zero-diagnostics gate will surface cross-entity inconsistencies from earlier tasks — that is by design; fix at the source. Pack size should land ~2.5–3.5 MB; if over 5 MB, escalate (Global Constraints). JSON import attributes (`with { type: 'json' }`) may need the `load.ts` fallback depending on the toolchain — both paths are specified.

## What comes next

Plan 3 — the Angular Library PWA (`apps/web`, `packages/ui-tokens`): app shell, design tokens, Transloco en/ru/uk, service worker, Library browse/search over this pack via `createContentIndex`/`createLocalizer`/`createSearchIndex`, game-icons sprite vendoring (validating `icons-map.json` values), and the RU sample pack demo. Then the Phase 1b plan (solo builder & play).
