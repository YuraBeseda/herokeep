import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { PackStore } from '@shared/stores/pack.store';
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
    const link = el.querySelector<HTMLAnchorElement>('a.hk-description__open')!;
    expect(link.textContent?.trim()).toBe('Open entry');
    expect(decodeURIComponent(link.getAttribute('href')!)).toBe(
      '/library/srd-5e-2024:spell/fireball',
    );
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
