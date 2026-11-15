# Frontend architecture (`apps/web`)

Angular 22 PWA, zoneless, signals, standalone components, SCSS with runtime CSS custom
properties. Conventions inherited from TAMS (`04-reference/tams-conventions.md`) unless
stated otherwise.

## Folder layout

```
apps/web/src/
  main.ts, app/app.config.ts, app/app.routes.ts
  app/shared/
    components/        what plan 17 did not replace: button, campaign-chip, campaign-edit-lock-banner, dice-result, rebase-report-dialog, skeleton, toast, virtual-list — each with SKILL.md
    directives/ pipes/ icons/ types/ constants/ helpers/
    services/
      storage/         dexie.db.ts (schema + migrations), repositories (events, snapshots, blobs, packs, settings)
      sync/            sync-client.ts (socket, backoff, hello/ack/reject), stream-replica.ts (committed+pending), leader.ts (Web Locks + BroadcastChannel)
      engine/          engine.facade.ts (content index cache, derive memo), pack-loader.ts
      images/          pipeline, blob-transfer, placeholder
      auth/            auth.service.ts, session guard
      api/             api.service.ts (ApiResult<T>, never throws)
      i18n/            transloco config, locale.service.ts, gender helpers
      theme/           theme.service.ts (data-theme, tokens), preferences
      pwa/             install-prompt, update, storage-persist, wake-lock
      export/          bundle writer/reader (fflate), share/save
    stores/            signal stores (see below)
  app/ui/              the design-system component library (plan 17): one folder per component, selector hk-<name>
  app/views/
    home/
    auth/              login, register, recovery, devices
    characters/        list; create-wizard/; sheet/ (play, build, timeline, override); level-up/
    campaigns/         list; create; lobby (join code/QR); party; settings; log; packs
    library/           browse + search + entity detail
    packs/             installed list, import + trust dialog, detail/remove, homebrew/ (item/spell/feat/species forms) — lazy (plan 15)
    settings/          appearance, language, storage, account, about/attribution
  assets/i18n/<scope>/<locale>.json, assets/icons/sprite.svg, assets/fonts/
  styles/              tokens.scss (from @hk/ui-tokens), base.scss, typography.scss, layers.scss, utilities.scss
```

Rule: a component lives under the view that uses it; on the second consumer it moves to
`ui/` (a design-system component) or `shared/components` (a plain helper). Co-located files: `x.component.ts|html|scss`, `x.constants.ts`,
`x.interfaces.ts`, `x.service.ts`, `x.forms.ts` as needed. TS path aliases: `@app/*`,
`@shared/*`, `@hk/engine`, `@hk/protocol`.

## State: signal stores over event replicas

| Store              | Holds                                                                                                                                                                                                                                                                                                                        | Source                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `AuthStore`        | user, session status, devices                                                                                                                                                                                                                                                                                                | api                   |
| `PackStore`        | `corePack`, `installedContent`, `translationPacks`, `packs` (all three), `installed` (`id@version` list); writes via `importContent`/`installContent`/`removeContent`/`importTranslation`/`removeTranslation`. "Enabled" = pinned per character (`facts.pins`); the per-pin-set index cache lives in `EngineFacade.indexFor` | Dexie + static assets |
| `StreamReplica<T>` | committed events, pending events, `facts` (computed), `lastSeq`                                                                                                                                                                                                                                                              | Dexie + sync client   |
| `CharacterStore`   | `replica` + `sheet = computed(() => derive(facts(), index(), opts()))`, outstanding choices, issues                                                                                                                                                                                                                          | engine                |
| `CampaignStore`    | campaign replica, settings, members, party overview, roll log                                                                                                                                                                                                                                                                | engine + sync         |
| `SessionStore`     | connection state, pending count, notices                                                                                                                                                                                                                                                                                     | sync                  |
| `BlobStore`        | availability by hash, in-flight downloads                                                                                                                                                                                                                                                                                    | images                |
| `SettingsStore`    | theme, locale, density, units, storage caps                                                                                                                                                                                                                                                                                  | Dexie                 |

`computed` + `linkedSignal` for derived state; `effect` only for I/O boundaries
(persist, socket sends). No NgRx. Components read signals and call store methods that
build events via `engine.propose*` and hand them to the replica (`replica.append(events)`
→ local apply + persist + send).

