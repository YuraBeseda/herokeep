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
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { routes } from '../../../app.routes';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import { seedFighter } from './testing/character-fixtures';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling), same fixture-loading
// approach as `create-wizard.component.spec.ts`'s own binding spec.
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

/** Lets `CharacterStore.appendTx`/`revert`'s real (unmocked) fake-indexeddb promise chain settle
 * before asserting — mirrors `build-tab.component.spec.ts`'s own `pollUntil`. */
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

describe('SheetShellComponent (route resolver + shell)', () => {
  beforeEach(async () => {
    configureReal();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
    ]);
    // jsdom (this app's unit-test environment) does not reliably implement Blob-URL support —
    // stub it directly, same as `blob-url.pipe.spec.ts`, rather than depend on jsdom's actual
    // support (or lack of it).
    URL.createObjectURL = vi.fn(() => 'blob:fake-portrait-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it('the characterResolver loads a seeded fighter stream and the shell renders its name and level', async () => {
    const id = await seedFighter('Ivan');

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const root = harness.routeNativeElement!;

    expect(root.querySelector('.sheet-shell__not-found')).toBeNull();
    expect(root.querySelector('.sheet-shell__name')?.textContent?.trim()).toBe('Ivan');
    const classLine = root.querySelector('.sheet-shell__class-line')?.textContent ?? '';
    expect(classLine).toContain('Fighter');
    expect(classLine).toContain('1');
  });

  it('renders an i18n not-found state for a character id with no CharactersRepository row, without crashing', async () => {
    const harness = await RouterTestingHarness.create(
      '/c/char:00000000-0000-7000-8000-000000000000/play',
    );
    const root = harness.routeNativeElement!;

    const notFound = root.querySelector('.sheet-shell__not-found');
    expect(notFound).not.toBeNull();
    expect(notFound?.textContent).toContain(charactersEn.sheet.notFound.title);
  });

  it('/c/:id with no child segment redirects to the play tab', async () => {
    const id = await seedFighter('Ivan');

    const harness = await RouterTestingHarness.create(`/c/${id}`);
    const root = harness.routeNativeElement!;

    expect(root.querySelector('.play-tab')).not.toBeNull();
  });

  it('awarding XP up to the level-2 threshold shows the "level up available" badge', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const root = harness.routeNativeElement!;
    expect(root.querySelector('.sheet-shell__level-up-badge')).toBeNull();

    const input = root.querySelector<HTMLInputElement>(
      '.sheet-shell__xp-field .hk-number-field__input',
    )!;
    input.value = '300';
    input.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();

    const submit = root.querySelector<HTMLButtonElement>('.sheet-shell__xp-submit')!;
    submit.click();

    await pollUntil(harness.fixture, () => characterStore.advancements().length > 0);

    expect(root.querySelector('.sheet-shell__level-up-badge')).not.toBeNull();
    const lastEvent = characterStore.events().at(-1)!;
    expect(lastEvent.type).toBe('xp.awarded');
    expect(lastEvent.payload).toEqual({ amount: 300 });
  });

  it('a negative XP entry is accepted as a delta and clamps facts.xp at 0 (reducer floor)', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    expect(characterStore.facts()?.xp).toBe(300);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const root = harness.routeNativeElement!;
    expect(root.querySelector('.sheet-shell__xp-current')?.textContent).toContain('300');

    const input = root.querySelector<HTMLInputElement>(
      '.sheet-shell__xp-field .hk-number-field__input',
    )!;
    input.value = '-350';
    input.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
    root.querySelector<HTMLButtonElement>('.sheet-shell__xp-submit')!.click();

    await pollUntil(harness.fixture, () => characterStore.facts()?.xp === 0);

    const lastEvent = characterStore.events().at(-1)!;
    expect(lastEvent.type).toBe('xp.awarded');
    // The DELTA sent is the raw negative amount — clamping to 0 is the reducer's own job
    // (`Math.max(0, f.xp + p.amount)`), not something the sheet shell pre-clamps.
    expect(lastEvent.payload).toEqual({ amount: -350 });
    expect(root.querySelector('.sheet-shell__xp-current')?.textContent).toContain('0');
  });

  it('"Undo level-up" is visible while the last tx is level.gained-led, and reverting removes both the button and the level', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    // Fighter's level-2 row has no choices (packages/content dist pack) — a real level-up here is
    // a single-event, txId-less `level.gained` (task-13-brief.md's "Undo level-up" doc covers
    // exactly this case).
    await characterStore.appendTx([
      {
        type: 'level.gained',
        v: 1,
        payload: { classId: 'srd-5e-2024:class/fighter', level: 2, hpRoll: 'average' },
      },
    ]);
    expect(characterStore.sheet()?.level).toBe(2);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const root = harness.routeNativeElement!;
    const undoButton = root.querySelector<HTMLButtonElement>('.sheet-shell__undo-level-up');
    expect(undoButton).not.toBeNull();

    undoButton!.click();
    await pollUntil(harness.fixture, () => characterStore.sheet()?.level === 1);

    expect(root.querySelector('.sheet-shell__undo-level-up')).toBeNull();
  });

  it("shows a monogram placeholder (no portrait) with a deterministic hue and the name's initials", async () => {
    const id = await seedFighter('Ivan Petrov');

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const root = harness.routeNativeElement!;

    expect(root.querySelector('.sheet-shell__portrait--placeholder')).not.toBeNull();
    expect(root.querySelector('img.sheet-shell__portrait')).toBeNull();
    const placeholder = root.querySelector('.sheet-shell__portrait--placeholder')!;
    expect(placeholder.textContent?.trim()).toBe('IP');
    expect(placeholder.getAttribute('style')).toContain('background');
  });

  it('once facts.portrait.thumbHash is set, the header renders an <img> from BlobUrlPipe instead of the monogram', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const blobsRepository = TestBed.inject(BlobsRepository);
    const thumbHash = `sha256:${'a'.repeat(64)}`;
    const fullHash = `sha256:${'b'.repeat(64)}`;
    await blobsRepository.put(thumbHash, 'image/webp', new Uint8Array([1, 2, 3]), {
      kind: 'thumb',
      width: 256,
      height: 256,
    });
    await characterStore.appendTx([
      {
        type: 'portrait.set',
        v: 1,
        payload: { hash: fullHash, thumbHash, mime: 'image/webp', w: 1024, h: 1024 },
      },
    ]);
    expect(characterStore.facts()?.portrait?.thumbHash).toBe(thumbHash);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const root = harness.routeNativeElement!;
    await pollUntil(
      harness.fixture,
      () => root.querySelector('img.sheet-shell__portrait') !== null,
    );

    expect(root.querySelector('.sheet-shell__portrait--placeholder')).toBeNull();
    const img = root.querySelector<HTMLImageElement>('img.sheet-shell__portrait')!;
    expect(img.getAttribute('src')).toBe('blob:fake-portrait-url');
    expect(img.getAttribute('alt')).toContain('Ivan');
  });
});
