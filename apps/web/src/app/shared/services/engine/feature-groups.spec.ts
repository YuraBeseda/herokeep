import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { createContentIndex, type Facts } from '@hk/engine';
import { parsePack, type ClassEntity } from '@hk/protocol';
import { featureOrigins, groupFeaturesBySource, type FeatureOrigin } from './feature-groups';

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
const corePack = parsed.pack;

interface V {
  readonly id: string;
  readonly origin: FeatureOrigin | null;
}
const view = (id: string, origin: FeatureOrigin | null): V => ({ id, origin });
const ids = (list: readonly V[]): string[] => list.map((v) => v.id);

describe('groupFeaturesBySource', () => {
  it('orders the groups Class, Subclass, Species, Background, Feats, Chosen options, then the rest', () => {
    const groups = groupFeaturesBySource([
      view('o', { kind: 'option', entityId: 'p:feature/o', rank: 0 }),
      view('x', null),
      view('f', { kind: 'feat', entityId: 'p:feat/f', rank: 0 }),
      view('b', { kind: 'background', entityId: 'p:background/b', rank: 0 }),
      view('s', { kind: 'species', entityId: 'p:species/s', rank: 0 }),
      view('sc', { kind: 'subclass', entityId: 'p:subclass/sc', rank: 0, level: 3 }),
      view('c', { kind: 'class', entityId: 'p:class/c', rank: 0, level: 1 }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual([
      'class',
      'subclass',
      'species',
      'background',
      'feat',
      'option',
      'other',
    ]);
  });

  it('makes one Class group per class in class order, each feature by the level gained', () => {
    const groups = groupFeaturesBySource([
      view('rogue-2', { kind: 'class', entityId: 'p:class/rogue', rank: 1, level: 2 }),
      view('fighter-5', { kind: 'class', entityId: 'p:class/fighter', rank: 0, level: 5 }),
      view('fighter-2', { kind: 'class', entityId: 'p:class/fighter', rank: 0, level: 2 }),
      view('rogue-1', { kind: 'class', entityId: 'p:class/rogue', rank: 1, level: 1 }),
    ]);
    expect(groups.map((g) => g.entityId)).toEqual(['p:class/fighter', 'p:class/rogue']);
    expect(ids(groups[0].features)).toEqual(['fighter-2', 'fighter-5']);
    expect(ids(groups[1].features)).toEqual(['rogue-1', 'rogue-2']);
  });

  it('keeps every feature: one without provenance lands in a trailing group', () => {
    const input = [
      view('a', null),
      view('b', { kind: 'class', entityId: 'p:class/c', rank: 0, level: 1 }),
      view('c', null),
    ];
    const groups = groupFeaturesBySource(input);
    expect(groups.flatMap((g) => ids(g.features)).sort()).toEqual(['a', 'b', 'c']);
    expect(groups.at(-1)!.kind).toBe('other');
    expect(ids(groups.at(-1)!.features)).toEqual(['a', 'c']);
  });

  it('pools every feat into one Feats group and every chosen option into one options group', () => {
    const groups = groupFeaturesBySource([
      view('a', { kind: 'feat', entityId: 'p:feat/one', rank: 0 }),
      view('b', { kind: 'feat', entityId: 'p:feat/two', rank: 0 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(ids(groups[0].features)).toEqual(['a', 'b']);
  });

  it('returns no groups for no features', () => {
    expect(groupFeaturesBySource([])).toEqual([]);
  });
});

describe('featureOrigins', () => {
  const index = createContentIndex([corePack]);
  const facts = (classes: Facts['classes'], decisions: Facts['decisions'] = {}): Facts =>
    ({ classes, decisions }) as Facts;
  const fighter = `${PACK_ID}:class/fighter`;
  const surge = `${PACK_ID}:feature/fighter-action-surge`;

  it('names the class and the level a feature was gained at, from the class level rows', () => {
    const origin = featureOrigins(facts([{ classId: fighter, level: 2 }]), index).get(surge);
    expect(origin).toMatchObject({ kind: 'class', entityId: fighter, level: 2, rank: 0 });
  });

  it('does not credit a level row above the character level', () => {
    expect(featureOrigins(facts([{ classId: fighter, level: 1 }]), index).has(surge)).toBe(false);
  });

  it('ranks each class by the order it was gained in a multiclass hero', () => {
    const rogue = `${PACK_ID}:class/rogue`;
    const origins = featureOrigins(
      facts([
        { classId: fighter, level: 2 },
        { classId: rogue, level: 1 },
      ]),
      index,
    );
    expect(origins.get(surge)?.rank).toBe(0);
    const rogueRow = (index.get(rogue) as ClassEntity).levels[0].grants[0].feature;
    expect(origins.get(rogueRow)).toMatchObject({ kind: 'class', entityId: rogue, rank: 1 });
  });

  it('files a feat picked by a decision under Feats', () => {
    const feat = index.byType('feat')[0].id;
    const origin = featureOrigins(facts([], { 'x@1/feat': [feat] }), index).get(feat);
    expect(origin).toMatchObject({ kind: 'feat', entityId: feat });
  });
});
