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
