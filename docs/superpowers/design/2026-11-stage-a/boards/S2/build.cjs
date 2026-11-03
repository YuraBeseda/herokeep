// build.cjs — expands the authoring macros of S2's *.src.html into literal static markup (same approach as A2).
//   <i-icon name="heart" size="24" label="..." hint="..." class="" style=""></i-icon>  -> inline game-icons SVG
//   <x-seal state="full|spent" icon="fleur-de-lys" text="+3" size="28" label="..."></x-seal> -> wax seal SVG
//   <x-tex kind="wood|paper|leather" style=""></x-tex>  -> procedural feTurbulence texture overlay
//   <x-part name="folio" key="value"...></x-part>        -> a shared chrome partial from parts.cjs
//   <x-dlg title="" icon="" style="" id="" role=""> ... </x-dlg>   -> parchment dialog shell (hk-dialog)
//   <x-drawer title="" icon="" style="" id=""> ... </x-drawer>   -> right-side description/notes/roll-log drawer (hk-drawer)
//   __CSS__ in the helmet -> tokens.css (tavern + base) + bundle.css (minus body/stage rules) + shared.css
// The output never contains template syntax; the script asserts that.
const fs = require('fs');
const path = require('path');
const icons = require('../../icons.json');
const parts = require('./parts.cjs');

const SCRATCH = path.join(__dirname, '..', '..', '..');
const GI = path.join(SCRATCH, 'gi', 'icons');

function loadGi(name) {
  if (icons[name]) return icons[name];
  const authors = fs.readdirSync(GI);
  for (const author of authors) {
    const p = path.join(GI, author, name + '.svg');
    if (!fs.existsSync(p)) continue;
    const svg = fs.readFileSync(p, 'utf8');
    let inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    inner = inner.replace(/<path[^>]*d="M0 0h512v512H0z"[^>]*\/>/g, '');
    inner = inner.replace(/\s*fill="#[0-9a-fA-F]{3,6}"/g, '').replace(/\s*fill="(black|white)"/g, '');
    inner = inner.replace(/<path /g, '<path fill="currentColor" ');
    icons[name] = { author, body: inner.trim() };
    return icons[name];
  }
  throw new Error('unknown icon ' + name);
}

let uid = 0;
const f = (n) => Math.round(n * 100) / 100;

function iconSvg(name, size, label, cls, style, hint) {
  const ic = loadGi(name);
  let body = ic.body;
  let vb = '0 0 512 512';
  if (body.startsWith('<circle')) {
    body = body.replace(/<circle[^>]*\/>/g, '');
    vb = '20 20 216 216';
  }
  const lab = label || hint;
  const a11y = lab ? `role="img" aria-label="${lab}"` : 'aria-hidden="true"';
  const c = cls ? ` class="${cls}"` : '';
  const s = style ? ` style="${style}"` : '';
  const t = hint ? `<title>${hint}</title>` : '';
  return `<svg viewBox="${vb}" width="${size}" height="${size}" ${a11y}${c}${s}>${t}${body}</svg>`;
}

function iconGroup(name, color, x, y, scale) {
  const ic = loadGi(name);
  let body = ic.body;
  let shift = 0;
  if (body.startsWith('<circle')) {
    body = body.replace(/<circle[^>]*\/>/g, '');
    shift = 128;
    scale = scale * 2;
  }
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
    if (text) {
      inner += `<text x="32" y="32.4" text-anchor="middle" dominant-baseline="central" font-family="Forum, serif" font-size="${fsOverride || (big ? 23 : 18)}" fill="#8C7A5A">${text}</text>`;
    } else if (icon) {
      inner += iconGroup(icon, '#C5B48D', 32, 32, big ? 0.075 : 0.058);
    }
  }
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" ${a11y}${c}${s}>${t}${inner}</svg>`;
}

