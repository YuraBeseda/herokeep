import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parityGaps, unusedKeys } from './i18n-keys-lib.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'hk-i18n-fx-'));
  for (const [scope, langs] of Object.entries(files)) {
    mkdirSync(join(root, scope), { recursive: true });
    for (const [lang, tree] of Object.entries(langs)) {
      writeFileSync(join(root, scope, `${lang}.json`), JSON.stringify(tree));
    }
  }
  return root;
}

test('a uk file missing one key fails the parity check', () => {
  const root = fixture({
    demo: { en: { a: 'A', b: 'B' }, ru: { a: 'А', b: 'Б' }, uk: { a: 'А' } },
  });
  assert.deepEqual(parityGaps(root), ['demo/uk is missing b']);
});

test('matching ru and uk files pass', () => {
  const root = fixture({ demo: { en: { a: 'A' }, ru: { a: 'А' }, uk: { a: 'А' } } });
  assert.deepEqual(parityGaps(root), []);
});

test('an en key no code uses fails, a literal or prefixed use passes, an allow-list entry passes', () => {
  const root = fixture({
    demo: {
      en: { used: 'x', fam: { one: '1', two: '2' }, dead: 'x', kept: { a: 'x' } },
      ru: {},
      uk: {},
    },
  });
  const source = "t('used'); t(`fam.${v}`);";
  assert.deepEqual(unusedKeys(root, source, {}), ['demo:dead', 'demo:kept.a']);
  assert.deepEqual(unusedKeys(root, source, { 'demo:kept.': 'built at run time' }), ['demo:dead']);
});
