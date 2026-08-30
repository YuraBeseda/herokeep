import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { type Pack, formatIssues, parsePack } from '@hk/protocol';
import { parse as parseYaml } from 'yaml';

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function readPackFile(path: string): unknown {
  const ext = extname(path).toLowerCase();
  const text = readFileSync(path, 'utf8');
  return ext === '.yaml' || ext === '.yml' ? (parseYaml(text) as unknown) : (JSON.parse(text) as unknown);
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function listPackFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(json|ya?ml)$/i.test(f))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile())
    .sort();
}

export function loadAvailablePacks(dir?: string): { packs: Pack[]; lines: string[] } {
  const packs: Pack[] = [];
  const lines: string[] = [];
  if (!dir) return { packs, lines };
  for (const file of listPackFiles(dir)) {
    try {
      const r = parsePack(readPackFile(file));
      if (r.ok) packs.push(r.pack);
      else lines.push(`skipping ${file}: ${formatIssues(r.issues)[0]}`);
    } catch (e) {
      lines.push(`skipping ${file}: ${(e as Error).message}`);
    }
  }
  return { packs, lines };
}
