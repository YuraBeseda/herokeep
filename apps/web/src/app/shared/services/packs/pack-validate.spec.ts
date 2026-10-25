import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { PACK_LIMITS, parsePack, type Pack } from '@hk/protocol';
import { sha256Hex } from '@shared/services/images/image-pipeline.service';
import { canonicalJson } from './canonical-json';
import {
  PackImportBadSchemaError,
  PackImportConflictError,
  PackImportHashMismatchError,
  PackImportInvalidError,
  PackImportTooLargeError,
} from './pack-import.errors';
import { checkPackConflict, validateExternalPack } from './pack-validate';

// Real packs (the built core + the sample content fixture) — the same files the `.hero` reader
// spec validates bundled packs against.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');
const fixturesDir = join(repoRoot, 'apps/web/src/testing/fixtures/packs');

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!result.ok) throw new Error(`fixture pack at ${path} failed validation`);
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);
const sample = readPack(join(fixturesDir, 'sample-content.json'));
const SAMPLE = { id: sample.id, version: sample.version };

function rawSample(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixturesDir, 'sample-content.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** The bare 64-hex digest — the `pack.enabled@1` event's own form. */
async function bareSha(bytes: Uint8Array): Promise<string> {
  return (await sha256Hex(bytes)).slice('sha256:'.length);
}

/** `raw` serialized, plus the expectation an event carrying exactly these bytes would name. */
async function external(
  raw: unknown,
  ref: { id: string; version: string } = SAMPLE,
): Promise<{ bytes: Uint8Array; expected: { id: string; version: string; sha256: string } }> {
  const bytes = utf8(JSON.stringify(raw));
  return { bytes, expected: { ...ref, sha256: await bareSha(bytes) } };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: unknown) => error,
  );
}

describe('validateExternalPack', () => {
  it('accepts a valid content pack and returns it with its canonical JSON', async () => {
    const { bytes, expected } = await external(rawSample());

    const result = await validateExternalPack(bytes, expected, [corePack]);

    expect(result.pack).toEqual(sample);
    expect(result.canonicalJson).toBe(canonicalJson(sample));
  });

  it('accepts the sha256:-prefixed digest form too (the .hero manifest form)', async () => {
    const { bytes, expected } = await external(rawSample());

    const result = await validateExternalPack(
      bytes,
      { ...expected, sha256: `sha256:${expected.sha256}` },
      [corePack],
    );

    expect(result.pack.id).toBe(sample.id);
  });

  it('refuses bytes over PACK_LIMITS.maxBytes before hashing them', async () => {
    const bytes = new Uint8Array(PACK_LIMITS.maxBytes + 1).fill(0x20);

    const error = await refusal(
      validateExternalPack(bytes, { ...SAMPLE, sha256: '0'.repeat(64) }, [corePack]),
    );

    expect(error).toBeInstanceOf(PackImportTooLargeError);
    expect((error as PackImportTooLargeError).detail).toBe('pack-json-bytes');
  });

  it('refuses bytes whose sha256 is not the expected one (tampered or stale)', async () => {
    const { expected } = await external(rawSample());
    const tampered = rawSample();
    tampered['name'] = 'Tampered';

    const error = await refusal(
      validateExternalPack(utf8(JSON.stringify(tampered)), expected, [corePack]),
    );

    expect(error).toBeInstanceOf(PackImportHashMismatchError);
    expect((error as PackImportHashMismatchError).code).toBe('packs.import-failed-hash-mismatch');
    expect((error as PackImportHashMismatchError).expected).toBe(expected.sha256);
  });

  it('refuses bytes that are not JSON', async () => {
    const bytes = utf8('{ not json');

    const error = await refusal(
      validateExternalPack(bytes, { ...SAMPLE, sha256: await bareSha(bytes) }, [corePack]),
    );

    expect(error).toBeInstanceOf(PackImportBadSchemaError);
  });

  it('refuses a pack failing the strict schema (unknown top-level key)', async () => {
    const raw = rawSample();
    raw['sneaky'] = true;
    const { bytes, expected } = await external(raw);

    await expect(validateExternalPack(bytes, expected, [corePack])).rejects.toBeInstanceOf(
      PackImportBadSchemaError,
    );
  });

  it('refuses a pack that is not a content pack', async () => {
    const { bytes, expected } = await external(corePack, {
      id: corePack.id,
      version: corePack.version,
    });

    await expect(validateExternalPack(bytes, expected, [])).rejects.toBeInstanceOf(
      PackImportBadSchemaError,
    );
  });

  it('refuses a pack whose id@version is not the expected one', async () => {
    const raw = rawSample();
    raw['version'] = '1.0.1';
    const { bytes, expected } = await external(raw);

    await expect(validateExternalPack(bytes, expected, [corePack])).rejects.toBeInstanceOf(
      PackImportBadSchemaError,
    );
  });

  it('refuses a different pack installed under the same id@version as a conflict', async () => {
    const { bytes, expected } = await external(rawSample());
    const other: Pack = { ...sample, name: 'Someone else’s sample' };

    const error = await refusal(validateExternalPack(bytes, expected, [corePack, other]));

    expect(error).toBeInstanceOf(PackImportConflictError);
    expect((error as PackImportConflictError).key).toBe(`${sample.id}@${sample.version}`);
  });

  it('accepts an identical pack already installed under the same id@version', async () => {
    const { bytes, expected } = await external(rawSample());

    const result = await validateExternalPack(bytes, expected, [corePack, sample]);

    expect(result.pack).toEqual(sample);
  });

  it('refuses a pack failing validatePack with its error diagnostics', async () => {
    const raw = rawSample();
    raw['dependencies'] = [
      ...(raw['dependencies'] as unknown[]),
      { id: 'nowhere-pack', range: '^1.0.0' },
    ];
    const { bytes, expected } = await external(raw);

    const error = await refusal(validateExternalPack(bytes, expected, [corePack]));

    expect(error).toBeInstanceOf(PackImportInvalidError);
    const diagnostics = (error as PackImportInvalidError).diagnostics;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.severity === 'error')).toBe(true);
  });

  it('validates against the available packs, so a dependency among them is satisfied', async () => {
    const dependency: Pack = { ...sample, id: 'nowhere-pack', entities: [], assets: [] };
    const raw = rawSample();
    raw['dependencies'] = [
      ...(raw['dependencies'] as unknown[]),
      { id: 'nowhere-pack', range: '^1.0.0' },
    ];
    const { bytes, expected } = await external(raw);

    const result = await validateExternalPack(bytes, expected, [corePack, dependency]);

    expect(result.pack.dependencies.map((d) => d.id)).toContain('nowhere-pack');
  });
});

describe('checkPackConflict', () => {
  it('refuses a pack reusing the core pack id', () => {
    expect(() => checkPackConflict({ ...sample, id: corePack.id }, [corePack])).toThrow(
      PackImportConflictError,
    );
  });

  it('reports whether an identical copy is already installed', () => {
    expect(checkPackConflict(sample, [corePack])).toBe(false);
    expect(checkPackConflict(sample, [corePack, structuredClone(sample)])).toBe(true);
  });
});
