import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import {
  HeroImportBadEventError,
  HeroImportBadZipError,
  HeroReaderService,
  type ImportResult,
} from '@shared/services/export/hero-reader.service';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { HkDb, type CharacterRow } from '@shared/services/storage/dexie.db';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../../assets/i18n/characters/uk.json';
import { CharactersListComponent } from './characters-list.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    if (langPath === 'characters/ru') return of(charactersRu);
    if (langPath === 'characters/uk') return of(charactersUk);
    return of({});
  }
}

function mkRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 'char:00000000-0000-4000-8000-000000000001',
    name: 'Aria',
    system: 'srd-5e-2024',
    archived: false,
    updatedAt: 1000,
    ...overrides,
  };
}

/** Configures the TestBed with a stubbed `CharacterStore.deleteCharacter` (the store's own
 * behavior — leader guard, snapshot/event cleanup — is covered by character.store.spec.ts; this
 * spec only asserts the component calls it and reacts to its outcome). The stub's default
 * implementation actually deletes the row from the real (fake-indexeddb-backed) `characters`
 * table, mirroring what the real `CharacterStore.deleteCharacter` does — the component's
 * post-delete `resource.reload()` re-reads through `CharactersRepository.list()`, so without this
 * the row would never actually disappear from view in the "row disappears" assertion below. */
function configure(): {
  deleteCharacter: ReturnType<typeof vi.fn>;
  importFn: ReturnType<typeof vi.fn>;
} {
  const deleteCharacter = vi.fn();
  const importFn = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
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
      { provide: CharacterStore, useValue: { deleteCharacter } },
      // `HeroReaderService` (plan-6 Task 10) is stubbed here — its OWN real behavior (validation,
      // merge-by-id, storage writes) is already thoroughly covered by
      // `hero-reader.service.spec.ts`; this spec only asserts the component calls it and reacts
      // to its resolved `ImportResult`/rejected typed error, same division of concerns as the
      // `deleteCharacter` stub above.
      { provide: HeroReaderService, useValue: { import: importFn } },
    ],
  });
  const db = TestBed.inject(HkDb);
  deleteCharacter.mockImplementation(async (id: string) => {
    await db.characters.delete(id);
  });
  return { deleteCharacter, importFn };
}

/** Mirrors `build-tab.component.spec.ts`'s own helper exactly — `HTMLInputElement.files` has no
 * public setter, so a real file pick is simulated by redefining the property directly. */
function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

function mkImportResult(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    characterId: 'char:00000000-0000-4000-8000-000000000099',
    name: 'Ivan',
    mode: 'created',
    imported: 2,
    skippedDuplicates: 0,
    warnings: [],
    ...overrides,
  };
}

/** Lets a chain of real (unmocked) fake-indexeddb operations — `db.characters.delete` inside the
 * `deleteCharacter` stub, then the component's own post-delete `resource.reload()` re-running
 * `CharactersRepository.list()` — actually settle before asserting. Neither is tracked by
 * Angular's zoneless stability system (they're plain promises, not `resource()`'s own tracked
 * load or an Angular-known async primitive), so `fixture.whenStable()` alone can resolve before
 * they do; a couple of real macrotask turns plus a final `whenStable()` (to flush the resulting
 * signal writes into a render) is what actually waits for both. */
async function flushDeleteFlow(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
}

function itemNames(fixture: { nativeElement: unknown }): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.characters-list__name'),
  ).map((el) => el.textContent?.trim() ?? '');
}

