/**
 * Task 7 test-only binary-frame ENCODER for `blob.chunk` (doc-07's 16-byte header). Encoding lives
 * here rather than in `core/streams/blob-relay.ts`: production server code only ever DECODES an
 * incoming chunk frame and forwards it byte-for-byte (`BlobRelay.handleChunk`) — it never
 * constructs one itself. A real encoder is client-side (plan 10, not built yet); these tests stand
 * in for a "holder" client by building scripted binary frames directly, reusing the SAME magic/size
 * constants `blob-relay.ts` exports so the two can never silently drift apart.
 */
import { BLOB_CHUNK_HEADER_BYTES, BLOB_CHUNK_MAGIC } from '../../src/core/streams/blob-relay.ts';

export interface BlobChunkFrameFields {
  readonly index: number;
  readonly total: number;
  readonly to: number;
  /** Defaults to 4 zero bytes — the relay never inspects this field's content (see
   * `blob-relay.ts`'s `DecodedBlobChunkHeader.hashPrefix` doc comment), so tests only need to
   * supply a real value when specifically asserting on it. */
  readonly hashPrefix?: Uint8Array;
  readonly payload?: Uint8Array;
}

/** Builds one complete binary `blob.chunk` frame: the 16-byte header followed by `payload`. */
export function buildBlobChunkFrame(fields: BlobChunkFrameFields): Uint8Array {
  const hashPrefix = fields.hashPrefix ?? new Uint8Array(4);
  const payload = fields.payload ?? new Uint8Array(0);
  const frame = new Uint8Array(BLOB_CHUNK_HEADER_BYTES + payload.length);
  frame.set(BLOB_CHUNK_MAGIC, 0);
  const view = new DataView(frame.buffer);
  view.setUint16(4, fields.index, false);
  view.setUint16(6, fields.total, false);
  view.setUint32(8, fields.to, false);
  frame.set(hashPrefix.subarray(0, 4), 12);
  frame.set(payload, BLOB_CHUNK_HEADER_BYTES);
  return frame;
}

/** The first 4 raw bytes of a `sha256:<hex>` blob hash (`BlobHashSchema`), for tests that want a
 * realistic (non-zero) `hashPrefix`. */
export function hashPrefixOf(hash: string): Uint8Array {
  const hex = hash.replace(/^sha256:/, '').slice(0, 8);
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
