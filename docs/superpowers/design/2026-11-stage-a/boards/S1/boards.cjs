// boards.cjs — the S1 hero-creation wizard boards (markup generators). Consumed by build.cjs.
// Every entity name, trait, feature, weapon, spell and skill comes from the real SRD pack; the only
// invented strings are the hero's name and the Ukrainian translations listed in notes.md.
const path = require('path');
const PACK = require('D:/Projects/Programming/Personal/DndHeroCreator/apps/web/public/packs/srd-5e-2024/0.1.0/pack.json');
const E = PACK.entities;
const by = (id) => E.find((e) => e.id === id);
const real = (f) => f && !/^\[Column data\]/.test(f.description || '');

// ---------- macros ----------
const I = (name, size, o = {}) => `<i-icon name="${name}" size="${size}"${o.label ? ` label="${o.label}"` : ''}${o.hint ? ` hint="${o.hint}"` : ''}${o.cls ? ` class="${o.cls}"` : ''}${o.style ? ` style="${o.style}"` : ''}></i-icon>`;
const SEAL = (o) => `<x-seal state="${o.state || 'full'}"${o.icon ? ` icon="${o.icon}"` : ''}${o.text ? ` text="${o.text}"` : ''} size="${o.size || 28}"${o.label ? ` label="${o.label}"` : ''}${o.hint ? ` hint="${o.hint}"` : ''} seed="${o.seed || 1}"${o.cls ? ` class="${o.cls}"` : ''}${o.style ? ` style="${o.style}"` : ''}${o.fs ? ` fs="${o.fs}"` : ''}></x-seal>`;
const TEX = (k, s) => `<x-tex kind="${k}"${s ? ` style="${s}"` : ''}></x-tex>`;
const DEFS = '<x-defs></x-defs>';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let tipN = 0;
const TIP = (text, sub, cls) => { const id = 'tip' + (++tipN); return { id, html: `<span class="hk-tip${cls ? ' ' + cls : ''}" id="${id}" role="tooltip">${text}${sub ? `<span class="hk-tip__sub">${sub}</span>` : ''}</span>` }; };

