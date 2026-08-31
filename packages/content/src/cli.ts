import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { validatePack } from '@hk/engine';
import { buildPack, writePack } from './build.ts';
import { PACK_ID, PACK_VERSION } from './version.ts';

/** `packages/content/dist/packs`, resolved from this module so the cwd never changes the target. */
const DEFAULT_OUT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist', 'packs');

/** Reads `--out <dir>` from `argv`, falling back to `DEFAULT_OUT`. */
function outDir(argv: string[]): string {
  const i = argv.indexOf('--out');
  if (i === -1) return DEFAULT_OUT;
  const value = argv[i + 1];
  if (!value) throw new Error('cli: --out requires a directory');
  return resolve(value);
}

/**
 * Builds the pack and validates it standalone. Writes it and prints the OK line when it is clean;
 * lists every diagnostic on stderr and exits 1 otherwise, leaving no artifact behind.
 */
function main(argv: string[]): void {
  const pack = buildPack();
  const diagnostics = validatePack(pack, []);
  if (diagnostics.length > 0) {
    process.stderr.write(`FAIL ${PACK_ID}@${PACK_VERSION}: ${diagnostics.length} diagnostics\n`);
    for (const d of diagnostics) {
      process.stderr.write(`  ${d.severity} ${d.code} ${d.path ?? '-'} ${d.message}\n`);
    }
    process.exitCode = 1;
    return;
  }
  const path = writePack(outDir(argv), pack);
  process.stdout.write(
    `OK ${PACK_ID}@${PACK_VERSION}: ${pack.entities.length} entities, ${statSync(path).size} bytes, 0 diagnostics\n`,
  );
}

main(process.argv.slice(2));
