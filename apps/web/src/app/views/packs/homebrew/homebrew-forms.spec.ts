import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { error as engineError } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Entity, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { HomebrewIdService } from '@shared/services/packs/homebrew-id';
import { HomebrewService, HomebrewValidationError } from '@shared/services/packs/homebrew.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { PackStore } from '@shared/stores/pack.store';
import packsEn from '../../../../assets/i18n/packs/en.json';
import { FeatFormComponent } from './feat-form.component';
import { HomebrewEditorComponent } from './homebrew-editor.component';
import { ItemFormComponent } from './item-form.component';
import { SpeciesFormComponent } from './species-form.component';
import { SpellFormComponent } from './spell-form.component';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');
const corePack: Pack = (() => {
  const path = join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json');
  const parsed = parsePack(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error('core pack fixture no longer parses');
  return parsed.pack;
})();

const hb = packsEn.homebrew;
/** This device's homebrew pack id (stubbed `HomebrewIdService`). */
const LOCAL = 'homebrew-aaaaaaaa';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'packs/en' ? packsEn : {});
  }
}

/** Real `HomebrewService` over a stub `PackStore` (core only; installs are recorded, not stored). */
function configure(extra: unknown[] = []) {
  const installContent = vi.fn().mockResolvedValue(undefined);
  const show = vi.fn();
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
      {
        provide: PackStore,
        useValue: {
          packs: signal([corePack]),
          corePack: signal(corePack),
          installedContent: signal<Pack[]>([]),
          ready: signal(true),
          installContent,
          removeContent: vi.fn().mockResolvedValue(undefined),
        },
      },
      { provide: LocaleService, useValue: { locale: signal('en'), contentLocale: signal('en') } },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
      { provide: ToastService, useValue: { show } },
      {
        provide: HomebrewIdService,
        useValue: { id: signal(LOCAL), ensure: () => Promise.resolve(LOCAL) },
      },
      ...(extra as never[]),
    ],
  });
  return { installContent, show };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

interface Rendered<T> {
  fixture: ComponentFixture<T>;
  root: HTMLElement;
  emitted: Entity[];
}

async function renderForm<T extends { submitted: { subscribe(fn: (e: Entity) => void): unknown } }>(
  component: Type<T>,
  entity?: Entity,
): Promise<Rendered<T>> {
  const fixture = TestBed.createComponent(component);
  if (entity) fixture.componentRef.setInput('entity', entity);
  const emitted: Entity[] = [];
  fixture.componentInstance.submitted.subscribe((e) => emitted.push(e));
  await settle(fixture);
  return { fixture, root: fixture.nativeElement as HTMLElement, emitted };
}

function el<E extends Element = HTMLInputElement>(root: HTMLElement, selector: string): E {
  const found = root.querySelector<E>(selector);
  if (!found) throw new Error(`no element ${selector}`);
  return found;
}

async function type(
  fixture: ComponentFixture<unknown>,
  root: HTMLElement,
  selector: string,
  value: string,
) {
  const input = el<HTMLInputElement | HTMLTextAreaElement>(root, selector);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await settle(fixture);
}

async function choose(
  fixture: ComponentFixture<unknown>,
  root: HTMLElement,
  selector: string,
  value: string,
) {
  const select = el<HTMLSelectElement>(root, selector);
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await settle(fixture);
}

async function tick(fixture: ComponentFixture<unknown>, root: HTMLElement, selector: string) {
  el(root, selector).click();
  await settle(fixture);
}

async function save(fixture: ComponentFixture<unknown>, root: HTMLElement) {
  el<HTMLButtonElement>(root, '.hb-form__save').click();
  await settle(fixture);
}

const alerts = (root: HTMLElement) =>
  [...root.querySelectorAll('.hb-form__error')].map((p) => p.textContent?.trim());

/** The emitted entity is accepted by `parsePack` inside the pack the real service builds. */
async function expectSavable(entity: Entity, installContent: ReturnType<typeof vi.fn>) {
  const result = await TestBed.inject(HomebrewService).save(entity);
  expect(parsePack(result.pack).ok).toBe(true);
  expect(result.pack.entities).toEqual([entity]);
  expect(installContent).toHaveBeenCalledWith(result.pack, new Map());
}

