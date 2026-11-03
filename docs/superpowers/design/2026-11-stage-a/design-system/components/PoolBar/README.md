# PoolBar

A resource block inside the Resources leaf: name with its glyph ring, a Spend / Use button, the pool as a brass gauge (point pools such as Lay on Hands) or a row of wax-seal pips (uses and charges), the count, and the recharge hint.

## Anatomy

- `hk-block` + `hk-pool`: `leaf-sunken` fill with `leaf-edge` inset, padding 8px 10px, gap 6px.
- Row 1: `hk-iring` (28px leather ring with the resource glyph in `brass-top`), the name (16px bold), and a brass `Button` (Spend for pools, Use for pips; `hand-ok` glyph = use, `minus` = spend).
- Row 2: either `hk-gauge` 12px with `hk-gauge__brass` (width = current / max) or `hk-seal-row` of `WaxSeal` pips (s 26px for 5+ pips, m 28px for 1-4), filled = available, spent = pale.
- Row 3: the count in Forum 17px "18 / 25" with the unit in `text-2`, and the recharge hint in `hk-hint` (italic) with its glyph: `night-sleep` long rest, `campfire` short rest, `sunrise` dawn, plus the regain roll when there is one ("dawn · 1d6+1").

## States

Available, partly spent, empty (Use disabled with the reason in `title`: "No free cast left until a long rest"), recharging on rest (seals refill with a `duration-base` fade).

## Density

Compact: 2 blocks per row on desktop; comfortable: gap 10px, row min-height 32px.

## Accessibility

Gauge and seal rows are `role="img"` / `role="group"` with "18 of 25 points" / "5 of 7 charges"; each seal has its own hint. `text-1` ink on `leaf-sunken` 10:1, hint `text-2` 5.6:1.

## Tokens

`leaf-sunken`, `leaf-edge`, `text-1`, `text-2`, `accent-strong`, `brass-top`, `brass`, `brass-mid`, `leather-highlight`, `leather-dark`, `recess`, `border-brass`, the WaxSeal tokens, `duration-base`.
