#!/usr/bin/env node
// Wired into `pnpm --filter web lint` (see package.json).
//
// Fails the build when the `en` translation files under `src/assets/i18n` are missing keys that
// templates/components use; only warns (non-blocking) when `ru`/`uk` are missing keys.
//
// Why this script exists instead of a bare `transloco-keys-manager find` call: the keys-manager
// 8.1.1 "detective" (`find`) has no per-language flag — `-l/--langs` only affects the extractor
// (which languages to *generate*), never which existing translation files the detective
// *compares*. `find` always globs every `*.json` file under `--translations-path` and exits 1 if
// ANY of them is missing a key, with no way to distinguish which language failed from the exit
// code alone. To get an en-fails/ru+uk-warns split with the real CLI, this script mirrors only
// the relevant per-scope language file(s) into a scratch directory for each pass and points
// `find -p` at that mirror, so each pass's exit code reflects only the language(s) it mirrored.
// See task-4-report.md for the full investigation.
//
// task-14: two KNOWN, BENIGN noise classes in this CLI's output — neither is fixable from this
// wrapper (both live in `@jsverse/transloco-keys-manager`'s own AST-based static extraction,
// `keys-builder/typescript`/`keys-builder/template`, not in anything this script controls), so
// they're documented here instead of "fixed":
//
// 1. "Extra Keys" column noise (non-blocking — see `compare-keys-to-files.js`: only a non-empty
//    "Missing Keys" list calls `process.exit(1)`; "Extra Keys" never fails a run of this script,
//    en included). The extractor only registers a key as "used" when it finds a literal string
//    argument directly inside a marked `t(...)`-shaped call; it CANNOT see a key referenced
//    indirectly — through a named constant (`character.store.ts`'s
//    `CharacterStoreNotLeaderError.code = 'characters.not-leader'`, read as `t(error.code)`) or
//    assembled from a runtime value (`event-sentence.pipe.ts`'s `eventKey()`, which builds
//    `characters.timeline.<dash-type>` from an event's own `type` — see that file's own
//    "DYNAMIC-KEY pattern" doc). Both are real, live usages; the tool just can't statically prove
//    it. This affects EVERY language equally (as of this task, ~156 of the `characters` scope's
//    387 keys are flagged this way in en/ru/uk alike — verify with a real key-set diff, not this
//    table, before treating any of them as dead) and should NEVER be "fixed" by running this
//    package's own `--remove-extra-keys`/`-R` — that flag deletes the JSON key outright, which
//    would break the app for exactly the keys this note describes.
//
// 2. "Missing Keys" false positives from comment text (BLOCKING if it recurs — task-12-report.md's
//    real investigation). The same extractor's call-shaped-text scan matches inside comments too,
//    not just real code: a JSDoc/line comment that literally reads like `t(message.key,
//    message.params)` (illustrating a call SHAPE) gets parsed as a real call, registering
//    `message.key`/`message.params` as "used" keys that exist in no translation file — which then
//    fails the (blocking) `en` pass for a totally unrelated file. Description text near
//    translate-call code must describe the call shape in prose, never as literal
//    `<ident>(<ident>.<ident>, ...)`-shaped text.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(scriptDir);
const i18nRoot = join(webRoot, 'src/assets/i18n');
const cliEntry = join(webRoot, 'node_modules/@jsverse/transloco-keys-manager/index.js');
const configPath = join(webRoot, 'transloco.config.js');

/**
 * Recursively copies every `<...scope>/<lang>.json` file under `srcRoot` whose filename is in
 * `langFileNames` into `destRoot`, preserving the scope sub-path.
 */
function mirrorLangFiles(srcRoot, destRoot, langFileNames) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!langFileNames.includes(entry)) continue;
      const dest = join(destRoot, relative(srcRoot, fullPath));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(fullPath, dest);
    }
  };
  walk(srcRoot);
}

function runFind(translationsPath) {
  const result = spawnSync(
    process.execPath,
    [cliEntry, 'find', '--config', configPath, '--translations-path', translationsPath],
    { cwd: webRoot, encoding: 'utf8' },
  );
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return result.status ?? 1;
}

// `process.exit()` does not run pending `finally` blocks in Node.js, so the exit code is only
// captured here — the actual `process.exit()` call happens after the `try`/`finally` below has
// run to completion, so the scratch directory is always removed regardless of which path exits
// non-zero.
let exitCode = 0;

const scratchRoot = mkdtempSync(join(tmpdir(), 'hk-i18n-check-'));
try {
  const enMirror = join(scratchRoot, 'en');
  mkdirSync(enMirror, { recursive: true });
  mirrorLangFiles(i18nRoot, enMirror, ['en.json']);
  const enStatus = runFind(enMirror);
  if (enStatus !== 0) {
    console.error(
      '\n[i18n:check] keys-manager reported a failure for English (en) — missing keys or a CLI error; see output above.\n',
    );
    exitCode = enStatus;
  } else {
    const warnMirror = join(scratchRoot, 'warn');
    mkdirSync(warnMirror, { recursive: true });
    mirrorLangFiles(i18nRoot, warnMirror, ['ru.json', 'uk.json']);
    const warnStatus = runFind(warnMirror);
    if (warnStatus !== 0) {
      console.warn(
        '\n[i18n:check] Missing ru/uk translation keys detected (non-blocking warning — see table above).\n',
      );
    }
  }
} finally {
  rmSync(scratchRoot, { recursive: true, force: true });
}

process.exit(exitCode);
