/** Ruling 6 (plan-8 Global Constraints): the login/register device-label field is prefilled from
 * browser hints and stays user-editable. Prefers the modern `navigator.userAgentData` (Chromium
 * browsers) for a stable brand/platform pair, and falls back to parsing `navigator.userAgent` for
 * browsers that don't implement it (Firefox, Safari) — never throws, an unrecognized UA still
 * returns SOME usable label rather than an empty string.
 *
 * Deliberately NOT run through the i18n Localizer: a device label is free-text DATA the user
 * edits and sends to the server (`deviceLabel`), not translated UI copy — CLAUDE.md rule 2 is
 * about user-visible interface strings, not user-owned data. The server's own fallback
 * (`apps/api/src/core/auth/login.ts`'s `normalizeDeviceLabel`) is likewise the plain English
 * string `'Unknown device'` for the same reason.
 */

interface UserAgentDataBrand {
  readonly brand: string;
  readonly version: string;
}

interface UserAgentData {
  readonly brands?: readonly UserAgentDataBrand[];
  readonly platform?: string;
}

/** The subset of `Navigator` this helper reads — kept narrow (rather than the full DOM
 * `Navigator` type) so a test can pass a plain object literal instead of a real `Navigator`. */
export interface NavigatorHints {
  readonly userAgentData?: UserAgentData;
  readonly userAgent?: string;
  readonly platform?: string;
}

// Chromium's "greasing" brand (e.g. "Not.A.Brand", "Not/A)Brand", "Not_A Brand" across versions)
// is intentionally meaningless and must never be reported as "the browser".
const IGNORED_BRAND_PATTERN = /Not.?A.?Brand/i;

function browserFromBrands(brands: readonly UserAgentDataBrand[] | undefined): string | undefined {
  return brands?.find((b) => b.brand.length > 0 && !IGNORED_BRAND_PATTERN.test(b.brand))?.brand;
}

function browserFromUserAgent(ua: string): string {
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('OPR/')) return 'Opera';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Chrome/') || ua.includes('CriOS/')) return 'Chrome';
  if (ua.includes('Safari/')) return 'Safari';
  return 'Browser';
}

function platformFromUserAgent(ua: string): string | undefined {
  // iOS/Android checked BEFORE Windows/macOS/Linux: a real iOS Safari UA string contains the
  // literal substring "like Mac OS X" (WebKit's compatibility token), which would otherwise
  // false-match the macOS check first.
  if (ua.includes('iPhone') || ua.includes('iPad') || ua.includes('iPod')) return 'iOS';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  return undefined;
}

/** First non-empty (post-`trim`) candidate, or `undefined` if none — a small helper so the
 * fallback chain below can treat an empty string the same as a missing value without `||`
 * (`@typescript-eslint/prefer-nullish-coalescing` rightly flags `||` here since `??` alone would
 * NOT skip an empty string, only `null`/`undefined`). */
function firstNonEmpty(...candidates: readonly (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate.length > 0) return candidate;
  }
  return undefined;
}

/** Builds a default device label like `"Chrome on Windows"`. Falls back to just the browser name
 * when no platform can be determined at all (never returns an empty string). */
export function defaultDeviceLabel(nav: NavigatorHints = globalThis.navigator ?? {}): string {
  const ua = nav.userAgent ?? '';
  const browser = browserFromBrands(nav.userAgentData?.brands) ?? browserFromUserAgent(ua);
  const platform = firstNonEmpty(
    nav.userAgentData?.platform?.trim(),
    platformFromUserAgent(ua),
    nav.platform?.trim(),
  );
  return platform ? `${browser} on ${platform}` : browser;
}
