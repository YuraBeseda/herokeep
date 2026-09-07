# Inter — font source

- **Family:** Inter
- **Version:** v4.1 (rsms/inter GitHub release)
- **Retrieved:** 2026-09-07
- **Upstream release:** https://github.com/rsms/inter/releases/tag/v4.1
- **Release asset:** https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
- **License:** SIL Open Font License, Version 1.1 — see `OFL.txt` in this directory
  (copied verbatim from the release zip's `LICENSE.txt`,
  copyright (c) 2016 The Inter Project Authors, https://github.com/rsms/inter).

## Files vendored

Taken from the release zip's `web/` directory (the "hinted for web" static-weight
woff2 builds, as opposed to `extras/woff-hinted/` or the variable font):

| File                   | Weight         | Source path in zip         |
| ---------------------- | -------------- | -------------------------- |
| `Inter-Regular.woff2`  | 400 (regular)  | `web/Inter-Regular.woff2`  |
| `Inter-SemiBold.woff2` | 600 (semibold) | `web/Inter-SemiBold.woff2` |
| `Inter-Bold.woff2`     | 700 (bold)     | `web/Inter-Bold.woff2`     |

Three static weights were vendored (rather than `InterVariable.woff2`) per the task
brief's preference: the app only ever requests 400/600/700, so three small static
files avoid shipping the full variable-axis font just to pin it to fixed weights.

## Subsets

The "web" build is not subset-split (unlike Google Fonts' per-script woff2 files) —
each file carries Inter's full built-in character set in one woff2, which includes
Latin, Cyrillic (verified via cmap inspection: covers the Cyrillic block, including
Ukrainian-specific letters є/і/ї/Ґ/ґ), Greek, and Vietnamese. This covers all of the
app's shipped locales (en/ru/uk) from a single set of files — no separate Cyrillic
variant is needed for Inter.
