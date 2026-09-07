import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TOKENS } from './tokens.ts';

function block(selector: string, entries: Record<string, string>): string {
  return `${selector} {\n${Object.entries(entries)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join('\n')}\n}\n`;
}

export function emitCss(): string {
  return [
    block(':root', { ...TOKENS.shared, ...TOKENS.dark }),
    block("[data-theme='light']", TOKENS.light),
    block("[data-theme='dark']", TOKENS.dark),
  ].join('\n');
}

export function emitScss(): string {
  const formatTokens = (tokens: Record<string, string>): string => {
    return Object.entries(tokens)
      .map(([k, v]) => `    ${k}: '${v.replace(/'/g, "\\'")}'`)
      .join(',\n');
  };

  return `$hk-tokens: (
  shared: (
${formatTokens(TOKENS.shared)},
  ),
  light: (
${formatTokens(TOKENS.light)},
  ),
  dark: (
${formatTokens(TOKENS.dark)},
  ),
);\n`;
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
