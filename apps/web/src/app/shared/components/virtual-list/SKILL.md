# hk-virtual-list

Element selector `hk-virtual-list`. A thin wrapper around `@angular/cdk/scrolling`'s
`cdk-virtual-scroll-viewport` + `cdkVirtualFor`, so a long list only renders the rows
near the viewport instead of the whole array.

## Usage

```html
<hk-virtual-list [items]="spells()" [itemSize]="56" style="height: 480px;">
  <ng-template let-spell>
    <hk-card>{{ spell.name }}</hk-card>
  </ng-template>
</hk-virtual-list>
```

## Inputs

| Input      | Type           | Default | Notes                                                                                            |
| ---------- | -------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `items`    | `readonly T[]` | —       | Required.                                                                                        |
| `itemSize` | `number`       | `56`    | Row height in pixels; every row is assumed the same height (fixed-size virtual scroll strategy). |

## Content

Exactly one content-projected `<ng-template let-item>` — its implicit context variable
(`item` above) is the row's data. No marker directive is needed; `hk-virtual-list` looks
for the first (and only) projected `<ng-template>`.

## Sizing

The viewport is 100% of the host's width/height — **the consumer must size the host**
(a fixed height, a flex/grid cell, etc.). An unsized host collapses to 0 height and the
viewport won't compute a meaningful visible range.

## Do / Don't

Do keep `itemSize` accurate — the fixed-size strategy uses it to compute both the total
scrollable height and which rows are near the viewport; a wrong value causes rows to
jump/overlap. Don't put more than one `<ng-template>` inside `hk-virtual-list`; only the
first is used as the row template.
