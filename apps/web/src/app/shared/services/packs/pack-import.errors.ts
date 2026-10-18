import type { Diagnostic } from '@hk/engine';

/**
 * `.hkpack` / `pack.json` import refusals (plan 15, design ruling 2). Every refusal is a distinct,
 * typed error whose `code` is the i18n key the UI shows (`packs` scope) — same pattern as
 * `HeroImport*Error` (`@shared/services/export/hero-reader.service`) carrying
 * `characters.list.toast.import-failed-*`. The messages below are developer diagnostics only
 * (logs/tests), never rendered.
 */
export class PackImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PackImportError';
  }
}

/** Which container/JSON cap was exceeded (`HKPACK_LIMITS` / `PACK_LIMITS.maxBytes`). */
export type PackImportLimit = 'zip-bytes' | 'entries' | 'pack-json-bytes' | 'asset-bytes-total';

export class PackImportTooLargeError extends PackImportError {
  constructor(
    readonly detail: PackImportLimit,
    readonly actual: number,
    readonly limit: number,
  ) {
    super('packs.import-failed-too-large', `Pack import exceeds ${detail}: ${actual} > ${limit}`);
    this.name = 'PackImportTooLargeError';
  }
}

/** The file could not be unzipped at all (corrupt bytes / not a zip). */
export class PackImportBadZipError extends PackImportError {
  constructor(cause?: unknown) {
    super('packs.import-failed-bad-zip', 'The selected file is not a valid .hkpack archive.');
    this.name = 'PackImportBadZipError';
    this.cause = cause;
  }
}

/** The archive unzipped but has no `pack.json` at its root. */
export class PackImportMissingPackJsonError extends PackImportError {
  constructor() {
    super('packs.import-failed-missing-pack-json', 'The archive has no pack.json at its root.');
    this.name = 'PackImportMissingPackJsonError';
  }
}

/** `pack.json` is not JSON, fails the strict `PackSchema` (`parsePack`), or is not a content pack.
 * `issues` are `formatIssues` lines (`path: message`). */
export class PackImportBadSchemaError extends PackImportError {
  constructor(readonly issues: readonly string[]) {
    super('packs.import-failed-bad-schema', `Invalid pack.json — ${issues.join('; ')}`);
    this.name = 'PackImportBadSchemaError';
  }
}

/** `validatePack(pack, [core, ...installed content packs])` reported ERROR-severity diagnostics
 * (warnings never refuse; they travel on the preview). */
export class PackImportInvalidError extends PackImportError {
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super(
      'packs.import-failed-invalid',
      `Pack failed validation — ${diagnostics.map((d) => `${d.code}: ${d.message}`).join('; ')}`,
    );
    this.name = 'PackImportInvalidError';
  }
}

/** An `assets[]` entry has no `assets/<hash-hex>` zip entry (always the case for a bare
 * `pack.json` that declares assets). */
export class PackImportAssetMissingError extends PackImportError {
  constructor(readonly hash: string) {
    super('packs.import-failed-asset-missing', `Asset ${hash} is listed but not in the archive.`);
    this.name = 'PackImportAssetMissingError';
  }
}

/** An asset's bytes exceed its declared `size` or the `AssetSchema` per-asset cap. */
export class PackImportAssetTooLargeError extends PackImportError {
  constructor(
    readonly hash: string,
    readonly actual: number,
    readonly limit: number,
  ) {
    super(
      'packs.import-failed-asset-too-large',
      `Asset ${hash} is ${actual} bytes; limit is ${limit}.`,
    );
    this.name = 'PackImportAssetTooLargeError';
  }
}

/** An asset's bytes are not the image format its `mime` declares (magic-byte sniff). */
export class PackImportAssetMimeMismatchError extends PackImportError {
  constructor(
    readonly hash: string,
    readonly declared: string,
  ) {
    super('packs.import-failed-asset-mime-mismatch', `Asset ${hash} bytes are not ${declared}.`);
    this.name = 'PackImportAssetMimeMismatchError';
  }
}

/** An asset's bytes do not hash to the `sha256:<hex>` its `assets[]` entry declares. */
export class PackImportAssetHashMismatchError extends PackImportError {
  constructor(readonly hash: string) {
    super(
      'packs.import-failed-asset-hash-mismatch',
      `Asset bytes do not match the declared hash ${hash}.`,
    );
    this.name = 'PackImportAssetHashMismatchError';
  }
}

/** The same `id@version` is already installed with a different canonical JSON, or the pack
 * reuses the core pack's id. */
export class PackImportConflictError extends PackImportError {
  constructor(readonly key: string) {
    super('packs.import-failed-conflict', `A different pack ${key} is already installed.`);
    this.name = 'PackImportConflictError';
  }
}
