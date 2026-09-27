import {
  BLOB_CHUNK_HEADER_BYTES,
  BLOB_CHUNK_MAGIC,
  MAX_BLOB_CHUNK_PAYLOAD_BYTES,
  decodeBlobChunkHeader,
  encodeBlobChunkFrame,
  hashPrefixBytes,
  splitIntoChunks,
} from './blob-chunk-codec';

const HASH = 'sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddee';

describe('blob-chunk-codec', () => {
  it('pins the canonical constants copied from apps/api/src/core/streams/blob-relay.ts', () => {
    // "HKBC" ASCII — byte-for-byte equal to the server's own BLOB_CHUNK_MAGIC.
    expect(Array.from(BLOB_CHUNK_MAGIC)).toEqual([0x48, 0x4b, 0x42, 0x43]);
    expect(BLOB_CHUNK_HEADER_BYTES).toBe(16);
    expect(MAX_BLOB_CHUNK_PAYLOAD_BYTES).toBe(64 * 1024);
  });

  describe('hashPrefixBytes', () => {
    it('returns the first 4 bytes of the hex DIGEST (not the "sha256:" prefix string bytes)', () => {
      expect(Array.from(hashPrefixBytes(HASH))).toEqual([0x00, 0x11, 0x22, 0x33]);
    });

    it('accepts a bare hex digest with no "sha256:" prefix too', () => {
      expect(Array.from(hashPrefixBytes(HASH.slice('sha256:'.length)))).toEqual([
        0x00, 0x11, 0x22, 0x33,
      ]);
    });
  });

  describe('encodeBlobChunkFrame — byte-equality fixture', () => {
    it('builds the EXACT 16-byte big-endian header doc-07/blob-relay.ts specify, followed by the payload verbatim', () => {
      const payload = new Uint8Array([9, 9, 9]);
      const frame = encodeBlobChunkFrame(HASH, 5, 10, 300, payload);

      // Hand-computed expected bytes: magic "HKBC", index=5 (u16 BE), total=10 (u16 BE),
      // to=300=0x012c (u32 BE), hashPrefix = first 4 digest bytes, then the payload.
      const expected = new Uint8Array([
        0x48,
        0x4b,
        0x42,
        0x43, // magic
        0x00,
        0x05, // index = 5
        0x00,
        0x0a, // total = 10
        0x00,
        0x00,
        0x01,
        0x2c, // to = 300
        0x00,
        0x11,
        0x22,
        0x33, // hashPrefix
        9,
        9,
        9, // payload
      ]);
      expect(Array.from(frame)).toEqual(Array.from(expected));
    });

    it('produces a frame of exactly header-bytes + payload-length', () => {
      const payload = new Uint8Array(100);
      const frame = encodeBlobChunkFrame(HASH, 0, 1, 1, payload);
      expect(frame.length).toBe(BLOB_CHUNK_HEADER_BYTES + 100);
    });
  });

  describe('decodeBlobChunkHeader', () => {
    it('round-trips whatever encodeBlobChunkFrame produced', () => {
      const payload = new Uint8Array([1, 2, 3, 4, 5]);
      const frame = encodeBlobChunkFrame(HASH, 2, 7, 42, payload);
      const decoded = decodeBlobChunkHeader(frame);

      expect(decoded).toBeDefined();
      expect(decoded?.index).toBe(2);
      expect(decoded?.total).toBe(7);
      expect(decoded?.to).toBe(42);
      expect(Array.from(decoded!.hashPrefix)).toEqual([0x00, 0x11, 0x22, 0x33]);
      expect(Array.from(decoded!.payload)).toEqual(Array.from(payload));
    });

    it('mirrors the server: rejects a frame shorter than the 16-byte header', () => {
      expect(decodeBlobChunkHeader(new Uint8Array(15))).toBeUndefined();
    });

    it('mirrors the server: rejects a frame whose magic bytes do not match', () => {
      const frame = encodeBlobChunkFrame(HASH, 0, 1, 1, new Uint8Array([1]));
      frame[0] = 0x00; // corrupt the magic
      expect(decodeBlobChunkHeader(frame)).toBeUndefined();
    });

    it('mirrors the server: rejects a payload larger than MAX_BLOB_CHUNK_PAYLOAD_BYTES', () => {
      const oversized = new Uint8Array(MAX_BLOB_CHUNK_PAYLOAD_BYTES + 1);
      const frame = encodeBlobChunkFrame(HASH, 0, 1, 1, oversized);
      expect(decodeBlobChunkHeader(frame)).toBeUndefined();
    });

    it('accepts a payload exactly at the MAX_BLOB_CHUNK_PAYLOAD_BYTES boundary', () => {
      const atCap = new Uint8Array(MAX_BLOB_CHUNK_PAYLOAD_BYTES);
      const frame = encodeBlobChunkFrame(HASH, 0, 1, 1, atCap);
      expect(decodeBlobChunkHeader(frame)?.payload.length).toBe(MAX_BLOB_CHUNK_PAYLOAD_BYTES);
    });
  });

  describe('splitIntoChunks', () => {
    it('splits bytes into <= MAX_BLOB_CHUNK_PAYLOAD_BYTES slices, in order', () => {
      const bytes = new Uint8Array(MAX_BLOB_CHUNK_PAYLOAD_BYTES + 10).map((_, i) => i % 256);
      const chunks = splitIntoChunks(bytes);
      expect(chunks).toHaveLength(2);
      expect(chunks[0].length).toBe(MAX_BLOB_CHUNK_PAYLOAD_BYTES);
      expect(chunks[1].length).toBe(10);
      const rebuilt = new Uint8Array(bytes.length);
      let offset = 0;
      for (const chunk of chunks) {
        rebuilt.set(chunk, offset);
        offset += chunk.length;
      }
      expect(Array.from(rebuilt)).toEqual(Array.from(bytes));
    });

    it('returns a single empty chunk for zero-length bytes (a valid, if degenerate, 1-chunk transfer)', () => {
      const chunks = splitIntoChunks(new Uint8Array(0));
      expect(chunks).toHaveLength(1);
      expect(chunks[0].length).toBe(0);
    });

    it('returns a single chunk when bytes already fit under the cap', () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const chunks = splitIntoChunks(bytes);
      expect(chunks).toHaveLength(1);
      expect(Array.from(chunks[0])).toEqual([1, 2, 3]);
    });
  });
});
