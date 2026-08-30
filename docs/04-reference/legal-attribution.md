# Legal and attribution

*Checked 2026-08-29. Not legal advice; a summary of the licenses' own terms.*

## Route chosen

Rules content is used under the **Creative Commons Attribution 4.0** license of the SRD
5.2.1 — not under the Wizards of the Coast Fan Content Policy (which is revocable and
forbids trademarks and use "in other games"). The app name and icon must not contain
"D&D", "Dungeons & Dragons" or the ampersand logo; "5E compatible" is permitted wording.

## Text for the About → Attribution screen (verbatim, keep updated)

> This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by
> Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is
> licensed under the Creative Commons Attribution 4.0 International License, available
> at https://creativecommons.org/licenses/by/4.0/legalcode.

Add when the 2014 ruleset ships (Phase 6):

> This work includes material from the System Reference Document 5.1 ("SRD 5.1") by
> Wizards of the Coast LLC, available at
> https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed
> under the Creative Commons Attribution 4.0 International License, available at
> https://creativecommons.org/licenses/by/4.0/legalcode.

Modification notice (CC-BY requires indicating changes): "SRD text has been reformatted
into structured data and may be abridged or translated in this application."

Do not add any other attribution to Wizards of the Coast (the SRD's legal text asks for
none).

## Third-party assets and their notices

| Asset | License | Notice to show |
|-------|---------|----------------|
| SRD 5.2.1 structured data via open5e (`srd-2024`) | data CC-BY-4.0 (the SRD's license); open5e code modified MIT, not used | "Structured SRD data derived from the Open5e project (https://open5e.com)." |
| game-icons.net icons | CC-BY-3.0 (a few CC0) | "Icons made by Delapouite, Lorc, Skoll, Caro Asercion and others. Available on https://game-icons.net" — list authors of the bundled subset generated at build time |
| Lucide icons | ISC | "Lucide icons © Lucide Contributors, ISC License." |
| Fonts (Inter, Golos Text, Philosopher, Forum, Cormorant) | SIL OFL 1.1 | OFL notices bundled with the font files; list in About |
| Angular, Hono, Dexie, Zod, fflate, Transloco and other npm packages | MIT / Apache-2.0 / ISC | generated `THIRD-PARTY-NOTICES` from the lockfile in CI |

## Translations

- Any adopted content translation must be CC-BY-4.0 or more permissive; **CC-BY-SA** or
  **CC-BY-NC** sources (e.g. the palikhov SRD 5.1 Russian translation, longstoryshort's
  SRD) are not used, to avoid share-alike/non-commercial obligations on our own text.
- Translation *terminology* (the Russian/Ukrainian words for abilities, conditions,
  schools) follows community conventions; terms are not copyrightable text.
- Translator credits appear in the pack's `authors` and on the Attribution screen.

## User content

Users' uploads (images, homebrew) stay on their devices and their peers'; the project
stores only text JSON they submit (characters, campaigns, packs enabled in campaigns).
The About screen states this and the privacy summary in
`02-architecture/08-security-permissions-quotas.md`.

## Source code license (decided 2026-08-30)

**MIT** for code (packages and apps), **CC-BY-4.0** for the project's own content packs
(so they compose with the SRD), with `LICENSE` and `LICENSE-CONTENT` files at the repo
root. The repository is public.
