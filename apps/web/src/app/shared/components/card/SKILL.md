# hk-card

Element selector `hk-card`. A surface with an optional header row and a projected body.
`role` is left to the consumer (a card is presentational by default).

## Usage

```html
<hk-card [header]="t('library.spells')">
  <p>{{ t('library.spellsEmpty') }}</p>
</hk-card>
```

```html
<!-- no header row when `header` is omitted -->
<hk-card>
  <app-stat-tile ... />
</hk-card>
```

## Inputs

| Input    | Type                  | Default     | Notes                                                                        |
| -------- | --------------------- | ----------- | ---------------------------------------------------------------------------- |
| `header` | `string \| undefined` | `undefined` | Rendered in `.hk-card__header` ONLY when provided (already-translated text). |

No outputs.

## Do / Don't

Do pass an already-translated string to `header` — the card never looks up
translations itself. Don't rely on `hk-card` for interactive semantics (it has no
`role`/`tabindex`); wrap or compose it with `hk-button`/`hk-chip` when the whole card
needs to be actionable.
