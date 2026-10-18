import { readFileSync } from 'node:fs';
import { type Pack, parsePack } from '@hk/protocol';

export function loadFixturePack(name: string): Pack {
  const r = parsePack(
    JSON.parse(readFileSync(new URL(`../../../protocol/test/fixtures/packs/${name}.json`, import.meta.url), 'utf8')),
  );
  if (!r.ok) throw new Error(name);
  return r.pack;
}

/** Engine-only fixture packs (`packages/engine/test/fixtures/packs/`) — e.g. plan 15's rebase pair. */
export function loadEngineFixturePack(name: string): Pack {
  const r = parsePack(JSON.parse(readFileSync(new URL(`../fixtures/packs/${name}.json`, import.meta.url), 'utf8')));
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.issues)}`);
  return r.pack;
}
