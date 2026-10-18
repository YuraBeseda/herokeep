import { inject, Injectable } from '@angular/core';
import { reduce, validatePack, type Diagnostic } from '@hk/engine';
import {
  formatIssues,
  HeroBundleImageSchema,
  HKPACK_ASSET_DIR,
  HKPACK_LIMITS,
  PACK_LIMITS,
  parseEvent,
  parseHeroManifest,
  parsePack,
  type Event,
  type HeroBundleImage,
  type HeroBundleManifest,
  type Pack,
  type PackIssue,
} from '@hk/protocol';
import { IMAGE_BYTE_CAPS, sha256Hex } from '@shared/services/images/image-pipeline.service';
import { canonicalJson } from '@shared/services/packs/canonical-json';
import {
  PACK_ASSET_BYTE_CAP,
  verifyPackAssets,
  type PackImportAsset,
} from '@shared/services/packs/pack-assets';
import {
  PackImportAssetHashMismatchError,
  PackImportError,
} from '@shared/services/packs/pack-import.errors';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { LeaderService } from '@shared/services/storage/leader.service';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { extensionForMime, heroPackPath, hexOfHash } from './hero-writer.service';

/**
 * `.hero` import (Global Constraints, plan-6 Task 10 — BINDING semantics): every failure mode
 * below is a distinct, typed error so `CharactersListComponent` can map it to a localized toast
 * key via its own `code` — same pattern as `CharacterStoreNotLeaderError`
 * (`@shared/stores/character.store`) and `ImageTooLargeError`/`ImageInvalidTypeError`
 * (`@shared/services/images/image-pipeline.service`).
 */

/** The selected file could not even be unzipped (corrupt bytes / not a zip at all), OR it unzipped
 * fine but is missing one of the two entries EVERY `.hero` bundle must contain
 * (`manifest.json`/`events.json`) — either way, this file is not structurally a `.hero` bundle. */
export class HeroImportBadZipError extends Error {
  readonly code = 'characters.list.toast.import-failed-bad-zip';
  constructor(cause?: unknown) {
    super('The selected file is not a valid .hero bundle.');
    this.name = 'HeroImportBadZipError';
    this.cause = cause;
  }
}

/** `events.json` cap, checked from the central directory before inflation: 16 MiB is ~50,000
 * events at a generous ~300 bytes each, far beyond any real character's history. */
export const HERO_EVENTS_MAX_BYTES = 16 * 1024 * 1024;

/** `manifest.json` cap, checked the same way: 1 MiB holds thousands of image/pack rows. */
export const HERO_MANIFEST_MAX_BYTES = 1024 * 1024;

/** The largest per-kind image cap; any `images/*` entry declaring more can never pass the
 * per-kind check after inflation, so it is refused before. */
const HERO_IMAGE_ENTRY_MAX_BYTES = Math.max(...Object.values(IMAGE_BYTE_CAPS));

/** Plan 15 final fix wave A1: the bundle's central directory declares more entries than
 * `HKPACK_LIMITS.maxEntries`, or an entry the reader reads declares more bytes than its cap. A
 * subclass of `HeroImportBadZipError`, so it shares that error's toast
 * (`characters.list.toast.import-failed-bad-zip`): the file is not an importable `.hero` bundle. */
export class HeroImportTooLargeError extends HeroImportBadZipError {
  constructor(
    readonly detail: 'entries' | 'events-bytes' | 'manifest-bytes' | 'image-bytes',
    readonly actual: number,
    readonly limit: number,
  ) {
    super();
    this.message = `The .hero bundle exceeds a size limit (${detail}: ${actual} > ${limit}).`;
    this.name = 'HeroImportTooLargeError';
  }
}

/** `manifest.json` unzipped fine but is not valid JSON, or fails `HeroBundleManifestSchema`
 * (`parseHeroManifest`) — `issues` mirrors `parseEvent`'s own `PackIssue[]` shape. Also thrown for
 * a structurally broken `events.json` (not valid JSON, or not a JSON array) — that, too, is a
 * bundle-integrity problem the manifest ostensibly described (`eventCount`), not a single bad
 * event a `HeroImportBadEventError` index could point at. */
