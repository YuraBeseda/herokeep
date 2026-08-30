# SRD 5.2.1 content, machine-readable sources, translations, icons, fonts

*All facts checked 2026-08-29 against the cited sources (dndbeyond.com/srd and the SRD 5.2.1 PDF, the listed GitHub repositories and translation sites, game-icons.net, Google Fonts). Re-verify before relying on them in a later year.*

## 1. SRD 5.2 / 5.2.1

### License and versions

- SRD 5.2.1 is licensed under CC-BY-4.0 only (SRD 5.1 was OGL 1.0a + CC-BY). https://www.dndbeyond.com/srd
- SRD 5.2 (Apr 2025) → 5.2.1 (May 1 2025): adds 15 previously omitted magic items plus corrections.
- Official format: PDF only. English, with DE/ES/FR/IT PDFs released Dec 8 2025; no RU or UK. https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf
- A "Converting to SRD 5.2.1" guide PDF exists (May 27 2025).

### Required attribution (verbatim)

```
This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.
```

- No other attribution to Wizards of the Coast. A product may say "compatible with fifth edition" or "5E compatible".

### Contents

- 12 classes, one subclass each: Barbarian/Berserker, Bard/Lore, Cleric/Life, Druid/Land, Fighter/Champion, Monk/Open Hand, Paladin/Devotion, Ranger/Hunter, Rogue/Thief, Sorcerer/Draconic, Warlock/Fiend, Wizard/Evoker.
- 339 spells (+20 vs 5.1, including Chromatic Orb, Hex, Divine Smite, Summon Dragon).
- 9 species: Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc, Tiefling.
- 4 backgrounds (Acolyte, Criminal, Sage, Soldier), each with a fixed Ability Scores list and an Origin feat.
- 17 feats (Origin / General / Fighting Style / Epic Boon).
- 75 weapons, 13 armors, ~440 items, ~250 magic items (counts unverified); Weapon Mastery Properties; crafting; Rules Glossary.
- 331 creatures.

### 5.1 → 5.2.1 engine deltas

- Race/subrace → species (no subspecies).
- Ability Score Increases move from race to background.
- Backgrounds grant an Origin feat.
- Weapon mastery added.
- Some items renamed.
- "Between Adventures" section removed.

## 2. Machine-readable conversions

| Source | Format | License | 2024 coverage | Updated |
|---|---|---|---|---|
| github.com/open5e/open5e-api (api.open5e.com/v2, key `srd-2024`) | JSON fixtures `data/v2/wizards-of-the-coast/srd-2024/*.json` | code: modified MIT; data: cc-by-40 | COMPLETE (339 spells, 24 class/subclass, 9 species, 4 backgrounds, 17 feats, 440 items, 331 creatures, 56 rules) | 2026-08-23 |
| github.com/5e-bits/5e-database | JSON `src/2024/en/*.json` | MIT | PARTIAL: no Spells.json (issue #1178, Jul 2026) | 2026-08-24 |
| github.com/downfallx/dnd-5e-srd-markdown | Markdown by section | CC-BY-4.0 | complete 5.2.1 | 2026-01-10 |
| github.com/your5e/5e-srd-markdown | PDF + Markdown + Obsidian vault (5.1 and 5.2.1) | CC-BY (README) | complete | 2025-10-29 |
| github.com/foundryvtt/dnd5e | Foundry JSON `packs/_source` (`*24`) | MIT code; content CC-BY-4.0 | complete, Foundry schema | 5.3.3, 2026-05-07 |

Primary 2024 source: open5e v2. For 2014 content: 5e-database.

## 3. RU / UK translations

### Russian

- Reusable: github.com/palikhov/srd-dnd-5e-ru — SRD 5.1 only, Markdown, CC-BY-SA-4.0 (share-alike propagates), last push 2023-11.
- Reusable: 5e-database (MIT) `src/2014/ru/` for 9 small collections (skills, conditions, ...).
- Restricted: longstoryshort.app/srd (CC BY-NC-SA 4.0); srd.dnd-5e.org (OGL only).
- Not reusable: dnd.su, dungeonsanddragons.ru (fan translations of copyrighted books).
- No RU SRD 5.2 translation found.

### Ukrainian

- 5esrd.kyiv.ua (Olha Tuomari): SRD 5.1 translated; 2024 classes/species started; states OGL 1.0a (no CC grant) → contact the maintainer.
- wiki.dnd.in.ua: no license info.

### Official localizations

- RU 2014 edition (Hobby World / GF9): license revoked Dec 2021.
- No official UK edition.
- Official 2024 SRD localizations: DE/ES/FR/IT only.

## 4. Icons

- game-icons.net: 4,180 SVG/PNG icons (as of Apr 23 2026), CC BY 3.0 (a few CC0). Required attribution: "Icons made by {author}. Available on https://game-icons.net". Repository: github.com/game-icons/icons. Main authors: Delapouite, Lorc, Skoll, Caro Asercion.
- npm: react-icons (MIT wrapper; bundles Game Icons under CC BY 3.0); game-icons-transparent (CC-BY-3.0 AND CC0-1.0, 2026-04).
- RPG Awesome: 495 icons, OFL 1.1, unmaintained since 2021.
- Kenney Game Icons: CC0; UI style, not fantasy.

## 5. Google Fonts with Cyrillic

Includes і ї є ґ — the `cyrillic` subset covers U+0400–045F and U+0490–0491.

### Display (with Cyrillic)

- Forum (Roman inscriptional caps — the Cyrillic "Cinzel" substitute)
- Philosopher
- Cormorant Garamond / Cormorant Unicase
- Yeseva One
- Ruslan Display (medieval ustav)
- Playfair Display
- Prata
- Marck Script
- Alegreya SC

### Body / UI (with Cyrillic)

- Inter, Manrope, Golos Text, Onest
- Literata, Spectral, Piazzolla, PT Serif, Lora, EB Garamond
- Also: Neucha, Unbounded, Vollkorn, Merriweather, Sofia Sans, Nunito, Montserrat, Exo 2, Jost

### No Cyrillic (avoid)

Cinzel, Cinzel Decorative, Uncial Antiqua, MedievalSharp, IM Fell English, Almendra, Metamorphous, Grenze, Grenze Gotisch, Pirata One, New Rocker, Macondo, Fondamento, Caesar Dressing.

## 6. Legal gotchas

- Use the CC-BY SRD route, not the Fan Content Policy (the FCP is revocable, and forbids trademarks and "other games").
- Trademarks: "D&D", "Dungeons & Dragons" and the ampersand logo — avoid in the app name and icon; say "5E compatible".
- CC-BY-4.0 duties: credit, license link, indicate modifications, no implied endorsement.
- Attribution screen must include: the SRD 5.2.1 statement; the SRD 5.1 statement if 2014 content is shipped; a note that content is reformatted/translated; game-icons.net per-author credit; translation credits (plus a CC-BY-SA notice if palikhov RU is used); OFL font notices.
