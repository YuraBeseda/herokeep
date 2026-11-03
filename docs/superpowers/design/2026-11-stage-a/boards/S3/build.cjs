// build.cjs — expands the authoring macros in *.src.html into literal, static markup (CommonJS on purpose).
//   <i-icon name="heart" size="24" label="..." hint="..." class="" style=""></i-icon> -> inline game-icons SVG
//   <x-seal state="full|spent" icon="..." text="+3" size="28" label="..." hint="..."></x-seal> -> wax seal SVG
//   <x-tex kind="wood|paper|leather" style=""></x-tex> -> design-system texture overlay (uses the shared filters)
//   <x-defs></x-defs> -> the hidden <svg> with the three feTurbulence filters and the shield gradient (once per board)
//   <x-rail active="campaigns" chip="..." live="1"></x-rail> -> the brass rail (desktop)
//   <x-chead ...></x-chead> -> the campaign header band with the four tabs
//   <x-strap kind="dm|player|list|join|link|create" status="..."></x-strap> -> the three-zone action strap
//   <x-qr size="200" seed="7"></x-qr> -> a plausible QR code drawn as an SVG grid
//   <x-shield ac="18" w="40"></x-shield> -> brass heater shield with the AC numeral
//   <x-mono text="IV" w="50" h="56" fs="22" label="..."></x-mono> -> portrait placeholder frame with a monogram
//   <x-topbar title="..." action="..." alabel="..."></x-topbar>, <x-tabbar active="party"></x-tabbar> -> phone chrome
// Output never contains template syntax; the script asserts that.
const fs = require('fs');
const path = require('path');
const icons = require('../../icons.json');

const GI = path.join(__dirname, '..', '..', '..', 'gi', 'icons');
// Glyphs the kit's icons.json lacks, taken from the cloned game-icons repo and normalised exactly like extract-icons.mjs.
const EXTRA = [['third-eye', 'lorc'], ['thrown-spear', 'lorc'], ['paper-plane', 'delapouite'], ['shaking-hands', 'delapouite'], ['round-table', 'delapouite'], ['files', 'delapouite'], ['ticket', 'delapouite'], ['spy', 'delapouite'], ['megaphone', 'delapouite'], ['door', 'delapouite'], ['cycle', 'lorc'], ['hand', 'lorc'], ['envelope', 'lorc'], ['tick', 'lorc'], ['portrait', 'delapouite'], ['calendar', 'delapouite'], ['keyring', 'delapouite']];
for (const [name, author] of EXTRA) {
  if (icons[name]) continue;
  const p = path.join(GI, author, name + '.svg');
  if (!fs.existsSync(p)) continue;
  const svg = fs.readFileSync(p, 'utf8');
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
  const a11y = lab ? `role="img" aria-label="${esc(lab)}"` : 'aria-hidden="true"';
  const c = cls ? ` class="${cls}"` : '';
  const s = style ? ` style="${style}"` : '';
  const t = hint ? `<title>${hint}</title>` : '';
  return `<svg viewBox="${vb}" width="${size}" height="${size}" ${a11y}${c}${s}>${t}${body}</svg>`;
}
function iconGroup(name, color, x, y, scale) {
  const ic = icons[name];
  let body = ic.body, shift = 0;
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
  const a11y = lab ? `role="img" aria-label="${esc(lab)}"` : 'aria-hidden="true"';
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
    } else if (icon) {
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
    `<linearGradient id="hkShieldBrass" x1="0" y1="0" x2="0" y2="1"><stop class="hk-shield-stop1" offset="0"/><stop class="hk-shield-stop2" offset=".5"/><stop class="hk-shield-stop3" offset="1"/></linearGradient>` +
    `</svg>`;
}
function texSvg(kind, style) {
  if (!['wood', 'paper', 'leather'].includes(kind)) throw new Error('tex ' + kind);
  const s = style ? ` style="${style}"` : '';
  return `<svg class="hk-tex hk-tex--${kind}" aria-hidden="true"${s}><rect width="100%" height="100%"/></svg>`;
}
function shieldSvg(ac, w, label) {
  const h = Math.round(w * 96 / 82);
  return `<svg viewBox="0 0 82 96" width="${w}" height="${h}" role="img" aria-label="${esc(label || ('Armor class ' + ac))}"><title>${label || ('Armor class ' + ac)}</title><path class="hk-shield-shadow" d="M41 4 L75 14 V44 C75 66 58 84 41 92 C24 84 7 66 7 44 V14 Z" transform="translate(2,3)"/><path class="hk-shield-face" d="M41 4 L75 14 V44 C75 66 58 84 41 92 C24 84 7 66 7 44 V14 Z"/><path class="hk-shield-inner" d="M41 11 L68 19 V44 C68 62 54 77 41 84 C28 77 14 62 14 44 V19 Z"/><text class="hk-shield-num" x="41" y="51" text-anchor="middle" dominant-baseline="central" font-size="40">${ac}</text></svg>`;
}
function monoFrame(text, w, h, fs, label, cls, style) {
  const c = cls ? ' ' + cls : '';
  const s = style ? style : '';
  return `<div class="hk-frame${c}" style="width:${w}px;height:${h}px;padding:3px;${s}"><div class="hk-frame__well" role="img" aria-label="${esc(label || ('Portrait placeholder, monogram ' + text))}" style="font-size:${fs}px">${text}</div></div>`;
}

// A plausible QR: 29 x 29 modules (version 3), three finder patterns, timing rows, deterministic noise.
function qrSvg(size, seed) {
  const n = 29;
  let s = (seed || 7) * 2654435761 >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s & 0xffff) / 0x10000; };
  const m = Array.from({ length: n }, () => Array(n).fill(0));
  const finder = (ox, oy) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) { const ring = (x === 0 || x === 6 || y === 0 || y === 6); const core = (x >= 2 && x <= 4 && y >= 2 && y <= 4); m[oy + y][ox + x] = (ring || core) ? 1 : 0; } };
  const reserved = Array.from({ length: n }, () => Array(n).fill(0));
  const mark = (ox, oy) => { for (let y = -1; y < 8; y++) for (let x = -1; x < 8; x++) { const yy = oy + y, xx = ox + x; if (yy >= 0 && yy < n && xx >= 0 && xx < n) reserved[yy][xx] = 1; } };
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7); mark(0, 0); mark(n - 7, 0); mark(0, n - 7);
  for (let i = 8; i < n - 8; i++) { m[6][i] = (i % 2 === 0) ? 1 : 0; m[i][6] = (i % 2 === 0) ? 1 : 0; reserved[6][i] = 1; reserved[i][6] = 1; }
  // alignment pattern (version 3 at 22,22)
  for (let y = 20; y <= 24; y++) for (let x = 20; x <= 24; x++) { const ring = (x === 20 || x === 24 || y === 20 || y === 24); m[y][x] = (ring || (x === 22 && y === 22)) ? 1 : 0; reserved[y][x] = 1; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!reserved[y][x]) m[y][x] = rnd() < 0.47 ? 1 : 0;
  const cell = size / (n + 4);
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${f((x + 2) * cell)} ${f((y + 2) * cell)}h${f(cell)}v${f(cell)}h-${f(cell)}z`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR code for the invite link" style="display:block;border-radius:6px"><title>QR code for the invite link</title><rect width="${size}" height="${size}" fill="#F6EEDC" rx="6"/><path d="${d}" fill="#2B2118"/></svg>`;
}

