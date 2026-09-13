import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
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
function configure(): { deleteCharacter: ReturnType<typeof vi.fn> } {
  const deleteCharacter = vi.fn();
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
    ],
  });
  const db = TestBed.inject(HkDb);
  deleteCharacter.mockImplementation(async (id: string) => {
    await db.characters.delete(id);
  });
  return { deleteCharacter };
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

  beforeEach(async () => {
    ({ deleteCharacter } = configure());
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.packs.clear(),
      db.settings.clear(),
      db.events.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
    ]);
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
});
