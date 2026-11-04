import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { THEME_IDS, TOKENS, resolveColor, themeValue, type ThemeId } from './tokens.ts';
import type { TokenEntry, TypeStyle } from './schema.ts';

type Entries = [name: string, value: string][];

const REFERENCE = /\{([a-z0-9-]+)\}/g;

function isThemed(token: TokenEntry): boolean {
  return typeof token.value !== 'string';
}

/** Tokens that carry theme-specific values live in the theme blocks; the rest in :root. */
const themedFamilies = (): TokenEntry[] => [
  ...TOKENS.color.tokens,
  ...TOKENS.shadow.tokens,
  ...TOKENS.decoration.tokens.filter(isThemed),
];

const sharedFamilies = (): TokenEntry[] => [
  ...TOKENS.spacing.tokens,
  ...TOKENS.radius.tokens,
  ...TOKENS.decoration.tokens.filter((t) => !isThemed(t)),
  ...TOKENS.duration.tokens,
  ...TOKENS.size.tokens,
  ...TOKENS.legacy.tokens,
];

function sharedEntries(): Entries {
  return [
    ...sharedFamilies().map((t): [string, string] => [t.name, themeValue(t, 'tavern')]),
    ['font-display', TOKENS.type.families.display],
    ['font-body', TOKENS.type.families.body],
  ];
}

/** CSS value for a token in a theme: `{other}` references become `var(--other)`. */
function cssValue(token: TokenEntry, theme: ThemeId): string {
  return themeValue(token, theme).replace(REFERENCE, 'var(--$1)');
}

function block(selector: string, entries: Entries): string {
  return `${selector} {\n${entries.map(([k, v]) => `  --${k}: ${v};`).join('\n')}\n}\n`;
}

function typeClass(style: TypeStyle, family: 'display' | 'body'): string {
  const decls = [
    `font-family: var(--font-${family})`,
    `font-size: ${style.fontSize}`,
    `line-height: ${style.lineHeight}`,
    `font-weight: ${style.fontWeight}`,
    ...(style.fontStyle ? [`font-style: ${style.fontStyle}`] : []),
    ...(style.name.startsWith('numeral-') ? ['font-variant-numeric: tabular-nums'] : []),
  ];
  return `.hk-type-${style.name} { ${decls.join('; ')}; }`;
}

export function emitCss(): string {
  const themeBlocks = THEME_IDS.map((theme) =>
    block(
      theme === 'tavern' ? `:root, [data-theme='tavern']` : `[data-theme='${theme}']`,
      themedFamilies().map((t): [string, string] => [t.name, cssValue(t, theme)]),
    ),
  );
  const typeClasses = TOKENS.type.groups.flatMap((g) => g.styles.map((s) => typeClass(s, g.family)));
  return [block(':root', sharedEntries()), ...themeBlocks, typeClasses.join('\n') + '\n'].join('\n');
}

function scssMap(key: string, entries: Entries): string {
  const body = entries.map(([k, v]) => `    ${k}: '${v.replace(/'/g, "\\'")}'`).join(',\n');
  return `  ${key}: (\n${body},\n  ),\n`;
}

export function emitScss(): string {
  const themes = THEME_IDS.map((theme) =>
    scssMap(theme, [
      ...TOKENS.color.tokens.map((t): [string, string] => [t.name, resolveColor(t.name, theme)]),
      ...themedFamilies()
        .filter((t) => !TOKENS.color.tokens.includes(t))
        .map((t): [string, string] => [t.name, themeValue(t, theme)]),
    ]),
  );
  return `$hk-tokens: (\n${scssMap('shared', sharedEntries())}${themes.join('')});\n`;
}

export function build(outDir?: string): { css: string; scss: string } {
  const dir = outDir ?? 'dist';
  mkdirSync(dir, { recursive: true });

  const cssPath = join(dir, 'tokens.css');
  const scssPath = join(dir, 'tokens.scss');

  writeFileSync(cssPath, emitCss());
  writeFileSync(scssPath, emitScss());

  return { css: cssPath, scss: scssPath };
}

// Module main guard: only run if this file is the entry point
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  build();
}