function attrs(s) { const o = {}; const re = /([a-zA-Z-]+)="([^"]*)"/g; let m; while ((m = re.exec(s))) o[m[1]] = m[2]; return o; }

// ----- shell macros -----
const NAV = [['home', 'house', 'Home'], ['heroes', 'person', 'Heroes'], ['campaigns', 'three-friends', 'Campaigns'], ['library', 'open-book', 'Library'], ['packs', 'chest', 'Packs'], ['settings', 'cog', 'Settings']];
function railHtml(o) {
  const active = o.active || 'campaigns';
  const compact = o.compact === '1';
  let nav = '';
  for (const [id, icon, label] of NAV) {
    const on = id === active;
    const tip = (o.tip === id) ? ` aria-describedby="tipNav${id}"` : '';
    const tipEl = (o.tip === id) ? `<span class="hk-tip" id="tipNav${id}" role="tooltip">${label}</span>` : '';
    nav += `<a class="hk-ico${on ? ' hk-ico--on' : ''}" href="#"${on ? ' aria-current="page"' : ''} aria-label="${label}" title="${label}"${tip}><i-icon name="${icon}" size="22"></i-icon>${tipEl}</a>`;
  }
  const chip = o.chip ? `<a href="#" class="hk-chip halo${o.live ? '' : ' hk-chip--dark'}" style="position:relative;height:30px;font-size:15px;gap:7px;text-decoration:none;${o.live ? 'background:var(--chip-dark);color:var(--text-on-leather-2);box-shadow:inset 0 0 0 1px var(--border-brass)' : ''}" title="${esc(o.chiptitle || o.chip)}"><i-icon name="${o.live ? 'candle-flame' : 'three-friends'}" size="15" style="color:${o.live ? 'var(--danger-on-leather)' : 'var(--brass)'}"></i-icon>${o.chip}</a>` : '';
  return `<header class="hk-rail" style="z-index:3;flex:0 0 auto${compact ? ';padding:0 14px;gap:12px' : ''}">` + texSvg('leather') +
    `<div class="hk-rail__mark"${compact ? ' title="Herokeep" aria-label="Herokeep"' : ''}><i-icon name="wax-seal" size="26"></i-icon>${compact ? '' : 'Herokeep'}</div>` +
    `<nav class="hk-rail__nav" aria-label="App"${compact ? ' style="gap:8px;padding:0 10px"' : ''}><div class="hk-rail__bar" aria-hidden="true"></div>${nav}</nav>` +
    `<div class="hk-rail__spacer"></div>${chip}` +
    `<button class="hk-ico" type="button" aria-label="Account" title="Account"><i-icon name="hood" size="22"></i-icon></button></header>`;
}
const CTABS = [['party', 'three-friends', 'Party'], ['table', 'round-table', 'Table'], ['lobby', 'entry-door', 'Lobby'], ['settings', 'cog', 'Settings']];
function cheadHtml(o) {
  const dm = (o.role || 'dm') === 'dm';
  let tabs = '';
  for (const [id, icon, label] of CTABS) {
    const on = id === o.tab;
    tabs += `<a class="hk-tab ctab${on ? ' hk-tab--on' : ''}" href="#"${on ? ' aria-current="page"' : ''}><i-icon name="${icon}" size="16"></i-icon>${label}</a>`;
  }
  const role = dm ? `<span class="hk-chip hk-chip--dark" style="height:26px;font-size:14px" title="Your role: you run this campaign"><i-icon name="crown" size="14"></i-icon>DM</span>` : `<span class="hk-chip hk-chip--dark" style="height:26px;font-size:14px" title="Your role: player${o.hero ? ', you play ' + o.hero : ''}"><i-icon name="person" size="14"></i-icon>Player${o.hero ? ' · ' + o.hero : ''}</span>`;
  const members = `<span class="hk-chip hk-chip--dark" style="height:26px;font-size:14px" title="${o.members || 5} members${o.pregens ? ', ' + o.pregens + ' pregen' : ''}"><i-icon name="three-friends" size="14"></i-icon>${o.members || 5} members</span>`;
  const session = o.session === 'live'
    ? `<span class="hk-chip chipLive" role="status" style="height:26px;font-size:14px" title="Session in progress${o.round ? ', round ' + o.round : ''}${o.elapsed ? ', ' + o.elapsed + ' elapsed' : ''}"><i-icon name="candle-flame" size="13"></i-icon>Session live${o.round ? ' · round ' + o.round : ''}${o.elapsed ? ' · ' + o.elapsed : ''}</span>`
    : `<span class="hk-chip hk-chip--dark" style="height:26px;font-size:14px;color:var(--text-on-leather-3)" title="No session in progress"><i-icon name="candle-flame" size="13" style="color:var(--text-on-leather-3)"></i-icon>No session</span>`;
  const wrap = o.wrap === '1';
  return `<div class="chead" style="z-index:2;flex:0 0 auto">` + texSvg('leather') +
    `<div class="chead__row"${wrap ? ' style="flex-wrap:wrap;gap:8px 12px;padding:10px 16px 0"' : ''}>` +
    `<h1 class="hk-nameplate" style="font-size:${wrap ? 21 : 24}px;line-height:1.1;flex:0 1 auto;min-width:0">${o.name}</h1>` +
    `<div class="hk-row" style="gap:6px;flex:1 1 auto;min-width:0">${role}${members}${session}</div>` +
    `<nav class="hk-tabs" aria-label="Campaign" style="flex:${wrap ? '1 1 100%' : '0 0 auto'};align-self:flex-end;gap:5px${wrap ? ';justify-content:flex-start' : ''}">${tabs}</nav>` +
    `</div></div>`;
}
const B = (cls, icon, label, extra) => `<button class="hk-btn hk-btn--l ${cls}" type="button"${extra || ''}><i-icon name="${icon}" size="18"></i-icon>${label}</button>`;
function strapHtml(o) {
  const kind = o.kind || 'dm';
  let z1 = '', z2 = '', z3 = '';
  const dmTitle = ` title="Acts on the selected party member${o.sel ? ': ' + o.sel : ''}"`;
  if (kind === 'dm') {
    z1 = `<span class="hk-hint" style="color:var(--text-on-leather-3);opacity:.85">nothing here on a campaign</span>`;
    z2 = B('hk-btn--ember', 'broken-heart', 'Damage', dmTitle) + B('hk-btn--moss', 'healing', 'Heal', dmTitle) + B('hk-btn--leather', 'skull', 'Condition', dmTitle) + B('hk-btn--leather', 'laurels', 'XP', dmTitle) + B('hk-btn--leather', 'swap-bag', 'Item', dmTitle);
    z3 = (o.session === 'live'
      ? `<button class="hk-ico hk-ico--on hk-has-tip" type="button" aria-label="End session" title="End session"${o.tip === 'session' ? ' aria-describedby="tipSession"' : ''}><i-icon name="candle-flame" size="20"></i-icon>${o.tip === 'session' ? '<span class="hk-tip hk-tip--above" id="tipSession" role="tooltip">End session<span class="hk-tip__sub">round 3 · 1 h 12 min</span></span>' : ''}</button>`
      : `<button class="hk-ico hk-has-tip" type="button" aria-label="Start session" title="Start session"${o.tip === 'session' ? ' aria-describedby="tipSession"' : ''}><i-icon name="candle-flame" size="20"></i-icon>${o.tip === 'session' ? '<span class="hk-tip hk-tip--above" id="tipSession" role="tooltip">Start session</span>' : ''}</button>`) +
      `<button class="hk-ico hk-has-tip" type="button" aria-label="Export campaign" title="Export campaign"${o.tip === 'export' ? ' aria-describedby="tipExport"' : ''}><i-icon name="share" size="20"></i-icon>${o.tip === 'export' ? '<span class="hk-tip hk-tip--above" id="tipExport" role="tooltip">Export campaign</span>' : ''}</button>`;
  } else if (kind === 'player') {
    z1 = `<span class="hk-hint" style="color:var(--text-on-leather-3);opacity:.85">nothing here on a campaign</span>`;
    z2 = B('hk-btn--brass', 'crossed-swords', 'Open my sheet', ` title="Opens ${o.hero || 'your hero'} on the Play tab"`) + B('hk-btn--leather', 'dice-twenty-faces-twenty', 'Roll', ' title="Roll to the table"');
    z3 = `<span class="hk-hint" style="color:var(--text-on-leather-3);opacity:.85">session and export are the DM&#8217;s</span>`;
  } else if (kind === 'list') {
    z1 = `<span class="hk-hint" style="color:var(--text-on-leather-3);opacity:.85">nothing here on a list</span>`;
    z2 = B('hk-btn--brass', 'plus', 'New campaign') + B('hk-btn--leather', 'entry-door', 'Join');
    z3 = '';
  } else if (kind === 'join') {
    z1 = `<a class="hk-btn hk-btn--l hk-btn--leather" href="#" style="padding-left:12px"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Back</a>`;
    z2 = o.disabled
      ? `<button class="hk-btn hk-btn--l hk-btn--brass" type="button" disabled="disabled" aria-disabled="true" title="Enter a join code first"><i-icon name="entry-door" size="18"></i-icon>Join</button><span class="hk-hint" style="color:var(--text-on-leather-3)">enter a join code first</span>`
      : B('hk-btn--brass', 'entry-door', 'Join', ' class="hk-focus-demo"'.replace('class="hk-focus-demo"', '')) ;
    z3 = `<button class="hk-ico" type="button" aria-label="Scan a QR code" title="Scan a QR code"><i-icon name="treasure-map" size="20"></i-icon></button>`;
  } else if (kind === 'link') {
    z1 = `<a class="hk-btn hk-btn--l hk-btn--leather" href="#" style="padding-left:12px"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Back</a><a class="hk-btn hk-btn--l hk-btn--ghost-leather" href="#" title="Join without a hero; you can link one later from the Party tab">Skip for now</a>`;
    z2 = B('hk-btn--brass', 'wax-seal', o.label || 'Link Bramble Underfoot');
    z3 = `<button class="hk-ico" type="button" aria-label="Create a new hero" title="Create a new hero"><i-icon name="plus" size="20"></i-icon></button>`;
  }
  const compact = o.compact === '1';
  const status = (o.status && !compact) ? `<span class="hk-astrap__note" style="white-space:nowrap">${o.sicon ? `<i-icon name="${o.sicon}" size="16" style="color:${o.scolor || 'var(--brass)'}"></i-icon>` : ''}${o.status}</span>` : '';
  if (compact) { z1 = ''; z2 = z2.split('hk-btn--l ').join('hk-btn--l btnC '); }
  return `<footer class="hk-astrap" aria-label="Actions" style="position:sticky;bottom:0;z-index:4;flex:0 0 auto">` + texSvg('leather') +
    `<div class="hk-rivets"></div><div class="hk-astrap__row" style="min-height:52px${compact ? ';padding:6px 12px;gap:8px' : ''}">` +
    (compact ? '' : `<div class="hk-astrap__zone" style="min-width:150px">${z1}</div><span class="hk-astrap__divider" aria-hidden="true"></span>`) +
    `<div class="hk-astrap__zone"${compact ? ' style="gap:6px"' : ''}>${z2}</div><span class="hk-astrap__divider" aria-hidden="true"></span>` +
    `<div class="hk-astrap__zone" style="flex:1 1 auto;min-width:0${compact ? ';gap:6px' : ''}">${z3}${status}</div>` +
    `</div><div class="hk-rivets"></div></footer>`;
}
// phone chrome (uk)
function topbarHtml(o) {
  const action = o.action ? `<button class="hk-ico hk-ico--phone" type="button" aria-label="${esc(o.alabel)}" title="${esc(o.alabel)}"><i-icon name="${o.action}" size="22"></i-icon></button>` : '<span></span>';
  return `<header class="hk-topbar" style="z-index:3;flex:0 0 auto;height:56px">` + texSvg('leather') +
    `<button class="hk-ico hk-ico--phone" type="button" aria-label="Меню розділів" title="Меню розділів"><i-icon name="book-cover" size="22"></i-icon></button>` +
    `<h1 class="hk-topbar__title" style="margin:0;font-weight:400">${o.title}</h1>${action}</header>`;
}
const PTABS = [['party', 'three-friends', 'Гурт'], ['table', 'round-table', 'Стіл'], ['lobby', 'entry-door', 'Лобі'], ['settings', 'cog', 'Налаштування']];
function tabbarHtml(o) {
  let t = '';
  for (const [id, icon, label] of PTABS) {
    const on = id === o.active;
    t += `<a class="hk-tabb${on ? ' hk-tabb--on' : ''}" href="#"${on ? ' aria-current="page"' : ''}>${on ? '<span class="hk-tabb__glow" aria-hidden="true"></span>' : ''}<i-icon name="${icon}" size="24"></i-icon><span>${label}</span></a>`;
  }
  return `<nav class="hk-tabbar" aria-label="Розділи кампанії" style="z-index:3;flex:0 0 auto">` + texSvg('leather') + t + `</nav>`;
}

