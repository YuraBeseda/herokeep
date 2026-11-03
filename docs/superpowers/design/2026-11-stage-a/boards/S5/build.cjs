// build.cjs (S5 — "Later ideas" boards) — expands authoring macros in *.src.html into literal static markup
// and inlines the design-system CSS. Derived from out/S4/build.cjs (same icon / seal / texture macros) plus:
//   <x-defs></x-defs>                       the hidden <svg> with the three feTurbulence filters (once per board)
//   <x-tex kind="wood|paper|leather">       design-system texture overlay (honours the theme's texture tints)
//   <x-shield ac="18" w="40" label="…">     brass AC shield with a self-contained gradient
//   <x-mono text="IV" w="50" h="56" fs="22"> portrait placeholder frame with a monogram
//   <x-coin metal="gold" n="38" unit="gp">  one coin stack
//   <x-d20 n="11" size="150" …>             a shaded icosahedron face view (the 3D-dice board)
//   __DS_CSS__ -> tokens.css + bundle.css, __S5_CSS__ -> shared page styles, __PREVIEW__ -> the $preview JSON
// Output never contains template syntax; the script asserts that.
const fs = require('fs');
const path = require('path');
const icons = require('../../icons.json');

const SCRATCH = path.join(__dirname, '..', '..', '..');
const GI = path.join(SCRATCH, 'gi', 'icons');
// glyphs the kit's icons.json lacks, normalised exactly like extract-icons.mjs did
const EXTRA = [
  ['third-eye', 'lorc'], ['thrown-spear', 'lorc'], ['hand-ok', 'delapouite'], ['shop', 'delapouite'], ['price-tag', 'delapouite'],
  ['shopping-cart', 'delapouite'], ['telescope', 'delapouite'], ['ringed-planet', 'lorc'], ['fedora', 'lorc'], ['goblin-head', 'delapouite'],
  ['next-button', 'delapouite'], ['papers', 'lorc'], ['claws', 'delapouite'], ['hoof', 'lorc'], ['pocket-watch', 'skoll'],
  ['satellite', 'lorc'], ['rocket', 'lorc'], ['moon-orbit', 'delapouite'], ['newspaper', 'delapouite'], ['trample', 'sbed'],
  ['dice-target', 'delapouite'], ['fast-forward-button', 'delapouite'], ['saddle', 'delapouite'], ['hazard-sign', 'lorc'],
  ['clockwise-rotation', 'delapouite'], ['checklist', 'delapouite'], ['dice-eight-faces-eight', 'delapouite'],
];
for (const [name, author] of EXTRA) {
  if (icons[name]) continue;
  const svg = fs.readFileSync(path.join(GI, author, name + '.svg'), 'utf8');
  let inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  inner = inner.replace(/<path[^>]*d="M0 0h512v512H0z"[^>]*\/>/g, '');
  inner = inner.replace(/\s*fill="#[0-9a-fA-F]{3,6}"/g, '').replace(/\s*fill="(black|white)"/g, '');
  inner = inner.replace(/<path /g, '<path fill="currentColor" ');
  icons[name] = { author, body: inner.trim() };
}

let uid = 0;
const f = (n) => Math.round(n * 100) / 100;
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function iconSvg(name, size, label, cls, style, hint) {
  const ic = icons[name];
  if (!ic) throw new Error('unknown icon ' + name);
  let body = ic.body;
  let vb = '0 0 512 512';
  if (body.startsWith('<circle')) { body = body.replace(/<circle[^>]*\/>/g, ''); vb = '20 20 216 216'; }
  const lab = label || hint;
  const a11y = lab ? `role="img" aria-label="${lab}"` : 'aria-hidden="true"';
  const c = cls ? ` class="${cls}"` : '';
  const s = style ? ` style="${style}"` : '';
  const t = hint ? `<title>${hint}</title>` : '';
  return `<svg viewBox="${vb}" width="${size}" height="${size}" ${a11y}${c}${s}>${t}${body}</svg>`;
}

