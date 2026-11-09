import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { propose } from '@hk/engine';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../../../assets/i18n/characters/en.json';
import { press, typeInto } from '../../../../../ui/testing/harness';
import { overlayRoot } from '../../../../../ui/testing/overlay';
import { seedFighter } from '../../testing/character-fixtures';
import { buttonNamed, pollUntil, setupLeafSpec } from '../play-spec-support';
import { NotesDrawerComponent } from './notes-drawer.component';

// The notes drawer (board D01) replaces the notes list dialog: the same add / edit / remove flows,
// now with the editor inline in the drawer and only the remove confirm as a dialog above it.
describe('NotesDrawerComponent', () => {
  setupLeafSpec();

  const NOTE_ID = '01930000-0000-7000-8000-000000000001';

  async function mount(open = true, opener?: HTMLElement) {
    const host = document.createElement('div');
    host.className = 'spec-host';
    document.body.append(host);
    const fixture: ComponentFixture<NotesDrawerComponent> =
      TestBed.createComponent(NotesDrawerComponent);
    host.append(fixture.nativeElement as HTMLElement);
    fixture.componentRef.setInput('open', open);
    if (opener) fixture.componentRef.setInput('opener', opener);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const dialog = (el: HTMLElement) => el.querySelector('[role="dialog"]');
  const key = (name: string) =>
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

  it('renders nothing while closed', async () => {
    await seedFighter('Ivan');
    const { el } = await mount(false);
    expect(dialog(el)).toBeNull();
  });

  it('opens as a dialog named Notes with the empty message, a zero count and Add note', async () => {
    await seedFighter('Ivan');
    const { el } = await mount();
    const named = document.getElementById(dialog(el)!.getAttribute('aria-labelledby')!);
    expect(named?.textContent).toContain(charactersEn.sheet.notes.title);
    expect(el.textContent).toContain(charactersEn.sheet.notes.empty);
    expect(buttonNamed(el, charactersEn.sheet.notes.add)).toBeTruthy();
  });

  it('note add/edit/remove round-trips through propose.note, with the editor inline in the drawer', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const { fixture, el } = await mount();

    // Add: the editor appears inside the drawer, not as a dialog.
    buttonNamed(el, charactersEn.sheet.notes.add).click();
    await fixture.whenStable();
    expect(document.querySelector('.cdk-overlay-container textarea')).toBeNull();
    typeInto(el.querySelector<HTMLInputElement>('input[type="text"]')!, 'Loot');
    typeInto(el.querySelector<HTMLTextAreaElement>('textarea')!, 'A sword.');
    await fixture.whenStable();
    buttonNamed(el, charactersEn.sheet.notes.dialog.save).click();

    await pollUntil(fixture, () => (characterStore.facts()?.notes.length ?? 0) === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'note.added',
      payload: { title: 'Loot', body: 'A sword.' },
    });
    await fixture.whenStable();
    expect(el.querySelector('.notes-drawer__list')!.textContent).toContain('Loot');
    expect(el.querySelector('textarea')).toBeNull(); // the editor closed after saving

    // Edit: the row's Edit control carries the note's title in its name.
    el.querySelector<HTMLButtonElement>(
      `button[aria-label="${charactersEn.sheet.notes.editNamed.replace('{title}', 'Loot')}"]`,
    )!.click();
    await fixture.whenStable();
    const body = el.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(body.value).toBe('A sword.');
    typeInto(body, 'A +1 sword.');
    await fixture.whenStable();
    buttonNamed(el, charactersEn.sheet.notes.dialog.save).click();
    await pollUntil(fixture, () => characterStore.facts()?.notes[0]?.body === 'A +1 sword.');
    expect(characterStore.events().at(-1)).toMatchObject({ type: 'note.updated' });

    // Remove: behind its own confirm dialog.
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>(
      `button[aria-label="${charactersEn.sheet.notes.removeNamed.replace('{title}', 'Loot')}"]`,
    )!.click();
    TestBed.tick();
    buttonNamed(overlayRoot(), charactersEn.sheet.notes.deleteConfirm.confirm).click();
    await pollUntil(fixture, () => (characterStore.facts()?.notes.length ?? 0) === 0);
    expect(characterStore.events().at(-1)).toMatchObject({ type: 'note.removed' });
  });

  it('cancelling the remove-note confirm appends nothing and keeps the note', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.note('added', { id: NOTE_ID, title: 'Loot' }));
    const { fixture, el } = await mount();
    const before = characterStore.events().length;

    el.querySelector<HTMLButtonElement>(
      `button[aria-label="${charactersEn.sheet.notes.removeNamed.replace('{title}', 'Loot')}"]`,
    )!.click();
    TestBed.tick();
    buttonNamed(overlayRoot(), charactersEn.sheet.notes.deleteConfirm.cancel).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(before);
    expect(characterStore.facts()?.notes).toHaveLength(1);
  });

  it('a note body over the protocol byte limit is blocked in the editor with a localized message and appends nothing', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const { fixture, el } = await mount();
    const before = characterStore.events().length;

    buttonNamed(el, charactersEn.sheet.notes.add).click();
    await fixture.whenStable();
    // 1 over NoteAddedV1.shape.body's Zod .max(8192)
    typeInto(el.querySelector<HTMLTextAreaElement>('textarea')!, 'x'.repeat(8193));
    await fixture.whenStable();

    expect(el.querySelector('.note-editor__error')).not.toBeNull();
    const save = buttonNamed(el, charactersEn.sheet.notes.dialog.save);
    expect(save.disabled).toBe(true);
    save.click();
    await fixture.whenStable();
    expect(characterStore.events().length).toBe(before);
  });

  it('Cancel in the editor closes it and appends nothing', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const { fixture, el } = await mount();
    const before = characterStore.events().length;
    buttonNamed(el, charactersEn.sheet.notes.add).click();
    await fixture.whenStable();
    buttonNamed(el, charactersEn.sheet.notes.dialog.cancel).click();
    await fixture.whenStable();
    expect(el.querySelector('textarea')).toBeNull();
    expect(characterStore.events().length).toBe(before);
  });

  it('shows a plural-aware count of notes', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.note('added', { id: NOTE_ID, title: 'One' }));
    const { fixture, el } = await mount();
    expect(el.querySelector('.notes-drawer__count')?.textContent).toContain('1 note ');
    await characterStore.appendTx(
      propose.note('added', { id: '01930000-0000-7000-8000-000000000002', title: 'Two' }),
    );
    await fixture.whenStable();
    expect(el.querySelector('.notes-drawer__count')?.textContent).toContain('2 notes ');
  });

  it('removes a note from inside its own editor, behind the same confirm', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.note('added', { id: NOTE_ID, title: 'Loot' }));
    const { fixture, el } = await mount();
    el.querySelector<HTMLButtonElement>(
      `button[aria-label="${charactersEn.sheet.notes.editNamed.replace('{title}', 'Loot')}"]`,
    )!.click();
    await fixture.whenStable();
    buttonNamed(el, charactersEn.sheet.notes.editorRemove).click();
    TestBed.tick();
    buttonNamed(overlayRoot(), charactersEn.sheet.notes.deleteConfirm.confirm).click();
    await pollUntil(fixture, () => (characterStore.facts()?.notes.length ?? 0) === 0);
  });

  describe('closing and stacking', () => {
    it('Escape closes the drawer and returns focus to its opener', async () => {
      await seedFighter('Ivan');
      const opener = document.createElement('button');
      opener.className = 'spec-host';
      document.body.append(opener);
      opener.focus();
      const { fixture, el } = await mount(true, opener);
      key('Escape');
      await fixture.whenStable();
      expect(dialog(el)).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it('a press outside closes it, a press inside keeps it', async () => {
      await seedFighter('Ivan');
      const outside = document.createElement('button');
      outside.className = 'spec-host';
      document.body.append(outside);
      const { fixture, el } = await mount();
      press(el.querySelector('.notes-drawer__count')!);
      await fixture.whenStable();
      expect(dialog(el)).not.toBeNull();
      press(outside);
      await fixture.whenStable();
      expect(dialog(el)).toBeNull();
    });

    async function openRemoveConfirm() {
      await seedFighter('Ivan');
      const characterStore = TestBed.inject(CharacterStore);
      await characterStore.appendTx(propose.note('added', { id: NOTE_ID, title: 'Loot' }));
      const mounted = await mount();
      mounted.el
        .querySelector<HTMLButtonElement>(
          `button[aria-label="${charactersEn.sheet.notes.removeNamed.replace('{title}', 'Loot')}"]`,
        )!
        .click();
      TestBed.tick();
      return { ...mounted, characterStore };
    }

    it('Escape closes only the remove confirm, and a second Escape closes the drawer', async () => {
      const { fixture, el, characterStore } = await openRemoveConfirm();
      expect(overlayRoot().textContent).toContain(charactersEn.sheet.notes.deleteConfirm.title);
      key('Escape');
      await fixture.whenStable();
      expect(overlayRoot().textContent ?? '').not.toContain(
        charactersEn.sheet.notes.deleteConfirm.title,
      );
      expect(dialog(el)).not.toBeNull();
      expect(characterStore.facts()?.notes).toHaveLength(1);
      key('Escape');
      await fixture.whenStable();
      expect(dialog(el)).toBeNull();
    });

    it('a press on the confirm backdrop dismisses the confirm and leaves the drawer open', async () => {
      const { fixture, el } = await openRemoveConfirm();
      press(document.querySelector('.hk-overlay-backdrop')!);
      await fixture.whenStable();
      expect(overlayRoot().textContent ?? '').not.toContain(
        charactersEn.sheet.notes.deleteConfirm.title,
      );
      expect(dialog(el)).not.toBeNull();
    });
  });
});
