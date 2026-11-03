# Board rules — how to author one concept (two artboards) for the Herokeep design canvas

You are building TWO self-contained HTML artboards for a Claude Design canvas. They will be published as-is.
Output folder (create it): `<KIT>/out/<ConceptId>/` where `<KIT>` is the kit folder this file lives in.
Files to deliver:

- `<ConceptId>-Desktop.dc.html` — the desktop character sheet, Play mode, English, a fluid PAGE designed at 1440 px wide.
- `<ConceptId>-Phone.dc.html` — the phone Combat tab, Ukrainian, a FIXED 390 × 844 device mockup.
- `desktop.png`, `phone.png` — your own Playwright screenshots (see Self-check).
- `notes.md` — measured desktop height at 1440 px, the fonts used, 5 lines of rationale, and every compromise you made.

## The artboard skeleton (copy exactly; every rule here fails SILENTLY if broken)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tavern Table — character sheet (desktop)</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Forum&family=Alegreya:ital,wght@0,400;0,700;1,400&display=swap">
<style>
body{margin:0}
a{color:#7a5a1e}a:hover{color:#4d3812}
/* shared classes, textures, keyframes, component classes go here */
</style>
</helmet>
<!-- the artboard root: ONE element -->
<div style="...">
  ... all content ...
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1440,"height":1100}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
```

- Keep `<script src="./support.js"></script>` EXACTLY as the head's last line. It 404s locally; that is fine.
- `lang`: `en` on the desktop board, `uk` on the phone board. `<title>`: a few words naming the screen.
- The `<helmet>` holds ONLY: one Google Fonts `css2` `<link>` (the only network request allowed), and a `<style>` with `body{margin:0}`, the `a`/`a:hover` colours, and your shared classes.
- Close every element, quote every attribute. No `<iframe>`, `<object>`, `<embed>`. No `data:` URIs anywhere. No external images. No emoji.
- NO template syntax: never write `{{` or `}}`, `<sc-for>`, `<sc-if>` or `<dc-import>`. Everything is literal static markup. The `data-props` block stays exactly as shown except the `$preview` numbers.
- `$preview` = the frame size: desktop `{"width":1440,"height":<measured height>}`, phone `{"width":390,"height":844}`.
- Desktop root: FLUID (no px width): `width:100%; max-width:none; min-height:100vh; box-sizing:border-box`. Design it at 1440 px; it must still not break at 1200 px (grids may wrap). Heights in px/rem, never `%`. One root element only.
- Phone root: FIXED `width:390px; height:844px; overflow:hidden; position:relative` with the scrolling body inside (`overflow:auto`). No fake iOS status bar, no fake keyboard, no phone bezel.
- Lay out every sibling group with `display:flex` or `display:grid` plus `gap`, never inline whitespace or per-element margins. Grids: `grid-template-columns: repeat(N, minmax(0,1fr))`.
- Inline `style="…"` on elements is what the editor's properties panel edits — put layout and the element's own look inline where practical. Shared component classes (buttons, chips, slots, pips, textures, keyframes) may live in the helmet `<style>`; keep selectors flat (single class, no `.a .b` chains that fight each other, no `!important`).

## Icons

- Use ONLY the game-icons set in `<KIT>/icons.json` (`{ name: { author, body } }`, each body is 512 × 512 inner SVG markup already set to `fill="currentColor"`). Inline them: `<svg viewBox="0 0 512 512" width="24" height="24" aria-hidden="true">…body…</svg>`. Colour via the parent's `color`.
- Decorative icons: `aria-hidden="true"`. Meaningful standalone icons: `role="img" aria-label="…"`.
- Do NOT inline the whole JSON. Pick the icons you use (40–80 per board is normal) and paste their bodies. Pick names by reading the key list (`node -e "console.log(Object.keys(require('<KIT>/icons.json')).join(' '))"`).
- Never a Unicode symbol or emoji as an icon; simple geometric marks (pips, dots, rings) may be CSS shapes.
- Custom ornaments (frames, corners, bag silhouettes, ribbons, wax seals, poker chips, pixel borders…) are YOUR OWN inline SVG or CSS. Draw them properly; a crude ornament is worse than none.

## Textures (no image files)

Procedural only, inside the file:
- Paper / parchment / leather / wood / felt grain: an inline `<svg aria-hidden="true">` with `<filter>` using `feTurbulence` + `feColorMatrix`/`feComponentTransfer`, applied to a `<rect>` layered under content with `position:absolute; inset:0; pointer-events:none`, or CSS `repeating-linear-gradient`/`radial-gradient` layers. Keep textures LOW contrast (≤ 8 % luminance variation) wherever text sits.
- Body text always sits on a solid or near-solid panel; textures never sit directly under paragraphs.

## Fonts

Only Google Fonts with verified Cyrillic (checked 2026-11-02): Forum, Oranienbaum, Alice, Alegreya, Alegreya SC, Alegreya Sans, Cormorant Garamond, Cormorant SC, EB Garamond, Spectral, Lora, Literata, Piazzolla, Old Standard TT, Vollkorn, Merriweather, Prata, Yeseva One, Russo One, Rubik Mono One, Philosopher, Playfair Display, PT Serif, PT Sans, Marck Script, Caveat, Neucha, Bad Script, Manrope, IBM Plex Sans, Jost, Rubik, Fira Sans, Fira Sans Condensed, Roboto Condensed, Sofia Sans, Golos Text, Onest, Exo 2, Tektur, Jura, Play, Cuprum, Press Start 2P, Pixelify Sans, Tiny5, Handjet, DotGothic16, Unbounded, Nunito, Montserrat, Oswald, Ysabeau, Bitter, Podkova, Lobster, Amatic SC, Comfortaa, JetBrains Mono.
NOT usable (no Cyrillic): Cinzel, Uncial Antiqua, MedievalSharp, Almendra, Metamorphous, Grenze Gotisch, Pirata One, New Rocker, Marcellus, Cardo, Fraunces, Crimson Pro, Orbitron, Audiowide, VT323, Silkscreen.
Use the pair your concept brief names. Body text ≥ 16 px on the phone, ≥ 14 px on desktop; numbers that matter (HP, AC) are the biggest type on the screen.

## Accessibility (as drawn)

- Real elements: `<button>`, `<a href="#">`, `<input>` + `<label>`. Never a clickable `<div>`.
- Every icon-only control has `aria-label` (in the board's language) AND a visible hint affordance (e.g. `title="…"` and a tooltip pattern you show at least once on the board).
- Touch targets ≥ 44 × 44 px on the phone; ≥ 36 px on desktop.
- Contrast ≥ 4.5:1 for text (3:1 for ≥ 24 px) against what is actually behind it, textures included. Check your greys.
- Colours that encode state also differ in lightness or carry an icon/shape; never hue alone.
- A visible focus style on at least one element to show the pattern.

## Content

- Use `CONTENT.md` verbatim: same character, same numbers, same strings. English on desktop, Ukrainian on phone. No lorem ipsum, no invented stats, no extra screens.
- Every list in CONTENT.md "must show" must be present. Prefer tabs/panels over one giant scroll when a region gets tall, but the desktop must still show HP, AC, speed, saves, attacks, resources, spells (≥ 6), conditions and the bag at once at 1440 × 960 without opening anything.
- Copy is UI copy: plain verbs, sentence case, no ALL-CAPS labels, no middle-dot meta strings as a styling tic, no "→" in button text.

## Self-check (required, then iterate at least twice)

Render both boards in Chromium with Playwright and LOOK at them:

```js
// <KIT>/out/<ConceptId>/shoot.cjs  — run with:  node shoot.cjs   (CommonJS on purpose)
const { chromium } = require('D:/Projects/Programming/Personal/DndHeroCreator/node_modules/.pnpm/@playwright+test@1.63.0/node_modules/@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const d = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await d.goto('file:///' + __dirname.replace(/\\/g, '/') + '/<ConceptId>-Desktop.dc.html');
  await d.evaluate(() => document.fonts.ready); await d.waitForTimeout(500);
  console.log('desktop scrollHeight', await d.evaluate(() => document.documentElement.scrollHeight));
  await d.screenshot({ path: __dirname + '/desktop.png', fullPage: true });
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('file:///' + __dirname.replace(/\\/g, '/') + '/<ConceptId>-Phone.dc.html');
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
  await p.screenshot({ path: __dirname + '/phone.png' });
  await browser.close();
})();
```
The Chromium browsers are already installed. Never install anything new.
- Desktop: viewport 1440 × 960, `page.goto('file:///…/<ConceptId>-Desktop.dc.html')`, wait for fonts (`document.fonts.ready`), full-page screenshot, and record `document.documentElement.scrollHeight` → notes.md.
- Phone: viewport 390 × 844, screenshot the viewport only.
- Read the PNGs. Fix overlaps, clipped text, wrapped buttons, illegible contrast, awkward empty areas. Repeat until it looks finished. The owner will judge these on visual quality; "roughly right" is not enough.

## Deliver

When done, reply with: the two file paths, the measured desktop height, the fonts, five lines on what makes the concept distinct, and any compromise. Do not publish anything yourself; do not touch the repo.
