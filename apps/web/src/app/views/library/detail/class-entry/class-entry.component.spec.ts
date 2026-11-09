import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { createContentIndex } from '@hk/engine';
import { parsePack, type ClassEntity, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { PackStore } from '@shared/stores/pack.store';
import libraryEn from '../../../../../assets/i18n/library/en.json';
import libraryRu from '../../../../../assets/i18n/library/ru.json';
import libraryUk from '../../../../../assets/i18n/library/uk.json';
import { ClassEntryComponent } from './class-entry.component';
import { summaryOf } from './summary-text';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('; '));
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);
const ruDemoPack = readPack(
  join(repoRoot, 'packages/content/translations/srd-5e-2024-ru-sample.json'),
);
const index = createContentIndex([corePack]);

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'library/en') return of(libraryEn);
    if (langPath === 'library/ru') return of(libraryRu);
    if (langPath === 'library/uk') return of(libraryUk);
    return of({});
  }
}

function classNamed(slug: string): ClassEntity {
  const entity = index.get(`${PACK_ID}:class/${slug}`);
  if (entity?.type !== 'class') throw new Error(`no class ${slug} in the pack`);
  return entity;
}

async function mountClass(slug: string, packs: Pack[] = [corePack]) {
  localStorage.removeItem('hk.locale');
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
      { provide: PackStore, useValue: { packs: signal(packs), ready: signal(true) } },
    ],
  });
  const fixture = TestBed.createComponent(ClassEntryComponent);
  fixture.componentRef.setInput('entity', classNamed(slug));
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const rowFor = (el: HTMLElement, level: number) =>
  el.querySelector<HTMLElement>(`tr[data-level="${level}"]`)!;

describe('ClassEntryComponent', () => {
  afterEach(() => localStorage.removeItem('hk.locale'));

  it('renders a features-by-level row for every level 1-20 from the pack', async () => {
    const { el } = await mountClass('paladin');

    const rows = Array.from(el.querySelectorAll<HTMLElement>('tr.class-entry__level-row'));
    expect(rows.map((row) => row.dataset['level'])).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1)),
    );
  });

  it('takes the proficiency bonus of every row from the pack system table', async () => {
    const { el } = await mountClass('paladin');
    const table = index.system().tables.proficiency;

    for (let level = 1; level <= 20; level++) {
      const cells = rowFor(el, level).querySelectorAll('td');
      expect(cells[0]?.textContent?.trim()).toBe(`+${table[level - 1]}`);
    }
  });

  it('lists the features a level grants, each a link to its library entry', async () => {
    const { el } = await mountClass('paladin');
    const paladin = classNamed('paladin');

    const levelOne = rowFor(el, 1);
    const hrefs = Array.from(levelOne.querySelectorAll<HTMLAnchorElement>('a')).map((a) =>
      decodeURIComponent(a.getAttribute('href') ?? ''),
    );
    expect(hrefs).toContain(`/library/${PACK_ID}:feature/paladin-lay-on-hands`);
    expect(levelOne.textContent).toContain('Lay On Hands');
    // A grant with no text of its own (a bonus or slot row) is bookkeeping, never listed.
    expect(levelOne.textContent).not.toContain('Slots');
    expect(paladin.levels.find((row) => row.level === 1)?.grants.length).toBeGreaterThan(
      hrefs.length,
    );
    expect(rowFor(el, 3).textContent).toContain('Channel Divinity');
  });

  it('shows "Subclass feature" on a level only the subclass adds to', async () => {
    const { el } = await mountClass('paladin');

    const subclassOnly = Array.from(el.querySelectorAll<HTMLElement>('tr.class-entry__level-row'))
      .filter((row) => row.textContent?.includes('Subclass feature'))
      .map((row) => Number(row.dataset['level']));
    expect(subclassOnly.length).toBeGreaterThan(0);
    for (const level of subclassOnly) {
      const classRow = classNamed('paladin').levels.find((row) => row.level === level);
      const classTexts = (classRow?.grants ?? []).filter((grant) => {
        const text = index.get(grant.feature)?.description;
        return !!text && !/^\[[^\]]*\]$/.test(text);
      });
      expect(classTexts).toHaveLength(0);
    }
  });

  it('shows the core traits from the class data: hit die, saves, skills, subclass level', async () => {
    const { el } = await mountClass('paladin');
    const paladin = classNamed('paladin');

    const text = el.textContent ?? '';
    expect(text).toContain(`${paladin.hitDie}`); // the hit die face
    expect(el.querySelector('.class-entry__subclass-level')?.textContent?.trim()).toBe(
      `Chosen at level ${paladin.subclassLevel}`,
    );
    expect(el.querySelector('.class-entry__skills')?.textContent).toContain('Athletics');
    expect(el.querySelector('.class-entry__skills')?.textContent).toContain('Choose 2:');
    expect(el.querySelector('.class-entry__armor')?.textContent).toContain('Heavy');
  });

  it("lists the class's subclasses and its spell list from the pack", async () => {
    const { el } = await mountClass('paladin');

    const subclassLinks = Array.from(
      el.querySelectorAll<HTMLAnchorElement>('.class-entry__subclass a'),
    ).map((a) => a.textContent?.trim());
    expect(subclassLinks).toEqual(['Oath of Devotion']);

    const paladinSpells = index.query({ type: 'spell', classes: [classNamed('paladin').id] });
    const spellLinks = el.querySelectorAll('.class-entry__spell');
    expect(spellLinks.length).toBe(paladinSpells.length);
    expect(spellLinks.length).toBeGreaterThan(0);
    expect(el.querySelector('.class-entry__spell-list')?.textContent).toContain('Level 1');
  });

  it('renders the same 20 rows for a caster and names the class in the table label', async () => {
    const { el } = await mountClass('wizard');

    expect(el.querySelectorAll('tr.class-entry__level-row')).toHaveLength(20);
    expect(el.querySelector('.class-entry__table-wrap')?.getAttribute('aria-label')).toBe(
      'Wizard features by level',
    );
    expect(el.querySelector('.class-entry__spell-list')?.textContent).toContain('Cantrips');
  });

  it('names features in the active language when a translation pack is installed', async () => {
    const { fixture, el } = await mountClass('paladin', [corePack, ruDemoPack]);
    TestBed.inject(LocaleService).setLocale('ru');
    await fixture.whenStable();

    const table = el.querySelector('table')!;
    expect(table.querySelectorAll('thead th')[0]?.textContent?.trim()).toBe('Уровень');
    expect(el.querySelector('.class-entry__subclass-level')?.textContent?.trim()).toContain(
      'Выбирается на уровне',
    );
  });
});

describe('summaryOf', () => {
  it('keeps the first sentence of the first paragraph and strips the markup', () => {
    expect(summaryOf('**Bold** start. Second sentence.\n\nSecond paragraph.')).toBe('Bold start.');
    expect(summaryOf('See [Prone](x:y) here. More.')).toBe('See Prone here.');
  });

  it('cuts a long sentence at a word boundary with an ellipsis', () => {
    const long = `${'word '.repeat(60)}end.`;
    const out = summaryOf(long);
    expect(out.length).toBeLessThanOrEqual(141);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it('returns an empty summary for empty text', () => {
    expect(summaryOf('')).toBe('');
  });
});
