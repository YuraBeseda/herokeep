import { inject, Injectable } from '@angular/core';
import { reduce } from '@hk/engine';
import {
  HeroBundleImageSchema,
  parseEvent,
  parseHeroManifest,
  type Event,
  type HeroBundleImage,
  type HeroBundleManifest,
  type PackIssue,
} from '@hk/protocol';
import { IMAGE_BYTE_CAPS, sha256Hex } from '@shared/services/images/image-pipeline.service';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { LeaderService } from '@shared/services/storage/leader.service';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { extensionForMime, hexOfHash } from './hero-writer.service';

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

/** An `images/<hash-hex>.<ext>` entry's actual bytes don't hash to the `hash` its manifest entry
 * declares (Global Constraints' export section: "hash-verify on import"). A corrupted/tampered
 * bundle is refused outright rather than silently storing mismatched image data under a hash that
 * no longer describes it. */
export class HeroImportHashMismatchError extends Error {
  readonly code = 'characters.list.toast.import-failed-hash-mismatch';
  constructor(readonly hash: string) {
    super(`Image bytes for ${hash} do not match the manifest's declared hash.`);
    this.name = 'HeroImportHashMismatchError';
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

    let zip: Record<string, Uint8Array>;
    try {
      zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
    } catch (cause) {
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

  /** Core-pack version mismatch (Global Constraints: "pins informational; core-pack version
   * mismatch → warning entry, proceed" — packs themselves are NEVER imported in 1b). A `pins`
   * entry for a pack this device doesn't even have installed isn't checked here at all — only the
   * installed CORE pack's own version is compared, per the binding text. */
  private pinWarnings(manifest: HeroBundleManifest): string[] {
    const core = this.packStore.corePack();
    if (!core) return [];
    const pinned = manifest.pins[core.id];
    if (pinned === undefined || pinned === core.version) return [];
    return [
      `core pack version mismatch: bundle pins ${core.id}@${pinned}, this device has ${core.version} installed`,
    ];
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
