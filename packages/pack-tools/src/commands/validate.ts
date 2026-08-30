import { existsSync } from 'node:fs';
import { hasErrors, validatePack } from '@hk/engine';
import { formatIssues, parsePack } from '@hk/protocol';
import { loadAvailablePacks, readPackFile } from '../io.ts';
import { type CommandResult, formatDiagnostic } from '../result.ts';

export interface ValidateOptions {
  path: string;
  packsDir?: string;
}

export function runValidate(opts: ValidateOptions): CommandResult {
  if (!existsSync(opts.path)) return { exitCode: 2, lines: [`file not found: ${opts.path}`] };
  let input: unknown;
  try {
    input = readPackFile(opts.path);
  } catch (e) {
    return { exitCode: 2, lines: [`cannot read ${opts.path}: ${(e as Error).message}`] };
  }
  const parsed = parsePack(input);
  if (!parsed.ok)
    return { exitCode: 1, lines: ['schema errors:', ...formatIssues(parsed.issues).map((l) => `  ${l}`)] };

  const { packs, lines } = loadAvailablePacks(opts.packsDir);
  const diagnostics = validatePack(parsed.pack, packs);
  const out = [...lines, ...diagnostics.map(formatDiagnostic)];
  const errors = hasErrors(diagnostics);
  out.push(
    errors
      ? `FAILED: ${parsed.pack.id}@${parsed.pack.version}`
      : `OK: ${parsed.pack.id}@${parsed.pack.version} (${parsed.pack.entities.length} entities, ${diagnostics.length} warnings)`,
  );
  return { exitCode: errors ? 1 : 0, lines: out };
}
