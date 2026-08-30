// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/schema/*.json']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Engine determinism contract (docs/02-architecture/05-rules-engine.md)
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/dice/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Engine code must be deterministic.' },
        {
          object: 'Math',
          property: 'random',
          message: 'Engine code must be deterministic; use dice/ with injectable RNG.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Engine code must be deterministic.' },
      ],
    },
  },
  {
    // Locale-dependent ops restricted outside i18n/ (docs/02-architecture/05-rules-engine.md)
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/dice/**', 'packages/engine/src/i18n/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Engine code must be deterministic.' },
        {
          selector: "CallExpression[callee.property.name='localeCompare']",
          message: 'Locale-dependent string ops only in i18n/.',
        },
        {
          selector: 'CallExpression[callee.property.name=/^toLocale/]',
          message: 'Locale-dependent string ops only in i18n/.',
        },
        { selector: "MemberExpression[object.name='Intl']", message: 'Intl only in i18n/.' },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
  },
]);
