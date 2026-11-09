import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { CharacterStore } from '@shared/stores/character.store';
import { seedFighter } from '../../testing/character-fixtures';
import { RU_ACTION_SURGE_NAME, ruTranslationPack, setupLeafSpec } from '../play-spec-support';
import { FeaturesLeafComponent } from './features-leaf.component';

// `ActionView.name` is baked English; `.source` is a resolvable entity id the leaf prefers.
describe('FeaturesLeafComponent — name localization', () => {
  // The description drawer links to the library, so it needs a router.
  setupLeafSpec([ruTranslationPack], [provideRouter([])]);

  it("renders action-surge's LOCALIZED granting-feature name (not the baked 'Action Surge') once the locale switches to ru", async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    // Fighter-2's own row grants `feature/fighter-action-surge` (an `action.define`) with no
    // choices of its own — a bare `level.gained` is enough.
    await characterStore.appendTx([
      {
        type: 'level.gained',
        v: 1,
        payload: { classId: 'srd-5e-2024:class/fighter', level: 2, hpRoll: 5 },
      },
    ]);

    const fixture = TestBed.createComponent(FeaturesLeafComponent);
    await fixture.whenStable();
    TestBed.inject(LocaleService).setLocale('ru');
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.querySelector('.features')?.textContent ?? '';
    expect(text).toContain(RU_ACTION_SURGE_NAME);
    expect(text).not.toContain('Action Surge');
  });

  it('lists a feature row per action with a Details button that opens the description drawer', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([
      {
        type: 'level.gained',
        v: 1,
        payload: { classId: 'srd-5e-2024:class/fighter', level: 2, hpRoll: 5 },
      },
    ]);

    const fixture = TestBed.createComponent(FeaturesLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('hk-description-drawer')).toBeNull();

    compiled.querySelector<HTMLButtonElement>('hk-feature-row button')!.click();
    await fixture.whenStable();

    expect(compiled.querySelector('hk-description-drawer')).not.toBeNull();
  });
});
