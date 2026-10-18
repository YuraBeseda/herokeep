import { existsSync, readFileSync } from 'node:fs';
import { hasErrors, validatePack } from '@hk/engine';
import { HKPACK_ASSET_DIR, formatIssues, parsePack } from '@hk/protocol';
import { assetEntryName, checkPackAssets, formatIssue, readHkpack } from '../hkpack.ts';
import { loadAvailablePacks, readPackFile } from '../io.ts';
import { type CommandResult, formatDiagnostic } from '../result.ts';

export interface ValidateOptions {
  /** A `pack.json` / `pack.yaml`, or a `.hkpack` zip (detected by extension). */
  path: string;
  packsDir?: string;
}

interface Input {
  value: unknown;
  /** `.hkpack` only: the unzipped `assets/<hex>` entries to check against `assets[]`. */
  zip?: { files: Record<string, Uint8Array>; oversized: ReadonlySet<string> };
}

function readInput(path: string): { ok: true; input: Input } | { ok: false; result: CommandResult } {
  if (!/\.hkpack$/i.test(path)) {
    try {
      return { ok: true, input: { value: readPackFile(path) } };
    } catch (e) {
      return { ok: false, result: { exitCode: 2, lines: [`cannot read ${path}: ${(e as Error).message}`] } };
    }
  }
  const read = readHkpack(new Uint8Array(readFileSync(path)));
  if (!read.ok) {
    const line = formatIssue('error', read.issue);
    return read.badZip
      ? { ok: false, result: { exitCode: 2, lines: [`cannot read ${path}: ${line}`] } }
      : { ok: false, result: { exitCode: 1, lines: [line] } };
  }
  try {
    return {
      ok: true,
      input: { value: JSON.parse(read.packText) as unknown, zip: { files: read.files, oversized: read.oversized } },
    };
  } catch (e) {
    return { ok: false, result: { exitCode: 2, lines: [`cannot read ${path}: pack.json: ${(e as Error).message}`] } };
  }
}

export function runValidate(opts: ValidateOptions): CommandResult {
  if (!existsSync(opts.path)) return { exitCode: 2, lines: [`file not found: ${opts.path}`] };
  const read = readInput(opts.path);
  if (!read.ok) return read.result;
  const parsed = parsePack(read.input.value);
  if (!parsed.ok)
    return { exitCode: 1, lines: ['schema errors:', ...formatIssues(parsed.issues).map((l) => `  ${l}`)] };

  const { packs, lines } = loadAvailablePacks(opts.packsDir);
  const diagnostics = validatePack(parsed.pack, packs);
  const out = [...lines, ...diagnostics.map(formatDiagnostic)];
  let errors = hasErrors(diagnostics);
  let warnings = diagnostics.length;
  const zip = read.input.zip;
  if (zip) {
    const assetIssues = checkPackAssets(parsed.pack, zip.files, zip.oversized);
    out.push(...assetIssues.map((i) => formatIssue('error', i)));
    errors ||= assetIssues.length > 0;
    const listed = new Set(parsed.pack.assets.map((a) => assetEntryName(a.hash)));
    for (const name of Object.keys(zip.files).sort()) {
      if (name.startsWith(HKPACK_ASSET_DIR) && !listed.has(name)) {
        out.push(
          formatIssue('warning', { code: 'asset.unlisted', where: name, message: 'no assets[] entry lists it' }),
        );
        warnings++;
      }
    }
  }
  out.push(
    errors
      ? `FAILED: ${parsed.pack.id}@${parsed.pack.version}`
      : `OK: ${parsed.pack.id}@${parsed.pack.version} (${parsed.pack.entities.length} entities, ${warnings} warnings)`,
  );
  return { exitCode: errors ? 1 : 0, lines: out };
}