describe('ItemFormComponent', () => {
  it('produces a weapon the homebrew pack accepts', async () => {
    const { installContent } = configure();
    const { fixture, root, emitted } = await renderForm(ItemFormComponent);

    await type(fixture, root, '.hb-form__name', 'Coral Knife');
    await choose(fixture, root, '.hb-form__category', 'weapon');
    await type(fixture, root, '.hb-form__damage', '1d4');
    await tick(fixture, root, '.hb-form__property[data-property="light"]');
    await save(fixture, root);

    expect(emitted).toHaveLength(1);
    const item = emitted[0];
    expect(item).toMatchObject({
      id: 'homebrew-aaaaaaaa:item/coral-knife',
      type: 'item',
      name: 'Coral Knife',
      category: 'weapon',
      weapon: { kind: 'melee', category: 'simple', damage: '1d4', properties: ['light'] },
    });
    await expectSavable(item, installContent);
  });

  it('blocks Save with translated messages while required weapon fields are missing or malformed', async () => {
    configure();
    const { fixture, root, emitted } = await renderForm(ItemFormComponent);
    await choose(fixture, root, '.hb-form__category', 'weapon');

    await save(fixture, root);
    expect(emitted).toEqual([]);
    expect(alerts(root)).toEqual([hb.field.required, hb.field.required]);
    expect(el(root, '.hb-form__name').getAttribute('aria-invalid')).toBe('true');

    await type(fixture, root, '.hb-form__name', 'Odd Blade');
    await type(fixture, root, '.hb-form__damage', 'banana');
    await save(fixture, root);
    expect(emitted).toEqual([]);
    expect(alerts(root)).toEqual([hb.field.item['damage-invalid']]);
  });

  it('pre-fills an edited armor and keeps its id', async () => {
    const { installContent } = configure();
    const armor = {
      type: 'item',
      id: 'homebrew-aaaaaaaa:item/shell-mail',
      name: 'Shell Mail',
      tags: [],
      prerequisites: [],
      effects: [],
      grants: [],
      choices: [],
      category: 'armor',
      armor: { category: 'medium', ac: 14, dexCap: 2, stealthDisadvantage: true },
    } as Entity;
    const { fixture, root, emitted } = await renderForm(ItemFormComponent, armor);

    expect(el(root, '.hb-form__name').value).toBe('Shell Mail');
    expect(el<HTMLSelectElement>(root, '.hb-form__category').value).toBe('armor');
    expect(el(root, '.hb-form__ac input').value).toBe('14');
    expect(el(root, '.hb-form__stealth').checked).toBe(true);

    await save(fixture, root);
    expect(emitted[0]).toEqual(armor);
    await expectSavable(emitted[0], installContent);
  });
});

describe('SpellFormComponent', () => {
  it('produces a spell the homebrew pack accepts', async () => {
    const { installContent } = configure();
    const { fixture, root, emitted } = await renderForm(SpellFormComponent);

    await type(fixture, root, '.hb-form__name', 'Огненный шар');
    await tick(fixture, root, '.hb-form__class[data-class="wizard"]');
    await tick(fixture, root, '.hb-form__v');
    await save(fixture, root);

    expect(emitted).toHaveLength(1);
    const spell = emitted[0];
    expect(spell).toMatchObject({
      id: 'homebrew-aaaaaaaa:spell/ognennyy-shar',
      type: 'spell',
      level: 0,
      castingTime: { value: 1, unit: 'action' },
      range: { kind: 'self' },
      components: { v: true, s: false, m: false },
      duration: { kind: 'instantaneous' },
      classes: ['wizard'],
    });
    await expectSavable(spell, installContent);
  });

  it('requires at least one class and a distance for a feet range', async () => {
    configure();
    const { fixture, root, emitted } = await renderForm(SpellFormComponent);
    await type(fixture, root, '.hb-form__name', 'Spark');
    await choose(fixture, root, '.hb-form__range-kind', 'feet');

    await save(fixture, root);
    expect(emitted).toEqual([]);
    expect(alerts(root)).toEqual([hb.field['positive-number'], hb.field.spell['classes-required']]);
  });

  it('pre-fills an edited spell', async () => {
    configure();
    const spell = {
      type: 'spell',
      id: 'homebrew-aaaaaaaa:spell/glimmer',
      name: 'Glimmer',
      tags: [],
      prerequisites: [],
      effects: [],
      grants: [],
      choices: [],
      level: 3,
      school: 'evocation',
      castingTime: { value: 1, unit: 'bonus' },
      range: { kind: 'feet', distance: 60 },
      components: { v: true, s: false, m: true, materialText: 'a pearl' },
      duration: { kind: 'time', value: 10, unit: 'minute' },
      concentration: true,
      ritual: false,
      classes: ['bard', 'wizard'],
    } as Entity;
    const { fixture, root, emitted } = await renderForm(SpellFormComponent, spell);

    expect(el(root, '.hb-form__level input').value).toBe('3');
    expect(el(root, '.hb-form__range-distance input').value).toBe('60');
    expect(el(root, '.hb-form__material-text').value).toBe('a pearl');
    expect(el(root, '.hb-form__class[data-class="bard"]').checked).toBe(true);

    await save(fixture, root);
    expect(emitted[0]).toEqual(spell);
  });
});

