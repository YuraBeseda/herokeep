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

describe('FeaturesLeafComponent — features by source', () => {
  setupLeafSpec([ruTranslationPack], [provideRouter([])]);

  const fighterTwo = {
    type: 'level.gained',
    v: 1,
    payload: { classId: 'srd-5e-2024:class/fighter', level: 2, hpRoll: 5 },
  } as const;

  it('groups the rows under the class that grants them, with the level gained as a badge', async () => {
    await seedFighter('Ivan');
    await TestBed.inject(CharacterStore).appendTx([fighterTwo]);

    const fixture = TestBed.createComponent(FeaturesLeafComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const groups = el.querySelectorAll('.features__group');
    expect(groups.length).toBeGreaterThan(0);
    const fighterGroup = groups[0];
    expect(fighterGroup.querySelector('.features__heading')?.textContent).toContain('Fighter');
    const surge = Array.from(fighterGroup.querySelectorAll('hk-feature-row')).find((row) =>
      row.textContent?.includes('Action Surge'),
    );
    expect(surge?.querySelector('.hk-lvlbadge')?.textContent?.trim()).toBe('2');
  });

  it('hints "From <source>, level N" on the badge and the glyph, for the screen reader too', async () => {
    await seedFighter('Ivan');
    await TestBed.inject(CharacterStore).appendTx([fighterTwo]);

    const fixture = TestBed.createComponent(FeaturesLeafComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.hk-lvlbadge')?.getAttribute('aria-label')).toBe(
      'From Fighter, level 2',
    );
    expect(el.querySelector('.hk-feat__src')?.getAttribute('aria-label')).toMatch(
      /^From Fighter, level \d+$/,
    );
  });

  it('keeps the linked resource on a class row next to its level badge', async () => {
    await seedFighter('Ivan');
    await TestBed.inject(CharacterStore).appendTx([fighterTwo, ...paladinThree]);

    const fixture = TestBed.createComponent(FeaturesLeafComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const withResource = el.querySelector('hk-feature-row:has(.hk-feat__resource)')!;
    expect(withResource.querySelector('.hk-lvlbadge')).not.toBeNull();
    expect(withResource.querySelector('.hk-feat__resource')!.textContent).toContain(
      'Channel Divinity',
    );
  });

  const paladinThree = [1, 2, 3].map((level) => ({
    type: 'level.gained' as const,
    v: 1 as const,
    payload: { classId: 'srd-5e-2024:class/paladin', level, hpRoll: 'average' as const },
  }));

  it('draws one class group per class in class order for a multiclass hero', async () => {
    await seedFighter('Ivan');
    const store = TestBed.inject(CharacterStore);
    await store.appendTx([fighterTwo, ...paladinThree]);

    const fixture = TestBed.createComponent(FeaturesLeafComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const headings = Array.from(el.querySelectorAll('.features__heading')).map((h) =>
      h.textContent?.trim(),
    );
    expect(headings.slice(0, 2)).toEqual(['Fighter', 'Paladin']);
    expect(el.querySelectorAll('.features__group').length).toBe(headings.length);
  });
});
