import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal, type DebugElement } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PRIMARY_OUTLET, Router, provideRouter } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { VirtualListComponent } from '@shared/components/virtual-list/virtual-list.component';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { PackStore } from '@shared/stores/pack.store';
import libraryEn from '../../../../assets/i18n/library/en.json';
import libraryRu from '../../../../assets/i18n/library/ru.json';
import { LibraryBrowseComponent } from './browse.component';

// Mirrors the `readPack`/fixture-loading pattern from `engine.facade.spec.ts` (not exported
// there, so duplicated here) — the `pretest` script guarantees the real built pack is on disk.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

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
const ruDemoPack = readPack(
  join(repoRoot, 'packages/content/translations/srd-5e-2024-ru-sample.json'),
);

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'library/en') return of(libraryEn);
    if (langPath === 'library/ru') return of(libraryRu);
    return of({});
  }
}

interface RowLike {
  readonly id: string;
  readonly name: string;
  readonly fallback?: boolean;
}

/** Seeds a stub `PackStore` (writable `packs`/`ready` signals) and configures the TestBed. */
function seedStore(packs: Pack[], ready = true) {
  const packsState = signal(packs);
  const readyState = signal(ready);
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
      { provide: PackStore, useValue: { packs: packsState, ready: readyState } },
    ],
  });
  return { packsState, readyState };
}

/** Reads the real row array the component fed into `hk-virtual-list`'s `items` input — the
 * reliable way to assert on the full row set, since jsdom gives `cdk-virtual-scroll-viewport` a
 * zero-size viewport and it only ever paints a small buffered prefix (see task-10-report.md). */
function virtualListItems(fixture: { debugElement: DebugElement }): RowLike[] {
  const debugEl = fixture.debugElement.query(By.directive(VirtualListComponent));
  expect(debugEl).toBeTruthy();
  return (debugEl.componentInstance as { items: () => RowLike[] }).items();
}

describe('LibraryBrowseComponent', () => {
  beforeEach(() => localStorage.removeItem('hk.locale'));

  it('selecting the class chip renders all 12 real classes', async () => {
    seedStore([corePack]);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    await fixture.whenStable();

    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll('hk-chip');
    // 'class' is first in the fixed type-filter order (see LIBRARY_TYPES).
    (chips[0] as HTMLElement).click();
    await fixture.whenStable();

    expect(virtualListItems(fixture).length).toBe(12);
  });

  it('sorts ru class rows with Intl.Collator: Бард before Варвар before Воин', async () => {
    seedStore([corePack, ruDemoPack]);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    const localeService = TestBed.inject(LocaleService);
    localeService.setLocale('ru');
    await fixture.whenStable();

    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll('hk-chip');
    (chips[0] as HTMLElement).click();
    await fixture.whenStable();

    const names = virtualListItems(fixture).map((row) => row.name);
    expect(names.indexOf('Бард')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Варвар')).toBeGreaterThan(names.indexOf('Бард'));
    expect(names.indexOf('Воин')).toBeGreaterThan(names.indexOf('Варвар'));
  });

  it('in ru, an untranslated spell row shows the EN tag and a translated one does not', async () => {
    seedStore([corePack, ruDemoPack]);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    const localeService = TestBed.inject(LocaleService);
    localeService.setLocale('ru');
    await fixture.whenStable(); // default selected type is 'spell' — no chip click needed

    const compiled = fixture.nativeElement as HTMLElement;
    const rows = Array.from(compiled.querySelectorAll('.library-browse__row'));
    const rowNamed = (name: string) =>
      rows.find(
        (row) => row.querySelector('.library-browse__row-name')?.textContent?.trim() === name,
      );

    const translatedRow = rowNamed('Огненный шар');
    const untranslatedRow = rowNamed('Acid Arrow');
    expect(translatedRow).toBeTruthy();
    expect(untranslatedRow).toBeTruthy();
    expect(translatedRow?.querySelector('.library-browse__row-tag')).toBeNull();
    expect(untranslatedRow?.querySelector('.library-browse__row-tag')?.textContent?.trim()).toBe(
      'EN',
    );
  });

  it('row click navigates to /library/<id>, passing the raw id through for the router to encode', async () => {
    seedStore([corePack]);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await fixture.whenStable(); // default selected type is 'spell'

    const [firstItem] = virtualListItems(fixture);
    expect(firstItem).toBeTruthy();

    const firstRowButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.library-browse__row',
    );
    expect(firstRowButton).toBeTruthy();
    firstRowButton?.click();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledWith(['/library', firstItem.id]);
  });

  it('shows skeletons instead of the list while the pack store is not ready', async () => {
    seedStore([], false);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('hk-skeleton').length).toBeGreaterThan(0);
    expect(compiled.querySelector('hk-virtual-list')).toBeNull();
  });

  // Regression test for the id-encoding decision documented on `onRowClick`: a raw entity id
  // (containing both `:` and `/`) passed as its own router command segment round-trips through
  // Angular's own URL serializer with no manual `encodeURIComponent` — the router escapes the
  // embedded `/` as `%2F` (keeping it one path segment) and decodes it straight back to the
  // original string when the URL is re-parsed (e.g. by a hard reload, or Task 12's detail route).
  it('the router itself round-trips an id containing ":" and "/" — no manual encoding needed', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const router = TestBed.inject(Router);
    const rawId = 'srd-5e-2024:spell/fireball';

    const url = router.createUrlTree(['/library', rawId]).toString();
    expect(url).toBe('/library/srd-5e-2024:spell%2Ffireball');

    const reparsed = router.parseUrl(url);
    const idSegment = reparsed.root.children[PRIMARY_OUTLET]?.segments[1]?.path;
    expect(idSegment).toBe(rawId);
  });
});
