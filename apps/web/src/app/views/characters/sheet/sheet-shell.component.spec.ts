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
    ]);
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
});
