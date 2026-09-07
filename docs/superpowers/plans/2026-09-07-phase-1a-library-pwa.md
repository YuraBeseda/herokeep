# Phase 1a (plan 3 of 3) — Angular Library PWA (`apps/web`, `@hk/ui-tokens`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the installable Library PWA — design tokens + base components, an Angular 22 zoneless shell with Transloco en/ru/uk, a service worker that precaches the `srd-5e-2024` pack, and a Library that browses, searches and renders every SRD entity offline, with the RU sample pack importable from Settings.

**Architecture:** `packages/ui-tokens` is a build-time package emitting `tokens.css` (runtime custom properties per theme) and `tokens.scss` (maps) from one typed source. `apps/web` is an Angular 22.1 zoneless standalone app: signal stores over an `EngineFacade` that memoizes `createContentIndex`/`createLocalizer`/`createSearchIndex` from `@hk/engine`; the core pack is a static asset produced by `@hk/content`'s CLI; imported translation packs persist in Dexie. Icons are a build-time SVG sprite compiled from a vendored game-icons subset that VALIDATES `icons-map.json` (fixing plan 2's guessed slugs at the source). Conventions inherit from TAMS (`docs/04-reference/tams-conventions.md` "Inherit" list) via `docs/02-architecture/09-frontend-architecture.md`.

**Tech Stack (verified against npm 2026-09-07, pin with `~`):** Angular core/CDK/service-worker **22.1.5**, CLI **22.1.7**, angular-eslint **22.4.0**; `@jsverse/transloco` **8.4.0**, `@jsverse/transloco-messageformat` **8.4.0**, `@jsverse/transloco-keys-manager` **8.1.1**; `marked` **18.0.11**, `dompurify` **3.4.15**; `dexie` **4.4.5**; `stylelint` **17.15.0**; `playwright` **1.63.0**. Existing toolchain unchanged (Node 24, pnpm 11, TS ~6.0.3, Vitest 4, ESLint 10, Prettier 120/single/trailing).

**Spec:** `docs/03-roadmap/phase-1-solo-builder.md` § 1a deliverables 6, 7, 8 and the Acceptance criteria block; architecture authority: `docs/02-architecture/09-frontend-architecture.md` (frontend), `06-i18n.md` (i18n depth, markdown rendering), `07-images-and-blobs.md` (sprite as the only SVG source), `04-content-packs.md` (`gi:` icon ids); decisions: ADR-005 (stack), ADR-009 (i18n), ADR-008 (markdown safety); conventions: `docs/04-reference/tams-conventions.md`; licensing: `docs/04-reference/legal-attribution.md`.

## Global Constraints

