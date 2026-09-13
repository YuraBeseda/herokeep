import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { seedFighter } from '../testing/character-fixtures';
import { BuildTabComponent } from './build-tab.component';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling), same fixture-loading
// approach as `play-tab.component.spec.ts`.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..', '..');

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

const FIGHTING_STYLE_CHOICE = 'srd-5e-2024:class/fighter@1/fighting-style';

/** Lets a chain of real (unmocked) fake-indexeddb operations — every form/choice here fires
 * `CharacterStore.appendTx` fire-and-forget from a DOM event handler, per `build-tab.component.ts`'s
 * own class doc — actually settle before asserting. Not tracked by Angular's zoneless stability
 * system (same reasoning as `characters-list.component.spec.ts`'s own `flushDeleteFlow` and
 * `create-wizard.component.spec.ts`'s `onCreate` poll, which this mirrors exactly): poll real
 * macrotask turns until `predicate()` is true (or give up loudly after `maxIterations`), each
 * followed by `whenStable()` to flush the resulting signal writes into a render. */
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

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    return of({});
  }
}

function configureReal(): void {
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

describe('BuildTabComponent', () => {
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

  it('lists a seeded stream missing its fighting-style decision; committing it appends decision.made and the list empties', async () => {
    await seedFighter('Ivan', { fightingStyle: false });
    const characterStore = TestBed.inject(CharacterStore);
    expect(characterStore.outstanding().map((r) => r.choiceId)).toContain(FIGHTING_STYLE_CHOICE);

    const fixture = TestBed.createComponent(BuildTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('hk-choice-step')).not.toBeNull();
    expect(compiled.querySelector('.build-tab__empty')).toBeNull();

    const selectButton = compiled.querySelector<HTMLButtonElement>('.entity-picker__select');
    expect(selectButton).not.toBeNull();
    selectButton!.click();
    await pollUntil(
      fixture,
      () => !characterStore.outstanding().some((r) => r.choiceId === FIGHTING_STYLE_CHOICE),
    );

    const lastEvent = characterStore.events().at(-1)!;
    expect(lastEvent.type).toBe('decision.made');

    expect(compiled.querySelector('hk-choice-step')).toBeNull();
    expect(compiled.querySelector('.build-tab__empty')).not.toBeNull();
  });

  it('the rename form round-trips a new name into the sheet', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(BuildTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const input = compiled.querySelector<HTMLInputElement>('.build-tab__rename-input')!;
    expect(input.value).toBe('Ivan');
    input.value = 'Ivanka';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const form = compiled.querySelector<HTMLFormElement>('.build-tab__rename-form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await pollUntil(fixture, () => characterStore.sheet()?.name === 'Ivanka');

    expect(input.value).toBe('Ivanka');
    const lastEvent = characterStore.events().at(-1)!;
    expect(lastEvent.type).toBe('character.renamed');
  });

  it('the appearance form only includes dirty fields in its committed payload', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    // Seed an existing 'height' value BEFORE the tab ever mounts, so the form must render it
    // without the user having touched it.
    await characterStore.appendTx([
      { type: 'character.appearance_set', v: 1, payload: { height: '6\'0"' } },
    ]);
    expect(characterStore.streamId()).toBe(id);

    const fixture = TestBed.createComponent(BuildTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const heightInput = compiled.querySelector<HTMLInputElement>('[data-field="height"]')!;
    expect(heightInput.value).toBe('6\'0"');

    const ageInput = compiled.querySelector<HTMLInputElement>('[data-field="age"]')!;
    ageInput.value = '27';
    ageInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const form = compiled.querySelector<HTMLFormElement>('.build-tab__appearance-form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await pollUntil(fixture, () => characterStore.facts()?.appearance['age'] === '27');

    const lastEvent = characterStore.events().at(-1)!;
    expect(lastEvent.type).toBe('character.appearance_set');
    expect(lastEvent.payload).toEqual({ age: '27' });
    expect(characterStore.facts()?.appearance).toEqual({ height: '6\'0"', age: '27' });
  });
});
