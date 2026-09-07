// Global Vitest setup (wired via angular.json's `test.options.setupFiles`), run once before any
// spec file's module graph loads. `dexie` reads `globalThis.indexedDB` exactly once, at its own
// module's top-level scope (see node_modules/dexie/dist/dexie.js), and this test builder shares
// modules across spec files (`splitting`/`isolate` both default away from per-file isolation) —
// so installing the polyfill per-spec-file is not reliably early enough. This file guarantees it
// runs before any test file (and therefore before `dexie` itself) is ever imported.
import 'fake-indexeddb/auto';
