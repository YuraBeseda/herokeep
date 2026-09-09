# PWA icons — source

- **Retrieved/generated:** 2026-09-09
- **Base artwork:** the `gi-crossed-swords` symbol already vendored at
  `apps/web/src/assets/icons/sprite.svg` (game-icons.net, Carl Olsen, CC BY 3.0 — see
  `apps/web/src/assets/icons/authors.json` and the About/attribution screen for the full credit).
- **Background:** solid fill matching the dark-theme `--surface-0` token
  (`packages/ui-tokens`: `hsl(240 6% 7%)`, computed to `#111113`), so the icon reads correctly
  both as a maskable adaptive icon and as a plain launcher icon.
- **Layout:** the sprite's path (in its native `0 0 512 512` viewBox) is scaled to 60% and
  centered, leaving a ~20%-per-side margin — inside the safe zone recommended for maskable icons
  (content must survive being cropped to a centered circle covering ~80% of the icon).

## Generation method

Not a checked-in build step (per the task brief: a `tools/build-pwa-icons.ts` script was
deliberately NOT added for two static files — YAGNI). Instead, one-off hand export:

1. Wrote a temporary `icon.svg` (512×512, `--surface-0` background rect + the scaled/centered
   sprite path, fill `#fff`) in a scratch directory.
2. Rasterized it to `icon-192-maskable.png` and `icon-512-maskable.png` with the `sharp` npm
   package (installed ad hoc in the scratch directory only, not a project dependency), rendering
   directly at each target pixel size (`density` tuned per size for crisp vector rasterization,
   not a downscaled bitmap).
3. Copied the two PNGs into this directory and discarded the scratch project.

## Files

| File                    | Size    | Purpose (manifest) |
| ----------------------- | ------- | ------------------ |
| `icon-192-maskable.png` | 192×192 | `any maskable`     |
| `icon-512-maskable.png` | 512×512 | `any maskable`     |
