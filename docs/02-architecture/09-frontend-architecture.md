# Frontend architecture (`apps/web`)

Angular 22 PWA, zoneless, signals, standalone components, SCSS with runtime CSS custom
properties. Conventions inherited from TAMS (`04-reference/tams-conventions.md`) unless
stated otherwise.

## Folder layout

```
apps/web/src/
  main.ts, app/app.config.ts, app/app.routes.ts
  app/shared/
    components/        design-system components (button, card, hp-bar, pips, chip, tabs, dialog, sheet-section, stat-tile, stepper, list, toast, portrait-frame, dice-result …) — each with SKILL.md
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
`shared/components`. Co-located files: `x.component.ts|html|scss`, `x.constants.ts`,
`x.interfaces.ts`, `x.service.ts`, `x.forms.ts` as needed. TS path aliases: `@app/*`,
`@shared/*`, `@hk/engine`, `@hk/protocol`.

## State: signal stores over event replicas

| Store | Holds | Source |
|-------|-------|--------|
| `AuthStore` | user, session status, devices | api |
| `PackStore` | `corePack`, `installedContent`, `translationPacks`, `packs` (all three), `installed` (`id@version` list); writes via `importContent`/`installContent`/`removeContent`/`importTranslation`/`removeTranslation`. "Enabled" = pinned per character (`facts.pins`); the per-pin-set index cache lives in `EngineFacade.indexFor` | Dexie + static assets |
| `StreamReplica<T>` | committed events, pending events, `facts` (computed), `lastSeq` | Dexie + sync client |
| `CharacterStore` | `replica` + `sheet = computed(() => derive(facts(), index(), opts()))`, outstanding choices, issues | engine |
| `CampaignStore` | campaign replica, settings, members, party overview, roll log | engine + sync |
| `SessionStore` | connection state, pending count, notices | sync |
| `BlobStore` | availability by hash, in-flight downloads | images |
| `SettingsStore` | theme, locale, density, units, storage caps | Dexie |

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

| Route | Shows |
| --- | --- |
| `/packs` | The core, content and translation groups. Import opens the hidden `.hkpack`/`.json` input, then `HkpackReader`, then the trust dialog. Content rows show "Update available" and "From another device" badges. |
| `/packs/:key` | Detail: the same info as the trust dialog, plus "Used by N characters" and Remove (not offered for the core). The count is a `reduce` fold over stored event logs, in `PackUsageService`. |
| `/packs/homebrew` | The homebrew list. |
| `/packs/homebrew/new/:type`, `/packs/homebrew/edit/:type/:slug` | The homebrew forms. |

Task 3 added axe e2e checks for the list, the core detail, and the trust dialog. Task 9 added an
end-to-end flow (`e2e/custom-packs.spec.ts`).

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

`@hk/ui-tokens` emits `tokens.scss` (maps) and `tokens.css` (custom properties per
theme). `ThemeService` sets `data-theme` and `data-density` on `<html>`, applies user
accent (`--accent-h`), font scale (`--font-scale`), motion/decoration flags. Components
only use tokens (`var(--surface-2)`); raw colors outside `tokens` are lint errors
(stylelint rule). SCSS is used for nesting, mixins (`@include touch-target`), and
breakpoints; never for colors.

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
