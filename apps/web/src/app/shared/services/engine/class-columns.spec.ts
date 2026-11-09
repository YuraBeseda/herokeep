import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { createContentIndex } from '@hk/engine';
import { parsePack } from '@hk/protocol';
import { classColumnKeys, hasProse } from './class-columns';

const parsed = parsePack(
  JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        '..',
        '..',
        'packages/content/dist/packs',
        PACK_ID,
        PACK_VERSION,
        'pack.json',
      ),
      'utf8',
    ),
  ),
);
if (!parsed.ok) throw new Error('pack');
const index = createContentIndex([parsed.pack]);

describe('classColumnKeys', () => {
  it("names the class table's column facts that are feature entities of the pack", () => {
    const barbarian = index.get(`${PACK_ID}:class/barbarian`);
    if (barbarian?.type !== 'class') throw new Error('no barbarian');
    const keys = classColumnKeys(barbarian, index);
    expect(keys.has('barbarian-rages')).toBe(true);
    expect(keys.has('barbarian-rage-damage')).toBe(true);
    // A real feature of the class is not a column.
    expect(keys.has('barbarian-rage')).toBe(false);
  });
});

describe('hasProse', () => {
  it('is false for nothing and for a bracketed placeholder', () => {
    expect(hasProse('')).toBe(false);
    expect(hasProse('   ')).toBe(false);
    expect(hasProse('[Column data]')).toBe(false);
  });

  it('is true for real text', () => {
    expect(hasProse('You can imbue yourself with a primal power.')).toBe(true);
  });
});
