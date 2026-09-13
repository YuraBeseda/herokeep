import { inject, Injectable } from '@angular/core';
import { ENGINE_VERSION, reduce } from '@hk/engine';
import { parseHeroManifest, type HeroBundleImage } from '@hk/protocol';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';

/**
 * Mirrors `about.component.ts`'s own `APP_VERSION` constant/rationale: `apps/web/package.json`'s
 * `version` field is still the Angular CLI scaffold default ("0.0.0") and isn't wired to any
 * release process, so it isn't a reliable source — this is the one to bump alongside that
 * component's copy when a real release process lands.
 */
const APP_VERSION = '0.1.0';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** doc-07 only ever stores webp/jpeg/png (`ImagePipelineService`'s "Safety" note) — the fallback
 * below only matters for a hand-edited/future blob row this writer doesn't otherwise expect. */
function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime] ?? mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
}

function hexOfHash(hash: string): string {
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

export interface HeroBundleResult {
  readonly blob: Blob;
  readonly fileName: string;
}

type ResolvedImage = HeroBundleImage & { readonly bytes: Uint8Array };

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
 * `fflate` is imported LAZILY (`await import('fflate')`) inside `export()`, so it lands in its own
 * lazy chunk rather than the initial bundle — this service is the only thing that ever pulls it in.
 */
@Injectable({ providedIn: 'root' })
export class HeroWriterService {
  private readonly eventsRepository = inject(EventsRepository);
  private readonly blobsRepository = inject(BlobsRepository);

  async export(characterId: string): Promise<HeroBundleResult> {
    const events = await this.eventsRepository.byStream(characterId);
    const facts = reduce(events);
    const images = await this.resolveImages(facts.portrait);

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
    const zipped = zipSync(files);
    const blob = new Blob([zipped], { type: 'application/zip' });

    return { blob, fileName: `${sanitizeHeroFileName(facts.name)}.hero` };
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
      const kind = row.kind ?? kindByHash.get(row.hash) ?? 'portrait';
      resolved.push({ hash: row.hash, mime: row.mime, size: row.size, kind, bytes: row.bytes });
    }
    return resolved;
  }
}
