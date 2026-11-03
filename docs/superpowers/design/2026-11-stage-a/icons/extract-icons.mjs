// Extracts a curated set of game-icons.net SVGs (CC BY 3.0) into kit/icons.json
// { name: { author, body } } where body is the inner SVG markup normalised to
// fill="currentColor" with the black background rect removed. viewBox is 0 0 512 512.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2];
const OUT = process.argv[3];

const WANT = [
  // vitals
  'heart','hearts','heart-plus','heart-armor','broken-heart','health-normal','health-increase','health-decrease','heart-beats',
  'shield','checked-shield','round-shield','bolt-shield','magic-shield','templar-shield','shield-bash','cracked-shield',
  'boots','running-shoe','run','sprint','walking-boot','stopwatch','sands-of-time','hourglass',
  // dice
  'dice-twenty-faces-twenty','dice-twenty-faces-one','perspective-dice-six-faces-random','dice-six-faces-six','rolling-dices','rolling-dice-cup','cube','d4','d10','d12',
  // weapons
  'crossed-swords','broadsword','two-handed-sword','stiletto','plain-dagger','daggers','spear-hook','spears','spear-feather','trident','bow-arrow','high-shot','crossbow','quiver','arrow-cluster','broken-arrow',
  'battle-axe','axe-sword','flanged-mace','mace-head','warhammer','thor-hammer','sword-brandish','sword-clash','axe-swing','pointy-sword','winged-sword','relic-blade','sling','whip','club','wooden-club',
  // armor & wearables
  'chain-mail','breastplate','lamellar','leather-armor','leather-vest','shoulder-armor','visored-helm','helmet','cloak','hood','ring','diamond-ring','gem-pendant','necklace','belt-buckles','gloves','gauntlet','boot-stomp','cape','crown','laurel-crown','medal','laurels',
  // magic
  'crystal-wand','wizard-staff','lunar-wand','fairy-wand','potion-ball','health-potion','round-potion','square-bottle','poison-bottle','flask','round-bottom-flask',
  'scroll-unfurled','scroll-quill','spell-book','book-cover','open-book','secret-book','enlightenment','magic-swirl','magic-portal','aura','beams-aura','bolt-spell-cast','fire-spell-cast','ice-spell-cast','concentration-orb','divided-spiral','psychic-waves','pentacle','holy-symbol','holy-grail','angel-wings','prayer','ankh','runic-triangle','rune-stone','crystal-ball','candle-flame','candles','cauldron','orb-wand',
  // elements / damage types
  'fire','flame','burning-dot','lightning-arc','lightning-branches','lightning-helix','ice-bolt','icicles-aura','snowflake-1','acid','acid-blob','poison-gas','thunder-skull','sun-radiations','radial-balance','ghost','skull','skull-crossed-bones','death-skull','tombstone','coffin','drop','droplet','water-drop','wind-slap','tornado','stone-block','stone-tower','punch-blast','hammer-drop','sword-spade',
  // time / rest
  'sun','sunrise','moon','crescent-moon','night-sleep','star','sparkles','campfire','camping-tent','bed','sleepy','tired-eye','meditation',
  // money / items / inventory
  'coins','coins-pile','two-coins','cash','money-stack','gold-bar','gold-stack','gems','emerald','crystal-growth','swap-bag','knapsack','backpack','sack','shopping-bag','hand-bag','chest','locked-chest','open-chest','open-treasure-chest','treasure-map','torch','rope-coil','ham-shank','meat','bread','water-flask','water-bottle','lantern','lantern-flame','medical-pack','medical-pack-alt','first-aid-kit','bandage-roll','healing','candle-holder','bedroll','rolled-cloth','tinderbox','chisel','hammer-nails','lockpicks','grappling-hook','bottle-vapors','beer-stein','wine-bottle','mug','abacus','spyglass','compass','ink-swirl','quill','quill-ink','feather','pencil','pin','push-pin','padlock','lock','key','key-lock','scales','weight','weight-crush','anvil','cog','gears','settings-knobs','hamburger-menu','trash-can','share','save','magnifying-glass','funnel','exit-door','entry-door','position-marker','info','help','histogram','notebook','card-random','card-pick','card-play','card-exchange','card-draw','card-burn','stack','files','folder',
  // characters / party / DM
  'crowned-skull','king','queen-crown','three-friends','team-idea','person','character','two-shadows','dragon-head','dragon-shield','wolf-head','bear-head','paw','paw-print','horse-head','owl','raven','cat','falcon-moon','bat','spider-face','snake','frog','monkey','crow-dive','eagle-emblem',
  // skills / abilities
  'muscle-up','biceps','acrobatic','brain','charm','heart-inside','juggler','conversation','talk','speech','eye','eye-shield','sight-disabled','hearing-disabled','blindfold','terror','paralysis','falling','grab','knocked-out-stars','invisible','handcuffed','manacles','knockout','star-swirl','upgrade','level-end-flag','stairs-goal','trophy','crosshair','target-arrows','archery-target','inspiration','transform','return-arrow','anticlockwise-rotation','check-mark','cancel','cross-mark','plus','minus','plain-circle','circle','ringing-bell','flag-objective','castle','tower','house','home','village','mountain-cave','forest','path-tile','dungeon-gate','stone-stairs',
  // class icons (existing sprite set)
  'barbarian','lyre','oak-leaf','fist','bowman','hood','wizard-staff','elf-ear','dwarf-face','orc-head','giant','bad-gnome','devil-mask','dragon-head','invisible','perspective-dice-six-faces-random','charm','crystal-ball','fire-ray','gem-pendant','holy-symbol','magic-portal','magic-shield','open-book','person','raise-skeleton','templar-shield','transform','breastplate','broadsword','crossed-swords','crossbow','aura','barefoot',
  // misc fun
  'drama-masks','drum','harp','flute','pan-flute','dice-fire','card-ace-spades','poker-hand','rolling-energy','party-popper','sword-altar','sword-array','swords-power','wax-seal','wax-tablet','stamper','bookmark','bookmarklet','ribbon','rosette','abstract-013','ornate-sword','fleur-de-lys','celtic-knot',
];

const files = new Map(); // name -> [author, path]
for (const author of readdirSync(ROOT)) {
  const dir = join(ROOT, author);
  if (!statSync(dir).isDirectory() || author.startsWith('.')) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.svg')) continue;
    const name = f.slice(0, -4);
    if (!files.has(name)) files.set(name, [author, join(dir, f)]);
  }
}

const out = {};
const missing = [];
for (const name of WANT) {
  if (!name) continue;
  const hit = files.get(name);
  if (!hit) { missing.push(name); continue; }
  let svg = readFileSync(hit[1], 'utf8');
  let inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  // drop the black background square game-icons ships first
  inner = inner.replace(/<path[^>]*d="M0 0h512v512H0z"[^>]*\/>/g, '');
  inner = inner.replace(/\s*fill="#[0-9a-fA-F]{3,6}"/g, '').replace(/\s*fill="(black|white)"/g, '');
  inner = inner.replace(/<path /g, '<path fill="currentColor" ');
  out[name] = { author: hit[0], body: inner.trim() };
}
writeFileSync(OUT, JSON.stringify(out, null, 0));
console.log(`extracted ${Object.keys(out).length}; missing ${missing.length}`);
for (const m of missing) {
  const sugg = [...files.keys()].filter((k) => k.includes(m.split('-')[0])).slice(0, 6).join(' ');
  console.log(`  MISSING ${m} -> ${sugg}`);
}
