import { TestBed } from '@angular/core/testing';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../../../assets/i18n/characters/en.json';
import { seedFighter } from '../../testing/character-fixtures';
import {
  buttonNamed,
  pollUntil,
  RU_SECOND_WIND_NAME,
  ruTranslationPack,
  setupLeafSpec,
} from '../play-spec-support';
import { ResourcesLeafComponent } from './resources-leaf.component';

// task-1-brief.md carry fix (plan-5 review finding): `ResourceView.name` is a baked-at-build-time
// ENGLISH string, but `.source` is always a resolvable entity id — the leaf prefers
// `localizer.name(view.source)`. `PlayNames` falls back to the baked name for an unresolved source
// (see `play-names.spec.ts`).
describe('ResourcesLeafComponent — name localization', () => {
  setupLeafSpec([ruTranslationPack]);

  it("renders second-wind's LOCALIZED granting-feature name (not the baked 'Second Wind') once the locale switches to ru", async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(ResourcesLeafComponent);
    await fixture.whenStable();
    TestBed.inject(LocaleService).setLocale('ru');
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const resourceCard = compiled.querySelector('.resources__item');
    expect(resourceCard).not.toBeNull();
    const text = resourceCard!.textContent ?? '';
    expect(text).toContain(RU_SECOND_WIND_NAME);
    expect(text).not.toContain('Second Wind');
  });
});

// task-3-brief.md: resource spend / restore. The pool bar's wax seals are display only; Use spends one
// use and Restore gives one back.
describe('ResourcesLeafComponent — spend and restore', () => {
  setupLeafSpec();

  it('Use appends resource.spent{resourceId} (default +1); Restore appends resource.restored{resourceId,count:1} and decrements by exactly one, not a full reset', async () => {
    await seedFighter('Ivan'); // fighter-1's second-wind resource: max 2, display 'pips'
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(ResourcesLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const resourceCard = compiled.querySelector<HTMLElement>(
      '.resources__item[data-resource="second-wind"]',
    )!;

    buttonNamed(resourceCard, charactersEn.sheet.resources.use).click();
    await pollUntil(fixture, () => characterStore.sheet()?.resources[0]?.used === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'resource.spent',
      payload: { resourceId: 'second-wind' },
    });

    buttonNamed(resourceCard, charactersEn.sheet.resources.use).click();
    await pollUntil(fixture, () => characterStore.sheet()?.resources[0]?.used === 2);
    // Nothing left: Use is now disabled.
    expect(buttonNamed(resourceCard, charactersEn.sheet.resources.use).disabled).toBe(true);

    buttonNamed(resourceCard, charactersEn.sheet.resources.restore).click();
    await pollUntil(fixture, () => characterStore.sheet()?.resources[0]?.used === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'resource.restored',
      payload: { resourceId: 'second-wind', count: 1 },
    });
  });
});
