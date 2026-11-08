import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UI_ICONS } from '../src/app/ui/icons/vocabulary.ts';

export interface IconsMap {
  categories: Record<string, string>;
  entities: Record<string, string>;
}

export interface SpriteBuildResult {
  ids: string[];
  authors: string[];
}

const GI_PREFIX = 'gi:';
const UI_SYMBOL_PREFIX = 'ui-';

/** The `ui` section: `UI_ICONS` from `src/app/ui/icons/vocabulary.ts` (name -> game-icons slug). */
export type UiIconMap = Record<string, { gi: string }>;

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
 * A hard-coded white fill. game-icons draws its foreground white on a black square; a presentation
 * attribute beats the `fill: currentColor` that `.hk-icon` inherits, so it is dropped and the
 * symbol takes the surrounding text colour.
 */
const WHITE_FILL_ATTR_RE = /\s+fill="(?:#fff(?:fff)?|white)"/gi;

/** Leading `<circle .../>` tags of a "badge" glyph: the filled disc, then the white ring. */
const BADGE_DISC_RE = /^<circle\b[^>]*\/>\s*<circle\b[^>]*\/>\s*/;
const STANDARD_VIEWBOX = '0 0 512 512';
/** The badges author draws on a 256 box with a 20-unit margin around the artwork; discs removed. */
const BADGE_VIEWBOX = '20 20 216 216';

/**
 * Converts one vendored game-icons SVG into a symbol's viewBox and inner artwork: strips the
 * `<svg>` wrapper and, if present, the standard black background square
 * (see `isStandardBackgroundTag`). The nine disc-style "badges" glyphs (256 box, a filled disc
 * and a white ring behind the artwork) lose both circles and use the 216-unit box so they match
 * the others in weight (design-system README, Iconography).
 */
function convertIcon(svgText: string, slug: string): { viewBox: string; inner: string } {
  const match = svgText.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/);
  if (!match) throw new Error(`build-sprite: ${slug}.svg is not a well-formed <svg> document`);
  let inner = match[2].trim();
  const sourceViewBox = match[1].match(/viewBox="([^"]*)"/)?.[1] ?? STANDARD_VIEWBOX;
  const disc = inner.match(BADGE_DISC_RE);
  if (sourceViewBox === '0 0 256 256' && disc) {
    return {
      viewBox: BADGE_VIEWBOX,
      inner: inner.slice(disc[0].length).replace(WHITE_FILL_ATTR_RE, ''),
    };
  }
  const leadingTag = inner.match(LEADING_SELF_CLOSING_TAG_RE);
  if (leadingTag && isStandardBackgroundTag(leadingTag[0])) {
    inner = inner.slice(leadingTag[0].length);
  }
  return { viewBox: STANDARD_VIEWBOX, inner: inner.replace(WHITE_FILL_ATTR_RE, '') };
}

/** Transforms one vendored game-icons SVG into a sprite `<symbol id="gi-<slug>">`. */
export function transformIconToSymbol(svgText: string, slug: string): string {
  const { viewBox, inner } = convertIcon(svgText, slug);
  return `<symbol id="gi-${slug}" viewBox="${viewBox}">${inner}</symbol>`;
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
 * the icons map at `mapPath` or in the `ui` vocabulary, plus one `<symbol id="ui-<name>">` per `ui`
 * entry that references its glyph) and `outDir/authors.json` (sorted unique vendor author names).
 * Throws listing every slug with no matching `vendorDir/<author>/<slug>.svg` file.
 */
export function buildSprite(
  mapPath: string,
  vendorDir: string,
  outDir: string,
  ui: UiIconMap = {},
): SpriteBuildResult {
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as IconsMap;
  const values = new Set([...Object.values(map.categories), ...Object.values(map.entities)]);

  const mapSlugs = [...values].map((value) => {
    if (!value.startsWith(GI_PREFIX)) {
      throw new Error(
        `build-sprite: icons map value "${value}" does not start with "${GI_PREFIX}"`,
      );
    }
    return value.slice(GI_PREFIX.length);
  });
  const uiNames = Object.keys(ui).sort();
  // Every glyph a ui entry draws gets its own `gi-<slug>` symbol too, so a `ui-<name>` symbol is
  // just a reference and the artwork exists once.
  const slugs = [...new Set([...mapSlugs, ...uiNames.map((name) => ui[name].gi)])].sort();

  const missing: string[] = [];
  const symbols: string[] = [];
  const authorsUsed = new Set<string>();
  const viewBoxes = new Map<string, string>();

  for (const slug of slugs) {
    const found = findVendorFile(vendorDir, slug);
    if (!found) {
      missing.push(slug);
      continue;
    }
    authorsUsed.add(found.author);
    const { viewBox, inner } = convertIcon(readFileSync(found.path, 'utf8'), slug);
    viewBoxes.set(slug, viewBox);
    symbols.push(`<symbol id="gi-${slug}" viewBox="${viewBox}">${inner}</symbol>`);
  }

  if (missing.length > 0) {
    throw new Error(`build-sprite: no vendored icon file for slug(s): ${missing.join(', ')}`);
  }

  for (const name of uiNames) {
    const { gi } = ui[name];
    symbols.push(
      `<symbol id="${UI_SYMBOL_PREFIX}${name}" viewBox="${viewBoxes.get(gi)}"><use href="#gi-${gi}"/></symbol>`,
    );
  }

  const authors = [...authorsUsed].sort();
  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols
    .map((symbol) => `  ${symbol}`)
    .join('\n')}\n</svg>\n`;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'sprite.svg'), sprite, 'utf8');
  writeFileSync(join(outDir, 'authors.json'), `${JSON.stringify(authors, null, 2)}\n`, 'utf8');

  return {
    ids: [
      ...slugs.map((slug) => `gi-${slug}`),
      ...uiNames.map((name) => `${UI_SYMBOL_PREFIX}${name}`),
    ],
    authors,
  };
}

/** Default paths for `pnpm --filter web build:sprite`, resolved from this module's location. */
function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const mapPath = join(here, '../../../packages/content/src/icons/icons-map.json');
  const vendorDir = join(here, '../vendor/game-icons');
  const outDir = join(here, '../src/assets/icons');
  const { ids, authors } = buildSprite(mapPath, vendorDir, outDir, UI_ICONS);
  process.stdout.write(
    `OK build-sprite: ${ids.length} icons, ${authors.length} authors -> ${outDir}\n`,
  );
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
