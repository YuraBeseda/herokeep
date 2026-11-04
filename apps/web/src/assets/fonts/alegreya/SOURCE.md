# Alegreya — font source

- **Family:** Alegreya
- **Styles vendored:** upright 400 and 600, italic 400 — exactly the styles the design
  system's type scale uses for `--font-body` (body 400, button 600, hint italic 400)
- **Google Fonts version:** v41
- **Retrieved:** 2026-11-03
- **Specimen page:** https://fonts.google.com/specimen/Alegreya
- **css2 request (woff2-capable UA):**
  `https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,600;1,400&display=swap`
  fetched with a Chrome desktop `User-Agent` header so Google returns woff2
  (rather than woff/ttf) `src` URLs.
- **gstatic woff2 URLs referenced by that css2 response** (downloaded verbatim,
  byte-for-byte, no re-encoding). Google serves the upright 400 and 600 from the same
  variable-weight file, so one file per subset covers both:
  - upright latin: `https://fonts.gstatic.com/s/alegreya/v41/4UaBrEBBsBhlBjvfkSLhx6g.woff2`
  - upright cyrillic: `https://fonts.gstatic.com/s/alegreya/v41/4UaBrEBBsBhlBjvfkSLlx6jx4w.woff2`
  - italic latin: `https://fonts.gstatic.com/s/alegreya/v41/4UaSrEBBsBhlBjvfkSLk3abBFkvpkARTPlbgv5qhmSU.woff2`
  - italic cyrillic: `https://fonts.gstatic.com/s/alegreya/v41/4UaSrEBBsBhlBjvfkSLk3abBFkvpkARTPlbgv5qlmSW1rw.woff2`
- **License:** SIL Open Font License, Version 1.1 — see `OFL.txt` in this directory
  (fetched from the upstream Google Fonts repository,
  https://github.com/google/fonts/blob/main/ofl/alegreya/OFL.txt;
  copyright 2011 The Alegreya Project Authors,
  https://github.com/huertatipografica/Alegreya).

## Subsets vendored

Google's css2 response splits Alegreya into seven subsets (latin, latin-ext, cyrillic,
cyrillic-ext, greek, greek-ext, vietnamese). Only the two the shipped locales (en/ru/uk)
need are vendored:

| File                                 | Subset   | `unicode-range`                                                                                                                                                              |
| ------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Alegreya-variable-latin.woff2`      | latin    | `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD` |
| `Alegreya-variable-cyrillic.woff2`   | cyrillic | `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`                                                                                                                      |
| `Alegreya-italic-400-latin.woff2`    | latin    | same as upright latin                                                                                                                                                        |
| `Alegreya-italic-400-cyrillic.woff2` | cyrillic | same as upright cyrillic                                                                                                                                                     |

The cyrillic range covers the base Cyrillic block and the Ukrainian letters
є (U+0454), і (U+0456), ї (U+0457), Ґ/ґ (U+0490/U+0491), so no `cyrillic-ext` file is
needed. The other subsets were not vendored (unused by any shipped locale).

`typography.scss` declares one `@font-face` per file above, each scoped with its
matching `unicode-range`.
