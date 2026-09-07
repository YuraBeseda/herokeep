// @ts-check
// Config for `@jsverse/transloco-keys-manager` (the `extract`/`find` CLI), auto-discovered
// via cosmiconfig from `apps/web` (this file's directory). Shape follows the keys-manager's
// documented `transloco.config.js` format: top-level `rootTranslationsPath`/`langs` plus a
// `keysManager` block for extractor/detective-specific options.
//
// Scopes (e.g. `shell`) are NOT declared here — the keys-manager discovers them by statically
// scanning `keysManager.input` for `TRANSLOCO_SCOPE`/`provideTranslocoScope(...)` usage. No view
// registers a scope yet (Task 5 wires the shell scope into templates), so `extract`/`find` are
// currently a structural no-op for `assets/i18n/shell/*`; see task-4-report.md.
module.exports = {
  langs: ['en', 'ru', 'uk'],
  rootTranslationsPath: 'src/assets/i18n',
  keysManager: {
    input: ['src/app'],
    output: 'src/assets/i18n',
    marker: 't',
    sort: true,
    unflat: true,
  },
};
