import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { propose } from '@hk/engine';
import { ToastService } from '@shared/components/toast/toast.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { routes } from '../../../app.routes';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import { configureReal as configureBase } from './play/play-spec-support';
import { levelUpToTwo, seedFighter, seedWizard } from './testing/character-fixtures';

// task-6-brief.md: the short/long rest strap actions + `RestDialogComponent`. The rests are strap
// actions now (Short rest / Long rest, zone 2), so these specs run the real routes and call the
// strap config's `run`, exactly what a click on the strap button does. `levelUpToTwo` (both fixtures'
// level-2 row has no outstanding choices) gives the fighter 2 hit dice to roll and the wizard slots
// to spend/restore.

/** The sheet's routes plus the shared real setup. */
function configureReal(): void {
  configureBase([], [provideRouter(routes)]);
}

function strapIds(): string[] {
  const config = TestBed.inject(ActionStrapService).config();
  return [...(config?.primary ?? []), ...(config?.secondary ?? [])].map((a) => a.id);
}

/** One action of the sheet strap, by id. */
function strapAction(id: string): { run(): void } {
  const config = TestBed.inject(ActionStrapService).config();
  const action = [...(config?.primary ?? []), ...(config?.secondary ?? [])].find(
    (a) => a.id === id,
  );
  if (!action) throw new Error(`no strap action "${id}"`);
  return action;
}

