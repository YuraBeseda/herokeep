// @ts-check
const eslint = require('@eslint/js');
const { defineConfig, globalIgnores } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  globalIgnores(['dist/**', '.angular/**', 'coverage/**']),
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      // Repo-shared TS ruleset (mirrors root eslint.config.js).
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // Component templates only — excludes the static src/index.html shell, which is not an
    // Angular template and should not be linted with template/i18n rules.
    files: ['src/app/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      // NOTE: angular-eslint@22.4.0 changed this rule's schema — `checkAttributes` is now
      // boolean-only (with a separate `ignoreAttributes` allow-list), not the array-of-
      // attributes-to-check form used by older angular-eslint majors. `checkAttributes: true`
      // with the rule's default ignore-list still checks title/placeholder/aria-label/alt
      // (none of those four are in the default ignore-list), matching this rule's intent.
      '@angular-eslint/template/i18n': [
        'error',
        { checkId: false, checkText: true, checkAttributes: true },
      ],
    },
  },
]);
