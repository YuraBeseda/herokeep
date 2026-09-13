import { inject, Injectable, InjectionToken } from '@angular/core';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import type { BlobRow } from '@shared/services/storage/dexie.db';

/**
 * doc-07 "Upload pipeline" steps 1-6 (`docs/02-architecture/07-images-and-blobs.md`), scoped to
 * this task's ONE consumer: a character's portrait. Icon/banner kinds are out of scope here (no
 * caller exists yet).
 *
 * jsdom (this app's unit-test environment) has neither `createImageBitmap` nor a real
 * `HTMLCanvasElement`/`OffscreenCanvas` 2D context — see this repo's task-8-brief.md. Rather than
 * skip unit coverage of the actual PIPELINE DECISIONS (which quality rung to try next, when to
 * shrink dimensions, which mime to pick, when to give up), this file draws an EXPLICIT seam
 * between:
 *
 * 1. The browser-only pixel work (decode a `File` into drawable pixels; encode drawable pixels at
 *    a given size/quality/mime into bytes) — `ImageCodec`, injected via `IMAGE_CODEC`. The real
 *    implementation, `BrowserImageCodec`, is exercised by the e2e suite (Task 12) against a real
 *    PNG fixture in an actual browser; a spec swaps in a fake `ImageCodec` that never touches
 *    Canvas/createImageBitmap at all.
 * 2. The PURE retry/decision logic — `chooseMime`, `fitPortraitDimensions`, `encodeWithinCap` —
 *    which only ever calls the `EncodeFn` it's given and inspects the returned byte length. These
 *    are plain exported functions, directly unit-testable with a synthetic `EncodeFn` and zero
 *    Angular/DI machinery.
 *
 * `ImagePipelineService.processPortrait` is the glue: it asks the injected `ImageCodec` to decode
 * once, then drives `encodeWithinCap` TWICE (the portrait box, then the thumb box) against an
 * `EncodeFn` closure over that one decode, hashes each result, and writes two tagged
 * `BlobsRepository.put()` rows — `tokenHash` is derived from the thumb's own hash rather than a
 * third encode/store (fix-round 1 finding 2; see `processPortrait`'s own class doc for why).
 */

// --- Caps & ladder (doc-07 "Caps (ADR-010)" + Global Constraints — binding, verbatim) ----------

export type PortraitBlobKind = 'portrait' | 'thumb' | 'token';

/** Portrait: 1024px long edge. Thumb & token: 256x256 (a square "cover" crop — see
 * `BrowserImageCodec.encode`'s doc for why the SAME cover-fit draw works for both the portrait box
 * (already source-aspect, so cover == an exact scale, no crop) and the fixed-square thumb/token
 * box (which does crop the source's longer axis). */
export const PORTRAIT_LONG_EDGE = 1024;
export const THUMB_TOKEN_SIZE = 256;

/** Exported (fix-wave review, minor finding 2): `HeroReaderService.readAndVerifyImages`
 * (`apps/web/.../export/hero-reader.service.ts`) enforces these SAME caps on an imported bundle's
 * image bytes — imports never go through `encodeWithinCap` above (a `.hero` bundle ships
 * already-encoded bytes, not a raw upload to re-pipeline), so nothing on that path would otherwise
 * stop an oversized image from being written to storage. One export, so the two enforcement sites
 * can never drift apart. */
export const IMAGE_BYTE_CAPS: Record<PortraitBlobKind, number> = {
  portrait: 400 * 1024,
  thumb: 64 * 1024,
  token: 64 * 1024,
};

/** doc-07 step 4: "Quality ladder 0.85 → 0.7 → 0.55 ... if still over, reduce dimensions by 0.8
 * and retry (max 3 times); else reject." */
const QUALITY_LADDER: readonly number[] = [0.85, 0.7, 0.55];
const MAX_DIMENSION_RETRIES = 3;
const DIMENSION_SCALE = 0.8;

/** doc-07 step 1: "size guard 25 MB before decoding." */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** doc-07 "Safety": only webp/jpeg/png are ever STORED, but the pipeline also refuses to even
 * ATTEMPT decoding a few input mime types doc-07 explicitly calls out: SVG ("script risk" — the
 * bundled icon set is the app's only sanctioned SVG source, compiled at build time, never a user
 * upload) and HEIC/HEIF (step 1: the file input's `accept="image/*"` deliberately does NOT list
 * `image/heic` so iOS's own picker transcodes to JPEG before this code ever sees the file; a HEIC
 * byte stream that slips through anyway — a non-iOS browser, a manually renamed file — has no
 * reliable decode support across target browsers, so it's rejected here rather than silently
 * failing deeper in the pipeline). */
