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
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { HomebrewIdService } from '@shared/services/packs/homebrew-id';
import { HomebrewService, HomebrewValidationError } from '@shared/services/packs/homebrew.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { PackStore } from '@shared/stores/pack.store';
import { ImagePipelineService } from '@shared/services/images/image-pipeline.service';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import packsEn from '../../../../assets/i18n/packs/en.json';
import { PACKS_ROUTES } from '../packs.routes';
import { HomebrewLeaveConfirmComponent } from './homebrew-leave-confirm.component';
import { homebrewLeaveGuard } from './homebrew-leave.guard';
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

/** The native control behind a field component's host (`hk-text-field`, `hk-textarea`, …). */
function control(root: HTMLElement, selector: string): HTMLInputElement | HTMLTextAreaElement {
  const host = el<HTMLElement>(root, selector);
  return host.matches('input, textarea')
    ? (host as HTMLInputElement)
    : el<HTMLInputElement | HTMLTextAreaElement>(host, 'input, textarea');
}

async function type(
  fixture: ComponentFixture<unknown>,
  root: HTMLElement,
  selector: string,
  value: string,
) {
  const input = control(root, selector);
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
  const host = el<HTMLElement>(root, selector);
  const select = host.matches('select') ? host : el<HTMLSelectElement>(host, 'select');
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await settle(fixture);
}

/** Presses a toggle or button: the control inside a field host, or the element itself. */
async function tick(fixture: ComponentFixture<unknown>, root: HTMLElement, selector: string) {
  const host = el<HTMLElement>(root, selector);
  (host.matches('button, input') ? host : el<HTMLElement>(host, 'button')).click();
  await settle(fixture);
}

const chipOf = (root: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button[hk-filter-chip]')].find(
    (button) => button.textContent?.trim().startsWith(label),
  );
  if (!found) throw new Error(`no chip ${label}`);
  return found;
};

async function pressChip(fixture: ComponentFixture<unknown>, root: HTMLElement, label: string) {
  chipOf(root, label).click();
  await settle(fixture);
}

const switchOn = (root: HTMLElement, selector: string): boolean =>
  el<HTMLElement>(root, `${selector} button`).getAttribute('aria-checked') === 'true';

/** Save is the strap's: a form alone submits through its handle, the editor through the strap. */
async function save(fixture: ComponentFixture<unknown>, _root?: HTMLElement) {
  const form = fixture.componentInstance as { requestSubmit?: () => void };
  if (form.requestSubmit) form.requestSubmit();
  else
    TestBed.inject(ActionStrapService)
      .config()!
      .primary.find((a) => a.id === 'save-entry')!
      .run();
  await settle(fixture);
}

const alerts = (root: HTMLElement) =>
  [...root.querySelectorAll('.hk-field__msg--error, .hb-form__error')].map((p) =>
    p.textContent?.trim(),
  );

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
    await pressChip(fixture, root, 'light');
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
    expect(control(root, '.hb-form__name').getAttribute('aria-invalid')).toBe('true');

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

    expect(control(root, '.hb-form__name').value).toBe('Shell Mail');
    expect(el<HTMLSelectElement>(root, '.hb-form__category select').value).toBe('armor');
    expect(el(root, '.hb-form__ac input').value).toBe('14');
    expect(switchOn(root, '.hb-form__stealth')).toBe(true);

    await save(fixture, root);
    expect(emitted[0]).toEqual(armor);
    await expectSavable(emitted[0], installContent);
  });
});

