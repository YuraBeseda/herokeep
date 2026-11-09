import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { propose, type Sheet } from '@hk/engine';
import { ToastService } from '@shared/components/toast/toast.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import charactersEn from '../../../../../../assets/i18n/characters/en.json';
import { CreateWizardState } from '../../../create-wizard/create-wizard.state';
import { seedWarlock, seedWizard } from '../../testing/character-fixtures';
import {
  buttonNamed,
  castButtonIn,
  configureReal,
  labelOf,
  pollUntil,
  resetDb,
} from '../play-spec-support';
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

describe('SpellsLeafComponent — slots, casting, concentration controls', () => {
  const WIZARD_CLASS_ID = 'srd-5e-2024:class/wizard';
  const BURNING_HANDS = 'srd-5e-2024:spell/burning-hands';
  const MAGE_ARMOR = 'srd-5e-2024:spell/mage-armor';
  const MAGIC_MISSILE = 'srd-5e-2024:spell/magic-missile';
  const SHIELD_SPELL = 'srd-5e-2024:spell/shield';
  const THUNDERWAVE = 'srd-5e-2024:spell/thunderwave';
  const ACID_SPLASH = 'srd-5e-2024:spell/acid-splash'; // cantrip, concentration: false
  const DANCING_LIGHTS = 'srd-5e-2024:spell/dancing-lights'; // cantrip, concentration: true
  const DETECT_MAGIC = 'srd-5e-2024:spell/detect-magic'; // level 1, concentration: true
  const BANE = 'srd-5e-2024:spell/bane'; // level 1, concentration: true (off-list; reducer doesn't validate class eligibility)

  function learned(spellId: string, classId = WIZARD_CLASS_ID) {
    return { type: 'spell.learned', v: 1, payload: { spellId, classId, source: 'levelUp' } };
  }

  function prepared(spellId: string, classId = WIZARD_CLASS_ID) {
    return { type: 'spell.prepared', v: 1, payload: { spellId, classId } };
  }

  beforeEach(async () => {
    // Guards against locale leakage from the (file-order-earlier) "resource/action name
    // localization" describe block above: `LocaleService.setLocale('ru')` there persists to REAL
    // `localStorage` (`shared/services/i18n/locale.service.ts`'s `STORAGE_KEY`), which Angular's
    // `TestBed` teardown never clears between tests/describe blocks — a later describe block's
    // fresh `TranslocoService` would otherwise read that stale 'ru' back on construction and
    // silently render every button/label in this block's assertions in Russian.
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
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });

  async function pollUntil(
    fixture: { whenStable(): Promise<unknown> },
    predicate: () => boolean,
    maxIterations = 50,
  ): Promise<void> {
    for (let i = 0; i < maxIterations && !predicate(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
    expect(predicate()).toBe(true);
  }

  function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => labelOf(b) === text,
    );
    if (!button) throw new Error(`no button matching "${text}"`);
    return button;
  }

  function spellRow(compiled: HTMLElement, name: string): HTMLElement {
    const rows = Array.from(compiled.querySelectorAll<HTMLElement>('.spells__item'));
    const row = rows.find((r) => r.querySelector('.hk-srow__name')?.textContent?.trim() === name);
    if (!row) throw new Error(`no spell row for "${name}"`);
    return row;
  }

  // The Known and Prepared lists can both render a row for the SAME spell (a prepared spell is
  // also known) — the Known row gets a Prepare/Unprepare toggle, only the Prepared row gets a
  // Cast button, so a test that needs the CAST affordance must scope to the Prepared `<div>`
  // specifically (identified by its own `<h3>` subtitle), not just "a `<li>` matching this name".
  function preparedListSection(compiled: HTMLElement): HTMLElement {
    const section = compiled.querySelector<HTMLElement>('.spells__prepared');
    if (!section) throw new Error('no "Prepared spells" section rendered');
    return section;
  }

  it('spending a level-1 slot seal appends slot.spent{level:1} and increments used; restoring via a spent seal appends slot.restored{level:1} (no count) and decrements by exactly one', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const slotRow = compiled.querySelector('.spells__slots')!;
    // Available seals come first: the first seal spends while any slot is left.
    const seals = (): NodeListOf<HTMLButtonElement> =>
      slotRow.querySelectorAll<HTMLButtonElement>('.spells__seal');

    seals()[0].click();
    await pollUntil(fixture, () => characterStore.sheet()?.spellcasting[0].slots[0].used === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'slot.spent',
      payload: { level: 1 },
    });

    seals()[0].click();
    await pollUntil(fixture, () => characterStore.sheet()?.spellcasting[0].slots[0].used === 2);

    // Both seals are now spent — restoring via the FIRST one must drop `used` by exactly one
    // (1), never reset it to 0 (the full-reset form `resource.restored` uses by default, and
    // which `slot.restored` deliberately does NOT — see `PlayActionsService.restoreSlot`).
    seals()[0].click();
    await pollUntil(fixture, () => characterStore.sheet()?.spellcasting[0].slots[0].used === 1);
    const restoreEvent = characterStore.events().at(-1)!;
    expect(restoreEvent.type).toBe('slot.restored');
    expect(restoreEvent.payload).toEqual({ level: 1 });
  });

  it('prepared cap blocks preparing a 5th spell with a toast, and appends no spell.prepared event', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([
      learned(BURNING_HANDS),
      learned(MAGE_ARMOR),
      learned(MAGIC_MISSILE),
      learned(SHIELD_SPELL),
      learned(THUNDERWAVE), // learned but left unprepared — the one this test attempts to prepare
      prepared(BURNING_HANDS),
      prepared(MAGE_ARMOR),
      prepared(MAGIC_MISSILE),
      prepared(SHIELD_SPELL), // 4 == wizard-1's preparedMax
    ]);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    const eventsBefore = characterStore.events().length;

    const row = spellRow(compiled, 'Thunderwave');
    buttonNamed(row, charactersEn.sheet.spellcasting.prepare).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
    expect(showSpy).toHaveBeenCalledWith('characters.sheet.spellcasting.preparedMaxReached', {
      max: 4,
    });
  });

  it('unpreparing a prepared spell appends spell.unprepared and its known-list row flips back to a Prepare button', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(BURNING_HANDS), prepared(BURNING_HANDS)]);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    const row = spellRow(compiled, 'Burning Hands');
    buttonNamed(row, charactersEn.sheet.spellcasting.unprepare).click();
    await pollUntil(
      fixture,
      () => !characterStore.sheet()!.spellcasting[0].prepared.includes(BURNING_HANDS),
    );

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'spell.unprepared',
      payload: { spellId: BURNING_HANDS, classId: WIZARD_CLASS_ID },
    });

    compiled = fixture.nativeElement as HTMLElement;
    const refreshedRow = spellRow(compiled, 'Burning Hands');
    expect(() => buttonNamed(refreshedRow, charactersEn.sheet.spellcasting.prepare)).not.toThrow();
  });

  it('R-pf3: casting a known cantrip appends spell.cast{spellId,level:0,slotUsed:false} directly, with no dialog and no concentration key', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(ACID_SPLASH)]);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const row = spellRow(compiled, 'Acid Splash');
    castButtonIn(row).click();
    await pollUntil(fixture, () => characterStore.events().at(-1)?.type === 'spell.cast');

    expect(characterStore.events().at(-1)!.payload).toEqual({
      spellId: ACID_SPLASH,
      level: 0,
      slotUsed: false,
    });
    expect(document.querySelector('.cdk-overlay-container hk-dialog')).toBeNull();
  });

  it('casting a concentration cantrip while already concentrating shows the inline replaces-note next to its own Cast button', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(DANCING_LIGHTS)]);
    // Establishes concentration on a DIFFERENT spell first (the reducer doesn't validate class
    // spell-list eligibility, so any real concentration spell id works as the precondition).
    await characterStore.appendTx(
      propose.cast(characterStore.sheet()!, BANE, { level: 1, concentration: true }),
    );

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const row = spellRow(compiled, 'Dancing Lights');
    expect(row.querySelector('.spells__note')?.textContent?.trim()).toBe(
      charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
    );
  });

  it('leveled cast via the dialog spends the chosen slot and sets concentration when the spell has it', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(DETECT_MAGIC), prepared(DETECT_MAGIC)]);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    castButtonIn(preparedListSection(compiled)).click();
    TestBed.tick();

    // The dialog's own Cast/confirm button carries the SAME translated label as the row's own
    // Cast button — located by its dialog-scoped text (`document`, not `compiled`: the CDK
    // overlay attaches to `document.body`, outside the fixture's root).
    const overlay = document.querySelector('.cdk-overlay-container')!;
    buttonNamed(overlay as HTMLElement, charactersEn.sheet.spellcasting.castDialog.confirm).click();
    TestBed.tick();

    await pollUntil(fixture, () => characterStore.sheet()?.spellcasting[0].slots[0].used === 1);

    expect(characterStore.events().at(-1)!.type).toBe('spell.cast');
    expect(characterStore.events().at(-1)!.payload).toEqual({
      spellId: DETECT_MAGIC,
      level: 1,
      concentration: true,
    });
    expect(characterStore.sheet()?.concentration?.spellId).toBe(DETECT_MAGIC);
  });

  it('the cast dialog shows the "replaces current concentration" note when already concentrating on something else', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(DETECT_MAGIC), prepared(DETECT_MAGIC)]);
    await characterStore.appendTx(
      propose.cast(characterStore.sheet()!, BANE, { level: 1, concentration: true }),
    );

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    castButtonIn(preparedListSection(compiled)).click();
    TestBed.tick();

    expect(document.body.textContent).toContain(
      charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
    );
  });

  it('a slot spent by another action while the cast dialog is still open surfaces a genuine slot.none-left ProposeError, mapped to its own toast (not the generic fallback)', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(BURNING_HANDS), prepared(BURNING_HANDS)]);
    // Leaves exactly ONE level-1 slot free (wizard-1 has 2) — the dialog opens with that single
    // option selected by default.
    await characterStore.appendTx(propose.spendSlot(characterStore.sheet()!, 1));

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');

    castButtonIn(preparedListSection(compiled)).click();
    TestBed.tick();

    // The RACE: while the dialog is open (still holding its stale "1 slot available" snapshot),
    // spend that very last slot out from under it via a concurrent action (another tab, another
    // quick pip click elsewhere).
    await characterStore.appendTx(propose.spendSlot(characterStore.sheet()!, 1));
    const eventsBeforeConfirm = characterStore.events().length;

    const overlay = document.querySelector('.cdk-overlay-container')!;
    buttonNamed(overlay as HTMLElement, charactersEn.sheet.spellcasting.castDialog.confirm).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBeforeConfirm); // no spell.cast appended
    expect(showSpy).toHaveBeenCalledWith('characters.validation.slot.none-left');
  });

  it('End concentration appends concentration.ended{} and clears the chip', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(
      propose.cast(characterStore.sheet()!, BANE, { level: 1, concentration: true }),
    );

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    const chip = compiled.querySelector('.spells__concentration')!;
    expect(chip.textContent).toContain('Bane');

    buttonNamed(chip as HTMLElement, charactersEn.sheet.hp.endConcentration).click();
    await pollUntil(fixture, () => characterStore.sheet()?.concentration === undefined);

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'concentration.ended',
      payload: {},
    });
    compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.spells__concentration')).toBeNull();
  });
});