### Engine scoping (plan 15)

Each character derives against its own pinned pack set, so there is no single global content
index (doc 04, "Per-character content index"). The scoping rules, from task 4:

- **Root facade.** `EngineFacade.index()`/`localizer()` on the root injector cover the core plus
  its translations. Library browse/detail, pack info, and the campaign party views use them.
- **Character index.** `CharacterStore.index` = `indexFor(facts.pins)`. `CharacterStore.missingPins`
  lists pins with no installed `id@version`; the sheet shell shows them in the missing-pack banner.
- **Scope providers.** `provideEngineScope(scope)` (`shared/services/engine/engine-scope.providers.ts`)
  provides a component-level `EngineFacade` resolved against `scope.pins`, plus a component-level
  `DialogService`.
  - The sheet shell provides `CharacterEngineScope`, which covers every tab and level-up.
  - The creation wizard provides `CreateWizardState`, and the add-item dialog provides its own
    scope.
  - Scoping follows the element injector tree. Routed children see the scope.
  - Dialogs opened from inside a scope get a content injector parented to the opener, so they see
    the scope too. This covers the provenance popover, the add-item dialog, and the rebase report.
- **Root services.** `MarkdownService`, `CharacterStore` and the other root services see only the
  root facade. Callers pass a localizer (`MarkdownService.render(markdown, localizer?)`) or use
  `indexFor(pins)`.
- **Known gap.** The DM party view still uses the root index for members' characters (task 4,
  concern 1).

### Packs route (plan 15)

`/packs` loads `views/packs/packs.routes.ts` lazily. It has a nav entry, and Settings links to it.

