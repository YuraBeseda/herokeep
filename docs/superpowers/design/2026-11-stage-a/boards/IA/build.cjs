// build.cjs — expands the authoring macros in *.src.html into literal, static markup (same expander as out/A).
//   <i-icon name="heart" size="24" label="..." class="" style=""></i-icon>  -> inline game-icons SVG
//   <x-seal state="full|spent" icon="fleur-de-lys" text="+3" size="28" label="..."></x-seal> -> wax seal SVG
//   <x-tex kind="wood|paper|leather" style=""></x-tex>  -> procedural feTurbulence texture overlay
//   __CSS__ -> shared.css (the concept-A classes), __PREVIEW__ -> the frame size
// Output never contains template syntax; the script asserts that.
const fs = require('fs');
const path = require('path');
const icons = require('../../icons.json');

let uid = 0;
const f = (n) => Math.round(n * 100) / 100;

function iconSvg(name, size, label, cls, style, extra) {
  const ic = icons[name];
  if (!ic) throw new Error('unknown icon ' + name);
  let body = ic.body;
  let vb = '0 0 512 512';
  if (body.startsWith('<circle')) {
    body = body.replace(/<circle[^>]*\/>/g, '');
    vb = '20 20 216 216';
  }
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  const c = cls ? ` class="${cls}"` : '';
  const s = style ? ` style="${style}"` : '';
  return `<svg viewBox="${vb}" width="${size}" height="${size}" ${a11y}${c}${s}${extra || ''}>${body}</svg>`;
}

function iconGroup(name, color, x, y, scale) {
  const ic = icons[name];
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

function sealSvg(state, icon, text, size, label, seed, cls, style) {
  const id = 'sg' + (++uid);
  const sd = seed || (uid % 7);
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  const c = cls ? ` class="${cls}"` : '';
  const s = style ? ` style="${style}"` : '';
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
      const fs2 = big ? 23 : 18;
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
    if (text) {
      inner += `<text x="32" y="32.4" text-anchor="middle" dominant-baseline="central" font-family="Forum, serif" font-size="${big ? 23 : 18}" fill="#6E5A3C">${text}</text>`;
    } else if (icon) {
      inner += iconGroup(icon, '#C5B48D', 32, 32, big ? 0.075 : 0.058);
    }
  }
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" ${a11y}${c}${s}>${inner}</svg>`;
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

function expand(src) {
  const used = new Set();
  let out = src.replace(/<i-icon([^>]*)><\/i-icon>/g, (_, a) => {
    const o = attrs(a);
    used.add(o.name);
    return iconSvg(o.name, o.size || 24, o.label, o.class, o.style);
  });
  out = out.replace(/<x-seal([^>]*)><\/x-seal>/g, (_, a) => {
    const o = attrs(a);
    if (o.icon) used.add(o.icon);
    return sealSvg(o.state || 'full', o.icon, o.text, +(o.size || 28), o.label, +(o.seed || 0), o.class, o.style);
  });
  out = out.replace(/<x-tex([^>]*)><\/x-tex>/g, (_, a) => {
    const o = attrs(a);
    return texSvg(o.kind, o.style);
  });
  return { out, used };
}

function check(fullHtml, name) {
  const html = fullHtml.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/, '');
  const bad = ['{{', '}}', '<sc-for', '<sc-if', '<dc-import', '<iframe', '<object', '<embed', 'data:', '<i-icon', '<x-seal', '<x-tex', '__CSS__', '__PREVIEW__', '__HOME_BODY__'];
  for (const b of bad) if (html.includes(b)) throw new Error(name + ' contains forbidden token ' + b);
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  if (emoji.test(html)) throw new Error(name + ' contains emoji');
  const links = (html.match(/<link /g) || []).length;
  if (links !== 1) throw new Error(name + ' must have exactly one <link>, has ' + links);
}

const dir = __dirname;
const css = fs.readFileSync(path.join(dir, 'shared.css'), 'utf8').trim();
let hh = 1100;
try { hh = parseInt(fs.readFileSync(path.join(dir, 'home-height.txt'), 'utf8').trim(), 10) || 1100; } catch (e) {}
const boards = [
  ['IA-NavMap', '{"width":1440,"height":980}'],
  ['IA-Home-Desktop', `{"width":1440,"height":${hh}}`],
  ['IA-Home-Phone', '{"width":390,"height":844}'],
  ['IA-Phone-Drawer', '{"width":390,"height":844}'],
  ['IA-Sheet-Tablet', '{"width":768,"height":1024}'],
  ['IA-ActionStrap', '{"width":1440,"height":760}'],
];
const only = process.argv[2];
for (const [name, pv] of boards) {
  if (only && name !== only) continue;
  const p = path.join(dir, name + '.src.html');
  if (!fs.existsSync(p)) { console.log(name, 'no source yet'); continue; }
  let src = fs.readFileSync(p, 'utf8');
  if (src.includes('__HOME_BODY__')) {
    // The drawer board shows the phone Home behind the flap: include its root content literally.
    const home = fs.readFileSync(path.join(dir, 'IA-Home-Phone.src.html'), 'utf8');
    const m = home.match(/<!-- home:start -->([\s\S]*?)<!-- home:end -->/);
    if (!m) throw new Error('home markers missing');
    src = src.replace('__HOME_BODY__', m[1]);
  }
  const { out, used } = expand(src);
  const html = out.replace('__CSS__', css).replace('__PREVIEW__', pv);
  check(html, name);
  fs.writeFileSync(path.join(dir, name + '.dc.html'), html);
  console.log(name + '.dc.html', (html.length / 1024).toFixed(0) + ' KB', 'icons used:', used.size);
}
