import { type Event } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { reduce } from '../../src/reduce/reducer.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);
const stream = 'char:2b7a1f22-1111-4c9d-a8f2-0a1b2c3d4e5f';
const ev = (n: number, type: string, payload: unknown): Event => ({
  id: `018f6d2e-7b1a-7c3d-9e4f-${String(n).padStart(12, '0')}`,
  stream,
  seq: n,
  ts: '2026-08-30T12:00:00.000Z',
  actor: { userId: 'u', deviceId: 'd', role: 'owner' },
  type,
  v: 1,
  payload,
});
const created = ev(1, 'character.created', {
  name: 'Ivan',
  system: 'mini',
  corePack: { id: 'core-mini', version: '1.0.0' },
  engineVersion: '0.1.0',
  grammaticalGender: 'masculine',
});

describe('derive (1a skeleton)', () => {
  it('lists every undecided creation-time choice, sorted by id', () => {
    const sheet = derive(reduce([created]), index);
    expect(sheet.level).toBe(0);
    expect(sheet.outstandingChoices.map((c) => c.choiceId)).toEqual([
      'core-mini:system/mini@0/ability-scores',
      'core-mini:system/mini@0/background',
      'core-mini:system/mini@0/species',
    ]);
    // derive() is called without `rules` here (R-pf2): HP still derives (as an average-based
    // approximation) but pushes a warning saying so.
    expect(sheet.issues).toEqual([expect.objectContaining({ severity: 'warning', code: 'derive.noSystemRules' })]);
  });

  it("drops decided choices and adds the chosen entity's own creation choices", () => {
    const decided = ev(2, 'decision.made', {
      choiceId: 'core-mini:system/mini@0/species',
      selection: ['homebrew-mini:species/catfolk'],
    });
    const sheet = derive(reduce([created, decided]), index);
    expect(sheet.outstandingChoices.map((c) => c.choiceId)).toEqual([
      'core-mini:system/mini@0/ability-scores',
      'core-mini:system/mini@0/background',
      'homebrew-mini:species/catfolk@0/whisker-style',
    ]);
    const whiskerDecided = ev(3, 'decision.made', {
      choiceId: 'homebrew-mini:species/catfolk@0/whisker-style',
      selection: ['fancy'],
    });
    const sheetAfterWhisker = derive(reduce([created, decided, whiskerDecided]), index);
    expect(sheetAfterWhisker.outstandingChoices.map((c) => c.choiceId)).toEqual([
      'core-mini:system/mini@0/ability-scores',
      'core-mini:system/mini@0/background',
    ]);
  });

  it('reports unknown decisions and missing slot choices as issues', () => {
    const bogus = ev(2, 'decision.made', {
      choiceId: 'core-mini:system/mini@0/nope',
      selection: ['x'],
    });
    expect(derive(reduce([created, bogus]), index).issues.map((i) => i.code)).toEqual([
      'decision.unknownChoice',
      'derive.noSystemRules',
    ]);
    const core = loadFixturePack('core-mini');
    const sys = core.entities.find((e) => e.type === 'system')!;
    sys.choices = sys.choices.filter((c) => !c.id.endsWith('/background'));
    const sheet = derive(reduce([created]), createContentIndex([core]));
    expect(sheet.issues.map((i) => i.code)).toEqual(['system.slotChoiceMissing', 'derive.noSystemRules']);
  });
});

// Task 1 (phase 1b plan 5 ledger): outstandingChoices' third source — a decision-selected
// feat/feature entity's OWN choices, surfaced once the `at` gate they carry is satisfied. A
// dedicated `asi-mini` fixture pack (loaded only here, not via the module-level `index` shared by
// every other test above) declares `asi-mini:feat/ability-score-improvement`, whose own
// `@4/ability-scores` choice is `at: { kind: 'level', level: 4 }` (mirrors the real SRD ASI feat),
// selectable via an override-added level-4 row on `core-mini:class/fighter`
// (`core-mini:class/fighter@4/feat`, a `classLevel` choice). Kept out of the shared content-mini
// pack deliberately — content-mini is asserted against by index-position/name in several other
// packages' tests (e.g. i18n search ranking, pack diff), and a new entity there would collide.
describe('outstandingChoices: selected entities surface their own choices', () => {
  const asiIndex = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('asi-mini')]);
  const fighterId = 'core-mini:class/fighter';
  const featId = 'asi-mini:feat/ability-score-improvement';
  const classFeatChoiceId = `${fighterId}@4/feat`;
  const featChoiceId = `${featId}@4/ability-scores`;

  // level.gained requires exactly current+1 each time — level 1, 2, 3, then 4.
  const toLevel4 = [1, 2, 3, 4].map((level, i) => ev(2 + i, 'level.gained', { classId: fighterId, level }));

  it("does not surface the feat's own choice before the feat is chosen, even once the class reaches level 4", () => {
    const sheet = derive(reduce([created, ...toLevel4]), asiIndex);
    const ids = sheet.outstandingChoices.map((c) => c.choiceId);
    expect(ids).toContain(classFeatChoiceId); // the class-level choice that picks the feat IS outstanding
    expect(ids).not.toContain(featChoiceId); // but the feat's own choice isn't, since nothing selected it yet
  });

  it("surfaces the feat's own level-gated choice once the feat is chosen and the class is at that level", () => {
    const pickFeat = ev(6, 'decision.made', { choiceId: classFeatChoiceId, selection: [featId] });
    const sheet = derive(reduce([created, ...toLevel4, pickFeat]), asiIndex);
    // classFeatChoiceId itself is now decided, so it's no longer outstanding — but the feat's own
    // choice, newly surfaced by having been selected, is.
    expect(sheet.outstandingChoices.map((c) => c.choiceId)).not.toContain(classFeatChoiceId);
    expect(sheet.outstandingChoices.find((c) => c.choiceId === featChoiceId)).toEqual({
      choiceId: featChoiceId,
      ownerId: featId,
      count: 1,
    });
  });

  it('stops listing the surfaced choice once it is decided', () => {
    const pickFeat = ev(6, 'decision.made', { choiceId: classFeatChoiceId, selection: [featId] });
    const decideAbilities = ev(7, 'decision.made', { choiceId: featChoiceId, selection: ['+2/+1'] });
    const sheet = derive(reduce([created, ...toLevel4, pickFeat, decideAbilities]), asiIndex);
    expect(sheet.outstandingChoices.map((c) => c.choiceId)).not.toContain(featChoiceId);
  });
});
