# XpBar

A thin brass gauge under the sheet tabs showing XP toward the next level, with the count in Forum; when XP allows, the "Level up" tab-shaped action lights up beside the tabs.

## Anatomy

`hk-xp`: the "XP" label (`text-on-leather-2` on the folio, `text-2` on a leaf), `hk-gauge hk-gauge--thin` (8px, `recess` track) with `hk-gauge__xp` (`brass-bottom` to `brass` gradient, width = (xp − floor) / (next − floor)), the count "6,500 / 14,000" in Forum 15px with thousands separators per locale, and when ready a brass `hk-chip--selected` "level 6 ready". The sheet tabs above it include the Level up slot: disabled `hk-tab--off` with the `padlock` glyph and the reason in its hint, or `hk-tab--action` (brass ring + glow, `upgrade` glyph) when available.

## States

Progress, ready (full bar + action tab), milestone campaigns (bar hidden, the level shown as a chip), XP granted by the DM (bar animates over `duration-base`).

## Accessibility

`role="progressbar"` with min/max/now and a label that states the numbers; the disabled tab explains itself in `title`.

## Tokens

`recess`, `border-brass`, `brass`, `brass-bottom`, `brass-top`, `text-on-leather`, `text-on-leather-2`, `text-1`, `text-2`, `shadow-glow-brass`, `duration-base`.
