import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import libraryEn from '../../../../../assets/i18n/library/en.json';
import shellEn from '../../../../../assets/i18n/shell/en.json';
import sampleJson from '../../../../../testing/fixtures/packs/sample-content.json';
import { AddItemDialogComponent } from './add-item-dialog.component';

// Real built SRD pack (same "prefer the real pack" ruling every other play-tab dialog spec
// follows) — `AddItemDialogComponent` queries `index.query({type:'item'})` itself.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..', '..');

import { overlayRoot } from '../../../../ui/testing/overlay';

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
const DAGGER_ID = 'srd-5e-2024:item/dagger';
const parsedSample = parsePack(sampleJson);
if (!parsedSample.ok) throw new Error('sample-content.json fixture no longer parses');
const sample = parsedSample.pack;

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    if (langPath === 'shell/en') return of(shellEn);
    if (langPath === 'library/en') return of(libraryEn);
    return of({});
  }
}

/** `pins` given: a loaded character pinned to them (only `facts().pins` is read by the dialog). */
function configure(packs: Pack[] = [corePack], pins?: Record<string, string>): void {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      provideTranslocoScope('characters'),
      {
        provide: PackStore,
        useValue: { packs: signal(packs), ready: signal(true), corePack: signal(corePack) },
      },
      ...(pins ? [{ provide: CharacterStore, useValue: { facts: signal({ pins }) } }] : []),
    ],
  });
}

function open() {
  const service = TestBed.inject(DialogService);
  return service.open(AddItemDialogComponent, { sheet: true });
}

function buttonNamed(text: string): HTMLButtonElement {
  const button = Array.from(overlayRoot().querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`no button matching "${text}"`);
  return button;
}

/** Narrows the item picker's card grid down to an exact-name match via its search field, same
 * debounce-driven approach as `equipment-step.component.spec.ts`'s own `searchAndFindCard`. */
function searchAndFindCard(text: string, exactName: string): HTMLElement {
  vi.useFakeTimers();
  const input = overlayRoot().querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  TestBed.tick();
  vi.useRealTimers();

  const card = Array.from(overlayRoot().querySelectorAll('.entity-picker__row')).find(
    (c) => c.querySelector('.entity-picker__name')?.textContent?.trim() === exactName,
  );
  if (!card) throw new Error(`No row found with exact name "${exactName}"`);
  return card as HTMLElement;
}

describe('AddItemDialogComponent', () => {
  beforeEach(() => localStorage.removeItem('hk.locale'));

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    localStorage.removeItem('hk.locale');
  });

  it('tapping a card closes the dialog with {itemId, qty: 1} by default', async () => {
    configure();
    const handle = open();
    TestBed.tick();

    const card = searchAndFindCard('Dagger', 'Dagger');
    card.querySelector<HTMLButtonElement>('.entity-picker__toggle')!.click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ itemId: DAGGER_ID, qty: 1 });
  });

  it('the qty set before tapping a card is carried through to the close result', async () => {
    configure();
    const handle = open();
    TestBed.tick();

    const qtyInput = overlayRoot().querySelector<HTMLInputElement>('input[type="number"]')!;
    qtyInput.value = '3';
    qtyInput.dispatchEvent(new Event('input'));
    TestBed.tick();

    const card = searchAndFindCard('Dagger', 'Dagger');
    card.querySelector<HTMLButtonElement>('.entity-picker__toggle')!.click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ itemId: DAGGER_ID, qty: 3 });
  });

  it('cancel closes with undefined', async () => {
    configure();
    const handle = open();
    TestBed.tick();

    buttonNamed(charactersEn.sheet.inventory.addDialog.cancel).click();
    TestBed.tick();

    expect(await handle.closed).toBeUndefined();
  });

  // Plan 15 Task 4: the dialog renders under the root injector, so it scopes its own EngineFacade
  // to the loaded character's pins — a pinned pack's items are addable, an unpinned one's are not.
  it("lists the items of the character's pinned content packs", () => {
    configure([corePack, sample], {
      [corePack.id]: corePack.version,
      [sample.id]: sample.version,
    });
    open();
    TestBed.tick();

    expect(searchAndFindCard('Moonblade', 'Moonblade Sickle')).toBeTruthy();
  });

  it('does not list the items of an installed pack the character does not pin', () => {
    configure([corePack, sample], { [corePack.id]: corePack.version });
    open();
    TestBed.tick();

    expect(() => searchAndFindCard('Moonblade', 'Moonblade Sickle')).toThrow();
  });

  // --- Board DL04 (library): the quantity stepper rides on the strap with Cancel -----------------

  it('keeps Cancel and the quantity stepper together on the leather strap, the picker above it', () => {
    configure();
    open();
    TestBed.tick();

    const strap = overlayRoot().querySelector('[data-dialog-actions]')!;
    expect(strap.querySelector('input[type="number"]')).not.toBeNull();
    expect(
      Array.from(strap.querySelectorAll('button')).some(
        (b) => b.textContent?.trim() === charactersEn.sheet.inventory.addDialog.cancel,
      ),
    ).toBe(true);
    const picker = overlayRoot().querySelector('hk-entity-picker')!;
    expect(picker.compareDocumentPosition(strap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('never goes below a quantity of 1', async () => {
    configure();
    const handle = open();
    TestBed.tick();

    const qty = overlayRoot().querySelector<HTMLInputElement>('input[type="number"]')!;
    qty.value = '0';
    qty.dispatchEvent(new Event('input'));
    qty.dispatchEvent(new Event('change'));
    TestBed.tick();
    searchAndFindCard('Dagger', 'Dagger')
      .querySelector<HTMLButtonElement>('.entity-picker__toggle')!
      .click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ itemId: DAGGER_ID, qty: 1 });
  });

  // --- Board DL04: type chips and weight / cost on each row ---------------------------------------

  it('offers the item types as filter chips with their counts', () => {
    configure();
    open();
    TestBed.tick();
    const chips = Array.from(overlayRoot().querySelectorAll('.entity-picker__filters button')).map(
      (b) => b.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(chips.some((c) => c?.startsWith('Weapon'))).toBe(true);
    expect(chips.some((c) => c?.startsWith('Armor'))).toBe(true);
  });

  it('shows each row weight and cost from the item entity, once (not also as a chip)', async () => {
    configure();
    open();
    TestBed.tick();
    const row = searchAndFindCard('Dagger', 'Dagger');
    await new Promise((resolve) => setTimeout(resolve, 30));
    TestBed.tick();
    const detail = row.querySelector('.entity-picker__detail')!;
    expect(detail.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 lb · 2 gp');
    const chips = Array.from(row.querySelectorAll('.entity-picker__meta')).map((c) =>
      c.textContent?.trim(),
    );
    expect(chips).not.toContain('2 gp');
  });

  it('names the row from its visible content (weight and cost included), with no stale aria-label', async () => {
    configure();
    open();
    TestBed.tick();
    const row = searchAndFindCard('Dagger', 'Dagger');
    await new Promise((resolve) => setTimeout(resolve, 30));
    TestBed.tick();
    expect(row.querySelector('.entity-picker__toggle')!.getAttribute('aria-label')).toBeNull();
  });
});
