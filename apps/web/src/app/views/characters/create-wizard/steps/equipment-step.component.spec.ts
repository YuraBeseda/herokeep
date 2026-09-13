import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { PackStore } from '@shared/stores/pack.store';
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

/** Narrows the item picker's (960-item) card grid down to an exact-name match via its search
 * field, same debounce-driven approach as `entity-picker.component.spec.ts`'s own search test. */
async function searchAndFindCard(
  fixture: { whenStable(): Promise<unknown> },
  compiled: HTMLElement,
  text: string,
  exactName: string,
): Promise<HTMLElement> {
  vi.useFakeTimers();
  const input = compiled.querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  TestBed.tick();
  vi.useRealTimers();
  await fixture.whenStable();

  const card = Array.from(compiled.querySelectorAll('.entity-picker__card')).find(
    (c) => c.querySelector('.entity-picker__name')?.textContent?.trim() === exactName,
  );
  if (!card) throw new Error(`No card found with exact name "${exactName}"`);
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
    card.querySelector<HTMLButtonElement>('.entity-picker__select')!.click();
    await fixture.whenStable();

    const added = state.extraDrafts().find((d) => d.type === 'item.added') as
      { payload: { instanceId: string; itemId: string; qty: number } } | undefined;
    expect(added).toBeDefined();
    expect(added!.payload.itemId).toBe(CHAIN_MAIL_ID);
    expect(added!.payload.qty).toBe(1);
    expect(state.draftSheet()!.inventory).toHaveLength(1);
    expect(state.draftSheet()!.inventory[0].equipped).toBe(false);

    // Chain mail is armor — an equip toggle renders for its inventory entry.
    const equipButton = compiled.querySelector<HTMLButtonElement>('.equipment-step__equip-toggle');
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

    const qtyInput = compiled.querySelector<HTMLInputElement>(
      '.equipment-step__qty input[type="number"]',
    )!;
    qtyInput.value = '5';
    qtyInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const card = await searchAndFindCard(fixture, compiled, 'Chain Mail', 'Chain Mail');
    card.querySelector<HTMLButtonElement>('.entity-picker__select')!.click();
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
    card.querySelector<HTMLButtonElement>('.entity-picker__select')!.click();
    await fixture.whenStable();

    expect(compiled.querySelectorAll('.equipment-step__entry').length).toBe(1);
    expect(compiled.querySelector('.equipment-step__equip-toggle')).toBeNull();
  });

  it('"Continue" marks the equipment step done', async () => {
    const state = createDraft();
    const fixture = TestBed.createComponent(EquipmentStepComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.equipment-step__continue')!.click();
    await fixture.whenStable();

    expect(state.doneSteps().has('equipment')).toBe(true);
  });
});
