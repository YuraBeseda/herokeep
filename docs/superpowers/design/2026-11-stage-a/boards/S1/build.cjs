// build.cjs — builds the S1 (hero creation wizard) boards from boards.cjs.
//   node build.cjs            -> writes every <Id>-Desktop.dc.html / <Id>-Phone.dc.html next to this file
// Expands the authoring macros into literal static markup (no template syntax survives):
//   <i-icon name="heart" size="24" label="..." class="" style="" hint=""></i-icon>  -> inline game-icons SVG
//   <x-seal state="full|spent" icon="check-mark" text="+3" size="28" label="" seed="1" class="" style="" hint=""></x-seal> -> wax seal
//   <x-tex kind="wood|paper|leather" style=""></x-tex> -> texture overlay (filters live in <x-defs>)
//   <x-defs></x-defs> -> the three feTurbulence filters + the shield gradient (once per board)
// and inlines the design system (ds/check/tokens.css + ds/project/components/bundle.css) into the helmet <style>.
const fs = require('fs');
const path = require('path');
const here = __dirname;
const scratch = path.resolve(here, '..', '..', '..');
const icons = Object.assign({}, require(path.join(scratch, 'kit', 'icons.json')));
const GI = path.join(scratch, 'gi', 'icons');

function giIcon(name) {
  for (const author of fs.readdirSync(GI)) {
    const p = path.join(GI, author, name + '.svg');
    if (!fs.existsSync(p)) continue;
    const svg = fs.readFileSync(p, 'utf8');
    let inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    inner = inner.replace(/<path[^>]*d="M0 0h512v512H0z"[^>]*\/>/g, '');
    inner = inner.replace(/\s*fill="#[0-9a-fA-F]{3,6}"/g, '').replace(/\s*fill="(black|white)"/g, '');
    inner = inner.replace(/<path /g, '<path fill="currentColor" ');
    return { author, body: inner.trim() };
  }
  return null;
}
const used = new Map();
function icon(name) {
  let ic = icons[name];
  if (!ic) { ic = giIcon(name); if (ic) icons[name] = ic; }
  if (!ic) throw new Error('unknown icon ' + name);
  used.set(name, ic.author);
  return ic;
}
let uid = 0;
const f = (n) => Math.round(n * 100) / 100;

function iconSvg(o) {
  const ic = icon(o.name);
  let body = ic.body;
  let vb = '0 0 512 512';
  if (body.startsWith('<circle')) { body = body.replace(/<circle[^>]*\/>/g, ''); vb = '20 20 216 216'; }
  const lab = o.label || o.hint;
  const a11y = lab ? `role="img" aria-label="${lab}"` : 'aria-hidden="true"';
  const c = o.class ? ` class="${o.class}"` : '';
  const s = o.style ? ` style="${o.style}"` : '';
  const t = o.hint ? `<title>${o.hint}</title>` : '';
  return `<svg viewBox="${vb}" width="${o.size || 24}" height="${o.size || 24}" ${a11y}${c}${s}>${t}${body}</svg>`;
}
function iconGroup(name, cls, x, y, scale) {
  const ic = icon(name);
  let body = ic.body;
  let shift = 0;
  if (body.startsWith('<circle')) { body = body.replace(/<circle[^>]*\/>/g, ''); shift = 128; scale = scale * 2; }
  const c = 256 - shift;
  return `<g class="${cls}" transform="translate(${f(x)},${f(y)}) scale(${f(scale)}) translate(${-c},${-c})">${body}</g>`;
}
function blob(r, cx, cy, wob, seed) {
  const n = 20, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + wob * (Math.sin(a * 3 + seed) * 0.55 + Math.sin(a * 5 + seed * 1.7) * 0.3 + Math.cos(a * 7 + seed * 0.4) * 0.15));
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    if (i === 0) d += `M${f(p1[0])} ${f(p1[1])}`;
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}
function sealSvg(o) {
  const state = o.state || 'full';
  const size = +(o.size || 28);
  const id = 'hkSeal' + (++uid);
  const sd = +(o.seed || (uid % 7));
  const lab = o.label || o.hint;
  const a11y = lab ? `role="img" aria-label="${lab}"` : 'aria-hidden="true"';
  const c = ` class="hk-seal${o.class ? ' ' + o.class : ''}"`;
  const s = o.style ? ` style="${o.style}"` : '';
  const t = o.hint ? `<title>${o.hint}</title>` : '';
  const outer = blob(27, 32, 32, 0.07, sd);
  const shadow = blob(27, 33.5, 34, 0.07, sd);
  const big = size >= 44;
  let inner = '';
  if (state === 'full') {
    inner += `<defs><radialGradient id="${id}" cx="38%" cy="30%" r="75%"><stop class="hk-wax-stop1" offset="0"/><stop class="hk-wax-stop2" offset=".55"/><stop class="hk-wax-stop3" offset="1"/></radialGradient></defs>`;
    inner += `<path class="hk-seal-shadow" d="${shadow}"/>`;
    inner += `<path d="${outer}" fill="url(#${id})"/>`;
    inner += `<path class="hk-seal-sheen" d="${outer}"/>`;
    inner += `<circle class="hk-seal-rim" cx="32" cy="32" r="${big ? 22 : 20}"/>`;
    inner += `<circle class="hk-seal-rim-hi" cx="31.3" cy="31.3" r="${big ? 22 : 20}"/>`;
    if (o.text) {
      const fs2 = o.fs ? +o.fs : (big ? 23 : 18);
      inner += `<text class="hk-seal-txt hk-seal-txt--ink" x="32.8" y="33.3" text-anchor="middle" dominant-baseline="central" font-size="${fs2}">${o.text}</text>`;
      inner += `<text class="hk-seal-txt hk-seal-txt--emboss" x="32" y="32.4" text-anchor="middle" dominant-baseline="central" font-size="${fs2}">${o.text}</text>`;
    } else if (o.icon) {
      const sc = big ? 0.075 : 0.058;
      inner += iconGroup(o.icon, 'hk-seal-glyph--ink', 32.7, 32.7, sc);
      inner += iconGroup(o.icon, 'hk-seal-glyph--hi', 31.3, 31.3, sc);
      inner += iconGroup(o.icon, 'hk-seal-glyph--body', 32, 32, sc);
    }
    inner += `<ellipse class="hk-seal-spec" cx="23" cy="21" rx="9" ry="5" transform="rotate(-32 23 21)"/>`;
  } else {
    inner += `<defs><radialGradient id="${id}" cx="40%" cy="32%" r="75%"><stop class="hk-wax-spent-stop1" offset="0"/><stop class="hk-wax-spent-stop2" offset=".6"/><stop class="hk-wax-spent-stop3" offset="1"/></radialGradient></defs>`;
    inner += `<path class="hk-seal-spent-shadow" d="${shadow}"/>`;
    inner += `<path d="${outer}" fill="url(#${id})"/>`;
    inner += `<circle class="hk-seal-spent-rim" cx="32" cy="32" r="${big ? 22 : 20}"/>`;
    inner += `<circle class="hk-seal-spent-dash" cx="32" cy="32" r="${big ? 16 : 14}"/>`;
    if (o.text) {
      inner += `<text class="hk-seal-txt hk-seal-txt--spent" x="32" y="32.4" text-anchor="middle" dominant-baseline="central" font-size="${o.fs ? +o.fs : (big ? 23 : 18)}">${o.text}</text>`;
    } else if (o.icon) {
      inner += iconGroup(o.icon, 'hk-seal-glyph--spent', 32, 32, big ? 0.075 : 0.058);
    }
  }
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" ${a11y}${c}${s}>${t}${inner}</svg>`;
}
function texSvg(kind, style) {
  const s = style ? ` style="${style}"` : '';
  return `<svg class="hk-tex hk-tex--${kind}" aria-hidden="true"${s}><rect width="100%" height="100%"/></svg>`;
}
const DEFS = `<svg aria-hidden="true" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden">
<filter id="hkWood" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.0022 0.055" numOctaves="5" seed="9" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.7 -0.55" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>
<filter id="hkPaper" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>
<filter id="hkLeather" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="5" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>
<linearGradient id="hkShieldBrass" x1="0" y1="0" x2="0" y2="1"><stop class="hk-shield-stop1" offset="0"/><stop class="hk-shield-stop2" offset=".5"/><stop class="hk-shield-stop3" offset="1"/></linearGradient>
</svg>`;