const REJECTED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/svg+xml',
  'image/heic',
  'image/heif',
]);

/** Mime types whose format CAN carry an alpha channel — used only to pick jpeg-vs-png when webp
 * encoding isn't available (`chooseMime`). Reading the SOURCE file's own declared type is a
 * conservative proxy for "does the actual pixel data have transparency" (a PNG with no
 * transparent pixels still routes to PNG output instead of JPEG) — doc-07 doesn't call for exact
 * per-pixel alpha detection, and a false "has alpha" only ever costs a slightly larger file, never
 * a correctness bug (JPEG can never encode a real alpha channel, so under-detecting would be the
 * dangerous direction). */
const ALPHA_CAPABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/webp',
  'image/gif',
]);

// --- Errors ---------------------------------------------------------------------------------

/** `image.too-large` (Global Constraints, verbatim code) — thrown by `encodeWithinCap` once the
 * quality ladder AND all 3 dimension retries are exhausted, and by `processPortrait` for the
 * pre-decode 25 MB upload guard (the same user-facing "too large" outcome, one i18n key). */
export class ImageTooLargeError extends Error {
  readonly code = 'image.too-large';
  constructor() {
    super('Image could not be reduced under its size cap.');
    this.name = 'ImageTooLargeError';
  }
}

/** A rejected input mime (SVG/HEIC/HEIF, or anything not `image/*` at all) — doc-07 "Safety". */
export class ImageInvalidTypeError extends Error {
  readonly code = 'image.invalid-type';
  constructor(readonly mime: string) {
    super(`Unsupported image type: ${mime}`);
    this.name = 'ImageInvalidTypeError';
  }
}

// --- Pure helpers (unit-tested directly, no Angular/DI) ---------------------------------------

/** doc-07 step 4: try webp first (behind the one-time probe result the caller already resolved);
 * otherwise jpeg for an opaque source, png for one that can carry alpha. */
export function chooseMime(hasAlpha: boolean, supportsWebp: boolean): string {
  if (supportsWebp) return 'image/webp';
  return hasAlpha ? 'image/png' : 'image/jpeg';
}

/** doc-07 "portrait 1024 long edge": scales `(width, height)` down so its longer side is at most
 * `PORTRAIT_LONG_EDGE`, preserving aspect ratio; a source already within the cap is returned
 * unchanged (this pipeline never upscales). */
export function fitPortraitDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= PORTRAIT_LONG_EDGE) return { width, height };
  const scale = PORTRAIT_LONG_EDGE / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function assertAcceptableFile(file: { readonly type: string; readonly size: number }): void {
  if (file.size > MAX_UPLOAD_BYTES) throw new ImageTooLargeError();
  if (!file.type.startsWith('image/') || REJECTED_MIME_TYPES.has(file.type)) {
    throw new ImageInvalidTypeError(file.type);
  }
}

export function detectHasAlpha(file: { readonly type: string }): boolean {
  return ALPHA_CAPABLE_MIME_TYPES.has(file.type);
}

export interface EncodedImage {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** The ONE seam `encodeWithinCap` calls — real callers close over a decoded source and an
 * `ImageCodec.encode`; specs pass a synthetic function that never touches Canvas at all. */
export type EncodeFn = (
  mime: string,
  quality: number,
  width: number,
  height: number,
) => Promise<EncodedImage>;

/**
 * doc-07 step 4's full retry sequence, as PURE control flow over the injected `encode`: at the
 * given `(width, height)`, try each `QUALITY_LADDER` rung in order; the first result at or under
 * `kind`'s byte cap wins. If every rung at this size is still over cap, shrink both dimensions by
 * `DIMENSION_SCALE` (0.8x) and repeat — up to `MAX_DIMENSION_RETRIES` (3) shrink rounds AFTER the
 * original size, i.e. 4 total size rounds x 3 quality rungs = at most 12 `encode()` calls — before
 * throwing `ImageTooLargeError`.
 */
export async function encodeWithinCap(
  kind: PortraitBlobKind,
  mime: string,
  width: number,
  height: number,
  encode: EncodeFn,
): Promise<EncodedImage & { width: number; height: number }> {
  const cap = IMAGE_BYTE_CAPS[kind];
  let w = width;
  let h = height;
  for (let round = 0; round <= MAX_DIMENSION_RETRIES; round++) {
    for (const quality of QUALITY_LADDER) {
      const result = await encode(mime, quality, w, h);
      if (result.bytes.byteLength <= cap) return { ...result, width: w, height: h };
    }
    w = Math.round(w * DIMENSION_SCALE);
    h = Math.round(h * DIMENSION_SCALE);
  }
  throw new ImageTooLargeError();
}

/** `crypto.subtle.digest` (Global Constraints: "sha-256 hash") formatted to match
 * `@hk/protocol`'s `BlobHashSchema` (`/^sha256:[0-9a-f]{64}$/`). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `bytes.buffer` could be a larger, shared ArrayBuffer when `bytes` is a subarray view (not the
  // case anywhere in this file today, but a defensive slice keeps this correct if that ever
  // changes) — `digest` hashes exactly the view's own bytes either way via `bytes` itself.
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

// --- Browser codec seam (the "injectable/parameterized encode-decode seam") -------------------

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
  /** Opaque draw source for `encode()` — the real implementation passes an `ImageBitmap` or
   * `HTMLImageElement`; pure/test code never inspects this field. */
  readonly source: unknown;
}