- **Workspace:** new `apps/web` (private app, name `web`) and `packages/ui-tokens` (`@hk/ui-tokens`). `pnpm-workspace.yaml` gains `apps/*`. Root `pnpm check` (format+lint+typecheck+schema+test) must stay green after every task; web lint/typecheck/test/build are wired into the root scripts so CI covers them with no CI-file rewrite (adjust `.github/workflows` only where a root script alone cannot cover e2e).
- **Angular style (binding, from 09-frontend-architecture + TAMS Inherit):** zoneless (`provideZonelessChangeDetection()`, no zone.js dependency), standalone components only, `inject()` only (no constructor injection), signals-only state (`signal`/`computed`/`linkedSignal`; `effect` only at I/O boundaries), native control flow `@if`/`@for`, host bindings in `host: {}`, external `templateUrl`/`styleUrl`, kebab-case filenames with `.component`/`.service`/`.pipe`/`.directive` suffixes, co-located `x.component.ts|html|scss`, class-body section markers `// Dependencies` / `// Properties` / `// Methods`, per-shared-component `SKILL.md`. `::ng-deep` banned. TS path aliases `@app/*`, `@shared/*`; cross-package imports `@hk/protocol`, `@hk/engine`, `@hk/content` resolved to package **sources** via tsconfig `paths` (same pattern as the other packages' vitest configs).
- **i18n is structural (non-negotiable, CLAUDE.md rule 2):** no user-visible string literals in templates — `@angular-eslint/template/i18n` with `checkText: true` and `checkAttributes` for `title|placeholder|aria-label|alt` (Transloco-bound attributes ignored) fails lint on violations. Transloco 8 + messageformat; JSON per scope `apps/web/src/assets/i18n/<scope>/<locale>.json`; scopes in this plan: `shell`, `library`, `settings`, `about`; key convention `component.meaning` inside a scope (rendered `scope.component.meaning`). `en` is complete; missing `ru`/`uk` keys fall back to `en` (reported, not failed). Locale switch never reloads the page.
- **Theming:** components style exclusively with `var(--…)` tokens from `@hk/ui-tokens`; stylelint rule forbids raw color values (`color-no-hex` + `declaration-property-value-disallowed-list` for `rgb|rgba|hsl|oklch` outside `packages/ui-tokens` and `apps/web/src/styles/`). Themes: `light` and `dark`, applied as `data-theme` on `<html>` by `ThemeService`, default `dark`, persisted.
- **Fonts:** Inter and Philosopher, self-hosted woff2, both SIL OFL 1.1 — vendored once with their license files under `apps/web/src/assets/fonts/<family>/` (the download is a one-time network operation like plan 2's fixture vendoring; record source URLs + retrieval date in a `SOURCE.md` next to them).
- **Icons:** the bundled game-icons subset is the ONLY SVG source (07-images-and-blobs). Vendored from `github.com/game-icons/icons` at a commit pinned in Task 7, subset = exactly the ids referenced by `packages/content/src/icons/icons-map.json`; compiled into `apps/web/src/assets/icons/sprite.svg` by a build script that FAILS on a missing id. Attribution authors list is generated from the vendored files' metadata into `apps/web/src/assets/icons/authors.json`. License CC-BY-3.0: the About screen must show "Icons made by <authors>. Available on https://game-icons.net" with the actual bundled-author list.
- **Attribution screen (verbatim, non-negotiable):** shows the exact SRD 5.2.1 statement (import `ATTRIBUTION` from `@hk/content`), the game-icons statement above, and the open5e credit line from `docs/04-reference/legal-attribution.md`.
- **Content pack:** the app consumes `packages/content/dist/packs/srd-5e-2024/0.1.0/pack.json` as a static asset mapped to `/packs/srd-5e-2024/0.1.0/pack.json` (angular.json assets input outside the app root); `apps/web` `pretest`/`prebuild`/`pree2e` scripts run `pnpm --filter @hk/content build:pack` so the asset always exists. The RU sample (`packages/content/translations/srd-5e-2024-ru-sample.json`) is exposed the same way under `/packs/demo/`. The generated pack is never committed.
- **PWA:** `@angular/service-worker`; app shell + fonts + sprite + the in-use core pack version `prefetch`; `SwUpdate` prompts, never auto-reloads; install prompt (`beforeinstallprompt` on Chromium, instructions sheet on iOS); `navigator.storage.persist()` offered from Settings. Production initial bundle ≤ 600 KB gzip (angular.json budget, build fails over it).
- **Acceptance criteria (roadmap § 1a, bind the whole plan):** installable, works offline after first load; search "fireball" / "огненный" finds Fireball; RU list sorting uses Cyrillic collation; switching UI language does not reload; no visible key names anywhere; `pnpm test` runs schema tests + content validation + web unit tests; CI green; attribution screen shows the exact SRD 5.2.1 and game-icons.net statements.
- **Process:** Conventional Commits with scope (`feat(web): …`, `feat(ui-tokens): …`); TDD — failing test first for every unit with logic (token emission, services, stores, pipes, markdown, sprite script); pure-markup components get their behavior asserted via component tests (Vitest + Angular TestBed); every task ends with a commit. No network at build/test time except the explicitly named one-time vendoring steps.

## File structure (what this plan creates)

```
pnpm-workspace.yaml                     + apps/*
tsconfig.json                           + ui-tokens reference (apps/web has its own ng tsconfigs)
packages/ui-tokens/
  package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts
  src/tokens.ts                one typed token table (both themes + shared scales)
  src/build.ts                 emit() → dist/tokens.css + dist/tokens.scss (deterministic)
  src/index.ts                 exports tokens, emit paths
  test/tokens.test.ts
apps/web/
  package.json  angular.json  tsconfig.json  tsconfig.app.json  tsconfig.spec.json
  eslint.config.js  .stylelintrc.json  ngsw-config.json
  public/manifest.webmanifest  public/icons/ (PWA icons, generated placeholder set)
  tools/build-sprite.ts        icons-map.json + vendored SVGs → sprite.svg + authors.json
  vendor/game-icons/           vendored SVG subset + SOURCE.md (pinned commit)
  src/main.ts  src/index.html  src/styles.scss
  src/styles/{base.scss,typography.scss,layers.scss,utilities.scss}
  src/assets/fonts/{inter,philosopher}/  (woff2 + OFL.txt + SOURCE.md)
  src/assets/icons/sprite.svg  src/assets/icons/authors.json   (generated, committed)
  src/assets/i18n/{shell,library,settings,about}/{en,ru,uk}.json
  src/app/app.config.ts  app.routes.ts  app.ts (shell component)
  src/app/shared/components/{button,icon-button,card,chip,skeleton,tabs,search-field,virtual-list,dialog,toast}/
  src/app/shared/icons/icon.component.*        (hk-icon over the sprite)
  src/app/shared/services/
    storage/dexie.db.ts  storage/packs.repository.ts  storage/settings.repository.ts
    engine/pack-loader.ts  engine/engine.facade.ts
    i18n/locale.service.ts  theme/theme.service.ts
    pwa/{install-prompt.service.ts,update.service.ts,storage-persist.service.ts}
    markdown/markdown.service.ts (marked + dompurify + [[entity-id]] resolver)
  src/app/views/home/  views/library/{browse,detail}/  views/settings/  views/about/
  e2e/ (Playwright: offline, search, locale switch, a11y-axe)
```

Transform-task ground rule (carried from plan 2): every factual literal in a test marked "golden" is checked against the real pack/spec; where an assumption fails at execution time, the fix goes to the source (script, token table, icons map), never to a weakened test. `packages/content/src/icons/icons-map.json` MAY be edited by Task 7 (slugs verified against the real icon set) — its content test pins the schema, not the guessed slugs.

---

### Task 1: `@hk/ui-tokens` — token table and CSS/SCSS emission

**Files:**
- Create: `packages/ui-tokens/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/tokens.ts`, `src/build.ts`, `src/index.ts`
- Modify: root `tsconfig.json` (add `{ "path": "packages/ui-tokens/tsconfig.build.json" }`), `pnpm-workspace.yaml` (add `- apps/*` now so later tasks don't touch it)
- Test: `packages/ui-tokens/test/tokens.test.ts`

**Interfaces:**
- Produces: `TOKENS: ThemeTokens` where `type ThemeTokens = { shared: Record<string, string>; light: Record<string, string>; dark: Record<string, string> }` (keys are CSS custom property names WITHOUT `--`, e.g. `surface-1`); `emitCss(): string` (a `:root{…}` block with `shared` + the `dark` theme as default, plus `[data-theme='light']{…}` and `[data-theme='dark']{…}` blocks); `emitScss(): string` (one `$hk-tokens: (shared: (…), light: (…), dark: (…));` map literal); `build(outDir: string): { css: string; scss: string }` writes `tokens.css`/`tokens.scss` (2-space, trailing newline) and returns the paths. `package.json` script `"build:tokens": "node src/build.ts"` plus standard `typecheck`/`test`/`build` copied from `@hk/pack-tools`'s shapes (no runtime deps).
- Consumed by: Task 3 (`apps/web` imports `dist/tokens.css`), all component tasks (via CSS custom properties).

Normative token set (hand-authored; grouped, kebab-case keys — transcribe verbatim into `src/tokens.ts`):
- `shared`: `font-body: 'Inter', system-ui, sans-serif`; `font-display: 'Philosopher', 'Inter', serif`; `font-scale: 1`; `radius-s: 6px`; `radius-m: 10px`; `radius-l: 16px`; `space-1: 4px` … `space-6: 32px` (4/8/12/16/24/32); `touch-target: 44px`; `shadow-1: 0 1px 3px rgb(0 0 0 / 0.25)`; `shadow-2: 0 4px 12px rgb(0 0 0 / 0.35)`; `accent-h: 268`; `accent-s: 60%`; `motion: 1`; `duration-s: 120ms`; `duration-m: 240ms`; `focus-ring: 2px solid hsl(var(--accent-h) var(--accent-s) 62%)`.
- `dark`: `surface-0: hsl(240 6% 7%)`; `surface-1: hsl(240 6% 11%)`; `surface-2: hsl(240 6% 15%)`; `surface-3: hsl(240 6% 20%)`; `text-1: hsl(40 20% 96%)`; `text-2: hsl(40 8% 72%)`; `text-3: hsl(40 6% 52%)`; `accent: hsl(var(--accent-h) var(--accent-s) 62%)`; `accent-contrast: hsl(240 6% 7%)`; `border-1: hsl(240 6% 26%)`; `danger: hsl(0 62% 58%)`; `success: hsl(140 42% 48%)`; `warning: hsl(40 80% 55%)`; `overlay: rgb(0 0 0 / 0.55)`.
- `light`: `surface-0: hsl(40 30% 97%)`; `surface-1: hsl(40 25% 93%)`; `surface-2: hsl(40 20% 88%)`; `surface-3: hsl(40 16% 82%)`; `text-1: hsl(240 10% 12%)`; `text-2: hsl(240 6% 32%)`; `text-3: hsl(240 5% 48%)`; `accent: hsl(var(--accent-h) var(--accent-s) 42%)`; `accent-contrast: hsl(40 30% 97%)`; `border-1: hsl(40 12% 74%)`; `danger: hsl(0 62% 44%)`; `success: hsl(140 45% 34%)`; `warning: hsl(38 85% 38%)`; `overlay: rgb(20 20 24 / 0.4)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui-tokens/test/tokens.test.ts
import { describe, expect, it } from 'vitest';
import { TOKENS, emitCss, emitScss } from '../src/index.ts';

describe('token table', () => {
  it('light and dark define identical key sets', () => {
    expect(Object.keys(TOKENS.light).sort()).toEqual(Object.keys(TOKENS.dark).sort());
  });
  it('no theme key collides with a shared key', () => {
    for (const k of Object.keys(TOKENS.light)) expect(TOKENS.shared[k], k).toBeUndefined();
  });
  it('carries the normative anchors', () => {
    expect(TOKENS.shared['touch-target']).toBe('44px');
    expect(TOKENS.shared['font-display']).toContain('Philosopher');
    expect(TOKENS.dark['surface-0']).toBe('hsl(240 6% 7%)');
    expect(TOKENS.light['text-1']).toBe('hsl(240 10% 12%)');
  });
});

describe('emission', () => {
  it('css exposes every token under --hk-free names and both theme blocks', () => {
    const css = emitCss();
    expect(css).toContain(':root {');
    expect(css).toContain("[data-theme='light'] {");
    expect(css).toContain("[data-theme='dark'] {");
    expect(css).toContain('--surface-0: hsl(240 6% 7%);'); // dark default in :root
    expect(css).toContain('--touch-target: 44px;');
    expect(css.endsWith('\n')).toBe(true);
  });
  it('scss emits one $hk-tokens map with all three groups', () => {
    const scss = emitScss();
    expect(scss).toContain('$hk-tokens: (');
    for (const g of ['shared', 'light', 'dark']) expect(scss).toContain(`${g}: (`);
  });
  it('emission is deterministic', () => {
    expect(emitCss()).toBe(emitCss());
    expect(emitScss()).toBe(emitScss());
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run --project ui-tokens` → FAIL (module not found).

- [ ] **Step 3: Implement** — `tokens.ts` (the table verbatim as `export const TOKENS = { shared: {…}, light: {…}, dark: {…} } as const satisfies ThemeTokens` with the type exported), `build.ts`:

```ts
// packages/ui-tokens/src/build.ts (sketch is normative: structure + ordering)
const block = (selector: string, entries: Record<string, string>): string =>
  `${selector} {\n${Object.entries(entries)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join('\n')}\n}\n`;
export function emitCss(): string {
  return [
    block(':root', { ...TOKENS.shared, ...TOKENS.dark }),
    block("[data-theme='light']", TOKENS.light),
    block("[data-theme='dark']", TOKENS.dark),
  ].join('\n');
}
```

`emitScss()` renders the nested map with the same insertion order; `build(outDir)` writes both files and is invoked as `node src/build.ts` (guard `if (import.meta.url === pathToFileURL(process.argv[1]).href)`), default outDir `dist/`. `index.ts` re-exports. The `dist/` output is git-ignored (root `.gitignore` already covers `dist/`); Task 3 wires the web build to run `build:tokens` first.

- [ ] **Step 4: Run tests, typecheck, lint, format** — `pnpm install` (workspace change), `pnpm vitest run --project ui-tokens`, `pnpm typecheck`, `pnpm lint`, `pnpm format:fix`, then full `pnpm test`.

- [ ] **Step 5: Commit** — `git add packages/ui-tokens tsconfig.json pnpm-workspace.yaml pnpm-lock.yaml && git commit -m "feat(ui-tokens): themed token table with deterministic css/scss emission"`

---

### Task 2: Angular workspace scaffold (`apps/web`) wired into the monorepo toolchain

**Files:**
- Create: `apps/web/` via Angular CLI (package name `web`, private), `apps/web/eslint.config.js`, `apps/web/.stylelintrc.json`, path aliases in `apps/web/tsconfig.json`
- Modify: root `package.json` scripts (extend `lint`, `typecheck`, `test`, `build` to include web), root `.prettierignore` (+ `apps/web/.angular/`), root `.gitignore` (+ `.angular/`)
- Test: `apps/web/src/app/app.spec.ts` (CLI-generated, adapted)

**Interfaces:**
- Produces: a booting zoneless shell (`App` component, empty `routes`), `pnpm --filter web test|lint|build` and root scripts covering them; tsconfig `paths`: `@app/* → src/app/*`, `@shared/* → src/app/shared/*`, `@hk/protocol → ../../packages/protocol/src/index.ts`, `@hk/engine → ../../packages/engine/src/index.ts`, `@hk/content → ../../packages/content/src/index.ts`.
- Consumed by: every later task.

- [ ] **Step 1: Generate the app** — from repo root: `pnpm dlx @angular/cli@22.1.7 new web --directory apps/web --style scss --ssr false --zoneless --skip-git --package-manager pnpm --skip-install`. Then in `apps/web/package.json`: name `web`, `private: true`, remove zone.js if present, scripts `{ "start": "ng serve", "build": "ng build", "test": "ng test", "lint": "ng lint", "typecheck": "tsc -p tsconfig.app.json --noEmit" }`. `pnpm install`. Verify `apps/web/src/main.ts` bootstraps with `provideZonelessChangeDetection()` (add if the schematic did not).
- [ ] **Step 2: Wire lint** — `pnpm --filter web exec ng add angular-eslint@22.4.0 --skip-confirmation` (flat config); extend it with the repo's shared rules (import the root config's TS ruleset) and add the i18n template rule EXACTLY:

```js
// in apps/web/eslint.config.js, template block rules:
'@angular-eslint/template/i18n': [
  'error',
  { checkId: false, checkText: true, checkAttributes: ['title', 'placeholder', 'aria-label', 'alt'] },
],
```

`.stylelintrc.json`:

```json
{
  "rules": {
    "color-no-hex": true,
    "declaration-property-value-disallowed-list": { "/.*/": ["/^rgb/", "/^hsl/", "/^oklch/"] },
    "selector-pseudo-element-no-unknown": true
  }
}
```

(applies to `apps/web/src/app/**/*.scss` only — `src/styles/**` and `packages/ui-tokens` are exempt via `.stylelintignore`; add root script `lint:styles` running stylelint over the app and include it in `pnpm lint`).
- [ ] **Step 3: Root wiring** — root `package.json`: `"typecheck": "tsc -b && pnpm --filter web typecheck"`, `"lint": "eslint . && pnpm --filter web lint && pnpm lint:styles"`, `"test": "vitest run && pnpm --filter web test -- --watch=false"`, `"build": "tsc -b && pnpm --filter web build"` (keep the existing halves; exact composition may differ — preserve current behavior for packages and ADD web). Confirm `pnpm check` runs everything.
- [ ] **Step 4: Smoke test** — adapt the generated `app.spec.ts` to Vitest style: creates the component, asserts the shell renders a `router-outlet`. Run `pnpm --filter web test -- --watch=false` → PASS; `pnpm check` → green.
- [ ] **Step 5: Commit** — `git add apps pnpm-lock.yaml package.json .gitignore .prettierignore && git commit -m "feat(web): angular 22 zoneless scaffold wired into monorepo lint/test/build"`

---

### Task 3: Styles, fonts, theme service

**Files:**
- Create: `apps/web/src/styles/{base.scss,typography.scss,layers.scss,utilities.scss}`, `apps/web/src/assets/fonts/inter/` + `philosopher/` (woff2 + `OFL.txt` + `SOURCE.md`), `apps/web/src/app/shared/services/theme/theme.service.ts`
- Modify: `apps/web/src/styles.scss` (import order: tokens.css → layers → base → typography → utilities), `apps/web/angular.json` (styles include `packages/ui-tokens/dist/tokens.css`; `prebuild`-equivalent: web `package.json` scripts get `"pretest"/"prebuild"/"prestart": "pnpm --filter @hk/ui-tokens build:tokens"`), `apps/web/src/index.html` (`<html lang="en" data-theme="dark">`)
- Test: `apps/web/src/app/shared/services/theme/theme.service.spec.ts`

**Interfaces:**
- Produces: `ThemeService` — `theme: Signal<'dark' | 'light'>`, `setTheme(t)`, `toggle()`; applies `data-theme` to `document.documentElement`, persists to `localStorage['hk.theme']`, initial value = stored ?? `dark`. `@font-face` for Inter (400/600/700) and Philosopher (700) with `font-display: swap`; `base.scss` sets `body { background: var(--surface-0); color: var(--text-1); font-family: var(--font-body); }`; `.visually-hidden`, `.touch-target` utility mixin.
- Consumed by: Task 13 (Settings appearance), every component (tokens present at runtime).

- [ ] **Step 1: Vendor fonts (one-time network)** — download Inter woff2 (from `https://github.com/rsms/inter/releases`, latest stable) and Philosopher woff2 (Google Fonts `https://fonts.google.com/specimen/Philosopher`, via gstatic woff2 URLs) for the weights above + their OFL license files; write `SOURCE.md` per family (URL, version, date, license). These files ARE committed.
- [ ] **Step 2: Write the failing service test**

```ts
// theme.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => localStorage.removeItem('hk.theme'));
  it('defaults to dark and stamps <html data-theme>', () => {
    const svc = TestBed.inject(ThemeService);
    expect(svc.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
  it('setTheme persists and re-stamps', () => {
    const svc = TestBed.inject(ThemeService);
    svc.setTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('hk.theme')).toBe('light');
  });
});
```

- [ ] **Step 3: Run to verify failure, implement** — `ThemeService` (`providedIn: 'root'`): a `signal` initialized from storage, an `effect` (I/O boundary — allowed) stamping the attribute + persisting; guard storage access in try/catch. Wire styles/@font-face; `styles.scss` order as above.
- [ ] **Step 4: Run web tests, stylelint, full `pnpm check`; `pnpm --filter web build` must succeed with tokens.css present.**
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): token-driven styles, self-hosted fonts, theme service"`

---

### Task 4: Transloco i18n foundation (en/ru/uk) + LocaleService

**Files:**
- Create: `apps/web/src/app/shared/services/i18n/transloco.loader.ts`, `i18n/locale.service.ts`, `apps/web/src/assets/i18n/shell/{en,ru,uk}.json` (other scopes' files are created by the tasks that need them)
- Modify: `apps/web/src/app/app.config.ts` (provideTransloco + messageformat), web `package.json` (`"i18n:extract": "transloco-keys-manager extract"` + config), CI note in root README deferred to Task 16
- Test: `apps/web/src/app/shared/services/i18n/locale.service.spec.ts`

**Interfaces:**
- Produces: `provideTransloco({ config: { availableLangs: ['en','ru','uk'], defaultLang: 'en', fallbackLang: 'en', reRenderOnLangChange: true, prodMode: !isDevMode() }, loader })` + `provideTranslocoMessageformat()`; scoped loading (`TRANSLOCO_SCOPE` per view). `LocaleService`: `locale: Signal<'en'|'ru'|'uk'>`, `setLocale(l)` — switches Transloco's active lang (NO page reload), persists `localStorage['hk.locale']`, initial = stored ?? browser match ?? `en`; also exposes `contentLocale = locale` (one signal drives UI and content, per 06-i18n).
- Consumed by: every view; Task 9 (localizer locale), Task 13 (settings).

Seed `shell` scope keys (en complete; ru/uk full translations — dnd.su terminology, «испытание» convention): `nav.home` (Home/Главная/Головна), `nav.library` (Library/Библиотека/Бібліотека), `nav.settings` (Settings/Настройки/Налаштування), `nav.about` (About/О приложении/Про застосунок), `app.title` (Herokeep), `app.offline` (Offline/Офлайн/Офлайн), `home.tagline` (Your D&D companion — the Library is ready; builder comes next. / Ваш спутник по D&D — Библиотека готова; конструктор персонажей впереди. / Ваш супутник по D&D — Бібліотека готова; конструктор персонажів попереду.).

- [ ] **Step 1: Write the failing test** — `LocaleService`: defaults to `en` with empty storage; `setLocale('ru')` persists and `TranslocoService.getActiveLang()` becomes `ru` (TestBed with `provideTransloco` + a stub loader returning `{}`); invalid stored value falls back to `en`.
- [ ] **Step 2: Run to verify failure, implement** — loader fetches `assets/i18n/<scope>/<lang>.json` via `HttpClient` (`provideHttpClient(withFetch())`); LocaleService as specified (effect persists + calls `setActiveLang`).
- [ ] **Step 3: keys-manager config** — `transloco.config.js` marking `src/assets/i18n` scopes; run `pnpm --filter web i18n:extract` once and commit the config; wire it into web `lint` script as a `--fail-on-missing` check for `en` only (ru/uk missing keys warn).
- [ ] **Step 4: Run web tests + `pnpm check`.**
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): transloco en/ru/uk foundation with messageformat and locale service"`

---

### Task 5: App shell, routes, home view

**Files:**
- Create: `apps/web/src/app/views/home/home.component.{ts,html,scss}`, shell layout in `apps/web/src/app/app.{ts,html,scss}` (header with app title + nav links + theme toggle button + language menu placeholder routing to settings)
- Modify: `apps/web/src/app/app.routes.ts`
- Test: `apps/web/src/app/app.routes.spec.ts`

**Interfaces:**
- Produces: routes `''` → home, `'library'` and `'library/:id'` → lazy (Task 10/12 components; stub `loadComponent` targets created here as empty standalone components in `views/library/`), `'settings'` → lazy stub, `'about'` → lazy stub; shell shows `nav` with `routerLinkActive`, all text via `shell` scope keys; offline indicator element bound to `navigator.onLine` signal (simple `fromEvent` bridge service inline in app.ts is acceptable at this size).
- Consumed by: Tasks 10–14 replace the stubs.

- [ ] **Step 1: Failing routes test** — `provideRouter(routes)` + `RouterTestingHarness`: navigating to `/`, `/library`, `/settings`, `/about` resolves without error and renders the shell nav with 4 links (query `a[routerLink]`).
- [ ] **Step 2: Implement shell + home** — header/nav/main landmarks (`<header>`, `<nav aria-label>…`, `<main>`), 44px touch targets, tokens only; home renders `app.title` in `--font-display` and `home.tagline`.
- [ ] **Step 3: Run tests, stylelint (tokens-only will catch raw colors), i18n lint (no literals), `pnpm check`.**
- [ ] **Step 4: Commit** — `git add apps/web && git commit -m "feat(web): app shell, routing, home view"`

---

### Task 6: Base components, batch 1 — button, icon-button, card, chip, skeleton

**Files:**
- Create: `apps/web/src/app/shared/components/<name>/<name>.component.{ts,html,scss}` + `SKILL.md` for: `button`, `icon-button`, `card`, `chip`, `skeleton`
- Test: one spec per component in the same folder

**Interfaces (Produces — selectors and inputs later tasks rely on):**
- `hk-button`: inputs `variant: 'primary'|'ghost'|'danger' = 'primary'`, `disabled = false`; content-projected label; emits native click (no output wrapper); `host: { '[class]': …, '[attr.aria-disabled]': … }`.
- `hk-icon-button`: inputs `icon: string` (a `gi:` id or app icon id, rendered via Task 7's `hk-icon` — until Task 7 lands it renders a plain slot; this task depends only on the slot), `label: string` (REQUIRED, becomes `aria-label`), `variant`.
- `hk-card`: optional `header` input + projected content; `role` left to the consumer.
- `hk-chip`: inputs `selected = false`, `removable = false`; output `remove`; used by Library type filters.
- `hk-skeleton`: inputs `lines = 1`, `width?: string`; pure CSS shimmer honoring `prefers-reduced-motion`.
- All: styles use tokens only; every interactive element ≥ `var(--touch-target)`; visible `:focus-visible` ring `var(--focus-ring)`.

- [ ] **Step 1: Failing specs** — per component, TestBed render with a host template asserting: button variants map to classes and `aria-disabled` blocks click handlers; icon-button REQUIRES label (assert `aria-label` renders); chip emits `remove` only when removable; skeleton renders `lines` elements. (Markup-only assertions are the behavior here — that is the test.)
- [ ] **Step 2: Implement the five components + SKILL.md each** (SKILL.md = usage snippet, inputs table, do/don't — mirror the TAMS habit).
- [ ] **Step 3: Run web tests, stylelint, i18n lint (components must not contain literal text — labels come from consumers), `pnpm check`.**
- [ ] **Step 4: Commit** — `git add apps/web && git commit -m "feat(web): base components batch 1 (button, icon-button, card, chip, skeleton)"`

---

### Task 7: game-icons sprite — vendoring, build script, `hk-icon`, slug verification

**Files:**
- Create: `apps/web/vendor/game-icons/` (vendored SVG subset + `SOURCE.md`), `apps/web/tools/build-sprite.ts`, `apps/web/src/assets/icons/sprite.svg` + `authors.json` (generated, committed), `apps/web/src/app/shared/icons/icon.component.{ts,html,scss}` + `SKILL.md`
- Modify: `packages/content/src/icons/icons-map.json` (replace guessed slugs with verified ones), possibly `packages/content/test/icons.test.ts` ONLY if a pinned literal names a replaced slug (the schema/coverage assertions stay), web `package.json` (`"build:sprite": "node tools/build-sprite.ts"`)
- Test: `apps/web/tools/build-sprite.spec.ts` (Vitest, runs in the web project), `icon.component.spec.ts`

**Interfaces:**
- Consumes: `packages/content/src/icons/icons-map.json` (`{ categories: Record<string,string>, entities: Record<string,string> }`, values `gi:<slug>`).
- Produces: `buildSprite(mapPath, vendorDir, outDir): { ids: string[]; authors: string[] }` — for every DISTINCT `gi:` value in the map, find `vendor/game-icons/<author>/<slug>.svg`, wrap its path data as `<symbol id="gi-<slug>" viewBox="0 0 512 512">`, write one `sprite.svg`; a value with no matching file THROWS listing every missing slug; `authors.json` = sorted unique author dir names. `hk-icon`: input `icon: string` (accepts `gi:<slug>`), renders `<svg aria-hidden="true"><use [attr.href]="'assets/icons/sprite.svg#gi-' + slug"/></svg>`, size via `1em`/CSS.
- Consumed by: Tasks 10/12 (Library icons via `PlaceholderService`-style mapping: entity icon → `entities` map → `categories` fallback by type/tags).

- [ ] **Step 1: Vendor the subset (one-time network)** — pin the latest commit of `https://github.com/game-icons/icons` (record the 40-char SHA in `SOURCE.md` with date + CC-BY-3.0 note). For each distinct slug in icons-map.json, locate the icon (site search / repo layout `<author>/<slug>.svg`); where plan 2's guessed slug does not exist, pick the real closest icon and UPDATE `icons-map.json` (this is the "plan 3 verifies the map" work plan 2 deferred; record every rename in the report). Download only the needed files into `vendor/game-icons/<author>/<slug>.svg` (~37 files).
- [ ] **Step 2: Failing sprite test** — `buildSprite` over the real map + vendor dir returns ids covering every distinct map value, writes a parseable SVG containing `<symbol id="gi-crossed-swords"` (or whichever verified class icon), and THROWS with the slug name when the map temporarily references `gi:definitely-missing` (use a copy of the map in a temp dir for the throw case).
- [ ] **Step 3: Implement + run** — implement `build-sprite.ts`; run `pnpm --filter web build:sprite`; commit the generated `sprite.svg` + `authors.json` (they are source-controlled assets regenerated on demand, like plan 1's published schema — CI drift check: the sprite test re-runs the build into a temp dir and asserts byte-equality with the committed file).
- [ ] **Step 4: `hk-icon` spec + implementation** (renders `use` with the right href; unknown prefix throws in dev).
- [ ] **Step 5: Full `pnpm check` (content tests must stay green after the map edit — fix pinned literals at the source if any name one of the renamed slugs).**
- [ ] **Step 6: Commit** — `git add apps/web packages/content && git commit -m "feat(web): vendored game-icons sprite with verified icons-map slugs and hk-icon"`

---

### Task 8: Base components, batch 2 — tabs, search-field, virtual-list, dialog/bottom-sheet, toast

**Files:**
- Create: `apps/web/src/app/shared/components/{tabs,search-field,virtual-list,dialog,toast}/…` (+ `SKILL.md` each); `dialog` and `toast` each ship a service (`dialog.service.ts`, `toast.service.ts`) beside the component
- Test: one spec per component/service
- Modify: `apps/web/package.json` (add `@angular/cdk@~22.1.5`)

**Interfaces (Produces):**
- `hk-tabs`: input `tabs: { id: string; label: string }[]`, model `selected` (two-way via `model()` signal); ARIA tablist/roving tabindex (CDK `FocusKeyManager`).
- `hk-search-field`: model `value: string` (debounced 150 ms internally via signal + `effect`), input `placeholderKey: string` (Transloco key — the component renders `*transloco` itself with the given key), output `cleared`; type=search with a clear icon-button.
- `hk-virtual-list`: wraps `cdk-virtual-scroll-viewport` (`itemSize` input, default 56), content via `ng-template` with implicit `$item` context; input `items: readonly T[]`; keyboard roving handled by the consumer.
- `DialogService.open(component, data?)` / `hk-dialog` shell + `openSheet` (bottom sheet variant = same overlay, `position: bottom`, full-width) — CDK Overlay, focus trap (`cdkTrapFocus`), ESC + backdrop close, returns a close signal/promise.
- `ToastService.show(key: string, params?)` — queues, renders in a CDK overlay with `aria-live="polite"`, auto-dismiss `4000ms`, honors reduced motion.
- All tokens-only; sheet/dialog surfaces `var(--surface-2)`, overlay `var(--overlay)`.

- [ ] **Step 1: Failing specs** — tabs: arrow keys move selection, `selected` model updates; search-field: typing emits debounced `value` (fakeAsync/tick 150), clear button resets and emits `cleared`; virtual-list renders viewport with items; DialogService opens/closes and restores focus; ToastService renders the translated key (Transloco testing module) and removes after timeout.
- [ ] **Step 2: Implement the five + SKILL.md each.**
- [ ] **Step 3: Run web tests, stylelint, i18n lint, `pnpm check`.**
- [ ] **Step 4: Commit** — `git add apps/web pnpm-lock.yaml && git commit -m "feat(web): base components batch 2 (tabs, search field, virtual list, dialog, toast)"`

---

### Task 9: Pack assets, Dexie storage, `PackStore` + `EngineFacade`

**Files:**
- Create: `apps/web/src/app/shared/services/storage/dexie.db.ts`, `storage/packs.repository.ts`, `storage/settings.repository.ts`, `engine/pack-loader.ts`, `engine/engine.facade.ts`, `apps/web/src/app/shared/stores/pack.store.ts`
- Modify: `apps/web/angular.json` (assets: `{ "glob": "**/*", "input": "../../packages/content/dist/packs", "output": "/packs" }` and `{ "glob": "srd-5e-2024-ru-sample.json", "input": "../../packages/content/translations", "output": "/packs/demo" }`), web `package.json` (`"prestart"/"prebuild"/"pretest"` also run `pnpm --filter @hk/content build:pack`; chain with the tokens prebuild from Task 3), `apps/web/package.json` deps (`dexie@~4.4.5`)
- Test: `engine.facade.spec.ts`, `packs.repository.spec.ts`

**Interfaces:**
- Consumes: `parsePack` (`@hk/protocol`); `validatePack`, `createContentIndex`, `createLocalizer`, `createSearchIndex`, types `ContentIndex`, `Localizer`, `SearchIndex`, `SearchHit` (`@hk/engine`); `PACK_ID`, `PACK_VERSION` (`@hk/content` via `@hk/content`'s index — exports `buildPack`/`writePack` plus `PACK_ID`/`PACK_VERSION`); `LocaleService.locale`.
- Produces:
  - `HkDb` (Dexie): tables `packs` (`&key, id, version, kind`) storing `{ key: '<id>@<version>', id, version, kind, locale?, json: Pack }`, `settings` (`&key`) `{ key, value }`. Version 1 schema; migrations start here.
  - `PacksRepository`: `putPack(pack: Pack)`, `getAll(): Promise<Pack[]>`, `remove(key)`.
  - `PackLoader`: `loadCore(): Promise<Pack>` — fetches `/packs/srd-5e-2024/0.1.0/pack.json`, `parsePack`, throws on `!ok`; `loadDemoRu(): Promise<Pack>` — fetches `/packs/demo/srd-5e-2024-ru-sample.json`.
  - `PackStore` (root, signals): `corePack`, `translationPacks` (from Dexie at init), `packs = computed([core, ...translations])`, `ready` signal; `importTranslation(pack)` → `validatePack(pack, [core])` must return `[]` else returns the diagnostics for a toast, then persists + updates the signal; `removeTranslation(key)`.
  - `EngineFacade` (root): `index = computed(() => createContentIndex(packs()))`, `localizer = computed(() => createLocalizer(index(), locale()))`, `search = computed(() => createSearchIndex(index(), localizer()))` — all guarded behind `ready`; plus `iconFor(entity): string` (entity `icon` → `entities` map → `categories` fallback: `spell-school:<school>` for spells, `item:<weapon-melee|weapon-ranged|armor|shield|gear|magic>` by item category/kind, `condition`, `rule`, else `gi:perspective-dice-six-faces-random` — add that id to the map in Task 7's verified set).
- Consumed by: Tasks 10–13.

- [ ] **Step 1: Failing facade test** — with a REAL built core pack loaded from `packages/content/dist/packs/...` via `readFileSync` (unit tests read the file directly; `pretest` guarantees it exists): `createContentIndex`-backed `EngineFacade` (TestBed with stub `PackStore` seeded synchronously) resolves `localizer.name('srd-5e-2024:spell/fireball') === 'Fireball'`; after switching locale to `ru` WITH the demo RU pack added, name becomes `Огненный шар`; `search().query('fireball')[0].id` is the fireball spell; `iconFor` returns a `gi:` id for a class entity and the fallback for an unmapped `ability` entity.
- [ ] **Step 2: Failing repository test** — Dexie against `fake-indexeddb` (add dev dep `fake-indexeddb`): `putPack`/`getAll` round-trips a small translation pack object; duplicate key overwrites.
- [ ] **Step 3: Implement** (db, repositories, loader, store, facade). Keep the facade pure-computed; Dexie I/O only in the store's init/import methods.
- [ ] **Step 4: Run web tests + full `pnpm check`; verify `pnpm --filter web build` copies `/packs/**` into `dist` (inspect output).**
- [ ] **Step 5: Commit** — `git add apps/web pnpm-lock.yaml && git commit -m "feat(web): pack assets, dexie storage, pack store and engine facade"`

---

### Task 10: Library — browse by type

**Files:**
- Create: `apps/web/src/app/views/library/browse/browse.component.{ts,html,scss}`, `apps/web/src/assets/i18n/library/{en,ru,uk}.json`
- Modify: `apps/web/src/app/app.routes.ts` (`'library'` → real component)
- Test: `browse.component.spec.ts`

**Interfaces:**
- Consumes: `EngineFacade.index/localizer/iconFor`, `hk-chip`, `hk-virtual-list`, `hk-icon`, `hk-skeleton`, `hk-search-field` (wired in Task 11 — this task renders it disabled-less but inert).
- Produces: type filter chips for `['class','subclass','species','background','feat','spell','item','feature','condition','skill','language','rule']` (labels from the `library` scope: `type.class` = Classes/Классы/Класи etc. — full en/ru/uk sets for all 12), default `spell`; list rows = icon + localized name + (when `localizer.text(id,'name').isFallback` and locale ≠ en) an `EN` tag chip; rows sorted with `Intl.Collator(locale)` (Cyrillic collation acceptance); row click navigates `library/:id` (id URL-encoded).
- Consumed by: Task 12 (navigation target), Task 15 (e2e).

- [ ] **Step 1: Failing spec** — with the real pack via a seeded stub store: selecting the `class` chip renders 12 rows; rows are collator-sorted for `ru` (assert `Бард` before `Варвар` before `Воин` with the demo RU pack seeded); untranslated names in `ru` show the EN tag; click emits router navigation to the encoded id.
- [ ] **Step 2: Implement** (computed `rows = byType(selectedType).map(...)`; `@defer` nothing here — virtual list handles size).
- [ ] **Step 3: Run web tests, i18n lint, `pnpm check`.**
- [ ] **Step 4: Commit** — `git add apps/web && git commit -m "feat(web): library browse by type with localized collated rows"`

---

### Task 11: Library — search

**Files:**
- Modify: `browse.component.*` (wire `hk-search-field`), `apps/web/src/assets/i18n/library/*.json` (add `search.placeholder`, `search.results` ICU key)
- Test: extend `browse.component.spec.ts`

**Interfaces:**
- Consumes: `EngineFacade.search`.
- Produces: non-empty query switches the list to `search().query(text, { types: selected ? [selected] : undefined, limit: 100 })` hits (icon + name + a small type label chip using the `type.<t>` keys); result summary line via ICU `search.results`: en `{count, plural, one {# result} other {# results}}`, ru `{count, plural, one {# результат} few {# результата} many {# результатов} other {# результата}}`, uk analogous; clearing restores browse mode.
- Golden (acceptance): `fireball` and `огненный` (with RU demo pack + ru locale) both return Fireball first.

- [ ] **Step 1: Failing spec** — the two acceptance queries above; type filter applies to search; summary renders the plural for 1 vs many (assert rendered text via Transloco testing with the real `ru` JSON).
- [ ] **Step 2: Implement; run tests + `pnpm check`.**
- [ ] **Step 3: Commit** — `git add apps/web && git commit -m "feat(web): library search with per-locale and english matching"`

---

### Task 12: Library — entity detail with sanitized markdown and cross-links

**Files:**
- Create: `apps/web/src/app/shared/services/markdown/markdown.service.ts`, `views/library/detail/detail.component.{ts,html,scss}`, `views/library/detail/entity-facts.component.{ts,html,scss}` (type-specific fact rows)
- Modify: `apps/web/package.json` (`marked@~18.0.11`, `dompurify@~3.4.15`), routes (`'library/:id'` → real component), `library` i18n JSONs (fact labels: `fact.level`, `fact.school`, `fact.castingTime`, `fact.range`, `fact.duration`, `fact.components`, `fact.cost`, `fact.weight`, `fact.rarity`, `fact.hitDie`, `fact.saves`, `fact.speed`, `fact.size` — en/ru/uk)
- Test: `markdown.service.spec.ts`, `detail.component.spec.ts`

**Interfaces:**
- Produces: `MarkdownService.render(md: string): SafeHtml` — `marked` (GFM tables on, headings shifted +1 level) → resolve `[[<entity-id>]]` tokens to `<a data-entity-id="…">localized name</a>` BEFORE sanitizing → `DOMPurify.sanitize` with allowlist `p,br,em,strong,ul,ol,li,table,thead,tbody,tr,th,td,h2..h4,blockquote,code,pre,a` and attributes `href,data-entity-id` only; external `href` gets `rel="noopener" target="_blank"`; `data-entity-id` anchors get no href (click handled by the component → router). NO raw HTML passthrough (`marked` with `breaks:false`, sanitize strips).
- Detail view: header (icon, localized name, type label, EN tag when fallback), fact grid per type (spell: level/school/castingTime/range/duration/components — format structured fields into text via small pure formatters with i18n'd labels; item: category/cost/weight/rarity + weapon/armor blocks; class: hitDie/saves/primary; species: size/speed; feats/backgrounds/conditions/rules: description only), then the rendered `description` markdown; click on a `data-entity-id` anchor navigates to that entity (delegated click listener).
- Consumed by: Task 15 e2e.

- [ ] **Step 1: Failing markdown spec** — renders bold/tables; strips `<script>` and `onclick`; `[[srd-5e-2024:condition/prone]]` becomes an anchor whose text is the LOCALIZED condition name and carries `data-entity-id`; external links get `noopener`.
- [ ] **Step 2: Failing detail spec** — real pack: `/library/srd-5e-2024:spell/fireball` renders name, `fact.level` row with `3`, evocation school label, and the description contains rendered text; clicking a cross-link (inject one via a stub description) navigates.
- [ ] **Step 3: Implement service + components; run tests + `pnpm check`.**
- [ ] **Step 4: Commit** — `git add apps/web pnpm-lock.yaml && git commit -m "feat(web): entity detail with sanitized markdown and cross-reference links"`

---

### Task 13: Settings (language, appearance, storage, RU demo import) and About/attribution

**Files:**
- Create: `views/settings/settings.component.{ts,html,scss}`, `views/about/about.component.{ts,html,scss}`, `apps/web/src/assets/i18n/settings/{en,ru,uk}.json`, `apps/web/src/assets/i18n/about/{en,ru,uk}.json`
- Modify: routes (real components), `shared/services/pwa/storage-persist.service.ts` (created here — it is a settings concern)
- Test: `settings.component.spec.ts`, `about.component.spec.ts`

**Interfaces:**
- Consumes: `LocaleService`, `ThemeService`, `PackStore.importTranslation/removeTranslation/translationPacks`, `PackLoader.loadDemoRu`, `ToastService`, `navigator.storage.estimate()/persist()`.
- Produces: Settings sections — Language (three options switching `LocaleService` live, active state marked, NO reload), Appearance (theme toggle), Storage (`storage.estimate()` rendered as used/quota via `Intl.NumberFormat` MB, "persist storage" button showing granted state), Content packs (installed list: core `srd-5e-2024@0.1.0` + translations with remove; button `settings.packs.import-demo` → `loadDemoRu()` → `PackStore.importTranslation` → success/diagnostic toast). About — app name/version, then three attribution blocks rendered from SOURCE VALUES not copies: `ATTRIBUTION` imported from `@hk/content`; game-icons line composed from `assets/icons/authors.json` (ICU list via `Intl.ListFormat`): en `Icons made by {authors}. Available on https://game-icons.net (CC BY 3.0).`; the open5e credit line verbatim from `docs/04-reference/legal-attribution.md` (put the exact string in the `about` i18n en file and translate the surrounding labels, not the legal texts — legal statements stay English in all locales).
- Golden (acceptance): after import + locale ru, Library shows `Огненный шар`; About shows the exact SRD sentence.

- [ ] **Step 1: Failing specs** — settings: language click calls `setLocale` and marks active; import-demo happy path adds a pack row and toasts success; a translation pack failing `validatePack` (feed a corrupted copy) toasts the diagnostic and does NOT persist. about: renders the verbatim SRD string (import `ATTRIBUTION` in the spec and compare rendered text), the game-icons line contains an author from `authors.json`, and the open5e credit.
- [ ] **Step 2: Implement; run tests, i18n lint, `pnpm check`.**
- [ ] **Step 3: Commit** — `git add apps/web && git commit -m "feat(web): settings with live locale switch and demo pack import; attribution screen"`

---

### Task 14: PWA — service worker, manifest, install prompt, update flow, budgets

**Files:**
- Create: `apps/web/ngsw-config.json`, `apps/web/public/manifest.webmanifest`, `apps/web/public/icons/` (maskable 192/512 PNGs generated from the sprite's `gi:crossed-swords` on a `--surface-0` background — a tiny `tools/build-pwa-icons.ts` using sharp is NOT added; instead commit two hand-exported PNGs, documented in the file's SOURCE note), `shared/services/pwa/install-prompt.service.ts`, `pwa/update.service.ts`
- Modify: `app.config.ts` (`provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })`), `angular.json` (service worker on, budgets: `initial` warning 500kb error 600kb — gzip-approximation via esbuild sizes; keep the roadmap's ≤600 KB gzip as the binding line), shell header (offline dot + update banner), `index.html` (manifest link, theme-color)
- Test: `update.service.spec.ts`, `install-prompt.service.spec.ts`

**Interfaces:**
- Produces: `ngsw-config.json` — assetGroups: `app` (prefetch: index, js, css, manifest), `assets` (prefetch: `/assets/fonts/**`, `/assets/icons/sprite.svg`, `/assets/i18n/**`; lazy: other assets), `core-pack` (prefetch: `/packs/srd-5e-2024/**`), `demo-packs` (lazy: `/packs/demo/**`). `UpdateService`: wraps `SwUpdate.versionUpdates`, exposes `updateAvailable` signal, `activate()` reloads ONLY on user click. `InstallPromptService`: captures `beforeinstallprompt`, `canInstall` signal, `prompt()`; iOS detection exposes `showIosHint`.
- Golden (acceptance): production build + `npx http-server dist` + Playwright offline reload works (asserted in Task 15, not here); budget enforced by `ng build`.

- [ ] **Step 1: Failing specs** — UpdateService surfaces `updateAvailable` when a stubbed `SwUpdate` emits `VERSION_READY` and calls `activateUpdate` then reload on `activate()` (reload injected as a function for testability); InstallPromptService exposes `canInstall` after a synthetic `beforeinstallprompt`.
- [ ] **Step 2: Implement; `pnpm --filter web build` (production) must emit `ngsw.json` and stay under budget — if over, trim by lazy-loading marked/dompurify with `import()` inside MarkdownService (do this proactively: dynamic-import both libs; the service returns a promise-backed signal).**
- [ ] **Step 3: Run tests + `pnpm check`.**
- [ ] **Step 4: Commit** — `git add apps/web && git commit -m "feat(web): service worker with core-pack precache, install prompt, update flow"`

---

### Task 15: Playwright e2e + axe on the built app; CI wiring

**Files:**
- Create: `apps/web/e2e/{library.spec.ts,offline.spec.ts,locale.spec.ts,a11y.spec.ts}`, `apps/web/playwright.config.ts`
- Modify: web `package.json` (`"e2e": "playwright test"`, `pree2e` builds production + starts a static server via Playwright `webServer` on `dist/web/browser`), `.github/workflows/*` (add an `e2e` job: pnpm install, build content pack + tokens + sprite already chained by prebuilds, `pnpm --filter web exec playwright install chromium --with-deps`, `pnpm --filter web e2e`)
- Test: the e2e specs ARE the deliverable

**Interfaces / scenarios (each is a golden from the acceptance criteria):**
- `library.spec.ts`: open `/library`, chip `Spells` shows rows; search `fireball` → first result `Fireball`, open detail, see `8d6` in the description; switch UI language to Russian in Settings, import demo pack, search `огненный` → `Огненный шар`; assert list order uses Cyrillic collation (Бард < Варвар < Воин on the class list).
- `locale.spec.ts`: switching language does not trigger a navigation/reload (`page.on('load')` count stays 1) and no visible text matches `/[a-z]+\.[a-z]+\.[a-z-]+/` key-shape regex on the four screens (no visible key names).
- `offline.spec.ts`: load `/`, wait for SW activation (`navigator.serviceWorker.ready` + ngsw idle), `context.setOffline(true)`, reload, `/library` still renders rows and a spell detail opens (pack served from SW cache).
- `a11y.spec.ts`: `@axe-core/playwright` (add dev dep, current version verified at execution time) on home/library/detail/settings/about — no serious/critical violations.

- [ ] **Step 1: Config + first spec red** (run against the built app; watch it fail before the helpers exist), then implement helpers (a `test.beforeEach` seeding nothing — the app is real) and make all four specs pass locally.
- [ ] **Step 2: CI job green (chromium only; e2e job runs on ubuntu-latest, caches pnpm).**
- [ ] **Step 3: Commit** — `git add apps/web .github && git commit -m "test(web): playwright e2e for offline, search, locale and axe accessibility"`

---

### Task 16: Docs wrap + roadmap tick

**Files:**
- Modify: `README.md` (Apps section: what `apps/web` is, `pnpm --filter web start|build|e2e`, PWA note), `CLAUDE.md` (Commands: add `pnpm --filter web test|build|e2e`; Layout: one line for `apps/web` + `packages/ui-tokens`), `docs/03-roadmap/phase-1-solo-builder.md` — NO edits (roadmap is spec, not status), instead `docs/superpowers/plans/` gets nothing extra — the plan file itself was committed at execution start
- Test: none (docs)

- [ ] **Step 1: Write the two doc updates (match each file's existing structure and tone; keep lines short).**
- [ ] **Step 2: Full `pnpm check` + `pnpm --filter web e2e` one last time; verify every acceptance criterion in Global Constraints against the running app and record the result in the task report.**
- [ ] **Step 3: Commit** — `git add README.md CLAUDE.md && git commit -m "docs(repo): document apps/web and ui-tokens commands"`

---

## Self-review (performed 2026-09-07 while writing this plan)

**Spec coverage** (`docs/03-roadmap/phase-1-solo-builder.md` § 1a deliverables 6–8 + acceptance criteria):

| Requirement | Tasks |
|---|---|
| `@hk/ui-tokens` + dark/light themes | 1, 3 |
| Base components: button, icon-button, card, chip, tabs, list w/ virtual scroll, search field, dialog/bottom sheet, toast, skeleton | 6, 8 |
| Inter + Philosopher self-hosted | 3 |
| Icon sprite (game-icons subset, validates plan-2 `icons-map.json`) | 7 |
| PWA shell: routes home/library/settings-language/about-attribution | 5, 10, 13 |
| Transloco en/ru/uk UI strings for these screens | 4, 5, 10–13 (per-scope JSONs) |
| Service worker precaching the core pack; install prompt; storage estimate | 14 (SW/install), 13 (storage) |
| Library browse by type; per-locale + English search; detail w/ markdown + cross-links; EN fallback tag | 10, 11, 12 |
| RU sample pack importable from Settings | 9 (loader/store), 13 (UI) |
| Airplane-mode after first load; fireball/огненный; Cyrillic collation; no-reload switch; no visible keys; CI green; exact attribution statements | 15 (e2e goldens), 13 (attribution), 2 (CI wiring), 16 (final verification) |

**Deliberate scope notes:** no auth/campaigns/sheet/sync/Dexie event tables (Phase 1b/2); no metric-units toggle, gender field, or export bundles (later phases per 06-i18n/07-blobs); Angular Material absent by decision; `hk-search-field` debounce fixed at 150 ms; PWA icons are two committed PNGs (a generator script is YAGNI at two files); `pack-tools` untouched.

**Upstream-uncertainty policy:** package versions verified against npm on 2026-09-07 and pinned with `~` — if a listed version is gone at execution time, take the latest same-major patch and record it. The Angular CLI schematic's exact output may drift; Task 2's steps describe intent (zoneless, scss, no zone.js) and the executor adapts flags, reporting deltas. game-icons repo layout (`<author>/<slug>.svg`) verified against the public repo; Task 7 re-verifies at the pinned commit and fixes `icons-map.json` at the source.

**Placeholder scan:** no TBD/TODO/"similar to Task N"; every component task carries its input/output contract and every logic unit a verbatim or precisely-described failing test; i18n keys listed with en/ru/uk values where introduced (component-internal keys enumerated inline in their tasks). Type consistency checked: `EngineFacade.index/localizer/search/iconFor` (T9) match consumers (T10–13); `hk-*` selectors and inputs (T6/T8) match usage (T10–12); `buildSprite` authors.json (T7) consumed by About (T13); `LocaleService.locale` (T4) consumed by T9's localizer computed.

**Known risks for the executor:** the 600 KB initial budget is the tightest gate — Task 14 pre-authorizes dynamic-importing marked/dompurify; if still over, lazy-load the library route and escalate before trimming features. Vitest-under-Angular-builder is new toolchain surface — if `ng test` friction blocks a task, escalate rather than switching test runners unilaterally. The e2e offline test depends on ngsw idle timing; use Playwright's `waitForFunction` on `navigator.serviceWorker.controller`, not sleeps.

## What comes next

Phase 1b plan (solo builder & play): Dexie event tables + `StreamReplica`, the creation wizard over the system entity's creation choices, `derive` consumption on a live sheet, level-up flow for Fighter/Wizard 1–5 — consuming this plan's shell, components, facade and the plan-2 pack.
