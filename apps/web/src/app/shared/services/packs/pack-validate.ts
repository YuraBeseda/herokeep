import { validatePack } from '@hk/engine';
import { formatIssues, PACK_LIMITS, parsePack, type Pack } from '@hk/protocol';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { canonicalJson } from './canonical-json';
import {
  PackImportBadSchemaError,
  PackImportConflictError,
  PackImportHashMismatchError,
  PackImportInvalidError,
  PackImportTooLargeError,
} from './pack-import.errors';

/** What the source of an external pack says it is: its `id@version` and the sha256 of its exact
 * bytes — bare 64-hex (`pack.enabled@1`, `welcome.packs`) or `sha256:<hex>` (a `.hero` manifest
 * row); both name the same digest. */
export interface ExternalPackRef {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
}

export interface ValidatedExternalPack {
  readonly pack: Pack;
  readonly canonicalJson: string;
}

const HASH_PREFIX = 'sha256:';

function bareDigest(hash: string): string {
  return hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : hash;
}

function packKey(pack: { id: string; version: string }): string {
  return `${pack.id}@${pack.version}`;
}

/**
 * The checks every content pack that arrives WITHOUT a trust dialog goes through before it may be
 * installed — a pack carried by a `.hero` bundle (plan 15 ruling 9) and a campaign's enabled pack
 * fetched from the server (plan 16 ruling 4) — in this order, failing fast; nothing is stored:
 *
 * 1. `parseExternalPack`: ≤ `PACK_LIMITS.maxBytes` (before hashing); the sha256 of the EXACT
 *    bytes equals `expected.sha256`; JSON + the strict `parsePack` + kind `content`; and it is the
 *    `id@version` `expected` names.
 * 2. `checkPackConflict` against `available`: the core pack's id, or the same `id@version` with a
 *    different canonical JSON, is a conflict (an identical copy is fine).
 * 3. `assertPackValid` against `available`: any ERROR diagnostic of `validatePack` refuses it.
 *
 * `available` is every pack the device has (core, content, translations) plus any pack arriving
 * together with this one. Refusals are the `PackImport*Error`s, whose `code`s are `packs` i18n
 * keys. The `.hero` reader runs the three steps itself, all bundle packs per step, because a
 * carried pack may depend on another carried pack; it maps the refusals to its own errors.
 */
export async function validateExternalPack(
  bytes: Uint8Array,
  expected: ExternalPackRef,
  available: readonly Pack[],
): Promise<ValidatedExternalPack> {
  const pack = await parseExternalPack(bytes, expected);
  checkPackConflict(pack, available);
  assertPackValid(pack, available);
  return { pack, canonicalJson: canonicalJson(pack) };
}

/** Step 1 of `validateExternalPack`: size cap, exact-bytes sha256, strict content-pack parse,
 * identity. */
export async function parseExternalPack(
  bytes: Uint8Array,
  expected: ExternalPackRef,
): Promise<Pack> {
  if (bytes.byteLength > PACK_LIMITS.maxBytes) {
    throw new PackImportTooLargeError('pack-json-bytes', bytes.byteLength, PACK_LIMITS.maxBytes);
  }
  if (bareDigest(await sha256Hex(bytes)) !== bareDigest(expected.sha256)) {
    throw new PackImportHashMismatchError(expected.sha256);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PackImportBadSchemaError(['not valid JSON']);
  }
  const result = parsePack(raw);
  if (!result.ok) throw new PackImportBadSchemaError(formatIssues(result.issues));
  const pack = result.pack;
  if (pack.kind !== 'content') {
    throw new PackImportBadSchemaError(['kind: only content packs can be installed']);
  }
  if (pack.id !== expected.id || pack.version !== expected.version) {
    throw new PackImportBadSchemaError([`holds ${packKey(pack)}, not ${packKey(expected)}`]);
  }
  return pack;
}

/** Step 2 of `validateExternalPack`: throws `PackImportConflictError` when `pack` reuses a core
 * pack's id or a DIFFERENT pack is among `installed` under its exact `id@version`; returns whether
 * an identical one is (so the caller can skip the write). Callers repeat it right before the
 * write, since a pack may have been installed meanwhile. */
export function checkPackConflict(pack: Pack, installed: readonly Pack[]): boolean {
  const key = packKey(pack);
  if (installed.some((p) => p.kind === 'core' && p.id === pack.id)) {
    throw new PackImportConflictError(key);
  }
  const existing = installed.find((p) => p.kind !== 'core' && packKey(p) === key);
  if (existing && canonicalJson(existing) !== canonicalJson(pack)) {
    throw new PackImportConflictError(key);
  }
  return existing !== undefined;
}

/** Step 3 of `validateExternalPack`: `validatePack(pack, available)` ERROR diagnostics refuse
 * (`PackImportInvalidError`); warnings never do. */
export function assertPackValid(pack: Pack, available: readonly Pack[]): void {
  const errors = validatePack(pack, [...available]).filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new PackImportInvalidError(errors);
}
