import { TestBed } from '@angular/core/testing';
import { CampaignSelectionService } from './campaign-selection.service';

const ilyana = { characterId: 'c1', name: 'Ilyana' };
const marek = { characterId: 'c2', name: 'Marek' };

describe('CampaignSelectionService', () => {
  const service = (): CampaignSelectionService => TestBed.inject(CampaignSelectionService);

  it('selects one member at a time and toggles the same one off', () => {
    const s = service();
    expect(s.selected()).toBeNull();
    s.toggle(ilyana);
    expect(s.selected()).toEqual(ilyana);
    s.toggle(marek);
    expect(s.selected()).toEqual(marek);
    s.toggle(marek);
    expect(s.selected()).toBeNull();
  });

  it('turns an effect request into a command for the selected member, a new nonce each time', () => {
    const s = service();
    s.requestEffect('damage');
    expect(s.request()).toBeNull();
    s.select(ilyana);
    s.requestEffect('damage');
    const first = s.request();
    expect(first).toMatchObject({ kind: 'damage', characterId: 'c1' });
    s.requestEffect('damage');
    expect(s.request()!.nonce).not.toBe(first!.nonce);
  });

  it('clear drops the selection and any pending request', () => {
    const s = service();
    s.select(ilyana);
    s.requestEffect('xp');
    s.clear();
    expect(s.selected()).toBeNull();
    expect(s.request()).toBeNull();
  });
});
