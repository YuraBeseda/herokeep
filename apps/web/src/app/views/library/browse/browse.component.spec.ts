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
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { VirtualListComponent } from '@shared/components/virtual-list/virtual-list.component';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { PackStore } from '@shared/stores/pack.store';
import libraryEn from '../../../../assets/i18n/library/en.json';
import libraryRu from '../../../../assets/i18n/library/ru.json';
import libraryUk from '../../../../assets/i18n/library/uk.json';
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
    if (langPath === 'library/uk') return of(libraryUk);
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
      provideTranslocoMessageformat(),
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

/** Types `text` into the rendered `hk-search-field` input and flushes the field's 150ms debounce
 * with fake timers — mirrors the pattern in `search-field.component.spec.ts`. Must be called
 * after the fixture has already stabilized once (fake timers make `whenStable()` hang). */
function typeSearch(fixture: { nativeElement: unknown }, text: string): void {
  const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
    'input[type="search"]',
  );
  expect(input).toBeTruthy();
  input!.value = text;
  input!.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  TestBed.tick();
}

function summaryText(fixture: { nativeElement: unknown }): string | null {
  const el = (fixture.nativeElement as HTMLElement).querySelector('.library-browse__summary');
  return el?.textContent?.trim() ?? null;
}

describe('LibraryBrowseComponent', () => {
  beforeEach(() => localStorage.removeItem('hk.locale'));

  // Fake timers are enabled only *after* the fixture has stabilized in each search test below:
  // `fixture.whenStable()` depends on real macrotasks internally, so awaiting it while timers
  // are faked hangs (see search-field.component.spec.ts).
  afterEach(() => vi.useRealTimers());

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

  // Acceptance golden (a): "fireball" (en, no translation pack) returns Fireball first, ahead of
  // its 3 substring/prefix matches (Delayed Blast Fireball, Necklace/Wand of Fireballs) — the
  // engine's own `matchScore` ranks the exact-name hit above the partial ones. Search ignores the
  // selected type chip by design (see browse.component.ts `rows` doc comment) — the 3 lower hits
  // are `item`s while the default selected chip is `spell`, proving the type filter is bypassed.
  it('typing "fireball" (golden query) switches to search mode with Fireball first', async () => {
    seedStore([corePack]);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    await fixture.whenStable(); // default selected type is 'spell' — irrelevant once searching

    vi.useFakeTimers();
    typeSearch(fixture, 'fireball');

    const items = virtualListItems(fixture);
    expect(items[0]?.id).toBe('srd-5e-2024:spell/fireball');
    expect(items.length).toBe(4);
  });

  // Acceptance golden (b) plus the ru plural summary (one vs few), asserted against the real
  // ru.json ICU string end-to-end through the rendered component — not a stub.
  it('with the ru demo pack and ru locale, "огненный" (golden query) returns Fireball first, and the summary pluralizes 1 vs 4 results', async () => {
    seedStore([corePack, ruDemoPack]);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    const localeService = TestBed.inject(LocaleService);
    localeService.setLocale('ru');
    await fixture.whenStable();

    vi.useFakeTimers();
    typeSearch(fixture, 'огненный');

    expect(virtualListItems(fixture)[0]?.id).toBe('srd-5e-2024:spell/fireball');
    expect(virtualListItems(fixture).length).toBe(1);
    expect(summaryText(fixture)).toBe('1 результат');

    // Same pack/locale, a query matching 4 entities (see the golden test above) — ru's "few"
    // category (4 % 10 === 4, 4 % 100 not in 12..14) renders a different plural form.
    typeSearch(fixture, 'fireball');

    expect(virtualListItems(fixture)[0]?.id).toBe('srd-5e-2024:spell/fireball');
    expect(virtualListItems(fixture).length).toBe(4);
    expect(summaryText(fixture)).toBe('4 результата');
  });

  // Renders the ru "many" form and all three uk plural categories through the real component
  // (not a direct `TranslocoService.translate()` call with a hand-written scoped key — the
  // `search()` query "e" is deliberately broad: it matches well over `SEARCH_RESULT_LIMIT` (100)
  // real entities, so the rendered count is a deterministic 100 regardless of exact pack size —
  // 100 % 10 === 0, ru/uk's "many" category. "delayed blast fireball" and "fireball" reuse the
  // exact-count queries already proven above (1 and 4 hits) for the "one"/"few" uk forms.
  it('renders the ru "many" and the uk one/few/many plural forms from the real JSON files', async () => {
    seedStore([corePack]);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    const localeService = TestBed.inject(LocaleService);
    await fixture.whenStable();

    localeService.setLocale('ru');
    await fixture.whenStable();
    vi.useFakeTimers();
    typeSearch(fixture, 'e');
    expect(virtualListItems(fixture).length).toBe(100);
    expect(summaryText(fixture)).toBe('100 результатов');
    vi.useRealTimers();

    localeService.setLocale('uk');
    await fixture.whenStable();
    vi.useFakeTimers();

    typeSearch(fixture, 'delayed blast fireball');
    expect(virtualListItems(fixture).length).toBe(1);
    expect(summaryText(fixture)).toBe('1 результат');

    typeSearch(fixture, 'fireball');
    expect(virtualListItems(fixture).length).toBe(4);
    expect(summaryText(fixture)).toBe('4 результати');

    typeSearch(fixture, 'e');
    expect(virtualListItems(fixture).length).toBe(100);
    expect(summaryText(fixture)).toBe('100 результатів');
  });

  it('the results summary is hidden in browse mode', async () => {
    seedStore([corePack]);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    await fixture.whenStable();

    expect(summaryText(fixture)).toBeNull();
  });

  it('clearing the search field restores browse mode rows', async () => {
    seedStore([corePack]);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    await fixture.whenStable(); // default selected type is 'spell'

    vi.useFakeTimers();
    typeSearch(fixture, 'fireball');
    expect(virtualListItems(fixture)[0]?.id).toBe('srd-5e-2024:spell/fireball');
    expect(summaryText(fixture)).not.toBeNull();

    const clearButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.hk-search-field__clear',
    );
    expect(clearButton).toBeTruthy();
    clearButton!.click();
    TestBed.tick();

    expect(summaryText(fixture)).toBeNull();
    const spellCount = corePack.entities.filter((e) => e.type === 'spell').length;
    const restoredRows = virtualListItems(fixture);
    expect(restoredRows.length).toBe(spellCount);
    expect(restoredRows.some((row) => row.id === 'srd-5e-2024:spell/fireball')).toBe(true);
  });

  it('a search hit shows its type label chip', async () => {
    seedStore([corePack]);
    const fixture = TestBed.createComponent(LibraryBrowseComponent);
    await fixture.whenStable();

    vi.useFakeTimers();
    typeSearch(fixture, 'fireball');

    const compiled = fixture.nativeElement as HTMLElement;
    const rows = Array.from(compiled.querySelectorAll('.library-browse__row'));
    const fireballRow = rows.find(
      (row) => row.querySelector('.library-browse__row-name')?.textContent?.trim() === 'Fireball',
    );
    expect(fireballRow?.querySelector('.library-browse__row-type')?.textContent?.trim()).toBe(
      'Spells',
    );
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
