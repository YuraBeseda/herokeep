import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { PackStore } from '@shared/stores/pack.store';
import libraryEn from '../../../../assets/i18n/library/en.json';
import libraryRu from '../../../../assets/i18n/library/ru.json';
import libraryUk from '../../../../assets/i18n/library/uk.json';
import { LibraryDetailComponent } from './detail.component';

// Mirrors the `readPack`/fixture pattern from `browse.component.spec.ts` — the `pretest` script
// guarantees the real built pack is on disk.
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

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'library/en') return of(libraryEn);
    if (langPath === 'library/ru') return of(libraryRu);
    if (langPath === 'library/uk') return of(libraryUk);
    return of({});
  }
}

/** Seeds a stub `PackStore` and a stub `ActivatedRoute` pinned to `id`, and configures the
 * TestBed. Mirrors `browse.component.spec.ts`'s `seedStore`, extended with the route stub this
 * component needs (`toSignal(route.paramMap)` + `route.snapshot.paramMap` for the initial value). */
function seedStore(packs: Pack[], id: string, ready = true) {
  const paramMap = convertToParamMap({ id });
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
      { provide: PackStore, useValue: { packs: signal(packs), ready: signal(ready) } },
      { provide: ActivatedRoute, useValue: { paramMap: of(paramMap), snapshot: { paramMap } } },
    ],
  });
}

function queryText(fixture: { nativeElement: unknown }, selector: string): string | null {
  return (
    (fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent?.trim() ?? null
  );
}

/** Reads a fact row's rendered value by its (already-translated, en) label text. */
function factValue(fixture: { nativeElement: unknown }, label: string): string | null {
  const rows = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.entity-facts__row'),
  );
  const row = rows.find(
    (r) => r.querySelector('.entity-facts__label')?.textContent?.trim() === label,
  );
  return row?.querySelector('.entity-facts__value')?.textContent?.trim() ?? null;
}

describe('LibraryDetailComponent', () => {
  beforeEach(() => localStorage.removeItem('hk.locale'));

  it('renders the fireball spell: name, fact.level = 3, the school fact, and a rendered description', async () => {
    seedStore([corePack], 'srd-5e-2024:spell/fireball');
    const fixture = TestBed.createComponent(LibraryDetailComponent);
    await fixture.whenStable();

    expect(queryText(fixture, '.library-detail__name')).toContain('Fireball');
    expect(factValue(fixture, 'Level')).toBe('3');
    expect(factValue(fixture, 'School')).toBe('Evocation');

    // The description renders asynchronously (MarkdownService dynamically imports marked +
    // dompurify) — `whenStable()` should already cover it, but flush once more defensively.
    await fixture.whenStable();
    const description = (fixture.nativeElement as HTMLElement).querySelector(
      '.library-detail__description-body',
    );
    expect(description?.innerHTML).toContain('<p>');
    expect(description?.textContent).toContain('bright streak');
  });

  it('renders no EN tag for an English-locale entity (fireball has no translation pack installed)', async () => {
    seedStore([corePack], 'srd-5e-2024:spell/fireball');
    const fixture = TestBed.createComponent(LibraryDetailComponent);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.library-detail__tag')).toBeNull();
  });

  it('clicking a cross-link anchor inside a rendered description navigates to that entity', async () => {
    seedStore([corePack], 'srd-5e-2024:spell/fireball');
    const fixture = TestBed.createComponent(LibraryDetailComponent);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const markdownService = TestBed.inject(MarkdownService);
    const domSanitizer = TestBed.inject(DomSanitizer);
    vi.spyOn(markdownService, 'render').mockResolvedValue(
      domSanitizer.bypassSecurityTrustHtml(
        '<p>See <a data-entity-id="srd-5e-2024:condition/prone">Prone</a>.</p>',
      ),
    );

    await fixture.whenStable();
    await fixture.whenStable();

    const anchor = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'a[data-entity-id]',
    );
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute('href')).toBeNull();
    anchor!.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/library', 'srd-5e-2024:condition/prone']);
  });

  it('renders the not-found state and a back button for an unknown id', async () => {
    seedStore([corePack], 'srd-5e-2024:spell/does-not-exist');
    const fixture = TestBed.createComponent(LibraryDetailComponent);
    await fixture.whenStable();

    expect(queryText(fixture, '.library-detail__not-found')).toBe('This entry could not be found.');
    const backButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[hk-button]',
    );
    expect(backButton).toBeTruthy();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    backButton!.click();
    expect(navigateSpy).toHaveBeenCalledWith(['/library']);
  });

  it('shows skeletons instead of content while the pack store is not ready', async () => {
    seedStore([], 'srd-5e-2024:spell/fireball', false);
    const fixture = TestBed.createComponent(LibraryDetailComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('hk-skeleton').length).toBeGreaterThan(0);
    expect(compiled.querySelector('.library-detail__header')).toBeNull();
    expect(compiled.querySelector('.library-detail__not-found')).toBeNull();
  });
});
