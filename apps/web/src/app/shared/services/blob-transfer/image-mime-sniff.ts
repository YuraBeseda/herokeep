/**
 * Best-effort mime detection by magic-number sniffing — the `blob.chunk` wire protocol carries no
 * mime/kind metadata at all (only raw bytes + a hash), unlike the original upload path
 * (`portrait.set`'s own `{hash, thumbHash, mime, w, h}`), so a REQUESTER assembling a transferred
 * blob has no other way to learn its mime before storing it. doc-07 §Safety restricts stored
 * images to exactly these three formats ("Only image/webp|jpeg|png are stored; SVG uploads are
 * rejected") — a legitimately-transferred blob (one that passed THIS restriction at its original
 * upload) can therefore only ever be one of these three, so signature sniffing is exhaustive for
 * every honest case; anything else is treated as unrecognized rather than guessed at.
 */
export function sniffImageMime(
  bytes: Uint8Array,
): 'image/webp' | 'image/jpeg' | 'image/png' | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 // "WEBP"
  ) {
    return 'image/webp';
  }
  return undefined;
}
