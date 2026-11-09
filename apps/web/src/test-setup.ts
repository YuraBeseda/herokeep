// Global Vitest setup (wired via angular.json's `test.options.setupFiles`), run once before any
// spec file's module graph loads. `dexie` reads `globalThis.indexedDB` exactly once, at its own
// module's top-level scope (see node_modules/dexie/dist/dexie.js), and this test builder shares
// modules across spec files (`splitting`/`isolate` both default away from per-file isolation) —
// so installing the polyfill per-spec-file is not reliably early enough. This file guarantees it
// runs before any test file (and therefore before `dexie` itself) is ever imported.
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';

// Spec files share one document in this runner, and several specs open dialogs through the CDK
// overlay without closing them. A leftover dialog (with its inputs and buttons) made later specs'
// `document.querySelector('input')` hit a stale element, a load-dependent flake in the dialog
// specs. Drop any overlay content after every test so each starts from an empty overlay.
afterEach(() => {
  // Some specs (tools/) run in a node environment with no document.
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.replaceChildren());
});
