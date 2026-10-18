import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SafeHtml } from '@angular/platform-browser';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { EngineFacade, EngineScope } from '@shared/services/engine/engine.facade';
import { PackStore } from '@shared/stores/pack.store';
import sampleJson from '../../../../testing/fixtures/packs/sample-content.json';
import { MarkdownService } from './markdown.service';

// Mirrors the `readPack`/stub-store pattern from `engine.facade.spec.ts` — the `pretest` script
// guarantees the real built pack is on disk before this file runs.
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
  getTranslation() {
    return of({});
  }
}

function seedStore(packs: Pack[]) {
  TestBed.configureTestingModule({
    providers: [
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
      { provide: PackStore, useValue: { packs: signal(packs) } },
    ],
  });
}

/** Unwraps the `SafeHtml` produced by `render()` back into a plain string for DOM assertions.
 * `DomSanitizer.bypassSecurityTrustHtml`'s return value carries the raw string on this internal
 * property — reaching into it here (rather than mounting a component to read `[innerHTML]`) keeps
 * this a pure, TestBed-light service spec; `detail.component.spec.ts` covers the real binding. */
function htmlOf(safe: SafeHtml): string {
  return (safe as unknown as { changingThisBreaksApplicationSecurity: string })
    .changingThisBreaksApplicationSecurity;
}

describe('MarkdownService', () => {
  beforeEach(() => localStorage.removeItem('hk.locale'));

  it('renders bold text and a GFM table', async () => {
    seedStore([corePack]);
    const service = TestBed.inject(MarkdownService);

    const html = htmlOf(await service.render('**bold**\n\n| A | B |\n| - | - |\n| 1 | 2 |'));

    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('strips <script> tags and onclick/onerror attributes', async () => {
    seedStore([corePack]);
    const service = TestBed.inject(MarkdownService);

    const html = htmlOf(
      await service.render(
        '<script>alert(1)</script>\n\n<a href="https://example.com" onclick="alert(2)" onerror="alert(3)">link</a>',
      ),
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('resolves a [[<entity-id>]] token to an anchor with the localized name and data-entity-id', async () => {
    seedStore([corePack]);
    const service = TestBed.inject(MarkdownService);

    const html = htmlOf(await service.render('See [[srd-5e-2024:condition/prone]].'));

    expect(html).toContain('data-entity-id="srd-5e-2024:condition/prone"');
    expect(html).toMatch(/<a[^>]*data-entity-id="srd-5e-2024:condition\/prone"[^>]*>Prone<\/a>/);
  });

  it('keeps the raw id as the link text for an unknown cross-link', async () => {
    seedStore([corePack]);
    const service = TestBed.inject(MarkdownService);

    const html = htmlOf(await service.render('See [[srd-5e-2024:spell/does-not-exist]].'));

    expect(html).toMatch(
      /<a[^>]*data-entity-id="srd-5e-2024:spell\/does-not-exist"[^>]*>srd-5e-2024:spell\/does-not-exist<\/a>/,
    );
  });

  it('gives an entity cross-link anchor no href', async () => {
    seedStore([corePack]);
    const service = TestBed.inject(MarkdownService);

    const html = htmlOf(await service.render('[[srd-5e-2024:condition/prone]]'));

    expect(html).toMatch(/<a data-entity-id="srd-5e-2024:condition\/prone">Prone<\/a>/);
  });

  it('adds rel="noopener noreferrer" and target="_blank" to external http(s) links', async () => {
    seedStore([corePack]);
    const service = TestBed.inject(MarkdownService);

    const html = htmlOf(await service.render('[external](https://example.com/rules)'));

    expect(html).toContain('href="https://example.com/rules"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('shifts heading levels down by one so an authored h1 renders as h2', async () => {
    seedStore([corePack]);
    const service = TestBed.inject(MarkdownService);

    const html = htmlOf(await service.render('# Top\n\n## Sub'));

    expect(html).toContain('<h2>Top</h2>');
    expect(html).toContain('<h3>Sub</h3>');
    expect(html).not.toContain('<h1>');
  });
});

// --- Plan 15 Task 4 fix round 1: `MarkdownService` is root-provided, so a caller rendering for a
// character passes ITS (scoped) localizer; the default stays the root (core-only) one.
describe('MarkdownService — cross-links resolve against the caller localizer (plan 15 Task 4)', () => {
  const parsedSample = parsePack(sampleJson);
  if (!parsedSample.ok) throw new Error('sample-content.json fixture no longer parses');
  const sample = parsedSample.pack;
  const MOONKIN = 'sample-content:species/moonkin';

  it("a cross-link to a pinned pack's entity renders its name and its data-entity-id link", async () => {
    seedStore([corePack, sample]);
    const pins = signal({ [corePack.id]: corePack.version, [sample.id]: sample.version });
    const scoped = Injector.create({
      providers: [EngineFacade, { provide: EngineScope, useValue: { pins } }],
      parent: TestBed.inject(Injector),
    }).get(EngineFacade);
    const localizer = scoped.localizer();

    const html = htmlOf(
      await TestBed.inject(MarkdownService).render(`See [[${MOONKIN}]].`, localizer),
    );

    const anchor = new DOMParser().parseFromString(html, 'text/html').querySelector('a');
    expect(anchor?.textContent).toBe('Moonkin');
    expect(anchor?.getAttribute('data-entity-id')).toBe(MOONKIN);
  });

  it('without a localizer it still resolves against the root (core-only) index', async () => {
    seedStore([corePack, sample]);

    const html = htmlOf(await TestBed.inject(MarkdownService).render(`See [[${MOONKIN}]].`));

    const anchor = new DOMParser().parseFromString(html, 'text/html').querySelector('a');
    expect(anchor?.textContent).toBe(MOONKIN);
  });
});
