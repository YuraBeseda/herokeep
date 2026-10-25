import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { type Pack, type Event, EntitySchema, parseEvent, parsePack } from '@hk/protocol';
import { pinnedRoots } from '../../src/content/deps.ts';
import { type ContentIndex, createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import type { Facts, SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadEngineFixturePack, loadFixturePack } from './fixtures.ts';

export interface GoldenFixture {
  name: string;
  packs: string[];
  events: Event[];
  expect: Record<string, unknown>;
  /**
   * Plan 14 final fix wave: paths that must NOT exist (resolve to `undefined`). JSON has no
   * `undefined`, so an absence that no parent whole-object pin can carry (e.g. an optional
   * top-level `sheet.*` key) is listed here; a present value fails `toEqual` with that value shown.
   */
  absent?: string[];
  /**
   * Plan 16 task 7: a partial `system` entity deep-merged into the CORE pack's system entity before
   * any index is built, for a golden that needs system data the shipped core does not carry (e.g.
   * `{ "multiclass": { "masteryCount": "sum" } }`). Objects merge key by key; arrays and scalars
   * replace. The result is revalidated with the strict entity schema, so a misspelt key fails the
   * golden. It stands for a different core pack: only a `kind: core` pack may change the `system`
   * entity (docs/02-architecture/04-content-packs.md, Overrides), so a content-pack override is not
   * a valid way to do this.
   */
  systemPatch?: Record<string, unknown>;
}

const goldenDir = new URL('../golden/', import.meta.url);

/** `packages/content/dist/packs/`, relative to this file (`packages/engine/test/support/`). */
const contentDistPacksDir = new URL('../../../content/dist/packs/', import.meta.url);
export const DIST_PREFIX = 'dist:';

/**
 * Loads a built content pack for `packs: ["dist:<packId>"]` entries. CI builds the content pack
 * before running tests (root pipeline); locally it must be built first — fail with a clear,
 * actionable message rather than a raw ENOENT when it hasn't been. Exported so other callers that
 * need the real pack directly (e.g. `perf.test.ts`, which needs a `ContentIndex` outside any
 * `GoldenFixture`) reuse this same version-scanning, build-first-message logic instead of
 * duplicating a hardcoded path that a version bump would silently break.
 */
export function loadDistPack(packId: string): Pack {
  const packDir = new URL(`${packId}/`, contentDistPacksDir);
  const notBuilt = (): never => {
    throw new Error(
      `Content pack "${packId}" is not built (looked under ${packDir.pathname}) — run pnpm --filter @hk/content build:pack first`,
    );
  };
  if (!existsSync(packDir)) notBuilt();
  const versions = readdirSync(packDir).sort();
  const version = versions[versions.length - 1];
  if (!version) notBuilt();
  const file = new URL(`${version}/pack.json`, packDir);
  if (!existsSync(file)) notBuilt();
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const r = parsePack(raw);
  if (!r.ok) throw new Error(`dist:${packId}: invalid pack (${JSON.stringify(r.issues)})`);
  return r.pack;
}

/**
 * Plan 15 task 8: `packs: ["fixture:<name>"]` loads an engine fixture content pack
 * (`packages/engine/test/fixtures/packs/<name>.json`, e.g. the third-party `sample-content`) beside
 * the `dist:` core. A golden that lists one derives against the per-character index (see
 * `runGolden`); goldens without one keep the original path untouched.
 */
export const FIXTURE_PREFIX = 'fixture:';

/** Resolves one `packs` entry: `dist:<id>`, `fixture:<name>`, or a bare protocol fixture name. */
export function loadGoldenPack(name: string): Pack {
  if (name.startsWith(DIST_PREFIX)) return loadDistPack(name.slice(DIST_PREFIX.length));
  if (name.startsWith(FIXTURE_PREFIX)) return loadEngineFixturePack(name.slice(FIXTURE_PREFIX.length));
  return loadFixturePack(name);
}

export function loadGoldens(): GoldenFixture[] {
  return readdirSync(goldenDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(new URL(f, goldenDir), 'utf8')) as GoldenFixture);
}

