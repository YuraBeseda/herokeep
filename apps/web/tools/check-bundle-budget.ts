import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Real gzip measurement gate for the production initial bundle (controller ruling R5,
 * task-14-brief.md: the `angular.json` `budgets` check compares RAW esbuild output size, which
 * has no reliable relationship to the actual over-the-wire size — Task 9 already had to raise
 * that raw-size budget from 500 kB/1 MB to 1 MB/1.5 MB just to stop it tripping on a bundle whose
 * real gzip transfer was ~214 kB, comfortably under the roadmap's binding line. This script
 * measures — never estimates — the real gzip bytes of every file the built `index.html`
 * references eagerly (script `src`, `rel="stylesheet"`, and `rel="modulepreload"` links; a lazy
 * route/component chunk is fetched later via dynamic `import()` and is never referenced from
 * `index.html`, so it's correctly excluded) and fails if that total exceeds the budget.
 */
export const BUDGET_BYTES = 600 * 1024; // docs/02-architecture/09-frontend-architecture.md: ≤600 KB gzip.

const TAG_RE = /<(script|link)\b[^>]*>/gi;
const ATTR_RE = (name: string): RegExp => new RegExp(`${name}="([^"]*)"`, 'i');

/**
 * Extracts the initial-bundle file references from a built `index.html`: every `<script src>`
 * and every `<link href>` whose `rel` is `stylesheet` or `modulepreload`. Lazy chunks are never
 * referenced here (Angular fetches them via dynamic `import()` at runtime), so this list is
 * exactly the set of files a fresh visit must download before the app becomes interactive.
 */
export function parseInitialFiles(indexHtml: string): string[] {
  const files = new Set<string>();
  for (const [tag, tagName] of indexHtml.matchAll(TAG_RE)) {
    const src = ATTR_RE('src').exec(tag)?.[1];
    if (tagName.toLowerCase() === 'script' && src) {
      files.add(src);
      continue;
    }
    if (tagName.toLowerCase() === 'link') {
      const rel = ATTR_RE('rel').exec(tag)?.[1];
      const href = ATTR_RE('href').exec(tag)?.[1];
      if (href && (rel === 'stylesheet' || rel === 'modulepreload')) {
        files.add(href);
      }
    }
  }
  return [...files];
}

export interface FileGzipSize {
  readonly path: string;
  readonly gzipBytes: number;
}

export interface BundleBudgetResult {
  readonly files: readonly FileGzipSize[];
  readonly totalGzipBytes: number;
}

/**
 * Gzips each initial-bundle file's actual on-disk bytes (Node's `zlib`, default compression
 * level — the same the built-in Node/most static file servers use) and sums them. `readFile` is
 * injected so this pure-ish core is unit-testable against an in-memory fixture without touching
 * a real `dist/` directory.
 */
export function measureGzipTotal(
  browserDir: string,
  initialFiles: readonly string[],
  readFile: (path: string) => Buffer = readFileSync,
): BundleBudgetResult {
  const files = initialFiles.map((relativePath) => {
    const content = readFile(join(browserDir, relativePath));
    return { path: relativePath, gzipBytes: gzipSync(content).length };
  });
  const totalGzipBytes = files.reduce((sum, file) => sum + file.gzipBytes, 0);
  return { files, totalGzipBytes };
}

function formatKb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const browserDir = join(here, '../dist/web/browser');
  const indexPath = join(browserDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`check-bundle-budget: ${indexPath} not found — run "ng build" first`);
  }

  const indexHtml = readFileSync(indexPath, 'utf-8');
  const initialFiles = parseInitialFiles(indexHtml);
  const result = measureGzipTotal(browserDir, initialFiles);

  const sorted = [...result.files].sort((a, b) => b.gzipBytes - a.gzipBytes);
  const lines = [
    'check-bundle-budget: initial bundle, real gzip (not estimated):',
    ...sorted.map((file) => `  ${file.path}: ${formatKb(file.gzipBytes)} kB gzip`),
    `  TOTAL: ${formatKb(result.totalGzipBytes)} kB gzip (budget: ${formatKb(BUDGET_BYTES)} kB)`,
  ];
  process.stdout.write(lines.join('\n') + '\n');

  if (result.totalGzipBytes > BUDGET_BYTES) {
    throw new Error(
      `check-bundle-budget: initial bundle is ${formatKb(result.totalGzipBytes)} kB gzip, ` +
        `over the ${formatKb(BUDGET_BYTES)} kB budget (docs/02-architecture/09-frontend-architecture.md).`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
