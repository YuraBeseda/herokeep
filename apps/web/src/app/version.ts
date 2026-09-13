/**
 * The app's own release version — mirrors the content pack's `PACK_VERSION` convention
 * (`@hk/content/version`). `apps/web/package.json`'s `version` field is still the Angular CLI
 * scaffold default ("0.0.0") and isn't wired to any release process, so it isn't a reliable
 * source; bump this by hand alongside a real release until that changes.
 *
 * Single-sourced here (fix-round 1, finding 3) so `about.component.ts` (the About screen's
 * version line) and `hero-writer.service.ts` (a `.hero` bundle's `manifest.appVersion`) can't
 * drift out of sync with two separately-hand-bumped copies.
 */
export const APP_VERSION = '0.1.0';
