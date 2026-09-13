import { z } from 'zod';
import { UUID } from '../events/envelope.ts';
import type { PackIssue } from '../pack/pack.ts';
import { PackIdSchema } from '../ids.ts';
import { BlobHashSchema, SemverSchema } from '../pack/common.ts';
import { ShortTextSchema } from '../pack/enums.ts';

/**
 * `.hero` export bundle (Global Constraints, plan-6 Task 9, BINDING): a ZIP containing this
 * `manifest.json`, a full `events.json` (the character stream's committed events, `parseEvent`-
 * valid), and `images/<hash-hex>.<ext>` for every referenced blob. `HeroBundleManifestSchema` is
 * the schema for `manifest.json` ITSELF — `events.json`'s own entries are validated one-by-one
 * through the existing `parseEvent` (`events/index.ts`), not through anything in this file.
 */

/** `char:<uuid>` — the same shape `EventEnvelopeSchema`'s `StreamIdSchema` (`events/envelope.ts`)
 * accepts, narrowed to the `char:` prefix only: a `.hero` bundle is always exactly one CHARACTER
 * stream, never a campaign stream. */
const HERO_CHARACTER_ID_RE = new RegExp(`^char:${UUID.source.slice(1, -1)}$`, 'i');
export const HeroCharacterIdSchema = z.string().regex(HERO_CHARACTER_ID_RE);

/** Mirrors `EventEnvelopeSchema`'s own `ts` field regex (`events/envelope.ts`): an ISO-8601 UTC
 * instant with up to 3 fractional-second digits — the exact shape `Date#toISOString()` produces. */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** One `images/` entry — a blob the manifest's `characterId` stream actually references (today:
 * the portrait's full-size and thumb blobs; `token` is listed for forward-compatibility — see
 * `doc-07`/design ruling 4 — but the writer never emits one today, since the token hash is always
 * identical to the thumb's, per `ImagePipelineService`'s own class doc). */
export const HeroBundleImageSchema = z.strictObject({
  hash: BlobHashSchema,
  mime: z.string().min(1).max(64),
  size: z.int().min(0),
  kind: z.enum(['portrait', 'thumb', 'token']),
});
export type HeroBundleImage = z.infer<typeof HeroBundleImageSchema>;

export const HeroBundleManifestSchema = z.strictObject({
  format: z.literal(1),
  kind: z.literal('hero'),
  characterId: HeroCharacterIdSchema,
  name: ShortTextSchema,
  exportedAt: z.string().regex(ISO_TIMESTAMP_RE),
  engineVersion: SemverSchema,
  appVersion: SemverSchema,
  pins: z.record(PackIdSchema, SemverSchema),
  eventCount: z.int().min(0),
  images: z.array(HeroBundleImageSchema),
});
export type HeroBundleManifest = z.infer<typeof HeroBundleManifestSchema>;

export type ParseHeroManifestResult = { ok: true; manifest: HeroBundleManifest } | { ok: false; issues: PackIssue[] };

/** Mirrors `parseEvent`'s (`events/index.ts`) result shape exactly. */
export function parseHeroManifest(value: unknown): ParseHeroManifestResult {
  const result = HeroBundleManifestSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((i) => ({
        path: i.path.map(String).join('.') || '(root)',
        message: i.message,
      })),
    };
  }
  return { ok: true, manifest: result.data };
}
