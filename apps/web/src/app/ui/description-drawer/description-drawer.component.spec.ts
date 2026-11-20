import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Component, inject, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { createContentIndex } from '@hk/engine';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { provideEngineScope } from '@shared/services/engine/engine-scope.providers';
import { CharacterEngineScope } from '@shared/stores/character-engine-scope';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { DialogService } from '@app/ui/dialog/dialog.service';
import sampleJson from '../../../testing/fixtures/packs/sample-content.json';
import libraryEn from '../../../assets/i18n/library/en.json';
import libraryRu from '../../../assets/i18n/library/ru.json';
import libraryUk from '../../../assets/i18n/library/uk.json';
import shellEn from '../../../assets/i18n/shell/en.json';
import shellRu from '../../../assets/i18n/shell/ru.json';
import shellUk from '../../../assets/i18n/shell/uk.json';
import { HkDescriptionDrawerComponent } from './description-drawer.component';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.ok) throw new Error(`fixture pack failed validation: ${path}`);
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

const bundles: Record<string, object> = {
  'library/en': libraryEn,
  'library/ru': libraryRu,
  'library/uk': libraryUk,
  'shell/en': shellEn,
  'shell/ru': shellRu,
  'shell/uk': shellUk,
};

class Loader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(bundles[langPath] ?? {});
  }
}

@Component({
  imports: [HkDescriptionDrawerComponent],
  template: `
    <hk-description-drawer [entity]="entity()" [(open)]="open">
      <button hkDrawerAction type="button" class="choose">{{ chooseText }}</button>
    </hk-description-drawer>
  `,
})
class Host {
  readonly entity = signal('');
  readonly open = signal(true);
  protected readonly chooseText = 'Choose';
}

async function render(id: string): Promise<{ fixture: ComponentFixture<Host>; el: HTMLElement }> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
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
        loader: Loader,
      }),
      provideTranslocoMessageformat(),
      { provide: PackStore, useValue: { packs: signal([corePack]), ready: signal(true) } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.entity.set(id);
  await fixture.whenStable();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const body = (el: HTMLElement) => el.querySelector('.hk-description__body')?.textContent ?? '';

describe('HkDescriptionDrawerComponent', () => {
  beforeEach(() => localStorage.removeItem('hk.locale'));

  // Ruling 5 (the "descriptions don't show" defect): one RED per surface, on real SRD ids.
  it.each([
    [
      'a species (text lives on its granted features)',
      'srd-5e-2024:species/dwarf',
      'Dwarf',
      'Darkvision with a range of 120 feet',
    ],
    [
      'a class feature',
      'srd-5e-2024:feature/fighter-second-wind',
      'Second Wind',
      'limited well of physical and mental stamina',
    ],
    ['a spell', 'srd-5e-2024:spell/fireball', 'Fireball', 'bright streak'],
    ['an item', 'srd-5e-2024:item/acid', 'Acid', 'vial of Acid'],
    ['a condition', 'srd-5e-2024:condition/blinded', 'Blinded', 'Can’t See'],
  ])('shows the name and the description text of %s', async (_label, id, name, text) => {
    const { el } = await render(id);
    expect(el.querySelector('[role="dialog"] h2')?.textContent?.trim()).toBe(name);
    expect(body(el)).toContain(text);
  });

  it('names the entry type as a chip', async () => {
    const { el } = await render('srd-5e-2024:spell/fireball');
    expect(el.querySelector('.hk-description__type')?.textContent?.trim()).toBe('Spells');
  });

  it('links to the full library entry', async () => {
    const { el } = await render('srd-5e-2024:spell/fireball');
    const link = el.querySelector<HTMLAnchorElement>('a.hk-description__open-page')!;
    expect(link.getAttribute('aria-label')).toBe('Open entry');
    expect(decodeURIComponent(link.getAttribute('href')!)).toBe(
      '/library/srd-5e-2024:spell/fireball',
    );
  });

  it('lists a class\x27s choices with an options chip counted like the wizard picker', async () => {
    const { el } = await render('srd-5e-2024:class/paladin');
    const rows = el.querySelectorAll('.hk-description__choice');
    expect(rows.length).toBeGreaterThan(0);
    const mastery = Array.from(rows).find((row) => row.textContent?.includes('Weapon Masteries'))!;
    const expected = createContentIndex([corePack])
      .byType('item')
      .filter((item) => item.type === 'item' && item.weapon?.mastery !== undefined).length;
    expect(mastery.querySelector('.hk-options-chip__count')?.textContent?.trim()).toBe(
      String(expected),
    );
    expect(mastery.textContent).toContain('Level 1');
  });

  it('shows the higher-level text and dice for a spell', async () => {
    const { el } = await render('srd-5e-2024:spell/fireball');
    const block = el.querySelector('.hk-higher-levels');
    expect(block?.textContent).toContain('At higher levels');
    expect(block?.textContent).toContain('The damage increases by 1d6');
    expect(block?.textContent).toContain('Slot 4: 9d6');
  });

  it('shows no choices section for an entry that offers none', async () => {
    const { el } = await render('srd-5e-2024:spell/fireball');
    expect(el.querySelector('.hk-description__choice')).toBeNull();
  });

  it('projects the primary action into the drawer footer', async () => {
    const { el } = await render('srd-5e-2024:spell/fireball');
    expect(el.querySelector('.hk-drawer__actions .choose')?.textContent?.trim()).toBe('Choose');
  });

  it('says so, never blank, for an id the pack does not know', async () => {
    const { el } = await render('srd-5e-2024:spell/does-not-exist');
    expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    expect(el.querySelector('.hk-description__not-found')?.textContent?.trim()).toBe(
      'This entry could not be found.',
    );
  });

  it('follows the entity input when it changes', async () => {
    const { fixture, el } = await render('srd-5e-2024:spell/fireball');
    fixture.componentInstance.entity.set('srd-5e-2024:condition/blinded');
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('[role="dialog"] h2')?.textContent?.trim()).toBe('Blinded');
    expect(body(el)).toContain('Can’t See');
    expect(body(el)).not.toContain('bright streak');
  });
});

