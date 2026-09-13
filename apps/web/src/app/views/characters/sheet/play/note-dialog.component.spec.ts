import { TestBed } from '@angular/core/testing';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { NoteDialogComponent, type NoteDialogData } from './note-dialog.component';

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

function open(data: NoteDialogData) {
  const service = TestBed.inject(DialogService);
  return service.open(NoteDialogComponent, { data });
}

function titleInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[type="text"]')!;
}

function bodyInput(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>('textarea')!;
}

function buttonNamed(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`no button matching "${text}"`);
  return button;
}

describe('NoteDialogComponent', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('add mode starts with empty fields and closes with trimmed title/body', async () => {
    configure();
    const handle = open({ mode: 'add', maxBodyLength: 8192 });
    TestBed.tick();

    expect(titleInput().value).toBe('');
    expect(bodyInput().value).toBe('');

    titleInput().value = '  Loot  ';
    titleInput().dispatchEvent(new Event('input'));
    bodyInput().value = '  Found a +1 sword.  ';
    bodyInput().dispatchEvent(new Event('input'));
    TestBed.tick();

    buttonNamed(charactersEn.sheet.notes.dialog.save).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ title: 'Loot', body: 'Found a +1 sword.' });
  });

  it('edit mode pre-fills the title/body from data', () => {
    configure();
    open({ mode: 'edit', title: 'Loot', body: 'A sword.', maxBodyLength: 8192 });
    TestBed.tick();

    expect(titleInput().value).toBe('Loot');
    expect(bodyInput().value).toBe('A sword.');
  });

  it('leaving both fields blank closes with title/body both undefined', async () => {
    configure();
    const handle = open({ mode: 'add', maxBodyLength: 8192 });
    TestBed.tick();

    buttonNamed(charactersEn.sheet.notes.dialog.save).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ title: undefined, body: undefined });
  });

  it('a body over the caller-supplied max length shows an inline error and disables Save', () => {
    configure();
    open({ mode: 'add', maxBodyLength: 10 });
    TestBed.tick();

    bodyInput().value = 'x'.repeat(11);
    bodyInput().dispatchEvent(new Event('input'));
    TestBed.tick();

    const error = document.querySelector('.note-dialog__error');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain('11');
    expect(error!.textContent).toContain('10');
    expect(buttonNamed(charactersEn.sheet.notes.dialog.save).disabled).toBe(true);
  });

  it('clicking Save while over the limit does not close the dialog', async () => {
    configure();
    const handle = open({ mode: 'add', maxBodyLength: 10 });
    TestBed.tick();

    bodyInput().value = 'x'.repeat(11);
    bodyInput().dispatchEvent(new Event('input'));
    TestBed.tick();

    buttonNamed(charactersEn.sheet.notes.dialog.save).click();
    TestBed.tick();

    const sentinel = Symbol('still-open');
    const raced = await Promise.race([
      handle.closed,
      new Promise((resolve) => setTimeout(() => resolve(sentinel), 0)),
    ]);
    expect(raced).toBe(sentinel);
  });

  it('cancel closes with undefined', async () => {
    configure();
    const handle = open({ mode: 'add', maxBodyLength: 8192 });
    TestBed.tick();

    buttonNamed(charactersEn.sheet.notes.dialog.cancel).click();
    TestBed.tick();

    expect(await handle.closed).toBeUndefined();
  });
});
