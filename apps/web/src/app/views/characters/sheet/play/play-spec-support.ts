/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal, type EnvironmentProviders, type Provider, type Type } from '@angular/core';

type AnyProvider = Provider | EnvironmentProviders;
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { SyncService, type SyncStateValue } from '@shared/services/sync/sync.service';
import { PackStore } from '@shared/stores/pack.store';
import campaignsEn from '../../../../../assets/i18n/campaigns/en.json';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../../assets/i18n/characters/ru.json';
import shellEn from '../../../../../assets/i18n/shell/en.json';
import shellRu from '../../../../../assets/i18n/shell/ru.json';

/**
 * Shared setup of the sheet leaves' specs (they all mount one leaf, or a few, against the real
 * built SRD pack and the real `CharacterStore`/Dexie, then drive the rendered DOM — the same
 * "exercise the real propose -> appendTx wiring" convention the former `PlayTabComponent` spec had).
 */

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling).
// The test runner's working directory is `apps/web`.
const repoRoot = join(process.cwd(), '..', '..');

export function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) {
    throw new Error(
      `fixture pack at ${path} failed validation: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.pack;
}

export const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

// A minimal, hand-built translation pack covering exactly the two feature-granted resource/action
// names the localization specs exercise: `second-wind` (fighter-1) and `action-surge` (fighter-2),
// both granted by a FEATURE entity, so `ResourceView.source`/`ActionView.source` is the feature id.
export const RU_SECOND_WIND_NAME = 'Второе дыхание';
export const RU_ACTION_SURGE_NAME = 'Рывок';
export const ruTranslationPack: Pack = {
  format: 1,
  id: 'srd-5e-2024-ru-test',
  version: '0.1.0',
  kind: 'translation',
  name: 'RU test',
  authors: [],
  dependencies: [],
  locale: 'ru',
  translates: { id: PACK_ID, range: `^${PACK_VERSION}` },
  entities: [],
  overrides: [],
  assets: [],
  i18n: {},
  strings: {
    'feature/fighter-second-wind': { name: RU_SECOND_WIND_NAME },
    'feature/fighter-action-surge': { name: RU_ACTION_SURGE_NAME },
  },
};

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    if (langPath === 'characters/ru') return of(charactersRu);
    if (langPath === 'shell/en') return of(shellEn);
    if (langPath === 'shell/ru') return of(shellRu);
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

/**
 * `extraProviders` lets a spec override a provider like `WakeLockService` BEFORE the module is ever
 * instantiated — `TestBed.overrideProvider` can't run after a `TestBed.inject` has forced
 * instantiation. The real `SyncService` eagerly injects `Router`, which this setup does not provide,
 * so it is stubbed (permanently 'offline' = "solo behavior"); campaign specs override it through
 * `extraProviders` with a per-stream map.
 */
export function configureReal(extraPacks: Pack[] = [], extraProviders: AnyProvider[] = []): void {
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
        useValue: {
          packs: signal([corePack, ...extraPacks]),
          // The sheet shell's campaign packs banner reads the installed content packs.
          installedContent: signal(
            [corePack, ...extraPacks].filter((p) => p.kind !== 'translation'),
          ),
          ready: signal(true),
          corePack: signal(corePack),
        },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
      {
        provide: SyncService,
        useValue: {
          syncState: () => signal<SyncStateValue>('offline'),
          liveCampaignIds: signal<ReadonlySet<string>>(new Set()),
        },
      },
      ...extraProviders,
    ],
  });
}

/** Clears every table a sheet spec writes to. Call after `configureReal`. */
export async function resetDb(): Promise<void> {
  const db = TestBed.inject(HkDb);
  await Promise.all([
    db.events.clear(),
    db.settings.clear(),
    db.snapshots.clear(),
    db.characters.clear(),
  ]);
}

/** Standard `beforeEach`/`afterEach` of a leaf spec: fresh module, clean DB, no stale locale or overlay. */
export function setupLeafSpec(extraPacks: Pack[] = [], extraProviders: AnyProvider[] = []): void {
  beforeEach(async () => {
    // `LocaleService.setLocale('ru')` persists to REAL `localStorage`, which `TestBed` teardown never
    // clears; a later spec's fresh `TranslocoService` would otherwise read 'ru' back.
    localStorage.removeItem('hk.locale');
    configureReal(extraPacks, extraProviders);
    await resetDb();
  });

  afterEach(() => {
    document.querySelectorAll('.spec-host').forEach((el) => el.remove());
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.replaceChildren());
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });
}

/**
 * `appendTx` and the propose wiring are fire-and-forget, so a single `whenStable()` right after a
 * click doesn't reliably wait for the store's own (real, unmocked fake-indexeddb) async chain.
 */
export async function pollUntil(
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

/** A button's visible label: `hk-button` keeps its (hidden) disabled reason inside the button. */
export function labelOf(button: Element): string {
  return (button.querySelector('.hk-button__label') ?? button).textContent?.trim() ?? '';
}

/** The button inside `container` whose trimmed visible label is exactly `text`. */
export function buttonNamed(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => labelOf(b) === text,
  );
  if (!button) throw new Error(`no button matching "${text}"`);
  return button;
}

/** The text of a hk-stat-tile value / any element, trimmed. */
export function textOf(el: Element | null | undefined): string {
  return el?.textContent?.trim() ?? '';
}

/** The icon-only Cast button of a spell row (`hk-spell-row`: its name is `Cast <spell>`). */
export function castButtonIn(container: ParentNode): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith('Cast '),
  );
  if (!button) throw new Error('no Cast button');
  return button;
}

/**
 * Mounts several sheet components side by side in one wrapper (the way the sheet places them in the
 * folio and the Play tab), so a spec can drive controls across leaves — ability, skill and attack
 * rolls plus the roll log — through one `compiled` root. Returns the first fixture for `whenStable`.
 */
export async function mountSheetParts(...types: Type<unknown>[]) {
  const compiled = document.createElement('div');
  compiled.className = 'spec-host';
  document.body.append(compiled);
  const fixtures = types.map((type) => TestBed.createComponent(type));
  for (const fixture of fixtures) compiled.append(fixture.nativeElement as HTMLElement);
  const fixture = fixtures[0];
  await fixture.whenStable();
  return { fixture, compiled, fixtures };
}
