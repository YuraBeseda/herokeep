import { sniffImageMime } from './image-mime-sniff';

describe('sniffImageMime', () => {
  it('recognizes a JPEG by its FF D8 FF signature', () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
  });

  it('recognizes a PNG by its 89 50 4E 47 signature', () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
  });

  it('recognizes a WEBP by its RIFF....WEBP signature', () => {
    const bytes = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46, // "RIFF"
      0,
      0,
      0,
      0, // chunk size (irrelevant to sniffing)
      0x57,
      0x45,
      0x42,
      0x50, // "WEBP"
    ]);
    expect(sniffImageMime(bytes)).toBe('image/webp');
  });

  it('returns undefined for bytes matching none of the three signatures', () => {
    expect(sniffImageMime(new Uint8Array([1, 2, 3, 4, 5]))).toBeUndefined();
  });

  it('returns undefined for a buffer too short to contain any signature', () => {
    expect(sniffImageMime(new Uint8Array([0xff]))).toBeUndefined();
  });
});