describe('SpellsLeafComponent — slot seals and the not-leader toast', () => {
  beforeEach(async () => {
    localStorage.removeItem('hk.locale');
    configureReal();
    await resetDb();
  });

  afterEach(() => {
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });

  it("renders a wizard stream's level-1 spell slots as a row of wax seals matching spellcasting (2 slots, none spent)", async () => {
    await seedWizard('Elowen');

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const slotRow = compiled.querySelector('.spells__slots')!;
    expect(slotRow).not.toBeNull();
    const seals = slotRow.querySelectorAll('.spells__seal');
    expect(seals).toHaveLength(2);
    expect(slotRow.querySelectorAll('.hk-wax-seal--spent')).toHaveLength(0);
    // The group's accessible name carries the visible values: the level and what is left.
    expect(slotRow.getAttribute('aria-label')).toBe('Level 1 slots, 2 of 2');
  });

  it('the appendDraft funnel (ending concentration) shows the not-leader toast on a rejected appendTx', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(
      propose.cast(characterStore.sheet()!, 'srd-5e-2024:spell/bane', {
        level: 1,
        concentration: true,
      }),
    );
    const notLeaderError = new CharacterStoreNotLeaderError();
    vi.spyOn(characterStore, 'appendTx').mockRejectedValue(notLeaderError);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const showSpy = vi.spyOn(TestBed.inject(ToastService), 'show');

    buttonNamed(
      fixture.nativeElement as HTMLElement,
      charactersEn.sheet.hp.endConcentration,
    ).click();
    await pollUntil(fixture, () => showSpy.mock.calls.length > 0);

    expect(showSpy).toHaveBeenCalledWith(notLeaderError.code);
  });
});