function attrs(s) {
  const o = {};
  const re = /([a-zA-Z-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = m[2];
  return o;
}
function expand(src) {
  let out = src.replace(/<i-icon([^>]*)><\/i-icon>/g, (_, a) => iconSvg(attrs(a)));
  out = out.replace(/<x-seal([^>]*)><\/x-seal>/g, (_, a) => sealSvg(attrs(a)));
  out = out.replace(/<x-tex([^>]*)><\/x-tex>/g, (_, a) => { const o = attrs(a); return texSvg(o.kind, o.style); });
  out = out.replace(/<x-defs><\/x-defs>/g, DEFS);
  return out;
}
function check(fullHtml, name) {
  const html = fullHtml.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/, '');
  const bad = ['{{', '}}', '<sc-for', '<sc-if', '<dc-import', '<iframe', '<object', '<embed', 'data:', '<i-icon', '<x-seal', '<x-tex', '<x-defs'];
  for (const b of bad) if (html.includes(b)) throw new Error(name + ' contains forbidden token ' + b);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  if (emoji.test(html)) throw new Error(name + ' contains emoji');
}

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Forum&family=Alegreya:ital,wght@0,400;0,600;0,700;1,400&display=swap">';
const tokensCss = fs.readFileSync(path.join(scratch, 'ds', 'check', 'tokens.css'), 'utf8');
const bundleCss = fs.readFileSync(path.join(scratch, 'ds', 'project', 'components', 'bundle.css'), 'utf8');
let heights = {};
try { heights = JSON.parse(fs.readFileSync(path.join(here, 'heights.json'), 'utf8')); } catch (e) { /* first build */ }

const boards = require('./boards.cjs');
const all = boards.all();
const only = process.argv.slice(2);
let n = 0;
for (const b of all) {
  if (only.length && !only.some((o) => b.file.startsWith(o))) continue;
  const h = b.phone ? 844 : b.tablet ? 1024 : (heights[b.file] || 1100);
  const w = b.phone ? 390 : b.tablet ? 768 : 1440;
  const root = expand(b.root);
  const html = `<!doctype html>
<html lang="${b.lang}">
<head>
<meta charset="utf-8">
<title>${b.title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
${FONTS}
<style>
body{margin:0}
a{color:#7a5a1e}a:hover{color:#4d3812}
${tokensCss}
${bundleCss}
${boards.pageCss(b.phone || b.tablet)}
</style>
</helmet>
${root}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;
  check(html, b.file);
  fs.writeFileSync(path.join(here, b.file), html);
  n++;
  console.log(b.file.padEnd(28), (html.length / 1024).toFixed(0) + ' KB', 'preview', w + 'x' + h);
}
fs.writeFileSync(path.join(here, 'icons-used.json'), JSON.stringify(Object.fromEntries(used), null, 1));
console.log(`built ${n} boards; ${used.size} glyphs`);
