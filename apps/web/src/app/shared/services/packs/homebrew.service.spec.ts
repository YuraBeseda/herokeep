import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { planRebase, propose, reduce, type Sheet } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parseEntityId, parsePack, type Entity, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { uuidv7 } from '@shared/helpers/uuid';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { PacksRepository } from '@shared/services/storage/packs.repository';
import { SettingsRepository } from '@shared/services/storage/settings.repository';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import packsEn from '../../../../assets/i18n/packs/en.json';
import {
  HomebrewService,
  HomebrewValidationError,
  type HomebrewSaveResult,
} from './homebrew.service';
import { HOMEBREW_PACK_ID_KEY, isHomebrewPackId } from './homebrew-id';

/** This device's homebrew pack id, seeded into settings before each test. */
const LOCAL = 'homebrew-aaaaaaaa';
/** Another device's homebrew line, arriving like any installed content pack (e.g. via `.hero`). */
const FOREIGN = 'homebrew-bbbbbbbb';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

function readCore(): Pack {
  const path = join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json');
  const parsed = parsePack(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error('core pack fixture no longer parses');
  return parsed.pack;
}
const corePack = readCore();
const systemSlug = parseEntityId(corePack.entities.find((e) => e.type === 'system')!.id)!.slug;
const SPECIES_CHOICE = `${corePack.id}:system/${systemSlug}@0/species`;

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'packs/en' ? packsEn : {});
  }
}

const base = { tags: [], prerequisites: [], effects: [], grants: [], choices: [] };

const SPECIES: Entity = {
  ...base,
  type: 'species',
  id: 'homebrew-aaaaaaaa:species/tidekin',
  name: 'Tidekin',
  description: 'Folk of the tide pools.',
  effects: [{ type: 'feature.text', name: 'Brine Breath', description: 'You can breathe water.' }],
  size: 'medium',
  speed: 30,
  creatureType: 'humanoid',
};

const ITEM: Entity = {
  ...base,
  type: 'item',
  id: 'homebrew-aaaaaaaa:item/coral-knife',
  name: 'Coral Knife',
  category: 'weapon',
  weapon: {
    kind: 'melee',
    category: 'simple',
    damage: '1d4',
    damageType: 'piercing',
    properties: ['light'],
  },
};

const SPELL: Entity = {
  ...base,
  type: 'spell',
  id: 'homebrew-aaaaaaaa:spell/fireball',
  name: 'Fireball',
  level: 3,
  school: 'evocation',
  castingTime: { value: 1, unit: 'action' },
  range: { kind: 'feet', distance: 150 },
  components: { v: true, s: true, m: false },
  duration: { kind: 'instantaneous' },
  concentration: false,
  ritual: false,
  classes: ['wizard'],
};

function configure(): void {
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
      { provide: PackLoader, useValue: { loadCore: () => Promise.resolve(corePack) } },
      { provide: LocaleService, useValue: { locale: signal('en'), contentLocale: signal('en') } },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
    ],
  });
}

/** Creates a stored character pinning `<LOCAL>@version` (plus `extra` drafts), left loaded. */
async function seedCharacter(
  name: string,
  version: string,
  extra: (sheet: Sheet) => { type: string; v: number; payload: unknown }[] = () => [],
): Promise<string> {
  const store = TestBed.inject(CharacterStore);
  const id = await store.create(name, 'neuter');
  await store.appendTx([{ type: 'pack.pinned', v: 1, payload: { packId: LOCAL, version } }]);
  const drafts = extra(store.sheet()!);
  if (drafts.length > 0) await store.appendTx(drafts);
  return id;
}

async function eventsOf(id: string): Promise<Event[]> {
  return TestBed.inject(EventsRepository).byStream(id);
}

const pinnedAfter = (events: Event[], seq: number) =>
  events.filter((e) => (e.seq ?? 0) > seq).map((e) => [e.type, e.payload]);

async function storedPackKeys(): Promise<string[]> {
  return (await TestBed.inject(PacksRepository).getAll()).map((p) => `${p.id}@${p.version}`).sort();
}