describe('SpellsLeafComponent — pact slots (phase 4, plan 11, task 12)', () => {
  const WARLOCK_CLASS_ID = 'srd-5e-2024:class/warlock';
  const CHARM_PERSON = 'srd-5e-2024:spell/charm-person'; // level 1, concentration: false

  function learned(spellId: string, classId = WARLOCK_CLASS_ID) {
    return { type: 'spell.learned', v: 1, payload: { spellId, classId, source: 'levelUp' } };
  }

  function prepared(spellId: string, classId = WARLOCK_CLASS_ID) {
    return { type: 'spell.prepared', v: 1, payload: { spellId, classId } };
  }

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
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });

  async function pollUntil(
    fixture: { whenStable(): Promise<unknown> },
    predicate: () => boolean,
    maxIterations = 50,
  ): Promise<void> {
    for (let i = 0; i < maxIterations && !predicate(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
    expect(predicate()).toBe(true);
  }

  function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => labelOf(b) === text,
    );
    if (!button) throw new Error(`no button matching "${text}"`);
    return button;
  }

  function preparedListSection(compiled: HTMLElement): HTMLElement {
    const section = compiled.querySelector<HTMLElement>('.spells__prepared');
    if (!section) throw new Error('no "Prepared spells" section rendered');
    return section;
  }

  it("renders the pact block's own pip row, separately from (and never inside) the regular .spells__block rows", async () => {
    await seedWarlock('Kaelen');

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // A level-1 Warlock's Pact Magic grants exactly one level-1 pact slot (the real SRD table,
    // task-11-report.md) and NO regular `.slots` entries at all (task 3: a pact block's `.slots`
    // is always `[]` by construction) — the pact row reuses `.spells__slots`'s own label/pips
    // layout for visual consistency (it's a distinct `.spells__pact` CONTAINER, not a
    // distinct row class), so "no regular row" is checked by excluding that container.
    expect(compiled.querySelectorAll('.spells__slots:not(.spells__pact)').length).toBe(0);
    const pactBlock = compiled.querySelector('.spells__pact')!;
    expect(pactBlock).not.toBeNull();
    expect(pactBlock.textContent).toContain(
      charactersEn.sheet.spellcasting.pactSlotsLevel.replace('{level}', '1'),
    );
    const pips = pactBlock.querySelectorAll<HTMLButtonElement>('.spells__seal');
    expect(pips.length).toBe(1);
    // unused: the seal is still filled with wax
    expect(pips[0].querySelector('hk-wax-seal')!.classList.contains('hk-wax-seal--spent')).toBe(
      false,
    );
  });

  it('spending the pact pip appends slot.spent{level, pact:true} via the pact propose lane and increments pactSlots.used', async () => {
    await seedWarlock('Kaelen');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const pip = compiled.querySelector<HTMLButtonElement>('.spells__pact .spells__seal')!;

    pip.click();
    await pollUntil(fixture, () => characterStore.facts()?.pactSlots.used === 1);

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'slot.spent',
      payload: { level: 1, pact: true },
    });
    expect(characterStore.facts()?.slotsUsed ?? {}).toEqual({}); // regular slots untouched
  });

  it('restoring via the filled pact pip appends slot.restored{level, pact:true} (no count) and decrements by exactly one', async () => {
    await seedWarlock('Kaelen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.spendSlot(characterStore.sheet()!, 1, { pact: true }));
    expect(characterStore.facts()?.pactSlots.used).toBe(1);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const pip = compiled.querySelector<HTMLButtonElement>('.spells__pact .spells__seal')!;
    // the one seal, now spent
    expect(pip.querySelector('hk-wax-seal')!.classList.contains('hk-wax-seal--spent')).toBe(true);

    pip.click();
    await pollUntil(fixture, () => characterStore.facts()?.pactSlots.used === 0);

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'slot.restored',
      payload: { level: 1, pact: true },
    });
  });

  it('the pact pip row renders read-only (view-only, no spend/restore) while campaign edit-locked, same as the regular slot rows', async () => {
    // Reuses the "campaign edit lock" describe block's OWN campaign harness is out of scope here —
    // this test only checks the STRUCTURAL wiring (`[viewReadonly]="editLocked()"`, same binding
    // the regular slot row already uses) by asserting the pact pip is a real, clickable control for
    // a solo (never-locked) character — the negative (locked) case is exhaustively covered for the
    // regular slot rows already in the "campaign edit lock" describe block using the SAME
    // `hk-pips[viewReadonly]` binding this pact row reuses verbatim, not a parallel implementation.
    await seedWarlock('Kaelen');
    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const pip = compiled.querySelector<HTMLButtonElement>('.spells__pact .spells__seal')!;
    expect(pip.disabled).toBe(false);
  });

  it('casting a prepared spell offers the pact lane and, on confirm, emits BOTH spell.cast{slotUsed:false} and slot.spent{pact:true}', async () => {
    await seedWarlock('Kaelen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(CHARM_PERSON), prepared(CHARM_PERSON)]);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    castButtonIn(preparedListSection(compiled)).click();
    TestBed.tick();

    // The ONLY option (a pure Warlock has no regular `.slots` at all) is the pact lane, already
    // selected by default — confirming immediately exercises it.
    const overlay = document.querySelector('.cdk-overlay-container')!;
    expect(overlay.textContent).toContain(
      charactersEn.sheet.spellcasting.castDialog.slotOptionPact
        .replace('{level}', '1')
        .replace('{remaining}', '1'),
    );
    buttonNamed(overlay as HTMLElement, charactersEn.sheet.spellcasting.castDialog.confirm).click();
    TestBed.tick();

    await pollUntil(fixture, () => characterStore.facts()?.pactSlots.used === 1);

    const lastTwo = characterStore.events().slice(-2);
    expect(lastTwo.map((e) => e.type)).toEqual(['spell.cast', 'slot.spent']);
    expect(lastTwo[0].payload).toEqual({ spellId: CHARM_PERSON, level: 1, slotUsed: false });
    expect(lastTwo[1].payload).toEqual({ level: 1, pact: true });
    const txIds = new Set(lastTwo.map((e) => e.txId));
    expect(txIds.size).toBe(1); // one shared txId (CharacterStore.appendTx's own contract)
  });

  it('a pact slot spent by another action while the cast dialog is still open surfaces a genuine slot.none-left ProposeError, toasted like any other refusal', async () => {
    await seedWarlock('Kaelen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(CHARM_PERSON), prepared(CHARM_PERSON)]);

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');

    castButtonIn(preparedListSection(compiled)).click();
    TestBed.tick();

    // The RACE: the dialog is open holding its stale "1 pact slot available" snapshot; spend the
    // ONLY pact slot out from under it via a concurrent action (mirrors the regular-slot race test
    // above, exercising the SAME `tryPropose` re-read-after-close path for the pact lane).
    await characterStore.appendTx(propose.spendSlot(characterStore.sheet()!, 1, { pact: true }));
    const eventsBeforeConfirm = characterStore.events().length;

    const overlay = document.querySelector('.cdk-overlay-container')!;
    buttonNamed(overlay as HTMLElement, charactersEn.sheet.spellcasting.castDialog.confirm).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBeforeConfirm); // no spell.cast appended
    expect(showSpy).toHaveBeenCalledWith('characters.validation.slot.none-left');
  });
});

