# Reference project survey: TAMS (Angular conventions to inherit)

*Surveyed 2026-08-29 at D:\Programming\Work\Projects\Angular\tams. Only the Angular conventions are relevant; the .NET/Aspire parts are not used in this project (see ADR-005).*

Repository: D:\Programming\Work\Projects\Angular\tams (.NET + Angular + Aspire).

## Layout

- `src/`: .NET projects tams.api (GraphQL + REST host), tams.assets, tams.auth, tams.contracts, tams.data, tams.email, tams.identity, tams.migrator, tams.security; `Directory.Packages.props` (central package management).
- `src/tams.web`: production Angular app. `src/tams.prototype`: UI-only prototype (Tailwind 4), never deployed.
- `infra/aspire/apphost.cs`; `infra/nginx`; `infra/observability` (otel, prometheus, loki, tempo, grafana).
- `docs/backend/BACKEND-STYLE-GUIDE.md`, `docs/backend/ACCESS-CONTROL-PLAN.md`, `docs/ui/CSS-STYLE-GUIDE.md` (1329 lines; a good design-system spec).
- No CI workflows. No ADRs. Specs live at `src/tams.web/docs/superpowers/{specs,plans}/YYYY-MM-DD-slug-design.md`.

## Angular stack (src/tams.web/package.json)

| Area | What TAMS uses |
|---|---|
| Framework | Angular ^22.0.0; CLI / @angular/build ^22.0.9; TypeScript ~6.0.2; RxJS ~7.8 |
| State | No state library — native signals only (172 computed, 108 input(), 82 signal, 15 effect, 4 resource, 1 linkedSignal, 182 inject) |
| UI | Kendo UI for Angular 24.2.2 (commercial, license file in repo); NO Material/CDK/PrimeNG/Tailwind in tams.web |
| HTTP | provideHttpClient only; no Apollo/codegen; single APIService with graphql() returning a non-throwing ApiResult discriminated union (branch on `succeeded`); GraphQL query strings are inline literals in methods |
| i18n | @angular/localize polyfill only, effectively unused; strings hardcoded |
| Testing | None (skipTests: true everywhere; MANUAL-TEST-CHECKLIST.md instead) |
| Lint / format | ESLint ^10 flat config, angular-eslint 22.1, typescript-eslint 8.62, templateAccessibility on; Prettier printWidth 120, singleQuote, parser angular |
| tsconfig | strict, noImplicitOverride, noPropertyAccessFromIndexSignature, noImplicitReturns, noFallthroughCasesInSwitch, strictInjectionParameters, strictInputAccessModifiers |
| Package manager | npm 11.13 (packageManager field). No Nx. |

## Conventions in use

- Standalone components and OnPush are implicit (Angular 22 defaults, never written out). Zoneless (no zone.js).
- No constructor injection — inject() everywhere; host bindings declared in `host: {}`; native control flow `@if` / `@for`.
- Folder structure: recursive `views/NAME/{components,dialogs,views}/`; `app/shared/{components,constants,directives,dialogs,enums,guards,helpers,icons,interceptors,interfaces,nav-items,pipes,popups,services,theme,types}`.
- Co-location: `x.component.ts/.html/.css` + `x.constants.ts` + `x.interfaces.ts` + `x.service.ts` + `x.forms.service.ts` for stateful components; dumb components = 3 files.
- kebab-case file names; suffixes `.component` / `.service` / `.interfaces` / `.constants` / `.helpers` / `.directive`; styles are `.css` (SCSS banned); external `templateUrl` / `styleUrl`.
- Routing: one flat `Routes` array; leaf routes lazy via `loadComponent()`; `''` shell `MainComponent` with `authGuard` and lazy children.
- Theming: runtime CSS custom properties in `src/styles.css` (`:root` / `.theme-dark` / `.theme-light`, "Corporate Slate"); `ThemeService` sets the class on `html` from `provideAppInitializer`; a raw hex value outside the tokens is treated as a bug; `::ng-deep` banned.
- Class-body section markers: `// Dependencies`, `// Properties`, `// Methods`.
- Conventional Commits with component scope (habit only; no husky/commitlint).

## Inherit

- CSS-variable runtime theming and the CSS style guide structure.
- `views/` + `components/` ownership rule ("second consumer → shared/").
- ApiResult never-throw pattern.
- ESLint / Prettier / tsconfig strictness.
- Per-component SKILL.md habit.
- Signals-only state.
- inject() instead of constructor injection.
- Class-body section markers.
- Conventional Commits.

## Drop

- Kendo UI (commercial).
- "Comment above every element" template rule.
- Zero-tests policy.
- Deep relative imports (use TS path aliases instead).
- Dummy-data-first services.
- Parallel prototype app.
