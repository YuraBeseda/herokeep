import { describe, expect, it } from 'vitest';
import { houseRuleAllows, type HouseRules } from './house-rules';

const rules = (extra: Partial<HouseRules>): { settings: { houseRules: HouseRules } } => ({
  settings: {
    houseRules: {
      strictValidation: true,
      allowOverrides: true,
      editOutsideSession: 'free',
      xpMode: 'xp',
      hpOnLevelUp: 'roll',
      encumbrance: 'standard',
      attunementMax: 3,
      startingLevel: 1,
      ...extra,
    },
  },
});

describe('houseRuleAllows', () => {
  it('allows with no campaign or no settings document', () => {
    expect(houseRuleAllows('startingGold', null)).toBe(true);
    expect(houseRuleAllows('startingGold', { settings: null })).toBe(true);
  });
  it('allows when the key is absent, denies only on an explicit false', () => {
    expect(houseRuleAllows('multiclassing', rules({}))).toBe(true);
    expect(houseRuleAllows('multiclassing', rules({ multiclassing: true }))).toBe(true);
    expect(houseRuleAllows('multiclassing', rules({ multiclassing: false }))).toBe(false);
    expect(houseRuleAllows('playersAddItems', rules({ multiclassing: false }))).toBe(true);
  });
  it('never binds the campaign DM', () => {
    const state = {
      ...rules({ multiclassing: false, playersAddItems: false }),
      members: new Map([
        ['dm1', { role: 'dm' }],
        ['p1', { role: 'player' }],
      ]),
    };
    expect(houseRuleAllows('multiclassing', state, 'dm1')).toBe(true);
    expect(houseRuleAllows('playersAddItems', state, 'dm1')).toBe(true);
    expect(houseRuleAllows('multiclassing', state, 'p1')).toBe(false);
    expect(houseRuleAllows('multiclassing', state, undefined)).toBe(false);
  });
});