// ---------- pack data ----------
const ABIL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const ABIL_UK = { str: 'Сила', dex: 'Спритність', con: 'Статура', int: 'Інтелект', wis: 'Мудрість', cha: 'Харизма' };
const ABIL_ICON = { str: 'muscle-up', dex: 'acrobatic', con: 'heart-inside', int: 'brain', wis: 'owl', cha: 'charm' };
const AB = (k) => k.toUpperCase();
const species = E.filter((e) => e.type === 'species');
const classes = E.filter((e) => e.type === 'class');
const backgrounds = E.filter((e) => e.type === 'background');
const weapons = E.filter((e) => e.type === 'item' && e.weapon && e.weapon.mastery).sort((a, b) => a.name.localeCompare(b.name));
const skills = E.filter((e) => e.type === 'skill');
const styles = E.filter((e) => e.type === 'feat' && (e.tags || []).includes('fighting-style'));
const clericSpells = E.filter((e) => e.type === 'spell' && (e.classes || []).includes('cleric') && e.level <= 1).sort((a, b) => a.name.localeCompare(b.name));
const skillById = (k) => skills.find((s) => s.id.endsWith('/' + k));
const traitNames = (sp) => sp.grants.map((g) => by(g.feature)).filter(real).map((f) => f.name);
const l1Features = (c) => c.levels[0].grants.map((g) => by(g.feature)).filter(real).map((f) => f.name);
const SPECIES_ICON = { Dragonborn: 'dragon-head', Dwarf: 'dwarf-helmet', Elf: 'elf-helmet', Gnome: 'pointy-hat', Goliath: 'giant', Halfling: 'hobbit-door', Human: 'person', Orc: 'orc-head', Tiefling: 'devil-mask' };
const SPECIES_UK = { Dragonborn: 'Драконороджений', Dwarf: 'Дварф', Elf: 'Ельф', Gnome: 'Гном', Goliath: 'Голіаф', Halfling: 'Півмірок', Human: 'Людина', Orc: 'Орк', Tiefling: 'Тифлінг' };
const CLASS_ICON = { Barbarian: 'barbarian', Bard: 'lyre', Cleric: 'holy-symbol', Druid: 'oak-leaf', Fighter: 'crossed-swords', Monk: 'fist', Paladin: 'templar-shield', Ranger: 'bowman', Rogue: 'hood', Sorcerer: 'fire-spell-cast', Warlock: 'pentacle', Wizard: 'wizard-staff' };
const BG_ICON = { Acolyte: 'prayer', Criminal: 'domino-mask', Sage: 'book-cover', Soldier: 'medal' };
const WEAPON_ICON = { Battleaxe: 'battle-axe', Blowgun: 'bo', Club: 'club', Dagger: 'stiletto', Dart: 'dart', Flail: 'flail', Glaive: 'glaive', Greataxe: 'battle-axe', Greatclub: 'wood-club', Greatsword: 'two-handed-sword', Halberd: 'halberd', 'Hand Crossbow': 'crossbow', Handaxe: 'hatchet', 'Heavy Crossbow': 'crossbow', Javelin: 'thrown-spear', Lance: 'spear-hook', 'Light Crossbow': 'crossbow', 'Light Hammer': 'hammer-drop', Longbow: 'bow-arrow', Longsword: 'broadsword', Mace: 'mace-head', Maul: 'thor-hammer', Morningstar: 'spiked-mace', Musket: 'musket', Pike: 'spears', Pistol: 'pistol-gun', Quarterstaff: 'bo', Rapier: 'sword-hilt', Scimitar: 'sword-slice', Shortbow: 'pocket-bow', Shortsword: 'gladius', Sickle: 'sickle', Sling: 'sling', Spear: 'spear-feather', Trident: 'trident', 'War Pick': 'war-pick', Warhammer: 'warhammer', Whip: 'whip' };
const SPELL_ICON = { Guidance: 'wisdom', Light: 'light-bulb', Mending: 'sewing-needle', Resistance: 'shield-echoes', 'Sacred Flame': 'flame', 'Spare the Dying': 'heart-plus', Thaumaturgy: 'magic-swirl', Bane: 'cursed-star', Bless: 'prayer', Command: 'megaphone', 'Create or Destroy Water': 'drop', 'Cure Wounds': 'healing', 'Detect Evil and Good': 'eye-shield', 'Detect Magic': 'crystal-ball', 'Detect Poison and Disease': 'snake', 'Guiding Bolt': 'bolt-spell-cast', 'Healing Word': 'heart-plus', 'Inflict Wounds': 'skull', 'Protection from Evil and Good': 'holy-symbol', 'Purify Food and Drink': 'holy-water', Sanctuary: 'magic-shield', 'Shield of Faith': 'shield' };
const MASTERY_TEXT = { sap: 'If you hit a creature with this weapon, that creature has Disadvantage on its next attack roll before the start of your next turn.', slow: 'If you hit a creature with this weapon and deal damage, you can reduce its Speed by 10 feet until the start of your next turn.', graze: 'If your attack roll misses, you can deal damage equal to the ability modifier you used to make the attack.', cleave: 'If you hit a creature with a melee attack, you can make one more attack against a second creature within 5 feet of the first.', topple: 'If you hit a creature with this weapon, you can force it to make a Constitution saving throw or fall Prone.', vex: 'If you hit a creature and deal damage, you have Advantage on your next attack roll against it before the end of your next turn.', nick: 'When you make the extra attack of the Light property, you can make it as part of the Attack action instead of a Bonus Action.', push: 'If you hit a Large or smaller creature, you can push it up to 10 feet straight away from yourself.' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- the hero being made ----------
const HERO = { name: 'Maelis Thorne', mono: 'MT', nameUk: 'Маеліс Торн', monoUk: 'МТ' };
const BASE = { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 };
const BONUS = { str: 2, con: 1 };
const COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const FINAL = Object.fromEntries(Object.keys(BASE).map((k) => [k, BASE[k] + (BONUS[k] || 0)]));
const MOD = (s) => Math.floor((s - 10) / 2);
const sign = (n) => (n < 0 ? '−' + Math.abs(n) : '+' + n);

// ---------- shared fragments (desktop) ----------
function rail(lang) {
  return `<header class="hk-rail">${TEX('leather')}
    <div class="hk-rail__mark">${I('wax-seal', 26)}Herokeep</div>
    <nav class="hk-rail__nav" aria-label="App"><div class="hk-rail__bar" aria-hidden="true"></div>
      <a class="hk-ico" href="#" aria-label="Home" title="Home">${I('house', 22)}</a>
      <a class="hk-ico hk-ico--on" href="#" aria-current="page" aria-label="Heroes" title="Heroes">${I('person', 22)}</a>
      <a class="hk-ico" href="#" aria-label="Campaigns" title="Campaigns">${I('three-friends', 22)}</a>
      <a class="hk-ico" href="#" aria-label="Library" title="Library">${I('open-book', 22)}</a>
      <a class="hk-ico" href="#" aria-label="Packs" title="Packs">${I('chest', 22)}</a>
      <a class="hk-ico" href="#" aria-label="Settings" title="Settings">${I('cog', 22)}</a>
    </nav>
    <div class="hk-rail__spacer"></div>
    <span class="hk-chip hk-chip--l" style="height:28px;font-size:15px" title="Current campaign">${I('three-friends', 15)}The Emberfall Company</span>
    <button class="hk-ico" type="button" aria-label="Account" title="Account">${I('hood', 22)}</button>
  </header>`;
}

const STEPS = (cls) => [
  { k: 'name', label: 'Name &amp; concept' },
  { k: 'species', label: 'Species' },
  { k: 'background', label: 'Background' },
  { k: 'abilities', label: 'Ability scores' },
  { k: 'class', label: 'Class' },
  { k: 'skills', label: 'Skills &amp; tools' },
  { k: 'choices', label: cls === 'fighter' ? 'Fighting style &amp; masteries' : cls === 'cleric' ? 'Spells' : 'Class choices', locked: !cls },
  { k: 'equipment', label: 'Equipment' },
  { k: 'review', label: 'Review' },
];
const STEP_PLAIN = (cls) => STEPS(cls).map((s) => ({ ...s, label: s.label.replace(/&amp;/g, '&') }));

function stepper(cur, ans, cls, invalid) {
  const rows = STEPS(cls).map((s, i) => {
    const n = i + 1;
    if (s.locked) return `<li><span class="hk-step hk-step--todo hk-step--group" aria-disabled="true" title="Unlocks once you choose a class"><span class="hk-step__n" style="box-shadow:none;font-size:12px">${I('padlock', 14, { style: 'color:var(--text-2)' })}</span><span>${s.label}</span><span class="hk-step__hint">after class</span></span></li>`;
    if (i < cur) return `<li><a class="hk-step" href="#" title="Go to ${s.label.replace(/&amp;/g, '&')}"><span class="hk-step__n" style="box-shadow:none">${SEAL({ icon: 'check-mark', size: 24, label: 'Done', seed: n })}</span><span>${s.label}</span><span class="hk-step__hint">${ans[s.k] || ''}</span></a></li>`;
    if (i === cur) return `<li><a class="hk-step hk-step--current" href="#" aria-current="step"><span class="hk-step__n">${n}</span><span>${s.label}${invalid ? `<span class="stepBad">${I('cross-mark', 10)}${invalid}</span>` : ''}</span><span class="hk-step__hint">${ans[s.k] || 'now'}</span></a></li>`;
    return `<li><a class="hk-step hk-step--todo" href="#"><span class="hk-step__n">${n}</span><span>${s.label}</span></a></li>`;
  });
  return `<nav class="hk-leaf" aria-label="Steps" style="padding:12px">${TEX('paper')}<ol class="hk-stepper" style="list-style:none;margin:0;padding:0">${rows.join('')}</ol></nav>`;
}

function soFar(ans) {
  const chips = [];
  if (ans.species) chips.push(`<span class="hk-chip">${I(SPECIES_ICON[ans.species] || 'person', 13)}${ans.species}</span>`);
  if (ans.background) chips.push(`<span class="hk-chip">${I(BG_ICON[ans.background] || 'medal', 13)}${ans.background}</span>`);
  if (ans.class) chips.push(`<span class="hk-chip">${I(CLASS_ICON[ans.class] || 'crossed-swords', 13)}${ans.class}</span>`);
  return `<section class="hk-leaf" aria-label="Hero so far" style="padding:12px 14px;display:flex;gap:12px;align-items:center">${TEX('paper')}
    <div class="hk-frame hk-frame--s"><div class="hk-frame__well" role="img" aria-label="Portrait placeholder, monogram ${HERO.mono}">${HERO.mono}</div></div>
    <div class="hk-col" style="gap:6px;min-width:0;flex:1 1 auto"><span style="font-family:var(--font-display);font-size:20px;line-height:1.1">${ans.name || HERO.name}</span><div class="hk-row" style="gap:4px">${chips.length ? chips.join('') : '<span class="hk-hint">nothing chosen yet</span>'}</div></div>
  </section>`;
}

function strap(o) {
  // Disabled strap buttons keep their reason as a hover hint (title) and in the accessible name; nothing inline.
  const back = o.backDisabled ? `<button class="hk-btn hk-btn--leather hk-btn--l" type="button" disabled title="${o.backDisabled}" aria-label="Back (${o.backDisabled})">${I('exit-door', 17)}Back</button>` : `<button class="hk-btn hk-btn--leather hk-btn--l" type="button">${I('exit-door', 17)}Back</button>`;
  const nextIcon = o.next === 'Create hero' ? 'wax-seal' : 'entry-door';
  const next = o.nextDisabled ? `<button class="hk-btn hk-btn--brass hk-btn--l" type="button" disabled title="${o.nextDisabled}" aria-label="${o.next || 'Next'} (${o.nextDisabled})">${I(nextIcon, 17)}${o.next || 'Next'}</button>` : `<button class="hk-btn hk-btn--brass hk-btn--l${o.focus ? ' hk-focus-demo' : ''}" type="button">${I(nextIcon, 17)}${o.next || 'Next'}</button>`;
  const zone3 = o.picker ? `<span class="hk-astrap__divider" aria-hidden="true"></span><div class="hk-astrap__zone" aria-label="Secondary"><button class="hk-ico${o.filterOn ? ' hk-ico--on' : ''}" type="button" aria-label="Filter" title="Filter"${o.filterOn ? ' aria-pressed="true"' : ''}>${I('funnel', 20)}</button><button class="hk-ico" type="button" aria-label="Search" title="Search">${I('magnifying-glass', 20)}</button></div>` : '';
  return `<footer class="hk-astrap" aria-label="Actions" style="position:sticky;bottom:0;z-index:4;flex:0 0 auto">${TEX('leather')}<div class="hk-rivets"></div>
    <div class="hk-astrap__row">
      <div class="hk-astrap__zone" aria-label="Exit"><button class="hk-btn hk-btn--ghost-leather hk-btn--l" type="button">${I('cross-mark', 13)}Cancel</button>${back}</div>
      <span class="hk-astrap__divider" aria-hidden="true"></span>
      <div class="hk-astrap__zone" aria-label="Primary">${next}</div>
      ${zone3}
      <span class="hk-astrap__note" style="color:var(--text-on-leather-2)">Step ${o.n} of 9 · ${o.label}</span>
    </div><div class="hk-rivets"></div></footer>`;
}

function drawer(o) {
  return `<aside class="hk-drawer drawerCol" role="dialog" aria-labelledby="drawerT" aria-modal="false"${o.style ? ` style="${o.style}"` : ''}>${TEX('paper')}
    <div class="hk-drawer__head">${I(o.icon, 24, { style: 'color:var(--accent-strong);margin-top:3px' })}<h2 class="hk-drawer__title" id="drawerT">${o.title}</h2><button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="Close" title="Close (Esc)">${I('cross-mark', 12)}</button></div>
    ${o.meta ? `<div class="hk-drawer__meta">${o.meta}</div>` : ''}
    ${o.body}
    <span class="hk-hint">SRD 5.2.1 (2024 rules) · Herokeep core pack</span>
    <div class="hk-row" style="margin-top:auto;justify-content:flex-end;gap:8px">${o.actions}</div>
  </aside>`;
}

function page(o) {
  const cols = o.drawer ? 'pgMain pgMain3' : 'pgMain';
  return `<div class="pg" data-theme="tavern">${DEFS}${TEX('wood')}<div class="hk-vignette" aria-hidden="true"></div>
  ${rail()}
  <main class="${cols}">
    <div class="hk-col" style="gap:14px">${stepper(o.cur, o.ans, o.cls, o.invalid)}${o.cur > 0 ? soFar(o.ans) : ''}</div>
    <section class="hk-leaf stepLeaf" aria-labelledby="stepT">${TEX('paper')}${o.body}</section>
    ${o.drawer || ''}
  </main>
  ${strap(o.strap)}
</div>`;
}

function pickerTop(o) {
  const chips = o.chips.map((c) => `<button class="hk-chip hk-chip--l hk-chip--btn${c.on ? ' hk-chip--selected' : ''}${c.tip ? ' hk-has-tip' : ''}" type="button" aria-pressed="${c.on ? 'true' : 'false'}"${c.title ? ` title="${c.title}"` : ''}${c.tip ? ` aria-describedby="${c.tip.id}"` : ''}>${c.icon ? I(c.icon, 14) : ''}${c.label}${c.badge ? `<span class="hk-btn__badge">${c.badge}</span>` : ''}${c.tip ? c.tip.html : ''}</button>`).join('');
  return `<div class="pickerTop"><label class="hk-search" style="flex:0 1 340px">${I('magnifying-glass', 18)}<span class="hk-sr">${o.label}</span><input class="hk-search__in" type="search" placeholder="${o.placeholder}"${o.value ? ` value="${o.value}"` : ''}>${o.value ? `<button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="Clear search" title="Clear search">${I('cross-mark', 11)}</button>` : ''}</label><div class="hk-row" role="group" aria-label="Filter" style="gap:6px">${chips}</div></div>`;
}

function stepHead(title, lead, extra) {
  return `<div class="stepHead"><div class="hk-col" style="gap:4px;min-width:0"><h1 class="stepTitle" id="stepT">${title}</h1>${lead ? `<span class="stepLead">${lead}</span>` : ''}</div>${extra || ''}</div>`;
}

function card(o) {
  const cls = ['hk-card', 'cardF'];
  if (o.state === 'selected') cls.push('hk-card--selected');
  if (o.state === 'gated') cls.push('hk-card--gated');
  const seal = o.state === 'selected' ? `<span class="hk-card__seal">${SEAL({ icon: 'check-mark', size: 30, label: 'Chosen', seed: o.seed || 3 })}</span>` : '';
  let action;
  if (o.state === 'selected') action = `<button class="hk-btn hk-btn--parchment" type="button" style="height:28px" aria-label="${o.title}: details">${I('info', 13)}Details</button>`;
  else if (o.state === 'gated') action = `<button class="hk-btn hk-btn--brass" type="button" style="height:28px" disabled title="${o.gate}" aria-label="Choose ${o.title} (${o.gate})">Choose</button>`;
  else action = `<button class="hk-btn hk-btn--brass" type="button" style="height:28px" aria-label="Choose ${o.title}">Choose</button>`;
  // Gated: the reason lives on hover (padlock glyph hint + the disabled Choose's title), never inline.
  const gate = o.state === 'gated' ? `<span class="hk-card__gate${o.gateTip ? ' hk-has-tip' : ''}" role="img" aria-label="${o.gate}" title="${o.gate}"${o.gateTip ? ` aria-describedby="${o.gateTip.id}" tabindex="0"` : ''}>${I('padlock', 15)}${o.gateTip ? o.gateTip.html : ''}</span>` : '';
  return `<article class="${cls.join(' ')}"${o.state === 'gated' ? ' aria-disabled="true"' : ''}>${TEX('paper')}${seal}
    <button class="cardOpen" type="button" aria-label="${o.title}: open description"><div class="hk-card__head">${I(o.icon, 22)}<span class="hk-card__title">${o.title}</span>${gate}</div><div class="hk-card__desc">${o.desc}</div></button>
    <div class="hk-card__foot">${o.tags || ''}</div>
    <div class="cardAct">${o.extra || ''}<span style="flex:1 1 auto"></span>${action}</div>
  </article>`;
}
const chip = (txt, icon, extra) => `<span class="hk-chip"${extra || ''}>${icon ? I(icon, 12) : ''}${txt}</span>`;

// ======================================================================
// W01 — Name & concept
// ======================================================================
function w01() {
  const lock = TIP('The core rules are always on.', 'SRD 5.2.1 (2024 rules) is built into Herokeep', 'hk-tip--above hk-tip--left');
  const body = `
    ${stepHead('Name &amp; concept')}
    <div class="nameGrid">
      <div class="hk-col" style="gap:8px;align-items:center">
        <div class="hk-frame hk-frame--l"><div class="hk-frame__well" role="img" aria-label="Portrait placeholder, monogram ${HERO.mono}">${HERO.mono}</div><span class="hk-rivet hk-frame__rivet hk-frame__rivet--tl"></span><span class="hk-rivet hk-frame__rivet hk-frame__rivet--tr"></span><span class="hk-rivet hk-frame__rivet hk-frame__rivet--bl"></span><span class="hk-rivet hk-frame__rivet hk-frame__rivet--br"></span><button class="hk-ico hk-ico--s hk-frame__edit" type="button" aria-label="Upload portrait" title="Upload portrait">${I('photo-camera', 14)}</button></div>
        <button class="hk-btn hk-btn--parchment" type="button" title="JPEG, PNG, WebP or GIF">${I('cloud-upload', 15)}Upload portrait</button>
        <span class="hk-field__msg hk-field__msg--error" role="alert" style="max-width:190px;line-height:1.25">${I('cross-mark', 11)}This image is too large. Try a smaller photo.</span>
      </div>
      <div class="hk-col" style="gap:16px;min-width:0">
        <div class="hk-field"><label class="hk-field__label" for="heroName">Name</label><input class="hk-input hk-focus-demo" id="heroName" value="${HERO.name}" style="font-family:var(--font-display);font-size:24px;height:46px" maxlength="200" title="Up to 200 characters"></div>
        <div class="hk-field"><span class="hk-field__label" id="formL">Grammatical form</span>
          <div class="seg" role="radiogroup" aria-labelledby="formL" title="How Ukrainian and Russian describe the hero (“Маеліс створила…”)">
            <label class="segBtn"><input type="radio" name="form" class="hk-sr">${I('male', 15)}Masculine</label>
            <label class="segBtn segBtn--on"><input type="radio" name="form" class="hk-sr" checked>${I('female', 15)}Feminine</label>
            <label class="segBtn"><input type="radio" name="form" class="hk-sr">${I('conversation', 15)}Neuter</label>
          </div>
        </div>
      </div>
    </div>
    <div class="hk-rule" style="margin:4px 0"></div>
    <h2 class="hk-leaf__title" style="font-size:20px">${I('chest', 20)}Content packs</h2>
    <ul class="packList">
      <li class="packRow"><span class="hk-iring">${I('open-book', 16)}</span><span class="packName"><b>SRD 5.2.1 (2024 rules)</b><span class="hk-hint">v0.1.0 · core rules</span></span><span></span><span class="packPin hk-has-tip" role="img" aria-label="Pinned, locked: the core rules are always on." title="The core rules are always on." aria-describedby="${lock.id}" tabindex="0">${I('padlock', 16)}${lock.html}</span></li>
      <li class="packRow"><span class="hk-iring">${I('cauldron', 16)}</span><span class="packName"><b>My homebrew</b><span class="hk-hint">v0.1.0 · this device</span></span><span class="hk-chip" aria-live="polite"><span class="hk-spin" aria-hidden="true" style="width:11px;height:11px;border-width:1.5px;color:var(--accent-strong)"></span>Checking for updates…</span><label class="packPin" title="Pinned to this hero"><input type="checkbox" class="hk-sr" checked>${I('pin', 16, { label: 'Pinned' })}</label></li>
      <li class="packRow"><span class="hk-iring" style="opacity:.7">${I('conversation', 16)}</span><span class="packName"><b style="font-weight:600">SRD 5.2.1 — русский (образец)</b><span class="hk-hint">v0.1.0 · translation (ru)</span></span><span></span><label class="packPin packPin--off" title="Not pinned"><input type="checkbox" class="hk-sr">${I('pin', 16, { label: 'Not pinned' })}</label></li>
    </ul>
    <div class="emptyRow">${I('three-friends', 18)}<span>The Emberfall Company shares no packs yet.</span></div>`;
  return page({ cur: 0, ans: { name: HERO.name }, cls: null, body, strap: { n: 1, label: 'Name & concept', backDisabled: 'Nothing to go back to' } });
}

// ======================================================================
// W02 — Species (Elf selected, drawer open)
// ======================================================================
function w02() {
  const elf = species.find((s) => s.name === 'Elf');
  const cards = species.map((s, i) => card({
    icon: SPECIES_ICON[s.name], title: s.name, desc: traitNames(s).join(' · '), seed: i + 1,
    tags: chip(cap(s.size), null, ` title="Size: ${cap(s.size)}"`) + chip(`${s.speed} ft`, 'running-shoe', ` title="Speed ${s.speed} ft"`),
    state: s.name === 'Elf' ? 'selected' : 'default',
  })).join('');
  const packTip = TIP('9 species come from the core pack', 'pin more packs in step 1 to see theirs here', 'hk-tip--above');
  const body = `
    ${stepHead('Species')}
    ${pickerTop({ label: 'Search species', placeholder: 'Search…', chips: [{ label: 'All', on: true }, { label: 'Small' }, { label: 'Medium' }, { label: 'Speed 35', icon: 'running-shoe' }, { label: 'Darkvision', icon: 'owl' }, { label: 'Pack: SRD 5.2.1', icon: 'chest', badge: '9', tip: packTip }] })}
    <div class="cards">${cards}</div>`;
  const traits = elf.grants.map((g) => by(g.feature)).filter(real);
  const drw = drawer({
    icon: 'elf-helmet', title: 'Elf',
    meta: chip('Medium') + chip('30 ft', 'running-shoe') + chip('Humanoid') + chip('Darkvision 60 ft', 'owl'),
    body: `<h3 class="drawerH">Traits</h3><ul class="traitList">${traits.map((t) => `<li><b>${t.name}.</b> ${esc(t.description.split('\n')[0]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').slice(0, 170)}${t.description.length > 170 ? '…' : ''}</li>`).join('')}</ul>`,
    actions: `<button class="hk-btn hk-btn--ghost" type="button">${I('open-book', 14)}Open in library</button><button class="hk-btn hk-btn--brass" type="button" aria-pressed="true" title="Elf is chosen · pick another card to change">${I('check-mark', 14)}Chosen</button>`,
  });
  return page({ cur: 1, ans: { name: HERO.name, species: 'Elf' }, cls: null, body, drawer: drw, strap: { n: 2, label: 'Species', picker: true } });
}

// ======================================================================
// W03 — Background (nothing chosen; Criminal gated with an open tooltip)
// ======================================================================
function w03() {
  const gate = TIP('Not allowed in The Emberfall Company', 'DM’s house rule: Acolyte, Sage or Soldier only', 'hk-tip--left');
  const cards = backgrounds.map((b, i) => {
    const feat = by(b.originFeat);
    const sk = b.skillProficiencies.map((k) => skillById(k).name);
    const tool = b.toolProficiency === 'thieves-tools' ? 'Thieves’ Tools' : b.toolProficiency === 'calligraphers-supplies' ? 'Calligrapher’s Supplies' : 'Gaming Set (one kind)';
    const m = /\*\*Equipment\.\*\*\s*\*Choose A or B:\*\s*(.+?)\n/.exec(b.description + '\n');
    const equip = m ? esc(m[1]).replace(/\(A\)/, '<b>A</b>').replace(/\(B\)/, '<b>B</b>') : '';
    return card({
      icon: BG_ICON[b.name], title: b.name, seed: i + 2,
      desc: `<span class="descRow">${I('medal', 13)}<b>Skills</b>&nbsp;${sk.join(', ')}</span><span class="descRow">${I('cog', 13)}<b>Tool</b>&nbsp;${tool}</span><span class="descRow">${I('laurel-crown', 13)}<b>Feat</b>&nbsp;${feat.name}</span><span class="descRow descRow--wrap">${I('swap-bag', 13)}<span><b>Equipment</b> ${equip}</span></span>`,
      tags: b.abilityScores.map((k) => chip(ABIL[k], ABIL_ICON[k], ` title="+2 or +1 may go to ${ABIL[k]}"`)).join('') + chip('+2 / +1', null, ' title="Ability score improvement: +2 to one and +1 to another of the three"'),
      state: b.name === 'Criminal' ? 'gated' : 'default', gate: 'Not allowed in The Emberfall Company (DM’s house rule)', gateTip: b.name === 'Criminal' ? gate : null,
    });
  }).join('');
  const body = `
    ${stepHead('Background', 'A background gives two skills, a tool, an origin feat and the +2 / +1 ability bonuses you place in step 4.')}
    ${pickerTop({ label: 'Search backgrounds', placeholder: 'Search…', chips: [{ label: 'All', on: true }, { label: 'Strength', icon: 'muscle-up' }, { label: 'Dexterity', icon: 'acrobatic' }, { label: 'Intelligence', icon: 'brain' }, { label: 'Wisdom', icon: 'owl' }, { label: 'Pack: SRD 5.2.1', icon: 'chest', badge: '4' }] })}
    <div class="cards cards2">${cards}</div>`;
  return page({ cur: 2, ans: { name: HERO.name, species: 'Elf' }, cls: null, body, strap: { n: 3, label: 'Background', picker: true, nextDisabled: 'Choose a background first' } });
}

// ======================================================================
// W04 — Ability scores (point buy, Soldier +2/+1 placed)
// ======================================================================
function abilityBlock(k, i, o) {
  const base = BASE[k], bonus = BONUS[k] || 0, fin = FINAL[k], mod = MOD(fin);
  const eligible = ['str', 'dex', 'con'].includes(k);
  const tag = bonus ? `<span class="hk-plate hk-ability__bonus bonusTag${o.tip && k === 'str' ? ' hk-has-tip' : ''}" title="+${bonus} from Soldier · drag to move" draggable="true"${o.tip && k === 'str' ? ` aria-describedby="${o.tip.id}" tabindex="0"` : ''}>${I('plus', 10)}${bonus}${o.tip && k === 'str' ? o.tip.html : ''}</span>` : '';
  return `<div class="abil${eligible ? ' abil--drop' : ''}" aria-label="${ABIL[k]}: base ${base}, bonus ${bonus}, total ${fin}, modifier ${sign(mod)}">
    <span style="position:relative">${SEAL({ text: sign(mod), size: 58, label: `${ABIL[k]} modifier ${sign(mod)}`, seed: i + 1 })}${tag}</span>
    <span class="hk-ability__name" style="color:var(--text-1);display:flex;align-items:center;gap:5px">${I(ABIL_ICON[k], 14, { style: 'color:var(--accent-strong)' })}${ABIL[k]}</span>
    <div class="hk-numfield hk-numfield--leaf" style="grid-template-columns:30px 48px 30px;gap:3px"><button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="${ABIL[k]}: one lower" title="−1"${base <= 8 ? ' disabled' : ''}>${I('minus', 14)}</button><input class="hk-numfield__in" type="number" value="${base}" min="8" max="15" aria-label="${ABIL[k]} base score" style="height:30px;font-size:20px"><button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="${ABIL[k]}: one higher" title="${base >= 15 ? '15 is the point-buy maximum' : '+1'}"${base >= 15 ? ' disabled' : ''}>${I('plus', 14)}</button></div>
    <span class="abilCost"><span class="hk-hint">Cost: ${COST[base]}</span><span class="hk-plate" title="Total score ${fin}${bonus ? ` (${base} + ${bonus})` : ''}">= ${fin}</span></span>
  </div>`;
}
function w04() {
  const tip = TIP('+1 from the Soldier background', 'drag it onto Strength, Dexterity or Constitution', 'tipR');
  const total = Object.values(BASE).reduce((a, s) => a + COST[s], 0);
  const body = `
    ${stepHead('Ability scores', '', `<div class="hk-tabs methodTabs" role="tablist" aria-label="Method"><button class="hk-tab" type="button" role="tab" aria-selected="false">Standard array</button><button class="hk-tab hk-tab--on" type="button" role="tab" aria-selected="true">Point buy</button><button class="hk-tab" type="button" role="tab" aria-selected="false">Roll</button><button class="hk-tab" type="button" role="tab" aria-selected="false">Manual</button></div>`)}
    <div class="budgetRow">
      <span class="hk-lvl" style="font-size:18px" title="Point buy: scores 8 to 15 before bonuses; 14 and 15 cost more">${I('coins', 18, { style: 'color:var(--accent-strong)' })}Points</span>
      <div class="hk-gauge" style="flex:1 1 200px;max-width:320px" role="progressbar" aria-valuemin="0" aria-valuemax="27" aria-valuenow="${total}" aria-label="Point budget"><div class="hk-gauge__brass" style="width:${Math.round(total / 27 * 100)}%"></div></div>
      <b class="hk-num" style="font-size:22px">${total} / 27 points</b>
      <span style="flex:1 1 auto"></span>
      <button class="hk-btn hk-btn--ghost" type="button">${I('cycle', 14)}Reset to 8s</button>
    </div>
    <div class="bonusTray">${TEX('leather')}
      <span class="hk-strap__label" style="font-size:15px">${I('medal', 16)}Soldier bonuses</span>
      <span class="hk-plate" style="height:26px;font-size:16px;cursor:grab" draggable="true" title="+2 from Soldier · on Strength">${I('plus', 11)}2 ${I('muscle-up', 13)} Strength</span>
      <span class="hk-plate hk-has-tip" style="height:26px;font-size:16px;cursor:grab" draggable="true" aria-describedby="${tip.id}" tabindex="0">${I('plus', 11)}1 ${I('heart-inside', 13)} Constitution${tip.html}</span>
      <span style="flex:1 1 auto"></span>
      <button class="hk-btn hk-btn--ghost-leather" type="button" title="Swap +2 and +1">${I('cycle', 14)}Swap</button>
    </div>
    <div class="abilGrid">${Object.keys(BASE).map((k, i) => abilityBlock(k, i, {})).join('')}</div>
    <div class="preview">${TEX('leather')}
      <span class="hk-strap__label" style="font-size:15px" title="Updates as you change a score">${I('eye-shield', 16)}Live preview</span>
      <span class="hk-badge prevBadge" title="Dexterity modifier"><span class="hk-badge__l">Initiative</span><span class="hk-badge__v">${I('stopwatch', 16)}+2</span></span>
      <span class="hk-badge prevBadge" title="10 + Dexterity modifier"><span class="hk-badge__l">Unarmored AC</span><span class="hk-badge__v">${I('shield', 16)}12</span></span>
      <span class="hk-badge prevBadge" title="10 + Wisdom modifier"><span class="hk-badge__l">Passive Perception</span><span class="hk-badge__v">${I('owl', 16)}11</span></span>
      <span class="hk-badge prevBadge" title="Strength × 15"><span class="hk-badge__l">Carrying capacity</span><span class="hk-badge__v">${I('weight', 16)}255 lb</span></span>
      <span class="hk-badge prevBadge" title="Hit die + Constitution modifier, once a class is chosen"><span class="hk-badge__l">Hit points</span><span class="hk-badge__v" style="color:var(--text-on-leather-3)">${I('heart', 16)}after class</span></span>
    </div>
    <div class="diceTray"><button class="trayToggle" type="button" aria-expanded="false" aria-controls="trayBody">${I('rolling-dices', 18)}<span>Dice tray</span><span class="hk-hint">4d6, drop the lowest</span><span style="flex:1 1 auto"></span>${I('entry-door', 14)}</button><div id="trayBody" hidden></div><button class="hk-btn hk-btn--ghost" type="button" disabled title="Switch to Roll to use the tray">${I('perspective-dice-six-faces-random', 14)}Roll all six</button></div>`;
  return page({ cur: 3, ans: { name: HERO.name, species: 'Elf', background: 'Soldier' }, cls: null, body, strap: { n: 4, label: 'Ability scores' } });
}

// ======================================================================
// W05 — Class (Fighter chosen; Paladin drawer open)
// ======================================================================
function w05() {
  const tipD6 = TIP('Hit die d6', '6 hit points at level 1 plus Constitution; the smallest die', 'hk-tip--above');
  const cards = classes.map((c, i) => {
    const prim = c.primaryAbility.map(AB).join(c.name === 'Fighter' || c.name === 'Monk' || c.name === 'Ranger' ? ' or ' : ' and ');
    const hd = c.name === 'Sorcerer' ? `<span class="hk-chip hk-has-tip" aria-describedby="${tipD6.id}" tabindex="0">${I('heart', 12)}d${c.hitDie}${tipD6.html}</span>` : chip(`d${c.hitDie}`, 'heart', ` title="Hit die d${c.hitDie}: ${c.hitDie} hit points at level 1 plus Constitution"`);
    return card({
      icon: CLASS_ICON[c.name], title: c.name, seed: i + 1, desc: l1Features(c).join(' · '),
      tags: hd + chip(prim, ABIL_ICON[c.primaryAbility[0]], ` title="Primary ability: ${c.primaryAbility.map((k) => ABIL[k]).join(' / ')}"`) + chip(c.saves.map(AB).join(' · '), 'checked-shield', ` title="Saving throws: ${c.saves.map((k) => ABIL[k]).join(', ')}"`),
      state: c.name === 'Fighter' ? 'selected' : 'default',
    });
  }).join('');
  const pal = classes.find((c) => c.name === 'Paladin');
  const feats = pal.levels[0].grants.map((g) => by(g.feature)).filter(real);
  const palSpells = E.filter((e) => e.type === 'spell' && e.level === 1 && (e.classes || []).includes('paladin'));
  const palSkills = pal.skillChoice.from.map((k) => skillById(k).name);
  // Owner rule: a class feature that grants a choice shows a brass "N options" chip that opens a parchment popover
  // listing the options by name (library links) with a "See all in library" footer. Weapon Mastery is drawn open.
  const optChip = (n, label, open, controls) => `<button class="optChip" type="button" aria-expanded="${open ? 'true' : 'false'}"${controls ? ` aria-controls="${controls}"` : ''} aria-label="${label}: ${n} options${open ? ', open' : ''}">${I('checklist', 11)}${n} options</button>`;
  const wmPop = `<div class="pop" id="popWM" role="dialog" aria-label="Weapon Mastery: ${weapons.length} options">${TEX('paper')}
      <div class="popHead"><div class="hk-col" style="gap:2px;min-width:0;flex:1 1 auto"><b style="font-family:var(--font-display);font-weight:400;font-size:17px;line-height:1.1">Weapon Mastery · ${weapons.length} options</b><span class="hk-hint">Paladin picks 2 at level 1</span></div><button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="Close" title="Close (Esc)">${I('cross-mark', 11)}</button></div>
      <ul class="popList">${weapons.map((w) => `<li><a class="hk-link" href="#" title="${w.name} · ${cap(w.weapon.mastery)} · ${typeof w.weapon.damage === 'string' ? w.weapon.damage : '1'} ${w.weapon.damageType || ''} · opens in the library">${w.name}</a></li>`).join('')}</ul>
      <div class="popFoot"><a class="hk-link" href="#">${I('open-book', 14)}See all in library</a></div>
    </div>`;
  const featRows = feats.map((t) => {
    const isWM = t.name === 'Weapon Mastery';
    const text = `${esc(t.description.split('\n')[0]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').slice(0, 125)}${t.description.length > 125 ? '…' : ''}`;
    return `<li${isWM ? ' class="popAnchor"' : ''}><b>${t.name}.</b>${isWM ? optChip(weapons.length, 'Weapon Mastery', true, 'popWM') : ''} ${text}${isWM ? wmPop : ''}</li>`;
  }).join('');
  const body = `
    ${stepHead('Class', 'The class sets hit points, saves, armor and the choices that unlock as steps 6 and 7.')}
    ${pickerTop({ label: 'Search classes', placeholder: 'Search…', chips: [{ label: 'All', on: true }, { label: 'Martial', icon: 'crossed-swords' }, { label: 'Spellcasting', icon: 'spell-book' }, { label: 'Heavy armor', icon: 'chain-mail' }, { label: 'Pack: SRD 5.2.1', icon: 'chest', badge: String(classes.length) }] })}
    <div class="cards">${cards}</div>`;
  const drw = drawer({
    icon: 'templar-shield', title: 'Paladin', style: 'min-height:1030px',
    meta: chip('d10', 'heart') + chip('STR and CHA', 'muscle-up') + chip('Saves: WIS · CHA', 'checked-shield') + chip('All armor, shields', 'chain-mail') + chip('Simple, martial weapons', 'broadsword'),
    body: `<h3 class="drawerH">You would choose</h3><ul class="traitList"><li>2 skills from ${palSkills.join(', ')}${optChip(palSkills.length, 'Skills', false)}</li><li>2 weapon masteries (Weapon Mastery, below)</li><li>Prepared spells from level 1 slots: 2${optChip(palSpells.length, 'Paladin level-1 spells', false)}</li></ul>
      <p class="hk-hint" style="margin:0">Subclass (Oath) is chosen at level 3; Fighting Style at level 2.</p>
      <h3 class="drawerH">Level 1 features</h3><ul class="traitList">${featRows}</ul>`,
    actions: `<button class="hk-btn hk-btn--ghost" type="button">${I('open-book', 14)}Open in library</button><button class="hk-btn hk-btn--brass" type="button" title="Replaces Fighter">${I('check-mark', 14)}Choose Paladin</button>`,
  });
  return page({ cur: 4, ans: { name: HERO.name, species: 'Elf', background: 'Soldier', abilities: 'point buy', class: 'Fighter' }, cls: 'fighter', body, drawer: drw, strap: { n: 5, label: 'Class', picker: true } });
}

// ======================================================================
// W06 — Skills & tools (Fighter: choose 2; Soldier grants; Keen Senses)
// ======================================================================
function skillRow(k, o) {
  const s = skillById(k);
  const mod = MOD(FINAL[s.ability]);
  const prof = o.granted || o.chosen;
  const total = mod + (prof ? 2 : 0);
  const dotHint = prof ? `Proficient (+2)${o.granted ? ' · from Soldier' : ''}` : 'Not proficient';
  const dot = o.dotTip
    ? `<span class="hk-dot${prof ? ' hk-dot--on' : ''} hk-has-tip" role="img" aria-label="${dotHint}" aria-describedby="${o.dotTip.id}" tabindex="0">${o.dotTip.html}</span>`
    : `<span class="hk-dot${prof ? ' hk-dot--on' : ''}" role="img" aria-label="${dotHint}" title="${dotHint}"></span>`;
  const cls = `skl${o.chosen ? ' skl--on' : ''}${o.granted || o.blocked ? ' skl--off' : ''}${o.focus ? ' hk-focus-demo' : ''}`;
  // A disabled row explains itself on hover only: a padlock glyph with the reason as its hint.
  const why = (o.granted || o.blocked) ? `<span class="sklLock${o.tip ? ' hk-has-tip' : ''}" role="img" aria-label="${o.why}" title="${o.why}"${o.tip ? ` aria-describedby="${o.tip.id}" tabindex="0"` : ''}>${I('padlock', 13)}${o.tip ? o.tip.html : ''}</span>` : '';
  return `<label class="${cls}"${o.granted || o.blocked ? ` title="${o.why}"` : ''}><input type="checkbox" class="hk-sr" name="${o.group}"${o.chosen || o.granted ? ' checked' : ''}${o.granted || o.blocked ? ' disabled' : ''}>${dot}<span class="sklName"><span style="display:inline-flex;align-items:center;gap:6px">${s.name}${why}</span></span><span class="hk-hint" style="font-size:13px">${AB(s.ability)}</span><b class="hk-num" style="font-size:18px;min-width:34px;text-align:right">${sign(total)}</b></label>`;
}
function w06() {
  const fi = classes.find((c) => c.name === 'Fighter');
  const tip = TIP('Already proficient from Soldier', 'the background grants Athletics and Intimidation', 'tipR');
  const dotTip = TIP('Not proficient', 'pick it to add +2');
  const sets = ['gaming-set-dice', 'gaming-set-dragonchess', 'gaming-set-playing-cards', 'gaming-set-three-dragon-ante'].map((id) => by('srd-5e-2024:item/' + id));
  const rows = fi.skillChoice.from.map((k, i) => skillRow(k, {
    group: 'fsk', chosen: k === 'perception', granted: k === 'athletics' || k === 'intimidation', why: 'Already proficient from Soldier', tip: k === 'athletics' ? tip : null, focus: k === 'survival', dotTip: k === 'survival' ? dotTip : null,
  })).join('');
  const keen = ['insight', 'perception', 'survival'].map((k) => skillRow(k, { group: 'keen', blocked: k === 'perception', why: 'Already chosen as a Fighter skill' })).join('');
  const body = `
    ${stepHead('Skills &amp; tools')}
    <div class="skGrid">
      <section class="skSection" aria-labelledby="skT1">
        <div class="skHead"><h2 class="hk-leaf__title" id="skT1" style="font-size:20px">${I('crossed-swords', 20)}Choose 2 skills for Fighter</h2><span class="counter counter--warn" aria-live="polite">${I('medal', 14)}1 of 2 chosen</span></div>
        <div class="sklList sklList--one">${rows}</div>
      </section>
      <div class="hk-col" style="gap:16px;min-width:0">
        <section class="skSection" aria-labelledby="skT2">
          <div class="skHead"><h2 class="hk-leaf__title" id="skT2" style="font-size:20px">${I('cog', 20)}Tool proficiency from Soldier</h2><span class="counter counter--ok">${I('check-mark', 13)}1 of 1 chosen</span></div>
          <span class="hk-hint" style="margin-top:-4px">Choose one kind of Gaming Set.</span>
          <div class="hk-row" role="radiogroup" aria-label="Gaming set" style="gap:6px">${sets.map((s, i) => `<label class="hk-chip hk-chip--l hk-chip--btn${i === 0 ? ' hk-chip--selected' : ''}"><input type="radio" name="gset" class="hk-sr"${i === 0 ? ' checked' : ''}>${I('dice-six-faces-six', 14)}${s.name.replace('Gaming Set, ', '').replace('Gaming Set (', '').replace(')', '')}</label>`).join('')}</div>
        </section>
        <section class="skSection" aria-labelledby="skT3">
          <div class="skHead"><h2 class="hk-leaf__title" id="skT3" style="font-size:20px">${I('elf-helmet', 20)}Keen Senses from Elf</h2><span class="counter counter--warn">${I('medal', 14)}0 of 1 chosen</span></div>
          <span class="hk-hint" style="margin-top:-4px">You have proficiency in the Insight, Perception, or Survival skill.</span>
          <div class="sklList sklList--one">${keen}</div>
        </section>
        <div class="hk-block"><b style="font-size:15px">Granted without a choice</b><div class="hk-row" style="gap:6px">${chip('Athletics', 'medal', ' title="From Soldier"')}${chip('Intimidation', 'medal', ' title="From Soldier"')}${chip('Savage Attacker', 'laurel-crown', ' title="Origin feat from Soldier"')}${chip('Common, Elvish', 'conversation', ' title="Languages from Elf"')}</div></div>
      </div>
    </div>`;
  return page({ cur: 5, ans: { name: HERO.name, species: 'Elf', background: 'Soldier', abilities: 'point buy', class: 'Fighter' }, cls: 'fighter', body, invalid: 'needs 1 more skill', strap: { n: 6, label: 'Skills & tools', nextDisabled: '2 picks left: a Fighter skill, Keen Senses' } });
}

// ======================================================================
// W07 — Fighting style & weapon masteries (Fighter)
// ======================================================================
function w07() {
  const gate = TIP('Firearms are off in The Emberfall Company', 'DM’s house rule · ask the DM to allow them');
  const sapTip = TIP('Sap', MASTERY_TEXT.sap, 'tipWrap');
  const styleCards = styles.map((s, i) => card({
    icon: { Archery: 'bow-arrow', Defense: 'shield', 'Great Weapon Fighting': 'two-handed-sword', 'Two-Weapon Fighting': 'crossed-swords' }[s.name], title: s.name, seed: i + 4,
    desc: esc(s.description.replace(/_Prerequisite.*$/, '').trim()), tags: chip('Fighting Style feat', 'laurel-crown'),
    state: s.name === 'Defense' ? 'selected' : 'default',
  })).join('');
  const seeded = ['Greatsword', 'Flail'];
  const rows = weapons.map((w, i) => {
    const gated = w.name === 'Musket' || w.name === 'Pistol';
    const on = seeded.includes(w.name);
    const kind = w.weapon.kind === 'ranged' ? 'ranged' : 'melee';
    const dmg = typeof w.weapon.damage === 'string' ? w.weapon.damage : (w.weapon.damage && w.weapon.damage.flat) || '—';
    const mTag = w.name === 'Spear' ? `<span class="hk-chip hk-has-tip" aria-describedby="${sapTip.id}" tabindex="0" style="height:20px;font-size:13px">${cap(w.weapon.mastery)}${sapTip.html}</span>` : `<span class="hk-chip" style="height:20px;font-size:13px" title="${cap(w.weapon.mastery)}: ${MASTERY_TEXT[w.weapon.mastery]}">${cap(w.weapon.mastery)}</span>`;
    const gateText = 'Firearms are off in The Emberfall Company (DM’s house rule)';
    const lock = gated ? `<span class="sklLock${w.name === 'Musket' ? ' hk-has-tip' : ''}" role="img" aria-label="${gateText}" title="${gateText}"${w.name === 'Musket' ? ` aria-describedby="${gate.id}" tabindex="0"` : ''}>${I('padlock', 13)}${w.name === 'Musket' ? gate.html : ''}</span>` : '';
    return `<label class="wrow${on ? ' wrow--on' : ''}${gated ? ' wrow--off' : ''}" title="${gated ? gateText : on ? 'Chosen · pre-filled from the Fighter’s kit' : w.name}"><input type="checkbox" class="hk-sr" name="mastery"${on ? ' checked' : ''}${gated ? ' disabled' : ''}><span class="hk-iring" style="width:30px;height:30px">${I(WEAPON_ICON[w.name], 17)}</span><span class="wName"><span style="display:inline-flex;align-items:center;gap:6px">${w.name}${lock}</span><span class="hk-hint" style="font-size:13px">${w.weapon.category} · ${kind} · ${dmg} ${w.weapon.damageType || ''}</span></span>${mTag}${on ? SEAL({ icon: 'check-mark', size: 24, label: 'Chosen · pre-filled from the Fighter’s kit', seed: i % 7 + 1 }) : '<span class="wRing" aria-hidden="true"></span>'}</label>`;
  }).join('');
  const body = `
    ${stepHead('Fighting style &amp; weapon masteries')}
    <section aria-labelledby="fsT">
      <div class="skHead"><h2 class="hk-leaf__title" id="fsT" style="font-size:20px">${I('laurel-crown', 20)}Fighting style</h2><span class="counter counter--ok">${I('check-mark', 13)}1 of 1 chosen</span></div>
      <div class="cards cards4">${styleCards}</div>
    </section>
    <div class="hk-rule"></div>
    <section aria-labelledby="wmT">
      <div class="skHead"><h2 class="hk-leaf__title" id="wmT" style="font-size:20px">${I('broadsword', 20)}Weapon masteries</h2><span class="counter counter--warn" aria-live="polite" title="Fighter: 3 at level 1; change them after any long rest">${I('medal', 14)}2 of 3 chosen</span></div>
      ${pickerTop({ label: 'Search weapons', placeholder: 'Search…', chips: [{ label: 'All', on: true, badge: String(weapons.length) },{ label: 'Simple' }, { label: 'Martial' }, { label: 'Melee', icon: 'broadsword' }, { label: 'Ranged', icon: 'bow-arrow' }, { label: 'Sap' }, { label: 'Slow' }, { label: 'Graze' }, { label: 'Topple' }, { label: 'Vex' }, { label: 'Nick' }, { label: 'Push' }, { label: 'Cleave' }] })}
      <div class="wGrid">${rows}</div>
    </section>`;
  return page({ cur: 6, ans: { name: HERO.name, species: 'Elf', background: 'Soldier', abilities: 'point buy', class: 'Fighter', skills: 'Perception, Survival' }, cls: 'fighter', body, strap: { n: 7, label: 'Fighting style & masteries', picker: true, nextDisabled: 'Choose 1 more weapon mastery' } });
}

// ======================================================================
// W08 — Spells (Cleric path): cantrips known, level-1 prepared, drawer
// ======================================================================
function spellRow(s, o) {
  const icon = SPELL_ICON[s.name] || 'spell-book';
  // Concentration = the orb glyph (arcane), ritual = a small R chip; both explain themselves on hover.
  const orb = s.concentration ? (o.cTip
    ? `<span class="orb hk-has-tip" role="img" aria-label="Concentration" aria-describedby="${o.cTip.id}" tabindex="0">${I('concentration-orb', 16)}${o.cTip.html}</span>`
    : `<span class="orb" role="img" aria-label="Concentration" title="Concentration: only one such spell at a time; taking damage forces a save to keep it">${I('concentration-orb', 16)}</span>`) : '';
  const ritual = s.ritual ? `<span class="hk-chip" style="height:20px;font-size:12px" role="img" aria-label="Ritual" title="Ritual: can be cast in 10 extra minutes without a slot">R</span>` : '';
  const school = `<span class="schoolDot" style="--dmg:var(--damage-${{ abjuration: 'cold', divination: 'radiant', enchantment: 'psychic', evocation: 'fire', necromancy: 'necrotic', transmutation: 'acid' }[s.school]})" role="img" aria-label="${cap(s.school)}" title="${cap(s.school)}"></span>`;
  const toggle = o.cantrip
    ? `<input type="checkbox" class="hk-sr" name="cantrip"${o.on ? ' checked' : ''}${o.off ? ' disabled' : ''}>`
    : `<input type="checkbox" class="hk-sr" name="prep"${o.on ? ' checked' : ''}>`;
  // One marker everywhere: the tick seal, with the hint naming what it means.
  const seal = o.on ? SEAL({ icon: 'check-mark', size: 24, label: o.cantrip ? 'Known cantrip' : 'Prepared', hint: o.cantrip ? 'Known cantrip' : 'Prepared', seed: (s.name.length % 7) + 1 }) : `<span class="wRing" aria-hidden="true"></span>`;
  const lock = o.off ? `<span class="sklLock" role="img" aria-label="${o.why}" title="${o.why}">${I('padlock', 13)}</span>` : '';
  return `<label class="wrow spRow${o.on ? ' wrow--on' : ''}${o.off ? ' wrow--off' : ''}${o.sel ? ' spRow--sel' : ''}"${o.off ? ` title="${o.why}"` : ''}>${toggle}<span class="hk-iring" style="width:30px;height:30px">${I(icon, 16)}</span><span class="wName"><span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${school}${s.name}${lock}${orb}${ritual}</span></span><button class="hk-ico hk-ico--leaf hk-ico--s${o.sel ? ' hk-ico--on' : ''}" type="button" aria-label="${s.name}: open description" title="Description">${I('info', 13)}</button>${seal}</label>`;
}
function w08() {
  const cantrips = clericSpells.filter((s) => s.level === 0);
  const l1 = clericSpells.filter((s) => s.level === 1);
  const known = ['Guidance', 'Sacred Flame', 'Thaumaturgy'];
  const prepared = ['Bless', 'Cure Wounds', 'Guiding Bolt'];
  const hw = l1.find((s) => s.name === 'Healing Word');
  const cTip = TIP('Concentration', 'one such spell at a time; taking damage forces a save to keep it');
  const body = `
    ${stepHead('Spells', '', `<div class="hk-row" style="gap:6px"><span class="hk-chip hk-chip--l" title="Spellcasting ability">${I('owl', 14)}Wisdom</span><span class="hk-chip hk-chip--l" title="8 + proficiency + Wisdom modifier">Save DC 13</span><span class="hk-chip hk-chip--l" title="proficiency + Wisdom modifier">Spell attack +5</span></div>`)}
    ${pickerTop({ label: 'Search spells', placeholder: 'Search…', chips: [{ label: 'All', on: true, badge: String(clericSpells.length) }, { label: 'Abjuration' }, { label: 'Divination' }, { label: 'Enchantment' }, { label: 'Evocation' }, { label: 'Necromancy' }, { label: 'Transmutation' }, { label: 'Concentration', icon: 'concentration-orb' }, { label: 'Ritual' }, { label: 'Pack: SRD 5.2.1', icon: 'chest', badge: String(clericSpells.length) }] })}
    <div class="spGrid">
      <section aria-labelledby="cT">
        <div class="skHead"><h2 class="hk-leaf__title" id="cT" style="font-size:20px">${I('sparkles', 20)}Cantrips</h2><span class="counter counter--ok" title="Cleric knows 3 cantrips at level 1">${I('check-mark', 13)}3 of 3 known</span></div>
        <div class="sklList sklList--one">${cantrips.map((s) => spellRow(s, { cantrip: true, on: known.includes(s.name), off: !known.includes(s.name), why: 'All 3 cantrips known; unlearn one to pick this' })).join('')}</div>
      </section>
      <section aria-labelledby="l1T">
        <div class="skHead"><h2 class="hk-leaf__title" id="l1T" style="font-size:20px">${I('spell-book', 20)}Level 1 · prepared</h2><span class="counter counter--warn" aria-live="polite" title="Cleric prepares 4 spells at level 1; change them after a long rest">${I('medal', 14)}3 of 4 prepared</span><span class="hk-seal-row" role="group" aria-label="Spell slots, level 1: 2 of 2" title="Spell slots, level 1 — 2 of 2">${SEAL({ text: 'I', size: 22, seed: 1 })}${SEAL({ text: 'I', size: 22, seed: 2 })}</span></div>
        <div class="sklList sklList--one">${l1.map((s) => spellRow(s, { on: prepared.includes(s.name), sel: s.name === 'Healing Word', cTip: s.name === 'Shield of Faith' ? cTip : null })).join('')}</div>
      </section>
    </div>`;
  const drw = drawer({
    icon: SPELL_ICON['Healing Word'], title: 'Healing Word',
    meta: chip('Level 1') + chip(cap(hw.school)) + chip('Bonus action') + chip('60 ft') + chip('V') + chip('Instantaneous'),
    body: `<p>${esc(hw.description)}</p><p><b>Using a higher-level spell slot.</b> ${esc(hw.higherLevels || '')}</p><p class="hk-hint">Cleric spell list · also Bard, Druid</p>
      <div class="hk-block"><b style="font-size:15px">Prepared so far · 3 of 4</b><div class="hk-row" style="gap:6px">${chip('Bless', 'prayer')}${chip('Cure Wounds', 'healing')}${chip('Guiding Bolt', 'bolt-spell-cast')}</div></div>`,
    actions: `<button class="hk-btn hk-btn--ghost" type="button">${I('open-book', 14)}Open in library</button><button class="hk-btn hk-btn--brass" type="button" title="Uses the 4th prepared slot">${I('spell-book', 14)}Prepare</button>`,
  });
  return page({ cur: 6, ans: { name: HERO.name, species: 'Elf', background: 'Soldier', abilities: 'point buy', class: 'Cleric', skills: 'Insight, Medicine' }, cls: 'cleric', body, drawer: drw, strap: { n: 7, label: 'Spells', picker: true, filterOn: false } });
}

// ======================================================================
// W09 — Equipment (Fighter kit A / B / gold; bag preview)
// ======================================================================
const KIT = {
  A: { title: 'Option A', items: [['Chain Mail', 1], ['Greatsword', 1], ['Flail', 1], ['Javelin', 8], ['Dungeoneer’s Pack', 1]], gp: 4, icon: 'chain-mail', note: 'Heavy armor, two-handed · AC 16' },
  B: { title: 'Option B', items: [['Studded Leather Armor', 1], ['Scimitar', 1], ['Shortsword', 1], ['Longbow', 1], ['Arrows', 20], ['Quiver', 1], ['Dungeoneer’s Pack', 1]], gp: 11, icon: 'bow-arrow', note: 'Light armor, ranged · AC 14' },
};
const ITEM_ICON = { 'Chain Mail': 'chain-mail', Greatsword: 'two-handed-sword', Flail: 'flail', Javelin: 'thrown-spear', 'Dungeoneer’s Pack': 'knapsack', 'Studded Leather Armor': 'leather-vest', Scimitar: 'sword-slice', Shortsword: 'gladius', Longbow: 'bow-arrow', Arrows: 'arrow-flights', Quiver: 'quiver' };
function kitCard(key, selected) {
  const k = KIT[key];
  return `<article class="hk-card cardF kitCard${selected ? ' hk-card--selected' : ''}">${TEX('paper')}${selected ? `<span class="hk-card__seal">${SEAL({ icon: 'check-mark', size: 30, label: 'Chosen', seed: 5 })}</span>` : ''}
    <div class="hk-card__head">${I(k.icon, 22)}<span class="hk-card__title">${k.title}</span><span class="hk-hint">${k.note}</span></div>
    <ul class="kitList">${k.items.map(([n, q]) => `<li>${I(ITEM_ICON[n] || 'swap-bag', 14)}<span>${n}</span>${q > 1 ? `<span class="hk-plate" style="height:18px;font-size:13px">×${q}</span>` : ''}</li>`).join('')}<li>${I('two-coins', 14)}<span>${k.gp} gp</span></li></ul>
    <div class="cardAct" style="margin-top:auto"><span style="flex:1 1 auto"></span>${selected ? `<button class="hk-btn hk-btn--parchment" type="button" style="height:28px" disabled title="Option ${key} is in the bag below">${I('check-mark', 13)}Chosen</button>` : `<button class="hk-btn hk-btn--brass" type="button" style="height:28px">Choose ${key}</button>`}</div>
  </article>`;
}
function bagRow(name, qty, weight, o) {
  const tag = o.equipped ? `<span class="hk-tagE" role="img" aria-label="Equipped" title="Equipped · worn or wielded, counts toward AC and attacks" style="position:static">E</span>` : '';
  const eq = o.equippable ? `<button class="hk-toggle" type="button" role="switch" aria-checked="${o.equipped ? 'true' : 'false'}" aria-label="${o.equipped ? 'Unequip' : 'Equip'} ${name}" title="${o.equipped ? 'Unequip' : 'Equip'}"><span class="hk-toggle__track"><span class="hk-toggle__knob"></span></span><span style="font-size:14px;color:var(--text-2);min-width:62px">${o.equipped ? 'Equipped' : 'Equip'}</span></button>` : `<span class="hk-hint" style="min-width:118px;display:inline-flex;align-items:center;gap:4px">${I('swap-bag', 12)}carried</span>`;
  return `<div class="bagRow"><span class="hk-iring">${I(ITEM_ICON[name] || 'swap-bag', 16)}</span><span class="hk-item__name"><span style="display:flex;align-items:center;gap:6px">${name}${tag}</span><span class="hk-item__sub">${o.sub}</span></span><div class="hk-numfield hk-numfield--leaf" style="grid-template-columns:28px 44px 28px;gap:2px"><button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="${name}: one fewer" title="−1" style="width:28px;height:28px"${qty <= 1 ? ' disabled' : ''}>${I('minus', 12)}</button><input class="hk-numfield__in" type="number" value="${qty}" min="0" aria-label="${name} quantity" style="height:28px;font-size:17px"><button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="${name}: one more" title="+1" style="width:28px;height:28px">${I('plus', 12)}</button></div><span class="hk-num" style="font-size:15px;min-width:44px;text-align:right" title="Weight">${weight} lb</span>${eq}<button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="${name}: details" title="Details">${I('info', 13)}</button><button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="Remove ${name} from the bag" title="Remove from bag" style="color:var(--danger-strong)">${I('cross-mark', 11)}</button></div>`;
}
function w09() {
  // Owner rule: starting gold is a house-rule-gated option; Maelis is being made for The Emberfall Company, where it is off.
  const goldGate = 'Starting gold is off in The Emberfall Company — ask your DM';
  const gTip = TIP('Starting gold is off in The Emberfall Company', 'ask your DM', 'hk-tip--left');
  const body = `
    ${stepHead('Equipment')}
    <div class="kitGrid">${kitCard('A', true)}${kitCard('B', false)}
      <article class="hk-card cardF kitCard hk-card--gated" aria-disabled="true">${TEX('paper')}<div class="hk-card__head">${I('two-coins', 22)}<span class="hk-card__title">Option C</span><span class="hk-hint">Gold only</span><span class="hk-card__gate hk-has-tip" role="img" aria-label="${goldGate}" title="${goldGate}" aria-describedby="${gTip.id}" tabindex="0">${I('padlock', 15)}${gTip.html}</span></div>
        <div class="goldWell" style="opacity:.6"><b class="hk-num" style="font-size:40px">155</b><span style="font-family:var(--font-display);font-size:18px">gp</span></div>
        <div class="cardAct" style="margin-top:auto"><span style="flex:1 1 auto"></span><button class="hk-btn hk-btn--brass" type="button" style="height:28px" disabled title="${goldGate}" aria-label="Choose C (${goldGate})">Choose C</button></div>
      </article>
    </div>
    <div class="hk-rule"></div>
    <section aria-labelledby="bagT" class="hk-col" style="gap:6px">
      <div class="skHead"><h2 class="hk-leaf__title" id="bagT" style="font-size:20px">${I('swap-bag', 20)}Your bag</h2><span class="hk-chip hk-chip--l" title="Carried weight 134 of 255 lb · Strength 17 × 15 · lightly loaded up to 85, heavy from 170">${I('weight', 14)}134 / 255 lb · lightly loaded</span><span class="hk-chip hk-chip--l" title="Armor class: 16 from Chain Mail + 1 from the Defense style">${I('shield', 14)}AC 17</span><span style="flex:1 1 auto"></span><button class="hk-btn hk-btn--ghost hk-btn--dashed" type="button">${I('plus', 14)}Add from library</button></div>
      <div class="bagList">
        ${bagRow('Chain Mail', 1, 55, { sub: 'heavy armor · AC 16 · Stealth disadvantage · 75 gp', equippable: true, equipped: true })}
        ${bagRow('Greatsword', 1, 6, { sub: 'martial melee · 2d6 slashing · heavy, two-handed · mastery Graze', equippable: true, equipped: true })}
        ${bagRow('Flail', 1, 2, { sub: 'martial melee · 1d8 bludgeoning · mastery Sap', equippable: true, equipped: false })}
        ${bagRow('Javelin', 8, 16, { sub: 'simple melee · 1d6 piercing · thrown 30/120 · mastery Slow', equippable: true, equipped: false })}
        ${bagRow('Dungeoneer’s Pack', 1, 55, { sub: 'backpack, caltrops, crowbar, hammer, pitons, oil, rations, rope, tinderbox, torches, waterskin' })}
      </div>
      <div class="coinRow">${TEX('leather')}<span class="hk-strap__label" style="font-size:15px">${I('two-coins', 16)}Coins</span>
        <span class="coin coin--pp"><b class="hk-num">0</b><small>pp</small></span><span class="coin coin--gp"><b class="hk-num">4</b><small>gp</small></span><span class="coin coin--sp"><b class="hk-num">0</b><small>sp</small></span><span class="coin coin--cp"><b class="hk-num">0</b><small>cp</small></span>
        <span style="flex:1 1 auto"></span><button class="hk-btn hk-btn--ghost-leather" type="button">${I('quill', 14)}Edit coins</button></div>
    </section>`;
  return page({ cur: 7, ans: { name: HERO.name, species: 'Elf', background: 'Soldier', abilities: 'point buy', class: 'Fighter', skills: 'Perception, Survival', choices: 'Defense · 3 masteries' }, cls: 'fighter', body, strap: { n: 8, label: 'Equipment' } });
}

// ======================================================================
// W10 — Review
// ======================================================================
function revGroup(icon, title, step, rows) {
  return `<section class="revGroup" aria-labelledby="rg${step}"><div class="revHead"><h2 class="hk-leaf__title" id="rg${step}" style="font-size:19px">${I(icon, 18)}${title}</h2><a class="hk-link revEdit" href="#" aria-label="Edit ${title} (step ${step})">${I('quill', 13)}Edit</a></div>${rows.map(([k, v]) => `<div class="revRow"><span class="revK">${k}</span><span class="revV">${v}</span></div>`).join('')}</section>`;
}
function w10() {
  const ppTip = TIP('Passive Perception 13', '10 + Wisdom +1 + proficiency +2 (Perception)', 'hk-tip--above');
  const seals = Object.keys(BASE).map((k, i) => `<span class="revAbil" title="${ABIL[k]} ${FINAL[k]} (${BASE[k]}${BONUS[k] ? ' + ' + BONUS[k] : ''}), modifier ${sign(MOD(FINAL[k]))}">${SEAL({ text: sign(MOD(FINAL[k])), size: 40, seed: i + 1, label: `${ABIL[k]} modifier ${sign(MOD(FINAL[k]))}` })}<span class="hk-hint" style="font-size:12px">${AB(k)}</span><span class="hk-plate" style="height:18px;font-size:13px">${FINAL[k]}</span></span>`).join('');
  const body = `
    ${stepHead('Review')}
    <div class="derived">${TEX('leather')}
      <span class="hk-badge"><span class="hk-badge__l">Hit points</span><span class="hk-badge__v">${I('heart', 18)}12</span></span>
      <span class="hk-badge" title="16 from Chain Mail + 1 from the Defense style"><span class="hk-badge__l">Armor class</span><span class="hk-badge__v">${I('shield', 18)}17</span></span>
      <span class="hk-badge" title="Proficiency bonus +2 at level 1"><span class="hk-badge__l">Proficiency</span><span class="hk-badge__v">${I('medal', 18)}+2</span></span>
      <span class="hk-badge" title="Elf: 30 ft"><span class="hk-badge__l">Speed</span><span class="hk-badge__v">${I('running-shoe', 18)}30 ft</span></span>
      <span class="hk-badge" title="Dexterity modifier +2"><span class="hk-badge__l">Initiative</span><span class="hk-badge__v">${I('stopwatch', 18)}+2</span></span>
      <span class="hk-badge hk-has-tip" aria-describedby="${ppTip.id}" tabindex="0"><span class="hk-badge__l">Passive Perception</span><span class="hk-badge__v">${I('owl', 18)}13</span>${ppTip.html}</span>
      <span style="flex:1 1 auto"></span>
      <div class="hk-col" style="gap:4px;align-items:flex-end"><span style="font-family:var(--font-display);font-size:22px;color:var(--text-on-leather)">${HERO.name}</span><span style="font-size:14px;color:var(--text-on-leather-2)">Elf · Fighter 1 · Soldier</span></div>
    </div>
    <div class="revGrid">
      ${revGroup('quill', 'Name & concept', 1, [['Name', HERO.name], ['Grammatical form', 'Feminine'], ['Portrait', `<span class="hk-hint">none · monogram ${HERO.mono}</span>`], ['Content packs', `${chip('SRD 5.2.1 (2024 rules) v0.1.0', 'padlock', ' title="Core · always on"')} ${chip('My homebrew v0.1.0', 'pin', ' title="Pinned"')}`]])}
      ${revGroup('elf-helmet', 'Species', 2, [['Species', 'Elf'], ['Traits', 'Darkvision, Elven Lineage, Fey Ancestry, Keen Senses, Trance'], ['Keen Senses', 'Insight'], ['Languages', 'Common, Elvish']])}
      ${revGroup('medal', 'Background', 3, [['Background', 'Soldier'], ['Skills', 'Athletics, Intimidation'], ['Tool', 'Gaming Set (Dice)'], ['Origin feat', 'Savage Attacker'], ['Ability bonuses', '+2 Strength, +1 Constitution']])}
      ${revGroup('muscle-up', 'Ability scores', 4, [['Method', 'Point buy · 27 / 27 points'], ['Scores', `<span class="revAbils">${seals}</span>`]])}
      ${revGroup('crossed-swords', 'Class', 5, [['Class', 'Fighter · level 1'], ['Hit die', 'd10'], ['Saves', 'Strength, Constitution'], ['Features', 'Fighting Style, Second Wind, Weapon Mastery']])}
      ${revGroup('medal', 'Skills & tools', 6, [['Fighter skills', 'Perception, Survival'], ['Tool', 'Gaming Set (Dice)'], ['All proficiencies', `${['Athletics', 'Insight', 'Intimidation', 'Perception', 'Survival'].map((s) => chip(s, null)).join(' ')}`]])}
      ${revGroup('laurel-crown', 'Fighting style & masteries', 7, [['Fighting style', 'Defense (+1 AC in armor)'], ['Weapon masteries', `${chip('Greatsword · Graze', 'two-handed-sword')} ${chip('Flail · Sap', 'flail')} ${chip('Javelin · Slow', 'thrown-spear')}`]])}
      ${revGroup('swap-bag', 'Equipment', 8, [['Kit', 'Option A'], ['Bag', 'Chain Mail (equipped), Greatsword (equipped), Flail, Javelin ×8, Dungeoneer’s Pack'], ['Coins', '4 gp'], ['Weight', '134 / 255 lb · lightly loaded']])}
    </div>`;
  return page({ cur: 8, ans: { name: HERO.name, species: 'Elf', background: 'Soldier', abilities: 'point buy', class: 'Fighter', skills: 'Perception, Survival', choices: 'Defense · 3 masteries', equipment: 'Option A' }, cls: 'fighter', body, strap: { n: 9, label: 'Review', next: 'Create hero', focus: true } });
}

// ======================================================================
// Phone boards (uk)
// ======================================================================
function phoneShell(o) {
  const back = o.backDisabled ? `<button class="hk-btn hk-btn--leather hk-btn--phone" type="button" style="padding:0 12px" disabled title="${o.backDisabled}" aria-label="Назад (${o.backDisabled})">${I('exit-door', 18)}Назад</button>` : `<button class="hk-btn hk-btn--leather hk-btn--phone" type="button" style="padding:0 12px">${I('exit-door', 18)}Назад</button>`;
  const nextLabel = o.next || 'Далі';
  const next = o.nextDisabled ? `<button class="hk-btn hk-btn--brass hk-btn--phone" type="button" style="flex:1 1 auto;min-width:0" disabled title="${o.nextDisabled}" aria-label="${nextLabel} (${o.nextDisabled})">${I('entry-door', 18)}${nextLabel}</button>` : `<button class="hk-btn hk-btn--brass hk-btn--phone" type="button" style="flex:1 1 auto;min-width:0">${I(o.next === 'Створити героя' ? 'wax-seal' : 'entry-door', 18)}${nextLabel}</button>`;
  const strapP = `<footer class="hk-astrap" aria-label="Дії" style="flex:0 0 auto;z-index:5">${TEX('leather')}<div class="hk-rivets"></div>
    <div class="phStrap">
      <button class="hk-ico hk-ico--phone" type="button" aria-label="Скасувати" title="Скасувати">${I('cross-mark', 16)}</button>
      ${back}
      <span class="hk-astrap__divider" aria-hidden="true" style="height:30px"></span>
      ${next}
      ${o.picker ? `<span class="hk-astrap__divider" aria-hidden="true" style="height:30px"></span><button class="hk-ico hk-ico--phone" type="button" aria-label="Ще: фільтр, пошук" title="Ще" aria-haspopup="dialog">${I('funnel', 20)}</button>` : ''}
    </div><div class="hk-rivets"></div></footer>`;
  return `<div class="ph" lang="uk" data-theme="tavern">${DEFS}${TEX('wood')}<div class="hk-vignette" aria-hidden="true"></div>
    <header class="hk-topbar">${TEX('leather')}<button class="hk-ico hk-ico--phone" type="button" aria-label="Меню" title="Меню">${I('scroll-unfurled', 22)}</button><div class="hk-topbar__title">Новий герой</div><button class="hk-ico hk-ico--phone" type="button" aria-label="Герой поки що" title="Герой поки що" style="font-family:var(--font-display);font-size:15px;color:var(--brass-top)">${HERO.monoUk}</button></header>
    <div class="hk-stepstrip" role="group" aria-label="Крок ${o.n} з 9: ${o.label}" style="border-radius:0;box-shadow:inset 0 -1px 0 var(--border-brass)">${TEX('leather')}<button class="hk-ico hk-ico--phone" type="button" aria-label="Усі кроки" title="Усі кроки" aria-haspopup="dialog">${I('checklist', 20)}</button><div class="hk-col" style="gap:2px;flex:1 1 auto;min-width:0"><span class="hk-stepstrip__count">Крок ${o.n} з 9</span><span class="hk-stepstrip__label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o.label}</span></div><div class="hk-gauge hk-gauge--thin" style="width:80px" role="progressbar" aria-valuemin="1" aria-valuemax="9" aria-valuenow="${o.n}" aria-label="Крок ${o.n} з 9"><div class="hk-gauge__xp" style="width:${Math.round(o.n / 9 * 100)}%"></div></div></div>
    <div class="phBody" data-scroller="body">${o.body}</div>
    ${o.sheet || ''}
    ${strapP}
  </div>`;
}

function w02phone() {
  const cards = species.map((s, i) => `<article class="hk-card cardF phCard${s.name === 'Elf' ? ' hk-card--selected' : ''}">${TEX('paper')}${s.name === 'Elf' ? `<span class="hk-card__seal" style="top:-8px;right:-6px">${SEAL({ icon: 'check-mark', size: 28, label: 'Обрано', seed: 3 })}</span>` : ''}
    <button class="cardOpen" type="button" aria-label="${SPECIES_UK[s.name]}: опис"><div class="hk-card__head" style="align-items:flex-start;flex-direction:column;gap:4px">${I(SPECIES_ICON[s.name], 24)}<span class="hk-card__title" style="font-size:17px;line-height:20px">${SPECIES_UK[s.name]}</span></div><div class="hk-card__desc" style="font-size:14px;line-height:18px">${traitNames(s).length} особливостей</div></button>
    <div class="hk-card__foot" style="gap:4px">${chip(s.size === 'small' ? 'Малий' : 'Середній')}${chip(`${s.speed} фт`, 'running-shoe')}</div>
  </article>`).join('');
  const body = `
    <label class="hk-search" style="height:44px">${I('magnifying-glass', 18)}<span class="hk-sr">Пошук видів</span><input class="hk-search__in" type="search" placeholder="Пошук видів…"></label>
    <div class="chipScroll" role="group" aria-label="Фільтр"><button class="hk-chip hk-chip--l hk-chip--btn hk-chip--selected" type="button" aria-pressed="true" style="height:36px">Усі</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">Малий</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">Середній</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('owl', 14)}Темний зір</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('running-shoe', 14)}35 фт</button></div>
    <div class="phCards">${cards}</div>`;
  const sheet = `<div class="hk-overlay phOverlay" aria-hidden="true"></div>
    <section class="hk-drawer hk-sheet phSheet" role="dialog" aria-labelledby="shT" aria-modal="true">${TEX('paper')}<div class="hk-sheet__grip" aria-hidden="true"></div>
      <div class="hk-drawer__head">${I('elf-helmet', 24, { style: 'color:var(--accent-strong);margin-top:3px' })}<h2 class="hk-drawer__title" id="shT">Ельф</h2><button class="hk-ico hk-ico--leaf hk-ico--phone" type="button" aria-label="Закрити" title="Закрити">${I('cross-mark', 14)}</button></div>
      <div class="hk-drawer__meta"><span class="hk-chip hk-chip--l">Середній</span><span class="hk-chip hk-chip--l">${I('running-shoe', 13)}30 фт</span><span class="hk-chip hk-chip--l">${I('owl', 13)}Темний зір 60 фт</span></div>
      <ul class="traitList" style="font-size:16px;gap:4px"><li><b>Темний зір</b> — 60 футів.</li><li><b>Ельфійський родовід</b> — заговір і заклинання за таблицею.</li><li><b>Фейське походження</b> — перевага проти стану «Зачарований».</li><li><b>Гострі чуття</b> — одна навичка, вибір на кроці 6.</li><li><b>Транс</b> — довгий відпочинок за 4 години.</li></ul>
      <div class="hk-row" style="justify-content:flex-end;gap:8px;align-items:center"><span class="hk-hint" style="margin-right:auto">SRD 5.2.1 · базові правила</span><button class="hk-btn hk-btn--ghost hk-btn--phone" type="button">${I('open-book', 15)}У бібліотеці</button><button class="hk-btn hk-btn--brass hk-btn--phone" type="button" aria-pressed="true">${I('check-mark', 15)}Обрано</button></div>
    </section>`;
  return phoneShell({ n: 2, label: 'Вид', body, sheet, picker: true });
}

function w04phone() {
  const total = Object.values(BASE).reduce((a, s) => a + COST[s], 0);
  const blocks = Object.keys(BASE).map((k, i) => {
    const base = BASE[k], bonus = BONUS[k] || 0, fin = FINAL[k], mod = MOD(fin);
    const eligible = ['str', 'dex', 'con'].includes(k);
    return `<div class="abil abilPh${eligible ? ' abil--drop' : ''}" aria-label="${ABIL_UK[k]}: ${base}${bonus ? ' + ' + bonus : ''} = ${fin}, модифікатор ${sign(mod)}">
      <div style="display:flex;align-items:center;gap:8px;width:100%"><span style="position:relative;flex:0 0 auto">${SEAL({ text: sign(mod), size: 52, label: `${ABIL_UK[k]} ${sign(mod)}`, seed: i + 1 })}${bonus ? `<span class="hk-plate hk-ability__bonus bonusTag" title="+${bonus} від передісторії Солдат">${I('plus', 10)}${bonus}</span>` : ''}</span><div class="hk-col" style="gap:2px;min-width:0;flex:1 1 auto"><span class="hk-ability__name" style="color:var(--text-1);font-size:16px">${ABIL_UK[k]}</span><span class="hk-hint" style="font-size:13px">Вартість: ${COST[base]}</span><span class="hk-plate" style="height:20px;font-size:14px;align-self:flex-start">= ${fin}</span></div></div>
      <div class="hk-numfield hk-numfield--leaf hk-numfield--phone" style="grid-template-columns:44px 52px 44px;gap:2px;width:100%;justify-content:center"><button class="hk-ico hk-ico--leaf hk-ico--phone" type="button" aria-label="${ABIL_UK[k]}: менше" title="−1"${base <= 8 ? ' disabled' : ''}>${I('minus', 16)}</button><input class="hk-numfield__in" type="number" value="${base}" min="8" max="15" aria-label="${ABIL_UK[k]}, базове значення" style="height:44px;font-size:22px"><button class="hk-ico hk-ico--leaf hk-ico--phone" type="button" aria-label="${ABIL_UK[k]}: більше" title="+1"${base >= 15 ? ' disabled' : ''}>${I('plus', 16)}</button></div>
    </div>`;
  }).join('');
  const body = `
    <div class="chipScroll" role="tablist" aria-label="Метод"><button class="hk-chip hk-chip--l hk-chip--btn" type="button" role="tab" aria-selected="false" style="height:40px">Стандартний масив</button><button class="hk-chip hk-chip--l hk-chip--btn hk-chip--selected" type="button" role="tab" aria-selected="true" style="height:40px">Купівля очок</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" role="tab" aria-selected="false" style="height:40px">Кидок</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" role="tab" aria-selected="false" style="height:40px">Вручну</button></div>
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:10px">${TEX('paper')}
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b class="hk-num" style="font-size:22px">${total} / 27 очок</b><div class="hk-gauge" style="flex:1 1 90px" role="progressbar" aria-valuemin="0" aria-valuemax="27" aria-valuenow="${total}" aria-label="Бюджет очок"><div class="hk-gauge__brass" style="width:${Math.round(total / 27 * 100)}%"></div></div></div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:15px">${I('medal', 16, { style: 'color:var(--accent-strong)' })}<span>Бонуси передісторії:</span><span class="hk-plate" style="height:24px;font-size:15px" title="+2 від передісторії Солдат · утримайте й перетягніть на печатку">${I('plus', 10)}2 Сила</span><span class="hk-plate" style="height:24px;font-size:15px" title="+1 від передісторії Солдат · утримайте й перетягніть на печатку">${I('plus', 10)}1 Статура</span></div>
      <div class="abilGridPh">${blocks}</div>
    </section>`;
  return phoneShell({ n: 4, label: 'Характеристики', body });
}

function w10phone() {
  const g = (icon, title, rows) => `<section class="hk-leaf hk-leaf--phone phGroup">${TEX('paper')}<div class="revHead"><h2 class="hk-leaf__title" style="font-size:19px">${I(icon, 18)}${title}</h2><a class="hk-link revEdit" href="#" style="font-size:16px;min-height:44px;display:inline-flex;align-items:center">${I('quill', 13)}Змінити</a></div>${rows.map(([k, v]) => `<div class="revRow" style="font-size:16px"><span class="revK">${k}</span><span class="revV">${v}</span></div>`).join('')}</section>`;
  const body = `
    <div class="derived derivedPh">${TEX('leather')}
      <span class="hk-badge"><span class="hk-badge__l">Очки здоров'я</span><span class="hk-badge__v">${I('heart', 16)}12</span></span>
      <span class="hk-badge"><span class="hk-badge__l">Клас броні</span><span class="hk-badge__v">${I('shield', 16)}17</span></span>
      <span class="hk-badge"><span class="hk-badge__l">Бонус майстерності</span><span class="hk-badge__v">${I('medal', 16)}+2</span></span>
      <span class="hk-badge"><span class="hk-badge__l">Швидкість</span><span class="hk-badge__v">${I('running-shoe', 16)}30 фт</span></span>
    </div>
    ${g('quill', "Ім'я", [["Ім'я", HERO.nameUk], ['Граматичний рід', 'Жіночий'], ['Пакети вмісту', `${chip('SRD 5.2.1 v0.1.0', 'padlock')} ${chip('Мій хоумбрю v0.1.0', 'pin')}`]])}
    ${g('elf-helmet', 'Вид', [['Вид', 'Ельф'], ['Гострі чуття', 'Проникливість']])}
    ${g('medal', 'Передісторія', [['Передісторія', 'Солдат'], ['Навички', 'Атлетика, Залякування'], ['Бонуси', '+2 Сила, +1 Статура']])}
    ${g('muscle-up', 'Характеристики', [['Купівля очок', `<span class="revAbils" style="gap:6px">${Object.keys(BASE).map((k, i) => `<span class="revAbil" style="min-width:44px"><b class="hk-num" style="font-size:20px">${FINAL[k]}</b><span class="hk-hint" style="font-size:12px">${{ str: 'СИЛ', dex: 'СПР', con: 'СТА', int: 'ІНТ', wis: 'МДР', cha: 'ХАР' }[k]}</span></span>`).join('')}</span>`]])}
    ${g('crossed-swords', 'Клас', [['Клас', 'Боєць, 1 рівень'], ['Навички', 'Сприйняття, Виживання'], ['Бойовий стиль', 'Захист'], ['Майстерність зброї', 'Дворучний меч, Ціп, Дротик']])}
    ${g('swap-bag', 'Спорядження', [['Набір', 'Варіант A'], ['Сумка', 'Кольчуга, Дворучний меч, Ціп, Дротик ×8, Набір дослідника підземель'], ['Монети', '4 зм']])}`;
  return phoneShell({ n: 9, label: 'Огляд', body, next: 'Створити героя' });
}

// ======================================================================
// Remaining phone boards (uk) — the same shell; entity names through a uk table (invented, listed in notes.md)
// ======================================================================
const UK = {
  cls: { Barbarian: 'Варвар', Bard: 'Бард', Cleric: 'Жрець', Druid: 'Друїд', Fighter: 'Боєць', Monk: 'Монах', Paladin: 'Паладин', Ranger: 'Рейнджер', Rogue: 'Пройдисвіт', Sorcerer: 'Чаклун', Warlock: 'Чорнокнижник', Wizard: 'Чарівник' },
  bg: { Acolyte: 'Аколіт', Criminal: 'Злочинець', Sage: 'Мудрець', Soldier: 'Солдат' },
  skill: { Acrobatics: 'Акробатика', 'Animal Handling': 'Поводження з тваринами', Arcana: 'Аркана', Athletics: 'Атлетика', Deception: 'Обман', History: 'Історія', Insight: 'Проникливість', Intimidation: 'Залякування', Investigation: 'Розслідування', Medicine: 'Медицина', Nature: 'Природа', Perception: 'Сприйняття', Performance: 'Виступ', Persuasion: 'Переконання', Religion: 'Релігія', 'Sleight of Hand': 'Спритність рук', Stealth: 'Скритність', Survival: 'Виживання' },
  tool: { 'calligraphers-supplies': 'Приладдя каліграфа', 'thieves-tools': 'Злодійські інструменти', 'gaming-set': 'Ігровий набір (один вид)' },
  feat: { 'Magic Initiate': 'Посвячений у магію', Alert: 'Пильність', 'Savage Attacker': 'Лютий нападник', Archery: 'Стрільба', Defense: 'Захист', 'Great Weapon Fighting': 'Бій великою зброєю', 'Two-Weapon Fighting': 'Бій двома видами зброї' },
  mastery: { sap: 'Приголомшення', slow: 'Сповільнення', graze: 'Зачеплення', cleave: 'Розсічення', topple: 'Повалення', vex: 'Роздратування', nick: 'Поріз', push: 'Відштовхування' },
  weapon: { Battleaxe: 'Бойова сокира', Blowgun: 'Духова трубка', Club: 'Кийок', Dagger: 'Кинджал', Dart: 'Дротик метальний', Flail: 'Ціп', Glaive: 'Глефа', Greataxe: 'Велика сокира', Greatclub: 'Велика довбня', Greatsword: 'Дворучний меч', Halberd: 'Алебарда', 'Hand Crossbow': 'Ручний арбалет', Handaxe: 'Ручна сокира', 'Heavy Crossbow': 'Важкий арбалет', Javelin: 'Дротик', Lance: 'Спис кавалерійський', 'Light Crossbow': 'Легкий арбалет', 'Light Hammer': 'Легкий молот', Longbow: 'Довгий лук', Longsword: 'Довгий меч', Mace: 'Булава', Maul: 'Кувалда', Morningstar: 'Моргенштерн', Musket: 'Мушкет', Pike: 'Піка', Pistol: 'Пістоль', Quarterstaff: 'Бойовий посох', Rapier: 'Рапіра', Scimitar: 'Скімітар', Shortbow: 'Короткий лук', Shortsword: 'Короткий меч', Sickle: 'Серп', Sling: 'Праща', Spear: 'Спис', Trident: 'Тризуб', 'War Pick': 'Бойова кирка', Warhammer: 'Бойовий молот', Whip: 'Батіг' },
  spell: { Guidance: 'Настанова', Light: 'Світло', Mending: 'Лагодження', Resistance: 'Опір', 'Sacred Flame': 'Священне полум’я', 'Spare the Dying': 'Відстрочення смерті', Thaumaturgy: 'Тавматургія', Bane: 'Прокляття', Bless: 'Благословення', Command: 'Наказ', 'Create or Destroy Water': 'Створення чи знищення води', 'Cure Wounds': 'Лікування ран', 'Detect Evil and Good': 'Виявлення зла і добра', 'Detect Magic': 'Виявлення магії', 'Detect Poison and Disease': 'Виявлення отрути і хвороби', 'Guiding Bolt': 'Спрямований снаряд', 'Healing Word': 'Слово зцілення', 'Inflict Wounds': 'Нанесення ран', 'Protection from Evil and Good': 'Захист від зла і добра', 'Purify Food and Drink': 'Очищення їжі та пиття', Sanctuary: 'Святилище', 'Shield of Faith': 'Щит віри' },
  school: { abjuration: 'Огородження', divination: 'Прорікання', enchantment: 'Зачарування', evocation: 'Викликання', necromancy: 'Некромантія', transmutation: 'Перетворення' },
  item: { 'Chain Mail': 'Кольчуга', Greatsword: 'Дворучний меч', Flail: 'Ціп', Javelin: 'Дротик', 'Dungeoneer’s Pack': 'Набір дослідника підземель', 'Studded Leather Armor': 'Клепана шкіра', Scimitar: 'Скімітар', Shortsword: 'Короткий меч', Longbow: 'Довгий лук', Arrows: 'Стріли', Quiver: 'Сагайдак' },
  dmg: { slashing: 'рубаючий', piercing: 'колючий', bludgeoning: 'дробильний' },
  abil: { str: 'Сила', dex: 'Спритність', con: 'Статура', int: 'Інтелект', wis: 'Мудрість', cha: 'Харизма' },
  ab: { str: 'СИЛ', dex: 'СПР', con: 'СТА', int: 'ІНТ', wis: 'МДР', cha: 'ХАР' },
  feature: { 'Lay On Hands': 'Накладання рук', Spellcasting: 'Заклинання', 'Weapon Mastery': 'Майстерність зброї', 'Fighting Style': 'Бойовий стиль', 'Second Wind': 'Друге дихання', Rage: 'Лють', 'Unarmored Defense': 'Захист без обладунку', 'Bardic Inspiration': 'Натхнення барда', 'Divine Order': 'Божественний порядок', Druidic: 'Друїдська мова', 'Primal Order': 'Первісний порядок', 'Martial Arts': 'Бойові мистецтва', 'Favored Enemy': 'Заклятий ворог', Expertise: 'Експертиза', 'Sneak Attack': 'Підступна атака', 'Thieves’ Cant': 'Злодійський жаргон', "Thieves' Cant": 'Злодійський жаргон', 'Innate Sorcery': 'Вроджене чаклунство', 'Eldritch Invocations': 'Потойбічні закляття', 'Pact Magic': 'Магія угоди', 'Arcane Recovery': 'Магічне відновлення', 'Ritual Adept': 'Знавець ритуалів' },
};
const uk = (table, key) => UK[table][key] || key;
const phCounter = (cls, icon, text, title) => `<span class="counter ${cls}" style="height:30px;font-size:15px"${title ? ` title="${title}"` : ''}>${I(icon, 14)}${text}</span>`;

function w01phone() {
  const lock = TIP('Основні правила завжди увімкнені.', 'SRD 5.2.1 вбудовано в Herokeep', 'tipL');
  const body = `
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:12px">${TEX('paper')}
      <div style="display:flex;gap:12px;align-items:flex-start">
        <div class="hk-col" style="gap:6px;align-items:center;flex:0 0 auto">
          <div class="hk-frame"><div class="hk-frame__well" role="img" aria-label="Портрет-заглушка, монограма ${HERO.monoUk}">${HERO.monoUk}</div><span class="hk-rivet hk-frame__rivet hk-frame__rivet--tl"></span><span class="hk-rivet hk-frame__rivet hk-frame__rivet--tr"></span><span class="hk-rivet hk-frame__rivet hk-frame__rivet--bl"></span><span class="hk-rivet hk-frame__rivet hk-frame__rivet--br"></span><button class="hk-ico hk-ico--s hk-frame__edit" type="button" aria-label="Завантажити портрет" title="Завантажити портрет">${I('photo-camera', 14)}</button></div>
        </div>
        <div class="hk-col" style="gap:10px;min-width:0;flex:1 1 auto">
          <div class="hk-field"><label class="hk-field__label" for="phName" style="font-size:15px">Ім'я</label><input class="hk-input" id="phName" value="${HERO.nameUk}" style="font-family:var(--font-display);font-size:22px;height:44px" maxlength="200"></div>
          <span class="hk-field__msg hk-field__msg--error" role="alert" style="font-size:14px;line-height:1.25">${I('cross-mark', 11)}Це зображення завелике. Спробуйте менше фото.</span>
        </div>
      </div>
      <div class="hk-field"><span class="hk-field__label" id="phFormL" style="font-size:15px">Граматичний рід</span>
        <div class="seg" role="radiogroup" aria-labelledby="phFormL" style="width:100%;box-sizing:border-box" title="Як українська й російська описують героя («Маеліс створила…»)">
          <label class="segBtn" style="flex:1 1 0;justify-content:center;height:38px;font-size:16px;padding:0 6px"><input type="radio" name="phForm" class="hk-sr">${I('male', 15)}Чоловічий</label>
          <label class="segBtn segBtn--on" style="flex:1 1 0;justify-content:center;height:38px;font-size:16px;padding:0 6px"><input type="radio" name="phForm" class="hk-sr" checked>${I('female', 15)}Жіночий</label>
          <label class="segBtn" style="flex:1 1 0;justify-content:center;height:38px;font-size:16px;padding:0 6px"><input type="radio" name="phForm" class="hk-sr">${I('conversation', 15)}Середній</label>
        </div>
      </div>
    </section>
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:4px">${TEX('paper')}
      <h2 class="hk-leaf__title" style="font-size:19px">${I('chest', 20)}Пакети вмісту</h2>
      <ul class="packList">
        <li class="packRow" style="grid-template-columns:28px minmax(0,1fr) 44px;min-height:52px"><span class="hk-iring">${I('open-book', 16)}</span><span class="packName"><b>SRD 5.2.1 (2024 rules)</b><span class="hk-hint">v0.1.0 · базові правила</span></span><span class="packPin hk-has-tip" style="width:44px;height:44px" role="img" aria-label="Закріплено, заблоковано: основні правила завжди увімкнені." title="Основні правила завжди увімкнені." aria-describedby="${lock.id}" tabindex="0">${I('padlock', 18)}${lock.html}</span></li>
        <li class="packRow" style="grid-template-columns:28px minmax(0,1fr) 44px;min-height:52px"><span class="hk-iring">${I('cauldron', 16)}</span><span class="packName"><b>Мій хоумбрю</b><span class="hk-hint" style="display:inline-flex;align-items:center;gap:6px" aria-live="polite"><span class="hk-spin" aria-hidden="true" style="width:11px;height:11px;border-width:1.5px;color:var(--accent-strong)"></span>v0.1.0 · перевірка оновлень…</span></span><label class="packPin" style="width:44px;height:44px" title="Закріплено для цього героя"><input type="checkbox" class="hk-sr" checked>${I('pin', 18, { label: 'Закріплено' })}</label></li>
        <li class="packRow" style="grid-template-columns:28px minmax(0,1fr) 44px;min-height:52px;border-bottom:0"><span class="hk-iring" style="opacity:.7">${I('conversation', 16)}</span><span class="packName"><b style="font-weight:600">SRD 5.2.1 — русский (образец)</b><span class="hk-hint">v0.1.0 · переклад (ru)</span></span><label class="packPin packPin--off" style="width:44px;height:44px" title="Не закріплено"><input type="checkbox" class="hk-sr">${I('pin', 18, { label: 'Не закріплено' })}</label></li>
      </ul>
      <div class="emptyRow" style="font-size:15px">${I('three-friends', 18)}<span>Компанія Емберфол ще не ділиться пакетами.</span></div>
    </section>`;
  return phoneShell({ n: 1, label: "Ім'я", body, backDisabled: 'Нема куди повертатися' });
}

function w03phone() {
  const gate = TIP('Заборонено в Компанії Емберфол', 'правило Майстра: Аколіт, Мудрець або Солдат', 'hk-tip--left');
  const cards = backgrounds.map((b, i) => {
    const gated = b.name === 'Criminal';
    const feat = by(b.originFeat);
    const sk = b.skillProficiencies.map((k) => uk('skill', skillById(k).name)).join(', ');
    const tool = uk('tool', b.toolProficiency === 'thieves-tools' ? 'thieves-tools' : b.toolProficiency === 'calligraphers-supplies' ? 'calligraphers-supplies' : 'gaming-set');
    const why = 'Заборонено в Компанії Емберфол (правило Майстра)';
    return `<article class="hk-card cardF phCard${gated ? ' hk-card--gated' : ''}"${gated ? ' aria-disabled="true"' : ''} style="padding:12px">${TEX('paper')}
      <button class="cardOpen" type="button" aria-label="${uk('bg', b.name)}: опис"><div class="hk-card__head">${I(BG_ICON[b.name], 22)}<span class="hk-card__title" style="font-size:19px">${uk('bg', b.name)}</span>${gated ? `<span class="hk-card__gate hk-has-tip" role="img" aria-label="${why}" title="${why}" aria-describedby="${gate.id}" tabindex="0">${I('padlock', 16)}${gate.html}</span>` : ''}</div>
        <div class="hk-card__desc" style="font-size:15px;line-height:20px;color:var(--text-1)"><span class="descRow">${I('medal', 13)}${sk}</span><span class="descRow">${I('cog', 13)}${tool}</span><span class="descRow">${I('laurel-crown', 13)}${uk('feat', feat.name)}</span></div></button>
      <div class="hk-card__foot" style="gap:4px">${b.abilityScores.map((k) => chip(UK.ab[k], ABIL_ICON[k], ` title="+2 або +1: ${UK.abil[k]}"`)).join('')}${chip('+2 / +1')}</div>
      <div class="cardAct"><span style="flex:1 1 auto"></span>${gated ? `<button class="hk-btn hk-btn--brass hk-btn--phone" type="button" disabled title="${why}" aria-label="Обрати (${why})">Обрати</button>` : `<button class="hk-btn hk-btn--brass hk-btn--phone" type="button" aria-label="Обрати: ${uk('bg', b.name)}">Обрати</button>`}</div>
    </article>`;
  }).join('');
  const body = `
    <label class="hk-search" style="height:44px">${I('magnifying-glass', 18)}<span class="hk-sr">Пошук передісторій</span><input class="hk-search__in" type="search" placeholder="Пошук…"></label>
    <div class="chipScroll" role="group" aria-label="Фільтр"><button class="hk-chip hk-chip--l hk-chip--btn hk-chip--selected" type="button" aria-pressed="true" style="height:36px">Усі</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('muscle-up', 14)}Сила</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('acrobatic', 14)}Спритність</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('brain', 14)}Інтелект</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('owl', 14)}Мудрість</button></div>
    <div class="phCards" style="grid-template-columns:minmax(0,1fr)">${cards}</div>`;
  return phoneShell({ n: 3, label: 'Передісторія', body, picker: true, nextDisabled: 'Спершу оберіть передісторію' });
}

function w05phone() {
  const cards = classes.map((c, i) => `<article class="hk-card cardF phCard${c.name === 'Fighter' ? ' hk-card--selected' : ''}">${TEX('paper')}${c.name === 'Fighter' ? `<span class="hk-card__seal" style="top:-8px;right:-6px">${SEAL({ icon: 'check-mark', size: 28, label: 'Обрано', seed: 3 })}</span>` : ''}
    <button class="cardOpen" type="button" aria-label="${uk('cls', c.name)}: опис"><div class="hk-card__head" style="align-items:flex-start;flex-direction:column;gap:4px">${I(CLASS_ICON[c.name], 24)}<span class="hk-card__title" style="font-size:17px;line-height:20px">${uk('cls', c.name)}</span></div><div class="hk-card__desc" style="font-size:14px;line-height:18px">${l1Features(c).map((f) => uk('feature', f)).join(' · ')}</div></button>
    <div class="hk-card__foot" style="gap:4px">${chip(`к${c.hitDie}`, 'heart', ` title="Кістка хітів к${c.hitDie}"`)}${chip(c.primaryAbility.map((k) => UK.ab[k]).join(' / '), ABIL_ICON[c.primaryAbility[0]], ' title="Основна характеристика"')}</div>
  </article>`).join('');
  const body = `
    <label class="hk-search" style="height:44px">${I('magnifying-glass', 18)}<span class="hk-sr">Пошук класів</span><input class="hk-search__in" type="search" placeholder="Пошук…"></label>
    <div class="chipScroll" role="group" aria-label="Фільтр"><button class="hk-chip hk-chip--l hk-chip--btn hk-chip--selected" type="button" aria-pressed="true" style="height:36px">Усі</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('crossed-swords', 14)}Бойові</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('spell-book', 14)}Заклинання</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('chain-mail', 14)}Важкий обладунок</button></div>
    <div class="phCards">${cards}</div>`;
  const pal = classes.find((c) => c.name === 'Paladin');
  const feats = pal.levels[0].grants.map((g) => by(g.feature)).filter(real);
  const sheet = `<div class="hk-overlay phOverlay" aria-hidden="true"></div>
    <section class="hk-drawer hk-sheet phSheet" role="dialog" aria-labelledby="shT" aria-modal="true" style="max-height:520px">${TEX('paper')}<div class="hk-sheet__grip" aria-hidden="true"></div>
      <div class="hk-drawer__head">${I('templar-shield', 24, { style: 'color:var(--accent-strong);margin-top:3px' })}<h2 class="hk-drawer__title" id="shT">Паладин</h2><button class="hk-ico hk-ico--leaf hk-ico--phone" type="button" aria-label="Закрити" title="Закрити">${I('cross-mark', 14)}</button></div>
      <div class="hk-drawer__meta"><span class="hk-chip hk-chip--l">${I('heart', 13)}к10</span><span class="hk-chip hk-chip--l">${I('muscle-up', 13)}СИЛ і ХАР</span><span class="hk-chip hk-chip--l">${I('checked-shield', 13)}Рятівні: МДР · ХАР</span></div>
      <h3 class="drawerH" style="font-size:17px">Уміння 1-го рівня</h3>
      <ul class="traitList" style="font-size:16px;gap:6px">${feats.map((t) => `<li><b>${uk('feature', t.name)}.</b>${t.name === 'Weapon Mastery' ? `<button class="optChip" type="button" aria-expanded="false" aria-label="Майстерність зброї: ${weapons.length} варіантів" style="height:24px;font-size:13px">${I('checklist', 11)}${weapons.length} варіантів</button>` : ''} ${t.name === 'Lay On Hands' ? 'Запас зцілення — 5 × рівень паладина за довгий відпочинок.' : t.name === 'Spellcasting' ? 'Підготовлені заклинання паладина; комірки 1-го рівня: 2.' : 'Властивості майстерності двох видів зброї; зміна після довгого відпочинку.'}</li>`).join('')}</ul>
      <div class="hk-row" style="justify-content:flex-end;gap:8px;align-items:center"><span class="hk-hint" style="margin-right:auto">SRD 5.2.1 · базові правила</span><button class="hk-btn hk-btn--ghost hk-btn--phone" type="button">${I('open-book', 15)}У бібліотеці</button><button class="hk-btn hk-btn--brass hk-btn--phone" type="button" title="Замінить Бійця">${I('check-mark', 15)}Обрати</button></div>
    </section>`;
  return phoneShell({ n: 5, label: 'Клас', body, sheet, picker: true });
}

function phSkillRow(k, o) {
  const s = skillById(k);
  const mod = MOD(FINAL[s.ability]);
  const prof = o.granted || o.chosen;
  const total = mod + (prof ? 2 : 0);
  const dotHint = prof ? `Володіння (+2)${o.granted ? ' · від Солдата' : ''}` : 'Без володіння';
  const lock = (o.granted || o.blocked) ? `<span class="sklLock${o.tip ? ' hk-has-tip' : ''}" role="img" aria-label="${o.why}" title="${o.why}"${o.tip ? ` aria-describedby="${o.tip.id}" tabindex="0"` : ''}>${I('padlock', 14)}${o.tip ? o.tip.html : ''}</span>` : '';
  return `<label class="skl${o.chosen ? ' skl--on' : ''}${o.granted || o.blocked ? ' skl--off' : ''}" style="min-height:44px;font-size:16px;grid-template-columns:18px minmax(0,1fr) auto auto"${o.granted || o.blocked ? ` title="${o.why}"` : ''}><input type="checkbox" class="hk-sr" name="${o.group}"${o.chosen || o.granted ? ' checked' : ''}${o.granted || o.blocked ? ' disabled' : ''}><span class="hk-dot${prof ? ' hk-dot--on' : ''}" role="img" aria-label="${dotHint}" title="${dotHint}"></span><span class="sklName"><span style="display:inline-flex;align-items:center;gap:6px">${uk('skill', s.name)}${lock}</span></span><span class="hk-hint" style="font-size:13px">${UK.ab[s.ability]}</span><b class="hk-num" style="font-size:18px;min-width:34px;text-align:right">${sign(total)}</b></label>`;
}
function w06phone() {
  const fi = classes.find((c) => c.name === 'Fighter');
  const tip = TIP('Уже є володіння від Солдата', 'передісторія дає Атлетику й Залякування', 'hk-tip--above tipWrap');
  const rows = fi.skillChoice.from.map((k) => phSkillRow(k, { group: 'fsk', chosen: k === 'perception', granted: k === 'athletics' || k === 'intimidation', why: 'Уже є володіння від Солдата', tip: k === 'intimidation' ? tip : null })).join('');
  const keen = ['insight', 'perception', 'survival'].map((k) => phSkillRow(k, { group: 'keen', blocked: k === 'perception', why: 'Уже обрано як навичку Бійця' })).join('');
  const sets = ['Кості', 'Драконові шахи', 'Гральні карти', 'Три драконові тузи'];
  const body = `
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:6px">${TEX('paper')}
      <div class="skHead" style="gap:8px"><h2 class="hk-leaf__title" style="font-size:18px;line-height:22px">${I('crossed-swords', 20)}Оберіть 2 навички для класу Боєць</h2>${phCounter('counter--warn', 'medal', '1 з 2 обрано')}</div>
      <div class="sklList sklList--one">${rows}</div>
    </section>
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:8px">${TEX('paper')}
      <div class="skHead" style="gap:8px"><h2 class="hk-leaf__title" style="font-size:18px;line-height:22px">${I('cog', 20)}Інструмент від Солдата</h2>${phCounter('counter--ok', 'check-mark', '1 з 1 обрано')}</div>
      <span class="hk-hint" style="font-size:15px">Оберіть один вид ігрового набору.</span>
      <div class="hk-row" role="radiogroup" aria-label="Ігровий набір" style="gap:6px">${sets.map((s, i) => `<label class="hk-chip hk-chip--l hk-chip--btn${i === 0 ? ' hk-chip--selected' : ''}" style="height:40px"><input type="radio" name="gset" class="hk-sr"${i === 0 ? ' checked' : ''}>${I('dice-six-faces-six', 14)}${s}</label>`).join('')}</div>
    </section>
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:6px">${TEX('paper')}
      <div class="skHead" style="gap:8px"><h2 class="hk-leaf__title" style="font-size:18px;line-height:22px">${I('elf-helmet', 20)}Гострі чуття від Ельфа</h2>${phCounter('counter--warn', 'medal', '0 з 1 обрано')}</div>
      <span class="hk-hint" style="font-size:15px">Володіння Проникливістю, Сприйняттям або Виживанням.</span>
      <div class="sklList sklList--one">${keen}</div>
      <div class="hk-block" style="margin-top:4px"><b style="font-size:15px">Надано без вибору</b><div class="hk-row" style="gap:6px">${chip('Атлетика', 'medal', ' title="Від Солдата"')}${chip('Залякування', 'medal', ' title="Від Солдата"')}${chip('Лютий нападник', 'laurel-crown', ' title="Риса походження від Солдата"')}${chip('Загальна, ельфійська', 'conversation', ' title="Мови від Ельфа"')}</div></div>
    </section>`;
  return phoneShell({ n: 6, label: 'Навички та інструменти', body, nextDisabled: 'Ще 2 вибори: навичка Бійця, Гострі чуття' });
}

function w07phone() {
  const gate = TIP('Вогнепальну зброю вимкнено в Компанії Емберфол', 'правило Майстра · спитайте Майстра', 'hk-tip--left');
  const styleRows = styles.map((s, i) => {
    const on = s.name === 'Defense';
    return `<label class="wrow${on ? ' wrow--on' : ''}" style="min-height:48px;font-size:16px"><input type="radio" name="style" class="hk-sr"${on ? ' checked' : ''}><span class="hk-iring" style="width:32px;height:32px">${I({ Archery: 'bow-arrow', Defense: 'shield', 'Great Weapon Fighting': 'two-handed-sword', 'Two-Weapon Fighting': 'crossed-swords' }[s.name], 17)}</span><span class="wName"><span>${uk('feat', s.name)}</span></span><button class="hk-ico hk-ico--leaf hk-ico--phone" type="button" aria-label="${uk('feat', s.name)}: опис" title="Опис">${I('info', 15)}</button>${on ? SEAL({ icon: 'check-mark', size: 26, label: 'Обрано', seed: i + 2 }) : '<span class="wRing" aria-hidden="true" style="width:22px;height:22px"></span>'}</label>`;
  }).join('');
  const seeded = ['Greatsword', 'Flail'];
  const rows = weapons.map((w, i) => {
    const gated = w.name === 'Musket' || w.name === 'Pistol';
    const on = seeded.includes(w.name);
    const dmg = typeof w.weapon.damage === 'string' ? w.weapon.damage.replace('d', 'к') : '1';
    const why = 'Вогнепальну зброю вимкнено в Компанії Емберфол (правило Майстра)';
    const lock = gated ? `<span class="sklLock${w.name === 'Musket' ? ' hk-has-tip' : ''}" role="img" aria-label="${why}" title="${why}"${w.name === 'Musket' ? ` aria-describedby="${gate.id}" tabindex="0"` : ''}>${I('padlock', 14)}${w.name === 'Musket' ? gate.html : ''}</span>` : '';
    return `<label class="wrow${on ? ' wrow--on' : ''}${gated ? ' wrow--off' : ''}" style="min-height:48px;font-size:16px" title="${gated ? why : on ? 'Обрано · заповнено з набору Бійця' : uk('weapon', w.name)}"><input type="checkbox" class="hk-sr" name="mastery"${on ? ' checked' : ''}${gated ? ' disabled' : ''}><span class="hk-iring" style="width:32px;height:32px">${I(WEAPON_ICON[w.name], 17)}</span><span class="wName"><span style="display:inline-flex;align-items:center;gap:6px">${uk('weapon', w.name)}${lock}</span><span class="hk-hint" style="font-size:13px">${w.weapon.category === 'simple' ? 'проста' : 'бойова'} · ${dmg} ${UK.dmg[w.weapon.damageType] || ''}</span></span><span class="hk-chip" style="height:22px;font-size:13px" title="${uk('mastery', w.weapon.mastery)}: ${MASTERY_TEXT[w.weapon.mastery]}">${uk('mastery', w.weapon.mastery)}</span>${on ? SEAL({ icon: 'check-mark', size: 26, label: 'Обрано · заповнено з набору Бійця', seed: i % 7 + 1 }) : '<span class="wRing" aria-hidden="true" style="width:22px;height:22px"></span>'}</label>`;
  }).join('');
  const body = `
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:4px">${TEX('paper')}
      <div class="skHead" style="gap:8px"><h2 class="hk-leaf__title" style="font-size:18px;line-height:22px">${I('laurel-crown', 20)}Бойовий стиль</h2>${phCounter('counter--ok', 'check-mark', '1 з 1 обрано')}</div>
      <div class="sklList sklList--one" role="radiogroup" aria-label="Бойовий стиль">${styleRows}</div>
    </section>
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:8px">${TEX('paper')}
      <div class="skHead" style="gap:8px"><h2 class="hk-leaf__title" style="font-size:18px;line-height:22px">${I('broadsword', 20)}Майстерність зброї</h2>${phCounter('counter--warn', 'medal', '2 з 3 обрано', 'Боєць: 3 на 1-му рівні; зміна після довгого відпочинку')}</div>
      <label class="hk-search" style="height:44px">${I('magnifying-glass', 18)}<span class="hk-sr">Пошук зброї</span><input class="hk-search__in" type="search" placeholder="Пошук…"></label>
      <div class="chipScroll" role="group" aria-label="Фільтр"><button class="hk-chip hk-chip--l hk-chip--btn hk-chip--selected" type="button" aria-pressed="true" style="height:36px">Усі<span class="hk-btn__badge">${weapons.length}</span></button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">Проста</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">Бойова</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('broadsword', 14)}Ближній</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('bow-arrow', 14)}Дальній</button></div>
      <div class="sklList sklList--one">${rows}</div>
    </section>`;
  return phoneShell({ n: 7, label: 'Стиль і майстерність', body, picker: true, nextDisabled: 'Оберіть ще 1 вид зброї' });
}

function phSpellRow(s, o) {
  const icon = SPELL_ICON[s.name] || 'spell-book';
  const orb = s.concentration ? (o.cTip
    ? `<span class="orb hk-has-tip" role="img" aria-label="Концентрація" aria-describedby="${o.cTip.id}" tabindex="0">${I('concentration-orb', 18)}${o.cTip.html}</span>`
    : `<span class="orb" role="img" aria-label="Концентрація" title="Концентрація: лише одне таке заклинання водночас">${I('concentration-orb', 18)}</span>`) : '';
  const ritual = s.ritual ? `<span class="hk-chip" style="height:22px;font-size:13px" role="img" aria-label="Ритуал" title="Ритуал: можна накласти за 10 додаткових хвилин без комірки">Р</span>` : '';
  const school = `<span class="schoolDot" style="--dmg:var(--damage-${{ abjuration: 'cold', divination: 'radiant', enchantment: 'psychic', evocation: 'fire', necromancy: 'necrotic', transmutation: 'acid' }[s.school]})" role="img" aria-label="${UK.school[s.school]}" title="${UK.school[s.school]}"></span>`;
  const seal = o.on ? SEAL({ icon: 'check-mark', size: 26, label: o.cantrip ? 'Відомий заговір' : 'Підготовлено', hint: o.cantrip ? 'Відомий заговір' : 'Підготовлено', seed: (s.name.length % 7) + 1 }) : `<span class="wRing" aria-hidden="true" style="width:22px;height:22px"></span>`;
  const lock = o.off ? `<span class="sklLock" role="img" aria-label="${o.why}" title="${o.why}">${I('padlock', 14)}</span>` : '';
  return `<label class="wrow spRow${o.on ? ' wrow--on' : ''}${o.off ? ' wrow--off' : ''}" style="min-height:48px;font-size:16px"${o.off ? ` title="${o.why}"` : ''}><input type="checkbox" class="hk-sr" name="${o.cantrip ? 'cantrip' : 'prep'}"${o.on ? ' checked' : ''}${o.off ? ' disabled' : ''}><span class="hk-iring" style="width:32px;height:32px">${I(icon, 16)}</span><span class="wName"><span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${school}${uk('spell', s.name)}${lock}${orb}${ritual}</span></span><button class="hk-ico hk-ico--leaf hk-ico--phone" type="button" aria-label="${uk('spell', s.name)}: опис" title="Опис">${I('info', 15)}</button>${seal}</label>`;
}
function w08phone() {
  const cantrips = clericSpells.filter((s) => s.level === 0);
  const l1 = clericSpells.filter((s) => s.level === 1);
  const known = ['Guidance', 'Sacred Flame', 'Thaumaturgy'];
  const prepared = ['Bless', 'Cure Wounds', 'Guiding Bolt'];
  const cTip = TIP('Концентрація', 'лише одне таке заклинання водночас; шкода змушує робити рятівний кидок', 'tipWrap');
  const body = `
    <div class="chipScroll" role="group" aria-label="Чародійство"><span class="hk-chip hk-chip--l" style="height:36px" title="Характеристика заклинань">${I('owl', 14)}Мудрість</span><span class="hk-chip hk-chip--l" style="height:36px" title="8 + бонус майстерності + модифікатор Мудрості">Складність 13</span><span class="hk-chip hk-chip--l" style="height:36px" title="бонус майстерності + модифікатор Мудрості">Атака заклинанням +5</span></div>
    <label class="hk-search" style="height:44px">${I('magnifying-glass', 18)}<span class="hk-sr">Пошук заклинань</span><input class="hk-search__in" type="search" placeholder="Пошук…"></label>
    <div class="chipScroll" role="group" aria-label="Фільтр"><button class="hk-chip hk-chip--l hk-chip--btn hk-chip--selected" type="button" aria-pressed="true" style="height:36px">Усі<span class="hk-btn__badge">${clericSpells.length}</span></button>${Object.keys(UK.school).map((k) => `<button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${UK.school[k]}</button>`).join('')}<button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">${I('concentration-orb', 14)}Концентрація</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" style="height:36px">Ритуал</button></div>
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:4px">${TEX('paper')}
      <div class="skHead" style="gap:8px"><h2 class="hk-leaf__title" style="font-size:18px;line-height:22px">${I('sparkles', 20)}Заговори</h2>${phCounter('counter--ok', 'check-mark', '3 / 3 відомо', 'Жрець знає 3 заговори на 1-му рівні')}</div>
      <div class="sklList sklList--one">${cantrips.map((s) => phSpellRow(s, { cantrip: true, on: known.includes(s.name), off: !known.includes(s.name), why: 'Відомо всі 3 заговори; забудьте один, щоб обрати цей', cTip: s.name === 'Guidance' ? cTip : null })).join('')}</div>
    </section>
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:4px">${TEX('paper')}
      <div class="skHead" style="gap:8px"><h2 class="hk-leaf__title" style="font-size:18px;line-height:22px">${I('spell-book', 20)}1 рівень · підготовлені</h2>${phCounter('counter--warn', 'medal', '3 / 4 підготовлено', 'Жрець готує 4 заклинання на 1-му рівні; зміна після довгого відпочинку')}<span class="hk-seal-row" role="group" aria-label="Комірки 1 рівня: 2 з 2" title="Комірки 1 рівня — 2 з 2">${SEAL({ text: 'I', size: 24, seed: 1 })}${SEAL({ text: 'I', size: 24, seed: 2 })}</span></div>
      <div class="sklList sklList--one">${l1.map((s) => phSpellRow(s, { on: prepared.includes(s.name) })).join('')}</div>
    </section>`;
  return phoneShell({ n: 7, label: 'Заклинання', body, picker: true });
}

function w09phone() {
  const goldGate = 'Стартове золото вимкнено в Компанії Емберфол — спитайте Майстра';
  const gTip = TIP('Стартове золото вимкнено в Компанії Емберфол', 'спитайте Майстра');
  // Kits as selectable rows (radio): name, summary line, the whole item list as text; the gold row is locked.
  const kit = (key, selected) => {
    const k = KIT[key];
    const list = k.items.map(([n, q]) => `${uk('item', n)}${q > 1 ? ` ×${q}` : ''}`).join(', ') + `, ${k.gp} зм`;
    return `<label class="wrow kitRow${selected ? ' wrow--on' : ''}"><input type="radio" name="kit" class="hk-sr"${selected ? ' checked' : ''}><span class="hk-iring hk-iring--l">${I(k.icon, 18)}</span><span class="wName" style="gap:2px"><span style="font-family:var(--font-display);font-size:18px">Варіант ${key}<span class="hk-hint" style="font-size:13px;margin-left:8px">${key === 'A' ? 'важкий обладунок · КБ 16' : 'легкий обладунок · КБ 14'}</span></span><span style="font-size:15px;line-height:1.3;white-space:normal;color:var(--text-1)">${list}</span></span>${selected ? SEAL({ icon: 'check-mark', size: 28, label: 'Обрано', seed: 5 }) : '<span class="wRing" aria-hidden="true" style="width:22px;height:22px"></span>'}</label>`;
  };
  const bagRowPh = (name, qty, weight, o) => `<div class="hk-item" style="grid-template-columns:32px minmax(0,1fr) auto auto"><span class="hk-iring hk-iring--l">${I(ITEM_ICON[name] || 'swap-bag', 18)}</span><span class="hk-item__name"><span style="display:flex;align-items:center;gap:6px">${uk('item', name)}${o.equipped ? '<span class="hk-tagE" role="img" aria-label="Споряджено" title="Споряджено" style="position:static">E</span>' : ''}</span><span class="hk-item__sub">${o.sub}</span></span><span class="hk-item__marks"><span class="hk-qty" style="position:static" title="Кількість">×${qty}</span></span>${o.equippable ? `<button class="hk-toggle" type="button" role="switch" aria-checked="${o.equipped ? 'true' : 'false'}" aria-label="${o.equipped ? 'Зняти' : 'Спорядити'}: ${uk('item', name)}" title="${o.equipped ? 'Зняти' : 'Спорядити'}" style="height:44px"><span class="hk-toggle__track"><span class="hk-toggle__knob"></span></span></button>` : `<button class="hk-ico hk-ico--leaf hk-ico--phone" type="button" aria-label="Деталі: ${uk('item', name)}" title="Деталі">${I('info', 16)}</button>`}</div>`;
  const body = `
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:4px" aria-label="Стартовий набір">${TEX('paper')}
      <div class="hk-leaf__head" style="gap:6px"><h2 class="hk-leaf__title" style="font-size:18px">${I('knapsack', 20)}Стартовий набір</h2>${phCounter('counter--ok', 'check-mark', 'Варіант A')}</div>
      <div class="sklList sklList--one" role="radiogroup" aria-label="Стартовий набір">${kit('A', true)}${kit('B', false)}
        <label class="wrow kitRow wrow--off" title="${goldGate}"><input type="radio" name="kit" class="hk-sr" disabled><span class="hk-iring hk-iring--l">${I('two-coins', 18)}</span><span class="wName" style="gap:2px"><span style="font-family:var(--font-display);font-size:18px;display:inline-flex;align-items:center;gap:8px">Варіант C<span class="sklLock hk-has-tip" role="img" aria-label="${goldGate}" aria-describedby="${gTip.id}" tabindex="0">${I('padlock', 15)}${gTip.html}</span></span><span style="font-size:15px;line-height:1.3;white-space:normal">лише золото: 155 зм</span></span><span class="wRing" aria-hidden="true" style="width:22px;height:22px;opacity:.5"></span></label>
      </div>
    </section>
    <section class="hk-leaf hk-leaf--phone" style="display:flex;flex-direction:column;gap:0">${TEX('paper')}
      <div class="hk-leaf__head" style="gap:6px"><h2 class="hk-leaf__title" style="font-size:18px">${I('swap-bag', 20)}Сумка</h2><span class="hk-chip" title="Вага: 134 з 255 фунтів · Сила 17 × 15">${I('weight', 12)}134 / 255 фунтів</span><span class="hk-chip" title="Клас броні: 16 від кольчуги + 1 від стилю Захист">${I('shield', 12)}КБ 17</span></div>
      ${bagRowPh('Chain Mail', 1, 55, { sub: 'важкий обладунок · КБ 16 · 55 фунтів', equippable: true, equipped: true })}
      ${bagRowPh('Greatsword', 1, 6, { sub: '2к6 рубаючий · Зачеплення · 6 фунтів', equippable: true, equipped: true })}
      ${bagRowPh('Flail', 1, 2, { sub: '1к8 дробильний · Приголомшення · 2 фунти', equippable: true, equipped: false })}
      ${bagRowPh('Javelin', 8, 16, { sub: '1к6 колючий · метальний 30/120 · Сповільнення', equippable: true, equipped: false })}
      ${bagRowPh('Dungeoneer’s Pack', 1, 55, { sub: 'рюкзак, мотузка, смолоскипи, раціони… · 55 фунтів' })}
      <div class="hk-row" style="padding:10px 0 2px;gap:8px;align-items:center"><span class="coin coin--gp" style="height:36px"><b class="hk-num">4</b><small>зм</small></span><span style="flex:1 1 auto"></span><button class="hk-btn hk-btn--ghost hk-btn--dashed hk-btn--phone" type="button">${I('plus', 14)}З бібліотеки</button></div>
    </section>`;
  return phoneShell({ n: 8, label: 'Спорядження', body });
}

// ======================================================================
// Tablet board (768 × 1024 portrait, en): rail with the mark only, seal rail for the stepper, 2-column picker, 300 px drawer
// ======================================================================
function w02tablet() {
  const elf = species.find((s) => s.name === 'Elf');
  const cards = species.map((s, i) => card({
    icon: SPECIES_ICON[s.name], title: s.name, desc: traitNames(s).join(' · '), seed: i + 1,
    tags: chip(cap(s.size), null, ` title="Size: ${cap(s.size)}"`) + chip(`${s.speed} ft`, 'running-shoe', ` title="Speed ${s.speed} ft"`),
    state: s.name === 'Elf' ? 'selected' : 'default',
  })).join('');
  const traits = elf.grants.map((g) => by(g.feature)).filter(real);
  const steps = STEPS(null);
  const cur = 1;
  const lockTip = TIP('Class choices', 'unlocks once you choose a class (step 5)', 'tipR');
  const railRows = steps.map((s, i) => {
    const n = i + 1;
    const name = s.label.replace(/&amp;/g, '&');
    if (s.locked) return `<li class="tRailItem"><span class="hk-step__n hk-has-tip" style="box-shadow:none" role="img" aria-label="Class choices: unlocks once you choose a class" aria-describedby="${lockTip.id}" tabindex="0">${I('padlock', 14, { style: 'color:var(--text-2)' })}${lockTip.html}</span></li>`;
    if (i < cur) return `<li class="tRailItem"><a href="#" aria-label="${name}: done" title="${name} · done">${SEAL({ icon: 'check-mark', size: 26, label: 'Done', seed: n })}</a></li>`;
    if (i === cur) return `<li class="tRailItem tRailItem--cur"><a href="#" aria-current="step" aria-label="${name}: current step"><span class="hk-step__n" style="background:linear-gradient(180deg,var(--brass-top),var(--brass) 55%,var(--brass-mid));color:var(--text-on-brass);box-shadow:var(--shadow-brass);width:28px;height:28px;font-size:15px">${n}</span><span class="tRailName">${name}</span></a></li>`;
    return `<li class="tRailItem"><a href="#" aria-label="${name}" title="${name}"><span class="hk-step__n">${n}</span></a></li>`;
  }).join('');
  return `<div class="tb" data-theme="tavern">${DEFS}${TEX('wood')}<div class="hk-vignette" aria-hidden="true"></div>
    <header class="hk-rail" style="gap:12px;padding:0 12px">${TEX('leather')}
      <div class="hk-rail__mark" title="Herokeep">${I('wax-seal', 26, { label: 'Herokeep' })}</div>
      <nav class="hk-rail__nav" aria-label="App" style="gap:8px;padding:0 10px"><div class="hk-rail__bar" aria-hidden="true"></div>
        <a class="hk-ico" href="#" aria-label="Home" title="Home">${I('house', 20)}</a><a class="hk-ico hk-ico--on" href="#" aria-current="page" aria-label="Heroes" title="Heroes">${I('person', 20)}</a><a class="hk-ico" href="#" aria-label="Campaigns" title="Campaigns">${I('three-friends', 20)}</a><a class="hk-ico" href="#" aria-label="Library" title="Library">${I('open-book', 20)}</a><a class="hk-ico" href="#" aria-label="Packs" title="Packs">${I('chest', 20)}</a><a class="hk-ico" href="#" aria-label="Settings" title="Settings">${I('cog', 20)}</a>
      </nav>
      <div class="hk-rail__spacer"></div>
      <span class="hk-chip hk-chip--l" style="height:28px;font-size:14px;max-width:150px" title="Current campaign: The Emberfall Company">${I('three-friends', 14)}<span style="overflow:hidden;text-overflow:ellipsis">The Emberfall Company</span></span>
      <button class="hk-ico" type="button" aria-label="Account" title="Account">${I('hood', 20)}</button>
    </header>
    <div class="tbBody" data-scroller="body">
      <nav class="tRail" aria-label="Steps"><ol class="tRailList">${railRows}</ol></nav>
      <section class="hk-leaf stepLeaf" aria-labelledby="stepT" style="padding:14px 14px;gap:10px">${TEX('paper')}
        ${stepHead('Species')}
        <div class="pickerTop" style="gap:8px"><label class="hk-search" style="flex:1 1 180px">${I('magnifying-glass', 18)}<span class="hk-sr">Search species</span><input class="hk-search__in" type="search" placeholder="Search…"></label></div>
        <div class="hk-row" role="group" aria-label="Filter" style="gap:6px"><button class="hk-chip hk-chip--l hk-chip--btn hk-chip--selected" type="button" aria-pressed="true">All</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false">Small</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false">Medium</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false">${I('owl', 14)}Darkvision</button><button class="hk-chip hk-chip--l hk-chip--btn" type="button" aria-pressed="false" title="9 species come from the core pack">${I('chest', 14)}Pack: SRD 5.2.1<span class="hk-btn__badge">9</span></button></div>
        <div class="cards" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${cards}</div>
      </section>
      <aside class="hk-drawer" role="dialog" aria-labelledby="drawerT" aria-modal="false" style="width:auto;border-radius:var(--radius-leaf);padding:14px;gap:10px;position:sticky;top:0;align-self:start">${TEX('paper')}
        <div class="hk-drawer__head">${I('elf-helmet', 22, { style: 'color:var(--accent-strong);margin-top:3px' })}<h2 class="hk-drawer__title" id="drawerT" style="font-size:22px">Elf</h2><button class="hk-ico hk-ico--leaf hk-ico--s" type="button" aria-label="Close" title="Close (Esc)">${I('cross-mark', 12)}</button></div>
        <div class="hk-drawer__meta">${chip('Medium')}${chip('30 ft', 'running-shoe')}${chip('Darkvision 60 ft', 'owl')}</div>
        <h3 class="drawerH" style="font-size:17px">Traits</h3><ul class="traitList" style="font-size:14px">${traits.map((t) => `<li><b>${t.name}.</b> ${esc(t.description.split('\n')[0]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').slice(0, 120)}${t.description.length > 120 ? '…' : ''}</li>`).join('')}</ul>
        <span class="hk-hint" style="font-size:13px">SRD 5.2.1 (2024 rules) · Herokeep core pack</span>
        <div class="hk-col" style="gap:6px;align-items:stretch"><button class="hk-btn hk-btn--brass" type="button" aria-pressed="true" title="Elf is chosen · pick another card to change">${I('check-mark', 14)}Chosen</button><button class="hk-btn hk-btn--ghost" type="button">${I('open-book', 14)}Open in library</button></div>
      </aside>
    </div>
    <footer class="hk-astrap" aria-label="Actions" style="flex:0 0 auto;z-index:5">${TEX('leather')}<div class="hk-rivets"></div>
      <div class="hk-astrap__row" style="padding:6px 14px;gap:8px">
        <div class="hk-astrap__zone" aria-label="Exit" style="gap:8px"><button class="hk-btn hk-btn--ghost-leather hk-btn--l" type="button" style="padding:0 12px">${I('cross-mark', 13)}Cancel</button><button class="hk-btn hk-btn--leather hk-btn--l" type="button" style="padding:0 12px">${I('exit-door', 17)}Back</button></div>
        <span class="hk-astrap__divider" aria-hidden="true"></span>
        <div class="hk-astrap__zone" aria-label="Primary"><button class="hk-btn hk-btn--brass hk-btn--l" type="button">${I('entry-door', 17)}Next</button></div>
        <span class="hk-astrap__divider" aria-hidden="true"></span>
        <div class="hk-astrap__zone" aria-label="Secondary" style="gap:8px"><button class="hk-ico" type="button" aria-label="Filter" title="Filter">${I('funnel', 20)}</button><button class="hk-ico" type="button" aria-label="Search" title="Search">${I('magnifying-glass', 20)}</button></div>
        <span class="hk-astrap__note" style="color:var(--text-on-leather-2);font-size:14px">Step 2 of 9 · Species</span>
      </div><div class="hk-rivets"></div></footer>
  </div>`;
}

// ---------- page CSS ----------
function pageCss(phone) {
  return `
.pg{position:relative;width:100%;max-width:none;min-height:100vh;box-sizing:border-box;background:var(--ground);color:var(--text-on-ground);font-family:var(--font-body);font-size:15px;line-height:1.3;display:flex;flex-direction:column;--font-display:Forum,serif;--font-body:Alegreya,Georgia,serif}
.pg > *{position:relative}
.pgMain{display:grid;grid-template-columns:300px minmax(0,1fr);gap:20px;padding:18px 22px 24px;align-items:start;flex:1 1 auto;z-index:1}
.pgMain3{grid-template-columns:300px minmax(0,1fr) 380px}
.stepLeaf{display:flex;flex-direction:column;gap:14px;min-width:0}
.stepHead{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;justify-content:space-between}
.stepTitle{margin:0;font-family:var(--font-display);font-weight:400;font-size:32px;line-height:36px;color:var(--text-1)}
.stepLead{font-size:15px;color:var(--text-2);font-style:italic;line-height:1.3}
.stepBad{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:400;color:var(--danger-strong);font-style:italic;margin-left:6px}
.strapWhy{display:inline-flex;align-items:center;gap:4px;font-size:14px;font-style:italic;color:var(--text-on-leather-2);max-width:260px;line-height:1.15}
.drawerCol{width:auto;border-radius:var(--radius-leaf);position:sticky;top:18px;min-height:520px}
.drawerH{margin:4px 0 0;font-family:var(--font-display);font-weight:400;font-size:18px;line-height:22px;color:var(--text-1)}
.traitList{margin:0;padding:0 0 0 18px;display:flex;flex-direction:column;gap:6px;font-size:15px;line-height:1.35}
.pickerTop{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px;padding-top:10px}
.cards4{grid-template-columns:repeat(auto-fit,minmax(205px,1fr))}
.cards2{grid-template-columns:repeat(2,minmax(0,1fr))}
.cardF{width:auto;min-height:150px;cursor:default;padding:12px 12px 10px}
.cardF > *{position:relative}
.hk-card__seal{position:absolute}
.cardAct{display:flex;align-items:center;gap:6px;min-height:28px}
.descRow--wrap{align-items:flex-start;line-height:1.3}
.descRow--wrap svg{margin-top:3px}
.hk-card__gate{margin-left:auto;flex:0 0 auto}
.tipR{top:50%;left:calc(100% + 12px);transform:translateY(-50%)}
.tipR::before{top:50%;left:-5px;transform:translateY(-50%) rotate(45deg);box-shadow:-1px 1px 0 var(--leaf-edge)}
.tipWrap{white-space:normal;width:270px;line-height:1.25}
.preview{position:relative;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px;border-radius:var(--radius-leaf);background:linear-gradient(180deg,var(--leather-highlight),var(--leather) 55%,var(--leather-dark));box-shadow:var(--shadow-strap);outline:1px dashed var(--stitch);outline-offset:-5px;color:var(--text-on-leather)}
.preview > *{position:relative}
.prevBadge{min-width:104px;padding:6px 8px}
.prevBadge .hk-badge__v{font-size:22px}
.phGroup{display:flex;flex-direction:column;gap:4px}
.optChip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;margin:0 2px 0 6px;border:0;border-radius:var(--radius-seal);background:linear-gradient(180deg,var(--brass-top),var(--brass) 55%,var(--brass-mid));color:var(--text-on-brass);font-family:var(--font-body);font-size:12px;font-weight:600;line-height:1;cursor:pointer;box-shadow:var(--shadow-brass);vertical-align:2px;white-space:nowrap}
.optChip[aria-expanded="true"]{box-shadow:var(--shadow-brass),var(--shadow-glow-brass)}
.popAnchor{position:relative}
.pop{position:absolute;left:-18px;right:0;top:calc(100% + 10px);z-index:7;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:var(--radius-leaf);background:radial-gradient(ellipse at 50% 20%,var(--leaf-glow) 0%,var(--leaf) 55%,var(--leaf-dark) 100%);color:var(--text-1);box-shadow:var(--shadow-tooltip),var(--shadow-raised);font-size:14px;line-height:1.25;box-sizing:border-box}
.pop > *{position:relative}
.pop::before{content:"";position:absolute;top:-6px;left:176px;width:12px;height:12px;background:var(--leaf-glow);transform:rotate(45deg);box-shadow:-1px -1px 0 var(--leaf-edge)}
.popHead{display:flex;align-items:flex-start;gap:8px}
.popList{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2px 10px;font-size:14px}
.popList li{min-height:22px;display:flex;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.popFoot{display:flex;align-items:center;gap:10px;padding-top:8px;border-top:1px solid var(--leaf-edge);font-size:15px;flex-wrap:wrap}
.popFoot a{display:inline-flex;align-items:center;gap:5px}
.sklLock{display:inline-flex;align-items:center;color:var(--danger-strong);position:relative;flex:0 0 auto}
.tb{position:relative;width:768px;height:1024px;overflow:hidden;display:flex;flex-direction:column;background:var(--ground);color:var(--text-on-ground);font-family:var(--font-body);font-size:15px;line-height:1.3;box-sizing:border-box;--font-display:Forum,serif;--font-body:Alegreya,Georgia,serif}
.tb > *{position:relative}
.tbBody{flex:1 1 auto;min-height:0;overflow:auto;display:grid;grid-template-columns:64px minmax(0,1fr) 300px;gap:12px;padding:12px;box-sizing:border-box;align-items:start;z-index:1}
.tRail{position:sticky;top:0;z-index:3}
.tRailList{list-style:none;margin:0;padding:8px 0;display:flex;flex-direction:column;gap:10px;align-items:center;border-radius:var(--radius-leaf);background:radial-gradient(ellipse at 50% 35%,var(--leaf-glow) 0%,var(--leaf) 55%,var(--leaf-dark) 100%);box-shadow:var(--shadow-leaf);width:64px;box-sizing:border-box}
.tRailItem{display:flex;flex-direction:column;align-items:center;position:relative}
.tRailItem a{display:flex;flex-direction:column;align-items:center;gap:3px;text-decoration:none;color:var(--text-1);min-width:36px;min-height:36px;justify-content:center}
.tRailName{font-family:var(--font-display);font-size:11px;line-height:12px;text-align:center;color:var(--text-1);white-space:nowrap}
.tipL{top:50%;right:calc(100% + 12px);left:auto;transform:translateY(-50%)}
.tipL::before{top:50%;left:auto;right:-5px;transform:translateY(-50%) rotate(45deg);box-shadow:1px -1px 0 var(--leaf-edge)}
.orb{display:inline-flex;align-items:center;color:var(--arcane-strong);position:relative;flex:0 0 auto}
.hk-card__gate{color:var(--danger-strong)}
.chipScroll{-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)}
.cardOpen{display:flex;flex-direction:column;gap:6px;border:0;background:transparent;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit;flex:1 1 auto;min-width:0;border-radius:4px}
.cardOpen:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;box-shadow:0 0 0 4px var(--focus-ring-outer)}
.cardOpen:hover .hk-card__title{color:var(--link)}
.descRow{display:flex;align-items:center;gap:5px}
.descRow svg{color:var(--accent-strong);flex:0 0 auto}
.nameGrid{display:grid;grid-template-columns:200px minmax(0,1fr);gap:24px;align-items:start}
.seg{display:inline-flex;gap:3px;padding:3px;border-radius:var(--radius-seal);background:var(--leaf-sunken);box-shadow:inset 0 0 0 1px var(--leaf-edge);align-self:flex-start}
.segBtn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:var(--radius-seal);font-size:15px;color:var(--text-2);cursor:pointer;position:relative}
.segBtn svg{color:var(--accent-strong)}
.segBtn--on{background:linear-gradient(180deg,var(--brass-top),var(--brass) 55%,var(--brass-mid));color:var(--text-on-brass);box-shadow:var(--shadow-brass);font-weight:600}
.segBtn--on svg{color:currentColor}
.segBtn:focus-within{outline:2px solid var(--focus-ring);box-shadow:0 0 0 4px var(--focus-ring-outer)}
.packList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.packRow{display:grid;grid-template-columns:28px minmax(0,1fr) auto 36px;align-items:center;gap:10px;min-height:44px;padding:2px 6px;border-bottom:1px solid var(--leaf-edge)}
.packPin{position:relative;width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:var(--accent-strong);background:var(--leaf-sunken);box-shadow:inset 0 0 0 1.5px var(--accent-strong);cursor:pointer}
.packPin--off{color:var(--text-3);background:transparent;box-shadow:inset 0 0 0 1.5px var(--leaf-edge)}
.packPin:focus-within{outline:2px solid var(--focus-ring);box-shadow:0 0 0 4px var(--focus-ring-outer)}
.packName{display:flex;flex-direction:column;gap:2px;min-width:0;font-size:16px}
.emptyRow{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--radius-leaf);background:var(--leaf-sunken);box-shadow:inset 0 0 0 1px var(--leaf-edge);color:var(--text-2);font-size:15px;flex-wrap:wrap}
.emptyRow svg{color:var(--accent-strong);flex:0 0 auto}
.methodTabs{gap:4px;flex:0 0 auto}
.methodTabs .hk-tab{flex:0 0 auto;height:34px;padding:0 14px;font-size:16px}
.budgetRow{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.bonusTray{position:relative;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px;border-radius:var(--radius-leaf);background:linear-gradient(180deg,var(--leather-highlight),var(--leather) 55%,var(--leather-dark));box-shadow:var(--shadow-strap);outline:1px dashed var(--stitch);outline-offset:-5px;color:var(--text-on-leather)}
.bonusTray > *{position:relative}
.abilGrid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}
.abil{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px 12px;border-radius:var(--radius-leaf);background:var(--leaf-sunken);box-shadow:inset 0 0 0 1px var(--leaf-edge);min-width:0}
.abil--drop{box-shadow:inset 0 0 0 1px var(--leaf-edge),inset 0 0 0 3px var(--leaf-sunken),inset 0 0 0 4px var(--brass)}
.abil--drop{outline:2px dashed var(--brass-mid);outline-offset:-6px;box-shadow:inset 0 0 0 1px var(--leaf-edge)}
.abilCost{display:flex;align-items:center;gap:8px}
.bonusTag{height:22px;font-size:15px;cursor:grab;right:-10px;top:-4px}
.diceTray{display:flex;align-items:center;gap:12px;padding:6px 10px;border-radius:var(--radius-leaf);box-shadow:inset 0 0 0 1px var(--leaf-edge)}
.trayToggle{display:flex;align-items:center;gap:10px;flex:1 1 auto;min-width:0;border:0;background:transparent;padding:4px 0;font:inherit;font-size:16px;color:var(--text-1);cursor:pointer;text-align:left}
.trayToggle svg{color:var(--accent-strong)}
.skGrid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:20px 28px;align-items:start}
.skSection{display:flex;flex-direction:column;gap:8px;min-width:0}
.skHead{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.counter{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:var(--radius-seal);font-size:14px;font-weight:600}
.counter--warn{background:var(--warning-soft);color:var(--warning);box-shadow:inset 0 0 0 1px var(--warning)}
.counter--ok{background:var(--success-soft);color:var(--success-strong);box-shadow:inset 0 0 0 1px var(--success-strong)}
.sklList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 16px}
.sklList--one{grid-template-columns:minmax(0,1fr)}
.skl{display:grid;grid-template-columns:18px minmax(0,1fr) auto auto;align-items:center;gap:8px;min-height:38px;padding:0 8px;border-radius:var(--radius-leaf);font-size:16px;color:var(--text-1);cursor:pointer;position:relative}
.skl:hover{background:var(--leaf-sunken)}
.skl--on{background:var(--leaf-sunken);box-shadow:inset 0 0 0 1px var(--brass)}
.skl--off{cursor:not-allowed;color:var(--text-2)}
.skl:focus-within{outline:2px solid var(--focus-ring);box-shadow:0 0 0 4px var(--focus-ring-outer)}
.sklName{display:flex;flex-direction:column;gap:1px;min-width:0;line-height:1.15;white-space:normal}
.sklWhy{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-style:italic;color:var(--danger-strong);position:relative;flex-wrap:wrap;align-self:flex-start}
.sklWhy svg{flex:0 0 auto}
.wGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(236px,1fr));gap:4px 10px}
.wrow{display:grid;grid-template-columns:30px minmax(0,1fr) auto auto;align-items:center;gap:8px;min-height:44px;padding:3px 6px;border-radius:var(--radius-leaf);font-size:15px;color:var(--text-1);cursor:pointer;position:relative}
.wrow:hover{background:var(--leaf-sunken)}
.wrow--on{background:var(--leaf-sunken);box-shadow:inset 0 0 0 1px var(--brass)}
.wrow--off{cursor:not-allowed;color:var(--text-2);opacity:.85}
.wrow:focus-within{outline:2px solid var(--focus-ring);box-shadow:0 0 0 4px var(--focus-ring-outer)}
.wName{display:flex;flex-direction:column;gap:0;min-width:0;line-height:1.15}
.wRing{width:18px;height:18px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--accent-strong);display:block;margin:3px}
.spGrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:16px 24px;align-items:start}
.spRow{min-height:40px;grid-template-columns:30px minmax(0,1fr) auto auto}
.spRow--sel{box-shadow:inset 0 0 0 2px var(--accent-strong);background:var(--leaf-sunken)}
.schoolDot{width:9px;height:9px;border-radius:50%;background:var(--dmg);flex:0 0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.15)}
.kitGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;padding-top:10px}
.kitCard{min-height:0}
.kitList{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;font-size:15px;flex:1 1 auto}
.kitList li{display:flex;align-items:center;gap:8px;min-height:24px}
.kitList svg{color:var(--accent-strong);flex:0 0 auto}
.goldWell{display:flex;align-items:baseline;justify-content:center;gap:6px;padding:14px;border-radius:var(--radius-leaf);background:var(--leaf-sunken);box-shadow:inset 0 0 0 1px var(--leaf-edge);color:var(--text-1)}
.bagList{display:flex;flex-direction:column;gap:0}
.bagRow{display:grid;grid-template-columns:28px minmax(0,1fr) auto 56px auto 28px 28px;align-items:center;gap:10px;min-height:46px;padding:3px 4px;border-bottom:1px solid var(--leaf-edge);font-size:16px}
.coinRow{position:relative;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 14px;border-radius:var(--radius-leaf);background:linear-gradient(180deg,var(--leather-highlight),var(--leather) 55%,var(--leather-dark));box-shadow:var(--shadow-strap);outline:1px dashed var(--stitch);outline-offset:-5px;color:var(--text-on-leather);margin-top:8px}
.coinRow > *{position:relative}
.coin{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px 0 6px;border-radius:var(--radius-seal);background:var(--recess);box-shadow:inset 0 2px 3px rgba(0,0,0,.8),inset 0 0 0 1px var(--border-brass);font-size:14px;color:var(--text-on-leather-2)}
.coin .hk-num{font-size:18px;color:var(--text-on-leather)}
.coin::before{content:"";width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff8,var(--c) 40%,var(--cs) 90%);box-shadow:0 1px 1px rgba(0,0,0,.5)}
.coin--pp{--c:var(--coin-platinum);--cs:var(--coin-platinum-shade)}
.coin--gp{--c:var(--coin-gold);--cs:var(--coin-gold-shade)}
.coin--sp{--c:var(--coin-silver);--cs:var(--coin-silver-shade)}
.coin--cp{--c:var(--coin-copper);--cs:var(--coin-copper-shade)}
.derived{position:relative;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;border-radius:var(--radius-leaf);background:linear-gradient(180deg,var(--leather-highlight),var(--leather) 55%,var(--leather-dark));box-shadow:var(--shadow-strap);outline:1px dashed var(--stitch);outline-offset:-5px;color:var(--text-on-leather)}
.derived > *{position:relative}
.derived .hk-badge{min-width:108px}
.revGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 24px;align-items:start}
.revGroup{display:flex;flex-direction:column;gap:3px;padding:8px 12px 10px;border-radius:var(--radius-leaf);box-shadow:inset 0 0 0 1px var(--leaf-edge);background:rgba(255,250,235,.25);min-width:0}
.revHead{display:flex;align-items:center;gap:10px;margin-bottom:2px}
.revEdit{display:inline-flex;align-items:center;gap:4px;font-size:15px;white-space:nowrap}
.revRow{display:grid;grid-template-columns:132px minmax(0,1fr);gap:10px;align-items:start;font-size:15px;line-height:1.3;min-height:24px;padding:2px 0}
.revK{color:var(--text-2)}
.revV{color:var(--text-1);min-width:0;overflow-wrap:anywhere}
.revAbils{display:flex;gap:8px;flex-wrap:wrap}
.revAbil{display:flex;flex-direction:column;align-items:center;gap:2px}
.ph{position:relative;width:390px;height:844px;overflow:hidden;display:flex;flex-direction:column;background:var(--ground);color:var(--text-on-ground);font-family:var(--font-body);font-size:16px;line-height:1.3;box-sizing:border-box;--font-display:Forum,serif;--font-body:Alegreya,Georgia,serif}
.ph > *{position:relative}
.phBody{flex:1 1 auto;min-height:0;overflow:auto;padding:10px 12px 16px;display:flex;flex-direction:column;gap:10px;box-sizing:border-box;z-index:1}
.phStrap{display:flex;align-items:center;gap:6px;padding:7px 8px}
.chipScroll{display:flex;gap:6px;overflow-x:auto;padding:2px 0 4px;flex:0 0 auto;scrollbar-width:none}
.chipScroll > *{flex:0 0 auto}
.phCards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding-top:8px}
.phCard{min-height:0;padding:10px}
.phOverlay{position:absolute;left:0;right:0;top:112px;bottom:72px;z-index:3}
.phSheet{position:absolute;left:0;right:0;bottom:72px;z-index:4;max-height:460px;padding:14px 14px 14px;gap:10px}
.abilGridPh{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.abilPh{padding:8px 6px 8px;gap:6px}
.derivedPh{gap:6px;padding:8px}
.derivedPh .hk-badge{flex:1 1 40%;min-width:0;padding:6px 4px}
.derivedPh .hk-badge__v{font-size:24px}
.derivedPh .hk-badge__l{font-size:13px;white-space:normal;text-align:center;line-height:1.1}
`;
}

function all() {
  return [
    { file: 'W01-Name-Desktop.dc.html', lang: 'en', title: 'Hero creation — name & concept (desktop)', root: w01() },
    { file: 'W02-Species-Desktop.dc.html', lang: 'en', title: 'Hero creation — species (desktop)', root: w02() },
    { file: 'W03-Background-Desktop.dc.html', lang: 'en', title: 'Hero creation — background (desktop)', root: w03() },
    { file: 'W04-Abilities-Desktop.dc.html', lang: 'en', title: 'Hero creation — ability scores (desktop)', root: w04() },
    { file: 'W05-Class-Desktop.dc.html', lang: 'en', title: 'Hero creation — class (desktop)', root: w05() },
    { file: 'W06-Skills-Desktop.dc.html', lang: 'en', title: 'Hero creation — skills & tools (desktop)', root: w06() },
    { file: 'W07-Style-Masteries-Desktop.dc.html', lang: 'en', title: 'Hero creation — fighting style & masteries (desktop)', root: w07() },
    { file: 'W08-Spells-Desktop.dc.html', lang: 'en', title: 'Hero creation — spells (desktop)', root: w08() },
    { file: 'W09-Equipment-Desktop.dc.html', lang: 'en', title: 'Hero creation — equipment (desktop)', root: w09() },
    { file: 'W10-Review-Desktop.dc.html', lang: 'en', title: 'Hero creation — review (desktop)', root: w10() },
    { file: 'W02-Species-Phone.dc.html', lang: 'uk', title: 'Створення героя — вид (телефон)', root: w02phone(), phone: true },
    { file: 'W04-Abilities-Phone.dc.html', lang: 'uk', title: 'Створення героя — характеристики (телефон)', root: w04phone(), phone: true },
    { file: 'W10-Review-Phone.dc.html', lang: 'uk', title: 'Створення героя — огляд (телефон)', root: w10phone(), phone: true },
    { file: 'W01-Name-Phone.dc.html', lang: 'uk', title: "Створення героя — ім'я (телефон)", root: w01phone(), phone: true },
    { file: 'W03-Background-Phone.dc.html', lang: 'uk', title: 'Створення героя — передісторія (телефон)', root: w03phone(), phone: true },
    { file: 'W05-Class-Phone.dc.html', lang: 'uk', title: 'Створення героя — клас (телефон)', root: w05phone(), phone: true },
    { file: 'W06-Skills-Phone.dc.html', lang: 'uk', title: 'Створення героя — навички та інструменти (телефон)', root: w06phone(), phone: true },
    { file: 'W07-Style-Masteries-Phone.dc.html', lang: 'uk', title: 'Створення героя — стиль і майстерність (телефон)', root: w07phone(), phone: true },
    { file: 'W08-Spells-Phone.dc.html', lang: 'uk', title: 'Створення героя — заклинання (телефон)', root: w08phone(), phone: true },
    { file: 'W09-Equipment-Phone.dc.html', lang: 'uk', title: 'Створення героя — спорядження (телефон)', root: w09phone(), phone: true },
    { file: 'W02-Species-Tablet.dc.html', lang: 'en', title: 'Hero creation — species (tablet)', root: w02tablet(), tablet: true },
  ];
}
module.exports = { all, pageCss };