function texSvg(kind, style) {
  const id = 'tx' + (++uid);
  let filt;
  if (kind === 'wood') {
    filt = `<feTurbulence type="fractalNoise" baseFrequency="0.0022 0.055" numOctaves="5" seed="9" result="n"/><feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.32  0 0 0 0 0.15  0 0 0 1.7 -0.55"/>`;
  } else if (kind === 'paper') {
    filt = `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3"/><feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.32  0 0 0 0 0.19  0 0 0 0.075 0"/>`;
  } else if (kind === 'leather') {
    filt = `<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="5"/><feColorMatrix type="matrix" values="0 0 0 0 0.09  0 0 0 0 0.05  0 0 0 0 0.03  0 0 0 0.32 0"/>`;
  } else throw new Error('tex ' + kind);
  const s = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;${style || ''}`;
  return `<svg aria-hidden="true" style="${s}"><filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${filt}</filter><rect width="100%" height="100%" filter="url(#${id})"/></svg>`;
}

function attrs(s) {
  const o = {};
  const re = /([a-zA-Z0-9-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = m[2];
  return o;
}

function dialogOpen(o) {
  const role = o.role || 'dialog';
  const id = o.id || ('dlg' + (++uid));
  const w = o.width ? `width:${o.width};` : '';
  const desc = o.desc ? ` aria-describedby="${o.desc}"` : '';
  const close = o.noclose ? '' : `<button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="${o.closelabel || 'Close'}" title="${o.closelabel || 'Close'} (Esc)"><i-icon name="cross-mark" size="12"></i-icon></button>`;
  const seal = `<x-seal state="full" icon="${o.icon || 'wax-seal'}" size="36" seed="${o.seed || 3}"></x-seal>`;
  return `<div class="hk-dialog" role="${role}" aria-modal="true" aria-labelledby="${id}T"${desc} style="${w}${o.style || ''}"><x-tex kind="paper"></x-tex><div class="hk-dialog__head">${seal}<h2 class="hk-dialog__title" id="${id}T">${o.title}</h2>${close}</div>`;
}

function drawerOpen(o) {
  const id = o.id || ('drw' + (++uid));
  return `<aside class="hk-drawer drawer" role="dialog" aria-modal="false" aria-labelledby="${id}T" style="${o.style || ''}"><x-tex kind="paper"></x-tex><div class="hk-drawer__head"><i-icon name="${o.icon || 'scroll-unfurled'}" size="24" style="color:#8A6A2A;margin-top:3px"></i-icon><h2 class="hk-drawer__title" id="${id}T">${o.title}</h2><button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="${o.closelabel || 'Close'}" title="${o.closelabel || 'Close'} (Esc)"><i-icon name="cross-mark" size="12"></i-icon></button></div>`;
}

function sharedCss() {
  const tokens = fs.readFileSync(path.join(SCRATCH, 'ds', 'check', 'tokens.css'), 'utf8').split('\n');
  let keep = [], mode = 'keep';
  for (const line of tokens) {
    if (/^\[data-theme="(scroll|plain)"\]/.test(line)) mode = 'skip';
    else if (/^:root \{/.test(line) || /^\.[a-z]/.test(line)) mode = 'keep';
    if (mode === 'keep') keep.push(line);
  }
  const bundle = fs.readFileSync(path.join(SCRATCH, 'ds', 'project', 'components', 'bundle.css'), 'utf8').split('\n')
    .filter((l) => !/^body \{/.test(l) && !/^\.hk-stage/.test(l) && !/^\[data-theme/.test(l) && !/^\/\*/.test(l) && l.trim() !== '');
  const shared = fs.readFileSync(path.join(__dirname, 'shared.css'), 'utf8');
  // the canvas forbids "}}" anywhere in the markup; nested CSS blocks are rewritten as "} }"
  return (keep.join('\n') + '\n' + bundle.join('\n') + '\n' + shared).replace(/\}\}/g, '} }').replace(/\}\}/g, '} }');
}

function expand(src) {
  const used = new Set();
  let out = src;
  // partials first (they may contain macros)
  for (let i = 0; i < 4; i++) {
    out = out.replace(/<x-part([^>]*)><\/x-part>/g, (_, a) => {
      const o = attrs(a);
      const fn = parts[o.name];
      if (!fn) throw new Error('unknown part ' + o.name);
      return fn(o);
    });
  }
  out = out.replace(/<x-dlg([^>]*)>/g, (_, a) => dialogOpen(attrs(a))).replace(/<\/x-dlg>/g, '</div>');
  out = out.replace(/<x-drawer([^>]*)>/g, (_, a) => drawerOpen(attrs(a))).replace(/<\/x-drawer>/g, '</aside>');
  out = out.replace(/<i-icon([^>]*)><\/i-icon>/g, (_, a) => {
    const o = attrs(a);
    used.add(o.name);
    return iconSvg(o.name, o.size || 24, o.label, o.class, o.style, o.hint);
  });
  out = out.replace(/<x-seal([^>]*)><\/x-seal>/g, (_, a) => {
    const o = attrs(a);
    if (o.icon) used.add(o.icon);
    return sealSvg(o.state || 'full', o.icon, o.text, +(o.size || 28), o.label, +(o.seed || 0), o.class, o.style, +(o.fs || 0), o.hint);
  });
  out = out.replace(/<x-tex([^>]*)><\/x-tex>/g, (_, a) => {
    const o = attrs(a);
    return texSvg(o.kind, o.style);
  });
  out = out.replace('__CSS__', sharedCss());
  return { out, used };
}

function check(fullHtml, name) {
  const html = fullHtml.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/, '');
  const bad = ['{{', '}}', '<sc-for', '<sc-if', '<dc-import', '<iframe', '<object', '<embed', 'data:', '<i-icon', '<x-seal', '<x-tex', '<x-part', '<x-dlg', '<x-drawer', '__CSS__', '__PREVIEW__'];
  for (const b of bad) if (html.includes(b)) throw new Error(name + ' contains forbidden token ' + b);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  if (emoji.test(html)) throw new Error(name + ' contains emoji');
}

const dir = __dirname;
let heights = {};
try { heights = JSON.parse(fs.readFileSync(path.join(dir, 'heights.json'), 'utf8')); } catch (e) {}
const only = process.argv[2];
const files = fs.readdirSync(dir).filter((n) => n.endsWith('.src.html')).sort();
for (const srcName of files) {
  if (only && !srcName.startsWith(only)) continue;
  const outName = srcName.replace('.src.html', '.dc.html');
  const phone = /-Phone\.src\.html$/.test(srcName);
  const pv = phone ? '{"width":390,"height":844}' : `{"width":1440,"height":${heights[outName] || 1100}}`;
  const src = fs.readFileSync(path.join(dir, srcName), 'utf8');
  const { out, used } = expand(src);
  const html = out.replace('__PREVIEW__', pv);
  check(html, outName);
  fs.writeFileSync(path.join(dir, outName), html);
  console.log(outName, (html.length / 1024).toFixed(0) + ' KB', 'icons:', used.size, 'preview:', pv);
}
