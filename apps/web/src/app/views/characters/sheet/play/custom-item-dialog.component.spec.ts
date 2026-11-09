import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { CustomItemDialogComponent } from './custom-item-dialog.component';

/** Queries stay inside the dialog overlay, never a stale element elsewhere in the shared document. */
const overlayRoot = (): ParentNode => document.querySelector('.cdk-overlay-container') ?? document;

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
    ],
  });
}

function open() {
  const service = TestBed.inject(DialogService);
  return service.open(CustomItemDialogComponent);
}

/** `ngModel` writes its value on a microtask; let it land (and the view refresh) before clicking.
 * Without this the confirm click could race the model write under a loaded full-suite run. */
async function settle(): Promise<void> {
  await TestBed.inject(ApplicationRef).whenStable();
  TestBed.tick();
}

function buttonNamed(text: string): HTMLButtonElement {
  const button = Array.from(overlayRoot().querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`no button matching "${text}"`);
  return button;
}

describe('CustomItemDialogComponent', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('confirm is disabled while name is blank (the default)', () => {
    configure();
    open();
    TestBed.tick();

    expect(buttonNamed(charactersEn.sheet.inventory.customDialog.confirm).disabled).toBe(true);
  });

  it('confirm closes with {name, qty: 1, notes: undefined} once a name is typed (default qty, no notes)', async () => {
    configure();
    const handle = open();
    TestBed.tick();

    const nameInput = overlayRoot().querySelector<HTMLInputElement>('input[type="text"]')!;
    nameInput.value = 'Lucky Coin';
    nameInput.dispatchEvent(new Event('input'));
    await settle();

    buttonNamed(charactersEn.sheet.inventory.customDialog.confirm).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ name: 'Lucky Coin', qty: 1, notes: undefined });
  });

  it('qty and notes are carried through, both trimmed', async () => {
    configure();
    const handle = open();
    TestBed.tick();

    const nameInput = overlayRoot().querySelector<HTMLInputElement>('input[type="text"]')!;
    nameInput.value = '  Rope, 50 ft  ';
    nameInput.dispatchEvent(new Event('input'));

    const qtyInput = overlayRoot().querySelector<HTMLInputElement>('input[type="number"]')!;
    qtyInput.value = '2';
    qtyInput.dispatchEvent(new Event('input'));

    const notesInput = overlayRoot().querySelector<HTMLTextAreaElement>('textarea')!;
    notesInput.value = '  A bit frayed  ';
    notesInput.dispatchEvent(new Event('input'));
    await settle();

    buttonNamed(charactersEn.sheet.inventory.customDialog.confirm).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({
      name: 'Rope, 50 ft',
      qty: 2,
      notes: 'A bit frayed',
    });
  });

  it('cancel closes with undefined', async () => {
    configure();
    const handle = open();
    TestBed.tick();

    buttonNamed(charactersEn.sheet.inventory.customDialog.cancel).click();
    TestBed.tick();

    expect(await handle.closed).toBeUndefined();
  });
});