// ----- party cards (the DS PartyCard, one data row per member) -----
const PARTY = {
  ilyana: { mono: 'IV', name: 'Ilyana Vorn', cls: 'Human Paladin 5', ci: 'templar-shield', player: 'Mira', online: true, hp: 31, max: 44, temp: 5, ac: 18, pp: 11, insp: true, conc: 'Concentrating on Bless, round 3', conds: [['poison-bottle', 'Poisoned', '3 rounds', 'Poisoned, 3 rounds left, from Giant Spider']] },
  bramble: { mono: 'BU', name: 'Bramble Underfoot', cls: 'Halfling Rogue 3', ci: 'hood', player: 'Taras', online: true, hp: 14, max: 21, temp: 0, ac: 15, pp: 14, insp: false, conc: '', conds: [['invisible', 'Invisible', '1 min', 'Invisible, 1 minute left']] },
  maren: { mono: 'SM', name: 'Sister Maren', cls: 'Human Cleric 4', ci: 'holy-symbol', player: 'Olena', online: false, hp: 27, max: 31, temp: 0, ac: 16, pp: 15, insp: false, conc: 'Concentrating on Hold Person, round 2', conds: [] },
  thorne: { mono: 'TA', name: 'Thorne Ashvale', cls: 'Elf Ranger 4', ci: 'bowman', player: 'Marko', online: true, hp: 30, max: 36, temp: 0, ac: 15, pp: 16, insp: true, conc: 'Concentrating on Hunter’s Mark, round 3', conds: [] },
  oskar: { mono: 'OB', name: 'Oskar Bellow', cls: 'Dwarf Fighter 5', ci: 'crossed-swords', player: 'Petro', online: true, hp: 0, max: 52, temp: 0, ac: 19, pp: 12, insp: false, conc: '', dying: true, conds: [['knocked-out-stars', 'Unconscious', '', 'Unconscious: dropped to 0 hit points']] },
  guard: { mono: 'GC', name: 'Guard captain', cls: 'Human Fighter 3', ci: 'crossed-swords', player: '', pregen: true, online: false, hp: 28, max: 28, temp: 0, ac: 16, pp: 12, insp: false, conc: '', conds: [] },
};
const FX = [['hk-chip--ember', 'broken-heart', 'Damage'], ['hk-chip--moss', 'healing', 'Heal'], ['', 'heart-armor', 'Temp HP'], ['', 'skull', 'Condition'], ['', 'laurels', 'XP'], ['', 'upgrade', 'Level'], ['', 'swap-bag', 'Item'], ['', 'inspiration', 'Inspiration'], ['', 'quill', 'Override']];
function pcardHtml(o) {
  const d = PARTY[o.id];
  if (!d) throw new Error('party ' + o.id);
  const mode = o.mode || 'dm';
  const own = o.own === '1';
  const sel = o.sel === '1';
  const first = d.name.split(' ')[0];
  const possessive = first + '’s';
  let who;
  if (d.pregen) who = `pregen · <span style="color:var(--text-3)">unclaimed</span>`;
  else if (own) who = `<span style="color:var(--success-strong)">you</span> · online`;
  else who = `played by ${d.player} · <span style="color:${d.online ? 'var(--success-strong)' : 'var(--text-3)'}">${d.online ? 'online' : 'offline'}</span>`;
  const conc = d.conc ? `<span class="hk-chip hk-chip--arcane" style="height:22px;padding:0 6px;flex:0 0 auto" title="${esc(d.conc)}"><i-icon name="concentration-orb" size="13" hint="${esc(d.conc)}"></i-icon></span>` : '';
  const pp = `<span class="hk-chip" style="height:22px;padding:0 6px" title="Passive perception ${d.pp}"><i-icon name="eye" size="12" hint="Passive perception ${d.pp}"></i-icon>${d.pp}</span>`;
  const insp = d.insp ? `<span class="hk-chip hk-chip--selected" style="height:22px;padding:0 6px" title="Heroic inspiration available"><i-icon name="inspiration" size="12" hint="Heroic inspiration available"></i-icon>1</span>` : '';
  const hpPct = f(d.hp / (d.max + d.temp) * 100), tPct = f(d.temp / (d.max + d.temp) * 100);
  const hpNum = d.dying ? `<span class="hk-num" style="font-size:24px;color:var(--danger-on-leather)">0 <span style="font-size:15px;color:var(--brass)">/ ${d.max}</span></span>` : `<span class="hk-num" style="font-size:24px;color:var(--text-on-leather)">${d.hp} <span style="font-size:15px;color:var(--brass)">/ ${d.max}</span></span>`;
  const gaugeLabel = d.dying ? `0 of ${d.max} hit points, death saves: 1 success, 1 failure` : `${d.hp} of ${d.max} hit points${d.temp ? ', plus ' + d.temp + ' temporary' : ''}`;
  const temp = d.temp ? `<span class="hk-strap__label" title="${d.temp} temporary hit points"><i-icon name="heart-armor" size="14"></i-icon>+${d.temp}</span>` : (d.dying ? `<span style="display:inline-flex;gap:2px;align-items:center" role="img" aria-label="Death saves: 1 success, 1 failure" title="Death saves: 1 success, 1 failure"><span class="hk-ring__i hk-ring__i--marked" style="width:14px;height:14px"></span><span class="hk-ring__i" style="width:14px;height:14px"></span><span class="hk-ring__i" style="width:14px;height:14px"></span><span style="width:4px"></span><span class="hk-ring__i hk-ring__i--f hk-ring__i--marked" style="width:14px;height:14px"></span><span class="hk-ring__i hk-ring__i--f" style="width:14px;height:14px"></span><span class="hk-ring__i hk-ring__i--f" style="width:14px;height:14px"></span></span>` : '');
  let chips = '';
  for (const [ic, nm, dur, hint] of d.conds) {
    if (o.open === '1' && nm === 'Poisoned') {
      chips += `<span class="hk-cond hk-cond--open" style="font-size:14px"><button class="hk-cond__main" type="button" aria-expanded="true" title="${esc(hint)}" style="height:28px"><i-icon name="${ic}" size="14"></i-icon>${nm}<span class="hk-cond__dur" style="height:18px">${dur}</span></button><span class="hk-hint" style="color:var(--danger-strong);margin-left:4px">from Giant Spider</span><div class="hk-cond__edit"><button class="hk-ico hk-ico--s" type="button" aria-label="One round fewer" title="−1 round"><i-icon name="minus" size="12"></i-icon></button><span class="hk-num">3</span><button class="hk-ico hk-ico--s" type="button" aria-label="One round more" title="+1 round"><i-icon name="plus" size="12"></i-icon></button><span style="flex:1 1 12px"></span><button class="hk-btn hk-btn--parchment" type="button" style="height:28px"><i-icon name="quill" size="13"></i-icon>Edit</button><button class="hk-btn hk-btn--ember" type="button" style="height:28px"><i-icon name="cross-mark" size="12"></i-icon>End</button></div></span>`;
    } else if (o.locked === '1' && nm === 'Poisoned') {
      chips += `<span class="hk-cond hk-has-tip" style="height:28px;padding:0 8px;font-size:14px" tabindex="0" aria-describedby="tipLock" title="Poisoned, 3 rounds left · managed by your DM"><i-icon name="${ic}" size="14"></i-icon>${nm}<span class="hk-cond__dur" style="height:18px">${dur}</span><i-icon name="padlock" size="13" hint="Managed by your DM"></i-icon><span class="hk-tip hk-tip--above" id="tipLock" role="tooltip">Managed by your DM<span class="hk-tip__sub">the house rule &#8220;Players manage their own conditions&#8221; is off</span></span></span>`;
    } else {
      const end = (mode === 'dm' || own) ? `<button class="hk-x" type="button" aria-label="End ${nm}" title="End" style="width:28px;height:28px"><span class="hk-x__i" style="width:18px;height:18px"><i-icon name="cross-mark" size="10"></i-icon></span></button>` : '';
      chips += `<span class="hk-cond" style="height:28px;padding:0 ${end ? '0' : '8px'} 0 8px;font-size:14px" title="${esc(hint)}"><i-icon name="${ic}" size="14"></i-icon>${nm}${dur ? `<span class="hk-cond__dur" style="height:18px">${dur}</span>` : ''}${end}</span>`;
    }
  }
  if (d.pregen) chips += `<span class="hk-chip" style="height:28px" title="Pregen: no player has claimed it yet; you control it"><i-icon name="padlock" size="13"></i-icon>pregen, unclaimed</span>`;
  if (!d.conds.length && !d.pregen) chips += `<span class="hk-hint" style="display:inline-flex;align-items:center;height:28px">no conditions</span>`;
  let fx = '';
  if (mode === 'dm') {
    if (d.pregen) fx = `<button class="hk-chip hk-chip--l hk-chip--btn hk-chip--selected" type="button" title="Give this pregen to a member"><i-icon name="shaking-hands" size="14"></i-icon>Hand over to…</button>`;
    for (const [c, ic, lb] of FX) fx += `<button class="hk-chip hk-chip--l hk-chip--btn ${c}${sel && lb === 'Damage' ? ' hk-focus-demo' : ''}" type="button" style="height:32px;padding:0 8px" title="${lb}: ${possessive === 'Guard’s' ? 'the Guard captain' : first}"><i-icon name="${ic}" size="14"></i-icon>${lb}</button>`;
    fx = `<div class="hk-party__fx" role="group" aria-label="Quick effects for ${d.name}">${fx}</div>`;
  }
  const openBtn = mode === 'dm'
    ? `<button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="Open ${possessive} sheet" title="Open sheet (read-only, with Override)" style="width:32px;height:32px"><i-icon name="open-book" size="15"></i-icon></button>`
    : (own ? '' : (o.sheets === 'full' ? `<button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="View ${possessive} sheet" title="View sheet (read-only)" style="width:32px;height:32px"><i-icon name="open-book" size="15"></i-icon></button>` : ''));
  const ownPlate = own ? `<span class="hk-plate" style="height:22px;font-size:14px;font-family:var(--font-body);font-weight:600" title="This is your hero">your hero</span>` : '';
  const selCls = sel ? ' psel' : '';
  const tilt = o.tilt || '-.2deg';
  return `<article class="hk-leaf hk-party${selCls}" aria-labelledby="pc-${o.id}" style="width:auto;transform:rotate(${tilt});${o.style || ''}">` + texSvg('paper') +
    monoFrame(d.mono, 50, 56, 22, `Portrait placeholder, monogram ${d.mono}`, 'hk-frame--s') +
    `<div class="hk-col" style="gap:4px;min-width:0"><h3 class="hk-party__name" id="pc-${o.id}" style="margin:0"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.name}</span>${conc}${ownPlate}</h3><span class="hk-party__sub" style="display:flex;align-items:center;gap:5px"><i-icon name="${d.ci}" size="13" style="color:var(--accent-strong)"></i-icon>${d.cls} · ${who}</span><span style="display:flex;gap:5px;align-items:center">${pp}${insp}</span></div>` +
    `<div class="hk-row" style="gap:6px;flex-wrap:nowrap">${shieldSvg(d.ac, 40, 'Armor class ' + d.ac)}${openBtn}</div>` +
    `<div class="hk-party__hp hk-strap" style="display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:6px 10px">${texSvg('leather')}${hpNum}<div class="hk-gauge" role="img" aria-label="${gaugeLabel}"><div class="hk-gauge__hp" style="width:${hpPct}%"></div>${d.temp ? `<div class="hk-gauge__temp" style="width:${tPct}%"></div>` : ''}</div>${temp}</div>` +
    `<div class="hk-party__chips" style="align-items:center">${chips}${own && mode === 'player' ? `<span style="flex:1 1 auto"></span><a href="#" class="hk-btn hk-btn--brass" style="height:30px"><i-icon name="crossed-swords" size="14"></i-icon>Open my sheet</a>` : ''}</div>` +
    fx + `</article>`;
}

