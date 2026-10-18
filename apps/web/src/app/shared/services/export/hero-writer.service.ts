import { inject, Injectable } from '@angular/core';
import { ENGINE_VERSION, reduce } from '@hk/engine';
import {
  HeroBundleImageSchema,
  parseHeroManifest,
  type HeroBundleImage,
  type HeroBundlePack,
} from '@hk/protocol';
import { APP_VERSION } from '@app/version';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { canonicalJson } from '@shared/services/packs/canonical-json';
import { packAssetEntry } from '@shared/services/packs/pack-assets';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { PackStore } from '@shared/stores/pack.store';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** doc-07 only ever stores webp/jpeg/png (`ImagePipelineService`'s "Safety" note) — the fallback
 * below only matters for a hand-edited/future blob row this writer doesn't otherwise expect.
 * Exported: `HeroReaderService` (Task 10) needs the SAME `images/<hash-hex>.<ext>` naming scheme
 * to locate an entry it must read back out of an imported zip — one mapping, not two copies that
 * could drift apart. */
export function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime] ?? mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
}

/** Exported for the same reason as `extensionForMime` — see its own doc comment. */
export function hexOfHash(hash: string): string {
  return hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash;
}

// Windows- and POSIX-unsafe path characters; a trailing dot/space is also stripped afterward
// (Windows rejects a path segment ending in either).
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/** `<name>.hero`'s `<name>` half (design ruling 5) — strips characters that are unsafe in a
 * filename on every target OS; an empty (or entirely-unsafe) result falls back to `'character'`
 * per task-9-brief.md's own resolution (a localized default isn't trivially available from a
 * plain, DI-free helper, so this stays framework-agnostic and unit-testable on its own). */
export function sanitizeHeroFileName(name: string): string {
  const cleaned = name
    .replace(UNSAFE_FILENAME_CHARS, '')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned.length > 0 ? cleaned : 'character';
}

/** Where a carried content pack lives inside a `.hero` zip (plan 15 ruling 9) — the writer names
 * entries with it; the reader looks entries up by the manifest row's own `path`. */
export function heroPackPath(id: string, version: string): string {
  return `packs/${id}@${version}.json`;
}

export interface HeroBundleResult {
  readonly blob: Blob;
  readonly fileName: string;
}

type ResolvedImage = HeroBundleImage & { readonly bytes: Uint8Array };

interface ResolvedPack {
  readonly row: HeroBundlePack;
  readonly json: Uint8Array;
  readonly assets: readonly { readonly hash: string; readonly bytes: Uint8Array }[];
}

/**
 * Builds a `.hero` export bundle (Global Constraints, plan-6 Task 9 — BINDING format): a ZIP of
 * `manifest.json` (`HeroBundleManifestSchema`, `@hk/protocol`), `events.json` (the FULL ordered
 * committed event array, `parseEvent`-valid), and `images/<hash-hex>.<ext>` for every blob the
 * writer can resolve. `export()` only ever BUILDS the bundle — delivering it (save picker / share /
 * download fallback, design ruling 5) is the sheet shell's own job via the sibling delivery helper.
 *
 * Scope cut (task-9-brief.md's own resolution, documented here): TOKENS ARE NEVER EXPORTED.
 * `facts.portrait` only ever carries `{hash, thumbHash}` (design ruling 4 — the `portrait.set`
 * payload has no token field at all), so those are the only two blob hashes this writer can even
 * discover; a token blob regenerates on import-side upload instead — and per
 * `ImagePipelineService`'s own class doc, `tokenHash` is always identical to `thumbHash` today
 * anyway, so nothing is actually lost by leaving it out.
 *
 * Plan 15 (ruling 9): every NON-core pin whose exact `id@version` is installed here travels with
 * the character — `packs/<id>@<version>.json` (the pack's canonical JSON), each of its assets under
 * `assets/<hash-hex>`, and a manifest `packs[]` row whose `sha256` hashes those exact JSON bytes.
 * A pinned pack that is not installed (or whose asset blobs are not all present locally) is left
 * out — the importer then warns about that pin, as it always did. A core-only character's bundle
 * has no `packs` key at all, so it is byte-for-byte the pre-plan-15 format.
 *
 * `fflate` is imported LAZILY (`await import('fflate')`) inside `export()`, so it lands in its own
 * lazy chunk rather than the initial bundle — this service is the only thing that ever pulls it in.
 */
@Injectable({ providedIn: 'root' })
export class HeroWriterService {
  private readonly eventsRepository = inject(EventsRepository);
  private readonly blobsRepository = inject(BlobsRepository);
  private readonly packStore = inject(PackStore);

