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
import { DialogService } from '@shared/components/dialog/dialog.service';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { AddItemDialogComponent } from './add-item-dialog.component';

// Real built SRD pack (same "prefer the real pack" ruling every other play-tab dialog spec
// follows) — `AddItemDialogComponent` queries `index.query({type:'item'})` itself.
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
const DAGGER_ID = 'srd-5e-2024:item/dagger';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return langPath === 'characters/en' ? of(charactersEn) : of({});
  }
}

function configure(): void {
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
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
    ],
  });
}

function open() {
  const service = TestBed.inject(DialogService);
  return service.open(AddItemDialogComponent, { sheet: true });
}

function buttonNamed(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`no button matching "${text}"`);
  return button;
}

/** Narrows the item picker's card grid down to an exact-name match via its search field, same
 * debounce-driven approach as `equipment-step.component.spec.ts`'s own `searchAndFindCard`. */
function searchAndFindCard(text: string, exactName: string): HTMLElement {
  vi.useFakeTimers();
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  TestBed.tick();
  vi.useRealTimers();

  const card = Array.from(document.querySelectorAll('.entity-picker__card')).find(
    (c) => c.querySelector('.entity-picker__name')?.textContent?.trim() === exactName,
  );
  if (!card) throw new Error(`No card found with exact name "${exactName}"`);
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
    card.querySelector<HTMLButtonElement>('.entity-picker__select')!.click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ itemId: DAGGER_ID, qty: 1 });
  });

  it('the qty set before tapping a card is carried through to the close result', async () => {
    configure();
    const handle = open();
    TestBed.tick();

    const qtyInput = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    qtyInput.value = '3';
    qtyInput.dispatchEvent(new Event('input'));
    TestBed.tick();

    const card = searchAndFindCard('Dagger', 'Dagger');
    card.querySelector<HTMLButtonElement>('.entity-picker__select')!.click();
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
});
