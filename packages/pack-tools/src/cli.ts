#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runValidate } from './commands/validate.ts';
import { runBuild } from './commands/build.ts';
import { runDiff } from './commands/diff.ts';
import { runI18nExtract } from './commands/i18n-extract.ts';
import type { CommandResult } from './result.ts';

const USAGE = [
  'herokeep-pack <command> [options]',
  '  validate <pack.json|yaml> [--packs <dir>]',
  '  build <dir> [--out <file>] [--packs <dir>]',
  '  diff <a> <b>',
  '  i18n extract <pack> --locale <xx> [--out <file>]',
].join('\n');

export function main(argv: string[]): CommandResult {
  try {
    const [command, ...rest] = argv;
    if (command === 'validate') {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { packs: { type: 'string' } },
        allowPositionals: true,
      });
      const path = positionals[0];
      if (!path) return { exitCode: 2, lines: [USAGE] };
      return runValidate({ path, ...(values.packs !== undefined && { packsDir: values.packs }) });
    }
    if (command === 'build') {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { out: { type: 'string' }, packs: { type: 'string' } },
        allowPositionals: true,
      });
      const dir = positionals[0];
      if (!dir) return { exitCode: 2, lines: [USAGE] };
      return runBuild({ dir, ...(values.out !== undefined && { out: values.out }), ...(values.packs !== undefined && { packsDir: values.packs }) });
    }
    if (command === 'diff') {
      const { positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
      });
      const a = positionals[0];
      const b = positionals[1];
      if (!a || !b) return { exitCode: 2, lines: [USAGE] };
      return runDiff({ a, b });
    }
    if (command === 'i18n') {
      const subcommand = rest[0];
      if (subcommand === 'extract') {
        const { values, positionals } = parseArgs({
          args: rest.slice(1),
          options: { locale: { type: 'string' }, out: { type: 'string' } },
          allowPositionals: true,
        });
        const path = positionals[0];
        if (!path || !values.locale) return { exitCode: 2, lines: [USAGE] };
        return runI18nExtract({ path, locale: values.locale, ...(values.out !== undefined && { out: values.out }) });
      }
      return { exitCode: 2, lines: [USAGE] };
    }
    return { exitCode: 2, lines: [USAGE] };
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code && String(err.code).startsWith('ERR_PARSE_ARGS')) {
      return { exitCode: 2, lines: [String(err.message), USAGE] };
    }
    throw e;
  }
}

if (process.argv[1] && /cli\.(js|ts)$/.test(process.argv[1])) {
  const r = main(process.argv.slice(2));
  for (const line of r.lines) (r.exitCode === 0 ? console.log : console.error)(line);
  process.exit(r.exitCode);
}
