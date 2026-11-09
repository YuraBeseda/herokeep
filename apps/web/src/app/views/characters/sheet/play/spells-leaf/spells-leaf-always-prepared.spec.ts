import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Sheet } from '@hk/engine';
import { ToastService } from '@shared/components/toast/toast.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../../../assets/i18n/characters/en.json';
import { CreateWizardState } from '../../../create-wizard/create-wizard.state';
import { seedWizard } from '../../testing/character-fixtures';
import { PlayActionsService } from '../play-actions.service';
import { configureReal, labelOf } from '../play-spec-support';
import { SpellsLeafComponent } from './spells-leaf.component';

// Hand-shapes the sheet the component reads: no shipped pack content produces a pooled multiclass
// caster in this fixture set (and none grants always-prepared spells yet), so the REAL persisted
// sheet is re-derived through `mutate` before the component is created — everything else (events,
// `appendTx`, `propose.*` against the shaped sheet) stays the real wiring. Must run BEFORE
// `TestBed.createComponent(PlayTabComponent)` (the component captures `characterStore.sheet` once).
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

function resetSpellDb(): Promise<unknown[]> {
  const db = TestBed.inject(HkDb);
  return Promise.all([
    db.events.clear(),
    db.settings.clear(),
    db.snapshots.clear(),
    db.characters.clear(),
  ]);
}