/** Path grammar: dot segments and ["quoted"] segments, e.g. facts.decisions["a:b/c@1/d"].0 */
export function getPath(root: unknown, path: string): unknown {
  const segs = [...path.matchAll(/\["((?:[^"\\]|\\.)*)"\]|([^.[\]]+)/g)].map((m) =>
    m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]!,
  );
  let cur: unknown = root;
  for (const s of segs) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `systemPatch`'s merge: objects merge key by key; anything else (arrays included) replaces. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return structuredClone(patch);
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) merged[key] = deepMerge(base[key], value);
  return merged;
}

/** Plan 16 task 7: the golden's packs with `fx.systemPatch` merged into the core's system entity. */
function applySystemPatch(fx: GoldenFixture, packs: Pack[]): Pack[] {
  const patch = fx.systemPatch;
  if (patch === undefined) return packs;
  let patched = 0;
  const result = packs.map((pack) => {
    if (pack.kind !== 'core') return pack;
    const entities = pack.entities.map((e) => {
      if (e.type !== 'system') return e;
      const r = EntitySchema.safeParse(deepMerge(e, patch));
      if (!r.success) throw new Error(`${fx.name}: systemPatch makes an invalid system entity (${r.error.message})`);
      patched++;
      return r.data;
    });
    return { ...pack, entities };
  });
  if (patched !== 1) throw new Error(`${fx.name}: systemPatch needs exactly one core system entity (found ${patched})`);
  return result;
}

/** The reduced facts plus the index and rules a golden derives with (shared with `derive-perf`). */
export function prepareGolden(fx: GoldenFixture): {
  facts: Facts;
  index: ContentIndex;
  rules: SystemRules | undefined;
  events: number;
} {
  // Plan 16 task 7: `systemPatch` is merged before either index below is built, so both the
  // derive index and the system rules read the patched entity.
  const packs = applySystemPatch(fx, fx.packs.map(loadGoldenPack));
  // Plan 15 task 8: a golden listing a `fixture:` content pack derives against the per-character
  // index, exactly as the web's `EngineFacade.indexFor(facts.pins)` builds it — so the packs its
  // log pins (and unpins) decide what resolves. The core-only index below still supplies the
  // system rules (the `system` entity lives in the core). Every other golden keeps the original
  // whole-list index path, untouched.
  const usesFixtureContent = fx.packs.some((p) => p.startsWith(FIXTURE_PREFIX));
  const baseIndex = createContentIndex(usesFixtureContent ? packs.filter((p) => p.kind === 'core') : packs);
  if (baseIndex.diagnostics.length > 0) throw new Error(`${fx.name}: ${JSON.stringify(baseIndex.diagnostics)}`);
  const events = fx.events.map((e) => {
    const r = parseEvent(e);
    if (!r.ok) throw new Error(`${fx.name}: bad event ${JSON.stringify(r.issues)}`);
    return r.event;
  });
  // A `dist:`-loaded pack carries a real `system` entity's rest/HP rules — extract them and feed
  // BOTH `reduce` (rest-transaction math) and `derive` (HP-per-level pricing) with the same rules,
  // same as a real app would. Fixture-only packs (e.g. `core-mini`) keep the legacy no-rules path
  // so their existing goldens (which assert the `derive.noSystemRules` warning) stay unchanged.
  const usesDistPack = fx.packs.some((p) => p.startsWith(DIST_PREFIX));
  const rules: SystemRules | undefined = usesDistPack
    ? { restRules: baseIndex.system().restRules, hpRules: baseIndex.system().hpRules }
    : undefined;
  const facts = reduce(events, undefined, rules);
  const index = usesFixtureContent
    ? createContentIndex(packs, { pins: facts.pins, roots: pinnedRoots(packs, facts.pins) })
    : baseIndex;
  if (index.diagnostics.length > 0) throw new Error(`${fx.name}: ${JSON.stringify(index.diagnostics)}`);
  return { facts, index, rules, events: events.length };
}

export function runGolden(fx: GoldenFixture): { actual: Record<string, unknown>; expected: Record<string, unknown> } {
  const { facts, index, rules } = prepareGolden(fx);
  const root = { facts, sheet: derive(facts, index, rules) };
  const actual: Record<string, unknown> = {};
  for (const path of Object.keys(fx.expect)) actual[path] = getPath(root, path);
  const expected: Record<string, unknown> = { ...fx.expect };
  for (const path of fx.absent ?? []) {
    if (path in fx.expect) throw new Error(`${fx.name}: "${path}" is both expected and absent`);
    actual[path] = getPath(root, path);
    expected[path] = undefined;
  }
  return { actual, expected };
}