// ----- Ukrainian party data for the phone cards -----
const UK = {
  ilyana: { mono: 'ІВ', name: 'Іляна Ворн', cls: 'Людина · Паладин 5', player: 'Міра', conc: 'Концентрація: Благословення, раунд 3', conds: [['poison-bottle', 'Отруєний', '3 раунди', 'Отруєний, залишилось 3 раунди, від Гігантського павука']] },
  bramble: { mono: 'БА', name: 'Брембл Андерфут', cls: 'Півмірок · Пройдисвіт 3', player: 'Тарас', conc: '', conds: [['invisible', 'Невидимий', '1 хв', 'Невидимий, залишилась 1 хвилина']] },
  maren: { mono: 'СМ', name: 'Сестра Марен', cls: 'Людина · Клірик 4', player: 'Олена', conc: 'Концентрація: Утримання особи, раунд 2', conds: [] },
  thorne: { mono: 'ТЕ', name: 'Торн Ешвейл', cls: 'Ельф · Слідопит 4', player: 'Марко', conc: 'Концентрація: Мітка мисливця, раунд 3', conds: [] },
  oskar: { mono: 'ОБ', name: 'Оскар Беллоу', cls: 'Дварф · Воїн 5', player: 'Петро', conc: '', conds: [['knocked-out-stars', 'Непритомний', '', 'Непритомний: 0 очок здоров’я']] },
  guard: { mono: 'КВ', name: 'Капітан варти', cls: 'Людина · Воїн 3', player: '', conc: '', conds: [] },
};
// <x-pcardp id mode="dm|player" own sel open locked tilt> — the 390 px card (uk)
function pcardPhoneHtml(o) {
  const d = PARTY[o.id], u = UK[o.id];
  if (!d || !u) throw new Error('party ' + o.id);
  const mode = o.mode || 'dm';
  const own = o.own === '1', sel = o.sel === '1';
  let who;
  if (d.pregen) who = `заготовка · <span style="color:var(--text-3)">не заявлено</span>`;
  else if (own) who = `<span style="color:var(--success-strong)">ви</span>`;
  else who = `грає ${u.player}${d.online ? '' : ' · <span style="color:var(--text-3)">офлайн</span>'}`;
  const conc = u.conc ? `<span class="hk-chip hk-chip--arcane${o.tip === '1' ? ' hk-has-tip haloP' : ''}" ${o.tip === '1' ? 'tabindex="0" aria-describedby="tipOrbP" ' : ''}style="height:32px;min-width:32px;justify-content:center;padding:0 7px;flex:0 0 auto" title="${esc(u.conc)}"><i-icon name="concentration-orb" size="14" hint="${esc(u.conc)}"></i-icon>${o.tip === '1' ? `<span class="hk-tip" id="tipOrbP" role="tooltip" style="font-size:15px;left:0;transform:none">${u.conc.split(',')[0]}<span class="hk-tip__sub">раунд 3 · утримуйте, щоб побачити</span></span>` : ''}</span>` : '';
  const pp = `<span class="hk-chip" style="height:22px;padding:0 6px" title="Пасивне сприйняття ${d.pp}"><i-icon name="eye" size="12" hint="Пасивне сприйняття ${d.pp}"></i-icon>${d.pp}</span>`;
  const insp = d.insp ? `<span class="hk-chip hk-chip--selected" style="height:22px;padding:0 6px" title="Героїчне натхнення є"><i-icon name="inspiration" size="12" hint="Героїчне натхнення є"></i-icon>1</span>` : '';
  const hpPct = f(d.hp / (d.max + d.temp) * 100), tPct = f(d.temp / (d.max + d.temp) * 100);
  const hpNum = `<span class="hk-num" style="font-size:24px;color:${d.dying ? 'var(--danger-on-leather)' : 'var(--text-on-leather)'}">${d.hp} <span style="font-size:15px;color:var(--brass)">/ ${d.max}</span></span>`;
  const gaugeLabel = d.dying ? `0 з ${d.max} очок здоров’я, рятівні кидки від смерті: 1 успіх, 1 провал` : `${d.hp} з ${d.max} очок здоров’я${d.temp ? ', плюс ' + d.temp + ' тимчасових' : ''}`;
  const right = d.temp ? `<span class="hk-strap__label" title="${d.temp} тимчасових ОЗ"><i-icon name="heart-armor" size="14"></i-icon>+${d.temp}</span>` : (d.dying ? `<span style="display:inline-flex;gap:2px;align-items:center" role="img" aria-label="Рятівні кидки від смерті: 1 успіх, 1 провал" title="Рятівні кидки від смерті: 1 успіх, 1 провал"><span class="hk-ring__i hk-ring__i--marked" style="width:14px;height:14px"></span><span class="hk-ring__i" style="width:14px;height:14px"></span><span class="hk-ring__i" style="width:14px;height:14px"></span><span style="width:4px"></span><span class="hk-ring__i hk-ring__i--f hk-ring__i--marked" style="width:14px;height:14px"></span><span class="hk-ring__i hk-ring__i--f" style="width:14px;height:14px"></span><span class="hk-ring__i hk-ring__i--f" style="width:14px;height:14px"></span></span>` : '');
  let chips = '';
  for (const [ic, nm, dur, hint] of u.conds) {
    if (o.open === '1' && nm === 'Отруєний') {
      chips += `<span class="hk-cond hk-cond--open" style="font-size:15px;width:100%"><button class="hk-cond__main" type="button" aria-expanded="true" title="${esc(hint)}" style="height:44px"><i-icon name="${ic}" size="15"></i-icon>${nm}<span class="hk-cond__dur" style="height:20px">${dur}</span></button><span class="hk-hint" style="color:var(--danger-strong);margin-left:4px;font-size:14px">від Гігантського павука</span><div class="hk-cond__edit"><button class="hk-ico hk-ico--s" type="button" aria-label="На раунд менше" title="−1 раунд" style="width:44px;height:44px"><i-icon name="minus" size="14"></i-icon></button><span class="hk-num" style="font-size:20px">3</span><button class="hk-ico hk-ico--s" type="button" aria-label="На раунд більше" title="+1 раунд" style="width:44px;height:44px"><i-icon name="plus" size="14"></i-icon></button><span style="flex:1 1 8px"></span><button class="hk-btn hk-btn--phone hk-btn--ember" type="button" style="padding:0 12px"><i-icon name="cross-mark" size="12"></i-icon>Завершити</button></div></span>`;
    } else if (o.locked === '1' && nm === 'Отруєний') {
      chips += `<span class="hk-cond hk-has-tip haloP" style="height:32px;padding:0 9px;font-size:15px" tabindex="0" aria-describedby="tipLockP" title="Отруєний, 3 раунди · керує ваш майстер"><i-icon name="${ic}" size="15"></i-icon>${nm}<span class="hk-cond__dur" style="height:20px">${dur}</span><i-icon name="padlock" size="13" hint="Керує ваш майстер"></i-icon><span class="hk-tip" id="tipLockP" role="tooltip" style="font-size:15px;left:0;transform:none">Керує ваш майстер<span class="hk-tip__sub">правило «Гравці керують своїми станами» вимкнено</span></span></span>`;
    } else {
      const end = (mode === 'dm' || own) ? `<button class="hk-x" type="button" aria-label="Завершити: ${nm}" title="Завершити" style="width:40px;height:36px"><span class="hk-x__i" style="width:20px;height:20px"><i-icon name="cross-mark" size="10"></i-icon></span></button>` : '';
      chips += `<span class="hk-cond" style="height:36px;padding:0 ${end ? '0' : '9px'} 0 9px;font-size:15px" title="${esc(hint)}"><i-icon name="${ic}" size="15"></i-icon>${nm}${dur ? `<span class="hk-cond__dur" style="height:20px">${dur}</span>` : ''}${end}</span>`;
    }
  }
  if (d.pregen) chips += `<span class="hk-chip" style="height:32px;font-size:15px" title="Заготовка: жоден гравець ще не заявив права"><i-icon name="padlock" size="13"></i-icon>заготовка</span>`;
  if (!u.conds.length && !d.pregen) chips += `<span class="hk-hint" style="display:inline-flex;align-items:center;height:32px;font-size:14px">станів немає</span>`;
  if (mode === 'dm' && sel) chips += `<span class="hk-chip hk-chip--selected" style="height:32px;font-size:15px"><i-icon name="check-mark" size="13"></i-icon>обрано</span>`;
  if (mode === 'dm' && d.pregen) chips += `<button class="hk-btn hk-btn--phone hk-btn--leather" type="button" style="height:36px;font-size:15px"><i-icon name="shaking-hands" size="15"></i-icon>Передати…</button>`;
  if (mode === 'player' && own) chips += `<span style="flex:1 1 auto"></span><a href="#" class="hk-btn hk-btn--phone hk-btn--brass" style="height:40px"><i-icon name="crossed-swords" size="15"></i-icon>Мій лист</a>`;
  const view = (mode === 'player' && !own && o.sheets === 'full') ? `<button class="hk-ico hk-ico--leaf hk-ico--phone" type="button" aria-label="Переглянути лист: ${u.name}" title="Переглянути лист"><i-icon name="open-book" size="18"></i-icon></button>` : '';
  const ownPlate = own ? `<span class="hk-plate" style="height:22px;font-size:14px;font-family:var(--font-body);font-weight:600;flex:0 0 auto" title="Це ваш герой">ваш герой</span>` : '';
  return `<article class="cardP${sel ? ' psel' : ''}" aria-labelledby="pp-${o.id}" style="transform:rotate(${o.tilt || '-.2deg'})">` + texSvg('paper') +
    monoFrame(u.mono, 44, 50, 19, `Портрет, монограма ${u.mono}`) +
    `<div style="display:flex;flex-direction:column;gap:3px;min-width:0"><h3 id="pp-${o.id}" style="margin:0;font:19px/1.1 Forum,serif;font-weight:400;display:flex;align-items:center;gap:6px"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.name}</span>${conc}${ownPlate}</h3><span style="font-size:14px;color:var(--text-2)">${u.cls} · ${who}</span><span style="display:flex;gap:5px">${pp}${insp}</span></div>` +
    `<div style="display:flex;flex-direction:column;align-items:center;gap:4px">${shieldSvg(d.ac, 40, 'Клас броні ' + d.ac)}${view}</div>` +
    `<div class="cardP__w hk-strap" style="display:grid;grid-template-columns:auto minmax(0,1fr)${right ? ' auto' : ''};gap:8px;align-items:center;padding:5px 10px">${texSvg('leather')}${hpNum}<div class="hk-gauge" role="img" aria-label="${gaugeLabel}"><div class="hk-gauge__hp" style="width:${hpPct}%"></div>${d.temp ? `<div class="hk-gauge__temp" style="width:${tPct}%"></div>` : ''}</div>${right}</div>` +
    `<div class="cardP__w" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${chips}</div></article>`;
}
// <x-enc lang="uk|en" state="live|none" ctl="1|0" tip="1"> — the encounter strip (phone / tablet)
function encHtml(o) {
  const uk = (o.lang || 'uk') === 'uk';
  const live = (o.state || 'live') === 'live';
  const ctl = o.ctl !== '0';
  const title = live ? (uk ? 'Сутичка 2 · Раунд 3' : 'Encounter 2 · Round 3') : (uk ? 'Немає сутички' : 'No encounter');
  const sub = live ? (uk ? '1 год 12 хв · 4 онлайн' : '1 h 12 min · 4 online') : (uk ? 'сесія триває · 1 год 12 хв' : 'session live · 1 h 12 min');
  let row2;
  if (!ctl) row2 = `<span class="hk-hint" style="color:var(--text-on-leather-3);font-size:14px">${uk ? 'раунди та сутички веде майстер' : 'the DM runs rounds and encounters'}</span>`;
  else if (live) row2 = `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px"><button class="hk-btn hk-btn--phone hk-btn--brass" type="button" title="${uk ? 'Раунд 3 → 4: усі тривалості в раундах −1 для всіх' : 'Round 3 → 4: every round-based duration −1 for everyone'}" style="justify-content:center"><i-icon name="sands-of-time" size="18"></i-icon>${uk ? 'Наступний раунд' : 'Advance round'}</button><button class="hk-btn hk-btn--phone hk-btn--ghost-leather${o.tip === '1' ? ' hk-has-tip' : ''}" type="button"${o.tip === '1' ? ' aria-describedby="tipEnc"' : ''} title="${uk ? 'Завершує бій; тривалості продовжують спливати' : 'Ends the fight; durations keep running'}" style="padding:0 12px"><i-icon name="level-end-flag" size="18"></i-icon>${uk ? 'Завершити сутичку' : 'End encounter'}${o.tip === '1' ? `<span class="hk-tip hk-tip--above hk-tip--left" id="tipEnc" role="tooltip" style="font-size:15px">${uk ? 'Завершує бій; тривалості продовжують спливати' : 'Ends the fight; durations keep running'}</span>` : ''}</button></div>`;
  else row2 = `<button class="hk-btn hk-btn--phone hk-btn--brass" type="button" style="justify-content:center" title="${uk ? 'Починає сутичку 3 з раунду 1' : 'Begins encounter 3 at round 1'}"><i-icon name="crossed-swords" size="18"></i-icon>${uk ? 'Почати сутичку' : 'Start encounter'}</button>`;
  return `<section class="hk-strap" aria-label="${uk ? 'Сутичка' : 'Encounter'}" style="display:flex;flex-direction:column;gap:8px;padding:8px 10px 10px 12px">` + texSvg('leather', 'border-radius:4px') +
    `<div style="display:flex;align-items:center;gap:8px;min-width:0"><span style="display:flex;align-items:center;gap:6px;font-family:var(--font-display);font-size:19px;color:${live ? 'var(--text-on-leather)' : 'var(--text-on-leather-3)'};white-space:nowrap"><i-icon name="${live ? 'crossed-swords' : 'candle-flame'}" size="17" style="color:var(--danger-on-leather)"></i-icon>${title}</span><span style="flex:1 1 auto"></span><span style="font-size:14px;color:var(--text-on-leather-2);white-space:nowrap">${sub}</span></div>${row2}</section>`;
}
// <x-pstrap kind="dm|player|list|join|link|sheet" label="..."> — the phone action strap (uk)
function pstrapHtml(o) {
  const kind = o.kind || 'dm';
  let row;
  const tile = (c, ic, lb, t) => `<button class="actP ${c}" type="button" title="${esc(t || lb)}"><i-icon name="${ic}" size="20"></i-icon>${lb}</button>`;
  if (kind === 'dm') row = `<div class="hk-astrap__row hk-astrap__row--phone" style="padding:4px 10px 6px">${tile('hk-act--ember', 'broken-heart', 'Шкода', 'Шкода: обраний герой')}${tile('hk-act--moss', 'healing', 'Лікування', 'Лікування: обраний герой')}${tile('hk-act--leather', 'skull', 'Стан', 'Стан: обраний герой')}${tile('hk-act--leather', 'laurels', 'Досвід', 'Досвід: обраний герой')}<button class="actP hk-act--leather" type="button" aria-label="Ще: предмет, сесія, експорт" title="Ще"><i-icon name="hamburger-menu" size="20"></i-icon>Ще</button></div>`;
  else if (kind === 'player') row = `<div class="hk-astrap__row hk-astrap__row--phone" style="padding:4px 10px 6px;grid-template-columns:repeat(3,minmax(0,1fr))">${tile('hk-act--brass', 'crossed-swords', 'Мій лист', 'Відкрити лист Іляни Ворн')}${tile('hk-act--leather', 'dice-twenty-faces-twenty', 'Кинути', 'Кинути кубики на стіл')}<button class="actP hk-act--leather" type="button" aria-label="Ще: покинути кампанію" title="Ще"><i-icon name="hamburger-menu" size="20"></i-icon>Ще</button></div>`;
  else if (kind === 'list') row = `<div style="position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:6px 10px 8px"><button class="hk-btn hk-btn--phone hk-btn--brass" type="button" style="justify-content:center"><i-icon name="plus" size="18"></i-icon>Нова кампанія</button><button class="hk-btn hk-btn--phone hk-btn--leather" type="button" style="justify-content:center"><i-icon name="entry-door" size="18"></i-icon>Приєднатися</button></div>`;
  else if (kind === 'join') row = `<div style="position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;padding:6px 10px 8px;align-items:center"><a class="hk-btn hk-btn--phone hk-btn--leather" href="#" style="padding:0 14px 0 10px"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Назад</a><button class="hk-btn hk-btn--phone hk-btn--brass" type="button" style="justify-content:center"><i-icon name="entry-door" size="18"></i-icon>Приєднатися</button></div>`;
  else if (kind === 'link') row = `<div style="position:relative;display:grid;grid-template-columns:auto auto minmax(0,1fr);gap:8px;padding:6px 10px 8px;align-items:center"><a class="hk-ico hk-ico--phone" href="#" aria-label="Назад" title="Назад"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></a><a class="hk-btn hk-btn--phone hk-btn--ghost-leather" href="#" title="Приєднатися без героя; прив'язати можна пізніше з вкладки «Гурт»" style="padding:0 12px">Пропустити</a><button class="hk-btn hk-btn--phone hk-btn--brass" type="button" style="justify-content:center;min-width:0"><i-icon name="wax-seal" size="18"></i-icon>${o.label || 'Прив’язати'}</button></div>`;
  else if (kind === 'sheet') row = `<div style="position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;padding:6px 10px 8px;align-items:center"><button class="hk-btn hk-btn--phone hk-btn--leather" type="button"><i-icon name="cross-mark" size="14"></i-icon>Закрити</button><button class="hk-btn hk-btn--phone hk-btn--brass" type="button" style="justify-content:center" title="Змінити значення в листі як майстер: потрібна причина, запис потрапляє в хроніку Іляни з вашим ім'ям"><i-icon name="quill" size="18"></i-icon>Перевизначити</button></div>`;
  else if (kind === 'sheetconfirm') row = `<div style="position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;padding:6px 10px 8px;align-items:center"><button class="hk-btn hk-btn--phone hk-btn--ghost-leather" type="button">Скасувати</button><button class="hk-btn hk-btn--phone ${o.cls || 'hk-btn--brass'}" type="button" style="justify-content:center">${o.icon ? `<i-icon name="${o.icon}" size="16"></i-icon>` : ''}${o.label || ''}</button></div>`;
  return `<div class="hk-astrap" aria-label="Дії" style="z-index:3;flex:0 0 auto">` + texSvg('leather') + `<div class="hk-rivets"></div>${row}</div>`;
}

