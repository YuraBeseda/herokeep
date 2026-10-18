import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import {
  error as diagnosticError,
  type ContentIndex,
  type Pins,
  type RebasePlan,
} from '@hk/engine';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import {
  RebaseReportDialogComponent,
  type RebaseReportDialogData,
} from '@shared/components/rebase-report-dialog/rebase-report-dialog.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
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

describe('BuildPacksSectionComponent — update flow (plan 15 Task 5)', () => {
  // 1.1.0 drops Moonkin, so updating clears a species decision that picked it.
  const sample11: Pack = {
    ...sample,
    version: '1.1.0',
    entities: sample.entities.filter((e) => e.id !== MOONKIN),
  };

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  async function setup(packs: Pack[], dialogResult: unknown = true): Promise<DialogMock> {
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

  const rowEl = (fixture: ComponentFixture<unknown>, packId: string): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `[data-pack-id="${packId}"]`,
    )!;
  const badge = (fixture: ComponentFixture<unknown>, packId: string) =>
    rowEl(fixture, packId).querySelector('.build-packs__update-badge');
  const updateButton = (fixture: ComponentFixture<unknown>, packId: string) =>
    rowEl(fixture, packId).querySelector<HTMLButtonElement>('.build-packs__update');

  async function pinSampleWithMoonkin(): Promise<void> {
    await pinSample();
    await TestBed.inject(CharacterStore).appendTx([
      { type: 'decision.made', v: 1, payload: { choiceId: SPECIES_CHOICE, selection: [MOONKIN] } },
    ]);
  }

  it('shows "Update available" with from → to when a newer version of a pinned pack is installed', async () => {
    await setup([corePack, sample, sample11]);
    await pinSample();
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();

    expect(badge(fixture, sample.id)?.textContent?.trim()).toBe(
      'Update available: v1.0.0 → v1.1.0',
    );
    const button = updateButton(fixture, sample.id)!;
    expect(button.textContent?.trim()).toBe('Update');
    expect(button.getAttribute('aria-label')).toBe('Update Sample content to v1.1.0');
    expect(badge(fixture, corePack.id)).toBeNull();
  });

  it('shows no badge for a pack the character does not pin, or already pins at the newest version', async () => {
    await setup([corePack, sample, sample11]);
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();
    expect(badge(fixture, sample.id)).toBeNull();

    await TestBed.inject(CharacterStore).appendTx([
      { type: 'pack.pinned', v: 1, payload: { packId: sample.id, version: '1.1.0' } },
    ]);
    await fixture.whenStable();
    expect(badge(fixture, sample.id)).toBeNull();
  });

  it('Update → report → Confirm commits exactly plan.events in one transaction and advances the pin', async () => {
    const { open } = await setup([corePack, sample, sample11], true);
    await pinSampleWithMoonkin();
    const store = TestBed.inject(CharacterStore);
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();
    const before = (await events()).length;

    updateButton(fixture, sample.id)!.click();
    await settle(fixture, () => store.facts()?.pins[sample.id] === '1.1.0');

    expect(open).toHaveBeenCalledTimes(1);
    const [component, opts] = open.mock.calls[0] as [unknown, { data: RebaseReportDialogData }];
    expect(component).toBe(RebaseReportDialogComponent);
    expect(opts.data.title).toBe('Update Sample content v1.0.0 → v1.1.0?');
    expect(opts.data.validationOnly).toBe(false);
    expect(opts.data.nextIndex?.has(MOONKIN)).toBe(false);
    const plan: RebasePlan = opts.data.plan;
    expect(plan.invalid).toEqual([
      { choiceId: SPECIES_CHOICE, selection: [MOONKIN], reason: 'selection-missing' },
    ]);

    const appended = (await events()).slice(before);
    expect(appended.map(({ type, v, payload }) => ({ type, v, payload }))).toEqual(plan.events);
    expect(appended.map((e) => e.type)).toEqual(['pack.pinned', 'decision.cleared']);
    expect(appended[0]?.payload).toEqual({
      packId: sample.id,
      version: '1.1.0',
      previous: '1.0.0',
    });
    expect(appended[0]?.txId).toBeDefined();
    expect(appended[1]?.txId).toBe(appended[0]?.txId);
    expect(badge(fixture, sample.id)).toBeNull();
  });

  it('Cancel in the update report commits nothing and keeps the old pin', async () => {
    const { open } = await setup([corePack, sample, sample11], false);
    await pinSampleWithMoonkin();
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();
    const before = (await events()).length;

    updateButton(fixture, sample.id)!.click();
    await settle(fixture, () => open.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(await events()).toHaveLength(before);
    expect(TestBed.inject(CharacterStore).facts()?.pins[sample.id]).toBe('1.0.0');
    expect(badge(fixture, sample.id)).not.toBeNull();
  });

  it('a next index with an error (deps.pinMissing) shows the blocked block instead of the report', async () => {
    const { open } = await setup([corePack, sample, sample11]);
    await pinSample();
    const facade = TestBed.inject(EngineFacade);
    const original = facade.indexFor.bind(facade);
    vi.spyOn(facade, 'indexFor').mockImplementation((pins: Pins): ContentIndex => {
      const index = original(pins);
      if (pins[sample.id] !== '1.1.0') return index;
      const missing = diagnosticError(
        'deps.pinMissing',
        'Pinned version other@2.0.0 is not available',
      );
      return { ...index, diagnostics: [...index.diagnostics, missing] };
    });
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();
    const before = (await events()).length;

    updateButton(fixture, sample.id)!.click();
    await settle(
      fixture,
      () => (fixture.nativeElement as HTMLElement).querySelector('.build-packs__blocked') !== null,
    );

    expect(open).not.toHaveBeenCalled();
    expect(await events()).toHaveLength(before);
    const blocked = (fixture.nativeElement as HTMLElement).querySelector('.build-packs__blocked')!;
    expect(blocked.getAttribute('role')).toBe('alert');
    expect(blocked.textContent).toContain(charactersEn.sheet.build.packs['update-blocked']);
    expect(blocked.textContent).toContain('deps.pinMissing');
  });

  it('the core update opens a validation-only report and Confirm pins the shipped core', async () => {
    const { open } = await setup([corePack, sample], true);
    const store = TestBed.inject(CharacterStore);
    await store.appendTx([
      { type: 'pack.pinned', v: 1, payload: { packId: corePack.id, version: '0.0.1' } },
    ]);
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    await fixture.whenStable();

    expect(badge(fixture, corePack.id)?.textContent?.trim()).toBe(
      `Update available: v0.0.1 → v${corePack.version}`,
    );
    updateButton(fixture, corePack.id)!.click();
    await settle(fixture, () => store.facts()?.pins[corePack.id] === corePack.version);

    const [, opts] = open.mock.calls[0] as [unknown, { data: RebaseReportDialogData }];
    expect(opts.data.validationOnly).toBe(true);
    // Current and next resolve against the same shipped core: only the pin itself differs.
    expect(opts.data.plan.changes.map((c) => c.path)).toEqual([`pins.${corePack.id}`]);
    expect(opts.data.plan.events).toEqual([
      {
        type: 'pack.pinned',
        v: 1,
        payload: { packId: corePack.id, version: corePack.version, previous: '0.0.1' },
      },
    ]);
  });

  it('the campaign edit lock disables the Update button', async () => {
    await setup([corePack, sample, sample11]);
    await pinSample();
    const fixture = TestBed.createComponent(BuildPacksSectionComponent);
    fixture.componentRef.setInput('disabled', true);
    await fixture.whenStable();

    expect(updateButton(fixture, sample.id)!.disabled).toBe(true);
  });
});
