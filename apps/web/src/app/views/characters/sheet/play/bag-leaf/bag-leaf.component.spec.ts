import { TestBed } from '@angular/core/testing';
import { propose } from '@hk/engine';
import { ToastService } from '@shared/components/toast/toast.service';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../../../assets/i18n/characters/en.json';
import {
  linkToCampaign,
  seedFighter,
  describedBy,
  visibleText,
} from '../../testing/character-fixtures';
import { buttonNamed, pollUntil, setupLeafSpec } from '../play-spec-support';
import { BagLeafComponent } from './bag-leaf.component';

// task-5-brief.md: inventory add-from-library/custom, equip/attune toggles, the qty stepper, remove
// (behind its own confirm dialog), the weight display + total, and the currency editor — now on the
// satchel (plan 17 B9a): a slot is selected and the selected item's action strip holds the controls.
// Every scenario seeds the REAL `seedFighter` fixture (chain mail + longsword + shield, all
// equipped — plan-5 golden) and drives the real `AddItemDialogComponent`/`CustomItemDialogComponent`/
// `ItemRemoveConfirmComponent` overlays the leaf opens through `DialogService`.

describe('BagLeafComponent — inventory and currency controls', () => {
  const DAGGER_ID = 'srd-5e-2024:item/dagger';
  const LONGSWORD_ID = 'srd-5e-2024:item/longsword';
  const SHIELD_ID = 'srd-5e-2024:item/shield';
  // `attunement: { required: true }` — the one fixture below that needs a REAL attunement-eligible
  // pack item; chain mail/longsword/shield carry no `attunement` data at all (the negative fixture).
  const AMULET_ID = 'srd-5e-2024:item/amulet-of-health';

  setupLeafSpec();

  function overlay(): HTMLElement {
    return document.querySelector<HTMLElement>('.cdk-overlay-container')!;
  }

  /** The satchel slot of an item, by its name (its accessible name is the item's whole sentence). */
  function slotFor(compiled: HTMLElement, nameStart: string): HTMLButtonElement | undefined {
    return Array.from(compiled.querySelectorAll<HTMLButtonElement>('.hk-slot')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith(nameStart),
    );
  }

  /** Selects an item's slot so its action strip shows. */
  async function select(
    fixture: { whenStable(): Promise<unknown> },
    compiled: HTMLElement,
    nameStart: string,
  ): Promise<HTMLElement> {
    const slot = slotFor(compiled, nameStart);
    if (!slot) throw new Error(`no satchel slot starting with "${nameStart}"`);
    if (slot.getAttribute('aria-pressed') !== 'true') slot.click();
    await fixture.whenStable();
    return compiled.querySelector<HTMLElement>('.bag__actions')!;
  }

  it('add-from-library appends item.added with a fresh uuid instanceId and renders the new slot', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const instanceIdsBefore = new Set(characterStore.sheet()!.inventory.map((i) => i.instanceId));

    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.inventory.addFromLibrary).click();
    TestBed.tick();

    vi.useFakeTimers();
    const searchInput = overlay().querySelector<HTMLInputElement>('input[type="search"]')!;
    searchInput.value = 'Dagger';
    searchInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    TestBed.tick();
    vi.useRealTimers();

    const card = Array.from(overlay().querySelectorAll('.entity-picker__row')).find(
      (c) => c.querySelector('.entity-picker__name')?.textContent?.trim() === 'Dagger',
    )!;
    card.querySelector<HTMLButtonElement>('.entity-picker__toggle')!.click();

    await pollUntil(
      fixture,
      () => (characterStore.sheet()?.inventory.length ?? 0) > instanceIdsBefore.size,
    );

    const added = characterStore.events().at(-1)!;
    expect(added).toMatchObject({ type: 'item.added', payload: { itemId: DAGGER_ID, qty: 1 } });
    const instanceId = (added.payload as { instanceId: string }).instanceId;
    // A fresh UUIDv7 — sortable/time-ordered, RFC 9562 version-7 nibble + RFC 4122 variant bits
    // (`shared/helpers/uuid.ts`).
    expect(instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(instanceIdsBefore.has(instanceId)).toBe(false);

    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;
    expect(slotFor(compiled, 'Dagger')).toBeDefined();
  });

  it('a custom item renders by its name as a plain (unresolved) slot, and item.added carries custom:{} with no itemId', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.inventory.addCustom).click();
    TestBed.tick();
    const nameInput = overlay().querySelector<HTMLInputElement>('input[type="text"]')!;
    nameInput.value = 'Lucky Coin';
    nameInput.dispatchEvent(new Event('input'));
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.inventory.customDialog.confirm).click();

    await pollUntil(fixture, () => characterStore.events().at(-1)?.type === 'item.added');
    const added = characterStore.events().at(-1)!;
    expect(added.payload).toEqual({
      instanceId: (added.payload as { instanceId: string }).instanceId,
      name: 'Lucky Coin',
      qty: 1,
      custom: {},
    });

    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;
    // Unresolved styling: no pack entity behind it, so it is not an "unknown item" either (that is
    // a stale pack reference) — its name is plain, with nothing pack-backed to open.
    const slot = slotFor(compiled, 'Lucky Coin')!;
    expect(slot).toBeDefined();
    expect(slot.getAttribute('aria-label')).not.toContain('Unknown');
    // No itemId -> no resolved item entity -> nothing to gate an Attune toggle (or Details) on.
    const actions = await select(fixture, compiled, 'Lucky Coin');
    expect(actions.querySelector('.bag__attune')).toBeNull();
    expect(actions.querySelector('.bag__details')).toBeNull();
  });

  it("a custom item's picked icon (the hero's own glyphs listed first) lands at item.added custom.icon", async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.inventory.addCustom).click();
    TestBed.tick();
    overlay().querySelector<HTMLButtonElement>('.custom-item-dialog__icon-toggle')!.click();
    await fixture.whenStable();
    const usedGroup = overlay().querySelector<HTMLElement>('.hk-icon-picker__used')!;
    const first = usedGroup.querySelector<HTMLButtonElement>('.hk-icon-picker__glyph')!;
    const id = first.getAttribute('aria-label')!;
    first.click();
    const nameInput = overlay().querySelector<HTMLInputElement>('input[type="text"]')!;
    nameInput.value = 'Signet';
    nameInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    buttonNamed(overlay(), charactersEn.sheet.inventory.customDialog.confirm).click();

    await pollUntil(fixture, () => characterStore.events().at(-1)?.type === 'item.added');
    expect(characterStore.events().at(-1)!.payload).toMatchObject({
      name: 'Signet',
      custom: { icon: { kind: 'gi', id } },
    });
  });

  it('a custom item with notes appends item.added then a second item.updated{notes} sharing the same instanceId and txId (one appendTx call)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.inventory.addCustom).click();
    TestBed.tick();
    const nameInput = overlay().querySelector<HTMLInputElement>('input[type="text"]')!;
    nameInput.value = 'Strange Key';
    nameInput.dispatchEvent(new Event('input'));
    const notesInput = overlay().querySelector<HTMLTextAreaElement>('textarea')!;
    notesInput.value = 'Opens something.';
    notesInput.dispatchEvent(new Event('input'));
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.inventory.customDialog.confirm).click();

    await pollUntil(fixture, () => characterStore.events().at(-1)?.type === 'item.updated');
    const events = characterStore.events();
    const added = events.at(-2)!;
    const updated = events.at(-1)!;
    expect(added).toMatchObject({ type: 'item.added', payload: { name: 'Strange Key' } });
    expect(updated).toMatchObject({
      type: 'item.updated',
      payload: {
        notes: 'Opens something.',
        instanceId: (added.payload as { instanceId: string }).instanceId,
      },
    });
    expect(updated.txId).toBeDefined();
    expect(updated.txId).toBe(added.txId);
  });

  it("unequipping chain mail via its selected slot's action drops sheet.ac (real pack armor no longer contributes)", async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const acBefore = characterStore.sheet()!.ac.value;
    expect(acBefore).toBe(19);

    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const actions = await select(fixture, compiled, 'Chain Mail');
    buttonNamed(actions, charactersEn.sheet.inventory.unequip).click();

    await pollUntil(fixture, () => characterStore.sheet()!.ac.value !== acBefore);
    expect(characterStore.sheet()!.ac.value).toBeLessThan(acBefore);
    expect(characterStore.events().at(-1)?.type).toBe('item.unequipped');
  });

  it('attune blocks once attunementMax (3) items are already attuned, with a toast mapped to its own key (not the generic fallback)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    for (const row of characterStore.sheet()!.inventory) {
      await characterStore.appendTx(propose.attune(characterStore.sheet()!, row.instanceId, true));
    }
    expect(characterStore.sheet()!.inventory.filter((i) => i.attuned)).toHaveLength(3);
    // The 4th item is clicked THROUGH THE UI below (unlike the 3 above, attuned directly via
    // `propose.attune` — the engine itself has no item-type gate, only the count) — it must be a
    // REAL attunement-eligible pack item, or the (gated) Attune button wouldn't even render.
    await characterStore.appendTx(
      propose.addItem(
        characterStore.sheet()!,
        { itemId: AMULET_ID, qty: 1 },
        () => '01930000-0000-7000-8000-000000000099',
      ),
    );

    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    const eventsBefore = characterStore.events().length;

    const actions = await select(fixture, compiled, 'Amulet of Health');
    buttonNamed(actions, charactersEn.sheet.inventory.attune).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
    expect(showSpy).toHaveBeenCalledWith('characters.validation.attune.max');
  });

  it('the attune toggle does NOT render for a pack item with no attunement data (chain mail, longsword)', async () => {
    await seedFighter('Ivan');
    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    for (const name of ['Chain Mail', 'Longsword', 'Shield']) {
      const actions = await select(fixture, compiled, name);
      expect(actions, `expected the "${name}" action strip`).not.toBeNull();
      const attuneButton = Array.from(actions.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === charactersEn.sheet.inventory.attune,
      );
      expect(attuneButton, `expected no Attune button on the "${name}" slot`).toBeUndefined();
    }
  });

  it('the attune toggle DOES render for an attunement-required pack item (Amulet of Health)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(
      propose.addItem(
        characterStore.sheet()!,
        { itemId: AMULET_ID, qty: 1 },
        () => '01930000-0000-7000-8000-000000000098',
      ),
    );

    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const actions = await select(fixture, compiled, 'Amulet of Health');
    expect(() => buttonNamed(actions, charactersEn.sheet.inventory.attune)).not.toThrow();
  });

  it('the qty stepper increments/decrements via item.updated{qty}, decrement blocked at qty 1', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const actions = await select(fixture, compiled, 'Longsword');
    const decreaseButton = (): HTMLButtonElement =>
      compiled.querySelector<HTMLButtonElement>(
        `[aria-label="${charactersEn.sheet.inventory.qtyDecrease}"]`,
      )!;
    // qty starts at 1: blocked (`aria-disabled`, with the reason as its hint)
    expect(decreaseButton().getAttribute('aria-disabled')).toBe('true');

    const increaseButton = actions.querySelector<HTMLButtonElement>(
      `[aria-label="${charactersEn.sheet.inventory.qtyIncrease}"]`,
    )!;
    increaseButton.click();
    await pollUntil(
      fixture,
      () => characterStore.sheet()?.inventory.find((i) => i.itemId === LONGSWORD_ID)?.qty === 2,
    );
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'item.updated',
      payload: { qty: 2 },
    });

    await fixture.whenStable();
    expect(decreaseButton().getAttribute('aria-disabled')).toBeNull();
    decreaseButton().click();
    await pollUntil(
      fixture,
      () => characterStore.sheet()?.inventory.find((i) => i.itemId === LONGSWORD_ID)?.qty === 1,
    );
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'item.updated',
      payload: { qty: 1 },
    });
  });

  it('remove appends item.removed only after the confirm dialog is accepted; cancel appends nothing', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const eventsBefore = characterStore.events().length;

    let actions = await select(fixture, compiled, 'Shield');
    buttonNamed(actions, charactersEn.sheet.inventory.remove).click();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.inventory.deleteConfirm.cancel).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
    expect(characterStore.sheet()!.inventory.some((i) => i.itemId === SHIELD_ID)).toBe(true);

    actions = await select(fixture, compiled, 'Shield');
    buttonNamed(actions, charactersEn.sheet.inventory.remove).click();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.inventory.deleteConfirm.confirm).click();

    await pollUntil(
      fixture,
      () => !characterStore.sheet()?.inventory.some((i) => i.itemId === SHIELD_ID),
    );
    expect(characterStore.events().at(-1)?.type).toBe('item.removed');
  });

  it('currency: entering gp 15 from a non-zero gp start computes the delta correctly and leaves other denominations unchanged', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.currency(characterStore.sheet()!, { gp: 5, sp: 2 }));
    expect(characterStore.sheet()!.currency).toEqual({ cp: 0, sp: 2, ep: 0, gp: 5, pp: 0 });

    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.hk-pouch__edit')!.click();
    await fixture.whenStable();
    // Field order of the coin pouch is pp, gp, sp, cp — index 1 is gp.
    const gpInput = Array.from(
      compiled.querySelectorAll<HTMLInputElement>('.hk-pouch__edit-fields input[type="number"]'),
    )[1];
    gpInput.value = '15';
    gpInput.dispatchEvent(new Event('input'));
    TestBed.tick();

    compiled.querySelector<HTMLButtonElement>('.hk-pouch__save')!.click();

    await pollUntil(fixture, () => characterStore.sheet()?.currency.gp === 15);
    const changed = characterStore.events().at(-1)!;
    expect(changed).toMatchObject({ type: 'currency.changed', payload: { gp: 10 } });
    // Only `gp` actually changed — no other denomination key rode along in the event.
    expect(Object.keys(changed.payload as object)).toEqual(['gp']);
    expect(characterStore.sheet()!.currency).toEqual({ cp: 0, sp: 2, ep: 0, gp: 15, pp: 0 });
  });

  it('the bag shows the resolved item entity weight (qty-multiplied) in each slot, and a simple total', async () => {
    await seedFighter('Ivan');
    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // Real SRD pack weights: chain mail 55 lb + longsword 3 lb + shield 6 lb = 64 lb (each qty 1).
    const totalWeightEl = compiled.querySelector('.bag__total-weight')!;
    expect(totalWeightEl.textContent).toContain('64');

    const chainMailWeight = slotFor(compiled, 'Chain Mail')!.querySelector('.hk-slot__sub')!;
    expect(chainMailWeight.textContent).toContain('55');
  });

  it('electrum: add, spend and set to zero go through the same propose.currency delta path', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const fixture = TestBed.createComponent(BagLeafComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    async function setEp(value: string): Promise<void> {
      compiled.querySelector<HTMLButtonElement>('.hk-pouch__edit')!.click();
      await fixture.whenStable();
      // Field order of the coin pouch: pp, gp, ep, sp, cp — index 2 is electrum.
      const ep = Array.from(
        compiled.querySelectorAll<HTMLInputElement>('.hk-pouch__edit-fields input[type="number"]'),
      )[2];
      ep.value = value;
      ep.dispatchEvent(new Event('input'));
      TestBed.tick();
      compiled.querySelector<HTMLButtonElement>('.hk-pouch__save')!.click();
    }

    await setEp('7'); // add
    await pollUntil(fixture, () => characterStore.sheet()?.currency.ep === 7);
    let changed = characterStore.events().at(-1)!;
    expect(changed).toMatchObject({ type: 'currency.changed', payload: { ep: 7 } });
    expect(Object.keys(changed.payload as object)).toEqual(['ep']);

    await setEp('4'); // spend 3
    await pollUntil(fixture, () => characterStore.sheet()?.currency.ep === 4);
    changed = characterStore.events().at(-1)!;
    expect(changed).toMatchObject({ type: 'currency.changed', payload: { ep: -3 } });

    await setEp('0'); // set to zero
    await pollUntil(fixture, () => characterStore.sheet()?.currency.ep === 0);
    changed = characterStore.events().at(-1)!;
    expect(changed).toMatchObject({ type: 'currency.changed', payload: { ep: -4 } });
  });
  describe('house rule: players add items themselves (plan 18 task 3)', () => {
    const REASON = 'Only your DM adds items in The Emberfall Company';

    it('off: both Add item buttons are blocked with the reason, no inline caption', async () => {
      await seedFighter('Ivan');
      await linkToCampaign({ playersAddItems: false });
      const fixture = TestBed.createComponent(BagLeafComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      for (const selector of ['.bag__add-library', '.bag__add-custom']) {
        const button = compiled.querySelector<HTMLButtonElement>(selector)!;
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(describedBy(button)).toBe(REASON);
      }
      expect(visibleText(compiled)).not.toContain(REASON);
    });

    it('a solo hero is unaffected', async () => {
      await seedFighter('Ivan');
      const fixture = TestBed.createComponent(BagLeafComponent);
      await fixture.whenStable();
      const button = (fixture.nativeElement as HTMLElement).querySelector('.bag__add-library')!;
      expect(button.getAttribute('aria-disabled')).not.toBe('true');
      expect(describedBy(button)).toBe('');
    });
  });
});
