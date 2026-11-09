import { buildCampaignStrap, type CampaignStrapState } from './campaign-strap';

const handlers = () => ({
  effect: vi.fn(),
  toggleSession: vi.fn(),
  exportCampaign: vi.fn(),
  openSheet: vi.fn(),
});
const base: CampaignStrapState = {
  role: 'dm',
  selected: false,
  sessionActive: false,
  canOpenSheet: false,
  scope: ['/g', 'c1'],
};

describe('buildCampaignStrap', () => {
  it('gives the DM Damage, Heal, Condition, XP, Item in zone 2 and Session, Export in zone 3', () => {
    const strap = buildCampaignStrap(base, handlers());
    expect(strap.primary.map((a) => a.id)).toEqual(['damage', 'heal', 'condition', 'xp', 'item']);
    expect(strap.secondary?.map((a) => a.id)).toEqual(['session', 'export']);
    expect(strap.scope).toEqual(['/g', 'c1']);
  });

  it('disables every effect with a reason while no member is selected', () => {
    const strap = buildCampaignStrap(base, handlers());
    for (const action of strap.primary) {
      expect(action.disabled, action.id).toBe(true);
      expect(action.disabledReason, action.id).toBe('shell.strap.campaign-select-member');
    }
  });

  it('enables the effects for a selected member and routes each to its kind', () => {
    const h = handlers();
    const strap = buildCampaignStrap({ ...base, selected: true }, h);
    for (const action of strap.primary) {
      expect(action.disabled, action.id).toBeFalsy();
      expect(action.disabledReason, action.id).toBeUndefined();
      action.run();
    }
    expect(h.effect.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      'damage',
      'heal',
      'condition',
      'xp',
      'item',
    ]);
  });

  it('keeps Session and Export available with no selection and labels Session by its state', () => {
    const h = handlers();
    const idle = buildCampaignStrap(base, h);
    const session = idle.secondary!.find((a) => a.id === 'session')!;
    expect(session.disabled).toBeFalsy();
    expect(session.label).toBe('shell.strap.campaign-session-start');
    session.run();
    idle.secondary!.find((a) => a.id === 'export')!.run();
    expect(h.toggleSession).toHaveBeenCalledOnce();
    expect(h.exportCampaign).toHaveBeenCalledOnce();

    const live = buildCampaignStrap({ ...base, sessionActive: true }, h);
    expect(live.secondary!.find((a) => a.id === 'session')!.label).toBe(
      'shell.strap.campaign-session-end',
    );
  });

  it('gives a player only Open my sheet (when they have a hero) and no zone 3', () => {
    const h = handlers();
    const none = buildCampaignStrap({ ...base, role: 'player' }, h);
    expect(none.primary).toEqual([]);
    expect(none.secondary ?? []).toEqual([]);
    const withHero = buildCampaignStrap({ ...base, role: 'player', canOpenSheet: true }, h);
    expect(withHero.primary.map((a) => a.id)).toEqual(['open-sheet']);
    withHero.primary[0].run();
    expect(h.openSheet).toHaveBeenCalledOnce();
  });
});