function expand(src) {
  const used = new Set();
  let out = src;
  out = out.replace(/<x-pcardp([^>]*)><\/x-pcardp>/g, (_, a) => pcardPhoneHtml(attrs(a)));
  out = out.replace(/<x-pcard([^>]*)><\/x-pcard>/g, (_, a) => pcardHtml(attrs(a)));
  out = out.replace(/<x-enc([^>]*)><\/x-enc>/g, (_, a) => encHtml(attrs(a)));
  out = out.replace(/<x-pstrap([^>]*)><\/x-pstrap>/g, (_, a) => pstrapHtml(attrs(a)));
  out = out.replace(/<x-rail([^>]*)><\/x-rail>/g, (_, a) => railHtml(attrs(a)));
  out = out.replace(/<x-chead([^>]*)><\/x-chead>/g, (_, a) => cheadHtml(attrs(a)));
  out = out.replace(/<x-strap([^>]*)><\/x-strap>/g, (_, a) => strapHtml(attrs(a)));
  out = out.replace(/<x-topbar([^>]*)><\/x-topbar>/g, (_, a) => topbarHtml(attrs(a)));
  out = out.replace(/<x-tabbar([^>]*)><\/x-tabbar>/g, (_, a) => tabbarHtml(attrs(a)));
  out = out.replace(/<x-defs><\/x-defs>/g, () => defsSvg());
  out = out.replace(/<x-qr([^>]*)><\/x-qr>/g, (_, a) => { const o = attrs(a); return qrSvg(+(o.size || 200), +(o.seed || 7)); });
  out = out.replace(/<x-shield([^>]*)><\/x-shield>/g, (_, a) => { const o = attrs(a); return shieldSvg(o.ac, +(o.w || 40), o.label); });
  out = out.replace(/<x-mono([^>]*)><\/x-mono>/g, (_, a) => { const o = attrs(a); return monoFrame(o.text, +(o.w || 50), +(o.h || 56), +(o.fs || 22), o.label, o.class, o.style); });
  out = out.replace(/<i-icon([^>]*)><\/i-icon>/g, (_, a) => { const o = attrs(a); used.add(o.name); return iconSvg(o.name, o.size || 24, o.label, o.class, o.style, o.hint); });
  out = out.replace(/<x-seal([^>]*)><\/x-seal>/g, (_, a) => { const o = attrs(a); if (o.icon) used.add(o.icon); return sealSvg(o.state || 'full', o.icon, o.text, +(o.size || 28), o.label, +(o.seed || 0), o.class, o.style, +(o.fs || 0), o.hint); });
  out = out.replace(/<x-tex([^>]*)><\/x-tex>/g, (_, a) => { const o = attrs(a); return texSvg(o.kind, o.style); });
  return { out, used };
}

