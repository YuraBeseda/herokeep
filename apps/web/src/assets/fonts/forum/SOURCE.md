# Forum — font source

- **Family:** Forum
- **Weight vendored:** 400 (regular) — Forum ships a single weight; it is the design
  system's `--font-display` (headings, numerals)
- **Google Fonts version:** v19
- **Retrieved:** 2026-11-03
- **Specimen page:** https://fonts.google.com/specimen/Forum
- **css2 request (woff2-capable UA):**
  `https://fonts.googleapis.com/css2?family=Forum&display=swap`
  fetched with a Chrome desktop `User-Agent` header so Google returns woff2
  (rather than woff/ttf) `src` URLs.
- **gstatic woff2 URLs referenced by that css2 response** (downloaded verbatim,
  byte-for-byte, no re-encoding):
  - latin: `https://fonts.gstatic.com/s/forum/v19/6aey4Ky-Vb8Ew8IROpI.woff2`
  - cyrillic: `https://fonts.gstatic.com/s/forum/v19/6aey4Ky-Vb8Ew8IVOpIq3g.woff2`
- **License:** SIL Open Font License, Version 1.1 — see `OFL.txt` in this directory
  (fetched from the upstream Google Fonts repository,
  https://github.com/google/fonts/blob/main/ofl/forum/OFL.txt;
  copyright 2011 Denis Masharov).

## Subsets vendored

Google's css2 response splits Forum into four subsets (latin, latin-ext, cyrillic,
cyrillic-ext). Only the two the shipped locales (en/ru/uk) need are vendored:

| File                       | Subset   | `unicode-range`                                                                                                                                                              |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Forum-400-latin.woff2`    | latin    | `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD` |
| `Forum-400-cyrillic.woff2` | cyrillic | `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`                                                                                                                      |

The cyrillic range covers the base Cyrillic block and the Ukrainian letters
є (U+0454), і (U+0456), ї (U+0457), Ґ/ґ (U+0490/U+0491), so no `cyrillic-ext` file is
needed. `latin-ext` was not vendored (unused by any shipped locale).

`typography.scss` declares one `@font-face` per file above, each scoped with its
matching `unicode-range`.
