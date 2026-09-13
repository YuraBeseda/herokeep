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
import { ToastService } from '@shared/components/toast/toast.service';
import {
  ImageInvalidTypeError,
  ImagePipelineService,
  ImageTooLargeError,
  type PortraitPipelineResult,
} from '@shared/services/images/image-pipeline.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { seedFighter } from '../testing/character-fixtures';
import { BuildTabComponent } from './build-tab.component';

const THUMB_HASH = `sha256:${'a'.repeat(64)}`;
const FULL_HASH = `sha256:${'b'.repeat(64)}`;

const STUBBED_PIPELINE_RESULT: PortraitPipelineResult = {
  hash: FULL_HASH,
  thumbHash: THUMB_HASH,
  tokenHash: `sha256:${'c'.repeat(64)}`,
  mime: 'image/webp',
  w: 1024,
  h: 1024,
};

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

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

/** `ImagePipelineService` is a real class whose `processPortrait` is a METHOD (not an
 * arrow-typed property) — capturing the STUBBED mock function here, once, and using this
 * variable everywhere (instead of reading `TestBed.inject(ImagePipelineService).processPortrait`
 * at each assertion site) avoids `@typescript-eslint/unbound-method` false positives while still
 * asserting against the exact same mock the component actually calls. Mirrors
 * `characters-list.component.spec.ts`'s own `configure()` → `{ deleteCharacter }` pattern. */
function configureReal(): {
  processPortrait: ReturnType<typeof vi.fn<ImagePipelineService['processPortrait']>>;
} {
  const processPortrait = vi
    .fn<ImagePipelineService['processPortrait']>()
    .mockResolvedValue(STUBBED_PIPELINE_RESULT);
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
      {
        provide: ImagePipelineService,
        // Stubbed pipeline (task-8-brief.md: "build-tab upload flow with stubbed pipeline" —
        // jsdom has no Canvas/createImageBitmap, so the REAL `ImagePipelineService` can never run
        // here; its own seamed unit specs cover the ladder/mime/hash logic directly).
        useValue: { processPortrait },
      },
    ],
  });
  return { processPortrait };
}

describe('BuildTabComponent', () => {
  let processPortrait: ReturnType<typeof vi.fn<ImagePipelineService['processPortrait']>>;

  beforeEach(async () => {
    ({ processPortrait } = configureReal());
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
    ]);
    // jsdom does not reliably implement Blob-URL support — stub it (same as
    // `sheet-shell.component.spec.ts`/`blob-url.pipe.spec.ts`) rather than depend on jsdom's own.
    URL.createObjectURL = vi.fn(() => 'blob:fake-portrait-url');
    URL.revokeObjectURL = vi.fn();
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

  // --- Portrait upload/remove (plan-6 Task 8) -----------------------------------------------

  it('selecting a file runs it through ImagePipelineService and appends portrait.set with the EXACT PortraitSetV1 shape (no tokenHash)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(BuildTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const input = compiled.querySelector<HTMLInputElement>('.build-tab__portrait-input')!;
    const file = new File([new Uint8Array([1, 2, 3])], 'me.png', { type: 'image/png' });
    setInputFiles(input, [file]);

    await pollUntil(fixture, () => characterStore.facts()?.portrait?.hash === FULL_HASH);

    expect(processPortrait).toHaveBeenCalledWith(file);
    const lastEvent = characterStore.events().at(-1)!;
    expect(lastEvent.type).toBe('portrait.set');
    // Exact payload shape — @hk/protocol's PortraitSetV1 is `{hash, thumbHash, mime, w, h}`, no
    // `tokenHash` field at all (design ruling 4: the token blob is generated/stored but never
    // appears on the event stream).
    expect(lastEvent.payload).toEqual({
      hash: FULL_HASH,
      thumbHash: THUMB_HASH,
      mime: 'image/webp',
      w: 1024,
      h: 1024,
    });
    expect(Object.keys(lastEvent.payload as object)).not.toContain('tokenHash');
  });

  it('re-selecting after a successful upload is possible (the file input is reset)', async () => {
    await seedFighter('Ivan');
    const fixture = TestBed.createComponent(BuildTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('.build-tab__portrait-input')!;

    setInputFiles(input, [new File([new Uint8Array([1])], 'me.png', { type: 'image/png' })]);
    await pollUntil(fixture, () => TestBed.inject(CharacterStore).facts()?.portrait !== undefined);

    expect(input.value).toBe('');
  });

  it('shows a Remove button once a portrait is set; clicking it appends portrait.cleared', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    expect(characterStore.streamId()).toBe(id);

    const fixture = TestBed.createComponent(BuildTabComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.build-tab__portrait-remove')).toBeNull();

    await characterStore.appendTx([
      {
        type: 'portrait.set',
        v: 1,
        payload: { hash: FULL_HASH, thumbHash: THUMB_HASH, mime: 'image/webp', w: 1024, h: 1024 },
      },
    ]);
    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;
    const removeButton = compiled.querySelector<HTMLButtonElement>('.build-tab__portrait-remove')!;
    expect(removeButton).not.toBeNull();

    removeButton.click();
    await pollUntil(fixture, () => characterStore.facts()?.portrait === undefined);

    const lastEvent = characterStore.events().at(-1)!;
    expect(lastEvent.type).toBe('portrait.cleared');
    expect(lastEvent.payload).toEqual({});
  });

  it('a too-large rejection from the pipeline shows the mapped toast and appends NO event', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    processPortrait.mockRejectedValueOnce(new ImageTooLargeError());
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    const eventCountBefore = characterStore.events().length;

    const fixture = TestBed.createComponent(BuildTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('.build-tab__portrait-input')!;
    setInputFiles(input, [new File([new Uint8Array([1])], 'huge.png', { type: 'image/png' })]);

    await pollUntil(fixture, () => showSpy.mock.calls.length > 0);

    expect(showSpy).toHaveBeenCalledWith('characters.sheet.portrait.error.tooLarge');
    expect(characterStore.events().length).toBe(eventCountBefore);
  });

  it('an invalid-type rejection from the pipeline shows its own mapped toast (not the too-large one)', async () => {
    await seedFighter('Ivan');
    processPortrait.mockRejectedValueOnce(new ImageInvalidTypeError('image/svg+xml'));
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');

    const fixture = TestBed.createComponent(BuildTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('.build-tab__portrait-input')!;
    setInputFiles(input, [new File([new Uint8Array([1])], 'evil.svg', { type: 'image/svg+xml' })]);

    await pollUntil(fixture, () => showSpy.mock.calls.length > 0);

    expect(showSpy).toHaveBeenCalledWith('characters.sheet.portrait.error.invalidType');
  });
});
