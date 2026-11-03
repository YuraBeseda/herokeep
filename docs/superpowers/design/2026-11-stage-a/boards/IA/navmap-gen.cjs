// navmap-gen.cjs — writes IA-NavMap.src.html: a canvas diagram of separate placed elements
// (background bands first, then every arrow, then cards, then labels), arrows computed from card edges.
const fs = require('fs');
const path = require('path');

const W = 1440, H = 980;
const INK = '#5B4A36';
let headId = 0;
const bands = [], arrows = [], cards = [], labels = [];

function hArrow(x1, x2, y, color, head) {
  // from x1 to tip x2 (pointing right when x2 > x1)
  const n = Math.abs(x2 - x1), h = head ? 4 : 0, left = Math.min(x1, x2);
  const right = x2 > x1;
  const d = right ? `M 0 4 L ${n - h} 4` : `M ${n} 4 L ${h} 4`;
  arrows.push(svg(left, y - 4, n, 8, d, color, head));
}
function vArrow(x, y1, y2, color, head) {
  const n = Math.abs(y2 - y1), h = head ? 4 : 0, top = Math.min(y1, y2);
  const down = y2 > y1;
  const d = down ? `M 4 0 L 4 ${n - h}` : `M 4 ${n} L 4 ${h}`;
  arrows.push(svg(x - 4, top, 8, n, d, color, head));
}
function svg(left, top, w, h, d, color, head) {
  let defs = '', me = '';
  if (head) {
    const id = 'dc-arrow-head-filled-' + (++headId);
    defs = `<defs><marker id="${id}" orient="auto" markerWidth="5" markerHeight="5" refX="2" refY="2" overflow="visible"><path d="M0 0 L4 2 L0 4 Z" fill="${color}" stroke="none" style="stroke: none; fill: ${color}; fill: context-stroke"/></marker></defs>`;
    me = ` marker-end="url(#${id})"`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="position: absolute; left: ${left}px; top: ${top}px; width: ${w}px; height: ${h}px; overflow: visible; fill: none; stroke: ${color}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round">${defs}<path d="${d}"${me}></path></svg>`;
}
function card(x, y, w, h, cls, html, extra) {
  cards.push(`<div class="dcard ${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${extra || ''}">${html}</div>`);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
}
function label(x, y, w, html, extra) {
  labels.push(`<div class="dLabel" style="left:${x}px;top:${y}px;width:${w}px;${extra || ''}">${html}</div>`);
}
function text(x, y, html, style) {
  labels.push(`<div style="position:absolute;left:${x}px;top:${y}px;${style}">${html}</div>`);
}
const ic = (name, size, color) => `<i-icon name="${name}" size="${size || 20}" style="color:${color || '#C9A24E'};flex:0 0 auto"></i-icon>`;

// ---- background bands
bands.push(`<x-tex kind="wood"></x-tex>`);
bands.push(`<div class="vign" aria-hidden="true" style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 62% 58% at 88% -4%,rgba(107,74,30,.72) 0%,rgba(107,74,30,.3) 38%,rgba(36,23,16,0) 72%),radial-gradient(ellipse 70% 60% at 6% 104%,rgba(0,0,0,.42) 0%,rgba(0,0,0,0) 70%)"></div>`);
bands.push(`<div class="leaf" aria-hidden="true" style="position:absolute;left:64px;top:64px;width:1312px;height:852px;padding:0;transform:rotate(-.15deg)"></div>`);
bands.push(`<x-tex kind="paper" style="inset:auto;left:64px;top:64px;width:1312px;height:852px;transform:rotate(-.15deg)"></x-tex>`);
// flow band: a darker parchment strip
bands.push(`<div aria-hidden="true" style="position:absolute;left:88px;top:652px;width:1264px;height:244px;border-radius:4px;background:rgba(203,182,140,.22);box-shadow:inset 0 0 0 1px rgba(185,166,126,.7)"></div>`);

// ---- title
text(96, 90, 'App map and navigation', 'font:30px/1 Forum,serif;color:#2B2118');
text(96, 130, 'Six sections on the brass rail (desktop and tablet) or in the folio drawer (phone). Tabs by device. Flows run on the action strap with Back, Next and Cancel in fixed slots.', 'width:760px;font:italic 15px/1.3 Alegreya,serif;color:#5B4A36');

// ---- the key (no legend: plain sentences), top right, above the distribution line
card(904, 84, 440, 140, 'dSlip', `<span style="text-align:left;font-size:14px;line-height:1.3"><b>Back</b> goes to the previous step or screen in your own path; from a deep link, to the parent in this map.<br><b>Next</b> opens the next unanswered step and never skips one; on the last step the same slot reads Create hero or Finish level up.<br><b>Cancel</b> leaves a flow and asks only if something changed.<br><b>Drawers</b> close with the control that opened them or with Escape, and never change the URL.</span>`, 'justify-content:flex-start;align-items:flex-start;padding:8px 12px;transform:rotate(.4deg)');

// ---- shell: the distribution line itself, labelled, feeding the six sections
const shellPlate = card(440, 196, 300, 32, 'dBrass', `${ic('wax-seal', 18, '#5E4418')}<span><b>Shell</b> · the same six sections on every device</span>`, 'font-size:14px;padding:4px 10px');
text(96, 196, 'Desktop and tablet: the brass rail. Phone: the folio drawer.', 'width:330px;font:italic 14px/1.25 Alegreya,serif;color:#5B4A36;text-align:right');
const shell = { cx: 590, b: shellPlate.b };
const secX = [120, 328, 536, 744, 952, 1160];
const secs = [
  ['house', 'Home'], ['person', 'Heroes'], ['three-friends', 'Campaigns'], ['open-book', 'Library'], ['chest', 'Packs'], ['cog', 'Settings'],
];
const SEC_TOP = 276, SEC_H = 56, SEC_W = 160;
const secC = secs.map(([icon, name], i) => card(secX[i], SEC_TOP, SEC_W, SEC_H, 'dLeather', `${ic(icon, 22)}<span>${name}</span>`));
// one-to-many: down from the shell, across, then into each child
vArrow(shell.cx, shell.b, 244, INK, false);
hArrow(secC[0].cx, secC[5].cx, 244, INK, false);
secC.forEach((c) => vArrow(c.cx, 244, SEC_TOP - 1, INK, true));

// ---- children per section
// Home
const home1 = card(secX[0], 380, SEC_W, 72, 'dInk', `<span>Continue leaf · Heroes row · Campaigns row · quick actions</span>`);
vArrow(secC[0].cx, secC[0].b, home1.y - 1, INK, true);
// Heroes
const sheet = card(secX[1], 380, SEC_W, 44, 'dInk', `<span><b>Hero sheet</b></span>`, 'font-size:16px');
vArrow(secC[1].cx, secC[1].b, sheet.y - 1, INK, true);
const tabsD = card(secX[1], 460, SEC_W, 80, 'dInk', `<span><b>Desktop and tablet:</b> Play · Build · Timeline, plus Level up when XP allows</span>`);
vArrow(sheet.cx, sheet.b, tabsD.y - 1, INK, true);
const tabsP = card(secX[1], 576, SEC_W, 64, 'dInk', `<span><b>Phone:</b> Combat · Spells · Bag · Hero · More</span>`);
vArrow(tabsD.cx, tabsD.b, tabsP.y - 1, INK, true);
// Campaigns
const camp = card(secX[2], 380, SEC_W, 44, 'dInk', `<span><b>Campaign</b></span>`, 'font-size:16px');
vArrow(secC[2].cx, secC[2].b, camp.y - 1, INK, true);
const campTabs = card(secX[2], 460, SEC_W, 64, 'dInk', `<span><b>Every device:</b> Party · Table · Lobby · Settings</span>`);
vArrow(camp.cx, camp.b, campTabs.y - 1, INK, true);
const join = card(secX[2], 560, SEC_W, 80, 'dInk', `<span><b>Join</b> by code or QR link, then link a hero to the party</span>`);
vArrow(campTabs.cx, campTabs.b, join.y - 1, INK, true);
// Library
const entry = card(secX[3], 380, SEC_W, 88, 'dInk', `<span><b>Entry:</b> description, and Add to hero when opened from a sheet</span>`);
vArrow(secC[3].cx, secC[3].b, entry.y - 1, INK, true);
// Packs
const pack = card(secX[4], 380, SEC_W, 72, 'dInk', `<span><b>Pack:</b> installed, updates, import, trust dialog</span>`);
vArrow(secC[4].cx, secC[4].b, pack.y - 1, INK, true);
const brew = card(secX[4], 488, SEC_W, 72, 'dInk', `<span><b>My homebrew:</b> item, spell, feat, species</span>`);
vArrow(pack.cx, pack.b, brew.y - 1, INK, true);
// Settings
const sett = card(secX[5], 380, SEC_W, 88, 'dInk', `<span>Account · Appearance · Storage · About and licences</span>`);
vArrow(secC[5].cx, secC[5].b, sett.y - 1, INK, true);

// ---- flows
text(104, 664, 'New hero, the creation wizard', 'font:20px/1 Forum,serif;color:#2B2118');
text(400, 668, 'entered from New hero on Home or Heroes; Back and Cancel return to where you came from; the stepper lists every step', 'font:italic 14px/1.2 Alegreya,serif;color:#5B4A36;width:900px');
const steps = ['<b>1</b> Name &amp; concept', '<b>2</b> Species', '<b>3</b> Background', '<b>4</b> Ability scores', '<b>5</b> Class', '<b>6…</b> Class choices', '<b>N−1</b> Equipment', '<b>N</b> Review'];
const W_TOP = 696, W_H = 64, W_W = 112, W_PITCH = 160;
const wiz = steps.map((s, i) => card(104 + i * W_PITCH, W_TOP, W_W, W_H, 'dSlip', `<span>${s}</span>`, 'font-size:14px'));
for (let i = 0; i < wiz.length - 1; i++) hArrow(wiz[i].r, wiz[i + 1].x - 1, wiz[i].cy, INK, true);
label(wiz[5].x - 20, wiz[5].b + 8, W_W + 40, 'as the class reveals them');
label(wiz[7].x - 24, wiz[7].b + 8, W_W + 48, 'Next reads Create hero');

text(104, 788, 'Level up', 'font:20px/1 Forum,serif;color:#2B2118');
text(200, 792, 'from the Level up tab on the sheet; Back and Cancel return to that tab', 'font:italic 14px/1.2 Alegreya,serif;color:#5B4A36;width:640px');
const lsteps = ['<b>Which class</b><br>own or multiclass', '<b>Hit points</b><br>roll or average, shown first', '<b>Class choices</b><br>as discovered', '<b>Review</b><br>Next reads Finish level up'];
const L_TOP = 820, L_H = 56, L_W = 150, L_PITCH = 198;
const lv = lsteps.map((s, i) => card(104 + i * L_PITCH, L_TOP, L_W, L_H, 'dSlip', `<span>${s}</span>`, 'font-size:14px'));
for (let i = 0; i < lv.length - 1; i++) hArrow(lv[i].r, lv[i + 1].x - 1, lv[i].cy, INK, true);
const back = card(896, L_TOP, 220, L_H, 'dLeather', `${ic('crossed-swords', 20)}<span>The sheet tab you came from</span>`, 'font-size:16px');
hArrow(lv[3].r, back.x - 1, lv[3].cy, INK, true);
text(1140, 826, 'Both flows share the stepper: vertical on desktop and tablet, a Step N of M strip on the phone.', 'width:200px;font:italic 14px/1.25 Alegreya,serif;color:#5B4A36');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tavern Table — app map and navigation</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Forum&family=Alegreya:ital,wght@0,400;0,700;1,400;1,700&display=swap">
<style>
__CSS__
</style>
</helmet>
<div style="position: relative; width: ${W}px; height: ${H}px; overflow:hidden; background:#241710; font-family:Alegreya,Georgia,serif; color:#2B2118">
${bands.join('\n')}
${arrows.join('\n')}
${cards.join('\n')}
${labels.join('\n')}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":__PREVIEW__}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'IA-NavMap.src.html'), html);
console.log('IA-NavMap.src.html written:', cards.length, 'cards,', arrows.length, 'arrows');
