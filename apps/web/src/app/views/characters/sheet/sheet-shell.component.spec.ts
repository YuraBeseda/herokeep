import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { HeroWriterService } from '@shared/services/export/hero-writer.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { routes } from '../../../app.routes';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../../assets/i18n/characters/uk.json';
import sampleJson from '../../../../testing/fixtures/packs/sample-content.json';
import { SheetShellComponent } from './sheet-shell.component';
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
    // plan-10 task-7: `CampaignChipComponent` self-registers the `campaigns` scope from inside
    // the sheet header — needed only for the tests that actually link a character to a campaign.
    if (langPath === 'campaigns/en') return of(campaignsEn);
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

function configureReal(packs: Pack[] = [corePack]): void {
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
        useValue: { packs: signal(packs), ready: signal(true), corePack: signal(corePack) },
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
      db.campaigns.clear(),
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

  it('shows no campaign chip for a solo (never-joined) character', async () => {
    const id = await seedFighter('Ivan');
    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const root = harness.routeNativeElement!;

    expect(root.querySelector('.campaign-chip')).toBeNull();
  });

  it('shows the campaign chip with the campaign name and a /g/:id link once the character has joined a campaign (plan-10 task-7)', async () => {
    const id = await seedFighter('Ivan');
    const campaignId = '00000000-0000-4000-8000-0000000000ab';

    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([
      { type: 'character.campaign_joined', v: 1, payload: { campaignId } },
    ]);
    await TestBed.inject(CampaignsRepository).put({
      id: campaignId,
      name: 'Curse of Strahd',
      system: 'srd-5e-2024',
      role: 'player',
      lastSeq: 1,
      updatedAt: Date.now(),
    });

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await harness.fixture.whenStable();
    const root = harness.routeNativeElement!;

    const link = root.querySelector<HTMLAnchorElement>('.campaign-chip__link');
    expect(link?.textContent?.trim()).toBe('Curse of Strahd');
    expect(link?.getAttribute('href')).toBe(`/g/${campaignId}`);
    expect(root.querySelector('.campaign-chip__leave')?.textContent?.trim()).toBe(
      campaignsEn.chip.leave,
    );
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

  // --- `.hero` export (plan-6 Task 9) ---------------------------------------------------------

  it('the Export button builds a .hero bundle, delivers it (jsdom has neither showSaveFilePicker nor navigator.share, so the ladder falls through to the <a download> fallback), and toasts success', async () => {
    const id = await seedFighter('Ivan');
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const root = harness.routeNativeElement!;
    const exportButton = root.querySelector<HTMLButtonElement>('.sheet-shell__export')!;
    expect(exportButton).not.toBeNull();

    exportButton.click();
    await pollUntil(harness.fixture, () => showSpy.mock.calls.length > 0);

    expect(showSpy).toHaveBeenCalledWith('characters.sheet.export.success');
  });

  it('a HeroWriterService.export failure toasts characters.sheet.export.failure and re-enables the Export button', async () => {
    const id = await seedFighter('Ivan');
    const heroWriterService = TestBed.inject(HeroWriterService);
    vi.spyOn(heroWriterService, 'export').mockRejectedValue(new Error('boom'));
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const root = harness.routeNativeElement!;
    const exportButton = root.querySelector<HTMLButtonElement>('.sheet-shell__export')!;
    expect(exportButton).not.toBeNull();

    exportButton.click();
    await pollUntil(harness.fixture, () => showSpy.mock.calls.length > 0);

    expect(showSpy).toHaveBeenCalledWith('characters.sheet.export.failure');
    // The `finally` block clears `exporting()` regardless of outcome — the button must not be
    // left stuck disabled after a failed export.
    await harness.fixture.whenStable();
    expect(exportButton.disabled).toBe(false);
  });
});

// --- Plan 15 (phase 4 slice 5) Task 4: per-character pack set ---------------------------------
describe('SheetShellComponent — per-character pack set (plan 15 Task 4)', () => {
  const parsedSample = parsePack(sampleJson);
  if (!parsedSample.ok) throw new Error('sample-content.json fixture no longer parses');
  const sample = parsedSample.pack;
  const MOONKIN = 'sample-content:species/moonkin';

  beforeEach(async () => {
    configureReal([corePack, sample]);
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
      db.campaigns.clear(),
    ]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it("scopes the EngineFacade under the shell to the character's pins: a pinned, installed pack's entities resolve there, never in the root index", async () => {
    const id = await seedFighter('Ivan');
    await TestBed.inject(CharacterStore).appendTx([
      { type: 'pack.pinned', v: 1, payload: { packId: sample.id, version: sample.version } },
    ]);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const shell = harness.fixture.debugElement.query(By.directive(SheetShellComponent));
    const scoped = shell.injector.get(EngineFacade);

    expect(scoped.index().has(MOONKIN)).toBe(true);
    expect(scoped.localizer().name(MOONKIN)).toBe('Moonkin');
    expect(TestBed.inject(EngineFacade).index().has(MOONKIN)).toBe(false);
  });

  it('a character pinned to an uninstalled pack renders the sheet with the missing-packs banner on every tab; its references stay unresolved warnings (Review Focus 4)', async () => {
    const id = await seedFighter('Ivan');
    const store = TestBed.inject(CharacterStore);
    await store.appendTx([
      { type: 'pack.pinned', v: 1, payload: { packId: 'ghost-pack', version: '2.0.0' } },
    ]);
    await store.appendTx([
      {
        type: 'decision.made',
        v: 1,
        payload: {
          choiceId: 'srd-5e-2024:system/5e-2024@0/species',
          selection: ['ghost-pack:species/wisp'],
        },
      },
    ]);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const root = harness.routeNativeElement!;

    expect(root.querySelector('.sheet-shell__name')?.textContent?.trim()).toBe('Ivan');
    const banner = root.querySelector('.sheet-shell__missing-packs');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent).toContain(
      "This character uses a content pack that isn't installed on this device:",
    );
    expect(banner?.textContent).toContain('ghost-pack@2.0.0');
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe('/packs');
    expect(
      store
        .sheet()
        ?.issues.some(
          (d) => d.code === 'derive.unresolvedEntity' && d.entityId === 'ghost-pack:species/wisp',
        ),
    ).toBe(true);

    await harness.navigateByUrl(`/c/${id}/build`);
    expect(harness.routeNativeElement!.querySelector('.sheet-shell__missing-packs')).not.toBeNull();
    await harness.navigateByUrl(`/c/${id}/timeline`);
    expect(harness.routeNativeElement!.querySelector('.sheet-shell__missing-packs')).not.toBeNull();
  });

  it('lists every missing pin (a core at another version included) with a plural message', async () => {
    const id = await seedFighter('Ivan');
    await TestBed.inject(CharacterStore).appendTx([
      { type: 'pack.pinned', v: 1, payload: { packId: 'ghost-pack', version: '2.0.0' } },
      {
        type: 'pack.pinned',
        v: 1,
        payload: { packId: corePack.id, version: '0.0.9', previous: corePack.version },
      },
    ]);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const banner = harness.routeNativeElement!.querySelector('.sheet-shell__missing-packs');

    expect(banner?.textContent).toContain(
      "This character uses 2 content packs that aren't installed on this device:",
    );
    const entries = Array.from(banner?.querySelectorAll('li') ?? []).map((li) =>
      li.textContent?.trim(),
    );
    expect(entries).toEqual(['ghost-pack@2.0.0', `${corePack.id}@0.0.9`]);
    expect(
      harness.routeNativeElement!.querySelector('.sheet-shell__name')?.textContent?.trim(),
    ).toBe('Ivan');
  });

  it('shows no banner when every pin is installed', async () => {
    const id = await seedFighter('Ivan');
    await TestBed.inject(CharacterStore).appendTx([
      { type: 'pack.pinned', v: 1, payload: { packId: sample.id, version: sample.version } },
    ]);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);

    expect(harness.routeNativeElement!.querySelector('.sheet-shell__missing-packs')).toBeNull();
  });

  it('the banner strings exist in en, ru and uk (ICU plural)', () => {
    for (const locale of [charactersEn, charactersRu, charactersUk]) {
      const banner = (
        locale.sheet as unknown as { banner?: Record<string, Record<string, string>> }
      ).banner?.['missing-packs'];
      expect(Object.keys(banner ?? {}).sort()).toEqual(['entry', 'link', 'message']);
      expect(banner?.['message']).toMatch(/\{count, plural,/);
    }
  });

  it('an unpinned installed pack stays invisible under the shell too', async () => {
    const id = await seedFighter('Ivan');

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const shell = harness.fixture.debugElement.query(By.directive(SheetShellComponent));

    expect(shell.injector.get(EngineFacade).index().has(MOONKIN)).toBe(false);
  });
});