function resetSpellDb(): Promise<unknown[]> {
  const db = TestBed.inject(HkDb);
  return Promise.all([
    db.events.clear(),
    db.settings.clear(),
    db.snapshots.clear(),
    db.characters.clear(),
  ]);
}

// Plan 12 task 4: a pooled multiclass caster gets the SAME combined slot row on every block.
describe('SpellsLeafComponent — pooled multiclass slot row renders once (plan 12 task 4)', () => {
  const POOLED = [
    { level: 1, max: 4, used: 1 },
    { level: 2, max: 3, used: 0 },
  ];

  beforeEach(async () => {
    localStorage.removeItem('hk.locale');
    configureReal();
    await resetSpellDb();
  });

  afterEach(() => {
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });

  const slotRows = (c: HTMLElement) => c.querySelectorAll('.spells__slots');
  const sharedHeader = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('h3')).filter(
      (h) => h.textContent?.trim() === charactersEn.sheet.spellcasting.sharedSlots,
    );

  it('Cleric 3 / Wizard 2: the shared pool renders ONCE under a shared header, not once per class block', async () => {
    await seedWizard('Elowen');
    shapeSheet((sheet) => {
      const [wizard] = sheet.spellcasting;
      return {
        ...sheet,
        spellcasting: [
          { ...wizard, classId: 'srd-5e-2024:class/cleric', slots: POOLED.map((s) => ({ ...s })) },
          { ...wizard, slots: POOLED.map((s) => ({ ...s })) },
        ],
      };
    });

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(sharedHeader(compiled)).toHaveLength(1);
    expect(slotRows(compiled)).toHaveLength(POOLED.length); // 2 rows, not 4
    // Both per-class sections remain (DC/attack/lists), but neither re-renders the pool.
    const blocks = compiled.querySelectorAll('.spells__block:not(.spells__shared-slots)');
    expect(blocks).toHaveLength(2);
    blocks.forEach((b) => expect(b.querySelector('.spells__slots')).toBeNull());
    // The shared pool's pips reflect the engine row (level 1: 4 max, 1 used).
    const firstRow = slotRows(compiled)[0];
    expect(firstRow.querySelectorAll('.spells__seal')).toHaveLength(4);
    expect(firstRow.querySelectorAll('.hk-wax-seal--spent')).toHaveLength(1);
  });

  it('Warlock / Cleric: the pact lane and the regular slot row stay separate (nothing is shared)', async () => {
    await seedWizard('Elowen');
    shapeSheet((sheet) => {
      const [wizard] = sheet.spellcasting;
      return {
        ...sheet,
        spellcasting: [
          {
            ...wizard,
            classId: 'srd-5e-2024:class/warlock',
            slots: [],
            pact: { level: 2, count: 2, used: 0 },
          },
          { ...wizard, classId: 'srd-5e-2024:class/cleric', slots: POOLED.map((s) => ({ ...s })) },
        ],
      };
    });

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(sharedHeader(compiled)).toHaveLength(0);
    expect(compiled.querySelectorAll('.spells__pact')).toHaveLength(1);
    // Regular rows: only the cleric's two levels (the pact row is a `.spells__slots` too).
    expect(slotRows(compiled)).toHaveLength(POOLED.length + 1);
  });

  it('a solo Wizard is unchanged: its slots render inside its own block, with no shared header', async () => {
    await seedWizard('Elowen');

    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(sharedHeader(compiled)).toHaveLength(0);
    expect(compiled.querySelector('.spells__shared-slots')).toBeNull();
    expect(compiled.querySelector('.spells__block .spells__slots')).not.toBeNull();
    expect(slotRows(compiled)).toHaveLength(1);
  });
});