| Route                                                           | Shows                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/packs`                                                        | The core, content and translation groups. Import opens the hidden `.hkpack`/`.json` input, then `HkpackReader`, then the trust dialog. Content rows show "Update available" and "From another device" badges. |
| `/packs/:key`                                                   | Detail: the same info as the trust dialog, plus "Used by N characters" and Remove (not offered for the core). The count is a `reduce` fold over stored event logs, in `PackUsageService`.                     |
| `/packs/homebrew`                                               | The homebrew list.                                                                                                                                                                                            |
| `/packs/homebrew/new/:type`, `/packs/homebrew/edit/:type/:slug` | The homebrew forms.                                                                                                                                                                                           |

Task 3 added axe e2e checks for the list, the core detail, and the trust dialog. Task 9 added an
end-to-end flow (`e2e/custom-packs.spec.ts`).

## The `ui/` library (plan 17)

Plan 17 rebuilt the presentation layer. `app/ui/<component>/` holds one folder per design-system
component, with the selector `hk-<name>` matching the component's name in the Stage A design
system (`docs/superpowers/design/2026-11-stage-a/design-system/`), SCSS on tokens only, a spec and
(for the shared ones) a SKILL.md. Views were rebuilt in place under `app/views/`; the stores,
services, engine facade, route paths and every behaviour stayed. The old `shared/components`
that nothing imported any more were deleted in B16a; the eight that still have importers remain.

- **Icons.** `hk-icon` draws from one SVG sprite (`assets/icons/sprite.svg`, ui + game-icons
  glyphs), an external `<use href>` fetched asynchronously and cached by the service worker.
  `ui/icons/vocabulary.ts` is the typed list of icon names.
- **Hints.** `hkTooltip` is the one hint (hover and focus on a pointer, long-press on touch).
  `aria-label` is always set on the host; `aria-describedby` points at the hint slip only while
  the slip is in the DOM (plus any always-present extra, such as a disabled reason).
  `apps/web/src/testing/icon-hints.ts` is the template lint that every `hk-icon-button` has a
  `hint` and every button whose only child is an `hk-icon` has an `aria-label`.
- **Fit-label rule.** `[hkFitLabel]` (action-strap and tab-bar tiles): a label wider than its tile
  is hidden visually (class `hk-fit-label--icon-only`), kept in the accessible name, and the
  tile's hint becomes its visible label. Re-checked on resize and language change. Elsewhere text
  wraps, or truncates with `data-truncate` plus the full text in a hint (see `06-i18n.md`).
- **Drawers and bottom sheets.** `hk-drawer` is the one side panel: a parchment panel from the
  right on tablet and desktop, a full-height bottom sheet with a grip on a phone. It never
  touches the URL; it closes on Close, Escape, an outside press and any router `NavigationStart`,
  and traps focus while open. `hk-dialog` is the modal one.
- **Descriptions.** `hk-description-drawer` renders an entity through `hk-entity-facts`.
  Known layering gap: it imports `CreateWizardState` from `views/` (owner-flag in
  `03-roadmap/phases.md`).

### Shell, strap and tab bar

The app frame is `ui/shell`: a phone top bar (`TopBarService` sets its title and one context
action), a nav rail on tablet and desktop, an app drawer on a phone, and one `hk-textures` host
that defines the SVG filters (below). `viewport.ts` exports `phoneLayout()`, a live signal for
`max-width: 767.98px`; CSS handles the layout differences and this signal is for places that
render a different DOM.

- **`ActionStrapService`** (`ui/action-strap`): every screen sets one `StrapConfig`, three zones:
  exit (Cancel/Back, leftmost), primary actions in a fixed order, secondary icon-only actions
  (one More button on a phone). The strap re-renders by action id, so a slot never moves between
  steps. Through `routeScopedState` it clears itself on a `NavigationStart` that leaves its
  `scope` path prefix (a sheet keeps it across its tabs), and comes back if the navigation fails.
- **`TabBarService`** (`ui/tab-bar`): the phone's bottom tabs. A screen with tabs (the sheet,
  the campaign shell) sets them while open and passes `null` when it goes; with none the bar is not
  rendered and the page reserves no space. Desktop ignores it; its tabs live on the folio.
- **`NavHistoryService`** (`ui/nav`): the shell records each committed in-app URL; a screen's Back
  calls `back(fallback)`, returning to the previous distinct path or, with no history (deep link,
  fresh load), to the screen's parent in the app map. Entries compare by path, a browser traversal
  onto the previous entry pops the stack, and it keeps at most 50 entries. The in-app Back is a
  forward navigation (R74): it opens the previous screen at the top and does not restore scroll.
- **Phone tab routing.** The sheet is `/c/:id` with child routes. On a tablet or desktop the tabs
  are Play, Build and Timeline. Below 768 px they are Combat, Spells, Bag, Hero and More, and the
  same leaves are composed by those tabs. The sheet shell (`SheetShellComponent`) is the one place that reconciles route and
  width: `/play` lands on `/combat` on a phone, and from 768 px a phone-tab URL resolves to
  `/play`, both with `replaceUrl`, so deep links and Back keep working.
- **Router scrolling (R73).** `appRouterScrolling` in `app.config.ts` is
  `withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' })`: a
  screen opens at the top after a navigation, a browser or hardware Back restores the previous
  position, and a link with a fragment (the Settings sections) scrolls to its anchor.

## Routing

Flat `Routes` with `loadComponent`; shell route with the app frame (header, nav,
offline/pending indicator). Guards: `authGuard` (Phase 2+ routes), `characterGuard`
(loads replica), `campaignGuard`. Deep links: `/join/<code>` (QR target),
`/c/<characterId>/play`, `/g/<campaignId>/party`.

## Play/Build/Timeline sheet

`sheet/` is one route with a mode signal; phone layout uses `@defer` per tab and swipe
navigation (CDK `Overlay`-free; simple pointer events); tablet/desktop uses a CSS grid
with container queries. Components render `Derived<number>` values with a provenance
popover (`hk-derived` directive).

## Forms

Reactive forms for the wizard and settings (ADR-005 open point); Zod schemas from
`@hk/protocol` validate on submit; per-field messages via Transloco keys.

## PWA

`@angular/service-worker` with `ngsw-config.json`: app shell `prefetch`; `/packs/**`
`prefetch` for the core pack version in use, `lazy` for others; fonts and icon sprite
prefetch; API excluded. `SwUpdate` prompts "Update available" (never auto-reloads during
a session). Install prompt handling (`beforeinstallprompt` on Chromium; instructions
sheet on iOS). `navigator.storage.persist()` after first character. Wake Lock toggle in
play mode.

## Theming

