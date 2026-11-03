# Stage A design handoff — plan 17 (frontend redesign)

Stage A of plan 17 was approved by the owner on 2026-11-03. This folder is the self-contained handoff for the Stage B build: everything a fresh session needs without the design session's context. Read this file first, then the spec, then the plan.

## Where things are

| What | Where |
| --- | --- |
| The approved foundations spec (principles, app map, navigation, action strap, flows, themes, icon rule, components, conditions, house rules, encounters, item icons) | `docs/superpowers/specs/2026-11-02-frontend-redesign-foundations.md` |
| The plan with the Stage B tasks | `docs/superpowers/plans/2026-10-18-phase-5-slice-1-frontend-redesign.md` |
| The design canvas (119 boards on 6 pages) | https://claude.ai/artifact/E4qnyAx7vou6m9xSiBbD1Y — artifact slug `69d01a76-ac1e-4d11-949c-895b1401e21f`; read any board with the claude-artifacts MCP tool `read_file` (slug + `project/<board>.dc.html`); `boards/canvas.json` here lists every board file, its page and frame |
| The design system "Herokeep" (tokens, 37 components with guidelines and live previews, icon vocabulary) | https://claude.ai/artifact/NQqWVahejkKzMnQV34PRWy — slug `ad63e9b9-e393-463e-bade-c16875a70d8a`; its files are copied under `design-system/` here |
| Design-system files (the engineering source) | `design-system/tokens.json` (3 themes, every token with a usage note), `design-system/tokens.css` (compiled: `:root`/`[data-theme]` variables and `.style` classes), `design-system/README.md` (brand book, hint rule, icon vocabulary), `design-system/components/<Comp>/README.md` + `preview.html` (37 components: anatomy, states, tokens, markup) |
| Board sources (the hi-fi screens as macro templates, with their CSS) | `boards/<group>/*.src.html` + `build.cjs`/`parts.cjs`/`shared.css`; `boards/S1/boards.cjs` generates the wizard boards from the SRD pack; the built `.dc.html` files (14 MB) are NOT in the repo: read them from the canvas |
| Builders' notes: coverage tables (audit screen → board, defect → fix, control → placement), invented Ukrainian strings, compromises | `notes/<group>-notes.md` (A2 concept, IA navigation/home, S1 wizard, S2 sheet/level-up/dialogs, S3 campaigns, S4 library/packs/settings/auth, S5 later ideas) |
| UX audit of the current app (2026-11-02, main @ d35dd09): 111 screens, 10 worst defects, per-screen findings, DOM measurements | `audit/inventory.md`, `audit/crosscutting.md` |
| Every control of the current app with its i18n key, en and uk (263 controls, 33 templates) | `audit/actions.md` |
| Icon set: curated game-icons names and the extraction script; per-group lists of glyphs actually used | `icons/extract-icons.mjs` (clone https://github.com/game-icons/icons with `--depth 1` and run `node extract-icons.mjs <clone>/ <out.json>`), `icons/S*-icons-used.json` |
| The sample content every board uses (hero Ilyana Vorn, en + uk strings), the builders' brief and board rules, the concept-A brief | `brief/CONTENT.md`, `brief/SCREENS-BRIEF.md`, `brief/BOARD-RULES.md`, `brief/concept-A.md` |

Design-session scratch (may still exist on the owner's machine, not guaranteed): `C:\Users\Admin\AppData\Local\Temp\claude\D--Projects-Programming-Personal-DndHeroCreator\938d9d11-18a4-4afd-865a-427418607db9\scratchpad\` with `kit/out/<group>/*.dc.html` + PNG renders, `ds/`, `audit/shots/` (662 screenshots of the current app), `gi/icons` (the game-icons clone).

## Board map (canvas page → boards → what they decide)

- **1 · Concept A & foundations** — `Main` (desktop Play sheet, en), `A-Phone` (Combat tab, uk), `IA-NavMap` (app map, Back/Next/Cancel rules), `IA-ActionStrap` (the three-zone strap in five contexts), `IA-Home-Desktop/-Phone/-Tablet`, `IA-Phone-Drawer`, `IA-Sheet-Tablet`.
- **2 · New hero wizard** — `W01`…`W10` desktop + phone, `W02-Species-Tablet`: stepper, pickers with the description drawer, four ability methods, class choices, equipment with the gold alternative gated by the starting-gold house rule, review.
- **3 · Sheet** — `B01-Build`, `T01-Timeline`, `L01`…`L04` level-up (L01 also shows the multiclassing-off variant), `D01` notes, `D02` roll log, `D03` description (drawers), `DL01` cast, `DL02` rests, `DL03` add condition with duration and the DM-locked variant, `DL04` add item + custom item with the icon picker + DM-only variant, `DL05` confirms; phones incl. `H-Hero-Phone` (the phone's Hero tab).
- **4 · Campaigns** — `C01`…`C11` desktop + phone, `C06-Party-DM-Tablet`: list, create, join, link, lobby, party (DM with quick effects, encounter plate, Advance round; player view), member sheet, table (session strip with encounters, rolls, chat), settings (house rules incl. the four new ones, packs), confirms/toasts/banners.
- **5 · Library, packs, settings, auth, states** — `LB01`…`LB03`, `PK01`…`PK05`, `H01`, `ST01`, `AU01`, `X01` desktop + phone, `LB01-Library-Tablet`.
- **6 · Later ideas** — `X-*` sketches. **Out of scope for Stage B** (owner, 2026-11-03: "only existing content"); kept as reference with per-idea cost notes in `notes/S5-notes.md`.

## Decisions that are final (do not re-open)

Concept A "Tavern Table" (dark oak ground, parchment leaves, leather, brass, wax seals; Forum + Alegreya; themes `tavern` default, `scroll`, `plain`); icon-first with the hint rule (no legends, no inline disabled reasons, no narrative captions); the three-zone action strap on every screen; navigation semantics per the spec §2.3; phone tabs Combat · Spells · Bag · Hero · More; campaign tabs Party · Table · Lobby · Settings; concentration glyph = `concentration-orb`; spell slots = wax seals embossed with the level numeral; class colours exist as tokens but are off; features grouped by source; choice features show their options; truncated summaries link to their entry; conditions carry a duration; round advance is a DM control inside encounters; house rules: players manage own conditions, starting gold, multiclassing, players add items; item icon picker with upload. The owner's words on each are quoted in the plan's Stage A record.

## How the next agent should use this

1. Read the spec, then the plan's Stage B tasks; each task names the boards and the design-system components it implements.
2. For exact markup and CSS of a screen, open the board's `.src.html` here (macros expand to the `hk-` classes in `design-system/components/bundle.css`) or read the built `.dc.html` from the canvas.
3. For every token value, use `design-system/tokens.json`; the current `packages/ui-tokens` names are kept there as aliases.
4. For every string, the uk translations the builders invented are listed per group in `notes/*-notes.md`; they are proposals for the i18n pass, not final copy.
