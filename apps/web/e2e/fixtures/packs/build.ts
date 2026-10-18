import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regenerates the checked-in `.hkpack` fixtures the e2e suite imports (plan 15 task 8):
 * `sample-content/` → `sample-content.hkpack` (1.0.0) and `sample-content-v2/` →
 * `sample-content-v2.hkpack` (1.1.0, the weapon renamed with `deprecated.replacedBy`). Runs the real
 * `herokeep-pack build --zip` CLI against the built core pack; the build is deterministic, so a
 * rebuild reproduces the checked-in bytes (`packages/pack-tools/test/fixture-packs.test.ts` asserts
 * it). CI and e2e use the checked-in files; run this only after editing a source folder:
 *
 *   pnpm --filter @hk/pack-tools build && pnpm --filter @hk/content build:pack
 *   node apps/web/e2e/fixtures/packs/build.ts
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../../..');
const cli = join(repo, 'packages/pack-tools/dist/cli.js');
const corePacks = join(repo, 'packages/content/dist/packs/srd-5e-2024');

if (!existsSync(cli))
  throw new Error(`${cli} not found — run "pnpm --filter @hk/pack-tools build" first`);
if (!existsSync(corePacks))
  throw new Error(`${corePacks} not found — run "pnpm --filter @hk/content build:pack" first`);
const coreDir = join(corePacks, readdirSync(corePacks).sort().at(-1) ?? '');

for (const [source, target] of [
  ['sample-content', 'sample-content.hkpack'],
  ['sample-content-v2', 'sample-content-v2.hkpack'],
] as const) {
  const manifest = JSON.parse(readFileSync(join(here, source, 'pack.json'), 'utf8')) as {
    id: string;
    version: string;
  };
  const out = join(mkdtempSync(join(tmpdir(), 'hk-e2e-pack-')), 'pack.json');
  execFileSync(
    process.execPath,
    [cli, 'build', join(here, source), '--zip', '--out', out, '--packs', coreDir],
    {
      stdio: 'inherit',
    },
  );
  copyFileSync(join(dirname(out), `${manifest.id}-${manifest.version}.hkpack`), join(here, target));
  console.log(`wrote ${join(here, target)}`);
}
