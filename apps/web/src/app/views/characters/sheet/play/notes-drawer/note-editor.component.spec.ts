import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import charactersEn from '../../../../../../assets/i18n/characters/en.json';
import shellEn from '../../../../../../assets/i18n/shell/en.json';
import { typeInto } from '../../../../../ui/testing/harness';
import { NoteEditorComponent, type NoteEditorResult } from './note-editor.component';

// The note editor is the drawer's inline form (board D01) and replaces the old note dialog: the same
// fields, the same trimming, the same over-limit guard, now emitting instead of closing a dialog.

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
        config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
    ],
  });
}

async function mount(inputs: Record<string, unknown>) {
  configure();
  const fixture = TestBed.createComponent(NoteEditorComponent);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  const saved: NoteEditorResult[] = [];
  let cancelled = 0;
  let removed = 0;
  fixture.componentInstance.saved.subscribe((r) => saved.push(r));
  fixture.componentInstance.cancelled.subscribe(() => cancelled++);
  fixture.componentInstance.removed.subscribe(() => removed++);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    el,
    saved,
    counts: () => ({ cancelled, removed }),
    titleInput: () => el.querySelector<HTMLInputElement>('input[type="text"]')!,
    bodyInput: () => el.querySelector<HTMLTextAreaElement>('textarea')!,
    button: (text: string) => {
      const b = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(
        (x) => x.textContent?.trim() === text,
      );
      if (!b) throw new Error(`no button matching "${text}"`);
      return b;
    },
  };
}

describe('NoteEditorComponent', () => {
  it('add mode starts with empty fields and saves the trimmed title and body', async () => {
    const m = await mount({ mode: 'add', maxBodyLength: 8192 });
    expect(m.titleInput().value).toBe('');
    expect(m.bodyInput().value).toBe('');

    typeInto(m.titleInput(), '  Loot  ');
    typeInto(m.bodyInput(), '  Found a +1 sword.  ');
    await m.fixture.whenStable();
    m.button(charactersEn.sheet.notes.dialog.save).click();

    expect(m.saved).toEqual([{ title: 'Loot', body: 'Found a +1 sword.' }]);
  });

  it('edit mode pre-fills the title and body', async () => {
    const m = await mount({ mode: 'edit', title: 'Loot', body: 'A sword.', maxBodyLength: 8192 });
    expect(m.titleInput().value).toBe('Loot');
    expect(m.bodyInput().value).toBe('A sword.');
  });

  it('leaving both fields blank saves with title and body both undefined', async () => {
    const m = await mount({ mode: 'add', maxBodyLength: 8192 });
    m.button(charactersEn.sheet.notes.dialog.save).click();
    expect(m.saved).toEqual([{ title: undefined, body: undefined }]);
  });

  it('a body over the max length shows an inline error with both numbers and disables Save', async () => {
    const m = await mount({ mode: 'add', maxBodyLength: 10 });
    typeInto(m.bodyInput(), 'x'.repeat(11));
    await m.fixture.whenStable();

    const error = m.el.querySelector('.note-editor__error');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain('11');
    expect(error!.textContent).toContain('10');
    expect(m.button(charactersEn.sheet.notes.dialog.save).disabled).toBe(true);
  });

  it('clicking Save while over the limit emits nothing', async () => {
    const m = await mount({ mode: 'add', maxBodyLength: 10 });
    typeInto(m.bodyInput(), 'x'.repeat(11));
    await m.fixture.whenStable();
    m.button(charactersEn.sheet.notes.dialog.save).click();
    expect(m.saved).toEqual([]);
  });

  it('Cancel emits cancelled and saves nothing', async () => {
    const m = await mount({ mode: 'add', maxBodyLength: 8192 });
    m.button(charactersEn.sheet.notes.dialog.cancel).click();
    expect(m.counts().cancelled).toBe(1);
    expect(m.saved).toEqual([]);
  });

  it('offers Remove note only while editing, and it emits removed (the host asks to confirm)', async () => {
    const add = await mount({ mode: 'add', maxBodyLength: 8192 });
    expect(() => add.button(charactersEn.sheet.notes.editorRemove)).toThrow();

    TestBed.resetTestingModule();
    const edit = await mount({ mode: 'edit', title: 'Loot', maxBodyLength: 8192 });
    edit.button(charactersEn.sheet.notes.editorRemove).click();
    expect(edit.counts().removed).toBe(1);
  });

  it('names the form by its mode', async () => {
    const add = await mount({ mode: 'add', maxBodyLength: 8192 });
    expect(add.el.querySelector('form, [role="group"]')?.getAttribute('aria-label')).toBe(
      charactersEn.sheet.notes.dialog.addTitle,
    );
  });
});
