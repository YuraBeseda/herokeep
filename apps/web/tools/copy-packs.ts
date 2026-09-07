import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Copies the two build-time pack assets (`packages/content/dist/packs`, the built core SRD pack;
 * `packages/content/translations/srd-5e-2024-ru-sample.json`, the tracked RU demo pack) into
 * `apps/web/public/packs`, so the existing `{ glob: "**​/*", input: "public" }` angular.json
 * asset entry copies them to `dist/**​/packs/**` for `PackLoader` to `fetch()` at runtime.
 *
 * A dedicated `angular.json` asset entry pointing straight at `../../packages/content/...` was
 * tried first and rejected by the Angular application builder: it resolves `workspaceRoot` to
 * this project's own root (`apps/web`, since `angular.json` lives here rather than at the pnpm
 * workspace root), and asset `input` paths must resolve inside it
 * ("The ../../packages/content/dist/packs asset path must be within the workspace root.").
 * Copying into `public/` — already gitignored under `public/packs/`, see `.gitignore` — sidesteps
 * that restriction without changing the project's layout.
 */
export function copyPacks(contentDistDir: string, ruSamplePath: string, outDir: string): void {
  if (!existsSync(contentDistDir)) {
    throw new Error(
      `copy-packs: ${contentDistDir} not found — run "pnpm --filter @hk/content build:pack" first`,
    );
  }
  if (!existsSync(ruSamplePath)) {
    throw new Error(`copy-packs: ${ruSamplePath} not found`);
  }
  rmSync(outDir, { recursive: true, force: true });
  cpSync(contentDistDir, outDir, { recursive: true });
  const demoDir = join(outDir, 'demo');
  mkdirSync(demoDir, { recursive: true });
  cpSync(ruSamplePath, join(demoDir, 'srd-5e-2024-ru-sample.json'));
}

/** Default paths for `pnpm --filter web build:packs`, resolved from this module's location. */
function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const contentDistDir = join(here, '../../../packages/content/dist/packs');
  const ruSamplePath = join(
    here,
    '../../../packages/content/translations/srd-5e-2024-ru-sample.json',
  );
  const outDir = join(here, '../public/packs');
  copyPacks(contentDistDir, ruSamplePath, outDir);
  process.stdout.write(`OK copy-packs -> ${outDir}\n`);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
