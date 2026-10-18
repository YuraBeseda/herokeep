import { createContentIndex, derive, reduce } from '@hk/engine';
import type { Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.ts';

// Plan 14 task 3 over the real built pack (vendored sources, packages/content/upstream/
// open5e-srd-2024/): the new `overlays/items.json` gives magic items effects for the first time, and
// an attunement-required item's effects activate only while attuned (engine ruling 5).
// - Gloves of Swimming and Climbing (MagicItem srd-2024_gloves-of-swimming-and-climbing, requires
//   attunement): "While wearing these gloves, you have a Climb Speed and a Swim Speed equal to your
//   Speed, and you gain a +5 bonus to Strength (Athletics) checks made to climb or swim."
// - Slippers of Spider Climbing (srd-2024_slippers-of-spider-climbing, requires attunement): "You have
//   a Climb Speed equal to your Speed."
// - Cloak of Arachnida (srd-2024_cloak-of-arachnida, requires attunement): "Poison Resistance. You have
//   Resistance to Poison damage. Spider Climb. You have a Climb Speed equal to your Speed ... Web. You
//   can cast Web (save DC 13). ... Once used, this property can't be used again until the next dawn."
// - Thief Second-Story Work (ClassFeature srd-2024_rogue_thief_second-story-work): "Climber. You gain
//   a Climb Speed equal to your Speed."

const FP = 'srd-5e-2024';
const pack = buildPack();
const index = createContentIndex([pack]);
const rules = { restRules: index.system().restRules, hpRules: index.system().hpRules };

let seq = 0;
const ev = (type: string, payload: unknown): Event => {
  seq += 1;
  return {
    id: `018f7000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    stream: 'char:11111111-1111-7111-8111-111111111111',
    seq,
    ts: '2026-10-18T12:00:00.000Z',
    actor: { userId: 'u1', deviceId: 'd1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
};
const decide = (choiceId: string, selection: string[]) => ev('decision.made', { choiceId, selection });

/** A single-class character (Human, Soldier) at `level`, taking `subclassId` at level 3. */
function char(classId: string, level: number, subclassId?: string): Event[] {
  seq = 0;
  return [
    ev('character.created', {
      name: 'Lark',
      system: '5e-2024',
      corePack: { id: FP, version: '0.1.0' },
      engineVersion: '0.1.0',
      grammaticalGender: 'feminine',
    }),
    decide(`${FP}:system/5e-2024@0/species`, [`${FP}:species/human`]),
    decide(`${FP}:system/5e-2024@0/background`, [`${FP}:background/soldier`]),
    decide(`${FP}:background/soldier@0/ability-scores`, ['str:+2', 'con:+1']),
    decide(`${FP}:system/5e-2024@0/ability-scores`, ['str:10', 'dex:15', 'con:13', 'int:10', 'wis:14', 'cha:12']),
    ...Array.from({ length: level }, (_, i) =>
      ev('level.gained', {
        classId,
        level: i + 1,
        hpRoll: 'average',
        ...(i + 1 === 3 && subclassId ? { subclassId } : {}),
      }),
    ),
  ];
}

interface Worn {
  slug: string;
  attuned: boolean;
}
/** Derives the character with `items` (pack item slugs) equipped, each attuned or not. */
function sheet(events: Event[], items: Worn[] = []) {
  const facts = reduce(events, undefined, rules);
  facts.inventory = items.map((it, i) => ({
    instanceId: `i${i}`,
    itemId: `${FP}:item/${it.slug}`,
    qty: 1,
    equipped: true,
    attuned: it.attuned,
  }));
  return derive(facts, index, rules);
}

const fighter = () => char(`${FP}:class/fighter`, 1);
const attuned = (slug: string): Worn => ({ slug, attuned: true });
const wornOnly = (slug: string): Worn => ({ slug, attuned: false });

describe('magic item effects (items overlay)', () => {
  it('Slippers of Spider Climbing, attuned: Climb Speed equals Speed', () => {
    const s = sheet(fighter(), [attuned('slippers-of-spider-climbing')]);
    expect(s.speed['walk']!.value).toBe(30);
    expect(s.speed['climb']?.value).toBe(30);
  });

  it('Slippers worn but NOT attuned grant nothing (attunement gate)', () => {
    const s = sheet(fighter(), [wornOnly('slippers-of-spider-climbing')]);
    expect(Object.keys(s.speed)).toEqual(['walk']);
  });

  it('Gloves of Swimming and Climbing, attuned: Climb and Swim equal Speed, Athletics +5', () => {
    const bare = sheet(fighter());
    const s = sheet(fighter(), [attuned('gloves-of-swimming-and-climbing')]);
    expect(s.speed['climb']?.value).toBe(30);
    expect(s.speed['swim']?.value).toBe(30);
    expect(s.skills['athletics']!.total.value).toBe(bare.skills['athletics']!.total.value + 5);

    const worn = sheet(fighter(), [wornOnly('gloves-of-swimming-and-climbing')]);
    expect(Object.keys(worn.speed)).toEqual(['walk']);
    expect(worn.skills['athletics']!.total.value).toBe(bare.skills['athletics']!.total.value);
  });

  it('Cloak of Arachnida, attuned: Poison Resistance, Climb = Speed, Web castable once per dawn', () => {
    const s = sheet(fighter(), [attuned('cloak-of-arachnida')]);
    expect(s.speed['climb']?.value).toBe(30);
    expect(s.resistances).toEqual([{ type: 'poison', sources: [`${FP}:item/cloak-of-arachnida`] }]);
    const web = s.resources.find((r) => r.id === 'web');
    expect(web).toMatchObject({ max: { value: 1 }, used: 0, reset: 'dawn' });
    expect(s.freeCasts).toEqual([{ spellId: `${FP}:spell/web`, resourceId: 'web', level: 2 }]);

    const worn = sheet(fighter(), [wornOnly('cloak-of-arachnida')]);
    expect(worn.resistances).toBeUndefined();
    expect(worn.resources.some((r) => r.id === 'web')).toBe(false);
    expect(worn.freeCasts).toBeUndefined();
  });

  it('several "equal to your Speed" sources share a key: the climb speed is the max, not a sum', () => {
    const s = sheet(fighter(), [
      attuned('slippers-of-spider-climbing'),
      attuned('gloves-of-swimming-and-climbing'),
      attuned('cloak-of-arachnida'),
    ]);
    expect(s.speed['climb']?.value).toBe(30);
    expect(s.speed['swim']?.value).toBe(30);
  });
});

describe('Thief Second-Story Work (Climber)', () => {
  const rogue = `${FP}:class/rogue`;
  const thief = `${FP}:subclass/thief`;

  it('Thief 3 has a Climb Speed equal to Speed; Rogue 2 has none', () => {
    expect(sheet(char(rogue, 3, thief)).speed['climb']?.value).toBe(30);
    expect(Object.keys(sheet(char(rogue, 2)).speed)).toEqual(['walk']);
  });

  it('stacks with attuned Slippers as one climb speed (shared key)', () => {
    expect(sheet(char(rogue, 3, thief), [attuned('slippers-of-spider-climbing')]).speed['climb']?.value).toBe(30);
  });
});