export class HeroImportBadManifestError extends Error {
  readonly code = 'characters.list.toast.import-failed-bad-manifest';
  constructor(readonly issues: readonly PackIssue[]) {
    super(`Invalid .hero manifest — ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.name = 'HeroImportBadManifestError';
  }
}

/** One entry of an otherwise-well-formed `events.json` array fails `parseEvent` — `index` is its
 * 0-based position in that array. */
export class HeroImportBadEventError extends Error {
  readonly code = 'characters.list.toast.import-failed-bad-event';
  constructor(
    readonly index: number,
    readonly issues: readonly PackIssue[],
  ) {
    super(
      `Invalid event at index ${index} — ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    );
    this.name = 'HeroImportBadEventError';
  }
}

/** Plan 15 Task 6: a content pack the bundle carries (`manifest.packs[]`) cannot be installed —
 * its entry is missing or over `PACK_LIMITS.maxBytes`, it fails the strict `PackSchema`, it is not
 * the `id@version` its row names, `validatePack` reports errors (`diagnostics`), or one of its
 * assets is missing / too large / not the declared image type. `packKey` is `id@version`. */
export class HeroImportBadPackError extends Error {
  readonly code = 'characters.list.toast.import-failed-bad-pack';
  constructor(
    readonly packKey: string,
    readonly issues: readonly string[],
    readonly diagnostics: readonly Diagnostic[] = [],
  ) {
    super(`Invalid bundled pack ${packKey} — ${issues.join('; ')}`);
    this.name = 'HeroImportBadPackError';
  }
}

/** Plan 15 Task 6: the bundle carries `packKey` (`id@version`), but this device already has a
 * DIFFERENT pack installed under that exact `id@version` (canonical JSON differs), or the carried
 * pack reuses the core pack's id. Same rule as the `.hkpack` importer's conflict refusal. */
export class HeroImportPackConflictError extends Error {
  readonly code = 'characters.list.toast.import-failed-pack-conflict';
  constructor(readonly packKey: string) {
    super(`A different pack ${packKey} is already installed.`);
    this.name = 'HeroImportPackConflictError';
  }
}

/** An `images/<hash-hex>.<ext>` entry's actual bytes don't hash to the `hash` its manifest entry
 * declares (Global Constraints' export section: "hash-verify on import"). A corrupted/tampered
 * bundle is refused outright rather than silently storing mismatched image data under a hash that
 * no longer describes it. Plan 15 Task 6 reuses it for a carried pack (`packs/<id>@<version>.json`
 * vs its manifest row's `sha256`) and for a carried pack's asset (vs its declared hash) — `what`
 * only shapes the developer message. */
export class HeroImportHashMismatchError extends Error {
  readonly code = 'characters.list.toast.import-failed-hash-mismatch';
  constructor(
    readonly hash: string,
    what: 'Image' | 'Pack' | 'Pack asset' = 'Image',
  ) {
    super(`${what} bytes for ${hash} do not match the manifest's declared hash.`);
    this.name = 'HeroImportHashMismatchError';
  }
}

/**
 * Fix-wave review, Important finding 1 (plan-9 design item: "import-while-synced merge") — the
 * target `characterId` is KNOWN locally (this would be a `mode: 'merged'` import) AND its stream
 * is currently in `CharacterStore`'s PENDING-write/sync fork (`isSyncMode`). Merging a bundle into
 * such a stream would re-sequence its local history via `mergeEventsBySeq`/
 * `EventsRepository.replaceStream` out from under a live (or about-to-reconnect) sync session: the
 * next `hello` this stream sends reads the rewritten committed head as a local-ahead condition,
 * `StreamSyncSession`'s own resume-verification then fails (the resent tail's ids/seqs no longer
 * match what the merge produced), and `SyncService`'s server-wins `restore()` silently overwrites
 * the just-merged import with the server's untouched copy — the import appears to succeed in the
 * UI, then vanishes on the next reconnect. A real fix means reconciling a merge's re-sequenced
 * seqs against a live pending/ack lifecycle (whether the merge itself should even be allowed to
 * touch already-committed seqs, and how to re-derive `pendingOrder` for anything still pending) —
 * deferred as a plan-9 design item; for now this is refused outright rather than attempted
 * unsafely. Importing a bundle whose `characterId` is UNKNOWN locally (the `created` branch) is
 * unaffected — a brand-new local stream has no sync session to race.
 */