function iconGroup(name, color, x, y, scale) {
  const ic = icons[name];
  let body = ic.body;
  let shift = 0;
  if (body.startsWith('<circle')) { body = body.replace(/<circle[^>]*\/>/g, ''); shift = 128; scale = scale * 2; }
  const c = 256 - shift;
  return `<g color="${color}" transform="translate(${f(x)},${f(y)}) scale(${f(scale)}) translate(${-c},${-c})">${body}</g>`;
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

function sealSvg(state, icon, text, size, label, seed, cls, style, fsOverride, hint) {
  const id = 'sg' + (++uid);
  const sd = seed || (uid % 7);
  const lab = label || hint;
  const a11y = lab ? `role="img" aria-label="${lab}"` : 'aria-hidden="true"';
  const c = cls ? ` class="${cls}"` : '';
  const s = style ? ` style="${style}"` : '';
  const t = hint ? `<title>${hint}</title>` : '';
  const outer = blob(27, 32, 32, 0.07, sd);
  const shadow = blob(27, 33.5, 34, 0.07, sd);
  const big = size >= 44;
  let inner = '';
  if (state === 'full') {
    inner += `<defs><radialGradient id="${id}" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#D4593D"/><stop offset=".55" stop-color="#B8432A"/><stop offset="1" stop-color="#7E2A1A"/></radialGradient></defs>`;
    inner += `<path d="${shadow}" fill="#2A0E08" opacity=".45"/>`;
    inner += `<path d="${outer}" fill="url(#${id})"/>`;
    inner += `<path d="${outer}" fill="none" stroke="#E07A5E" stroke-width=".9" opacity=".35"/>`;
    inner += `<circle cx="32" cy="32" r="${big ? 22 : 20}" fill="#9E3622" stroke="#6E2416" stroke-width=".9"/>`;
    inner += `<circle cx="31.3" cy="31.3" r="${big ? 22 : 20}" fill="none" stroke="#DB6F55" stroke-width=".8" opacity=".55"/>`;
    if (text) {
      const fs2 = fsOverride || (big ? 23 : 18);
      inner += `<text x="32.8" y="33.3" text-anchor="middle" dominant-baseline="central" font-family="Forum, serif" font-size="${fs2}" fill="#5E1C10">${text}</text>`;
      inner += `<text x="32" y="32.4" text-anchor="middle" dominant-baseline="central" font-family="Forum, serif" font-size="${fs2}" fill="#F6E4CC">${text}</text>`;
    } else {
      const sc = big ? 0.075 : 0.058;
      inner += iconGroup(icon, '#5E1C10', 32.7, 32.7, sc);
      inner += iconGroup(icon, '#E9896F', 31.3, 31.3, sc);
      inner += iconGroup(icon, '#A83A24', 32, 32, sc);
    }
    inner += `<ellipse cx="23" cy="21" rx="9" ry="5" fill="#FFF3E0" opacity=".13" transform="rotate(-32 23 21)"/>`;
  } else {
    inner += `<defs><radialGradient id="${id}" cx="40%" cy="32%" r="75%"><stop offset="0" stop-color="#EFE4C9"/><stop offset=".6" stop-color="#DFD0AC"/><stop offset="1" stop-color="#C7B48B"/></radialGradient></defs>`;
    inner += `<path d="${shadow}" fill="#5B4A36" opacity=".18"/>`;
    inner += `<path d="${outer}" fill="url(#${id})"/>`;
    inner += `<circle cx="32" cy="32" r="${big ? 22 : 20}" fill="#E6DABA" stroke="#B9A67E" stroke-width="1"/>`;
    inner += `<circle cx="32" cy="32" r="${big ? 16 : 14}" fill="none" stroke="#C9B992" stroke-width="1" stroke-dasharray="2 2"/>`;
    if (text) inner += `<text x="32" y="32.4" text-anchor="middle" dominant-baseline="central" font-family="Forum, serif" font-size="${fsOverride || (big ? 23 : 18)}" fill="#8C7A5A">${text}</text>`;
    else if (icon) inner += iconGroup(icon, '#C5B48D', 32, 32, big ? 0.075 : 0.058);
  }
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" ${a11y}${c}${s}>${t}${inner}</svg>`;
}

// Design-system textures: one shared filter set per board (x-defs), then a <svg class="hk-tex"> per panel.
function defsSvg() {
  return `<svg aria-hidden="true" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden">` +
    `<filter id="hkWood" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.0022 0.055" numOctaves="5" seed="9" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.7 -0.55" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>` +
    `<filter id="hkPaper" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>` +
    `<filter id="hkLeather" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="5" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/></filter>` +
    `</svg>`;
}
function texSvg(kind, style) {
  if (!['wood', 'paper', 'leather'].includes(kind)) throw new Error('tex ' + kind);
  const s = style ? ` style="${style}"` : '';
  return `<svg class="hk-tex hk-tex--${kind}" aria-hidden="true"${s}><rect width="100%" height="100%"/></svg>`;
}
function shieldSvg(ac, w, label, style) {
  const h = Math.round(w * 96 / 82);
  const id = 'shg' + (++uid);
  const lab = esc(label || ('Armor class ' + ac));
  const s = style ? ` style="${style}"` : '';
  return `<svg viewBox="0 0 82 96" width="${w}" height="${h}" role="img" aria-label="${lab}"${s}><title>${lab}</title>` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--brass-top)"/><stop offset=".5" stop-color="var(--brass)"/><stop offset="1" stop-color="var(--brass-bottom)"/></linearGradient></defs>` +
    `<path d="M43 7 L77 17 V47 C77 69 60 87 43 95 C26 87 9 69 9 47 V17 Z" fill="var(--leather-edge)" opacity=".6"/>` +
    `<path d="M41 4 L75 14 V44 C75 66 58 84 41 92 C24 84 7 66 7 44 V14 Z" fill="url(#${id})" stroke="var(--brass-shadow)" stroke-width="1.5"/>` +
    `<path d="M41 11 L68 19 V44 C68 62 54 77 41 84 C28 77 14 62 14 44 V19 Z" fill="var(--plate)" stroke="var(--rivet-dark)" stroke-width="1"/>` +
    `<text x="41" y="51" text-anchor="middle" dominant-baseline="central" font-size="40" font-family="var(--font-display)" fill="var(--text-on-leather)">${ac}</text></svg>`;
}
function monoFrame(text, w, h, fs, label, cls, style) {
  const c = cls ? ' ' + cls : '';
  const s = style ? style : '';
  return `<div class="hk-frame${c}" style="width:${w}px;height:${h}px;padding:3px;${s}"><div class="hk-frame__well" role="img" aria-label="${esc(label || ('Portrait placeholder, monogram ' + text))}" style="font-size:${fs}px">${text}</div></div>`;
}
function coinStack(metal, n, unit, label) {
  const names = { platinum: 'platinum', gold: 'gold', silver: 'silver', copper: 'copper' };
  const lab = esc(label || (n + ' ' + names[metal]));
  const c = `var(--coin-${metal})`, sh = `var(--coin-${metal}-shade)`;
  return `<div class="hk-coinstack" role="img" aria-label="${lab}" title="${lab}"><svg viewBox="0 0 36 28" width="34" height="26" aria-hidden="true">` +
    `<ellipse cx="18" cy="22" rx="15" ry="5" fill="${sh}"/><ellipse cx="18" cy="18.5" rx="15" ry="5" fill="${c}"/><ellipse cx="18" cy="14.5" rx="15" ry="5" fill="${sh}"/><ellipse cx="18" cy="11" rx="15" ry="5" fill="${c}"/><ellipse cx="18" cy="7" rx="15" ry="5" fill="${sh}"/><ellipse cx="18" cy="5" rx="15" ry="5" fill="${c}" stroke="${sh}" stroke-width=".6"/></svg>` +
    `<span class="hk-num">${n} <small>${unit}</small></span></div>`;
}
// A d20 seen along a face normal: centre triangle, three edge faces, six corner faces (ten visible faces).
function d20Svg(n, size, cls, style, label, rot, faded) {
  const P = (ang, r) => [50 + r * Math.cos(ang * Math.PI / 180), 50 - r * Math.sin(ang * Math.PI / 180)];
  const O = {}, I = {};
  for (const a of [30, 90, 150, 210, 270, 330]) O[a] = P(a, 47);
  for (const a of [90, 210, 330]) I[a] = P(a, 25);
  const pt = (p) => `${f(p[0])},${f(p[1])}`;
  const poly = (pts, fill) => `<polygon points="${pts.map(pt).join(' ')}" fill="${fill}" stroke="${faded ? '#6f6350' : '#4a3a22'}" stroke-width="1.1" stroke-linejoin="round"/>`;
  const ivory = faded ? ['#cfc5ae', '#b9ae95', '#a3977c', '#8c8068'] : ['#f3e9d0', '#dccfae', '#c3b48e', '#a89770'];
  let body = '';
  // corner faces (darkest), then edge faces, then the centre face
  const pairs = [[90, 30, 150], [210, 150, 270], [330, 270, 30]];
  for (const [iv, oa, ob] of pairs) { body += poly([I[iv], O[iv], O[oa]], ivory[3]); body += poly([I[iv], O[iv], O[ob]], ivory[2]); }
  body += poly([I[90], I[210], O[150]], ivory[1]); body += poly([I[210], I[330], O[270]], ivory[2]); body += poly([I[330], I[90], O[30]], ivory[1]);
  body += poly([I[90], I[210], I[330]], ivory[0]);
  body += `<text x="50" y="53.5" text-anchor="middle" dominant-baseline="central" font-family="Forum, serif" font-size="21" fill="${faded ? '#7a6a52' : '#8e3220'}">${n}</text>`;
  const lab = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  const c = cls ? ` class="${cls}"` : '';
  const s = style ? ` style="${style}"` : '';
  const t = label ? `<title>${esc(label)}</title>` : '';
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}"${lab}${c}${s}>${t}<g transform="rotate(${rot || 0} 50 50)">${body}</g></svg>`;
}

