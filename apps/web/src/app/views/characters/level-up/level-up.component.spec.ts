import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { routes } from '../../../app.routes';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import { seedFighter } from '../sheet/testing/character-fixtures';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling), same fixture-loading
// approach as `sheet-shell.component.spec.ts`.
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
    if (langPath === 'characters/en') return of(charactersEn);
    return of({});
  }
}

function configureReal(): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
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
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
    ],
  });
}

/** Lets `CharacterStore.appendTx`'s real (unmocked) fake-indexeddb promise chain settle before
 * asserting — mirrors `build-tab.component.spec.ts`'s own `pollUntil`. */
async function pollUntil(
  fixture: { whenStable(): Promise<unknown> },
  predicate: () => boolean,
  maxIterations = 50,
): Promise<void> {
  for (let i = 0; i < maxIterations && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
  expect(predicate()).toBe(true);
}

describe('LevelUpComponent', () => {
  beforeEach(async () => {
    configureReal();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('the guard redirects to the play tab (with a toast) when no level-up is available', async () => {
    const id = await seedFighter('Ivan');

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;

    expect(root.querySelector('.play-tab')).not.toBeNull();
    expect(root.querySelector('.level-up')).toBeNull();
  });

  it('fighter 1→2: taking the average HP through to Finish commits level.gained and returns to the play tab', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    expect(characterStore.advancements()).toHaveLength(1);

    const harness = await RouterTestingHarness.create(`/c/${id}/level-up`);
    const root = harness.routeNativeElement!;
    expect(root.querySelector('.level-up')).not.toBeNull();

    const averageButton = root.querySelector<HTMLButtonElement>('.level-up__hp-average')!;
    expect(averageButton).not.toBeNull();
    averageButton.click();
    await harness.fixture.whenStable();

    // Fighter's level-2 row has no choices (packages/content dist pack) — the very next step is
    // 'review'.
    const nextButton = root.querySelector<HTMLButtonElement>('.level-up__next')!;
    expect(nextButton.disabled).toBe(false);
    nextButton.click();
    await harness.fixture.whenStable();

    const finishButton = root.querySelector<HTMLButtonElement>('.level-up__finish')!;
    expect(finishButton.disabled).toBe(false);
    finishButton.click();

    await pollUntil(harness.fixture, () => characterStore.sheet()?.level === 2);

    expect(characterStore.events().at(-1)?.type).toBe('level.gained');
    expect(characterStore.sheet()?.hp.max.value).toBe(20); // 12 + 6 (average d10) + 2 (con mod)
  });
});
