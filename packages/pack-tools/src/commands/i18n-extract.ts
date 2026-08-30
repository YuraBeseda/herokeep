import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type Choice, type Pack } from '@hk/protocol';
import { loadPackFile } from '../io.ts';
import type { CommandResult } from '../result.ts';

type Strings = Record<string, Record<string, string>>;

const strip = (id: string) => id.slice(id.indexOf(':') + 1);

function choiceStrings(out: Strings, c: Choice): void {
  out[strip(c.id)] = { prompt: c.prompt };
}

export function collectTranslatableStrings(pack: Pack): Strings {
  const out: Strings = {};
  const add = (key: string, field: string, text: string | undefined) => {
    if (!text) return;
    (out[key] ??= {})[field] = text;
  };
  for (const e of pack.entities) {
    const key = strip(e.id);
    add(key, 'name', e.name);
    add(key, 'description', e.description);
    e.effects.forEach((ef, i) => {
      if (ef.type === 'feature.text' || ef.type === 'action.define') {
        add(key, `effects.${i}.name`, ef.name);
        add(key, `effects.${i}.description`, ef.description);
      } else if (ef.type === 'resource.define') add(key, `effects.${i}.name`, ef.name);
    });
    e.choices.forEach((c) => choiceStrings(out, c));
    if (e.type === 'class' || e.type === 'subclass') {
      e.levels.forEach((row) => row.choices.forEach((c) => choiceStrings(out, c)));
    }
  }
  return out;
}

const q = (s: string) => JSON.stringify(s); // JSON strings are valid YAML double-quoted scalars

export function buildTranslationSkeleton(pack: Pack, locale: string): string {
  const major = pack.version.split('.')[0];
  const lines = [
    'format: 1',
    `id: ${q(`${pack.id}-${locale}`)}`,
    `version: ${q(pack.version)}`,
    'kind: translation',
    ...(pack.system ? [`system: ${q(pack.system)}`] : []),
    `locale: ${q(locale)}`,
    `name: ${q(`${pack.name} — ${locale}`)}`,
    'translates:',
    `  id: ${q(pack.id)}`,
    `  range: ${q(`^${major}`)}`,
    'strings:',
  ];
  const strings = collectTranslatableStrings(pack);
  for (const key of Object.keys(strings).sort()) {
    lines.push(`  ${q(key)}:`);
    for (const [field, source] of Object.entries(strings[key]!)) {
      for (const srcLine of source.split('\n')) lines.push(`    # en: ${srcLine}`);
      lines.push(`    ${q(field)}: ""`);
    }
  }
  return lines.join('\n') + '\n';
}

export function runI18nExtract(opts: { path: string; locale: string; out?: string }): CommandResult {
  const loaded = loadPackFile(opts.path);
  if (!loaded.ok) return loaded.result;
  const pack = loaded.pack;
  const out = opts.out ?? join(dirname(opts.path), `${pack.id}-${opts.locale}.yaml`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildTranslationSkeleton(pack, opts.locale));
  const strings = collectTranslatableStrings(pack);
  const count = Object.values(strings).reduce((n, f) => n + Object.keys(f).length, 0);
  return {
    exitCode: 0,
    lines: [`wrote ${basename(out)} (${count} strings to translate)`],
  };
}
