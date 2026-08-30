#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runValidate } from './commands/validate.ts';
import type { CommandResult } from './result.ts';

const USAGE = [
  'herokeep-pack <command> [options]',
  '  validate <pack.json|yaml> [--packs <dir>]',
  '  build <dir> [--out <file>] [--packs <dir>]',
  '  diff <a> <b>',
  '  i18n extract <pack> --locale <xx> [--out <file>]',
].join('\n');

export function main(argv: string[]): CommandResult {
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
  return { exitCode: 2, lines: [USAGE] };
}

if (process.argv[1] && /cli\.(js|ts)$/.test(process.argv[1])) {
  const r = main(process.argv.slice(2));
  for (const line of r.lines) (r.exitCode === 0 ? console.log : console.error)(line);
  process.exit(r.exitCode);
}
