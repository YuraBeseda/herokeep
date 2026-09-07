import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { PackStore } from '@shared/stores/pack.store';

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