// Ruling R30: the drawer takes no characterId because EngineFacade is scoped by the ELEMENT
// injector. Proven here against a pack only the character pins, through both paths a view uses.
const parsedSample = parsePack(sampleJson);
if (!parsedSample.ok) throw new Error('sample-content.json fixture no longer parses');
const samplePack = parsedSample.pack;
const SCOPED_ID = 'sample-content:feat/lunar-insight';
const SCOPED_TEXT = 'phases of the moon';

@Component({
  selector: 'app-in-dialog',
  imports: [HkDescriptionDrawerComponent],
  template: `<hk-description-drawer [entity]="id" [open]="true" />`,
})
class InDialog {
  protected readonly id = SCOPED_ID;
}

@Component({
  imports: [HkDescriptionDrawerComponent],
  providers: [CharacterEngineScope, provideEngineScope(CharacterEngineScope)],
  template: `
    <hk-description-drawer [entity]="id" [open]="open()" />
    <button type="button" class="via-dialog" (click)="dialogs.open(Content)">{{ label }}</button>
  `,
})
class ScopedHost {
  protected readonly id = SCOPED_ID;
  protected readonly Content = InDialog;
  protected readonly label = 'dialog';
  protected readonly dialogs = inject(DialogService);
  readonly open = signal(true);
}

describe('HkDescriptionDrawerComponent inside a character scope (R30)', () => {
  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
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
          loader: Loader,
        }),
        provideTranslocoMessageformat(),
        {
          provide: PackStore,
          useValue: { packs: signal([corePack, samplePack]), ready: signal(true) },
        },
        {
          provide: CharacterStore,
          useValue: {
            facts: signal({
              pins: { [corePack.id]: corePack.version, [samplePack.id]: samplePack.version },
            }),
            streamId: signal('char:hero-1'),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.remove()));

  it('the root (unscoped) facade cannot see the pinned pack: the control for the specs below', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.entity.set(SCOPED_ID);
    await fixture.whenStable();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.hk-description__not-found')).not.toBeNull();
    expect(el.textContent).not.toContain(SCOPED_TEXT);
  });

  it('rendered inside the scope it resolves the pinned pack entry and its text', async () => {
    const fixture = TestBed.createComponent(ScopedHost);
    await fixture.whenStable();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="dialog"] h2')?.textContent?.trim()).toBe('Lunar Insight');
    expect(el.querySelector('.hk-description__body')?.textContent).toContain(SCOPED_TEXT);
  });

  it('under a hero the library link carries that hero (?for=), and plain outside a hero', async () => {
    const scoped = TestBed.createComponent(ScopedHost);
    await scoped.whenStable();
    await scoped.whenStable();
    const link = (scoped.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'a.hk-description__open-page',
    )!;
    expect(decodeURIComponent(link.getAttribute('href')!)).toBe(
      `/library/${SCOPED_ID}?for=char:hero-1`,
    );

    const plain = TestBed.createComponent(Host);
    plain.componentInstance.entity.set('srd-5e-2024:spell/fireball');
    await plain.whenStable();
    await plain.whenStable();
    const plainLink = (plain.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'a.hk-description__open-page',
    )!;
    expect(decodeURIComponent(plainLink.getAttribute('href')!)).toBe(
      '/library/srd-5e-2024:spell/fireball',
    );
  });

  it('opened through the scoped DialogService (the overlay/portal path) it keeps the scope', async () => {
    const fixture = TestBed.createComponent(ScopedHost);
    fixture.componentInstance.open.set(false);
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.via-dialog')!.click();
    await fixture.whenStable();
    await fixture.whenStable();
    const overlay = document.querySelector('.cdk-overlay-container')!;
    expect(overlay.querySelector('.hk-description__body')?.textContent).toContain(SCOPED_TEXT);
  });
});
