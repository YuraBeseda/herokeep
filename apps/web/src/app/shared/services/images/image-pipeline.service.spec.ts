import { TestBed } from '@angular/core/testing';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import {
  chooseMime,
  encodeWithinCap,
  fitPortraitDimensions,
  IMAGE_CODEC,
  ImageInvalidTypeError,
  ImagePipelineService,
  ImageTooLargeError,
  PORTRAIT_LONG_EDGE,
  THUMB_TOKEN_SIZE,
  type EncodedImage,
  type EncodeFn,
  type ImageCodec,
} from './image-pipeline.service';

// --- Pure logic: mime selection --------------------------------------------------------------

describe('chooseMime', () => {
  it('prefers webp whenever the probe reports support, regardless of alpha', () => {
    expect(chooseMime(true, true)).toBe('image/webp');
    expect(chooseMime(false, true)).toBe('image/webp');
  });

  it('falls back to png for an alpha-bearing source when webp is unsupported', () => {
    expect(chooseMime(true, false)).toBe('image/png');
  });

  it('falls back to jpeg for an opaque source when webp is unsupported', () => {
    expect(chooseMime(false, false)).toBe('image/jpeg');
  });
});

// --- Pure logic: portrait fit box ------------------------------------------------------------

describe('fitPortraitDimensions', () => {
  it('leaves a source already within the long-edge cap untouched', () => {
    expect(fitPortraitDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('scales a landscape source down so its long edge lands exactly on the cap', () => {
    expect(fitPortraitDimensions(4000, 2000)).toEqual({ width: PORTRAIT_LONG_EDGE, height: 512 });
  });

  it('scales a portrait-orientation source down so its long edge (height) hits the cap', () => {
    expect(fitPortraitDimensions(2000, 4000)).toEqual({ width: 512, height: PORTRAIT_LONG_EDGE });
  });
});

// --- Pure logic: quality-ladder / dimension-retry / reject sequence -----------------------------

describe('encodeWithinCap', () => {
  function fakeEncode(sizesByCallIndex: number[]): {
    fn: EncodeFn;
    calls: [number, number, number][];
  } {
    const calls: [number, number, number][] = [];
    let i = 0;
    const fn: EncodeFn = (mime, quality, width, height) => {
      calls.push([quality, width, height]);
      const size = sizesByCallIndex[i] ?? sizesByCallIndex.at(-1) ?? 0;
      i++;
      return Promise.resolve({ bytes: new Uint8Array(size), mime });
    };
    return { fn, calls };
  }

  it('returns on the FIRST quality rung once a size is within the cap (no further calls)', async () => {
    const { fn, calls } = fakeEncode([100]); // thumb cap is 64 KB — this "fits" trivially
    const result = await encodeWithinCap('thumb', 'image/webp', 256, 256, fn);
    expect(result.bytes.byteLength).toBe(100);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([0.85, 256, 256]);
  });

  it('walks the full 0.85 → 0.7 → 0.55 ladder at the ORIGINAL dimensions before shrinking', async () => {
    const cap = 64 * 1024;
    const { fn, calls } = fakeEncode([cap + 3, cap + 2, cap - 1]);
    const result = await encodeWithinCap('thumb', 'image/webp', 256, 256, fn);
    expect(result.bytes.byteLength).toBe(cap - 1);
    expect(calls).toEqual([
      [0.85, 256, 256],
      [0.7, 256, 256],
      [0.55, 256, 256],
    ]);
  });

  it('reduces dimensions by 0.8x and retries the FULL ladder once the original size never fits', async () => {
    const cap = 64 * 1024;
    const over = cap + 1;
    // 3 calls over cap at 256x256, then succeeds on the FIRST quality rung at the shrunk size.
    const { fn, calls } = fakeEncode([over, over, over, cap - 1]);
    const result = await encodeWithinCap('thumb', 'image/webp', 256, 256, fn);
    expect(result.bytes.byteLength).toBe(cap - 1);
    expect(result.width).toBe(205); // round(256 * 0.8)
    expect(result.height).toBe(205);
    expect(calls).toHaveLength(4);
    expect(calls[3]).toEqual([0.85, 205, 205]);
  });

  it('rejects with image.too-large after exhausting 3 dimension retries (12 total attempts)', async () => {
    const cap = 64 * 1024;
    const { fn, calls } = fakeEncode([cap + 1]); // every attempt reports over-cap
    await expect(encodeWithinCap('thumb', 'image/webp', 256, 256, fn)).rejects.toBeInstanceOf(
      ImageTooLargeError,
    );
    // 4 rounds (original + 3 retries) x 3 quality rungs each.
    expect(calls).toHaveLength(12);
  });

  it('uses the portrait cap (400 KB), independent of the thumb/token cap (64 KB)', async () => {
    const portraitCap = 400 * 1024;
    const { fn, calls } = fakeEncode([portraitCap - 1]);
    const result = await encodeWithinCap('portrait', 'image/jpeg', 1024, 768, fn);
    expect(result.bytes.byteLength).toBe(portraitCap - 1);
    expect(calls).toHaveLength(1);
  });
});

// --- ImagePipelineService.processPortrait: decode/encode seam + hash/store -------------------

describe('ImagePipelineService', () => {
  function makeFakeCodec(overrides: Partial<ImageCodec> = {}): ImageCodec {
    const decode: ImageCodec['decode'] = vi
      .fn<ImageCodec['decode']>()
      .mockResolvedValue({ width: 512, height: 512, hasAlpha: false, source: {} });
    const supportsWebp: ImageCodec['supportsWebp'] = vi
      .fn<ImageCodec['supportsWebp']>()
      .mockResolvedValue(true);
    // Distinguishes each of the (up to) three `encode()` calls a single `processPortrait` makes
    // (portrait/thumb/token) even when two boxes share identical dimensions (thumb and token both
    // target 256x256) — a real encoder would never emit byte-identical output for genuinely
    // different draws, but this fake has no real pixels to vary on, so it stamps a monotonic call
    // index into the bytes instead.
    let call = 0;
    const encode: ImageCodec['encode'] = vi
      .fn<ImageCodec['encode']>()
      .mockImplementation((_decoded, mime, _quality, width, height) => {
        call++;
        return Promise.resolve({
          bytes: new Uint8Array([width % 256, height % 256, 1, call]),
          mime,
        });
      });
    return { decode, supportsWebp, encode, ...overrides };
  }

  function configure(codec: ImageCodec): { put: ReturnType<typeof vi.fn<BlobsRepository['put']>> } {
    const put = vi.fn<BlobsRepository['put']>().mockResolvedValue(undefined);
    const get = vi.fn<BlobsRepository['get']>().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: IMAGE_CODEC, useValue: codec },
        { provide: BlobsRepository, useValue: { put, get } },
      ],
    });
    return { put };
  }

  it('stores exactly TWO blobs (portrait + thumb) and derives tokenHash from the thumb — no separate token encode', async () => {
    // Fix-round 1, finding 2: thumb and token always share the SAME mime, the SAME 256x256 box,
    // the SAME decoded source, and the SAME byte cap — so a token would always hash byte-for-byte
    // identical to the thumb. Re-encoding (and re-`put()`-ing under that same resulting hash a
    // SECOND time, which would just silently overwrite the row's `kind` from 'thumb' to 'token')
    // is pure waste; `tokenHash` is derived directly from the already-computed thumb result.
    const codec = makeFakeCodec();
    const { put } = configure(codec);
    const service = TestBed.inject(ImagePipelineService);

    const file = new File([new Uint8Array([1, 2, 3])], 'portrait.png', { type: 'image/png' });
    const result = await service.processPortrait(file);

    expect(put).toHaveBeenCalledTimes(2);
    const kinds = put.mock.calls.map((call) => call[3]?.kind);
    expect([...kinds].sort()).toEqual(['portrait', 'thumb']);

    const thumbCall = put.mock.calls.find((call) => call[3]?.kind === 'thumb');
    expect(thumbCall?.[3]).toEqual({
      kind: 'thumb',
      width: THUMB_TOKEN_SIZE,
      height: THUMB_TOKEN_SIZE,
    });

    expect(result.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.thumbHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // Token is IDENTICAL to thumb (same encode inputs) — no separate blob, no separate hash.
    expect(result.tokenHash).toBe(result.thumbHash);
    expect(result.hash).not.toBe(result.thumbHash); // portrait genuinely differs (different box)

    // Exactly TWO `encode()` calls (portrait + thumb) — NOT three: token is derived, never
    // re-encoded (previously up to 12 wasted retry-ladder attempts for byte-identical output).
    expect(codec.encode).toHaveBeenCalledTimes(2);
  });

  it("the resolved promise's w/h/mime describe the PORTRAIT blob (not the thumb/token)", async () => {
    const codec = makeFakeCodec({
      decode: vi
        .fn<ImageCodec['decode']>()
        .mockResolvedValue({ width: 2000, height: 1000, hasAlpha: false, source: {} }),
    });
    configure(codec);
    const service = TestBed.inject(ImagePipelineService);

    const file = new File([new Uint8Array([1])], 'wide.png', { type: 'image/png' });
    const result = await service.processPortrait(file);

    expect(result.w).toBe(PORTRAIT_LONG_EDGE);
    expect(result.h).toBe(512); // fitPortraitDimensions(2000, 1000): 1000 * (1024 / 2000) = 512
    expect(result.mime).toBe('image/webp'); // codec.supportsWebp() resolves true
  });

  it('rejects image/svg+xml before ever calling the codec (SVG is never stored)', async () => {
    const codec = makeFakeCodec();
    configure(codec);
    const service = TestBed.inject(ImagePipelineService);

    const file = new File([new Uint8Array([1])], 'evil.svg', { type: 'image/svg+xml' });
    await expect(service.processPortrait(file)).rejects.toBeInstanceOf(ImageInvalidTypeError);
    expect(codec.decode).not.toHaveBeenCalled();
  });

  it('propagates image.too-large from the ladder when the codec never produces a small enough encode', async () => {
    const encode: ImageCodec['encode'] = vi
      .fn<ImageCodec['encode']>()
      .mockImplementation((_decoded, mime) =>
        Promise.resolve<EncodedImage>({ bytes: new Uint8Array(1024 * 1024), mime }),
      );
    const codec = makeFakeCodec({ encode });
    configure(codec);
    const service = TestBed.inject(ImagePipelineService);

    const file = new File([new Uint8Array([1])], 'huge.png', { type: 'image/png' });
    await expect(service.processPortrait(file)).rejects.toBeInstanceOf(ImageTooLargeError);
  });
});
