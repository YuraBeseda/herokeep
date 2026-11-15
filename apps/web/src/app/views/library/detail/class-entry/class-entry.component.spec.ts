import { readFileSync } from 'node:fs';
import { By } from '@angular/platform-browser';
import { HkTooltipDirective } from '../../../../ui/tooltip/tooltip.directive';
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

async function mountClass(
  slug: string,
  packs: Pack[] = [corePack],
  entity: ClassEntity = classNamed(slug),
) {
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
  fixture.componentRef.setInput('entity', entity);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const rowFor = (el: HTMLElement, level: number) =>
  el.querySelector<HTMLElement>(`tr[data-level="${level}"]`)!;

describe('ClassEntryComponent', () => {
  it('gives the feature links a tooltip, not a native title', async () => {
    const { fixture } = await mountClass('paladin');
    const hosts = fixture.debugElement.queryAll(By.css('a[href*="paladin-lay-on-hands"]'));
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) {
      expect(host.injector.get(HkTooltipDirective, null)).not.toBeNull();
      expect(host.nativeElement.hasAttribute('title')).toBe(false);
    }
  });

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
  it('draws one column per class-table fact, headed by its feature name, across levels 1-20', async () => {
    const { el } = await mountClass('paladin');
    const headers = Array.from(el.querySelectorAll('thead th.class-entry__column')).map((th) =>
      th.textContent?.trim(),
    );

    // The names are the column features' own (localized) names, in the order the pack lists them.
    expect(headers).toEqual([
      'Prepared Spells',
      '1st',
      'Channel Divinity',
      '2nd',
      '3rd',
      '4th',
      '5th',
    ]);
    // The proficiency bonus column is the Prof. column already drawn, not a second one.
    expect(headers).not.toContain('Proficiency Bonus');

    const cell = (level: number, header: string) =>
      Array.from(rowFor(el, level).querySelectorAll('td.class-entry__cell'))[
        headers.indexOf(header)
      ]?.textContent?.trim();
    const paladin = classNamed('paladin');
    for (let level = 1; level <= 20; level++) {
      const prepared = [...paladin.levels]
        .reverse()
        .find((row) => row.level <= level && row.extra?.['paladin-prepared-spells'] !== undefined);
      expect(cell(level, 'Prepared Spells')).toBe(
        String(prepared?.extra?.['paladin-prepared-spells']),
      );
    }
    // A fact that starts later reads as a dash before it, and carries forward after.
    expect(cell(1, 'Channel Divinity')).toBe('—');
    expect(cell(3, 'Channel Divinity')).toBe('2');
    expect(cell(4, 'Channel Divinity')).toBe('2');
  });

  it('draws the same columns for another class from its own data, with no class named in code', async () => {
    const { el } = await mountClass('barbarian');
    const headers = Array.from(el.querySelectorAll('thead th.class-entry__column')).map((th) =>
      th.textContent?.trim(),
    );
    expect(headers).toEqual(expect.arrayContaining(['Rages', 'Rage Damage']));
    expect(rowFor(el, 1).querySelectorAll('td.class-entry__cell').length).toBe(headers.length);
  });

  it('lists a feature with no description of its own by name, since it is not a column', async () => {
    const pack = structuredClone(corePack);
    const nameless = 'srd-5e-2024:feature/test-nameless-feature';
    pack.entities.push({
      type: 'feature',
      id: nameless,
      name: 'Nameless Gift',
      tags: [],
      prerequisites: [],
      effects: [],
      grants: [],
      choices: [],
    } as unknown as (typeof pack.entities)[number]);
    const paladin = pack.entities.find(
      (e) => e.id === 'srd-5e-2024:class/paladin',
    ) as unknown as ClassEntity;
    paladin.levels[0].grants.push({ feature: nameless });

    const { el } = await mountClass('paladin', [pack], paladin);

    expect(rowFor(el, 1).textContent).toContain('Nameless Gift');
    expect(el.querySelector('.class-entry__features')?.textContent).toContain('Nameless Gift');
  });

  it('names armor and weapon training in the active language, and tools through the item entity', async () => {
    const { fixture, el } = await mountClass('paladin');
    TestBed.inject(LocaleService).setLocale('uk');
    await fixture.whenStable();

    expect(el.querySelector('.class-entry__armor')?.textContent?.trim()).toBe(
      'Легкі, Середні, Важкі, Щити',
    );
    expect(el.querySelector('.class-entry__weapons')?.textContent?.trim()).toBe(
      'Проста, Військова',
    );
  });

  it('names tool training through the item entity, not the slug', async () => {
    const { el } = await mountClass('rogue');
    expect(el.querySelector('.class-entry__tools')?.textContent?.trim()).toContain(
      "Thieves' Tools",
    );
  });

  it('counts the skill choice with the language plural form', async () => {
    const { fixture, el } = await mountClass('paladin');
    TestBed.inject(LocaleService).setLocale('uk');
    await fixture.whenStable();
    expect(el.querySelector('.class-entry__skills')?.textContent).toContain('Оберіть 2:');
  });

  it('shows an options chip on the level a choice is made, counted from the choice query', async () => {
    const { el } = await mountClass('paladin');
    const paladin = classNamed('paladin');
    const choice = paladin.levels[0].choices[0];
    const expected = index.query(
      (choice.pick as { query: Parameters<typeof index.query>[0] }).query,
    ).length;

    const chip = rowFor(el, 1).querySelector('hk-options-chip');
    expect(chip?.querySelector('.hk-options-chip__count')?.textContent?.trim()).toBe(
      String(expected),
    );
    expect(expected).toBeGreaterThan(0);
    const quiet = paladin.levels.find((row) => row.choices.length === 0)!.level;
    expect(rowFor(el, quiet).querySelector('hk-options-chip')).toBeNull();
  });

  it(
    'counts a proficiency-gated pick (Expertise) from the hero' +
      's own skills when a hero sheet is given, as the wizard step does',
    async () => {
      const { fixture, el } = await mountClass('rogue');
      const expertiseRow = (): HTMLElement => {
        const rogue = classNamed('rogue');
        const level = rogue.levels.find((row) =>
          row.choices.some((choice) => choice.id.endsWith('/expertise')),
        )!.level;
        return rowFor(el, level);
      };
      const count = (): string | undefined =>
        Array.from(expertiseRow().querySelectorAll('.class-entry__choice'))
          .find((choice) => choice.textContent?.includes('Expertise'))
          ?.querySelector('.hk-options-chip__count')
          ?.textContent?.trim();
      // No hero: the whole skill list.
      expect(count()).toBe(String(index.byType('skill').length));

      fixture.componentRef.setInput('heroSheet', {
        skills: {
          athletics: { proficiency: 'proficient' },
          stealth: { proficiency: 'proficient' },
        },
      });
      await fixture.whenStable();
      expect(count()).toBe('2');
    },
  );

  it('opens a feature in full from its Full text button, in the description drawer', async () => {
    const { fixture, el } = await mountClass('paladin');
    const button = Array.from(el.querySelectorAll<HTMLButtonElement>('.class-entry__more')).find(
      (b) => b.closest('li')?.textContent?.includes('Lay On Hands'),
    )!;
    expect(button).toBeTruthy();
    expect(el.querySelector('hk-description-drawer')).toBeNull();

    button.click();
    await fixture.whenStable();
    await fixture.whenStable();

    const drawer = el.querySelector('hk-description-drawer');
    expect(drawer?.querySelector('h2')?.textContent?.trim()).toBe('Lay On Hands');
    expect(drawer?.textContent).toContain('pool of healing power');
  });
  it('names a choice prompt and individual weapons in the active language from the installed translation', async () => {
    const ukPack: Pack = {
      format: 1,
      id: 'srd-5e-2024-uk-test',
      version: '0.1.0',
      kind: 'translation',
      name: 'UK test',
      authors: [],
      dependencies: [],
      locale: 'uk',
      translates: { id: PACK_ID, range: `^${PACK_VERSION}` },
      entities: [],
      overrides: [],
      assets: [],
      i18n: {},
      strings: {
        'class/paladin@1/weapon-masteries': { prompt: 'Майстерність зброї' },
        'item/rapier': { name: 'Рапіра' },
      },
    };
    const paladin = await mountClass('paladin', [corePack, ukPack]);
    TestBed.inject(LocaleService).setLocale('uk');
    await paladin.fixture.whenStable();
    expect(
      rowFor(paladin.el, 1).querySelector('.class-entry__choice-prompt')?.textContent?.trim(),
    ).toBe('Майстерність зброї');
    TestBed.resetTestingModule();

    const rogue = await mountClass('rogue', [corePack, ukPack]);
    TestBed.inject(LocaleService).setLocale('uk');
    await rogue.fixture.whenStable();
    const weapons = rogue.el.querySelector('.class-entry__weapons')?.textContent ?? '';
    expect(weapons).toContain('Рапіра'); // translated item entity
    expect(weapons).toContain('Hand Crossbow'); // the item entity name, not the slug "Hand-crossbow"
    expect(weapons).not.toContain('Hand-crossbow');
  });

  it('keeps the hero context in the options chip "See all" link', async () => {
    const { fixture, el } = await mountClass('paladin');
    fixture.componentRef.setInput('heroId', 'char:hero-1');
    await fixture.whenStable();
    fixture.detectChanges();

    const chip = rowFor(el, 1).querySelector<HTMLButtonElement>('.hk-options-chip__chip')!;
    chip.click();
    await fixture.whenStable();
    const links = Array.from(
      rowFor(el, 1).querySelectorAll<HTMLAnchorElement>('.hk-options-chip__popover a'),
    ).map((a) => decodeURIComponent(a.getAttribute('href') ?? ''));
    expect(links.at(-1)).toBe('/library?for=char:hero-1');
    expect(links[0]).toContain('?for=char:hero-1');
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
