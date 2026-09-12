import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { type Pack, type Event, parseEvent, parsePack } from '@hk/protocol';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import type { SystemRules } from '../../src/reduce/facts.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadFixturePack } from './fixtures.ts';

export interface GoldenFixture {
  name: string;
  packs: string[];
  events: Event[];
  expect: Record<string, unknown>;
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

function loadPack(name: string): Pack {
  return name.startsWith(DIST_PREFIX) ? loadDistPack(name.slice(DIST_PREFIX.length)) : loadFixturePack(name);
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

export function runGolden(fx: GoldenFixture): { actual: Record<string, unknown>; expected: Record<string, unknown> } {
  const packs = fx.packs.map(loadPack);
  const index = createContentIndex(packs);
  if (index.diagnostics.length > 0) throw new Error(`${fx.name}: ${JSON.stringify(index.diagnostics)}`);
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
    ? { restRules: index.system().restRules, hpRules: index.system().hpRules }
    : undefined;
  const facts = reduce(events, undefined, rules);
  const root = { facts, sheet: derive(facts, index, rules) };
  const actual: Record<string, unknown> = {};
  for (const path of Object.keys(fx.expect)) actual[path] = getPath(root, path);
  return { actual, expected: fx.expect };
}
