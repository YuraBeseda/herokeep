/**
 * Hand-rolled UUIDv7 (RFC 9562): a sortable, time-ordered id — a 48-bit Unix millisecond
 * timestamp in the top bits, the version-7 nibble and RFC 4122 variant bits per spec, and the
 * remaining bits from `crypto.getRandomValues`.
 *
 * Ported from apps/web/src/app/shared/helpers/uuid.ts rather than imported: `src/core/**` may
 * only depend on `./ports` types and `@hk/protocol` (the ESLint core-boundary rule; Global
 * Constraints in the phase-2 plan) and must not reach across the apps/api ↔ apps/web boundary,
 * so the algorithm is duplicated here. Uses WebCrypto's global `crypto` only — no `node:` or
 * `cloudflare:` import — so it runs unchanged on both the Node adapter (>= 20) and Cloudflare
 * Workers. Referenced as the bare identifier `crypto` (not `globalThis.crypto`): `@types/node`
 * and `@cloudflare/workers-types` both declare a global `crypto`, but only Node's declares it as
 * an actual property of `typeof globalThis` — `src/adapters/cloudflare/tsconfig.json`'s separate
 * program (required for the Cloudflare adapter; see that file's header comment) fails to compile
 * this file under the dotted form with "Property 'crypto' does not exist on type 'typeof
 * globalThis'" otherwise, even though the plain global reference resolves identically under both.
 */
export function uuidv7(): string {
  const ts = Date.now();
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);
  const byte = (i: number): number => rand[i] ?? 0;

  const bytes = new Uint8Array(16);
  // 48-bit big-endian timestamp (bytes 0-5). `ts` comfortably exceeds 32 bits well before the
  // year 2038, so the top three bytes are carved off with plain division rather than `>>>`,
  // which truncates its operand to 32 bits first.
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = (ts >>> 16) & 0xff;
  bytes[4] = (ts >>> 8) & 0xff;
  bytes[5] = ts & 0xff;
  bytes[6] = 0x70 | (byte(0) & 0x0f); // version 7
  bytes[7] = byte(1);
  bytes[8] = 0x80 | (byte(2) & 0x3f); // RFC 4122 variant (10xx xxxx)
  bytes[9] = byte(3);
  bytes[10] = byte(4);
  bytes[11] = byte(5);
  bytes[12] = byte(6);
  bytes[13] = byte(7);
  bytes[14] = byte(8);
  bytes[15] = byte(9);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
