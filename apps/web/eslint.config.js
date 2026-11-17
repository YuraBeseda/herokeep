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
          // `app-*`: view/app-internal attribute directives (e.g. `appTabFocusable`). `hk-*`:
          // design-system attribute directives meant to attach to any `hk-*` component's host
          // (e.g. `hkDerived` — `stat-tile`'s own SKILL.md documents this exact name, mirroring
          // `component-selector`'s existing `app`/`hk` dual-prefix allowance below).
          prefix: ['app', 'hk'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        [
          // Views/shell: `app-*` elements. Design-system components: `hk-*` elements
          // (`hk-card`, `hk-chip`, …) or `hk-*` attribute selectors on a native element
          // (`button[hk-button]`) so consumers get native semantics for free.
          { type: 'element', prefix: ['app', 'hk'], style: 'kebab-case' },
          { type: 'attribute', prefix: 'hk', style: 'kebab-case' },
        ],
      ],
    },
  },
  {
    // Component templates only — excludes the static src/index.html shell, which is not an
    // Angular template and should not be linted with template/i18n rules.
    files: ['src/app/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      // `hk-icon-button` (ui/icon-button) is icon-only by design: its required `hint` input is the
      // accessible name (aria-label) and tooltip, so `hint` counts as content here. The hint lint
      // (src/testing/icon-hints.spec.ts) fails any `hk-icon-button` that omits it.
      '@angular-eslint/template/elements-content': ['error', { allowList: ['hint'] }],
      // NOTE: angular-eslint@22.4.0 changed this rule's schema — `checkAttributes` is now
      // boolean-only (with a separate `ignoreAttributes` allow-list), not the array-of-
      // attributes-to-check form used by older angular-eslint majors. `checkAttributes: true`
      // with the rule's default ignore-list still checks title/placeholder/aria-label/alt
      // (none of those four are in the default ignore-list), matching this rule's intent.
      '@angular-eslint/template/i18n': [
        'error',
        {
          checkId: false,
          checkText: true,
          checkAttributes: true,
          // Additive to the rule's default ignore list: SVG geometry/filter attributes and
          // `inputmode` hold identifiers and numbers, never user-visible text (the `ui/` SVG
          // components draw seals, shields and texture filters with them).
          ignoreAttributes: [
            'd',
            'transform',
            'text-anchor',
            'dominant-baseline',
            'color-interpolation-filters',
            'result',
            'in',
            'in2',
            'operator',
            'inputmode',
            // Element ids and MIME types, never user-visible text.
            'aria-labelledby',
            'aria-controls',
            'accept',
          ],
        },
      ],
    },
  },
]);
