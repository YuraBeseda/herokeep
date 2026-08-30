import { readFileSync, readdirSync } from 'node:fs';
import { type Event, parseEvent } from '@hk/protocol';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadFixturePack } from './fixtures.ts';

export interface GoldenFixture {
  name: string;
  packs: string[];
  events: Event[];
  expect: Record<string, unknown>;
}

const goldenDir = new URL('../golden/', import.meta.url);

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
  const packs = fx.packs.map(loadFixturePack);
  const index = createContentIndex(packs);
  if (index.diagnostics.length > 0) throw new Error(`${fx.name}: ${JSON.stringify(index.diagnostics)}`);
  const events = fx.events.map((e) => {
    const r = parseEvent(e);
    if (!r.ok) throw new Error(`${fx.name}: bad event ${JSON.stringify(r.issues)}`);
    return r.event;
  });
  const facts = reduce(events);
  const root = { facts, sheet: derive(facts, index) };
  const actual: Record<string, unknown> = {};
  for (const path of Object.keys(fx.expect)) actual[path] = getPath(root, path);
  return { actual, expected: fx.expect };
}
