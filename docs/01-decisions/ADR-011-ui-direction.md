# ADR-011 — UI direction and customization

**Status:** Approved 2026-08-30. Depends on ADR-005. Design system details in
`02-architecture/09-frontend-architecture.md`.

## Context

"It must look good; this is not a spreadsheet, almost as if you play a game." At the same
time it must be convenient to *read and edit* on a phone at a dim table, on a tablet, and
on a laptop. Owner's guidance: start simple, add fantasy styling once the basic layout
exists; allow user customization. Fonts must cover Cyrillic including Ukrainian letters —
most "fantasy" web fonts do not.

## Options considered

| Option | Assessment |
|--------|-----------|
| Component library skin (Material/PrimeNG) | Fast, but reads as an admin dashboard; fighting the library's look costs more than building the ~25 components we need. |
| Full fantasy skin from day one (textures, ornaments) | High effort before the layouts are known; risks illegible contrast; hard to keep responsive. |
| **Token-based design system, restrained "game-adjacent" look first, fantasy skin as a theme later (chosen)** | Layout and readability first; skins are token sets plus optional decorative layers; user preferences map onto tokens. |

## Decision

### Principles

1. **Readable at arm's length in dim light.** Body ≥ 16 px on phones, contrast ≥ 4.5:1
   for text and ≥ 3:1 for large numerals/icons; HP, AC, slots are the biggest things on
   the play screen.
2. **Touch-first.** 44 × 44 px minimum targets; primary actions reachable by thumb;
   swipe between play tabs; long-press for secondary actions with visible alternatives.
3. **Game feel through structure, not clutter.** Cards with clear hierarchy, stat blocks,
   an HP bar with damage/heal animation, slot "pips", condition chips with icons, a
   portrait frame, and one display typeface for headings. Textures and ornaments are
   *optional layers* controlled by a token, off in Phase 1.
4. **Editing is safe.** Play mode is read-mostly with big affordances for the few live
   actions; Build mode exposes the wizard-driven edits; Override mode is explicit and
   audited (ADR-004).
5. **Motion is meaningful and switchable.** Damage shake, slot spend, level-up flourish —
   all under `prefers-reduced-motion` and a user toggle.

### Layouts

- **Phone (play):** a tabbed screen — *Combat* (HP, temp HP, AC, initiative, conditions,
  death saves, weapons/attacks with roll buttons), *Spells* (slots as pips, prepared
  list, cast → spend), *Inventory* (equip/attune, weight, currency), *Features*,
  *Notes/Timeline*. A persistent header shows portrait, name, level, HP bar.
- **Tablet/desktop (sheet):** multi-column sheet with the same components; Build mode
  adds the side panel with the wizard; the library opens as an overlay.
- **DM (party):** a grid of party cards (token, HP bar, AC, passive perception,
  conditions, concentration) with one-tap effects and a roll log; tapping a card opens the
  full sheet.

### Design system

- **Tokens** (`packages/ui-tokens`): color (surface/border/text/intent scales),
  typography (2 families, 6 sizes, line heights), spacing (4 px grid), radii, elevation,
  motion durations, z-index, touch sizes, breakpoints, and *decoration* tokens (texture
  opacity, ornament visibility) — exported as SCSS maps and as CSS custom properties on
  `:root` / `[data-theme]`.
- **Themes** are token sets: `dark` (default), `light`, `high-contrast`; later `parchment`
  and `arcane` (fantasy skins). A theme never changes layout.
- **User customization (Settings → Appearance):** theme; accent color; font size
  (S/M/L/XL); density (comfortable/compact); reduce motion; reduce decoration; dice
  animation on/off; play-tab order.
- **Typography:** self-hosted (no runtime third-party requests). Body/UI: *Inter* (or
  *Golos Text* — both full Cyrillic). Display: *Philosopher* in Phase 1; *Forum* (Roman
  inscriptional caps) or *Cormorant* for the fantasy skin. Avoid Cinzel, Uncial Antiqua,
  MedievalSharp, IM Fell — no Cyrillic.
- **Icons:** game-icons.net subset for content; Lucide (ISC) for UI chrome.
- **Components (own, built on Angular CDK):** button, icon-button, card, sheet-section,
  stat-tile, hp-bar, pips, chip, tabs, dialog/sheet (bottom sheet on phones), menu,
  select/listbox, toggle, stepper (wizard), searchable list with virtual scroll, toast,
  skeleton, portrait-frame, dice-result.
- **CSS style guide:** adapted from the TAMS CSS style guide structure (surfaces, borders,
  text, intent tokens, breakpoints, touch targets, radii, elevation, z-index, motion
  pairs, checklist), written for SCSS + custom properties, with logical properties for
  future RTL, container queries for the sheet, and `@layer` ordering.

## Consequences

- Phase 1 looks clean and slightly "game-like" (dark surfaces, gold accent, display
  headings, iconography) without textures. The fantasy skin is a Phase 5 theme.
- Accessibility is a design constraint from the start: keyboard navigation via CDK
  a11y, ARIA on custom controls, contrast checked in the tokens package.
- The visual-companion mockup step is deferred to the session that builds the first
  screens; no mockups were produced in this planning session by owner choice.

## Open points

- Body font: **Inter** (owner decision 2026-08-30). Re-evaluate against Golos Text only if
  Cyrillic rendering at 16 px on a real phone disappoints in Phase 1a.