describe('sheet strap — rest actions', () => {
  const FIGHTER = 'srd-5e-2024:class/fighter';
  const EXHAUSTION = 'srd-5e-2024:condition/exhaustion';
  const SECOND_WIND = 'second-wind';

  beforeEach(async () => {
    // Same locale-leak guard every other describe block in this file documents (`hk.locale`
    // persists to REAL localStorage; `TestBed` teardown never clears it between blocks).
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
    vi.restoreAllMocks();
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
      (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`no button matching "${text}"`);
    return button;
  }

  function overlay(): HTMLElement {
    return document.querySelector<HTMLElement>('.cdk-overlay-container')!;
  }

  /** Same scripting technique `rest-dialog.component.spec.ts` documents in full — mocks the
   * `crypto.getRandomValues` entropy `cryptoRng` draws from so each successive roll lands on an
   * exact face, consumed in call order. Narrowed to the EXACT `Uint32Array` length-1 shape
   * `cryptoRng` (`shared/services/engine/rng.ts`) passes — every other shape (notably `uuidv7`'s
   * own `Uint8Array(10)` draw, `shared/helpers/uuid.ts`) falls through to the REAL
   * `crypto.getRandomValues`. Scripting unconditionally, with no shape check, was tried first and
   * broke `uuidv7()`'s own entropy too — it zeroed everything past index 0 of whatever array it
   * was given, producing duplicate event ids (a real `BulkError`/`ConstraintError` from
   * `EventsRepository.append`'s `&id` primary key) the moment more than one id was minted in the
   * same millisecond, which a 4-draft short-rest `appendTx` always does. */
  function scriptRolls(targets: { value: number; sides: number }[]): void {
    let i = 0;
    const real = crypto.getRandomValues.bind(crypto) as (array: unknown) => unknown;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: unknown) => {
      if (array instanceof Uint32Array && array.length === 1) {
        const t = targets[i++];
        const frac = t ? (t.value - 0.5) / t.sides : 0;
        array[0] = Math.floor(frac * 2 ** 32);
        return array;
      }
      return real(array);
    }) as typeof crypto.getRandomValues);
  }

  it('short rest: rolling 2 hit dice heals by roll+con each (kept-style display), restores a shortRest-reset resource, and shares ONE txId across every appended event', async () => {
    const id = await seedFighter('Ivan');
    await levelUpToTwo();
    const characterStore = TestBed.inject(CharacterStore);
    expect(characterStore.sheet()!.hp.hitDice[FIGHTER]).toMatchObject({
      die: 10,
      total: 2,
      remaining: 2,
    });
    const conMod = characterStore.sheet()!.abilities['con'].mod;

    // Damage down from full so the heal arithmetic below is unambiguous (no max clamp).
    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 10));
    const hpBeforeRest = characterStore.sheet()!.hp.current;

    // Spend Second Wind (fighter-1's `shortRest`-reset resource) so its restore is observable.
    await characterStore.appendTx([
      { type: 'resource.spent', v: 1, payload: { resourceId: SECOND_WIND } },
    ]);
    expect(characterStore.sheet()!.resources.find((r) => r.id === SECOND_WIND)?.used).toBe(1);

    const eventsBefore = characterStore.events().length;

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();

    scriptRolls([
      { value: 3, sides: 10 },
      { value: 2, sides: 10 },
    ]);

    strapAction('short-rest').run();
    TestBed.tick();

    const rollButton = (): HTMLButtonElement =>
      overlay().querySelector<HTMLButtonElement>('.rest-dialog__roll')!;

    rollButton().click();
    TestBed.tick();
    expect(overlay().querySelectorAll('.rest-dialog__die--kept')).toHaveLength(1);

    rollButton().click();
    TestBed.tick();
    expect(overlay().querySelectorAll('.rest-dialog__die--kept')).toHaveLength(2);
    expect(rollButton().disabled).toBe(true);

    buttonNamed(overlay(), charactersEn.sheet.rest.dialog.confirmShort).click();

    await pollUntil(fixture, () => characterStore.events().length > eventsBefore);

    const newEvents = characterStore.events().slice(eventsBefore);
    expect(newEvents.map((e) => e.type)).toEqual([
      'hit_dice.spent',
      'hit_dice.spent',
      'rest.taken',
      'resource.restored',
    ]);
    // ONE shared txId across every event this short rest appended (Global Constraints: "CONCAT
    // related proposals into ONE `appendTx` call").
    const txId = newEvents[0]?.txId;
    expect(txId).toBeDefined();
    expect(newEvents.every((e) => e.txId === txId)).toBe(true);

    expect(newEvents[0]).toMatchObject({
      type: 'hit_dice.spent',
      payload: { classId: FIGHTER, count: 1, healed: 3 + conMod },
    });
    expect(newEvents[1]).toMatchObject({
      type: 'hit_dice.spent',
      payload: { classId: FIGHTER, count: 1, healed: 2 + conMod },
    });

    // Heals by exactly rolls+con each: (3+conMod) + (2+conMod) added on top of the pre-rest HP.
    expect(characterStore.sheet()!.hp.current).toBe(hpBeforeRest + (3 + conMod) + (2 + conMod));
    expect(characterStore.sheet()!.hp.hitDice[FIGHTER]?.spent).toBe(2);
    expect(characterStore.sheet()!.hp.hitDice[FIGHTER]?.remaining).toBe(0);
    expect(characterStore.sheet()!.resources.find((r) => r.id === SECOND_WIND)?.used).toBe(0);
  });

  it('long rest: hp.current resolves to hp.max numerically, a spent spell slot restores, and exhaustion reduces from 2 to 1', async () => {
    // No `levelUpToTwo()` here (unlike the short-rest test above) — a level-1 wizard already has
    // slots to spend/restore (SRD level-1 wizard: 2 first-level slots), and exhaustion is a
    // condition level entirely independent of character class level. `seedWizard` deliberately
    // leaves its own level-1 skill/cantrip choices undecided (`character-fixtures.ts`'s own doc),
    // which would make `levelUpToTwo`'s `LevelUpState.complete()` unreachable for this fixture —
    // fine to skip since nothing here needs level 2.
    const id = await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    const maxHp = characterStore.sheet()!.hp.max.value;

    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 5));
    await characterStore.appendTx(propose.spendSlot(characterStore.sheet()!, 1));
    await characterStore.appendTx(propose.condition(characterStore.sheet()!, EXHAUSTION, true, 2));

    expect(characterStore.sheet()!.hp.current).toBe(maxHp - 5);
    expect(characterStore.sheet()!.spellcasting[0]?.slots.find((s) => s.level === 1)?.used).toBe(1);
    expect(
      characterStore.sheet()!.conditions.find((c) => c.conditionId === EXHAUSTION)?.level,
    ).toBe(2);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();

    strapAction('long-rest').run();
    TestBed.tick();

    // No hit-dice picker on a long rest — it's a confirm-only dialog.
    expect(overlay().querySelector('.rest-dialog__hit-dice')).toBeNull();

    buttonNamed(overlay(), charactersEn.sheet.rest.dialog.confirmLong).click();

    await pollUntil(fixture, () => characterStore.sheet()?.hp.current === maxHp);

    expect(characterStore.sheet()!.hp.current).toBe(maxHp);
    expect(characterStore.sheet()!.spellcasting[0]?.slots.find((s) => s.level === 1)?.used).toBe(0);
    expect(
      characterStore.sheet()!.conditions.find((c) => c.conditionId === EXHAUSTION)?.level,
    ).toBe(1);
  });

  // Plan 13 task 6 (ruling 7): a dice-regain charged item (SRD Wand of Magic Missiles, "regains
  // 1d6 + 1 expended charges daily at dawn") restores the ROLLED amount on a long rest — rolled
  // here with `cryptoRng` (the hit-die precedent), recorded as `resource.restored.count`.
  const WAND = 'srd-5e-2024:item/wand-of-magic-missiles';
  async function seedSpentWand(
    spent: number,
  ): Promise<{ store: CharacterStore; key: string; id: string }> {
    const id = await seedWizard('Elowen');
    const store = TestBed.inject(CharacterStore);
    const instanceId = '55555555-5555-4555-8555-555555555555';
    await store.appendTx(propose.addItem(store.sheet()!, { itemId: WAND }, () => instanceId));
    await store.appendTx(propose.equip(store.sheet()!, instanceId, true));
    const key = `item:${instanceId}`;
    await store.appendTx([
      { type: 'resource.spent', v: 1, payload: { resourceId: key, count: spent } },
    ]);
    expect(store.sheet()!.resources.find((r) => r.id === key)).toMatchObject({
      used: spent,
      regain: '1d6+1',
    });
    return { store, key, id };
  }

  it('long rest: a 1d6+1 regain item restores the cryptoRng-rolled total, recorded as resource.restored.count', async () => {
    const { store, key, id } = await seedSpentWand(6);
    scriptRolls([{ value: 3, sides: 6 }]); // 3 + 1 = 4 charges regained

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();
    await pollUntil(fixture, () => strapIds().length > 0);
    strapAction('long-rest').run();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.rest.dialog.confirmLong).click();

    await pollUntil(fixture, () => store.events().at(-1)?.type === 'resource.restored');
    expect(store.events().at(-1)?.payload).toEqual({ resourceId: key, count: 4 });
    expect(store.sheet()!.resources.find((r) => r.id === key)?.used).toBe(2);
  });

  it('long rest: a refused regain roll (missing) shows its own toast and appends nothing', async () => {
    const { store, id } = await seedSpentWand(6);
    const eventsBefore = store.events().length;
    const realRest = propose.rest;
    // Drop the caller's rolls (an explicit empty map) to drive the engine's own
    // `rest.regain-roll-missing` refusal.
    vi.spyOn(propose, 'rest').mockImplementation((sheet, kind, hitDice) =>
      realRest(sheet, kind, hitDice, {}),
    );

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();
    const showSpy = vi.spyOn(TestBed.inject(ToastService), 'show');
    strapAction('long-rest').run();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.rest.dialog.confirmLong).click();

    await pollUntil(fixture, () => showSpy.mock.calls.length > 0);
    expect(showSpy).toHaveBeenCalledWith('characters.validation.rest.regain-roll-missing');
    expect(store.events().length).toBe(eventsBefore);
  });

  it('cancelling the short-rest dialog appends nothing', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const eventsBefore = characterStore.events().length;

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();

    strapAction('short-rest').run();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.rest.dialog.cancel).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
  });
});
