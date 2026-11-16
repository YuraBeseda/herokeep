import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { PackStore } from '@shared/stores/pack.store';
import shellEn from '../../../../../assets/i18n/shell/en.json';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { CreateWizardState } from '../create-wizard.state';
import { EquipmentStepComponent } from './equipment-step.component';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling) — same approach as every
// other create-wizard step spec.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) {
    throw new Error(
      `fixture pack at ${path} failed validation: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);
const CHAIN_MAIL_ID = 'srd-5e-2024:item/chain-mail';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    if (langPath === 'shell/en') return of(shellEn);
    return of({});
  }
}

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      provideRouter([]),
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
      CreateWizardState,
    ],
  });
}

/** Only a name is needed — the equipment step (unlike spells) depends on nothing else in the
 * draft: `draftSheet().inventory`/`.currency` derive from `extraDrafts` alone. */
function createDraft(): CreateWizardState {
  const state = TestBed.inject(CreateWizardState);
  state.name.set('Aldric');
  return state;
}

/** Opens the (folded) library list, narrows its 960 items down to an exact-name match via the search
 * field (same debounce-driven approach as `entity-picker.component.spec.ts`'s own search test) and
 * returns that item's row. */
async function searchAndFindCard(
  fixture: { whenStable(): Promise<unknown> },
  compiled: HTMLElement,
  text: string,
  exactName: string,
): Promise<HTMLElement> {
  if (!compiled.querySelector('hk-entity-picker')) {
    compiled.querySelector<HTMLButtonElement>('.equipment-step__library')!.click();
    await fixture.whenStable();
  }
  vi.useFakeTimers();
  const input = compiled.querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  TestBed.tick();
  vi.useRealTimers();
  await fixture.whenStable();

  const card = Array.from(compiled.querySelectorAll('.entity-picker__row')).find(
    (c) => c.querySelector('.entity-picker__name')?.textContent?.trim() === exactName,
  );
  if (!card) throw new Error(`No row found with exact name "${exactName}"`);
  return card as HTMLElement;
}

describe('EquipmentStepComponent', () => {
  beforeEach(() => configure());

  it('adding chain mail equips it, with matching instanceIds between the item.added and item.equipped drafts', async () => {
    const state = createDraft();
    const fixture = TestBed.createComponent(EquipmentStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const card = await searchAndFindCard(fixture, compiled, 'Chain Mail', 'Chain Mail');
    card.querySelector<HTMLButtonElement>('.entity-picker__toggle')!.click();
    await fixture.whenStable();

    const added = state.extraDrafts().find((d) => d.type === 'item.added') as
      { payload: { instanceId: string; itemId: string; qty: number } } | undefined;
    expect(added).toBeDefined();
    expect(added!.payload.itemId).toBe(CHAIN_MAIL_ID);
    expect(added!.payload.qty).toBe(1);
    expect(state.draftSheet()!.inventory).toHaveLength(1);
    expect(state.draftSheet()!.inventory[0].equipped).toBe(false);

    // Chain mail is armor — an equip toggle renders for its inventory entry.
    const equipButton = compiled.querySelector<HTMLButtonElement>(
      '.equipment-step__equip-toggle button[role="switch"]',
    );
    expect(equipButton).toBeTruthy();
    equipButton!.click();
    await fixture.whenStable();

    const equipped = state.extraDrafts().find((d) => d.type === 'item.equipped') as
      { payload: { instanceId: string } } | undefined;
    expect(equipped).toBeDefined();
    expect(equipped!.payload.instanceId).toBe(added!.payload.instanceId);
    expect(state.draftSheet()!.inventory[0].equipped).toBe(true);
  });

  it('respects the quantity field when adding an item', async () => {
    const state = createDraft();
    const fixture = TestBed.createComponent(EquipmentStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.equipment-step__library')!.click();
    await fixture.whenStable();
    const qtyInput = compiled.querySelector<HTMLInputElement>(
      '.equipment-step__qty input[type="number"]',
    )!;
    qtyInput.value = '5';
    qtyInput.dispatchEvent(new Event('input'));
    qtyInput.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    const card = await searchAndFindCard(fixture, compiled, 'Chain Mail', 'Chain Mail');
    card.querySelector<HTMLButtonElement>('.entity-picker__toggle')!.click();
    await fixture.whenStable();

    expect(state.draftSheet()!.inventory[0].qty).toBe(5);
  });

  it('entering all five currency fields commits exactly one currency.changed draft with the entered totals', async () => {
    const state = createDraft();
    const fixture = TestBed.createComponent(EquipmentStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const currencyInputs = Array.from(
      compiled.querySelectorAll<HTMLInputElement>('.equipment-step__currency input[type="number"]'),
    );
    expect(currencyInputs).toHaveLength(5);

    const values = [1, 2, 3, 15, 7]; // cp, sp, ep, gp, pp — matches DENOMINATIONS order
    for (const [i, v] of values.entries()) {
      currencyInputs[i].value = String(v);
      currencyInputs[i].dispatchEvent(new Event('input'));
      currencyInputs[i].dispatchEvent(new Event('change'));
      await fixture.whenStable();
    }

    const currencyDrafts = state.extraDrafts().filter((d) => d.type === 'currency.changed');
    expect(currencyDrafts).toHaveLength(1);
    expect(currencyDrafts[0].payload).toEqual({ cp: 1, sp: 2, ep: 3, gp: 15, pp: 7 });
    expect(state.draftSheet()!.currency).toEqual({ cp: 1, sp: 2, ep: 3, gp: 15, pp: 7 });
  });

  it('a non-equippable item (gear) never renders an equip toggle', async () => {
    createDraft();
    const fixture = TestBed.createComponent(EquipmentStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const card = await searchAndFindCard(fixture, compiled, 'Acid', 'Acid');
    card.querySelector<HTMLButtonElement>('.entity-picker__toggle')!.click();
    await fixture.whenStable();

    expect(compiled.querySelectorAll('.equipment-step__entry').length).toBe(1);
    expect(compiled.querySelector('.equipment-step__equip-toggle')).toBeNull();
  });

  it('the library stays folded until asked for, and the creation wizard has no Continue button', async () => {
    createDraft();
    const fixture = TestBed.createComponent(EquipmentStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('hk-entity-picker')).toBeNull();
    expect(compiled.querySelector('.equipment-step__continue')).toBeNull();
    const toggle = compiled.querySelector<HTMLButtonElement>('.equipment-step__library')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(compiled.querySelector('hk-entity-picker')).not.toBeNull();
  });

  it('each bag row names the item, its quantity and, for armor, an equip switch labelled by the item', async () => {
    createDraft();
    const fixture = TestBed.createComponent(EquipmentStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const card = await searchAndFindCard(fixture, compiled, 'Chain Mail', 'Chain Mail');
    card.querySelector<HTMLButtonElement>('.entity-picker__toggle')!.click();
    await fixture.whenStable();

    const entry = compiled.querySelector('.equipment-step__entry')!;
    expect(entry.getAttribute('aria-label')).toBe('Chain Mail');
    expect(entry.querySelector('.equipment-step__entry-qty')?.textContent?.trim()).toBe('× 1');
    const equip = entry.querySelector('button[role="switch"]')!;
    expect(equip.getAttribute('aria-checked')).toBe('false');
    equip.dispatchEvent(new Event('click', { bubbles: true }));
    await fixture.whenStable();
    expect(equip.getAttribute('aria-checked')).toBe('true');
  });

  it('a bag row\x27s details button opens the item\x27s full description in the drawer', async () => {
    createDraft();
    const fixture = TestBed.createComponent(EquipmentStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const card = await searchAndFindCard(fixture, compiled, 'Chain Mail', 'Chain Mail');
    card.querySelector<HTMLButtonElement>('.entity-picker__toggle')!.click();
    await fixture.whenStable();

    expect(compiled.querySelector('.equipment-step__entry hk-description-drawer')).toBeNull();
    const details = compiled.querySelector<HTMLButtonElement>('.equipment-step__details')!;
    expect(
      details.getAttribute('aria-label') ?? details.getAttribute('aria-labelledby'),
    ).toBeTruthy();
    details.click();
    await fixture.whenStable();
    expect(compiled.querySelector('hk-description-drawer')).not.toBeNull();
  });

  describe('starting equipment kits', () => {
    const SYSTEM_ID = 'srd-5e-2024:system/5e-2024';

    function fighterSoldier(): CreateWizardState {
      const state = createDraft();
      state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
      state.setDecision(`${SYSTEM_ID}@0/class`, ['srd-5e-2024:class/fighter']);
      return state;
    }

    const cardsOf = (compiled: HTMLElement, source: string): HTMLElement[] =>
      Array.from(
        compiled.querySelectorAll<HTMLElement>(`.equipment-step__kits--${source} hk-picker-card`),
      );

    it('shows one card per option with item names, notes and gold; A is preselected with the bag line', async () => {
      fighterSoldier();
      const fixture = TestBed.createComponent(EquipmentStepComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const classCards = cardsOf(compiled, 'class');
      expect(
        classCards.map((c) => c.querySelector('.hk-picker-card__name')?.textContent?.trim()),
      ).toEqual(['Option A', 'Option B', 'Option C']);
      expect(classCards[0].textContent).toContain('Chain Mail');
      expect(classCards[0].textContent).toContain('Javelin ×8');
      expect(classCards[0].textContent).toContain('4 gp');
      expect(classCards[2].textContent).toContain('155 gp');
      expect(classCards[0].classList).toContain('hk-picker-card--selected');
      expect(classCards[1].classList).not.toContain('hk-picker-card--selected');
      expect(compiled.querySelector('.equipment-step__kits--class')!.textContent).toContain(
        'Option A is in the bag below',
      );

      const bgCards = cardsOf(compiled, 'background');
      expect(bgCards).toHaveLength(2);
      expect(bgCards[0].textContent).toContain(
        'The gaming set you chose for your tool proficiency',
      );
    });

    it('choosing a card swaps the kit', async () => {
      const state = fighterSoldier();
      const fixture = TestBed.createComponent(EquipmentStepComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      cardsOf(compiled, 'class')[2]
        .querySelector<HTMLButtonElement>('.hk-picker-card__choose')!
        .click();
      await fixture.whenStable();

      expect(state.kitChoice('class')()).toBe('C');
      expect(cardsOf(compiled, 'class')[2].classList).toContain('hk-picker-card--selected');
      expect(state.draftSheet()?.currency.gp).toBe(155 + 14);
    });

    it('shows no kit cards when nothing with starting equipment is chosen', async () => {
      createDraft();
      const fixture = TestBed.createComponent(EquipmentStepComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('hk-picker-card')).toBeNull();
      expect(compiled.querySelector('.equipment-step__library')).not.toBeNull();
    });
  });
});