function attrs(s) {
  const o = {};
  const re = /([a-zA-Z-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = m[2];
  return o;
}

const DS_CSS = (fs.readFileSync(path.join(SCRATCH, 'ds', 'check', 'tokens.css'), 'utf8') + '\n' +
  fs.readFileSync(path.join(SCRATCH, 'ds', 'project', 'components', 'bundle.css'), 'utf8'))
  .replace(/\s*!important/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\n{2,}/g, '\n')
  .replace(/\}\}/g, '} }');
const S5_CSS = fs.readFileSync(path.join(__dirname, 's5.css'), 'utf8').replace(/\}\}/g, '} }');

function expand(src) {
  const used = new Set();
  let out = src.replace(/<x-defs><\/x-defs>/g, () => defsSvg());
  out = out.replace(/<x-shield([^>]*)><\/x-shield>/g, (_, a) => { const o = attrs(a); return shieldSvg(o.ac, +(o.w || 40), o.label, o.style); });
  out = out.replace(/<x-mono([^>]*)><\/x-mono>/g, (_, a) => { const o = attrs(a); return monoFrame(o.text, +(o.w || 50), +(o.h || 56), +(o.fs || 22), o.label, o.class, o.style); });
  out = out.replace(/<x-coin([^>]*)><\/x-coin>/g, (_, a) => { const o = attrs(a); return coinStack(o.metal, o.n, o.unit, o.label); });
  out = out.replace(/<x-d20([^>]*)><\/x-d20>/g, (_, a) => { const o = attrs(a); return d20Svg(o.n, +(o.size || 120), o.class, o.style, o.label, +(o.rot || 0), o.faded === '1'); });
  out = out.replace(/<i-icon([^>]*)><\/i-icon>/g, (_, a) => { const o = attrs(a); used.add(o.name); return iconSvg(o.name, o.size || 24, o.label, o.class, o.style, o.hint); });
  out = out.replace(/<x-seal([^>]*)><\/x-seal>/g, (_, a) => { const o = attrs(a); if (o.icon) used.add(o.icon); return sealSvg(o.state || 'full', o.icon, o.text, +(o.size || 28), o.label, +(o.seed || 0), o.class, o.style, +(o.fs || 0), o.hint); });
  out = out.replace(/<x-tex([^>]*)><\/x-tex>/g, (_, a) => { const o = attrs(a); return texSvg(o.kind, o.style); });
  out = out.replace('__DS_CSS__', DS_CSS).replace('__S5_CSS__', S5_CSS);
  return { out, used };
}

