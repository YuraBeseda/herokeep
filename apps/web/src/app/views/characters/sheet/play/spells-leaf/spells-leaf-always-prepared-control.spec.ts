import { TestBed } from '@angular/core/testing';
import { ToastService } from '@shared/components/toast/toast.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../../../assets/i18n/characters/en.json';
import { CreateWizardState } from '../../../create-wizard/create-wizard.state';
import { PlayActionsService } from '../play-actions.service';
import { configureReal, labelOf } from '../play-spec-support';
import { SpellsLeafComponent } from './spells-leaf.component';

// Plan 13 task 8 (the plan-12 task 9 "F4" item): a granted / always-prepared spell in the Prepared
// list shows a DISABLED unprepare control with its reason — never no control, never a working one.
// Same real-pack, real create-path setup as the "always-prepared spells with the real pack" spec.

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

/** Persists a Paladin 3 / Oath of Devotion through the real create path (no sheet shaping): the
 * oath's `spell.grant { alwaysPrepared }` effects put Divine Smite, Protection from Evil and Good
 * and Shield of Faith in the block's `alwaysPrepared`; Bless is a chosen, prepared spell. */
async function seedDevotionPaladin(): Promise<CharacterStore> {
  const state = TestBed.runInInjectionContext(() => new CreateWizardState());
  state.name.set('Aldis');
  state.gender.set('masculine');
  state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
  state.setDecision('srd-5e-2024:system/5e-2024@0/background', ['srd-5e-2024:background/soldier']);
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
    prepared('bless'),
  ]);
  return store;
}

describe('SpellsLeafComponent — always-prepared unprepare control (plan 13 task 8)', () => {
  beforeEach(async () => {
    localStorage.removeItem('hk.locale');
    configureReal();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });

  // The Prepared list is the `.spells__prepared` column (the Known list is `.spells__known`).
  const preparedRow = (c: HTMLElement, name: string): HTMLElement | undefined =>
    Array.from(c.querySelectorAll<HTMLElement>('.spells__prepared .spells__item')).find(
      (r) => r.querySelector('.hk-srow__name')?.textContent?.trim() === name,
    );
  const unprepareIn = (row: HTMLElement): HTMLButtonElement | undefined =>
    Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => labelOf(b) === charactersEn.sheet.spellcasting.unprepare,
    );

  it('Paladin 3 / Devotion: each granted spell in the Prepared list has a DISABLED unprepare control carrying the always-prepared reason', async () => {
    const store = await seedDevotionPaladin();
    const block = store.sheet()!.spellcasting.find((b) => b.classId === PALADIN)!;
    expect([...(block.alwaysPrepared ?? [])].sort()).toEqual(
      ['divine-smite', 'protection-from-evil-and-good', 'shield-of-faith'].map(spellId).sort(),
    );

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const reason = charactersEn.sheet.spellcasting.alwaysPreparedReason;

    for (const name of ['Divine Smite', 'Protection from Evil and Good', 'Shield of Faith']) {
      const row = preparedRow(compiled, name);
      expect(row, name).toBeDefined();
      expect(row!.textContent, name).toContain(charactersEn.sheet.spellcasting.alwaysPrepared);
      const control = unprepareIn(row!);
      expect(control, name).toBeDefined();
      expect(control!.getAttribute('aria-disabled'), name).toBe('true');
      const describedBy = control!.getAttribute('aria-describedby');
      expect(describedBy, name).toBeTruthy();
      const described = describedBy!
        .split(' ')
        .map((id) => compiled.querySelector(`[id="${id}"]`)?.textContent?.trim());
      expect(described, name).toContain(reason);
    }

    // A chosen spell's Prepared-list row is unchanged: no marker, no unprepare control there (its
    // working unprepare toggle lives in the Known list).
    const bless = preparedRow(compiled, 'Bless')!;
    expect(bless.textContent).not.toContain(charactersEn.sheet.spellcasting.alwaysPrepared);
    expect(unprepareIn(bless)).toBeUndefined();

    // Reason ids never collide with the Known list's own always-prepared reason ids.
    const ids = Array.from(compiled.querySelectorAll('[id]')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('clicking the disabled control does nothing, and a forced unprepare is still refused by the engine', async () => {
    const store = await seedDevotionPaladin();
    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const showSpy = vi.spyOn(TestBed.inject(ToastService), 'show');
    const before = store.events().length;

    unprepareIn(preparedRow(compiled, 'Shield of Faith')!)!.click();
    await fixture.whenStable();
    expect(store.events().length).toBe(before);
    expect(showSpy).not.toHaveBeenCalled();

    // Backstop: the engine's `propose.unprepare` refusal is untouched.
    const live = store.sheet()!.spellcasting.find((b) => b.classId === PALADIN)!;
    TestBed.inject(PlayActionsService).togglePrepared(live, spellId('shield-of-faith'));
    await fixture.whenStable();
    expect(store.events().length).toBe(before);
    expect(showSpy).toHaveBeenCalledWith('characters.validation.spell.always-prepared');
  });
});