// Property-typed (arrow-function-shaped) members rather than method-shorthand signatures —
// deliberately, so a spec's `vi.fn()`-backed fake object satisfies this interface AND referencing
// one of its members as a bare value (`expect(codec.decode).not.toHaveBeenCalled()`) never trips
// `@typescript-eslint/unbound-method` (that rule only fires on method-shorthand-typed members,
// where losing the original `this` binding would be a real hazard — irrelevant here since neither
// a real implementation nor a test fake ever reads `this` off `ImageCodec`.
export interface ImageCodec {
  /** doc-07 step 2: `createImageBitmap(file, {imageOrientation: 'from-image'})`, falling back to
   * an `<img>` decode for browsers without the options overload. */
  readonly decode: (file: File) => Promise<DecodedImage>;
  /** doc-07 step 4: one-time 1x1 `image/webp` `toBlob` probe; the result SHOULD be cached by the
   * implementation (a fresh probe per call would defeat the point). */
  readonly supportsWebp: () => Promise<boolean>;
  /** doc-07 step 3+4: fits `decoded` to cover a `width`x`height` box (crop-to-cover — see this
   * file's class doc for why one cover-fit draw correctly serves both the portrait box, which
   * already preserves source aspect, and the fixed-square thumb/token box) and encodes at
   * `quality` in `mime`. */
  readonly encode: (
    decoded: DecodedImage,
    mime: string,
    quality: number,
    width: number,
    height: number,
  ) => Promise<EncodedImage>;
}

export const IMAGE_CODEC = new InjectionToken<ImageCodec>('IMAGE_CODEC', {
  providedIn: 'root',
  factory: () => new BrowserImageCodec(),
});

/** Real, Canvas/createImageBitmap-backed `ImageCodec` — NOT exercised by this file's own unit
 * specs (jsdom has neither API; see this file's class doc). Covered by Task 12's e2e against a
 * real PNG fixture in an actual browser. */
class BrowserImageCodec implements ImageCodec {
  private webpSupportPromise: Promise<boolean> | undefined;

  async decode(file: File): Promise<DecodedImage> {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return {
          width: bitmap.width,
          height: bitmap.height,
          hasAlpha: detectHasAlpha(file),
          source: bitmap,
        };
      } catch {
        // Fall through to the <img> fallback below (doc-07 step 2).
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('ImagePipelineService: <img> decode failed'));
        el.src = url;
      });
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        hasAlpha: detectHasAlpha(file),
        source: img,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  supportsWebp(): Promise<boolean> {
    this.webpSupportPromise ??= this.probeWebp();
    return this.webpSupportPromise;
  }

  private async probeWebp(): Promise<boolean> {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp'),
      );
      return blob !== null && blob.type === 'image/webp';
    } catch {
      return false;
    }
  }

  async encode(
    decoded: DecodedImage,
    mime: string,
    quality: number,
    width: number,
    height: number,
  ): Promise<EncodedImage> {
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas = hasOffscreen
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');
    if (!(hasOffscreen && canvas instanceof OffscreenCanvas)) {
      (canvas as HTMLCanvasElement).width = width;
      (canvas as HTMLCanvasElement).height = height;
    }
    const ctx = canvas.getContext('2d') as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('ImagePipelineService: 2D canvas context unavailable');

    // Cover-fit draw: scale so the source fills (and may overflow) the target box, then center-crop.
    const srcW = decoded.width;
    const srcH = decoded.height;
    const scale = Math.max(width / srcW, height / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const dx = (width - drawW) / 2;
    const dy = (height - drawH) / 2;
    ctx.drawImage(decoded.source as CanvasImageSource, dx, dy, drawW, drawH);

    const blob =
      'convertToBlob' in canvas
        ? await canvas.convertToBlob({ type: mime, quality })
        : await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('ImagePipelineService: toBlob failed'))),
              mime,
              quality,
            );
          });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { bytes, mime: blob.type || mime };
  }
}