function check(fullHtml, name) {
  const html = fullHtml.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/, '');
  const bad = ['{{', '}}', '<sc-for', '<sc-if', '<dc-import', '<iframe', '<object', '<embed', 'data:', '<i-icon', '<x-seal', '<x-tex', '<x-defs', '<x-shield', '<x-mono', '<x-coin', '<x-d20', '__PREVIEW__', '__DS_CSS__', '__S5_CSS__', '!important'];
  for (const b of bad) if (html.includes(b)) throw new Error(name + ' contains forbidden token ' + b);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  if (emoji.test(html)) throw new Error(name + ' contains emoji');
}

// Fixed artboards: 720 × 900 sketches, except the phone moment.
const SIZES = { 'X-DeathSaves': [390, 844] };
const names = fs.readdirSync(__dirname).filter((n) => n.endsWith('.src.html')).sort();
const authorsUsed = new Set();
const allIcons = {};
for (const srcName of names) {
  const outName = srcName.replace('.src.html', '.dc.html');
  const id = srcName.replace(/\.src\.html$/, '');
  const [w, h] = SIZES[id] || [720, 900];
  const src = fs.readFileSync(path.join(__dirname, srcName), 'utf8');
  const { out, used } = expand(src);
  const html = out.replace('__PREVIEW__', `{"width":${w},"height":${h}}`);
  check(html, outName);
  fs.writeFileSync(path.join(__dirname, outName), html);
  for (const u of used) { authorsUsed.add(icons[u].author); allIcons[u] = icons[u].author; }
  console.log(outName.padEnd(28), (html.length / 1024).toFixed(0).padStart(4) + ' KB', 'icons', used.size, `${w} x ${h}`);
}
fs.writeFileSync(path.join(__dirname, 'icons-used.json'), JSON.stringify(allIcons, null, 1));
console.log('icon authors used:', [...authorsUsed].sort().join(', '));