  async export(characterId: string): Promise<HeroBundleResult> {
    const events = await this.eventsRepository.byStream(characterId);
    const facts = reduce(events);
    const images = await this.resolveImages(facts.portrait);
    const packs = await this.resolvePacks(facts.pins);

    const manifest = {
      format: 1 as const,
      kind: 'hero' as const,
      characterId,
      name: facts.name,
      exportedAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      appVersion: APP_VERSION,
      pins: facts.pins,
      eventCount: events.length,
      images: images.map(({ hash, mime, size, kind }): HeroBundleImage => ({
        hash,
        mime,
        size,
        kind,
      })),
      // Omitted (not `[]`) when nothing is carried: a core-only bundle stays the pre-plan-15 shape.
      ...(packs.length > 0 ? { packs: packs.map((pack) => pack.row) } : {}),
    };
    const validated = parseHeroManifest(manifest);
    if (!validated.ok) {
      const issues = validated.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
      throw new Error(`HeroWriterService.export: built an invalid manifest — ${issues}`);
    }

    const { strToU8, zipSync } = await import('fflate');
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(JSON.stringify(validated.manifest, null, 2) + '\n'),
      'events.json': strToU8(JSON.stringify(events)),
    };
    for (const image of images) {
      files[`images/${hexOfHash(image.hash)}.${extensionForMime(image.mime)}`] = image.bytes;
    }
    for (const pack of packs) {
      files[pack.row.path] = pack.json;
      // Pack assets use the `.hkpack` entry name (`assets/<hash-hex>`, no extension); a hash shared
      // by two carried packs is written once. Portrait images live under `images/`, a separate
      // namespace, so a hash that is both an image and a pack asset appears in both.
      for (const asset of pack.assets) files[packAssetEntry(asset.hash)] ??= asset.bytes;
    }
    const zipped = zipSync(files);
    const blob = new Blob([zipped], { type: 'application/zip' });

    return { blob, fileName: `${sanitizeHeroFileName(facts.name)}.hero` };
  }

  /**
   * The character's non-core pins (sorted by id) whose exact `id@version` is an installed content
   * pack AND whose every asset blob is present locally — anything less would build a bundle the
   * importer must refuse, so such a pack is left out (its pin then surfaces as an importer warning,
   * exactly like a pack that is not installed at all).
   */
  private async resolvePacks(pins: Readonly<Record<string, string>>): Promise<ResolvedPack[]> {
    // Read through `packs()` (core + content + translations) only, like `EngineFacade.indexFor`, so
    // every existing `PackStore` test double keeps working.
    const all = this.packStore.packs();
    const coreId = all.find((p) => p.kind === 'core')?.id;
    const installed = all.filter((p) => p.kind === 'content');
    const resolved: ResolvedPack[] = [];
    for (const id of Object.keys(pins).sort()) {
      if (id === coreId) continue;
      const version = pins[id];
      const pack = installed.find((p) => p.id === id && p.version === version);
      if (!pack) continue;
      const assets: { hash: string; bytes: Uint8Array }[] = [];
      for (const asset of pack.assets) {
        const row = await this.blobsRepository.get(asset.hash);
        if (!row) break;
        assets.push({ hash: asset.hash, bytes: row.bytes });
      }
      if (assets.length !== pack.assets.length) continue;
      const json = new TextEncoder().encode(canonicalJson(pack));
      const path = heroPackPath(id, version);
      resolved.push({ row: { id, version, path, sha256: await sha256Hex(json) }, json, assets });
    }
    return resolved;
  }

  /**
   * Resolves the (at most two) blob hashes `facts.portrait` can reference — `hash` (the full
   * portrait) and `thumbHash` — to their stored `BlobsRepository` rows. A hash with no local row is
   * silently SKIPPED, not an error: a bundle built against partial/corrupted local storage still
   * exports everything it CAN find rather than failing the whole export outright.
   */
  private async resolveImages(
    portrait: { hash: string; thumbHash: string } | undefined,
  ): Promise<ResolvedImage[]> {
    if (!portrait) return [];
    const kindByHash = new Map<string, HeroBundleImage['kind']>([
      [portrait.hash, 'portrait'],
      [portrait.thumbHash, 'thumb'],
    ]);
    const rows = await Promise.all(
      [...kindByHash.keys()].map((hash) => this.blobsRepository.get(hash)),
    );

    const resolved: ResolvedImage[] = [];
    for (const row of rows) {
      if (!row) continue;
      // Fix-wave review, Important/merge-blocker finding 1: `BlobRow.mime` is stored as a plain
      // `string` (`BlobsRepository`/`dexie.db.ts`), but `HeroBundleImage.mime` is now narrowed to
      // the exact set doc-07 ever stores (`@hk/protocol`'s `HeroBundleImageSchema`) — re-validated
      // here, reusing that same schema field rather than a second copy of the allowed list. A row
      // whose mime somehow isn't one of those (corrupted/legacy local data — nothing on today's
      // write path can actually produce this) is SKIPPED, same tolerance this method already
      // documents for a hash with no local row at all, rather than failing the whole export.
      const mime = HeroBundleImageSchema.shape.mime.safeParse(row.mime);
      if (!mime.success) continue;
      // Plan-10 Task 2 widened `BlobRow.kind` to include `icon`/`banner` (doc-07's full set),
      // but this method only ever resolves the two portrait-related hashes above, so a stored
      // `icon`/`banner` kind here would only ever mean corrupted/legacy local data — treated the
      // same as "no kind stored" (fall through to the positional guess from `kindByHash`) rather
      // than widening `HeroBundleImage`'s own schema (bundles never carry icon/banner images).
      const storedKind = row.kind === 'icon' || row.kind === 'banner' ? undefined : row.kind;
      const kind = storedKind ?? kindByHash.get(row.hash) ?? 'portrait';
      resolved.push({ hash: row.hash, mime: mime.data, size: row.size, kind, bytes: row.bytes });
    }
    return resolved;
  }
}
