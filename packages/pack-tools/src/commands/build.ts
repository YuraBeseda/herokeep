import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hasErrors, validatePack } from '@hk/engine';
import { formatIssues, parsePack } from '@hk/protocol';
import { loadAvailablePacks, readPackFile, writeJson } from '../io.ts';
import { type CommandResult, formatDiagnostic } from '../result.ts';

export interface BuildOptions {
  dir: string;
  out?: string;
  packsDir?: string;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(json|ya?ml)$/i.test(name)) out.push(p);
  }
  return out;
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
  for (const file of walk(join(opts.dir, 'entities'))) {
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
  if (hasErrors(diagnostics))
    return { exitCode: 1, lines: [...lines, `FAILED: ${parsed.pack.id}@${parsed.pack.version}`] };

  const out = opts.out ?? join(opts.dir, 'dist', 'pack.json');
  writeJson(out, parsed.pack);
  lines.push(`wrote ${out} (${parsed.pack.entities.length} entities)`);
  return { exitCode: 0, lines };
}