function check(fullHtml, name) {
  const html = fullHtml.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/, '');
  const bad = ['{{', '}}', '<sc-for', '<sc-if', '<dc-import', '<iframe', '<object', '<embed', 'data:', '<i-icon', '<x-seal', '<x-tex', '<x-rail', '<x-chead', '<x-strap', '<x-defs', '<x-qr', '<x-shield', '<x-mono', '<x-topbar', '<x-tabbar', '<x-pcard', '<x-enc', '<x-pstrap', '__CSS__', '__PREVIEW__'];
  for (const b of bad) if (html.includes(b)) throw new Error(name + ' contains forbidden token ' + b);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  if (emoji.test(html)) throw new Error(name + ' contains emoji');
  const links = (html.match(/<link /g) || []).length;
  if (links !== 1) throw new Error(name + ' must have exactly one <link>, has ' + links);
}

const DS = path.join(__dirname, '..', '..', '..', 'ds');
const css = fs.readFileSync(path.join(DS, 'check', 'tokens.css'), 'utf8') + '\n' + fs.readFileSync(path.join(DS, 'project', 'components', 'bundle.css'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'extras.css'), 'utf8');
if (css.includes('{{') || css.includes('}}')) throw new Error('css contains braces pairs');

let heights = {};
try { heights = JSON.parse(fs.readFileSync(path.join(__dirname, 'heights.json'), 'utf8')); } catch (e) {}
const srcs = fs.readdirSync(__dirname).filter((n) => n.endsWith('.src.html')).sort();
const report = [];
for (const srcName of srcs) {
  const outName = srcName.replace('.src.html', '.dc.html');
  const id = srcName.replace('.src.html', '');
  const phone = /Phone/.test(id), tablet = /Tablet/.test(id);
  const pv = phone ? '{"width":390,"height":844}' : tablet ? '{"width":768,"height":1024}' : `{"width":1440,"height":${heights[id] || 1100}}`;
  const src = fs.readFileSync(path.join(__dirname, srcName), 'utf8');
  const { out, used } = expand(src);
  const html = out.replace('__CSS__', css).replace('__PREVIEW__', pv);
  check(html, outName);
  fs.writeFileSync(path.join(__dirname, outName), html);
  report.push(`${outName} ${(html.length / 1024).toFixed(0)} KB, icons ${used.size}, preview ${pv}`);
}
console.log(report.join('\n'));