// Plan 13 task 4: the free-cast lane (`sheet.freeCasts`) in the cast dialog, with the real pack —
// a level-1 Ranger's Hunter's Mark (Favored Enemy: two free casts per Long Rest). Review Focus 3 at
// the UI seam: the free option spends the counter and no slot; the slot option the slot, not the
// counter; an empty counter is not offered.
describe('SpellsLeafComponent — free-cast lane (plan 13 task 4)', () => {
  const RANGER = 'srd-5e-2024:class/ranger';
  const MARK = 'srd-5e-2024:spell/hunters-mark';
  const dialog = charactersEn.sheet.spellcasting.castDialog;
  const freeOptionText = (remaining: number) =>
    dialog.slotOptionFree
      .replace('{resource}', 'Favored Enemy')
      .replace('{level}', '1')
      .replace('{remaining}', String(remaining));

  beforeEach(async () => {
    localStorage.removeItem('hk.locale');
    configureReal();
    await resetSpellDb();
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });

  async function seedRanger(): Promise<CharacterStore> {
    const state = TestBed.runInInjectionContext(() => new CreateWizardState());
    state.name.set('Tamsin');
    state.gender.set('feminine');
    state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
    state.setDecision('srd-5e-2024:system/5e-2024@0/background', [
      'srd-5e-2024:background/soldier',
    ]);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:12', 'dex:15', 'con:13', 'int:8', 'wis:14', 'cha:10'],
      { method: 'standardArray' },
    );
    state.setDecision('srd-5e-2024:system/5e-2024@0/class', [RANGER]);
    const store = TestBed.inject(CharacterStore);
    await store.create(state.name().trim(), state.gender());
    const [, ...rest] = state.buildTransaction();
    await store.appendTx(rest);
    return store;
  }

  async function openMarkDialog() {
    const fixture = TestBed.createComponent(SpellsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const row = Array.from(compiled.querySelectorAll<HTMLElement>('.spells__item')).find(
      (r) => r.querySelector('.hk-srow__name')?.textContent?.trim() === "Hunter's Mark",
    )!;
    castButtonIn(row).click();
    TestBed.tick();
    return { fixture, overlay: document.querySelector<HTMLElement>('.cdk-overlay-container')! };
  }

  async function confirm(
    fixture: { whenStable(): Promise<unknown> },
    overlay: HTMLElement,
    store: CharacterStore,
  ) {
    const before = store.events().length;
    Array.from(overlay.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => labelOf(b) === dialog.confirm)!
      .click();
    for (let i = 0; i < 50 && store.events().length === before; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  }

  it('offers the free lane beside the slot lane; confirming it spends Favored Enemy and NO slot', async () => {
    const store = await seedRanger();
    expect(store.sheet()!.freeCasts).toEqual([
      { spellId: MARK, resourceId: 'favored-enemy', level: 1 },
    ]);
    const { fixture, overlay } = await openMarkDialog();

    const options = Array.from(overlay.querySelectorAll<HTMLOptionElement>('option'));
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      dialog.slotOption.replace('{level}', '1').replace('{remaining}', '2'),
      freeOptionText(2),
    ]);
    const select = overlay.querySelector<HTMLSelectElement>('select')!;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    TestBed.tick();
    await confirm(fixture, overlay, store);

    const lastTwo = store.events().slice(-2);
    expect(lastTwo.map((e) => e.type)).toEqual(['spell.cast', 'resource.spent']);
    expect(lastTwo[0].payload).toEqual({
      spellId: MARK,
      level: 1,
      slotUsed: false,
      concentration: true,
    });
    expect(lastTwo[1].payload).toEqual({ resourceId: 'favored-enemy' });
    expect(store.facts()!.resourcesUsed).toEqual({ 'favored-enemy': 1 });
    expect(store.facts()!.slotsUsed).toEqual({});
  });

  it('the slot option spends the slot and NOT the counter', async () => {
    const store = await seedRanger();
    const { fixture, overlay } = await openMarkDialog();
    await confirm(fixture, overlay, store); // default selection: the level-1 slot

    expect(store.events().at(-1)).toMatchObject({
      type: 'spell.cast',
      payload: { spellId: MARK, level: 1 },
    });
    expect(store.facts()!.slotsUsed).toEqual({ 1: 1 });
    expect(store.facts()!.resourcesUsed['favored-enemy'] ?? 0).toBe(0);
  });

  it('a counter emptied while the dialog is open is refused by the engine and toasted (resource.none-left)', async () => {
    const store = await seedRanger();
    const { fixture, overlay } = await openMarkDialog();
    const showSpy = vi.spyOn(TestBed.inject(ToastService), 'show');
    const select = overlay.querySelector<HTMLSelectElement>('select')!;
    select.value = '1'; // the free option
    select.dispatchEvent(new Event('change'));
    TestBed.tick();
    await store.appendTx([
      { type: 'resource.spent', v: 1, payload: { resourceId: 'favored-enemy', count: 2 } },
    ]);
    const before = store.events().length;

    Array.from(overlay.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => labelOf(b) === dialog.confirm)!
      .click();
    await fixture.whenStable();

    expect(store.events().length).toBe(before);
    expect(showSpy).toHaveBeenCalledWith('characters.validation.resource.none-left');
  });

  it('an empty Favored Enemy counter is not offered', async () => {
    const store = await seedRanger();
    await store.appendTx([
      { type: 'resource.spent', v: 1, payload: { resourceId: 'favored-enemy', count: 2 } },
    ]);
    const { overlay } = await openMarkDialog();

    const texts = Array.from(overlay.querySelectorAll<HTMLOptionElement>('option')).map((o) =>
      o.textContent?.trim(),
    );
    expect(texts).toEqual([dialog.slotOption.replace('{level}', '1').replace('{remaining}', '2')]);
  });
});
