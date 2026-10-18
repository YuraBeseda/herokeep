import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { hasErrors, validatePack } from '@hk/engine';
import { HKPACK_PACK_ENTRY, type Pack, formatIssues, parsePack } from '@hk/protocol';
import { canonicalJson } from '../canonical.ts';
import { assetEntryName, checkPackAssets, formatIssue, sha256Hex, zipDeterministic } from '../hkpack.ts';
import { loadAvailablePacks, readPackFile, writeJson } from '../io.ts';
import { type CommandResult, formatDiagnostic } from '../result.ts';

export interface BuildOptions {
  dir: string;
  out?: string;
  packsDir?: string;
  /**
   * Also write `<id>-<version>.hkpack` next to the output `pack.json` (doc-04 §Authoring: "validates,
   * and optionally zips assets"). The zip holds the canonical `pack.json` — and the output
   * `pack.json` is then written with those same canonical bytes — plus `assets/<hex>` for every file
   * under `<dir>/assets/`; each file must match an `assets[]` entry and each entry a file.
   */
  zip?: boolean;
}

function walk(dir: string, accept: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, accept));
    else if (accept(name)) out.push(p);
  }
  return out;
}

/** Hashes every file under `<dir>/assets/`; files no `assets[]` entry lists are error lines. */
function collectAssets(dir: string, pack: Pack): { entries: Record<string, Uint8Array>; lines: string[] } {
  const listed = new Set(pack.assets.map((a) => a.hash));
  const entries: Record<string, Uint8Array> = {};
  const lines: string[] = [];
  for (const file of walk(join(dir, 'assets'), () => true)) {
    const bytes = new Uint8Array(readFileSync(file));
    const hash = `sha256:${sha256Hex(bytes)}`;
    const where = relative(dir, file).split(sep).join('/');
    if (!listed.has(hash)) {
      lines.push(formatIssue('error', { code: 'asset.unlisted', where, message: `no assets[] entry has ${hash}` }));
      continue;
    }
    entries[assetEntryName(hash)] = bytes;
  }
  return { entries, lines };
}

export function runBuild(opts: BuildOptions): CommandResult {
  const manifestPath = ['pack.yaml', 'pack.yml', 'pack.json'].map((f) => join(opts.dir, f)).find(existsSync);
  if (!manifestPath) return { exitCode: 2, lines: [`no pack.yaml / pack.json in ${opts.dir}`] };
  const lines: string[] = [];
  let manifest: Record<string, unknown>;
  try {
    manifest = readPackFile(manifestPath) as Record<string, unknown>;
  } catch (e) {
    return { exitCode: 2, lines: [`cannot read ${manifestPath}: ${(e as Error).message}`] };
  }
  const entities: unknown[] = [];
  for (const file of walk(join(opts.dir, 'entities'), (name) => /\.(json|ya?ml)$/i.test(name))) {
    try {
      const v = readPackFile(file);
      if (Array.isArray(v)) entities.push(...(v as unknown[]));
      else entities.push(v);
    } catch (e) {
      return { exitCode: 2, lines: [`cannot read ${file}: ${(e as Error).message}`] };
    }
  }
  const parsed = parsePack({ ...manifest, entities });
  if (!parsed.ok)
    return { exitCode: 1, lines: ['schema errors:', ...formatIssues(parsed.issues).map((l) => `  ${l}`)] };

  const available = loadAvailablePacks(opts.packsDir);
  lines.push(...available.lines);
  const diagnostics = validatePack(parsed.pack, available.packs);
  lines.push(...diagnostics.map(formatDiagnostic));
  let assetEntries: Record<string, Uint8Array> = {};
  let assetErrors = false;
  if (opts.zip) {
    const collected = collectAssets(opts.dir, parsed.pack);
    const missing = checkPackAssets(parsed.pack, collected.entries).map((i) => formatIssue('error', i));
    lines.push(...collected.lines, ...missing);
    assetEntries = collected.entries;
    assetErrors = collected.lines.length + missing.length > 0;
  }
  if (hasErrors(diagnostics) || assetErrors)
    return { exitCode: 1, lines: [...lines, `FAILED: ${parsed.pack.id}@${parsed.pack.version}`] };

  const out = opts.out ?? join(opts.dir, 'dist', 'pack.json');
  if (!opts.zip) {
    writeJson(out, parsed.pack);
    lines.push(`wrote ${out} (${parsed.pack.entities.length} entities)`);
    return { exitCode: 0, lines };
  }
  const packBytes = Buffer.from(canonicalJson(parsed.pack), 'utf8');
  const zipPath = join(dirname(out), `${parsed.pack.id}-${parsed.pack.version}.hkpack`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, packBytes);
  writeFileSync(zipPath, zipDeterministic({ ...assetEntries, [HKPACK_PACK_ENTRY]: new Uint8Array(packBytes) }));
  lines.push(`wrote ${out} (${parsed.pack.entities.length} entities)`);
  lines.push(`wrote ${zipPath} (pack.json + ${Object.keys(assetEntries).length} assets)`);
  return { exitCode: 0, lines };
}