describe('ItemFormComponent icon (plan 18 Task 4)', () => {
  it('an uploaded icon becomes the sha256 entity icon and is stored with the pack assets', async () => {
    const hash = `sha256:${'b'.repeat(64)}`;
    const bytes = new Uint8Array([1, 2, 3]);
    const { installContent } = configure([
      {
        provide: ImagePipelineService,
        useValue: { encodeIcon: vi.fn().mockResolvedValue({ hash, mime: 'image/png', w: 128, h: 128 }) },
      },
      {
        provide: BlobsRepository,
        useValue: {
          get: vi.fn().mockResolvedValue({ hash, mime: 'image/png', bytes, size: 3, kind: 'icon' }),
          onArrival: () => () => undefined,
        },
      },
    ]);
    const { fixture, root, emitted } = await renderForm(ItemFormComponent);
    await type(fixture, root, '.hb-form__name', 'Rune Stone');
    el<HTMLButtonElement>(root, '.hb-form__icon-toggle').click();
    await settle(fixture);
    const input = el<HTMLInputElement>(root, 'hk-icon-picker input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new File([bytes], 'r.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    await save(fixture, root);

    expect(emitted[0]).toMatchObject({ name: 'Rune Stone', icon: hash });
    const result = await TestBed.inject(HomebrewService).save(emitted[0]);
    expect(result.pack.assets).toEqual([{ hash, kind: 'icon', mime: 'image/png', size: 3 }]);
    expect(installContent).toHaveBeenCalledWith(
      result.pack,
      new Map([[hash, { bytes, kind: 'icon', mime: 'image/png' }]]),
    );
  });

  it('a picked game icon is stored as a gi: icon with no asset', async () => {
    configure();
    const { fixture, root, emitted } = await renderForm(ItemFormComponent);
    await type(fixture, root, '.hb-form__name', 'Rune Stone');
    el<HTMLButtonElement>(root, '.hb-form__icon-toggle').click();
    await settle(fixture);
    el<HTMLButtonElement>(root, '.hk-icon-picker__glyph[aria-label="shield"]').click();
    await settle(fixture);
    await save(fixture, root);
    expect(emitted[0]).toMatchObject({ icon: 'gi:shield' });
  });
});

describe('ItemFormComponent cost, charges and preview (plan 17 B12b fix round)', () => {
  it('writes cost and charges the pack accepts, with a user-typed regain and no default', async () => {
    const { installContent } = configure();
    const { fixture, root, emitted } = await renderForm(ItemFormComponent);

    await type(fixture, root, '.hb-form__name', 'Lantern');
    await type(fixture, root, '.hb-form__cost input', '25');
    await choose(fixture, root, '.hb-form__currency', 'gp');
    await type(fixture, root, '.hb-form__charges', '3');
    await choose(fixture, root, '.hb-form__charges-reset', 'dawn');
    // Nothing typed: every charge returns, so no `regain` key is written.
    await save(fixture, root);
    expect(emitted[0]).toMatchObject({
      cost: { amount: 25, currency: 'gp' },
      charges: { max: '3', reset: 'dawn' },
    });
    expect((emitted[0] as { charges: Record<string, unknown> }).charges).not.toHaveProperty(
      'regain',
    );
    await expectSavable(emitted[0], installContent);

    await type(fixture, root, '.hb-form__charges-regain', '1d4+1');
    await save(fixture, root);
    expect(emitted[1]).toMatchObject({ charges: { max: '3', reset: 'dawn', regain: '1d4+1' } });
    await expectSavable(emitted[1], installContent);
  });

  it('refuses a regain that is not dice, and a charges formula outside the grammar', async () => {
    configure();
    const { fixture, root, emitted } = await renderForm(ItemFormComponent);
    await type(fixture, root, '.hb-form__name', 'Lantern');
    await type(fixture, root, '.hb-form__charges', '3');
    await type(fixture, root, '.hb-form__charges-regain', 'banana');
    await save(fixture, root);
    expect(emitted).toEqual([]);
    expect(alerts(root)).toEqual([hb.field.item['charges-invalid']]);

    await type(fixture, root, '.hb-form__charges-regain', '');
    await type(fixture, root, '.hb-form__charges', 'x;y');
    await save(fixture, root);
    expect(alerts(root)).toEqual([hb.field.item['charges-invalid']]);
  });

  it('refuses a negative or fractional cost', async () => {
    configure();
    const { fixture, root, emitted } = await renderForm(ItemFormComponent);
    await type(fixture, root, '.hb-form__name', 'Lantern');
    await type(fixture, root, '.hb-form__cost input', '2.5');
    await save(fixture, root);
    expect(emitted).toEqual([]);
    expect(alerts(root)).toEqual([hb.field.item['whole-number']]);
  });

  it('pre-fills an edited item with its cost and charges and keeps them on save', async () => {
    configure();
    const item = {
      type: 'item',
      id: 'homebrew-aaaaaaaa:item/rod',
      name: 'Rod',
      tags: [],
      prerequisites: [],
      effects: [],
      grants: [],
      choices: [],
      category: 'magic',
      cost: { amount: 50, currency: 'gp' },
      charges: { max: '5', reset: 'longRest', regain: '1d6' },
    } as Entity;
    const { fixture, root, emitted } = await renderForm(ItemFormComponent, item);
    expect(el(root, '.hb-form__cost input').value).toBe('50');
    expect(control(root, '.hb-form__charges').value).toBe('5');
    expect(control(root, '.hb-form__charges-regain').value).toBe('1d6');
    await save(fixture, root);
    expect(emitted[0]).toEqual(item);
  });

  it('the preview reads the item as it is typed: damage, range, weight, rarity, attunement', async () => {
    configure();
    const { fixture, root } = await renderForm(ItemFormComponent);
    const preview = () => el<HTMLElement>(root, '.hb-form__preview').textContent ?? '';
    expect(preview()).toContain(hb.preview.unnamed);

    await type(fixture, root, '.hb-form__name', 'Firepot');
    await choose(fixture, root, '.hb-form__category', 'weapon');
    await type(fixture, root, '.hb-form__damage', '1d6');
    await type(fixture, root, '.hb-form__range-normal input', '30');
    await type(fixture, root, '.hb-form__range-long input', '120');
    await type(fixture, root, '.hb-form__weight input', '2');
    await choose(fixture, root, '.hb-form__rarity', 'uncommon');
    await tick(fixture, root, '.hb-form__attunement');

    const text = preview();
    expect(text).toContain('Firepot');
    expect(text).toContain('1d6');
    expect(text).toContain('range 30/120');
    expect(text).toContain('2 lb');
    expect(text).toContain(hb.enum.rarity.uncommon);
    expect(el(root, '.hb-form__preview [role="img"]').getAttribute('aria-label')).toBe(
      hb.sub.attunement,
    );
  });
});

describe('SpellFormComponent', () => {
  it('produces a spell the homebrew pack accepts', async () => {
    const { installContent } = configure();
    const { fixture, root, emitted } = await renderForm(SpellFormComponent);

    await type(fixture, root, '.hb-form__name', 'Огненный шар');
    await pressChip(fixture, root, 'Wizard');
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
    expect(control(root, '.hb-form__material-text').value).toBe('a pearl');
    expect(chipOf(root, 'Bard').getAttribute('aria-pressed')).toBe('true');

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
    expect(control(root, '.hb-form__description').value).toBe('Once per day, reroll.');
    expect(switchOn(root, '.hb-form__repeatable')).toBe(true);
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
    expect(control(root, '.hb-form__trait-name').value).toBe('Green Rest');
    expect(el(root, '.hb-form__speed input').value).toBe('25');
    await save(fixture, root);
    expect(emitted[0]).toEqual(species);
  });
});

describe('HomebrewEditorComponent', () => {
  function setupEditor(
    params: Record<string, string>,
    saveImpl: () => Promise<unknown>,
    options: { leave?: unknown; existing?: Entity[] } = {},
  ) {
    const open = vi.fn((..._args: unknown[]) => ({
      closed: Promise.resolve(options.leave),
      close: vi.fn(),
    }));
    const paramMap = convertToParamMap(params);
    const saveSpy = vi.fn(saveImpl);
    const { show } = configure([
      { provide: ActivatedRoute, useValue: { paramMap: of(paramMap), snapshot: { paramMap } } },
      {
        provide: HomebrewService,
        useValue: {
          pack: signal<Pack | null>(
            options.existing ? ({ id: LOCAL, entities: options.existing } as Pack) : null,
          ),
          packId: signal(LOCAL),
          save: saveSpy,
          newEntityId: (name: string, t: string) => `${LOCAL}:${t}/${name.toLowerCase()}`,
        },
      },
      { provide: DialogService, useValue: { open } },
    ]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return { show, navigate, saveSpy, open };
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
    expect(show).not.toHaveBeenCalledWith('packs.homebrew.update-check-failed');
    expect(navigate).toHaveBeenCalledWith(['/packs/homebrew']);
  });

  it('a save whose update check failed still saves, and adds the update-check note', async () => {
    const { navigate, show } = setupEditor({ type: 'item' }, () =>
      Promise.resolve({
        pack: corePack,
        diagnostics: [],
        fastForwarded: [],
        pending: [],
        updateCheckFailed: true,
      }),
    );
    await renderEditor();

    expect(show).toHaveBeenCalledWith('packs.homebrew.saved', { updated: 0 });
    expect(show).toHaveBeenCalledWith('packs.homebrew.update-check-failed');
    expect(navigate).toHaveBeenCalledWith(['/packs/homebrew']);
  });

  describe('dirty form (plan 17 B12b)', () => {
    async function editorWithName(options: { leave?: unknown } = {}) {
      const ctx = setupEditor({ type: 'feat' }, () => Promise.reject(new Error('disk')), options);
      const fixture = TestBed.createComponent(HomebrewEditorComponent);
      await settle(fixture);
      return { ...ctx, fixture, root: fixture.nativeElement as HTMLElement };
    }

    it('a clean form leaves without asking', async () => {
      const { fixture, open } = await editorWithName();
      expect(await fixture.componentInstance.canLeave()).toBe(true);
      expect(open).not.toHaveBeenCalled();
    });

    it('unsaved edits ask once: Discard leaves, Keep editing and Escape stay', async () => {
      const keep = await editorWithName({ leave: false });
      await type(keep.fixture, keep.root, '.hb-form__name', 'Thing');
      expect(await keep.fixture.componentInstance.canLeave()).toBe(false);
      expect(keep.open).toHaveBeenCalledTimes(1);
      expect(keep.open).toHaveBeenCalledWith(HomebrewLeaveConfirmComponent);
      TestBed.resetTestingModule();

      const escape = await editorWithName({ leave: undefined });
      await type(escape.fixture, escape.root, '.hb-form__name', 'Thing');
      expect(await escape.fixture.componentInstance.canLeave()).toBe(false);
      TestBed.resetTestingModule();

      const discard = await editorWithName({ leave: true });
      await type(discard.fixture, discard.root, '.hb-form__name', 'Thing');
      expect(await discard.fixture.componentInstance.canLeave()).toBe(true);
    });

    it('typing the original value back makes the form clean again', async () => {
      const { fixture, root, open } = await editorWithName({ leave: false });
      await type(fixture, root, '.hb-form__name', 'Thing');
      await type(fixture, root, '.hb-form__name', '');
      expect(await fixture.componentInstance.canLeave()).toBe(true);
      expect(open).not.toHaveBeenCalled();
    });

    it('a double Cancel while the confirm is open stacks no second prompt', async () => {
      let release!: (leave: boolean) => void;
      const pending = new Promise<boolean>((resolve) => (release = resolve));
      const { fixture, root, open } = await editorWithName({ leave: pending });
      await type(fixture, root, '.hb-form__name', 'Thing');
      const first = fixture.componentInstance.canLeave();
      const second = fixture.componentInstance.canLeave();
      expect(open).toHaveBeenCalledTimes(1);
      release(true);
      expect(await first).toBe(true);
      expect(await second).toBe(true);
    });

    it('a failed save keeps the edits and still asks before leaving', async () => {
      const { fixture, root, show, open } = await editorWithName({ leave: false });
      await type(fixture, root, '.hb-form__name', 'Thing');
      await type(fixture, root, '.hb-form__description', 'Benefit.');
      await save(fixture, root);
      expect(show).toHaveBeenCalledWith('packs.homebrew.save-failed-unknown');
      expect(control(root, '.hb-form__name').value).toBe('Thing');
      expect(await fixture.componentInstance.canLeave()).toBe(false);
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('a successful save leaves without asking', async () => {
      const { open, navigate } = setupEditor({ type: 'feat' }, () =>
        Promise.resolve({ pack: corePack, diagnostics: [], fastForwarded: [], pending: [] }),
      );
      const fixture = TestBed.createComponent(HomebrewEditorComponent);
      await settle(fixture);
      const root = fixture.nativeElement as HTMLElement;
      await type(fixture, root, '.hb-form__name', 'Thing');
      await type(fixture, root, '.hb-form__description', 'Benefit.');
      await save(fixture);
      expect(navigate).toHaveBeenCalledWith(['/packs/homebrew']);
      expect(await fixture.componentInstance.canLeave()).toBe(true);
      expect(open).not.toHaveBeenCalled();
    });

    it('the strap Cancel goes back to the list (through the guard) and the guard asks the editor', async () => {
      const { fixture, navigate } = await editorWithName();
      TestBed.inject(ActionStrapService)
        .config()!
        .exit!.find((a) => a.id === 'cancel')!
        .run();
      await settle(fixture);
      expect(navigate).toHaveBeenCalledWith(['/packs/homebrew']);
      const canLeave = vi.fn().mockResolvedValue(false);
      expect(
        await TestBed.runInInjectionContext(() =>
          homebrewLeaveGuard({ canLeave } as never, {} as never, {} as never, {} as never),
        ),
      ).toBe(false);
      const guarded = PACKS_ROUTES.filter((r) => r.canDeactivate).map((r) => r.path);
      expect(guarded).toEqual(['homebrew/new/:type', 'homebrew/edit/:type/:slug']);
    });

    it('the strap carries Cancel, a type-labelled Save and Markdown help', async () => {
      const { fixture } = await editorWithName();
      const config = TestBed.inject(ActionStrapService).config()!;
      expect(config.exit?.map((a) => a.id)).toEqual(['cancel']);
      expect(config.primary.map((a) => [a.id, a.label])).toEqual([
        ['save-entry', 'shell.strap.homebrew-save-feat'],
      ]);
      expect(config.secondary?.map((a) => a.id)).toEqual(['markdown-help']);
      void fixture;
    });
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

describe('homebrew name check against the REAL HomebrewService (plan 17 B12b fix round)', () => {
  const existingFeat = {
    type: 'feat',
    id: `${LOCAL}:feat/thing`,
    name: 'Thing',
    description: 'Old.',
    tags: [],
    prerequisites: [],
    effects: [{ type: 'feature.text', name: 'Thing', description: 'Old.' }],
    grants: [],
    choices: [],
    category: 'general',
    repeatable: false,
  } as Entity;

  function withExisting() {
    const pack = {
      format: 1,
      id: LOCAL,
      version: '0.1.0',
      kind: 'content',
      name: 'My homebrew',
      authors: [],
      dependencies: [],
      locale: 'en',
      entities: [existingFeat],
      overrides: [],
      assets: [],
      i18n: {},
    } as unknown as Pack;
    configure([
      {
        provide: PackStore,
        useValue: {
          packs: signal([corePack, pack]),
          corePack: signal(corePack),
          installedContent: signal<Pack[]>([pack]),
          ready: signal(true),
          installContent: vi.fn().mockResolvedValue(undefined),
          removeContent: vi.fn().mockResolvedValue(undefined),
        },
      },
    ]);
  }

  it('the real newEntityId already suffixes a taken name, so only the name can tell them apart', () => {
    withExisting();
    expect(TestBed.inject(HomebrewService).newEntityId('Thing', 'feat')).toBe(
      `${LOCAL}:feat/thing-2`,
    );
  });

  it('refuses a new entry whose trimmed, case-insensitive name is already used by an entry of the same kind', async () => {
    withExisting();
    const { fixture, root, emitted } = await renderForm(FeatFormComponent);
    await type(fixture, root, '.hb-form__name', '  tHING ');
    await type(fixture, root, '.hb-form__description', 'Benefit.');
    await save(fixture, root);
    expect(emitted).toEqual([]);
    expect(alerts(root)).toEqual([hb.field['name-taken']]);
  });

  it('lets an edit keep its own name, and a different kind reuse the name', async () => {
    withExisting();
    const edit = await renderForm(FeatFormComponent, existingFeat);
    await save(edit.fixture, edit.root);
    expect(edit.emitted).toHaveLength(1);
    TestBed.resetTestingModule();

    withExisting();
    const item = await renderForm(ItemFormComponent);
    await type(item.fixture, item.root, '.hb-form__name', 'Thing');
    await save(item.fixture, item.root);
    expect(item.emitted).toHaveLength(1);
  });
});