describe('HomebrewService', () => {
  beforeEach(async () => {
    configure();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.packs.clear(),
      db.settings.clear(),
      db.events.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
    ]);
    await TestBed.inject(SettingsRepository).set(HOMEBREW_PACK_ID_KEY, LOCAL);
    await TestBed.inject(PackStore).init();
  });

  afterEach(async () => {
    // Leave the shared fake IndexedDB as found: spec files share it within a worker.
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.packs.clear(),
      db.events.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
    db.close();
  });

  it('generates a device-unique homebrew-<8 hex> pack id once and persists it in settings', async () => {
    await TestBed.inject(HkDb).settings.delete(HOMEBREW_PACK_ID_KEY);
    const service = TestBed.inject(HomebrewService);

    const first = await service
      .save({ ...SPECIES, id: 'placeholder:species/x' })
      .catch((e: unknown) => e);
    // An entity outside the device's namespace is refused by the pack schema...
    expect(first).toBeInstanceOf(HomebrewValidationError);
    const id = service.packId();
    expect(id).not.toBeNull();
    expect(isHomebrewPackId(id!)).toBe(true);
    expect(id).not.toBe(LOCAL);
    expect(await TestBed.inject(SettingsRepository).get(HOMEBREW_PACK_ID_KEY)).toBe(id);

    // ...while one minted by newEntityId lives in it.
    const result = await service.save({
      ...SPECIES,
      id: service.newEntityId('Tidekin', 'species'),
    });
    expect(result.pack.id).toBe(id);
    expect(result.pack.entities[0].id).toBe(`${id}:species/tidekin`);
    expect(await storedPackKeys()).toEqual([`${id}@0.1.0`]);
  });

  it("resolves only this device's homebrew line: another device's newer homebrew pack is left alone", async () => {
    const packStore = TestBed.inject(PackStore);
    const line = (id: string, version: string, entities: Entity[]): Pack => {
      const parsed = parsePack({
        format: 1,
        id,
        version,
        kind: 'content',
        system: systemSlug,
        name: 'My homebrew',
        dependencies: [{ id: corePack.id, range: `^${corePack.version}` }],
        entities,
      });
      if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join('; '));
      return parsed.pack;
    };
    await packStore.installContent(line(LOCAL, '0.1.3', [SPECIES]), new Map());
    await packStore.installContent(
      line(FOREIGN, '0.1.7', [{ ...SPELL, id: `${FOREIGN}:spell/fireball` }]),
      new Map(),
    );
    const service = TestBed.inject(HomebrewService);
    await service.ready();

    expect(service.pack()?.id).toBe(LOCAL);
    expect(service.pack()?.version).toBe('0.1.3');
    expect(service.slugFor('Fireball', 'spell')).toBe('fireball');

    const result = await service.save(ITEM);

    expect(result.pack.id).toBe(LOCAL);
    expect(result.pack.version).toBe('0.1.4');
    expect(result.pack.entities.map((e) => e.id)).toEqual([SPECIES.id, ITEM.id]);
    expect(await storedPackKeys()).toEqual([`${LOCAL}@0.1.4`, `${FOREIGN}@0.1.7`]);
  });

  it('a character pinning a homebrew version that is not installed is left pending with no event', async () => {
    const service = TestBed.inject(HomebrewService);
    await service.save(SPECIES);
    const stale = await seedCharacter('Stale', '0.0.9');
    const head = (await eventsOf(stale)).length;

    const result = await service.save(ITEM);

    expect(result.pending).toEqual([stale]);
    expect(result.fastForwarded).toEqual([]);
    expect(await eventsOf(stale)).toHaveLength(head);
  });

  it('measures the fast-forward over 20 level-20 characters (the golden level-20 logs)', async () => {
    const service = TestBed.inject(HomebrewService);
    await service.save(SPECIES);
    const goldenDir = join(repoRoot, 'packages/engine/test/golden');
    const logs = readdirSync(goldenDir)
      .filter((f) => /-20\.json$|^multi-fighter1-wizard19\.json$/.test(f))
      .sort()
      .map(
        (f) => (JSON.parse(readFileSync(join(goldenDir, f), 'utf8')) as { events: Event[] }).events,
      );
    const ids: string[] = [];
    let decisions = 0;
    for (let i = 0; i < 20; i++) {
      const stream = `char:${uuidv7()}`;
      const events: Event[] = logs[i % logs.length].map((e) => ({ ...e, id: uuidv7(), stream }));
      const last = events[events.length - 1];
      events.push({
        ...last,
        id: uuidv7(),
        seq: (last.seq ?? 0) + 1,
        type: 'pack.pinned',
        v: 1,
        txId: undefined,
        payload: { packId: LOCAL, version: '0.1.0' },
      });
      await TestBed.inject(EventsRepository).append(events);
      const facts = reduce(events);
      decisions += Object.keys(facts.decisions).length;
      await TestBed.inject(CharactersRepository).upsertFromFacts(stream, facts);
      ids.push(stream);
    }
    const levels = reduce(await eventsOf(ids[0])).classes.reduce((sum, c) => sum + c.level, 0);
    expect(levels).toBe(20);

    const started = performance.now();
    const result = await service.save(ITEM);
    const elapsed = performance.now() - started;
    console.info(
      `[perf] homebrew save + fast-forward, 20 level-20 characters (${decisions} decisions): ${elapsed.toFixed(1)} ms`,
    );

    expect([...result.fastForwarded].sort()).toEqual([...ids].sort());
    expect(result.pending).toEqual([]);
  }, 60_000);

  it('first save creates <device pack id>@0.1.0 with the core system slug, a caret dependency on the core and the locale name', async () => {
    const service = TestBed.inject(HomebrewService);
    expect(service.pack()).toBeNull();

    const result = await service.save(SPECIES);

    expect(result.pack.id).toBe(LOCAL);
    expect(result.pack.version).toBe('0.1.0');
    expect(result.pack.kind).toBe('content');
    expect(result.pack.system).toBe(systemSlug);
    expect(result.pack.dependencies).toEqual([{ id: corePack.id, range: `^${corePack.version}` }]);
    expect(result.pack.name).toBe(packsEn.homebrew['pack-name']);
    expect(result.pack.locale).toBe('en');
    expect(result.pack.entities.map((e) => e.id)).toEqual([SPECIES.id]);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(service.pack()?.version).toBe('0.1.0');
    expect(await storedPackKeys()).toEqual(['homebrew-aaaaaaaa@0.1.0']);
  });

  it('a second save bumps PATCH, replaces-or-adds the entity and removes the previous version row', async () => {
    const service = TestBed.inject(HomebrewService);
    await service.save(SPECIES);
    await service.save(ITEM);
    const result = await service.save({ ...SPECIES, name: 'Tidekin Folk' });

    expect(result.pack.version).toBe('0.1.2');
    expect(result.pack.entities.map((e) => [e.id, e.name])).toEqual([
      [SPECIES.id, 'Tidekin Folk'],
      [ITEM.id, 'Coral Knife'],
    ]);
    expect(await storedPackKeys()).toEqual(['homebrew-aaaaaaaa@0.1.2']);
    expect(
      TestBed.inject(PackStore)
        .installedContent()
        .map((p) => p.version),
    ).toEqual(['0.1.2']);
  });

  it('a schema-invalid entity throws a typed error with issues; the pack is unchanged and nothing is stored', async () => {
    const service = TestBed.inject(HomebrewService);
    await service.save(SPECIES);
    const broken = {
      ...ITEM,
      weapon: { kind: 'melee', category: 'simple', damage: 'banana', damageType: 'piercing' },
    } as unknown as Entity;

    const error = await service.save(broken).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HomebrewValidationError);
    expect((error as HomebrewValidationError).issues.join('\n')).toContain('weapon.damage');
    expect(service.pack()?.version).toBe('0.1.0');
    expect(await storedPackKeys()).toEqual(['homebrew-aaaaaaaa@0.1.0']);
  });

  it('a validator error (a reference to a missing entity) throws with diagnostics; nothing is stored', async () => {
    const service = TestBed.inject(HomebrewService);
    const grantsGhost = {
      ...ITEM,
      id: 'homebrew-aaaaaaaa:item/ghost-bag',
      category: 'gear',
      weapon: undefined,
      effects: [{ type: 'item.grant', item: 'homebrew-aaaaaaaa:item/nowhere', qty: 1 }],
    } as unknown as Entity;

    const error = await service.save(grantsGhost).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HomebrewValidationError);
    expect((error as HomebrewValidationError).diagnostics.map((d) => d.code)).toContain(
      'ref.missing',
    );
    expect(service.pack()).toBeNull();
    expect(await storedPackKeys()).toEqual([]);
  });

  it('remove() of an entity the pack does not hold throws and stores nothing', async () => {
    const service = TestBed.inject(HomebrewService);
    await service.save(SPECIES);
    await expect(service.remove('homebrew-aaaaaaaa:item/nope')).rejects.toThrow();
    expect(await storedPackKeys()).toEqual(['homebrew-aaaaaaaa@0.1.0']);
  });

  it('slugFor: ASCII, Cyrillic transliteration, per-type collision suffixes and the empty fallback', async () => {
    const service = TestBed.inject(HomebrewService);
    expect(service.slugFor('Fireball', 'spell')).toBe('fireball');
    expect(service.slugFor('Огненный шар', 'spell')).toBe('ognennyy-shar');
    expect(service.slugFor('!!!', 'feat')).toBe('feat-1');

    await service.save(SPELL);
    expect(service.slugFor('Fireball', 'spell')).toBe('fireball-2');
    expect(service.slugFor('Fireball', 'item')).toBe('fireball');
    await service.save({ ...SPELL, id: 'homebrew-aaaaaaaa:spell/fireball-2' });
    expect(service.slugFor('Fireball!', 'spell')).toBe('fireball-3');
  });

  // Review Focus 5 (plan 15).
  it('fast-forwards three pinned characters with exactly one pack.pinned each; deleting an entity one uses leaves it pending with no event', async () => {
    const service = TestBed.inject(HomebrewService);
    await service.save(SPECIES);
    const aria = await seedCharacter('Aria', '0.1.0', () => [
      {
        type: 'decision.made',
        v: 1,
        payload: { choiceId: SPECIES_CHOICE, selection: [SPECIES.id] },
      },
    ]);
    const bryn = await seedCharacter('Bryn', '0.1.0');
    const cass = await seedCharacter('Cass', '0.1.0');
    const heads = new Map<string, number>();
    for (const id of [aria, bryn, cass]) heads.set(id, (await eventsOf(id)).length);

    const started = performance.now();
    const saved = await service.save(ITEM);
    const elapsed = performance.now() - started;
    console.info(`[perf] homebrew save + fast-forward, 3 characters: ${elapsed.toFixed(1)} ms`);

    expect(saved.pack.version).toBe('0.1.1');
    expect([...saved.fastForwarded].sort()).toEqual([aria, bryn, cass].sort());
    expect(saved.pending).toEqual([]);
    for (const id of [aria, bryn, cass]) {
      expect(pinnedAfter(await eventsOf(id), heads.get(id)!)).toEqual([
        ['pack.pinned', { packId: LOCAL, version: '0.1.1', previous: '0.1.0' }],
      ]);
      heads.set(id, (await eventsOf(id)).length);
    }
    // The loaded character (the last one seeded) reflects the new pin live.
    expect(TestBed.inject(CharacterStore).facts()?.pins[LOCAL]).toBe('0.1.1');

    const removed: HomebrewSaveResult = await service.remove(SPECIES.id);

    expect(removed.pack.version).toBe('0.1.2');
    expect(removed.pending).toEqual([aria]);
    expect([...removed.fastForwarded].sort()).toEqual([bryn, cass].sort());
    expect(pinnedAfter(await eventsOf(aria), heads.get(aria)!)).toEqual([]);
    for (const id of [bryn, cass]) {
      expect(pinnedAfter(await eventsOf(id), heads.get(id)!)).toEqual([
        ['pack.pinned', { packId: LOCAL, version: '0.1.2', previous: '0.1.1' }],
      ]);
    }
    // The version the pending character pins stays installed, so its Update report (Task 5)
    // still sees the deleted species and lists the decision as invalid.
    expect(await storedPackKeys()).toEqual(['homebrew-aaaaaaaa@0.1.1', 'homebrew-aaaaaaaa@0.1.2']);
    const facade = TestBed.inject(EngineFacade);
    const ariaFacts = reduce(await eventsOf(aria));
    const nextPins = { ...ariaFacts.pins, [LOCAL]: '0.1.2' };
    const report = planRebase(
      ariaFacts,
      facade.indexFor(ariaFacts.pins),
      facade.indexFor(nextPins),
      nextPins,
    );
    expect(report.invalid).toEqual([
      { choiceId: SPECIES_CHOICE, selection: [SPECIES.id], reason: 'selection-missing' },
    ]);

    // Once the player confirmed that update, the next save reclaims the old version.
    await TestBed.inject(CharacterStore).appendTxToStream(aria, report.events);
    const later = await service.save(SPELL);
    expect(later.pending).toEqual([]);
    expect(await storedPackKeys()).toEqual(['homebrew-aaaaaaaa@0.1.3']);
  });

  it('deleting an item a character holds leaves that character pending (no new unresolved references are auto-applied)', async () => {
    const service = TestBed.inject(HomebrewService);
    await service.save(ITEM);
    const holder = await seedCharacter('Holder', '0.1.0', (sheet) =>
      propose.addItem(sheet, { itemId: ITEM.id }, uuidv7),
    );
    const head = (await eventsOf(holder)).length;

    const result = await service.remove(ITEM.id);

    expect(result.pending).toEqual([holder]);
    expect(result.fastForwarded).toEqual([]);
    expect(await eventsOf(holder)).toHaveLength(head);
  });

  it('a character whose next index has diagnostic errors (a pinned pack not installed) is left pending', async () => {
    const service = TestBed.inject(HomebrewService);
    await service.save(SPECIES);
    const ghost = await seedCharacter('Ghost', '0.1.0', () => [
      { type: 'pack.pinned', v: 1, payload: { packId: 'ghost-pack', version: '1.0.0' } },
    ]);
    const clean = await seedCharacter('Clean', '0.1.0');
    const head = (await eventsOf(ghost)).length;

    const result = await service.save(ITEM);

    expect(result.pending).toEqual([ghost]);
    expect(result.fastForwarded).toEqual([clean]);
    expect(await eventsOf(ghost)).toHaveLength(head);
  });

  it('a character in sync mode is left pending (its writes belong to the sync lane)', async () => {
    const service = TestBed.inject(HomebrewService);
    await service.save(SPECIES);
    const synced = await seedCharacter('Synced', '0.1.0');
    TestBed.inject(CharacterStore).enterSyncMode(synced);

    const result = await service.save(ITEM);

    expect(result.pending).toEqual([synced]);
    expect(result.fastForwarded).toEqual([]);
  });

  it('measures the fast-forward over 20 synthetic characters', async () => {
    const service = TestBed.inject(HomebrewService);
    await service.save(SPECIES);
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await seedCharacter(`Hero ${i}`, '0.1.0'));

    const started = performance.now();
    const result = await service.save(ITEM);
    const elapsed = performance.now() - started;
    console.info(`[perf] homebrew save + fast-forward, 20 characters: ${elapsed.toFixed(1)} ms`);

    expect(result.fastForwarded).toHaveLength(20);
    expect(result.pending).toEqual([]);
  }, 60_000);
});