`@hk/ui-tokens` is the single source of visual truth. `packages/ui-tokens/src/tokens.json` is a
typed JSON (validated by a Zod schema in `schema.ts`, exported as `TOKENS`), and `build.ts` emits
`tokens.css` (custom properties per theme) and `tokens.scss`. There are three themes, `tavern`
(default), `scroll` and `plain`, listed in `themes.ts` (`THEME_IDS`). `ThemeService` stores the
choice in `localStorage` (`hk.theme`, with the old `dark`/`light` values mapped to tavern/scroll),
sets `data-theme` on `<html>`, and the top bar's theme menu switches it at runtime. Components only
use tokens (`var(--leaf)`); a raw colour outside the tokens is a lint error. SCSS is for nesting,
mixins and breakpoints; never for colours.

- **Textures.** `ui/textures` renders once in the shell: a zero-size SVG defining three
  `feTurbulence` filters (`hkWood`, `hkPaper`, `hkLeather`). `styles/textures.scss` applies them as
  `.hk-tex` overlays. There are no texture image files, so no bytes beyond CSS. `plain` drops
  textures, rivets and ornaments and uses flat brass for 3:1 borders.
- **Fonts.** The theme faces (Alegreya, Forum, Inter, Philosopher; 11 `@font-face` rules over
  `assets/fonts/**.woff2`, 13-115 kB each) load on use through `unicode-range` and are not
  preloaded: the faces differ per theme, so a static preload in `index.html` would waste bytes on
  two of three. A preload of the tavern heading face alone is a later option.
- **Contrast.** The axe e2e gate scans every screen in each theme (17 scans x 3).

### Divergence from the Stage A design source

The packaged `packages/ui-tokens/src/tokens.json` began as a copy of
`docs/superpowers/design/2026-11-stage-a/design-system/tokens.json` and now diverges from it. B16a
dropped the legacy alias block (`surface-0..3`, `border-1`, `accent`, `accent-contrast`, `danger`,
`success`, `radius-s/m/l`, `duration-s/m`, the legacy font scale, `accent-h`, `accent-s`,
`motion`) after re-pointing the ~151 references in `apps/web` to the design-system names, and
removed the unused schema field `meta.aliasesForEngineers`. The Stage A copy is a frozen design
record and is not updated; the packaged file is the source of truth. A `legacy` group remains
(`shadow-1`, `shadow-2`, used by 11 references in 8 `ui/` components), as do `text-1..3`, `space-1..6`, `warning`,
`overlay` and `accent-strong`.

### Deviations from the plan 17 text

- **Sprite not split per route group (R11).** One sprite, `assets/icons/sprite.svg`: 168,445 B raw,
  72.4 kB gzip. It is fetched asynchronously, is not in the JS/CSS initial files and is cached by
  the service worker. Even added to the initial total (371.3 + 72.4 = 443.7 kB) it is inside the
  600 kB budget, so the split was not worth an extra fetch per route group (measured in B15b).
- **Fonts are not preloaded** (above); the plan's "lazy-load theme assets" is met by `unicode-range`
  loading on use.
- **Bundle gate corrected (R31).** `apps/web/tools/check-bundle-budget.ts` now walks the static
  `import`/`export ... from` edges from the files `index.html` references, so statically imported
  chunks count. Under it the initial gzip is **371.3 kB** of 600. The earlier 368.4 was not
  like-for-like (the old gate missed those chunks), and the "+8.1 kB" seen in B12b was an artefact
  of the old gate: 299f091 measures 371.2 and 77f668c 370.5 under the corrected one. It is a regex
  walk, not a parser: text such as `import "./x"` inside a minified string would over-count, which
  is the safe direction.

## Accessibility

CDK `A11yModule` (focus trap, live announcer for HP changes and rolls), roving tabindex
in lists, ARIA on custom controls, `prefers-reduced-motion`, 44 px targets, visible focus
rings. Playwright axe checks on the main screens.

## Error handling

`ApiResult<T>` never throws; UI shows localized notices. Engine derivation never throws
(issues list). Sync rejects → toast + rollback. Global `ErrorHandler` logs to console
only (no telemetry).

## Build and quality

`ng build` with budgets (initial ≤ 600 KB gzip target); ESLint flat config
(angular-eslint + template a11y + i18n rule); stylelint for SCSS; Prettier 120/single
quotes; Vitest unit tests via the Angular builder; Playwright e2e.
