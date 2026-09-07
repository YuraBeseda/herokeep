# Philosopher — font source

- **Family:** Philosopher
- **Weight vendored:** 700 (bold) — the only weight this app uses, for
  `--font-display` headings
- **Google Fonts version:** v21
- **Retrieved:** 2026-09-07
- **Specimen page:** https://fonts.google.com/specimen/Philosopher
- **css2 request (woff2-capable UA):**
  `https://fonts.googleapis.com/css2?family=Philosopher:wght@700&display=swap`
  fetched with a Chrome desktop `User-Agent` header so Google returns woff2
  (rather than woff/ttf) `src` URLs.
- **gstatic woff2 URLs referenced by that css2 response** (downloaded verbatim,
  byte-for-byte, no re-encoding):
  - latin: `https://fonts.gstatic.com/s/philosopher/v21/vEFI2_5QCwIS4_Dhez5jcWjValgb8tc.woff2`
  - cyrillic: `https://fonts.gstatic.com/s/philosopher/v21/vEFI2_5QCwIS4_Dhez5jcWjValgf8tenXg.woff2`
- **License:** SIL Open Font License, Version 1.1 — see `OFL.txt` in this directory
  (fetched from the upstream Google Fonts repository,
  https://github.com/google/fonts/blob/main/ofl/philosopher/OFL.txt;
  copyright 2011 The Philosopher Project Authors,
  https://github.com/alexeiva/philosopher).

## Subsets vendored

Google's css2 response splits Philosopher-700 into five subsets
(latin, latin-ext, cyrillic, cyrillic-ext, vietnamese). Per the task brief, only
two are vendored here — the ones this app's shipped locales (en/ru/uk) need:

| File                             | Subset   | `unicode-range`                                                                                                                                                              |
| -------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Philosopher-700-latin.woff2`    | latin    | `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD` |
| `Philosopher-700-cyrillic.woff2` | cyrillic | `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`                                                                                                                      |

Cyrillic coverage verified by cmap inspection (`fontTools`): the cyrillic file's
character set includes the base Cyrillic block and the Ukrainian-specific letters
є (U+0454), і (U+0456), ї (U+0457), Ґ/ґ (U+0490/U+0491) — no `cyrillic-ext` file is
needed for the ru/uk locales this app ships. `latin-ext` and `vietnamese` were not
vendored (unused by any shipped locale).

`typography.scss` declares one `@font-face` per file above, each scoped with its
matching `unicode-range` so the browser only downloads the subset it actually
needs to render.