describe('CharactersListComponent', () => {
  let deleteCharacter: ReturnType<typeof vi.fn>;
  let importFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ deleteCharacter, importFn } = configure());
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.packs.clear(),
      db.settings.clear(),
      db.events.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
    ]);
    // jsdom does not reliably implement Blob-URL support — stub it (same as the other Task 8
    // specs) rather than depend on jsdom's own support.
    URL.createObjectURL = vi.fn(() => 'blob:fake-thumb-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    TestBed.inject(HkDb).close();
  });

  it('renders rows from a seeded repository, newest-first', async () => {
    const db = TestBed.inject(HkDb);
    await db.characters.bulkPut([
      mkRow({ id: 'char:00000000-0000-4000-8000-000000000001', name: 'Older', updatedAt: 1000 }),
      mkRow({ id: 'char:00000000-0000-4000-8000-000000000002', name: 'Newer', updatedAt: 2000 }),
    ]);

    const fixture = TestBed.createComponent(CharactersListComponent);
    await fixture.whenStable();

    expect(itemNames(fixture)).toEqual(['Newer', 'Older']);
  });

  it('shows a friendly empty state when there are no characters', async () => {
    const fixture = TestBed.createComponent(CharactersListComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.characters-list__empty')).not.toBeNull();
    expect(compiled.querySelectorAll('.characters-list__item').length).toBe(0);
  });

  it('the create button navigates to /characters/new', async () => {
    const fixture = TestBed.createComponent(CharactersListComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.characters-list__create')
      ?.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/characters/new']);
  });

  it('clicking a row navigates to /c/<id>', async () => {
    const db = TestBed.inject(HkDb);
    const row = mkRow();
    await db.characters.put(row);
    const fixture = TestBed.createComponent(CharactersListComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.characters-list__open')
      ?.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/c', row.id]);
  });

  it('delete: confirming the dialog calls store.deleteCharacter and the row disappears', async () => {
    const db = TestBed.inject(HkDb);
    const row = mkRow();
    await db.characters.put(row);
    const fixture = TestBed.createComponent(CharactersListComponent);
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.characters-list__delete')
      ?.click();
    TestBed.tick();

    const confirmButton = document.querySelector<HTMLButtonElement>(
      '.characters-delete-confirm__confirm',
    );
    expect(confirmButton).toBeTruthy();
    confirmButton!.click();
    await flushDeleteFlow(fixture);

    expect(deleteCharacter).toHaveBeenCalledWith(row.id);
    expect(itemNames(fixture)).toEqual([]);
  });

  it('delete: cancelling the dialog leaves the row and never calls store.deleteCharacter', async () => {
    const db = TestBed.inject(HkDb);
    const row = mkRow();
    await db.characters.put(row);
    const fixture = TestBed.createComponent(CharactersListComponent);
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.characters-list__delete')
      ?.click();
    TestBed.tick();

    const cancelButton = document.querySelector<HTMLButtonElement>(
      '.characters-delete-confirm__cancel',
    );
    expect(cancelButton).toBeTruthy();
    cancelButton!.click();
    await fixture.whenStable();

    expect(deleteCharacter).not.toHaveBeenCalled();
    expect(itemNames(fixture)).toEqual(['Aria']);
  });

  it('a non-leader delete failure toasts the error code and leaves the row in place', async () => {
    deleteCharacter.mockRejectedValueOnce(new CharacterStoreNotLeaderError());
    const db = TestBed.inject(HkDb);
    const row = mkRow();
    await db.characters.put(row);
    const fixture = TestBed.createComponent(CharactersListComponent);
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.characters-list__delete')
      ?.click();
    TestBed.tick();
    document.querySelector<HTMLButtonElement>('.characters-delete-confirm__confirm')?.click();
    await flushDeleteFlow(fixture);

    expect(showSpy).toHaveBeenCalledWith('characters.not-leader');
    expect(itemNames(fixture)).toEqual(['Aria']);
  });

  // --- Portrait thumbs (plan-6 Task 8) -----------------------------------------------------

  it('a row with portraitThumbHash renders its thumb as an <img>, not the monogram placeholder', async () => {
    const db = TestBed.inject(HkDb);
    const thumbHash = `sha256:${'a'.repeat(64)}`;
    const blobsRepository = TestBed.inject(BlobsRepository);
    await blobsRepository.put(thumbHash, 'image/webp', new Uint8Array([1, 2, 3]), {
      kind: 'thumb',
      width: 256,
      height: 256,
    });
    await db.characters.put(mkRow({ portraitThumbHash: thumbHash }));

    const fixture = TestBed.createComponent(CharactersListComponent);
    await fixture.whenStable();

    let compiled = fixture.nativeElement as HTMLElement;
    // `charactersResource`'s own load resolves, THEN `BlobUrlPipe`'s async `blobsRepository.get`
    // fetch resolves — neither is a `resource()`/Angular-tracked async primitive `whenStable()`
    // alone is guaranteed to wait out, same reasoning as this file's own `flushDeleteFlow`.
    for (
      let i = 0;
      i < 20 && compiled.querySelector('img.characters-list__portrait') === null;
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
      compiled = fixture.nativeElement as HTMLElement;
    }

    const img = compiled.querySelector<HTMLImageElement>('img.characters-list__portrait');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('blob:fake-thumb-url');
    expect(compiled.querySelector('.characters-list__portrait--placeholder')).toBeNull();
  });

  it('a row with NO portraitThumbHash renders the deterministic monogram placeholder instead', async () => {
    const db = TestBed.inject(HkDb);
    await db.characters.put(
      mkRow({ id: 'char:00000000-0000-4000-8000-000000000009', name: 'Beren Erchamion' }),
    );

    const fixture = TestBed.createComponent(CharactersListComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('img.characters-list__portrait')).toBeNull();
    const placeholder = compiled.querySelector('.characters-list__portrait--placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent?.trim()).toBe('BE');
  });

  // --- `.hero` import (plan-6 Task 10) -------------------------------------------------------

  it('the import button opens the hidden file input', async () => {
    const fixture = TestBed.createComponent(CharactersListComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('.characters-list__import-input')!;
    const clickSpy = vi.spyOn(input, 'click');

    compiled.querySelector<HTMLButtonElement>('.characters-list__import')?.click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('selecting a file imports it, reloads the list, and toasts the "created" result with its counts', async () => {
    importFn.mockResolvedValueOnce(
      mkImportResult({ name: 'Ivan Petrov', mode: 'created', imported: 3 }),
    );
    const charactersRepository = TestBed.inject(CharactersRepository);
    const listSpy = vi.spyOn(charactersRepository, 'list');
    const fixture = TestBed.createComponent(CharactersListComponent);
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    await fixture.whenStable();
    const callsBeforeImport = listSpy.mock.calls.length;

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.characters-list__import-input',
    )!;
    const file = new File([new Uint8Array([1, 2, 3])], 'Ivan Petrov.hero');
    setInputFiles(input, [file]);
    await flushDeleteFlow(fixture); // same "settle real async work" helper — not delete-specific

    expect(importFn).toHaveBeenCalledWith(file);
    expect(listSpy.mock.calls.length).toBeGreaterThan(callsBeforeImport); // the list was reloaded
    expect(showSpy).toHaveBeenCalledWith('characters.list.toast.import-created', {
      name: 'Ivan Petrov',
      imported: 3,
      skippedDuplicates: 0,
    });
  });

  it('selecting a file that merges toasts the "merged" result with its counts', async () => {
    importFn.mockResolvedValueOnce(
      mkImportResult({ name: 'Zara', mode: 'merged', imported: 2, skippedDuplicates: 5 }),
    );
    const fixture = TestBed.createComponent(CharactersListComponent);
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    await fixture.whenStable();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.characters-list__import-input',
    )!;
    setInputFiles(input, [new File([new Uint8Array([1])], 'x.hero')]);
    await flushDeleteFlow(fixture);

    expect(showSpy).toHaveBeenCalledWith('characters.list.toast.import-merged', {
      name: 'Zara',
      imported: 2,
      skippedDuplicates: 5,
    });
  });

  it("a typed import failure toasts that error's own code", async () => {
    importFn.mockRejectedValueOnce(new HeroImportBadZipError());
    const fixture = TestBed.createComponent(CharactersListComponent);
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    await fixture.whenStable();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.characters-list__import-input',
    )!;
    setInputFiles(input, [new File([new Uint8Array([1])], 'x.hero')]);
    await flushDeleteFlow(fixture);

    expect(showSpy).toHaveBeenCalledWith('characters.list.toast.import-failed-bad-zip');
  });

  it('a bad-event failure toasts with a 1-based index (friendlier than the 0-based array position)', async () => {
    importFn.mockRejectedValueOnce(new HeroImportBadEventError(2, []));
    const fixture = TestBed.createComponent(CharactersListComponent);
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    await fixture.whenStable();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.characters-list__import-input',
    )!;
    setInputFiles(input, [new File([new Uint8Array([1])], 'x.hero')]);
    await flushDeleteFlow(fixture);

    expect(showSpy).toHaveBeenCalledWith('characters.list.toast.import-failed-bad-event', {
      index: 3,
    });
  });

  it('an unrecognized import failure falls back to the generic failure toast', async () => {
    importFn.mockRejectedValueOnce(new Error('boom'));
    const fixture = TestBed.createComponent(CharactersListComponent);
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    await fixture.whenStable();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.characters-list__import-input',
    )!;
    setInputFiles(input, [new File([new Uint8Array([1])], 'x.hero')]);
    await flushDeleteFlow(fixture);

    expect(showSpy).toHaveBeenCalledWith('characters.list.toast.import-failed-generic');
  });

  it('a cancelled file dialog (no file chosen) never calls HeroReaderService.import', async () => {
    const fixture = TestBed.createComponent(CharactersListComponent);
    await fixture.whenStable();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.characters-list__import-input',
    )!;
    setInputFiles(input, []);
    await flushDeleteFlow(fixture);

    expect(importFn).not.toHaveBeenCalled();
  });

  it('a second file pick while one is still in flight is ignored (re-entrancy guard)', async () => {
    let resolveFirst: (value: ImportResult) => void = () => undefined;
    const pending = new Promise<ImportResult>((resolve) => {
      resolveFirst = resolve;
    });
    importFn.mockReturnValueOnce(pending);
    const fixture = TestBed.createComponent(CharactersListComponent);
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.characters-list__import-input',
    )!;

    setInputFiles(input, [new File([new Uint8Array([1])], 'first.hero')]);
    setInputFiles(input, [new File([new Uint8Array([2])], 'second.hero')]);

    expect(importFn).toHaveBeenCalledTimes(1);
    resolveFirst(mkImportResult());
    await flushDeleteFlow(fixture);
  });

  it('fix-round 1: per-row delete buttons are disabled while an import is in flight, re-enabled once it settles', async () => {
    const db = TestBed.inject(HkDb);
    await db.characters.put(mkRow());
    let resolveImport: (value: ImportResult) => void = () => undefined;
    const pending = new Promise<ImportResult>((resolve) => {
      resolveImport = resolve;
    });
    importFn.mockReturnValueOnce(pending);
    const fixture = TestBed.createComponent(CharactersListComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('.characters-list__import-input')!;

    const deleteButtonBefore = compiled.querySelector<HTMLButtonElement>(
      '.characters-list__delete',
    )!;
    expect(deleteButtonBefore.disabled).toBe(false);

    setInputFiles(input, [new File([new Uint8Array([1])], 'x.hero')]);
    await fixture.whenStable();

    const deleteButtonDuring = compiled.querySelector<HTMLButtonElement>(
      '.characters-list__delete',
    )!;
    expect(deleteButtonDuring.disabled).toBe(true);

    resolveImport(mkImportResult());
    await flushDeleteFlow(fixture);

    const deleteButtonAfter = compiled.querySelector<HTMLButtonElement>(
      '.characters-list__delete',
    )!;
    expect(deleteButtonAfter.disabled).toBe(false);
  });
});