// Plan 12 task 4 (carried from task 3's review): a granted always-prepared spell sits in
// `prepared` but does NOT count against `preparedMax`, and can never be unprepared.
describe('SpellsLeafComponent — always-prepared spells (plan 12 task 4)', () => {
  const WIZARD_CLASS_ID = 'srd-5e-2024:class/wizard';
  const BURNING_HANDS = 'srd-5e-2024:spell/burning-hands';
  const MAGE_ARMOR = 'srd-5e-2024:spell/mage-armor';
  const MAGIC_MISSILE = 'srd-5e-2024:spell/magic-missile';
  const SHIELD_SPELL = 'srd-5e-2024:spell/shield'; // the granted one
  const THUNDERWAVE = 'srd-5e-2024:spell/thunderwave';
  const BANE = 'srd-5e-2024:spell/bane';

  const learned = (spellId: string) => ({
    type: 'spell.learned',
    v: 1,
    payload: { spellId, classId: WIZARD_CLASS_ID, source: 'levelUp' },
  });
  const prepared = (spellId: string) => ({
    type: 'spell.prepared',
    v: 1,
    payload: { spellId, classId: WIZARD_CLASS_ID },
  });

  // Mirrors what derive does for a `spell.grant { alwaysPrepared: true }`: granted spell appended
  // to `prepared` (and `known`) and listed in `alwaysPrepared`.
  function grantShield(): void {
    shapeSheet((sheet) => {
      const [block, ...rest] = sheet.spellcasting;
      const withShield = (list: string[]) =>
        list.includes(SHIELD_SPELL) ? list : [...list, SHIELD_SPELL];
      return {
        ...sheet,
        spellcasting: [
          {
            ...block,
            known: withShield(block.known),
            prepared: withShield(block.prepared),
            alwaysPrepared: [SHIELD_SPELL],
          },
          ...rest,
        ],
      };
    });
  }

  beforeEach(async () => {
    localStorage.removeItem('hk.locale');
    configureReal();
    await resetSpellDb();
  });

  afterEach(() => {
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });

  async function pollUntil(fixture: { whenStable(): Promise<unknown> }, p: () => boolean) {
    for (let i = 0; i < 50 && !p(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
    expect(p()).toBe(true);
  }

  const spellRow = (c: HTMLElement, name: string): HTMLElement =>
    Array.from(c.querySelectorAll<HTMLElement>('.spells__item')).find(
      (r) => r.querySelector('.hk-srow__name')?.textContent?.trim() === name,
    )!;
  const buttonNamed = (c: HTMLElement, text: string): HTMLButtonElement =>
    Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => labelOf(b) === text)!;

  it('cap math ignores the granted spell: with 3 chosen + 1 granted prepared (max 4) a 4th chosen spell can still be prepared', async () => {
    await seedWizard('Elowen');
    const store = TestBed.inject(CharacterStore);
    await store.appendTx([
      learned(BURNING_HANDS),
      learned(MAGE_ARMOR),
      learned(MAGIC_MISSILE),
      learned(THUNDERWAVE),
      prepared(BURNING_HANDS),
      prepared(MAGE_ARMOR),
      prepared(MAGIC_MISSILE),
    ]);
    grantShield();

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const showSpy = vi.spyOn(TestBed.inject(ToastService), 'show');
    // 3 chosen + 1 granted = 4 in `prepared`, but only 3 count against preparedMax 4.
    expect(store.sheet()!.spellcasting[0].prepared).toHaveLength(4);

    const eventsBefore = store.events().length;
    buttonNamed(spellRow(compiled, 'Thunderwave'), charactersEn.sheet.spellcasting.prepare).click();
    await pollUntil(fixture, () => store.events().length > eventsBefore);

    expect(showSpy).not.toHaveBeenCalled();
    expect(store.events().at(-1)).toMatchObject({
      type: 'spell.prepared',
      payload: { spellId: THUNDERWAVE },
    });
  });

  it('cap still blocks once the NON-granted prepared count reaches preparedMax, and the counter excludes the granted spell', async () => {
    await seedWizard('Elowen');
    const store = TestBed.inject(CharacterStore);
    await store.appendTx([
      learned(BURNING_HANDS),
      learned(MAGE_ARMOR),
      learned(MAGIC_MISSILE),
      learned(THUNDERWAVE),
      learned(BANE),
      prepared(BURNING_HANDS),
      prepared(MAGE_ARMOR),
      prepared(MAGIC_MISSILE),
      prepared(THUNDERWAVE), // 4 chosen == preparedMax
    ]);
    grantShield();

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const showSpy = vi.spyOn(TestBed.inject(ToastService), 'show');
    const eventsBefore = store.events().length;

    expect(compiled.querySelector('.spells__prepared-count')?.textContent?.trim()).toBe(
      charactersEn.sheet.spellcasting.preparedOf.replace('{prepared}', '4').replace('{max}', '4'),
    );
    buttonNamed(spellRow(compiled, 'Bane'), charactersEn.sheet.spellcasting.prepare).click();
    await fixture.whenStable();

    expect(store.events().length).toBe(eventsBefore);
    expect(showSpy).toHaveBeenCalledWith('characters.sheet.spellcasting.preparedMaxReached', {
      max: 4,
    });
  });

  it('the granted spell has a DISABLED unprepare control with an accessible reason, plus an "always prepared" marker; a chosen spell stays enabled', async () => {
    await seedWizard('Elowen');
    const store = TestBed.inject(CharacterStore);
    await store.appendTx([learned(BURNING_HANDS), prepared(BURNING_HANDS)]);
    grantShield();

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const reason = charactersEn.sheet.spellcasting.alwaysPreparedReason;

    const shieldRow = spellRow(compiled, 'Shield');
    const toggle = buttonNamed(shieldRow, charactersEn.sheet.spellcasting.unprepare);
    // `hk-button` blocks with `aria-disabled` + the reason (its hint and a hidden description).
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    // `aria-describedby` lists the tooltip and the hidden reason (space-separated ids).
    const described = toggle
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => shieldRow.querySelector(`[id="${id}"]`)?.textContent?.trim());
    expect(described).toContain(reason);
    expect(shieldRow.textContent).toContain(charactersEn.sheet.spellcasting.alwaysPrepared);

    const chosen = buttonNamed(
      spellRow(compiled, 'Burning Hands'),
      charactersEn.sheet.spellcasting.unprepare,
    );
    expect(chosen.getAttribute('aria-disabled')).toBeNull();
    // An enabled control carries no reason: nothing it is described by says why it is blocked.
    const chosenDescriptions = (chosen.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter(Boolean)
      .map((id) => compiled.querySelector(`[id="${id}"]`)?.textContent?.trim());
    expect(chosenDescriptions).not.toContain(reason);
  });

  it('a forced unprepare of the granted spell goes through propose.unprepare and surfaces its refusal as a toast, appending nothing', async () => {
    await seedWizard('Elowen');
    const store = TestBed.inject(CharacterStore);
    grantShield();

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const showSpy = vi.spyOn(TestBed.inject(ToastService), 'show');
    const eventsBefore = store.events().length;
    const block = store.sheet()!.spellcasting[0];

    TestBed.inject(PlayActionsService).togglePrepared(block, SHIELD_SPELL);
    await fixture.whenStable();

    expect(store.events().length).toBe(eventsBefore);
    expect(showSpy).toHaveBeenCalledWith('characters.validation.spell.always-prepared');
  });
});

// Plan 12 task 9 (T4 carry): the always-prepared machinery against REAL pack data — a Paladin 3 /
// Oath of Devotion whose granted spells come from the shipped `spell.grant { alwaysPrepared }`
// effects (no `shapeSheet`), end to end through derive -> store -> play tab.
describe('SpellsLeafComponent — always-prepared spells with the real pack (plan 12 task 9)', () => {
  const PALADIN = 'srd-5e-2024:class/paladin';
  const spellId = (slug: string) => `srd-5e-2024:spell/${slug}`;
  const learned = (slug: string) => ({
    type: 'spell.learned',
    v: 1,
    payload: { spellId: spellId(slug), classId: PALADIN, source: 'levelUp' },
  });
  const prepared = (slug: string) => ({
    type: 'spell.prepared',
    v: 1,
    payload: { spellId: spellId(slug), classId: PALADIN },
  });

  beforeEach(async () => {
    localStorage.removeItem('hk.locale');
    configureReal();
    await resetSpellDb();
  });

  afterEach(() => {
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });

  const spellRow = (c: HTMLElement, name: string): HTMLElement =>
    Array.from(c.querySelectorAll<HTMLElement>('.spells__item')).find(
      (r) => r.querySelector('.hk-srow__name')?.textContent?.trim() === name,
    )!;
  const buttonNamed = (c: HTMLElement, text: string): HTMLButtonElement =>
    Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => labelOf(b) === text)!;

  it('Paladin 3 / Devotion: oath + class grants show as always-prepared, are never unpreparable, and the cap ignores them', async () => {
    // Persist a level-1 paladin through the real create path, then level to 3 taking Devotion.
    const state = TestBed.runInInjectionContext(() => new CreateWizardState());
    state.name.set('Aldis');
    state.gender.set('masculine');
    state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
    state.setDecision('srd-5e-2024:system/5e-2024@0/background', [
      'srd-5e-2024:background/soldier',
    ]);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:15', 'dex:8', 'con:13', 'int:10', 'wis:12', 'cha:14'],
      { method: 'standardArray' },
    );
    state.setDecision('srd-5e-2024:system/5e-2024@0/class', [PALADIN]);
    const store = TestBed.inject(CharacterStore);
    await store.create(state.name().trim(), state.gender());
    const [, ...rest] = state.buildTransaction();
    await store.appendTx(rest);
    await store.appendTx([
      { type: 'level.gained', v: 1, payload: { classId: PALADIN, level: 2, hpRoll: 'average' } },
      {
        type: 'level.gained',
        v: 1,
        payload: {
          classId: PALADIN,
          level: 3,
          hpRoll: 'average',
          subclassId: 'srd-5e-2024:subclass/oath-of-devotion',
        },
      },
      learned('bless'),
      learned('command'),
      learned('cure-wounds'),
      learned('heroism'),
      learned('searing-smite'),
      prepared('bless'),
      prepared('command'),
      prepared('cure-wounds'),
    ]);

    // Derive (no shaping): Smite + both level-3 oath spells are granted, bind to the paladin block,
    // and sit in `prepared` on top of 3 chosen spells while preparedMax stays the vendored 4.
    const block = store.sheet()!.spellcasting.find((b) => b.classId === PALADIN)!;
    const granted = ['divine-smite', 'protection-from-evil-and-good', 'shield-of-faith'].map(
      spellId,
    );
    expect([...(block.alwaysPrepared ?? [])].sort()).toEqual([...granted].sort());
    expect(block.preparedMax).toBe(4);
    expect(block.prepared).toHaveLength(3 + granted.length);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const showSpy = vi.spyOn(TestBed.inject(ToastService), 'show');

    // Marker visible on the granted spells (they are not in `known`, so the Prepared list shows them),
    // whose unprepare control is present but DISABLED (plan 13 task 8 — was "no control" here;
    // the reason wiring is pinned in play-tab-always-prepared.spec.ts).
    for (const name of ['Divine Smite', 'Protection from Evil and Good', 'Shield of Faith']) {
      const row = spellRow(compiled, name);
      expect(row, name).toBeDefined();
      expect(row.textContent).toContain(charactersEn.sheet.spellcasting.alwaysPrepared);
      const unprepare = Array.from(row.querySelectorAll('button')).filter(
        (b) => labelOf(b) === charactersEn.sheet.spellcasting.unprepare,
      );
      expect(unprepare, name).toHaveLength(1);
      expect(unprepare[0].getAttribute('aria-disabled'), name).toBe('true');
    }
    // A chosen spell keeps its enabled unprepare control and no marker.
    const chosen = buttonNamed(
      spellRow(compiled, 'Bless'),
      charactersEn.sheet.spellcasting.unprepare,
    );
    expect(chosen.getAttribute('aria-disabled')).toBeNull();
    expect(spellRow(compiled, 'Bless').textContent).not.toContain(
      charactersEn.sheet.spellcasting.alwaysPrepared,
    );

    // Cap math: 3 chosen + 3 granted = 6 prepared, yet the counter reads 3 of 4 and a 4th chosen
    // spell is accepted (had the grants counted, 6 >= 4 would have blocked it).
    expect(compiled.querySelector('.spells__prepared-count')?.textContent?.trim()).toBe(
      charactersEn.sheet.spellcasting.preparedOf.replace('{prepared}', '3').replace('{max}', '4'),
    );
    const before = store.events().length;
    buttonNamed(spellRow(compiled, 'Heroism'), charactersEn.sheet.spellcasting.prepare).click();
    for (let i = 0; i < 50 && store.events().length === before; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
    expect(showSpy).not.toHaveBeenCalled();
    expect(store.events().at(-1)).toMatchObject({
      type: 'spell.prepared',
      payload: { spellId: spellId('heroism') },
    });

    // ...and the 5th chosen spell now hits the real cap (4 chosen == preparedMax), grants ignored.
    await fixture.whenStable();
    const afterFourth = store.events().length;
    buttonNamed(
      spellRow(compiled, 'Searing Smite'),
      charactersEn.sheet.spellcasting.prepare,
    ).click();
    await fixture.whenStable();
    expect(store.events().length).toBe(afterFourth);
    expect(showSpy).toHaveBeenCalledWith('characters.sheet.spellcasting.preparedMaxReached', {
      max: 4,
    });

    // A forced unprepare of a granted spell is refused by the engine (propose.unprepare), toasted.
    const live = store.sheet()!.spellcasting.find((b) => b.classId === PALADIN)!;
    TestBed.inject(PlayActionsService).togglePrepared(live, spellId('shield-of-faith'));
    await fixture.whenStable();
    expect(store.events().length).toBe(afterFourth);
    expect(showSpy).toHaveBeenCalledWith('characters.validation.spell.always-prepared');
  });
});
