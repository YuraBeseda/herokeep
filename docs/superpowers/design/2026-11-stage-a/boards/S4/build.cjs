// build.cjs (S4) — expands authoring macros in *.src.html into literal static markup and inlines the
// design-system CSS. Derived from out/A2/build.cjs (same icon / seal / texture macros) plus:
//   <x-rail active="library" lang="en" chip="…" chipicon="…" tip="packs"></x-rail>   desktop brass rail
//   <x-topbar title="…" action="knapsack" alabel="…" lang="uk"></x-topbar>           phone top bar
//   <x-strap>…</x-strap>                                                              desktop action strap
//   <x-pstrap cols="3">…</x-pstrap>                                                   phone action strap
//   __DS_CSS__  -> tokens.css + bundle.css (the design system), __S4_CSS__ -> shared page styles
//   __PREVIEW__ -> the $preview JSON (height measured by shoot.cjs, stored in heights.json)
// Output never contains template syntax; the script asserts that.
const fs = require('fs');
const path = require('path');
const icons = require('../../icons.json');

const SCRATCH = path.join(__dirname, '..', '..', '..');
const GI = path.join(SCRATCH, 'gi', 'icons');
// glyphs the kit's icons.json lacks, normalised exactly like extract-icons.mjs did
const EXTRA = [
  ['third-eye', 'lorc'], ['thrown-spear', 'lorc'], ['hand-ok', 'delapouite'], ['smartphone', 'delapouite'],
  ['laptop', 'delapouite'], ['tablet', 'skoll'], ['cloud-download', 'delapouite'], ['cloud-upload', 'delapouite'],
  ['network-bars', 'delapouite'], ['radio-tower', 'delapouite'], ['expand', 'delapouite'], ['contract', 'delapouite'],
  ['id-card', 'delapouite'], ['database', 'delapouite'], ['clockwise-rotation', 'delapouite'], ['checklist', 'delapouite'],
  ['paint-roller', 'delapouite'], ['hazard-sign', 'lorc'], ['tied-scroll', 'lorc'], ['sunbeams', 'lorc'],
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

function texSvg(kind, style) {
  const id = 'tx' + (++uid);
  let filt;
  if (kind === 'wood') filt = `<feTurbulence type="fractalNoise" baseFrequency="0.0022 0.055" numOctaves="5" seed="9" result="n"/><feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.32  0 0 0 0 0.15  0 0 0 1.7 -0.55"/>`;
  else if (kind === 'paper') filt = `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3"/><feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.32  0 0 0 0 0.19  0 0 0 0.075 0"/>`;
  else if (kind === 'leather') filt = `<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="5"/><feColorMatrix type="matrix" values="0 0 0 0 0.09  0 0 0 0 0.05  0 0 0 0 0.03  0 0 0 0.32 0"/>`;
  else throw new Error('tex ' + kind);
  const s = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;${style || ''}`;
  return `<svg aria-hidden="true" style="${s}"><filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${filt}</filter><rect width="100%" height="100%" filter="url(#${id})"/></svg>`;
}

function attrs(s) {
  const o = {};
  const re = /([a-zA-Z-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = m[2];
  return o;
}

// ---- shared chrome ----
const NAV = {
  en: { home: 'Home', heroes: 'Heroes', campaigns: 'Campaigns', library: 'Library', packs: 'Packs', settings: 'Settings', account: 'Account', app: 'App', menu: 'Menu', actions: 'Actions' },
  uk: { home: 'Головна', heroes: 'Герої', campaigns: 'Кампанії', library: 'Бібліотека', packs: 'Пакети', settings: 'Налаштування', account: 'Обліковий запис', app: 'Застосунок', menu: 'Меню', actions: 'Дії' },
};
const NAV_ICONS = [['home', 'house'], ['heroes', 'person'], ['campaigns', 'three-friends'], ['library', 'open-book'], ['packs', 'chest'], ['settings', 'cog']];

function rail(o) {
  const L = NAV[o.lang || 'en'];
  const active = o.active || '';
  let nav = '';
  for (const [key, ic] of NAV_ICONS) {
    const on = key === active ? ' hk-ico--on' : '';
    const cur = key === active ? ' aria-current="page"' : '';
    if (o.tip === key) {
      nav += `<a class="hk-ico hk-has-tip${on}" href="#"${cur} aria-label="${L[key]}" aria-describedby="tipRail${key}"><i-icon name="${ic}" size="22"></i-icon><span class="hk-tip" id="tipRail${key}" role="tooltip">${L[key]}</span></a>`;
    } else {
      nav += `<a class="hk-ico${on}" href="#"${cur} aria-label="${L[key]}" title="${L[key]}"><i-icon name="${ic}" size="22"></i-icon></a>`;
    }
  }
  const chip = o.chip ? `<span class="hk-chip hk-chip--l" style="height:28px;font-size:15px" title="${o.chiptitle || o.chip}"><i-icon name="${o.chipicon || 'three-friends'}" size="15"></i-icon>${o.chip}</span>` : '';
  const accOn = active === 'account' ? ' hk-ico--on' : '';
  // tablet (768): the wordmark becomes the mark only (spec §2.2); tighter gaps so the rail never wraps
  const markOnly = o.mark === 'only';
  const railStyle = markOnly ? 'position:relative;z-index:3;flex:0 0 auto;gap:12px;padding:0 14px' : 'position:relative;z-index:3;flex:0 0 auto';
  const mark = markOnly ? `<div class="hk-rail__mark" title="Herokeep"><i-icon name="wax-seal" size="28" label="Herokeep"></i-icon></div>` : `<div class="hk-rail__mark"><i-icon name="wax-seal" size="26"></i-icon>Herokeep</div>`;
  return `<header class="hk-rail" style="${railStyle}">
  <x-tex kind="leather"></x-tex>
  ${mark}
  <nav class="hk-rail__nav" aria-label="${L.app}"><div class="hk-rail__bar" aria-hidden="true"></div>${nav}</nav>
  <div class="hk-rail__spacer"></div>${chip}
  <button class="hk-ico${accOn}" type="button" aria-label="${L.account}" title="${L.account}"><i-icon name="hood" size="22"></i-icon></button>
</header>`;
}

function topbar(o) {
  const L = NAV[o.lang || 'uk'];
  const act = o.action ? `<button class="hk-ico hk-ico--phone" type="button" aria-label="${o.alabel}" title="${o.alabel}"><i-icon name="${o.action}" size="22"></i-icon></button>` : '<span></span>';
  return `<div class="hk-topbar" style="z-index:3;flex:0 0 auto">
  <x-tex kind="leather"></x-tex>
  <button class="hk-ico hk-ico--phone" type="button" aria-label="${L.menu}" title="${L.menu}"><i-icon name="hamburger-menu" size="22"></i-icon></button>
  <div class="hk-topbar__title">${o.title}</div>
  ${act}
</div>`;
}

function strap(inner, o) {
  const L = NAV[o.lang || 'en'];
  return `<footer class="hk-astrap" aria-label="${L.actions}" style="position:sticky;bottom:0;z-index:4;flex:0 0 auto">
  <x-tex kind="leather"></x-tex>
  <div class="hk-rivets"></div>
  <div class="hk-astrap__row">${inner}</div>
  <div class="hk-rivets"></div>
</footer>`;
}

function pstrap(inner, o) {
  const L = NAV[o.lang || 'uk'];
  const cols = o.cols || '1fr 1fr 44px';
  return `<div class="hk-astrap" aria-label="${L.actions}" style="z-index:3;flex:0 0 auto">
  <x-tex kind="leather"></x-tex>
  <div class="hk-rivets"></div>
  <div style="position:relative;display:grid;grid-template-columns:${cols};gap:8px;padding:5px 12px 7px;align-items:center">${inner}</div>
</div>`;
}

const DS_CSS = (fs.readFileSync(path.join(SCRATCH, 'ds', 'check', 'tokens.css'), 'utf8') + '\n' +
  fs.readFileSync(path.join(SCRATCH, 'ds', 'project', 'components', 'bundle.css'), 'utf8'))
  .replace(/\s*!important/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\n{2,}/g, '\n')
  .replace(/\}\}/g, '} }');
const S4_CSS = fs.readFileSync(path.join(__dirname, 's4.css'), 'utf8').replace(/\}\}/g, '} }');

function expand(src) {
  const used = new Set();
  let out = src.replace(/<x-rail([^>]*)><\/x-rail>/g, (_, a) => rail(attrs(a)));
  out = out.replace(/<x-topbar([^>]*)><\/x-topbar>/g, (_, a) => topbar(attrs(a)));
  out = out.replace(/<x-strap([^>]*)>([\s\S]*?)<\/x-strap>/g, (_, a, inner) => strap(inner, attrs(a)));
  out = out.replace(/<x-pstrap([^>]*)>([\s\S]*?)<\/x-pstrap>/g, (_, a, inner) => pstrap(inner, attrs(a)));
  out = out.replace(/<i-icon([^>]*)><\/i-icon>/g, (_, a) => { const o = attrs(a); used.add(o.name); return iconSvg(o.name, o.size || 24, o.label, o.class, o.style, o.hint); });
  out = out.replace(/<x-seal([^>]*)><\/x-seal>/g, (_, a) => { const o = attrs(a); if (o.icon) used.add(o.icon); return sealSvg(o.state || 'full', o.icon, o.text, +(o.size || 28), o.label, +(o.seed || 0), o.class, o.style, +(o.fs || 0), o.hint); });
  out = out.replace(/<x-tex([^>]*)><\/x-tex>/g, (_, a) => { const o = attrs(a); return texSvg(o.kind, o.style); });
  out = out.replace('__DS_CSS__', DS_CSS).replace('__S4_CSS__', S4_CSS);
  return { out, used };
}

function check(fullHtml, name) {
  const html = fullHtml.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/, '');
  const bad = ['{{', '}}', '<sc-for', '<sc-if', '<dc-import', '<iframe', '<object', '<embed', 'data:', '<i-icon', '<x-seal', '<x-tex', '<x-rail', '<x-strap', '<x-pstrap', '<x-topbar', '__PREVIEW__', '__DS_CSS__', '__S4_CSS__', '!important'];
  for (const b of bad) if (html.includes(b)) throw new Error(name + ' contains forbidden token ' + b);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  if (emoji.test(html)) throw new Error(name + ' contains emoji');
}

let heights = {};
try { heights = JSON.parse(fs.readFileSync(path.join(__dirname, 'heights.json'), 'utf8')); } catch (e) {}
const names = fs.readdirSync(__dirname).filter((n) => n.endsWith('.src.html')).sort();
const authorsUsed = new Set();
for (const srcName of names) {
  const outName = srcName.replace('.src.html', '.dc.html');
  const phone = /-Phone\.src\.html$/.test(srcName);
  const tablet = /-Tablet\.src\.html$/.test(srcName);
  const id = srcName.replace(/-(Desktop|Phone|Tablet)\.src\.html$/, '');
  const pv = phone ? '{"width":390,"height":844}' : tablet ? '{"width":768,"height":1024}' : `{"width":1440,"height":${heights[id] || 1100}}`;
  const src = fs.readFileSync(path.join(__dirname, srcName), 'utf8');
  const { out, used } = expand(src);
  const html = out.replace('__PREVIEW__', pv);
  check(html, outName);
  fs.writeFileSync(path.join(__dirname, outName), html);
  for (const u of used) authorsUsed.add(icons[u].author);
  console.log(outName.padEnd(32), (html.length / 1024).toFixed(0).padStart(4) + ' KB', 'icons', used.size, (phone || tablet) ? '' : 'preview h ' + (heights[id] || '1100 (default)'));
}
console.log('icon authors used:', [...authorsUsed].sort().join(', '));
