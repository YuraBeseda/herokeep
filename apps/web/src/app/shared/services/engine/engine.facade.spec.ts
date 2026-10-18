import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { EngineFacade, EngineScope } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { PackStore } from '@shared/stores/pack.store';
import sampleJson from '../../../../testing/fixtures/packs/sample-content.json';

// The `pretest` script (apps/web/package.json) runs `pnpm --filter @hk/content build:pack`
// first, so the real built pack is always on disk before this file runs.
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

function samplePack(): Pack {
  const parsed = parsePack(sampleJson);
  if (!parsed.ok) throw new Error('sample-content.json fixture no longer parses');
  return parsed.pack;
}

const sample = samplePack();
const MOONKIN = 'sample-content:species/moonkin';
const CORE_PINS = { [corePack.id]: corePack.version };

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({});
  }
}

/** Seeds a stub `PackStore` (a plain writable signal for `packs`) and returns it for mutation. */
function seedStore(packs: Pack[]) {
  const packsState = signal(packs);
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
      { provide: PackStore, useValue: { packs: packsState } },
    ],
  });
  return packsState;
}

describe('EngineFacade', () => {
  beforeEach(() => localStorage.removeItem('hk.locale'));

  it('resolves the English name from the real core pack', () => {
    seedStore([corePack]);
    const facade = TestBed.inject(EngineFacade);
    expect(facade.localizer().name('srd-5e-2024:spell/fireball')).toBe('Fireball');
  });

  it('resolves the RU translation once the demo pack is installed and the locale is ru', () => {
    seedStore([corePack, ruDemoPack]);
    const facade = TestBed.inject(EngineFacade);
    const localeService = TestBed.inject(LocaleService);
    localeService.setLocale('ru');
    TestBed.tick();
    expect(facade.localizer().name('srd-5e-2024:spell/fireball')).toBe('Огненный шар');
  });

  it('search ranks the exact "fireball" spell above partial matches', () => {
    seedStore([corePack]);
    const facade = TestBed.inject(EngineFacade);
    const hits = facade.search().query('fireball');
    expect(hits[0]?.id).toBe('srd-5e-2024:spell/fireball');
  });

  it('iconFor resolves a gi: id for a class entity from the icons map', () => {
    seedStore([corePack]);
    const facade = TestBed.inject(EngineFacade);
    const fighter = facade.index().get('srd-5e-2024:class/fighter');
    expect(fighter).toBeDefined();
    expect(facade.iconFor(fighter!)).toMatch(/^gi:/);
  });

  it('iconFor falls back to the category fallback for an unmapped ability entity', () => {
    seedStore([corePack]);
    const facade = TestBed.inject(EngineFacade);
    const ability = facade.index().byType('ability')[0];
    expect(ability).toBeDefined();
    expect(facade.iconFor(ability)).toBe('gi:perspective-dice-six-faces-random');
  });

  it('iconFor never throws for any entity in the real pack', () => {
    seedStore([corePack]);
    const facade = TestBed.inject(EngineFacade);
    for (const entity of corePack.entities) {
      expect(() => facade.iconFor(entity)).not.toThrow();
      expect(facade.iconFor(entity)).toMatch(/^gi:/);
    }
  });
});

describe('EngineFacade — per-character content index (plan 15 Task 4)', () => {
  beforeEach(() => localStorage.removeItem('hk.locale'));

  it('index() is the core (plus its translations) only: an installed content pack is not in it', () => {
    seedStore([corePack, sample, ruDemoPack]);
    const facade = TestBed.inject(EngineFacade);
    expect(facade.index().has('srd-5e-2024:spell/fireball')).toBe(true);
    expect(facade.index().has(MOONKIN)).toBe(false);
    expect(
      facade
        .index()
        .translationPacks()
        .map((p) => p.id),
    ).toEqual([ruDemoPack.id]);
    expect(facade.index()).toBe(facade.indexFor(CORE_PINS));
  });

  it('indexFor() with a content pin includes that pack, and attaches the core translation', () => {
    seedStore([corePack, sample, ruDemoPack]);
    const facade = TestBed.inject(EngineFacade);
    const index = facade.indexFor({ ...CORE_PINS, [sample.id]: sample.version });
    expect(index.diagnostics).toEqual([]);
    expect(index.has(MOONKIN)).toBe(true);
    expect(index.translationPacks().map((p) => p.id)).toEqual([ruDemoPack.id]);
  });

  it('memoizes by canonical pin key: the same pins in any key order return the same instance', () => {
    seedStore([corePack, sample]);
    const facade = TestBed.inject(EngineFacade);
    const a = facade.indexFor({ ...CORE_PINS, [sample.id]: sample.version });
    const b = facade.indexFor({ [sample.id]: sample.version, ...CORE_PINS });
    expect(b).toBe(a);
    expect(facade.indexFor(CORE_PINS)).not.toBe(a);
  });

  it('a new packs() value invalidates the memo', () => {
    const packsState = seedStore([corePack, sample]);
    const facade = TestBed.inject(EngineFacade);
    const pins = { ...CORE_PINS, [sample.id]: sample.version };
    const before = facade.indexFor(pins);
    packsState.set([corePack, sample, ruDemoPack]);
    const after = facade.indexFor(pins);
    expect(after).not.toBe(before);
    expect(after.translationPacks().map((p) => p.id)).toEqual([ruDemoPack.id]);
  });

  it('a pin to an uninstalled pack resolves the rest and reports the missing pin', () => {
    seedStore([corePack]);
    const facade = TestBed.inject(EngineFacade);
    const index = facade.indexFor({ ...CORE_PINS, [sample.id]: sample.version });
    expect(index.has('srd-5e-2024:spell/fireball')).toBe(true);
    expect(index.has(MOONKIN)).toBe(false);
    expect(index.diagnostics.map((d) => d.code)).toEqual(['deps.missing']);
  });

  it('a core pin at another version resolves against the installed core (the app ships one core)', () => {
    seedStore([corePack]);
    const facade = TestBed.inject(EngineFacade);
    const index = facade.indexFor({ [corePack.id]: '0.0.1' });
    expect(index).toBe(facade.indexFor(CORE_PINS));
    expect(() => index.system()).not.toThrow();
  });

  it('a component-scoped EngineFacade resolves index()/localizer() against its EngineScope pins and shares the root memo', () => {
    seedStore([corePack, sample]);
    const root = TestBed.inject(EngineFacade);
    const pins = signal<Record<string, string> | undefined>({
      ...CORE_PINS,
      [sample.id]: sample.version,
    });
    const scoped = Injector.create({
      providers: [EngineFacade, { provide: EngineScope, useValue: { pins } }],
      parent: TestBed.inject(Injector),
    }).get(EngineFacade);

    expect(scoped).not.toBe(root);
    expect(scoped.index()).toBe(root.indexFor(pins()!));
    expect(scoped.localizer().name(MOONKIN)).toBe('Moonkin');
    expect(root.localizer().name(MOONKIN)).toBe('');

    pins.set(undefined);
    expect(scoped.index()).toBe(root.index());
  });
});
