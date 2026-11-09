import { TestBed } from '@angular/core/testing';
import { CharacterStore } from '@shared/stores/character.store';
import { CreateWizardState } from '../../../create-wizard/create-wizard.state';
import { setupLeafSpec } from '../play-spec-support';
import { ProficienciesLeafComponent } from './proficiencies-leaf.component';

describe('ProficienciesLeafComponent', () => {
  setupLeafSpec();

  // Plan 13 task 2: tool proficiencies get their own "Tools" group, by localized item name. The
  // Soldier's Gaming Set comes from its real `soldier@0/tools` pick (plan 14 task 2) and the bard's
  // instruments from its real `bard@1/tools` pick, both recorded through the creation wizard's own
  // transaction.
  it('lists tool proficiencies under a Tools heading: the background tool and the bard instrument pick', async () => {
    const state = TestBed.runInInjectionContext(() => new CreateWizardState());
    state.name.set('Lia');
    state.gender.set('feminine');
    state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
    state.setDecision('srd-5e-2024:system/5e-2024@0/background', [
      'srd-5e-2024:background/soldier',
    ]);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
    state.setDecision('srd-5e-2024:system/5e-2024@0/class', ['srd-5e-2024:class/bard']);
    state.setDecision('srd-5e-2024:class/bard@1/tools', [
      'srd-5e-2024:item/musical-instrument-lute',
      'srd-5e-2024:item/musical-instrument-flute',
      'srd-5e-2024:item/musical-instrument-drum',
    ]);
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create(state.name(), state.gender());
    const [, ...rest] = state.buildTransaction();
    await characterStore.appendTx(rest);

    const fixture = TestBed.createComponent(ProficienciesLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const subtitles = Array.from(compiled.querySelectorAll('.prof__subtitle')).map((el) =>
      el.textContent?.trim(),
    );
    expect(subtitles).toContain('Tools');
    const tools = Array.from(compiled.querySelectorAll('.prof__tools li')).map((el) =>
      el.textContent?.trim(),
    );
    expect(tools).toEqual([
      'Gaming Set, Dice',
      'Musical Instrument, Drum',
      'Musical Instrument, Flute',
      'Musical Instrument, Lute',
    ]);
    // The general proficiency list no longer repeats the tool rows.
    const others = Array.from(compiled.querySelectorAll('.prof__list li')).map(
      (el) => el.textContent ?? '',
    );
    expect(others.some((text) => text.includes('Gaming Set') || text.includes('lute'))).toBe(false);
  });
});
