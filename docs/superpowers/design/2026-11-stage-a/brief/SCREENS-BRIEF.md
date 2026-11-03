# Screens phase — shared brief for every screen-group builder

The owner approved concept A "Tavern Table" and the foundations (spec + design system). This phase designs EVERY remaining screen of the app in that language. Desktop first (1440, English); phone boards (390 × 844, Ukrainian) only for the screens your group prompt lists. Tablet is not drawn in this phase.

## Sources of truth (read before building)

1. `<KIT>/BOARD-RULES.md` — the artboard format, silent-failure rules, icons, textures, fonts, accessibility floor, the Playwright self-check. Every rule still applies.
2. `D:\Projects\Programming\Personal\DndHeroCreator\docs\superpowers\specs\2026-11-02-frontend-redesign-foundations.md` — the spec: principles (§1), app map and navigation (§2), the three-zone action strap (§3), flows (§4), visual direction (§5), iconography and the HINT RULE (§6), component inventory (§7), conditions with duration and the DM round-advance + house rule (§8), features by source (§9), home (§10), owner calls (§11).
3. Materials, exact: `<KIT>/out/A2/A2-Desktop.src.html`, `A2-Phone.src.html`, `build.cjs` (concept A v2: ground wood, leaves, leather, brass rail/buttons/tabs, wax seals, satchel, strap). Copy its CSS; do not reinvent it.
4. The design system (the component vocabulary the engineer will build): `<SCRATCH>\ds\project\README.md` (brand book), `<SCRATCH>\ds\check\tokens.css` (compiled tokens: `--…` variables for all three themes) and `<SCRATCH>\ds\project\components\bundle.css` (every `hk-` component class), plus `<SCRATCH>\ds\project\components\<Comp>\preview.html` for the exact markup of each component (NavRail, ActionStrap, Leaf, Stepper, PickerCard, DescriptionDrawer, Dialog, ConditionChip, SatchelGrid, PartyCard, Tabs, SearchField, FilterChips, NumberField, Toast, Banner, …). PREFER the design-system markup and classes for every component; inline `tokens.css` + `bundle.css` into each board's `<helmet><style>` (the tavern theme is the default; you may add a `data-theme="tavern"` attribute on the root), then add only the page-specific styles. This keeps all screens identical in detail and makes the Stage B mapping direct.
5. Content: `<KIT>/CONTENT.md` (the hero Ilyana Vorn and the shared strings) and the real SRD pack for every other name: `D:\Projects\Programming\Personal\DndHeroCreator\apps\web\public\packs\srd-5e-2024\0.1.0\` (JSON; species, classes, subclasses, backgrounds, feats, spells, items, conditions, masteries, fighting styles — use the real entity names and short descriptions, never invented ones). Existing Ukrainian UI strings: `D:\Projects\Programming\Personal\DndHeroCreator\apps\web\src\assets\i18n\**\uk.json` (reuse them; invent only what is missing and list it in notes.md).
6. The audit of the current app: `<SCRATCH>\audit\inventory.md` (per-screen findings by screen id; the 10 worst defects at the top) and `<SCRATCH>\audit\actions.md` (every control per template with en/uk). Your boards must (a) fix every listed defect for your screens and (b) give every control of your screens a home (icon-first with hints, strap zones, drawers, sheets). Record both in a coverage table.

`<KIT>` = `C:\Users\Admin\AppData\Local\Temp\claude\D--Projects-Programming-Personal-DndHeroCreator\938d9d11-18a4-4afd-865a-427418607db9\scratchpad\kit`, `<SCRATCH>` = its parent folder.

## Rules for this phase

- Every screen carries the brass rail (desktop) or the phone top bar, and the action strap in its three zones exactly as §3 defines for that screen. Flows (wizard, level-up) use the shared stepper (vertical on desktop, compact strip on phone) and the description drawer.
- The hint rule: no legends anywhere; every meaning glyph has a tooltip (hover) or long-press hint; draw at least one tooltip open per board where it teaches something.
- Icons: game-icons only (`<KIT>/icons.json`, full repo at `<SCRATCH>\gi\icons`); concentration is the ORB glyph (`concentration-orb`), never an eye; weapons use weapon glyphs; the vocabulary in spec §6 is binding; class icons as in the existing sprite set.
- Nothing hides behind a giant scroll: a desktop board is at most ~1400 px tall; longer regions become tabs inside a leaf, or drawers. Pickers use the full height of the page (no inner scroll boxes), with search and filter chips on top.
- Ukrainian boards use the real uk strings; nothing clipped; 44 px targets; the combat-critical reads above the fold where relevant.
- Every board is a self-contained `.dc.html` per BOARD-RULES (no `{{ }}`, no `data:` URIs, one Google Fonts link, support.js line kept, `$preview` = frame size, desktop = fluid PAGE, phone = fixed 390 × 844).
- Copy is UI copy: sentence case, plain verbs, consistent names (the button that says "Create hero" leads to a toast "Hero created"). Destructive actions keep a text label and a confirm dialog with consequence text.
- Draw states that matter: one disabled-with-reason control, one error/validation state, one empty state, one loading state somewhere in your group.

## Deliverables

Into `<KIT>/out/<Group>/`: `<Id>-Desktop.dc.html` (and `<Id>-Phone.dc.html` where listed), a PNG per board, `shoot.cjs`, and `notes.md` with: measured desktop heights, fonts, the coverage table (audit screen ids → boards; audit defects → how fixed; actions.md controls → where placed), every string you invented in uk, every compromise. Render with Playwright and look at every board at least twice; fix overlaps, clipping, contrast. Do not publish; do not touch the git repository; do not install anything.
