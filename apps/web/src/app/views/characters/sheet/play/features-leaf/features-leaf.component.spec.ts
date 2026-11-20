import { computed } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Sheet } from '@hk/engine';
import { provideRouter } from '@angular/router';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { CharacterStore } from '@shared/stores/character.store';
import { seedFighter } from '../../testing/character-fixtures';
import { RU_ACTION_SURGE_NAME, ruTranslationPack, setupLeafSpec } from '../play-spec-support';
import { PeekService } from '../../../../../ui/description-drawer/peek.service';
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

  it('lists a feature row per action with a Details button that opens the description peek', async () => {
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
    expect(TestBed.inject(PeekService).current()).toBeNull();

    compiled.querySelector<HTMLButtonElement>('hk-feature-row button')!.click();
    await fixture.whenStable();

    expect(TestBed.inject(PeekService).current()?.entityId).toMatch(/^srd-5e-2024:feature\/fighter-/);
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

    // Action Surge (gained at level 2): the leaf now also lists the level-1 features before it.
    const surge = Array.from(el.querySelectorAll('hk-feature-row')).find((row) =>
      row.textContent?.includes('Action Surge'),
    );
    expect(surge?.querySelector('.hk-lvlbadge')?.getAttribute('aria-label')).toBe(
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

describe('FeaturesLeafComponent — every granted feature (R64)', () => {
  setupLeafSpec([ruTranslationPack], [provideRouter([])]);

  const barbarianOne = {
    type: 'level.gained',
    v: 1,
    payload: { classId: 'srd-5e-2024:class/barbarian', level: 1, hpRoll: 'average' },
  } as const;

  let current: ComponentFixture<FeaturesLeafComponent>;
  async function mountBarbarianFighter(): Promise<HTMLElement> {
    await seedFighter('Ivan');
    await TestBed.inject(CharacterStore).appendTx([barbarianOne]);
    current = TestBed.createComponent(FeaturesLeafComponent);
    await current.whenStable();
    return current.nativeElement as HTMLElement;
  }

  const groupOf = (el: HTMLElement, heading: string): Element | undefined =>
    Array.from(el.querySelectorAll('.features__group')).find(
      (g) => g.querySelector('.features__heading')?.textContent?.trim() === heading,
    );
  const rowNamed = (group: Element | undefined, name: string): Element | undefined =>
    Array.from(group?.querySelectorAll('hk-feature-row') ?? []).find(
      (row) => row.querySelector('.hk-feat__name')?.textContent?.trim() === name,
    );

  it('gives a Barbarian 1 + Fighter 1 hero a Class group each, with Rage in the Barbarian one', async () => {
    const el = await mountBarbarianFighter();

    const headings = Array.from(el.querySelectorAll('.features__heading')).map((h) =>
      h.textContent?.trim(),
    );
    expect(headings.slice(0, 2)).toEqual(['Fighter', 'Barbarian']);
    expect(rowNamed(groupOf(el, 'Barbarian'), 'Rage')).toBeTruthy();
    expect(rowNamed(groupOf(el, 'Barbarian'), 'Unarmored Defense')).toBeTruthy();
  });

  it('lists a feature that has no action with its level badge, a summary and a details button', async () => {
    const el = await mountBarbarianFighter();

    const rage = rowNamed(groupOf(el, 'Barbarian'), 'Rage')!;
    expect(rage.querySelector('.hk-lvlbadge')?.textContent?.trim()).toBe('1');
    expect(rage.querySelector('.hk-lvlbadge')?.getAttribute('aria-label')).toBe(
      'From Barbarian, level 1',
    );
    expect(rage.querySelector('button')).not.toBeNull();
    expect(rage.parentElement?.querySelector('.features__summary')?.textContent).toContain(
      'primal power',
    );
  });

  it('opens the description peek from a feature that has no action', async () => {
    const el = await mountBarbarianFighter();
    expect(TestBed.inject(PeekService).current()).toBeNull();

    rowNamed(groupOf(el, 'Barbarian'), 'Rage')!.querySelector('button')!.click();
    await current.whenStable();

    expect(TestBed.inject(PeekService).current()?.entityId).toBe(
      'srd-5e-2024:feature/barbarian-rage',
    );
  });

  it('leaves out the class-table column features, which are table data with no prose', async () => {
    const el = await mountBarbarianFighter();

    const names = Array.from(el.querySelectorAll('.hk-feat__name')).map((n) =>
      n.textContent?.trim(),
    );
    for (const column of ['Rages', 'Rage Damage', 'Proficiency Bonus', 'Weapon Mastery Count']) {
      expect(names).not.toContain(column);
    }
  });
});

describe('FeaturesLeafComponent — a feature whose entry is missing (M3)', () => {
  setupLeafSpec([ruTranslationPack], [provideRouter([])]);

  // Hand-shapes the real persisted sheet (the spells-leaf precedent): no pack in this fixture set
  // has an action whose granting entity is absent, so one is added to the derived sheet.
  function shapeSheet(mutate: (sheet: Sheet) => Sheet): void {
    const store = TestBed.inject(CharacterStore);
    const real = store.sheet;
    Object.defineProperty(store, 'sheet', {
      value: computed(() => {
        const sheet = real();
        return sheet ? mutate(sheet) : sheet;
      }),
    });
  }

  it('draws the details button disabled with a reason, and opens nothing, for an action with no entry', async () => {
    await seedFighter('Ivan');
    shapeSheet((sheet) => ({
      ...sheet,
      actions: [
        ...sheet.actions,
        {
          id: 'ghost-strike',
          name: 'Ghost Strike',
          kind: 'action',
          description: '',
          source: 'srd-5e-2024:feature/not-in-any-pack',
        },
      ],
    }));
    const fixture = TestBed.createComponent(FeaturesLeafComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    const row = Array.from(el.querySelectorAll('hk-feature-row')).find((r) =>
      r.textContent?.includes('Ghost Strike'),
    )!;
    expect(row).toBeTruthy();
    const button = row.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.click();
    await fixture.whenStable();
    expect(TestBed.inject(PeekService).current()).toBeNull();
  });
});
