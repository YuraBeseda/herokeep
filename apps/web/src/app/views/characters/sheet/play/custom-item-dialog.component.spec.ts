import { TestBed } from '@angular/core/testing';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { CustomItemDialogComponent } from './custom-item-dialog.component';

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

function buttonNamed(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
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

    const nameInput = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    nameInput.value = 'Lucky Coin';
    nameInput.dispatchEvent(new Event('input'));
    TestBed.tick();

    buttonNamed(charactersEn.sheet.inventory.customDialog.confirm).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ name: 'Lucky Coin', qty: 1, notes: undefined });
  });

  it('qty and notes are carried through, both trimmed', async () => {
    configure();
    const handle = open();
    TestBed.tick();

    const nameInput = document.querySelector<HTMLInputElement>('input[type="text"]')!;
    nameInput.value = '  Rope, 50 ft  ';
    nameInput.dispatchEvent(new Event('input'));

    const qtyInput = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    qtyInput.value = '2';
    qtyInput.dispatchEvent(new Event('input'));

    const notesInput = document.querySelector<HTMLTextAreaElement>('textarea')!;
    notesInput.value = '  A bit frayed  ';
    notesInput.dispatchEvent(new Event('input'));
    TestBed.tick();

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
