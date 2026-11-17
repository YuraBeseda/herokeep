import { TestBed } from '@angular/core/testing';
import { propose } from '@hk/engine';
import { ToastService } from '@shared/components/toast/toast.service';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import charactersEn from '../../../../../../assets/i18n/characters/en.json';
import { seedFighter } from '../../testing/character-fixtures';
import { buttonNamed, pollUntil, setupLeafSpec } from '../play-spec-support';
import { ConditionsLeafComponent } from './conditions-leaf.component';

// task-2-brief.md (death saves, inspiration) and task-4-brief.md (the condition-add dialog with its
// localized picker and data-driven level stepper, per-chip remove). Every scenario seeds a REAL
// fighter-1 stream and drives the rendered DOM and the real `ConditionDialogComponent` overlay.
describe('ConditionsLeafComponent — death saves, inspiration, conditions', () => {
  const EXHAUSTION_ID = 'srd-5e-2024:condition/exhaustion';
  const BLINDED_ID = 'srd-5e-2024:condition/blinded';

  setupLeafSpec();

  function overlay(): HTMLElement {
    return document.querySelector<HTMLElement>('.cdk-overlay-container')!;
  }

  it('death-save controls are hidden while current HP is above 0, and appear once it drops to 0', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('hk-death-saves')).toBeNull();
    expect(compiled.querySelector('.conditions__death-actions')).toBeNull();

    // 20 clamps to the reachable 12 (current + temp) -> current lands exactly on 0.
    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 20));
    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;
    expect(characterStore.sheet()?.hp.current).toBe(0);
    expect(compiled.querySelector('hk-death-saves')).not.toBeNull();
    expect(compiled.querySelector('.conditions__death-actions')).not.toBeNull();
  });

  it('clicking the death-save Success ring round-trips into sheet.hp.deathSaves.successes', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 20)); // -> current 0

    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled
      .querySelector<HTMLButtonElement>('hk-death-saves .hk-ring[data-kind="success"]')!
      .click();
    await pollUntil(fixture, () => characterStore.sheet()?.hp.deathSaves.successes === 1);

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'death_save.recorded',
      payload: { result: 'success' },
    });
    expect(characterStore.sheet()?.hp.deathSaves.successes).toBe(1);
  });

  it('the Failure ring and the critical buttons record failure, critSuccess and critFailure through propose.deathSave', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 20)); // -> current 0

    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled
      .querySelector<HTMLButtonElement>('hk-death-saves .hk-ring[data-kind="failure"]')!
      .click();
    await pollUntil(fixture, () => characterStore.sheet()?.hp.deathSaves.failures === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'death_save.recorded',
      payload: { result: 'failure' },
    });

    const eventsBefore = characterStore.events().length;
    buttonNamed(compiled, charactersEn.sheet.hp.deathSaveCritFailure).click();
    await pollUntil(fixture, () => characterStore.events().length > eventsBefore);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'death_save.recorded',
      payload: { result: 'critFailure' },
    });
  });

  it('the inspiration toggle appends inspiration.changed and flips sheet.inspiration both ways', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(characterStore.sheet()?.inspiration).toBe(false);

    const toggle = compiled.querySelector<HTMLButtonElement>('hk-inspiration-toggle button')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    await pollUntil(fixture, () => characterStore.sheet()?.inspiration === true);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'inspiration.changed',
      payload: { value: true },
    });
    expect(characterStore.sheet()?.inspiration).toBe(true);
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    await pollUntil(fixture, () => characterStore.sheet()?.inspiration === false);
    expect(characterStore.sheet()?.inspiration).toBe(false);
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('the tryPropose funnel (inspiration toggle) shows the not-leader toast on a rejected appendTx', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const notLeaderError = new CharacterStoreNotLeaderError();
    vi.spyOn(characterStore, 'appendTx').mockRejectedValue(notLeaderError);

    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');

    compiled.querySelector<HTMLButtonElement>('hk-inspiration-toggle button')!.click();
    await pollUntil(fixture, () => showSpy.mock.calls.length > 0);

    expect(showSpy).toHaveBeenCalledWith(notLeaderError.code);
  });

  it('adding a non-level condition round-trips into sheet.conditions and renders a localized chip', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.conditions.add).click();
    TestBed.tick();

    overlay()
      .querySelector<HTMLElement>(`.condition-dialog__chip[data-id="${BLINDED_ID}"]`)!
      .click();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.conditions.addDialog.confirm).click();

    await pollUntil(fixture, () => (characterStore.sheet()?.conditions.length ?? 0) === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'condition.added',
      payload: { conditionId: BLINDED_ID },
    });

    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.conditions__chips')!.textContent).toContain('Blinded');
  });

  it('exhaustion added at level 3, then re-added at level 2, replaces the entry (reducer replace-by-conditionId)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    async function addExhaustion(level: number): Promise<void> {
      buttonNamed(compiled, charactersEn.sheet.conditions.add).click();
      TestBed.tick();
      overlay()
        .querySelector<HTMLElement>(`.condition-dialog__chip[data-id="${EXHAUSTION_ID}"]`)!
        .click();
      TestBed.tick();
      const levelInput = overlay().querySelector<HTMLInputElement>('input[type="number"]')!;
      levelInput.value = String(level);
      levelInput.dispatchEvent(new Event('input'));
      TestBed.tick();
      buttonNamed(overlay(), charactersEn.sheet.conditions.addDialog.confirm).click();
      await pollUntil(
        fixture,
        () =>
          characterStore.sheet()?.conditions.find((c) => c.conditionId === EXHAUSTION_ID)?.level ===
          level,
      );
    }

    await addExhaustion(3);
    expect(characterStore.sheet()!.conditions).toHaveLength(1);

    await addExhaustion(2);
    expect(characterStore.sheet()!.conditions).toHaveLength(1);
    expect(characterStore.sheet()!.conditions[0]).toMatchObject({
      conditionId: EXHAUSTION_ID,
      level: 2,
    });
  });

  it('a solo hero advances its own round counter: combat.round_advanced, round 2 then 3 on one encounter', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.conditions.advanceRound).click();
    await pollUntil(fixture, () => characterStore.facts()?.round?.round === 2);
    const first = characterStore.events().at(-1)!;
    expect(first).toMatchObject({ type: 'combat.round_advanced', v: 1, payload: { round: 2 } });

    buttonNamed(compiled, charactersEn.sheet.conditions.advanceRound).click();
    await pollUntil(fixture, () => characterStore.facts()?.round?.round === 3);
    expect(characterStore.events().at(-1)!.payload).toEqual({
      encounterId: (first.payload as { encounterId: string }).encounterId,
      round: 3,
    });
    expect(compiled.textContent).toContain('Round 3');
  });

  it('a rounds condition records the clock (condition.added@2) and its chip badge counts down per round', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    buttonNamed(compiled, charactersEn.sheet.conditions.advanceRound).click();
    await pollUntil(fixture, () => characterStore.facts()?.round?.round === 2);
    const encounterId = characterStore.facts()!.round!.encounterId;

    buttonNamed(compiled, charactersEn.sheet.conditions.add).click();
    TestBed.tick();
    overlay()
      .querySelector<HTMLElement>(`.condition-dialog__chip[data-id="${BLINDED_ID}"]`)!
      .click();
    TestBed.tick();
    const rounds = overlay().querySelector<HTMLInputElement>('input[type="number"]')!;
    rounds.value = '3';
    rounds.dispatchEvent(new Event('input'));
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.conditions.addDialog.confirm).click();

    await pollUntil(fixture, () => (characterStore.sheet()?.conditions.length ?? 0) === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'condition.added',
      v: 2,
      payload: {
        conditionId: BLINDED_ID,
        duration: { kind: 'rounds', amount: 3 },
        startedAtRound: 2,
        encounterId,
      },
    });
    await fixture.whenStable();
    expect(compiled.querySelector('hk-condition-chip')!.textContent).toContain('3 rounds');

    buttonNamed(compiled, charactersEn.sheet.conditions.advanceRound).click();
    await pollUntil(fixture, () => characterStore.facts()?.round?.round === 3);
    await fixture.whenStable();
    expect(compiled.querySelector('hk-condition-chip')!.textContent).toContain('2 rounds');
  });

  it('removing a condition via the chip clears it from sheet.conditions', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.condition(characterStore.sheet()!, BLINDED_ID, true));

    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const removeButton = compiled.querySelector<HTMLButtonElement>(
      '.conditions__chips .hk-cond__end',
    )!;
    removeButton.click();

    await pollUntil(fixture, () => (characterStore.sheet()?.conditions.length ?? 0) === 0);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'condition.removed',
      payload: { conditionId: BLINDED_ID },
    });
  });

  // Plan 13 task 5: `sheet.immunities` (condition.immunity) renders as non-removable badges under
  // an "Immunities" heading in the Conditions leaf — localized condition name plus the granting
  // feature's name. Display-only: no heading and no list at all while the sheet has none.
  it('renders condition immunities as badges with their granting feature (Aura of Courage, paladin 10)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(characterStore.sheet()!.immunities).toBeUndefined();
    expect(compiled.querySelector('.conditions__immunities')).toBeNull();
    expect(compiled.textContent).not.toContain(charactersEn.sheet.conditions.immunitiesTitle);

    await characterStore.appendTx(
      Array.from({ length: 10 }, (_, i) => ({
        type: 'level.gained' as const,
        v: 1 as const,
        payload: { classId: 'srd-5e-2024:class/paladin', level: i + 1, hpRoll: 'average' as const },
      })),
    );
    await pollUntil(fixture, () => (characterStore.sheet()?.immunities?.length ?? 0) === 1);
    await fixture.whenStable();

    const badges = Array.from(
      compiled.querySelectorAll('.conditions__immunities li hk-tag-chip'),
      (el) => el.textContent?.trim(),
    );
    expect(badges).toEqual(['Frightened (Aura of Courage)']);
    expect(compiled.querySelector('.conditions__immunities .hk-cond__end')).toBeNull();
    expect(compiled.textContent).toContain(charactersEn.sheet.conditions.immunitiesTitle);
  });

  // Plan 14 Task 6: `sheet.resistances` (damage.resistance, Task 3) renders beside the immunity
  // badges — the damage type's pack `rule` entity name through the Localizer plus the granting
  // source's name. Display-only, absent entirely while the sheet has none.
  it('renders damage resistances as badges with their granting source (attuned Cloak of Arachnida)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(ConditionsLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(characterStore.sheet()!.resistances).toBeUndefined();
    expect(compiled.querySelector('.conditions__resistances')).toBeNull();
    expect(compiled.textContent).not.toContain(charactersEn.sheet.conditions.resistancesTitle);

    const instanceId = '66666666-6666-4666-8666-666666666666';
    await characterStore.appendTx([
      {
        type: 'item.added',
        v: 1,
        payload: { instanceId, itemId: 'srd-5e-2024:item/cloak-of-arachnida', qty: 1 },
      },
      { type: 'item.equipped', v: 1, payload: { instanceId } },
      { type: 'item.attuned', v: 1, payload: { instanceId } },
    ]);
    await pollUntil(fixture, () => (characterStore.sheet()?.resistances?.length ?? 0) === 1);
    await fixture.whenStable();

    const badges = Array.from(
      compiled.querySelectorAll('.conditions__resistances li hk-tag-chip'),
      (el) => el.textContent?.trim(),
    );
    expect(badges).toEqual(['Damage type: Poison (Cloak of Arachnida)']);
    expect(compiled.querySelector('.conditions__resistances .hk-cond__end')).toBeNull();
    expect(compiled.textContent).toContain(charactersEn.sheet.conditions.resistancesTitle);
  });
});