export class HeroImportSyncedStreamError extends Error {
  readonly code = 'characters.list.toast.import-failed-synced';
  constructor() {
    super('Cannot import a bundle over a character that is currently syncing.');
    this.name = 'HeroImportSyncedStreamError';
  }
}

export interface ImportResult {
  readonly characterId: string;
  readonly name: string;
  readonly mode: 'created' | 'merged';
  readonly imported: number;
  readonly skippedDuplicates: number;
  readonly warnings: readonly string[];
}

interface ResolvedIncomingImage extends HeroBundleImage {
  readonly bytes: Uint8Array;
}

/** A carried content pack that passed every check (plan 15 Task 6); `assets` keyed by hash. */
interface BundlePack {
  readonly pack: Pack;
  readonly assets: ReadonlyMap<string, PackImportAsset>;
}

/** The zip directory carried packs live in (`HeroWriterService`'s `heroPackPath`). */
const PACK_ENTRY_DIR = 'packs/';

/** The zip directory character images live in (`HeroWriterService`'s `images/<hex>.<ext>`). */
const IMAGE_ENTRY_DIR = 'images/';

function packKey(pack: Pack): string {
  return `${pack.id}@${pack.version}`;
}

/** `JSON.parse` + strict `parsePack` + kind `content` for a carried pack — any failure is a
 * `HeroImportBadPackError` for `key` (the manifest row's `id@version`). */
function parseBundlePack(key: string, text: string): Pack {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HeroImportBadPackError(key, ['not valid JSON']);
  }
  const result = parsePack(raw);
  if (!result.ok) throw new HeroImportBadPackError(key, formatIssues(result.issues));
  if (result.pack.kind !== 'content') {
    throw new HeroImportBadPackError(key, ['kind: only content packs can be carried']);
  }
  return result.pack;
}

/**
 * Union-by-id merge (Global Constraints "MERGE-BY-ID"): `existing` is every event already local to
 * this stream; `newIncoming` is the bundle's events whose `id`s are NOT already among them (the
 * caller has already dropped the rest — an incoming event sharing an existing id is a pure
 * duplicate that never overwrites the local copy, i.e. "existing wins"). The two lists are then
 * re-sorted together by each event's own ALREADY-ASSIGNED `seq` — for `existing` that's this
 * stream's own local ordering; for `newIncoming` it's the seq the EXPORTING device had assigned —
 * a solo-phase (no true causal/CRDT ordering yet) approximation of "put divergent history back in
 * roughly the order it happened", good enough until Phase 2 sync exists.
 *
 * Tie-break (two events — one from each side — sharing the same original seq number, plausible
 * whenever both sides diverged from a common ancestor and each independently appended something at
 * "their own step N"): EXISTING sorts first, deterministically and stably — the same "existing
 * wins" bias as the id-collision case one level up, just applied to ORDERING instead of PRESENCE.
 * `EventsRepository.replaceStream` rewrites the merged array's `seq` fields to a fresh, gap-free
 * `1..n` immediately after this returns, so the tie only ever affects relative position, never the
 * final stored seq value.
 */
export function mergeEventsBySeq(
  existing: readonly Event[],
  newIncoming: readonly Event[],
): Event[] {
  const tagged: { event: Event; side: 0 | 1; index: number }[] = [
    ...existing.map((event, index) => ({ event, side: 0 as const, index })),
    ...newIncoming.map((event, index) => ({ event, side: 1 as const, index })),
  ];
  tagged.sort((a, b) => {
    const seqDiff = (a.event.seq ?? 0) - (b.event.seq ?? 0);
    if (seqDiff !== 0) return seqDiff;
    if (a.side !== b.side) return a.side - b.side; // existing (0) sorts before incoming (1)
    return a.index - b.index; // stable within one side (Array#sort is already stable — explicit for clarity)
  });
  return tagged.map((t) => t.event);
}

