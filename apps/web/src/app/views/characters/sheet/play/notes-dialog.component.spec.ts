import { TestBed } from '@angular/core/testing';
import { propose } from '@hk/engine';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { seedFighter } from '../testing/character-fixtures';
import { NotesDialogComponent } from './notes-dialog.component';
import { buttonNamed, pollUntil, setupLeafSpec } from './play-spec-support';

// task-4-brief.md: the notes list (opened from the sheet strap) and its add / edit / remove flows,
// each through the real `NoteDialogComponent` / `NoteDeleteConfirmComponent` overlays. B9b replaces
// this host with the notes drawer; the flows below are what must keep working.
describe('NotesDialogComponent — notes controls', () => {
  setupLeafSpec([], [{ provide: DialogRef, useValue: new DialogRef(() => undefined) }]);

  function overlay(): HTMLElement {
    return document.querySelector<HTMLElement>('.cdk-overlay-container')!;
  }

  it('note add/edit/remove round-trips through propose.note (each via its own dialog)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(NotesDialogComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    // Add
    buttonNamed(compiled, charactersEn.sheet.notes.add).click();
    TestBed.tick();
    const addTitleInput = overlay().querySelector<HTMLInputElement>('input[type="text"]')!;
    addTitleInput.value = 'Loot';
    addTitleInput.dispatchEvent(new Event('input'));
    const addBodyInput = overlay().querySelector<HTMLTextAreaElement>('textarea')!;
    addBodyInput.value = 'A sword.';
    addBodyInput.dispatchEvent(new Event('input'));
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.notes.dialog.save).click();

    await pollUntil(fixture, () => (characterStore.facts()?.notes.length ?? 0) === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'note.added',
      payload: { title: 'Loot', body: 'A sword.' },
    });

    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.notes-dialog__list')!.textContent).toContain('Loot');

    // Edit
    buttonNamed(compiled, charactersEn.sheet.notes.edit).click();
    TestBed.tick();
    const editBodyInput = overlay().querySelector<HTMLTextAreaElement>('textarea')!;
    expect(editBodyInput.value).toBe('A sword.');
    editBodyInput.value = 'A +1 sword.';
    editBodyInput.dispatchEvent(new Event('input'));
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.notes.dialog.save).click();

    await pollUntil(fixture, () => characterStore.facts()?.notes[0]?.body === 'A +1 sword.');
    expect(characterStore.events().at(-1)).toMatchObject({ type: 'note.updated' });

    // Remove (behind its own confirm dialog)
    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;
    buttonNamed(compiled, charactersEn.sheet.notes.remove).click();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.notes.deleteConfirm.confirm).click();

    await pollUntil(fixture, () => (characterStore.facts()?.notes.length ?? 0) === 0);
    expect(characterStore.events().at(-1)).toMatchObject({ type: 'note.removed' });
  });

  it('cancelling the remove-note confirm dialog appends nothing and keeps the note', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(
      propose.note('added', { id: '01930000-0000-7000-8000-000000000001', title: 'Loot' }),
    );

    const fixture = TestBed.createComponent(NotesDialogComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const eventsBefore = characterStore.events().length;

    buttonNamed(compiled, charactersEn.sheet.notes.remove).click();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.notes.deleteConfirm.cancel).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
    expect(characterStore.facts()?.notes).toHaveLength(1);
  });

  it('a note body over the protocol byte limit is blocked in the dialog with a localized message, and appends nothing', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(NotesDialogComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const eventsBefore = characterStore.events().length;

    buttonNamed(compiled, charactersEn.sheet.notes.add).click();
    TestBed.tick();
    const bodyInput = overlay().querySelector<HTMLTextAreaElement>('textarea')!;
    bodyInput.value = 'x'.repeat(8193); // 1 over NoteAddedV1.shape.body's Zod .max(8192)
    bodyInput.dispatchEvent(new Event('input'));
    TestBed.tick();

    expect(overlay().querySelector('.note-dialog__error')).not.toBeNull();
    const saveButton = buttonNamed(overlay(), charactersEn.sheet.notes.dialog.save);
    expect(saveButton.disabled).toBe(true);
    saveButton.click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
  });
});