// --- The service ------------------------------------------------------------------------------

export interface PortraitPipelineResult {
  readonly hash: string;
  readonly thumbHash: string;
  readonly tokenHash: string;
  readonly mime: string;
  readonly w: number;
  readonly h: number;
}

/**
 * doc-07's full upload pipeline for exactly one consumer: a character's portrait
 * (`processPortrait`). Decodes once (`ImageCodec.decode`), picks a mime once
 * (`chooseMime`/`detectHasAlpha`), then runs `encodeWithinCap` TWICE — the 1024-long-edge portrait
 * box, and the 256x256 thumb box. Hashes each encoded result (`sha256Hex`) and writes two tagged
 * `BlobsRepository.put()` rows.
 *
 * TOKEN, fix-round 1 finding 2: doc-07's token box (256x256 cover) and byte cap (64 KB) are
 * IDENTICAL to the thumb's, and both encode the SAME decoded source at the SAME quality ladder —
 * so a token would always hash byte-for-byte identical to the thumb. `BlobsRepository` is
 * content-addressed (keyed purely by `hash`), so storing a genuinely-identical-content "token"
 * blob under its own `put()` call would just silently overwrite the thumb row's `kind` field
 * (from `'thumb'` to `'token'`, whichever call lands last) for zero benefit, on top of repeating a
 * full 12-attempt encode ladder for bytes already in hand. So: `tokenHash` is simply
 * `thumbHash` — no second box, no second encode, no second blob row. Design ruling 4's "a token
 * blob IS generated and stored" and doc-07's own "Prefetch policy" table both already treat tokens
 * as re-derivable/interchangeable with the thumb crop at this fidelity; if token art ever needs to
 * DIVERGE from the thumb (a circular mask, a different crop), this is exactly the seam to split
 * back into its own `encodeWithinCap('token', ...)` call + its own `putBlob` — the exported
 * `PortraitBlobKind`/`CAP_BYTES` groundwork for that already exists, untouched, above.
 */
@Injectable({ providedIn: 'root' })
export class ImagePipelineService {
  private readonly codec = inject(IMAGE_CODEC);
  private readonly blobsRepository = inject(BlobsRepository);

  async processPortrait(file: File): Promise<PortraitPipelineResult> {
    assertAcceptableFile(file);

    const decoded = await this.codec.decode(file);
    const supportsWebp = await this.codec.supportsWebp();
    const mime = chooseMime(detectHasAlpha(file), supportsWebp);
    const encode: EncodeFn = (m, q, w, h) => this.codec.encode(decoded, m, q, w, h);

    const portraitBox = fitPortraitDimensions(decoded.width, decoded.height);
    const portrait = await encodeWithinCap(
      'portrait',
      mime,
      portraitBox.width,
      portraitBox.height,
      encode,
    );
    const thumb = await encodeWithinCap('thumb', mime, THUMB_TOKEN_SIZE, THUMB_TOKEN_SIZE, encode);

    const [hash, thumbHash] = await Promise.all([
      sha256Hex(portrait.bytes),
      sha256Hex(thumb.bytes),
    ]);

    await Promise.all([
      this.putBlob(hash, portrait, 'portrait'),
      this.putBlob(thumbHash, thumb, 'thumb'),
    ]);

    return {
      hash,
      thumbHash,
      tokenHash: thumbHash, // see class doc's TOKEN note
      mime: portrait.mime,
      w: portrait.width,
      h: portrait.height,
    };
  }

  private async putBlob(
    hash: string,
    encoded: EncodedImage & { width: number; height: number },
    kind: BlobRow['kind'],
  ): Promise<void> {
    await this.blobsRepository.put(hash, encoded.mime, encoded.bytes, {
      kind,
      width: encoded.width,
      height: encoded.height,
    });
  }
}