describe('FeatFormComponent', () => {
  it('produces a feat whose benefit is a feature.text effect the pack accepts', async () => {
    const { installContent } = configure();
    const { fixture, root, emitted } = await renderForm(FeatFormComponent);

    await type(fixture, root, '.hb-form__name', 'Tide Reader');
    await choose(fixture, root, '.hb-form__category', 'origin');
    await type(fixture, root, '.hb-form__description', 'You always know when the tide turns.');
    await save(fixture, root);

    const feat = emitted[0];
    expect(feat).toMatchObject({
      id: 'homebrew-aaaaaaaa:feat/tide-reader',
      type: 'feat',
      category: 'origin',
      repeatable: false,
      description: 'You always know when the tide turns.',
      effects: [
        {
          type: 'feature.text',
          name: 'Tide Reader',
          description: 'You always know when the tide turns.',
        },
      ],
    });
    await expectSavable(feat, installContent);
  });

  it('requires the benefit text', async () => {
    configure();
    const { fixture, root, emitted } = await renderForm(FeatFormComponent);
    await type(fixture, root, '.hb-form__name', 'Empty');
    await save(fixture, root);
    expect(emitted).toEqual([]);
    expect(alerts(root)).toEqual([hb.field.required]);
  });

  it('pre-fills an edited feat', async () => {
    configure();
    const feat = {
      type: 'feat',
      id: 'homebrew-aaaaaaaa:feat/lucky-shell',
      name: 'Lucky Shell',
      description: 'Once per day, reroll.',
      tags: [],
      prerequisites: [],
      effects: [
        { type: 'feature.text', name: 'Lucky Shell', description: 'Once per day, reroll.' },
      ],
      grants: [],
      choices: [],
      category: 'general',
      repeatable: true,
    } as Entity;
    const { fixture, root, emitted } = await renderForm(FeatFormComponent, feat);
    expect(el<HTMLTextAreaElement>(root, '.hb-form__description').value).toBe(
      'Once per day, reroll.',
    );
    expect(el(root, '.hb-form__repeatable').checked).toBe(true);
    await save(fixture, root);
    expect(emitted[0]).toEqual(feat);
  });
});

describe('SpeciesFormComponent', () => {
  it('produces a species with trait feature.text effects the pack accepts', async () => {
    const { installContent } = configure();
    const { fixture, root, emitted } = await renderForm(SpeciesFormComponent);

    await type(fixture, root, '.hb-form__name', 'Tidekin');
    await type(fixture, root, '.hb-form__speed input', '30');
    await tick(fixture, root, '.hb-form__add-trait');
    await type(fixture, root, '.hb-form__trait-name', 'Brine Breath');
    await type(fixture, root, '.hb-form__trait-text', 'You can breathe water.');
    await save(fixture, root);

    const species = emitted[0];
    expect(species).toMatchObject({
      id: 'homebrew-aaaaaaaa:species/tidekin',
      type: 'species',
      speed: 30,
      effects: [
        { type: 'feature.text', name: 'Brine Breath', description: 'You can breathe water.' },
      ],
    });
    await expectSavable(species, installContent);
  });

  it('requires a speed and complete traits', async () => {
    configure();
    const { fixture, root, emitted } = await renderForm(SpeciesFormComponent);
    await type(fixture, root, '.hb-form__name', 'Halfway');
    await tick(fixture, root, '.hb-form__add-trait');
    await save(fixture, root);
    expect(emitted).toEqual([]);
    expect(alerts(root)).toEqual([hb.field.required, hb.field.species['trait-incomplete']]);
  });

  it('pre-fills an edited species with its traits', async () => {
    configure();
    const species = {
      type: 'species',
      id: 'homebrew-aaaaaaaa:species/moss-folk',
      name: 'Moss Folk',
      tags: [],
      prerequisites: [],
      effects: [{ type: 'feature.text', name: 'Green Rest', description: 'You rest in sunlight.' }],
      grants: [],
      choices: [],
      size: 'small',
      speed: 25,
      creatureType: 'humanoid',
    } as Entity;
    const { fixture, root, emitted } = await renderForm(SpeciesFormComponent, species);
    expect(el(root, '.hb-form__trait-name').value).toBe('Green Rest');
    expect(el(root, '.hb-form__speed input').value).toBe('25');
    await save(fixture, root);
    expect(emitted[0]).toEqual(species);
  });
});

