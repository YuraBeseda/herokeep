import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface IconsMap {
  categories: Record<string, string>;
  entities: Record<string, string>;
}

export interface SpriteBuildResult {
  ids: string[];
  authors: string[];
}

const GI_PREFIX = 'gi:';

/** A self-closing tag at the very start of a string, e.g. `<path d="..." fill="..."/>`. */
const LEADING_SELF_CLOSING_TAG_RE = /^<([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*\/>/;

/**
 * game-icons.net SVGs are always `<svg ... viewBox="0 0 512 512">BACKGROUND FOREGROUND</svg>`:
 * a full-canvas square (`d="M0 0h512v512H0z"`, no `fill` attribute or an explicit black one —
 * SVG's implicit fill is black) followed by one or more white foreground paths. Returns true
 * only for that exact standard background tag, so anything unexpected is kept rather than
 * silently dropped.
 */
function isStandardBackgroundTag(tag: string): boolean {
  const match = tag.match(LEADING_SELF_CLOSING_TAG_RE);
  if (!match || match[1] !== 'path') return false;
  const attrs = new Map([...match[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  if (attrs.get('d') !== 'M0 0h512v512H0z') return false;
  const fill = attrs.get('fill');
  return fill === undefined || /^(#000(000)?|black)$/i.test(fill);
}

/**
 * Transforms one vendored game-icons SVG into a sprite `<symbol>`: strips the `<svg>` wrapper
 * and, if present, the standard black background square (see `isStandardBackgroundTag`),
 * keeping only the foreground artwork.
 */
export function transformIconToSymbol(svgText: string, slug: string): string {
  const match = svgText.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/);
  if (!match) throw new Error(`build-sprite: ${slug}.svg is not a well-formed <svg> document`);
  let inner = match[1].trim();
  const leadingTag = inner.match(LEADING_SELF_CLOSING_TAG_RE);
  if (leadingTag && isStandardBackgroundTag(leadingTag[0])) {
    inner = inner.slice(leadingTag[0].length);
  }
  return `<symbol id="gi-${slug}" viewBox="0 0 512 512">${inner}</symbol>`;
}

/** Scans `vendorDir`'s author subdirectories (sorted) for the first `<author>/<slug>.svg`. */
function findVendorFile(
  vendorDir: string,
  slug: string,
): { path: string; author: string } | undefined {
  const authors = readdirSync(vendorDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const author of authors) {
    const candidate = join(vendorDir, author, `${slug}.svg`);
    if (existsSync(candidate)) return { path: candidate, author };
  }
  return undefined;
}

/**
 * Builds `outDir/sprite.svg` (one `<symbol id="gi-<slug>">` per distinct `gi:<slug>` value in
 * the icons map at `mapPath`) and `outDir/authors.json` (sorted unique vendor author names).
 * Throws listing every slug with no matching `vendorDir/<author>/<slug>.svg` file.
 */
export function buildSprite(mapPath: string, vendorDir: string, outDir: string): SpriteBuildResult {
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as IconsMap;
  const values = new Set([...Object.values(map.categories), ...Object.values(map.entities)]);

  const slugs = [...values]
    .map((value) => {
      if (!value.startsWith(GI_PREFIX)) {
        throw new Error(
          `build-sprite: icons map value "${value}" does not start with "${GI_PREFIX}"`,
        );
      }
      return value.slice(GI_PREFIX.length);
    })
    .sort();

  const missing: string[] = [];
  const symbols: string[] = [];
  const authorsUsed = new Set<string>();

  for (const slug of slugs) {
    const found = findVendorFile(vendorDir, slug);
    if (!found) {
      missing.push(slug);
      continue;
    }
    authorsUsed.add(found.author);
    symbols.push(transformIconToSymbol(readFileSync(found.path, 'utf8'), slug));
  }

  if (missing.length > 0) {
    throw new Error(`build-sprite: no vendored icon file for slug(s): ${missing.join(', ')}`);
  }

  const authors = [...authorsUsed].sort();
  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols
    .map((symbol) => `  ${symbol}`)
    .join('\n')}\n</svg>\n`;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'sprite.svg'), sprite, 'utf8');
  writeFileSync(join(outDir, 'authors.json'), `${JSON.stringify(authors, null, 2)}\n`, 'utf8');

  return { ids: slugs.map((slug) => `gi-${slug}`), authors };
}

/** Default paths for `pnpm --filter web build:sprite`, resolved from this module's location. */
function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const mapPath = join(here, '../../../packages/content/src/icons/icons-map.json');
  const vendorDir = join(here, '../vendor/game-icons');
  const outDir = join(here, '../src/assets/icons');
  const { ids, authors } = buildSprite(mapPath, vendorDir, outDir);
  process.stdout.write(
    `OK build-sprite: ${ids.length} icons, ${authors.length} authors -> ${outDir}\n`,
  );
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
