import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import type { RebasePlan } from '@hk/engine';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import {
  RebaseReportDialogComponent,
  type RebaseReportDialogData,
} from '@shared/components/rebase-report-dialog/rebase-report-dialog.component';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import sampleJson from '../../../../../testing/fixtures/packs/sample-content.json';
import { seedFighter } from '../testing/character-fixtures';
import { BuildPacksSectionComponent } from './build-packs-section.component';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!result.ok) throw new Error(`fixture pack at ${path} failed validation`);
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);
const parsedSample = parsePack(sampleJson);
if (!parsedSample.ok) throw new Error('sample-content.json fixture no longer parses');
const sample = parsedSample.pack;

const SPECIES_CHOICE = 'srd-5e-2024:system/5e-2024@0/species';
const MOONKIN = 'sample-content:species/moonkin';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'characters/en' ? charactersEn : {});
  }
}

interface DialogMock {
  open: ReturnType<typeof vi.fn>;
}

function configure(packs: Pack[], dialogResult: unknown): DialogMock {
  const open = vi.fn().mockReturnValue({ closed: Promise.resolve(dialogResult), close: vi.fn() });
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
        useValue: { packs: signal(packs), ready: signal(true), corePack: signal(corePack) },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
      { provide: DialogService, useValue: { open } },
    ],
  });
  return { open };
}

async function events(): Promise<Event[]> {
  const streamId = TestBed.inject(CharacterStore).streamId()!;
  return TestBed.inject(EventsRepository).byStream(streamId);
}

function toggleFor(fixture: ComponentFixture<unknown>, packId: string): HTMLInputElement {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
    `[data-pack-id="${packId}"] .build-packs__toggle`,
  );
  if (!el) throw new Error(`no toggle for ${packId}`);
  return el;
}

/** Polls real macrotask turns until `predicate()` holds (the store writes to fake-indexeddb). */
async function settle(fixture: ComponentFixture<unknown>, predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
  expect(predicate()).toBe(true);
}

async function pinSample(): Promise<void> {
  await TestBed.inject(CharacterStore).appendTx([
    { type: 'pack.pinned', v: 1, payload: { packId: sample.id, version: sample.version } },
  ]);
}

describe('BuildPacksSectionComponent (plan 15 Task 4)', () => {
  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  async function setup(
    packs: Pack[] = [corePack, sample],
    dialogResult: unknown = true,
  ): Promise<DialogMock> {
    const mock = configure(packs, dialogResult);
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
    await seedFighter('Ivan');
    return mock;
  }

  it('lists the core (on, disabled, with a described reason) and every installed content pack (off by default)', async () => {
    await setup();
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();

    const core = toggleFor(fixture, corePack.id);
    expect(core.checked).toBe(true);
    expect(core.disabled).toBe(true);
    const reasonId = core.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    const reason = (fixture.nativeElement as HTMLElement).querySelector(`#${reasonId}`);
    expect(reason?.textContent?.trim()).toBe('The core rules are always on.');

    const row = toggleFor(fixture, sample.id);
    expect(row.checked).toBe(false);
    expect(row.disabled).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sample content');
  });

  it('turning a pack ON appends exactly one pack.pinned and the character now sees the pack', async () => {
    await setup();
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();
    const before = (await events()).length;

    toggleFor(fixture, sample.id).click();
    await settle(
      fixture,
      () => TestBed.inject(CharacterStore).facts()?.pins[sample.id] !== undefined,
    );

    const after = await events();
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toMatchObject({
      type: 'pack.pinned',
      payload: { packId: sample.id, version: sample.version },
    });
    expect(TestBed.inject(CharacterStore).index()?.has(MOONKIN)).toBe(true);
    expect(toggleFor(fixture, sample.id).checked).toBe(true);
  });

  it('turning a pack OFF opens the rebase report; Confirm commits plan.events (pack.unpinned + the cleared choice) in one transaction', async () => {
    const { open } = await setup([corePack, sample], true);
    await pinSample();
    const store = TestBed.inject(CharacterStore);
    await store.appendTx([
      { type: 'decision.made', v: 1, payload: { choiceId: SPECIES_CHOICE, selection: [MOONKIN] } },
    ]);
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();
    const before = (await events()).length;

    toggleFor(fixture, sample.id).click();
    await settle(fixture, () => store.facts()?.pins[sample.id] === undefined);

    expect(open).toHaveBeenCalledTimes(1);
    const [component, opts] = open.mock.calls[0] as [unknown, { data: RebaseReportDialogData }];
    expect(component).toBe(RebaseReportDialogComponent);
    expect(opts.data.title).toBe('Turn off Sample content?');
    const plan: RebasePlan = opts.data.plan;
    expect(plan.invalid).toEqual([
      { choiceId: SPECIES_CHOICE, selection: [MOONKIN], reason: 'selection-missing' },
    ]);

    const after = await events();
    const appended = after.slice(before);
    expect(appended.map((e) => e.type)).toEqual(plan.events.map((e) => e.type));
    expect(appended.map((e) => e.type)).toEqual(['pack.unpinned', 'decision.cleared']);
    expect(appended[0]?.payload).toEqual({ packId: sample.id });
    expect(appended[0]?.txId).toBeDefined();
    expect(appended[1]?.txId).toBe(appended[0]?.txId);
    expect(store.facts()?.decisions[SPECIES_CHOICE]).toBeUndefined();
    expect(toggleFor(fixture, sample.id).checked).toBe(false);
  });

  it('Cancel in the rebase report commits nothing and the pack stays on', async () => {
    const { open } = await setup([corePack, sample], false);
    await pinSample();
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();
    const before = (await events()).length;

    toggleFor(fixture, sample.id).click();
    await settle(fixture, () => open.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(await events()).toHaveLength(before);
    expect(TestBed.inject(CharacterStore).facts()?.pins[sample.id]).toBe(sample.version);
    expect(toggleFor(fixture, sample.id).checked).toBe(true);
  });

  it('shows the diagnostics instead of a plan when turning a pack off would break a dependency', async () => {
    // `sample-addon` needs sample-content ^1; with sample-content unpinned the index would pick
    // the newer 2.0.0 that is also installed, so the unpin introduces deps.versionMismatch.
    const sample2: Pack = { ...sample, version: '2.0.0' };
    const addon: Pack = {
      ...sample,
      id: 'sample-addon',
      name: 'Sample addon',
      dependencies: [{ id: sample.id, range: '^1.0.0' }],
      entities: [],
      assets: [],
    };
    const { open } = await setup([corePack, sample, sample2, addon]);
    await pinSample();
    await TestBed.inject(CharacterStore).appendTx([
      { type: 'pack.pinned', v: 1, payload: { packId: addon.id, version: addon.version } },
    ]);
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();
    const before = (await events()).length;

    toggleFor(fixture, sample.id).click();
    await settle(
      fixture,
      () => (fixture.nativeElement as HTMLElement).querySelector('.build-packs__blocked') !== null,
    );

    expect(open).not.toHaveBeenCalled();
    expect(await events()).toHaveLength(before);
    const blocked = (fixture.nativeElement as HTMLElement).querySelector('.build-packs__blocked');
    expect(blocked?.getAttribute('role')).toBe('alert');
    expect(blocked?.textContent).toContain('deps.versionMismatch');
  });

  it('the campaign edit lock disables every toggle', async () => {
    await setup();
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    fixture.componentRef.setInput('disabled', true);
    await fixture.whenStable();

    expect(toggleFor(fixture, sample.id).disabled).toBe(true);
  });
});