describe('HomebrewEditorComponent', () => {
  function setupEditor(params: Record<string, string>, saveImpl: () => Promise<unknown>) {
    const paramMap = convertToParamMap(params);
    const saveSpy = vi.fn(saveImpl);
    const { show } = configure([
      { provide: ActivatedRoute, useValue: { paramMap: of(paramMap), snapshot: { paramMap } } },
      {
        provide: HomebrewService,
        useValue: {
          pack: signal<Pack | null>(null),
          packId: signal(LOCAL),
          save: saveSpy,
          newEntityId: (name: string, t: string) => `${LOCAL}:${t}/${name.toLowerCase()}`,
        },
      },
    ]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return { show, navigate, saveSpy };
  }

  async function renderEditor() {
    const fixture = TestBed.createComponent(HomebrewEditorComponent);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    await type(fixture, root, '.hb-form__name', 'Thing');
    await save(fixture, root);
    return { fixture, root };
  }

  it('shows validator diagnostics through the diagnostic key mapping and keeps the form', async () => {
    const { navigate, show } = setupEditor({ type: 'feat' }, () =>
      Promise.reject(
        new HomebrewValidationError(
          ['entities.0.name: Too long'],
          [engineError('ref.missing', 'x'), engineError('some.unknown', 'y')],
        ),
      ),
    );
    const fixture = TestBed.createComponent(HomebrewEditorComponent);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    await type(fixture, root, '.hb-form__name', 'Thing');
    await type(fixture, root, '.hb-form__description', 'Benefit.');
    await save(fixture, root);

    const failure = el<HTMLElement>(root, '.hb-editor__failure');
    expect(failure.getAttribute('role')).toBe('alert');
    expect(failure.querySelector('.hb-editor__issues')?.textContent).toContain('entities.0.name');
    const items = [...failure.querySelectorAll('.hb-editor__diagnostics li')].map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(items).toEqual([
      `${hb.validation.ref.missing} ref.missing`,
      `${hb.validation.generic} some.unknown`,
    ]);
    expect(show).toHaveBeenCalledWith('packs.homebrew.save-failed');
    expect(navigate).not.toHaveBeenCalled();
    expect(root.querySelector('app-homebrew-feat-form')).not.toBeNull();
  });

  it('saves, toasts the updated and pending counts, and returns to the list', async () => {
    const { navigate, show, saveSpy } = setupEditor({ type: 'item' }, () =>
      Promise.resolve({
        pack: corePack,
        diagnostics: [],
        fastForwarded: ['a'],
        pending: ['b', 'c'],
      }),
    );
    await renderEditor();

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith('packs.homebrew.saved', { updated: 1 });
    expect(show).toHaveBeenCalledWith('packs.homebrew.pending', { count: 2 });
    expect(navigate).toHaveBeenCalledWith(['/packs/homebrew']);
  });

  it('shows not-found for an unknown type or a missing entity', async () => {
    setupEditor({ type: 'item', slug: 'nope' }, () => Promise.resolve({}));
    const fixture = TestBed.createComponent(HomebrewEditorComponent);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.hb-editor__not-found')?.textContent?.trim()).toBe(hb['not-found']);
    expect(root.querySelector('form')).toBeNull();
  });
});
