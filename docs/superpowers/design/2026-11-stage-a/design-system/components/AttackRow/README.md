# AttackRow

One attack in the Attacks leaf: a leather ring with the weapon's own glyph (never an action glyph), the name, to-hit and damage in Forum numerals, the damage type as a tinted tag, property and mastery chips, and a brass Roll button.

## Anatomy

`hk-arow`: a 5-column grid (30px ring · name 1.4fr · to-hit 56px · damage 1fr · button), gap 5px 10px, with a `hk-th` header row. Per attack:

- `hk-iring` with the weapon glyph: `broadsword` longsword, `thrown-spear` javelin (replacing the old action glyph), `fist` unarmed, `crossbow`, `warhammer`, `spears`; magic weapons add the attuned gem beside the name.
- Name 16px bold; to-hit `numeral-m` 23px; damage Forum 20px over a `hk-chip--damage` tag (`--dmg` set to the `damage-<type>` token: the dot and the word in one ink on `leaf-sunken`).
- `hk-arow__tags`: `hk-chip` for properties ("versatile 1d10", "thrown 30/120"), mastery (`sword-array` glyph, hint "Weapon mastery: Sap"), `hk-chip--dark` equipped (`gauntlet`), `hk-chip--ember` for a disadvantage condition with its reason in the hint.
- Roll: brass `Button` with the d20 glyph, `aria-label="Roll Longsword"`; rolls attack then damage into the log.
- `hk-arow__rule`: a hairline between attacks.

## States

Equipped / unequipped (unequipped weapons list below a rule with `hk-chip` "in bag"), advantage / disadvantage chip, focus on Roll. Phone: the same row in a `hk-leaf--phone` with the tags under the name and a 44px Roll.

## Density

Compact as shown; comfortable adds 4px row gap and 36px rings.

## Accessibility

Numerals `text-1` on leaf 11.6:1; damage tags 4.5:1+ (every `damage-*` ink passes on `leaf-sunken` in all themes); chips 9:1. The tag always carries the word, never a colour alone.

## Tokens

`leaf-sunken`, `leaf-edge`, `text-1`, `text-2`, `accent-strong`, `brass`, `brass-top`, `leather-highlight`, `leather-dark`, `chip-bg`, `chip-border`, `chip-dark`, `danger-soft`, `danger-strong`, `damage-slashing`, `damage-piercing`, `damage-bludgeoning` (and the other ten `damage-*`).
