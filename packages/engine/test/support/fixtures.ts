import { readFileSync } from 'node:fs';
import { type Pack, parsePack } from '@hk/protocol';

export function loadFixturePack(name: string): Pack {
  const r = parsePack(
    JSON.parse(readFileSync(new URL(`../../../protocol/test/fixtures/packs/${name}.json`, import.meta.url), 'utf8')),
  );
  if (!r.ok) throw new Error(name);
  return r.pack;
}
