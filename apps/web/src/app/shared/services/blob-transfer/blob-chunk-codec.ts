/**
 * Client-side codec for the binary `blob.chunk` frame — docs/02-architecture/07-images-and-blobs.md
 * §Blob transfer protocol + docs/02-architecture/03-sync-protocol.md's `blob.*` frame rows.
 *
 * CANONICAL VALUES COPIED (not imported — `apps/web` cannot import `apps/api`, the core-boundary
 * rule docs/02-architecture/10-backend-architecture.md and every earlier plan-10 task's own
 * `WS_MESSAGE_BYTES_MAX`/`CAMPAIGN_BYE_REASON_MEMBER_REMOVED` precedent already establishes) from
 * `apps/api/src/core/streams/blob-relay.ts` — that file is the READ-ONLY server-side reference for
 * this task; `BLOB_CHUNK_MAGIC`/`BLOB_CHUNK_HEADER_BYTES`/`MAX_BLOB_CHUNK_PAYLOAD_BYTES` and
 * `decodeBlobChunkHeader`'s exact field layout below are hand-verified to match that file
 * byte-for-byte, and `blob-chunk-codec.spec.ts`'s fixture test pins the exact bytes this module
 * produces so any future drift between the two copies fails loudly instead of silently.
 *
 * `blob-relay.ts` only ever DECODES a chunk frame (to learn its `to` field for routing) — it never
 * builds one; a HOLDER (a client, this module) is the only encoder that exists anywhere in this
 * codebase. `encodeBlobChunkFrame`/`splitIntoChunks` below are therefore new, not copies of
 * anything server-side, but follow the exact same field layout `decodeBlobChunkHeader` reads.
 */

/** doc-07: "16-byte header `[magic 4B][index u16][total u16][to u32][hash prefix 4B]`". */
export const BLOB_CHUNK_HEADER_BYTES = 16;

/** ASCII "HKBC" ("Herokeep Blob Chunk") — copied verbatim from
 * `apps/api/src/core/streams/blob-relay.ts`'s own `BLOB_CHUNK_MAGIC`. */
export const BLOB_CHUNK_MAGIC: readonly number[] = Object.freeze([0x48, 0x4b, 0x42, 0x43]);

/** doc-07: "followed by <= 64 KB" — copied verbatim from `blob-relay.ts`'s own
 * `MAX_BLOB_CHUNK_PAYLOAD_BYTES`. */
export const MAX_BLOB_CHUNK_PAYLOAD_BYTES = 64 * 1024;

export interface DecodedBlobChunkHeader {
  /** 0-based chunk index within this transfer. */
  readonly index: number;
  /** Total number of chunks in this transfer. */
  readonly total: number;
  /** The relay-local integer connection id this frame is addressed to (the JSON `blob.pull.to`
   * field, stringified, echoed back verbatim by the holder — see `blob-relay.ts`'s own doc). */
  readonly to: number;
  /** The requested blob's hash, first 4 raw digest bytes (informational/defensive only — verified
   * against the in-flight request's own expected hash by the caller, never trusted alone). */
  readonly hashPrefix: Uint8Array;
  /** The frame's bytes after the 16-byte header — at most `MAX_BLOB_CHUNK_PAYLOAD_BYTES`. */
  readonly payload: Uint8Array;
}

/** The 16-byte header's `hashPrefix` field: the first 4 bytes of the HEX DIGEST bytes (2 hex
 * characters per byte) — NOT the first 4 characters/bytes of the `"sha256:<hex>"` STRING. Accepts
 * either a full `"sha256:<hex>"` blob hash or a bare hex digest. */
export function hashPrefixBytes(hash: string): Uint8Array {
  const hex = hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Builds one complete `blob.chunk` binary frame: the 16-byte big-endian header, followed by
 * `payload` verbatim. `payload` must already be `<= MAX_BLOB_CHUNK_PAYLOAD_BYTES` — this function
 * does not itself split a large buffer (see `splitIntoChunks`). */
export function encodeBlobChunkFrame(
  hash: string,
  index: number,
  total: number,
  to: number,
  payload: Uint8Array,
): Uint8Array {
  const frame = new Uint8Array(BLOB_CHUNK_HEADER_BYTES + payload.length);
  const view = new DataView(frame.buffer);
  frame.set(BLOB_CHUNK_MAGIC, 0);
  view.setUint16(4, index, false);
  view.setUint16(6, total, false);
  view.setUint32(8, to, false);
  frame.set(hashPrefixBytes(hash), 12);
  frame.set(payload, BLOB_CHUNK_HEADER_BYTES);
  return frame;
}

/** Mirrors `apps/api/src/core/streams/blob-relay.ts`'s `decodeBlobChunkHeader` exactly (byte
 * layout, magic check, oversize-payload rejection) — see this module's own doc for why this is a
 * COPY, not an import. Returns `undefined` for anything that cannot possibly be a valid chunk
 * frame: shorter than the header, a magic mismatch, or an oversized payload. */
export function decodeBlobChunkHeader(frame: Uint8Array): DecodedBlobChunkHeader | undefined {
  if (frame.length < BLOB_CHUNK_HEADER_BYTES) return undefined;
  for (let i = 0; i < BLOB_CHUNK_MAGIC.length; i++) {
    if (frame[i] !== BLOB_CHUNK_MAGIC[i]) return undefined;
  }
  const payload = frame.subarray(BLOB_CHUNK_HEADER_BYTES);
  if (payload.length > MAX_BLOB_CHUNK_PAYLOAD_BYTES) return undefined;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return {
    index: view.getUint16(4, false),
    total: view.getUint16(6, false),
    to: view.getUint32(8, false),
    hashPrefix: frame.slice(12, 16),
    payload,
  };
}

/** Splits `bytes` into `<= MAX_BLOB_CHUNK_PAYLOAD_BYTES` payload slices, in order — the
 * holder-side counterpart of `total`/0-based `index`; doc-07: "completion = index === total-1". A
 * zero-length blob still yields exactly one (empty) chunk — a degenerate but valid 1-chunk
 * transfer, so `total` is never 0 and "completion" always has a concrete last index. */
export function splitIntoChunks(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length === 0) return [new Uint8Array(0)];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += MAX_BLOB_CHUNK_PAYLOAD_BYTES) {
    chunks.push(bytes.subarray(offset, offset + MAX_BLOB_CHUNK_PAYLOAD_BYTES));
  }
  return chunks;
}