/**
 * `.hero` bundle import (plan-6 Task 10, sibling of `HeroWriterService`'s export). `import()`
 * fully VALIDATES the selected file (zip structure, manifest schema, every event, every declared
 * image's hash) before writing anything to storage — a rejected file leaves the database
 * untouched. Once validated: an UNKNOWN `characterId` locally creates the stream verbatim
 * (`mode: 'created'`); a KNOWN one merges by event id (`mode: 'merged'`, Global Constraints —
 * see `mergeEventsBySeq`'s own doc for the ordering rule). Either way, the stream's cached
 * snapshot is dropped and its library-index row refreshed from a full replay; if `CharacterStore`
 * currently has this character loaded, it is reloaded too (its own snapshot-dropped, full-replay
 * `load()` — see that method's class doc) so an open sheet reflects imported data immediately.
 *
 * Plan 15 Task 6 (ruling 9): content packs the bundle carries (`manifest.packs[]`) go through the
 * `.hkpack` importer's own checks (`readBundlePacks`) during that same validation phase, silently —
 * no trust dialog. Once the character is validated too, the packs not yet installed are written
 * through `PackStore.installContent` BEFORE the character; if the character write then fails, the
 * packs stay installed (valid standalone content). An old bundle without `packs` imports as before.
 *
 * `fflate` is imported LAZILY, same reasoning as `HeroWriterService.export` — this service is the
 * only thing that pulls it in besides the writer, and neither should bloat the initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class HeroReaderService {
  private readonly eventsRepository = inject(EventsRepository);
  private readonly snapshotsRepository = inject(SnapshotsRepository);
  private readonly blobsRepository = inject(BlobsRepository);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly packStore = inject(PackStore);
  private readonly leaderService = inject(LeaderService);
  private readonly characterStore = inject(CharacterStore);

  async import(file: File): Promise<ImportResult> {
    if (!this.leaderService.isLeader()) throw new CharacterStoreNotLeaderError();

    const { unzipSync, strFromU8 } = await import('fflate');

    // Every entry is checked from its central-directory sizes BEFORE inflating (fflate sizes an
    // inflated entry's buffer from the declared `originalSize`):
    // - every entry, directories included, counts toward `HKPACK_LIMITS.maxEntries`, and the cap
    //   THROWS from inside the filter: fflate walks as many headers as the archive CLAIMS (a forged
    //   zip64 record can claim 2^32), so merely returning `false` would keep the thread busy;
    // - `manifest.json`, `events.json` and `images/*` over their caps throw
    //   `HeroImportTooLargeError` (A1, plan 15 final fix wave);
    // - entries a carried pack lives in (`packs/…`, `assets/…`, plan 15 Task 6) over their caps are
    //   skipped and remembered, refused below only if the manifest actually names them;
    // - directories and any other entry are counted but never inflated (the reader reads nothing
    //   else).
    const oversized = new Set<string>();
    let entries = 0;
    let zip: Record<string, Uint8Array>;
    try {
      zip = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: (info) => {
          entries++;
          if (entries > HKPACK_LIMITS.maxEntries) {
            throw new HeroImportTooLargeError('entries', entries, HKPACK_LIMITS.maxEntries);
          }
          const declared = Math.max(info.size, info.originalSize);
          const hardCap =
            info.name === 'events.json'
              ? (['events-bytes', HERO_EVENTS_MAX_BYTES] as const)
              : info.name === 'manifest.json'
                ? (['manifest-bytes', HERO_MANIFEST_MAX_BYTES] as const)
                : info.name.startsWith(IMAGE_ENTRY_DIR) && !info.name.endsWith('/')
                  ? (['image-bytes', HERO_IMAGE_ENTRY_MAX_BYTES] as const)
                  : undefined;
          if (hardCap) {
            if (declared > hardCap[1]) {
              throw new HeroImportTooLargeError(hardCap[0], declared, hardCap[1]);
            }
            return true;
          }
          const softCap = info.name.endsWith('/')
            ? undefined
            : info.name.startsWith(PACK_ENTRY_DIR)
              ? PACK_LIMITS.maxBytes
              : info.name.startsWith(HKPACK_ASSET_DIR)
                ? PACK_ASSET_BYTE_CAP
                : undefined;
          if (softCap === undefined) return false; // directory or unknown entry: never read
          if (declared > softCap) {
            oversized.add(info.name);
            return false;
          }
          return true;
        },
      });
    } catch (cause) {
      if (cause instanceof HeroImportBadZipError) throw cause;
      throw new HeroImportBadZipError(cause);
    }
    const manifestBytes = zip['manifest.json'];
    const eventsBytes = zip['events.json'];
    if (!manifestBytes || !eventsBytes) throw new HeroImportBadZipError();

    const manifest = this.parseManifest(strFromU8(manifestBytes));
    const incomingEvents = this.parseEvents(strFromU8(eventsBytes));
    // Fix-wave review, minor finding 2: `manifest.eventCount` is the bundle's own claim about how
    // many events `events.json` holds — a mismatch means the bundle was hand-edited or truncated
    // (a genuine `HeroWriterService.export` output always satisfies this trivially, since it sets
    // `eventCount: events.length` itself), so this is a bundle-INTEGRITY check, same family as the
    // "not valid JSON"/"not an array" checks `parseEvents` already throws for.
    if (manifest.eventCount !== incomingEvents.length) {
      throw new HeroImportBadManifestError([
        {
          path: 'manifest.eventCount',
          message: `manifest declares eventCount ${manifest.eventCount} but events.json has ${incomingEvents.length} entries`,
        },
      ]);
    }

    const warnings: string[] = [...this.pinWarnings(manifest)];
    const images = await this.readAndVerifyImages(zip, manifest, warnings);
    const bundlePacks = await this.readBundlePacks(zip, oversized, manifest, strFromU8);
    const characterId = manifest.characterId;

    // Everything above is pure CPU/validation work — unzip, schema checks, SHA-256 hashing — and
    // touches no storage, so it deliberately runs OUTSIDE the exclusive section below (no reason
    // to hold the character mutation queue for it). Everything below IS the actual storage
    // read-modify-write, and runs as ONE atomic unit against `CharacterStore`'s own serialized
    // mutation queue (fix-round 1, Critical finding): without this, the create-vs-merge decision
    // (`charactersRepository.get`) and the `byStream` read a merge does could each go stale if a
    // concurrent `CharacterStore.deleteCharacter`/`appendTx`/`revert` for the SAME stream ran in
    // between — e.g. a delete landing between this read and `replaceStream` could resurrect a
    // deleted row, or a concurrent append's events could be silently dropped by `replaceStream`
    // overwriting the whole stream. `runExclusive` guarantees this callback never overlaps any
    // other queued mutation, in either direction.
    return this.characterStore.runExclusive(async () => {
      const existingRow = await this.charactersRepository.get(characterId);
      const mode: ImportResult['mode'] = existingRow ? 'merged' : 'created';

      // Fix-wave review, Important finding 1 — see `HeroImportSyncedStreamError`'s own doc.
      // Checked here, BEFORE any write (`storeImages` included), and only for the MERGE path: a
      // genuinely unknown `characterId` can't already have a live sync session.
      if (mode === 'merged' && this.characterStore.isSyncMode(characterId)) {
        throw new HeroImportSyncedStreamError();
      }

      // Plan 15 Task 6: carried packs are installed FIRST (everything — pack and character — is
      // validated by now), then the character. Should a character write below fail, the packs
      // stay installed: each is valid, standalone content in its own right (the same thing a
      // `.hkpack` import of it would have left), and the user can remove it from the Packs screen.
      await this.installBundlePacks(bundlePacks);
      await this.storeImages(images);

      let finalEvents: Event[];
      let imported: number;
      let skippedDuplicates: number;
      if (mode === 'created') {
        finalEvents = incomingEvents;
        imported = incomingEvents.length;
        skippedDuplicates = 0;
      } else {
        const existingEvents = await this.eventsRepository.byStream(characterId);
        const existingIds = new Set(existingEvents.map((e) => e.id));
        const newIncoming = incomingEvents.filter((e) => !existingIds.has(e.id));
        imported = newIncoming.length;
        skippedDuplicates = incomingEvents.length - newIncoming.length;
        finalEvents = mergeEventsBySeq(existingEvents, newIncoming);
      }

      await this.eventsRepository.replaceStream(characterId, finalEvents);
      await this.snapshotsRepository.remove(characterId);

      const replayed = await this.eventsRepository.byStream(characterId);
      const facts = reduce(replayed);
      await this.charactersRepository.upsertFromFacts(characterId, facts);

      // `reloadIfCurrent`, NOT `load` — calling the public `load()` here (which itself calls
      // `enqueue`) would deadlock: we are already running INSIDE this store's queue (see
      // `reloadIfCurrent`'s own doc on `CharacterStore`).
      await this.characterStore.reloadIfCurrent(characterId);

      return { characterId, name: facts.name, mode, imported, skippedDuplicates, warnings };
    });
  }

  // --- validation ------------------------------------------------------------------------------

  private parseManifest(json: string): HeroBundleManifest {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new HeroImportBadManifestError([
        { path: 'manifest.json', message: 'manifest.json is not valid JSON' },
      ]);
    }
    const result = parseHeroManifest(raw);
    if (!result.ok) throw new HeroImportBadManifestError(result.issues);
    return result.manifest;
  }

  private parseEvents(json: string): Event[] {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new HeroImportBadManifestError([
        { path: 'events.json', message: 'events.json is not valid JSON' },
      ]);
    }
    if (!Array.isArray(raw)) {
      throw new HeroImportBadManifestError([
        { path: 'events.json', message: 'events.json must be an array' },
      ]);
    }
    return raw.map((entry, index) => {
      const result = parseEvent(entry);
      if (!result.ok) throw new HeroImportBadEventError(index, result.issues);
      return result.event;
    });
  }

  /** Pins the imported character will not find (Global Constraints: "pins informational; core-pack
   * version mismatch → warning entry, proceed"): a core-pack version mismatch, plus (plan 15 Task
   * 6) every non-core pin whose exact `id@version` the bundle does NOT carry and this device does
   * not have installed — a carried pack is installed by this import, so it is never warned about.
   * Nothing is compared before `PackStore` has loaded the core. */
  private pinWarnings(manifest: HeroBundleManifest): string[] {
    const core = this.packStore.corePack();
    if (!core) return [];
    const warnings: string[] = [];
    const pinned = manifest.pins[core.id];
    if (pinned !== undefined && pinned !== core.version) {
      warnings.push(
        `core pack version mismatch: bundle pins ${core.id}@${pinned}, this device has ${core.version} installed`,
      );
    }
    const carried = new Set((manifest.packs ?? []).map((row) => `${row.id}@${row.version}`));
    const installed = new Set(this.packStore.packs().map((p) => `${p.id}@${p.version}`));
    for (const id of Object.keys(manifest.pins).sort()) {
      if (id === core.id) continue;
      const key = `${id}@${manifest.pins[id]}`;
      if (carried.has(key) || installed.has(key)) continue;
      warnings.push(
        `pack not available: bundle pins ${key}, which it does not carry and this device does not have installed`,
      );
    }
    return warnings;
  }

  /**
   * Validates every content pack the bundle carries (`manifest.packs[]`, plan 15 ruling 9) with the
   * `.hkpack` importer's own safety checks — silently, no trust dialog — and stores NOTHING:
   *
   * 1. per row: no duplicate `id@version`; `path` is exactly `packs/<id>@<version>.json`; the entry
   *    exists and is ≤ `PACK_LIMITS.maxBytes`
   *    (checked before hashing); its sha256 equals the row's (`HeroImportHashMismatchError`);
   *    `parsePack` strict, kind `content`, and the `id@version` the row names — else
   *    `HeroImportBadPackError`;
   * 2. conflicts (`HeroImportPackConflictError`): the core pack's id, or the same `id@version`
   *    installed with a different canonical JSON (an identical one is simply not re-installed);
   * 3. `validatePack(pack, [core, ...installed content, ...the bundle's packs])` errors → bad-pack
   *    with the diagnostics;
   * 4. assets: `verifyPackAssets` (present, ≤ declared size and the cap, magic bytes, sha256).
   */
  private async readBundlePacks(
    zip: Record<string, Uint8Array>,
    oversized: ReadonlySet<string>,
    manifest: HeroBundleManifest,
    strFromU8: (bytes: Uint8Array) => string,
  ): Promise<BundlePack[]> {
    const rows = manifest.packs ?? [];
    if (rows.length === 0) return [];
    const all = this.packStore.packs();
    const core = all.find((p) => p.kind === 'core');
    if (!core) throw new Error('HeroReaderService: PackStore.init() has not loaded the core pack');

    const parsed: Pack[] = [];
    const keys = new Set<string>();
    for (const row of rows) {
      const key = `${row.id}@${row.version}`;
      if (keys.has(key)) throw new HeroImportBadPackError(key, ['manifest.packs lists it twice']);
      keys.add(key);
      // Stricter than "the entry exists": a carried pack lives at exactly the writer's path, so a
      // hand-edited row cannot point at `events.json`, an image, or an entry outside `packs/` (the
      // directory whose size the unzip filter capped).
      if (row.path !== heroPackPath(row.id, row.version)) {
        throw new HeroImportBadPackError(key, [
          `${row.path} is not ${heroPackPath(row.id, row.version)}`,
        ]);
      }
      if (oversized.has(row.path)) {
        throw new HeroImportBadPackError(key, [
          `${row.path} exceeds ${PACK_LIMITS.maxBytes} bytes`,
        ]);
      }
      const bytes = zip[row.path];
      if (!bytes) throw new HeroImportBadPackError(key, [`${row.path} is not in the bundle`]);
      if (bytes.byteLength > PACK_LIMITS.maxBytes) {
        throw new HeroImportBadPackError(key, [
          `${row.path} exceeds ${PACK_LIMITS.maxBytes} bytes`,
        ]);
      }
      if ((await sha256Hex(bytes)) !== row.sha256) {
        throw new HeroImportHashMismatchError(row.sha256, 'Pack');
      }
      const pack = parseBundlePack(key, strFromU8(bytes));
      if (pack.id !== row.id || pack.version !== row.version) {
        throw new HeroImportBadPackError(key, [
          `${row.path} holds ${pack.id}@${pack.version}, not ${key}`,
        ]);
      }
      parsed.push(pack);
    }

    for (const pack of parsed) this.checkConflict(pack);

    const installedContent = all.filter((p) => p.kind === 'content' && !keys.has(packKey(p)));
    const available = [core, ...installedContent, ...parsed];
    const out: BundlePack[] = [];
    for (const pack of parsed) {
      const key = packKey(pack);
      const errors = validatePack(pack, available).filter((d) => d.severity === 'error');
      if (errors.length > 0) {
        throw new HeroImportBadPackError(
          key,
          errors.map((d) => `${d.code}: ${d.message}`),
          errors,
        );
      }
      let assets: Map<string, PackImportAsset>;
      try {
        assets = await verifyPackAssets(pack, zip, oversized);
      } catch (error) {
        if (error instanceof PackImportAssetHashMismatchError) {
          throw new HeroImportHashMismatchError(error.hash, 'Pack asset');
        }
        if (error instanceof PackImportError) {
          throw new HeroImportBadPackError(key, [error.message]);
        }
        throw error;
      }
      out.push({ pack, assets });
    }
    return out;
  }

  /** Throws `HeroImportPackConflictError` when `pack` reuses the core id or a DIFFERENT pack is
   * installed under its exact `id@version`; returns whether an identical one is installed. */
  private checkConflict(pack: Pack): boolean {
    const key = packKey(pack);
    const all = this.packStore.packs();
    if (all.some((p) => p.kind === 'core' && p.id === pack.id)) {
      throw new HeroImportPackConflictError(key);
    }
    const existing = all.find((p) => p.kind !== 'core' && packKey(p) === key);
    if (existing && canonicalJson(existing) !== canonicalJson(pack)) {
      throw new HeroImportPackConflictError(key);
    }
    return existing !== undefined;
  }

  /** Installs the carried packs not already installed, through the same store write a `.hkpack`
   * import uses. The conflict check is repeated first — a pack could have been installed from the
   * Packs screen while this import was validating — so nothing is written on a late conflict. */
  private async installBundlePacks(bundlePacks: readonly BundlePack[]): Promise<void> {
    // Every check runs before the first write (`filter` completes first), and reflects the store
    // as it is NOW rather than as it was during validation.
    const pending = bundlePacks.filter((bp) => !this.checkConflict(bp.pack));
    for (const bp of pending) await this.packStore.installContent(bp.pack, bp.assets);
  }

  /** Verifies every declared image's bytes actually hash to what the manifest claims (Global
   * Constraints' export section: "hash-verify on import" — a mismatch is a typed error, not a
   * warning: it means the bundle is corrupted or tampered with). An image the manifest declares
   * but whose zip entry is missing is best-effort skipped with a warning instead — mirroring
   * `HeroWriterService`'s own best-effort export (a bundle built against partial local storage
   * still exports everything it CAN find; the reader extends that same tolerance to partial
   * bundles on the way back in). */
  private async readAndVerifyImages(
    zip: Record<string, Uint8Array>,
    manifest: HeroBundleManifest,
    warnings: string[],
  ): Promise<ResolvedIncomingImage[]> {
    const resolved: ResolvedIncomingImage[] = [];
    for (const image of manifest.images) {
      // Fix-wave review, Important/merge-blocker finding 1: defense in depth alongside the
      // narrowed `HeroBundleImageSchema.mime` (`@hk/protocol`) — `parseHeroManifest` already
      // rejects a non-webp/jpeg/png mime before `manifest` ever reaches here, so this only ever
      // fires if a `HeroBundleManifest` reaches this method some other way (a future refactor, a
      // manifest object hand-built rather than parsed). Reuses the schema's own field validator
      // rather than a second copy of the allowed-mime list.
      if (!HeroBundleImageSchema.shape.mime.safeParse(image.mime).success) {
        throw new HeroImportBadManifestError([
          { path: 'images.mime', message: `Unsupported stored image mime: ${image.mime}` },
        ]);
      }
      const path = `images/${hexOfHash(image.hash)}.${extensionForMime(image.mime)}`;
      const bytes = zip[path];
      if (!bytes) {
        warnings.push(`missing image data for ${image.hash} (expected ${path})`);
        continue;
      }
      // Fix-wave review, minor finding 2: checked BEFORE hashing — an over-cap image is rejected
      // on its cheap byte-length alone, so a hostile bundle can't force this method to SHA-256 an
      // arbitrarily large blob just to get rejected a moment later. `IMAGE_BYTE_CAPS`
      // (`@shared/services/images/image-pipeline.service`) is the SAME cap the upload pipeline
      // enforces — an import bypasses that pipeline entirely (a `.hero` bundle ships
      // already-encoded bytes), so nothing else on this path stops an oversized image otherwise.
      const cap = IMAGE_BYTE_CAPS[image.kind];
      if (bytes.byteLength > cap) {
        throw new HeroImportBadManifestError([
          {
            path: `images[${image.hash}].bytes`,
            message: `Image bytes for ${image.hash} (${bytes.byteLength} bytes) exceed the ${image.kind} cap of ${cap} bytes`,
          },
        ]);
      }
      const actualHash = await sha256Hex(bytes);
      if (actualHash !== image.hash) throw new HeroImportHashMismatchError(image.hash);
      resolved.push({ ...image, bytes });
    }
    return resolved;
  }

  /** Dedupe by hash (Global Constraints: "images de-duplicated by hash") — `hash` is
   * `BlobsRepository`'s primary key, so re-importing the same bundle a second time skips every
   * image it already stored rather than re-writing byte-identical rows. */
  private async storeImages(images: readonly ResolvedIncomingImage[]): Promise<void> {
    for (const image of images) {
      const existing = await this.blobsRepository.get(image.hash);
      if (existing) continue;
      await this.blobsRepository.put(image.hash, image.mime, image.bytes, { kind: image.kind });
    }
  }
}
