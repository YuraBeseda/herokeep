// parts.cjs — shared chrome for the S2 boards, copied from A2 (concept A v2) and parametrised.
// Every function returns authoring markup (may contain <i-icon>, <x-seal>, <x-tex>) that build.cjs expands.

const rail = () => `
  <header style="position:relative;z-index:3;display:flex;align-items:center;gap:22px;padding:0 22px;height:60px;background:linear-gradient(180deg,#4F3322,#3A2316);box-shadow:0 1px 0 #8A6A2A,0 3px 0 #2A1810,0 6px 14px rgba(0,0,0,.55);color:#E9DCBB;flex:0 0 auto">
    <x-tex kind="leather"></x-tex>
    <div style="position:relative;display:flex;align-items:center;gap:8px;font-family:Forum,serif;font-size:24px;line-height:1;color:#C9A24E;letter-spacing:.02em"><i-icon name="wax-seal" size="26"></i-icon>Herokeep</div>
    <nav aria-label="App" style="position:relative;display:flex;align-items:center;gap:14px;padding:0 14px">
      <div aria-hidden="true" style="position:absolute;left:0;right:0;top:50%;height:5px;transform:translateY(-50%);background:linear-gradient(180deg,#E8CC7C,#C9A24E 40%,#7E5F24);border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,.7)"></div>
      <button class="ico" type="button" aria-label="Home" title="Home"><i-icon name="house" size="22"></i-icon></button>
      <button class="ico icoOn" type="button" aria-current="page" aria-label="Heroes" title="Heroes"><i-icon name="character" size="22"></i-icon></button>
      <button class="ico" type="button" aria-label="Campaigns" title="Campaigns"><i-icon name="flag-objective" size="22"></i-icon></button>
      <button class="ico" type="button" aria-label="Library" title="Library"><i-icon name="open-book" size="22"></i-icon></button>
      <button class="ico" type="button" aria-label="Packs" title="Packs"><i-icon name="stack" size="22"></i-icon></button>
      <button class="ico" type="button" aria-label="Settings" title="Settings"><i-icon name="cog" size="22"></i-icon></button>
    </nav>
    <div style="flex:1 1 auto"></div>
    <div class="chip" style="position:relative;height:28px;font-size:15px;gap:7px"><i-icon name="flag-objective" size="15" style="color:#8A6A2A"></i-icon>The Emberfall Company</div>
    <button class="ico" type="button" aria-label="Account" title="Account" style="position:relative"><i-icon name="person" size="22"></i-icon></button>
  </header>`;

const wood = () => `
  <x-tex kind="wood"></x-tex>
  <div class="vign" aria-hidden="true" style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 62% 58% at 88% -4%,rgba(107,74,30,.72) 0%,rgba(107,74,30,.3) 38%,rgba(36,23,16,0) 72%),radial-gradient(ellipse 70% 60% at 6% 104%,rgba(0,0,0,.42) 0%,rgba(0,0,0,0) 70%)"></div>`;

function folioTabs(o) {
  const tab = o.tab || 'play';
  const flow = tab === 'levelup';
  const dim = flow ? ' tabDim' : '';
  const t = (id, label) => `<button class="tab${tab === id ? ' tabOn' : ''}${dim}" type="button"${tab === id ? ' aria-current="page"' : ''}${flow ? ' tabindex="-1" aria-disabled="true" title="Finish or cancel the level up first"' : ''}>${label}</button>`;
  let lv;
  if (flow) lv = `<button class="tab tabOn" type="button" aria-current="step" title="Level up in progress"><i-icon name="upgrade" size="14"></i-icon>Level up</button>`;
  else if (o.levelup === 'ready') lv = `<button class="tab tabAct" type="button" title="Level up to ${o.nextlevel || 6}"><i-icon name="upgrade" size="14"></i-icon>Level up</button>`;
  else lv = `<button class="tab tabOff" type="button" disabled="disabled" title="Level up at 14,000 XP" aria-label="Level up at 14,000 XP"><i-icon name="padlock" size="14"></i-icon>Level up</button>`;
  return `<div style="display:flex;gap:4px;flex-wrap:wrap">${t('play', 'Play')}${t('build', 'Build')}${t('timeline', 'Timeline')}${lv}</div>`;
}

const folio = (o) => {
  const classline = o.classline || 'Human · Paladin 5';
  const xpw = o.xpw || '46.4%';
  const xptxt = o.xptxt || '6,500 / 14,000';
  const hp = o.hp || '31', hpmax = o.hpmax || '44', hpw = o.hpw || '70.5%', tempw = o.tempw || '11.4%';
  const hd = o.hd || '4 / 5 d10';
  const wisTip = o.tip === 'none' ? `<i-icon name="star" size="11" style="color:#E8CC7C" hint="Proficient saving throw"></i-icon>` : `<span class="glyph" tabindex="0" aria-describedby="tipStar"><i-icon name="star" size="11" style="color:#E8CC7C" hint="Proficient saving throw"></i-icon><span class="tip" id="tipStar" role="tooltip">Proficient saving throw</span></span>`;
  return `
    <aside aria-label="Character folio" style="position:relative;display:flex;flex-direction:column;gap:12px;padding:18px 18px 18px 26px;border-radius:6px 16px 16px 6px;background:linear-gradient(160deg,#5A3A26 0%,#4A2E1E 50%,#3B2416 100%);box-shadow:0 12px 26px rgba(0,0,0,.6),inset 0 0 0 1px rgba(201,162,78,.3);color:#E9DCBB;transform:rotate(-0.2deg);outline:1px dashed rgba(201,162,78,.4);outline-offset:-8px">
      <x-tex kind="leather" style="border-radius:6px 16px 16px 6px"></x-tex>
      <div aria-hidden="true" style="position:absolute;left:0;top:0;bottom:0;width:13px;border-radius:6px 0 0 6px;background:linear-gradient(90deg,#2E1B11,#4A2E1E);box-shadow:inset -1px 0 0 rgba(201,162,78,.35);display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:16px 0;box-sizing:border-box"><span class="rivet"></span><span class="rivet"></span><span class="rivet"></span><span class="rivet"></span></div>
      <div style="position:relative;display:flex;gap:12px;align-items:stretch">
        <div style="position:relative;width:98px;height:118px;flex:0 0 auto;border-radius:4px;padding:5px;box-sizing:border-box;background:linear-gradient(180deg,#E8CC7C 0%,#C9A24E 45%,#A98335 80%,#8A6A2A 100%);box-shadow:inset 0 1px 0 rgba(255,241,200,.7),inset 0 -1px 0 rgba(70,48,12,.7),0 2px 4px rgba(0,0,0,.6)">
          <div role="img" aria-label="Portrait placeholder, monogram IV" style="width:100%;height:100%;border-radius:2px;background:radial-gradient(circle at 50% 35%,#432A1A,#241710 80%);display:flex;align-items:center;justify-content:center;font-family:Forum,serif;font-size:42px;line-height:1;color:#C9A24E;box-shadow:inset 0 0 14px rgba(0,0,0,.85);letter-spacing:.04em">IV</div>
          <span class="rivet" style="position:absolute;left:3px;top:3px;width:7px;height:7px"></span><span class="rivet" style="position:absolute;right:3px;top:3px;width:7px;height:7px"></span><span class="rivet" style="position:absolute;left:3px;bottom:3px;width:7px;height:7px"></span><span class="rivet" style="position:absolute;right:3px;bottom:3px;width:7px;height:7px"></span>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 auto;justify-content:center">
          <h1 style="margin:0;font:25px/1.15 Forum,serif;font-weight:400;padding:4px 8px;border-radius:3px;letter-spacing:.01em;background:linear-gradient(180deg,#E8CC7C 0%,#C9A24E 45%,#A98335 80%,#8A6A2A 100%);color:#2B2118;box-shadow:inset 0 1px 0 rgba(255,241,200,.7),inset 0 -1px 0 rgba(70,48,12,.7),0 1px 2px rgba(0,0,0,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Ilyana Vorn</h1>
          <div style="font-size:16px;line-height:1.2;color:#F3E6C8">${classline}</div>
          <div style="font-size:15px;line-height:1.2;color:#E0C27A;display:flex;align-items:center;gap:5px"><i-icon name="holy-symbol" size="14"></i-icon>Oath of Devotion</div>
          <div style="font-size:15px;line-height:1.2;color:#E0C27A;display:flex;align-items:center;gap:5px"><i-icon name="medal" size="14"></i-icon>Soldier</div>
        </div>
      </div>
      <nav aria-label="Sheet" style="position:relative;display:flex;flex-direction:column;gap:6px">
        ${folioTabs(o)}
        <div style="display:flex;align-items:center;gap:8px;font-size:14px;color:#E0C27A">
          <span>XP</span>
          <div class="gauge" style="flex:1 1 auto;height:8px;border-radius:4px"><div style="width:${xpw};height:100%;background:linear-gradient(90deg,#8A6A2A,#C9A24E);border-radius:4px"></div></div>
          <span class="num" style="font-size:15px;color:#F3E6C8">${xptxt}</span>
        </div>
      </nav>
      <section class="strap" aria-label="Hit points" style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:center;padding:9px 14px 9px 10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div aria-hidden="true" style="width:16px;height:44px;border-radius:4px;background:linear-gradient(180deg,#E8CC7C,#C9A24E 50%,#8A6A2A);box-shadow:inset 0 0 0 2px #5E4418,0 1px 2px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center"><span style="display:block;width:4px;height:24px;background:#1E110A;border-radius:2px"></span></div>
          <div class="num" style="font-size:44px;color:#F6E8CC;display:flex;align-items:baseline;gap:5px;text-shadow:0 2px 2px rgba(0,0,0,.5)"><span>${hp}</span><span style="font-size:22px;color:#C9A24E">/ ${hpmax}</span></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;min-width:0">
          <div style="display:flex;align-items:center;gap:5px;font-size:14px;color:#E0C27A;line-height:1"><i-icon name="heart" size="15"></i-icon>Hit points</div>
          <div class="gauge" title="${hp} of ${hpmax}, plus 5 temporary"><div style="width:${hpw};height:100%;background:linear-gradient(180deg,#D15A3E,#B8432A 55%,#8E3220)"></div><div style="width:${tempw};height:100%;background:repeating-linear-gradient(135deg,#E8CC7C 0 3px,#A98335 3px 6px)"></div></div>
          <div style="display:flex;align-items:center;gap:5px;font-size:14px;color:#E0C27A;line-height:1;white-space:nowrap"><i-icon name="heart-plus" size="15"></i-icon>Temporary HP <b class="num" style="font-size:17px;color:#F6E8CC">5</b></div>
        </div>
      </section>
      <section aria-label="Vitals" style="position:relative;display:grid;grid-template-columns:84px repeat(2,minmax(0,1fr));gap:8px;align-items:stretch">
        <div style="grid-row:span 3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px">
          <svg viewBox="0 0 82 96" width="82" height="96" role="img" aria-label="Armor class 18"><defs><linearGradient id="shBrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8CC7C"/><stop offset=".5" stop-color="#C9A24E"/><stop offset="1" stop-color="#8A6A2A"/></linearGradient></defs><path d="M41 4 L75 14 V44 C75 66 58 84 41 92 C24 84 7 66 7 44 V14 Z" fill="#1A0E08" opacity=".6" transform="translate(2,3)"/><path d="M41 4 L75 14 V44 C75 66 58 84 41 92 C24 84 7 66 7 44 V14 Z" fill="url(#shBrass)" stroke="#5E4418" stroke-width="1.5"/><path d="M41 11 L68 19 V44 C68 62 54 77 41 84 C28 77 14 62 14 44 V19 Z" fill="#2E1B11" stroke="#7E5F24" stroke-width="1"/><path d="M41 11 L68 19 V44 C68 62 54 77 41 84" fill="none" stroke="#000" stroke-width="2" opacity=".35"/><text x="41" y="51" text-anchor="middle" dominant-baseline="central" font-family="Forum, serif" font-size="40" fill="#F6E8CC">18</text></svg>
          <span style="font-size:14px;color:#E0C27A;line-height:1">Armor class</span>
        </div>
        <div class="vplate"><span class="vlabel">Initiative</span><span class="vval"><i-icon name="stopwatch" size="16" style="color:#C9A24E"></i-icon>+0</span></div>
        <div class="vplate"><span class="vlabel">Speed</span><span class="vval"><i-icon name="boots" size="16" style="color:#C9A24E"></i-icon>30 ft</span></div>
        <div class="vplate"><span class="vlabel">Proficiency bonus</span><span class="vval"><i-icon name="medal" size="16" style="color:#C9A24E"></i-icon>+3</span></div>
        <div class="vplate"><span class="vlabel">Hit dice</span><span class="vval"><i-icon name="d10" size="16" style="color:#C9A24E"></i-icon>${hd}</span></div>
        <div class="vplate"><span class="vlabel">Passive perception</span><span class="vval"><i-icon name="eye" size="16" style="color:#C9A24E"></i-icon>11</span></div>
        <div class="vplate" style="box-shadow:inset 0 2px 4px rgba(0,0,0,.65),inset 0 0 0 1px #C9A24E,0 0 10px rgba(232,204,124,.35)"><span class="vlabel"><i-icon name="inspiration" size="15" style="color:#E8CC7C;vertical-align:-3px"></i-icon> Heroic inspiration</span><span class="vval" style="font-size:15px;white-space:normal;line-height:1.05;font-family:Alegreya,serif;font-weight:700"><span style="min-width:0">available (1)</span></span></div>
      </section>
      <section aria-label="Abilities and saving throws" style="position:relative;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><h2 style="margin:0;font:18px/1 Forum,serif;font-weight:400;color:#C9A24E">Abilities</h2></div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 8px">
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px"><x-seal state="full" text="+3" size="58" label="Strength modifier +3" hint="Strength modifier +3" seed="1"></x-seal><span style="font:15px/1 Forum,serif;color:#F3E6C8">Strength</span><span style="display:flex;gap:4px"><span class="plate" title="Strength score 16">16</span><span class="save"><i-icon name="shield" size="12" style="color:#C9A24E" hint="Saving throw +3"></i-icon>+3</span></span></div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px"><x-seal state="full" text="+0" size="58" label="Dexterity modifier +0" hint="Dexterity modifier +0" seed="2"></x-seal><span style="font:15px/1 Forum,serif;color:#F3E6C8">Dexterity</span><span style="display:flex;gap:4px"><span class="plate" title="Dexterity score 10">10</span><span class="save"><i-icon name="shield" size="12" style="color:#C9A24E" hint="Saving throw +0"></i-icon>+0</span></span></div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px"><x-seal state="full" text="+2" size="58" label="Constitution modifier +2" hint="Constitution modifier +2" seed="3"></x-seal><span style="font:15px/1 Forum,serif;color:#F3E6C8">Constitution</span><span style="display:flex;gap:4px"><span class="plate" title="Constitution score 14">14</span><span class="save"><i-icon name="shield" size="12" style="color:#C9A24E" hint="Saving throw +2"></i-icon>+2</span></span></div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px"><x-seal state="full" text="−1" size="58" label="Intelligence modifier −1" hint="Intelligence modifier −1" seed="4"></x-seal><span style="font:15px/1 Forum,serif;color:#F3E6C8">Intelligence</span><span style="display:flex;gap:4px"><span class="plate" title="Intelligence score 8">8</span><span class="save"><i-icon name="shield" size="12" style="color:#C9A24E" hint="Saving throw −1"></i-icon>−1</span></span></div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px"><x-seal state="full" text="+1" size="58" label="Wisdom modifier +1" hint="Wisdom modifier +1" seed="5"></x-seal><span style="font:15px/1 Forum,serif;color:#F3E6C8">Wisdom</span><span style="display:flex;gap:4px"><span class="plate" title="Wisdom score 12">12</span><span class="save"><i-icon name="shield" size="12" style="color:#C9A24E" hint="Saving throw +4"></i-icon>+4${wisTip}</span></span></div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:4px"><x-seal state="full" text="+3" size="58" label="Charisma modifier +3" hint="Charisma modifier +3" seed="6"></x-seal><span style="font:15px/1 Forum,serif;color:#F3E6C8">Charisma</span><span style="display:flex;gap:4px"><span class="plate" title="Charisma score 16">16</span><span class="save"><i-icon name="shield" size="12" style="color:#C9A24E" hint="Saving throw +6"></i-icon>+6<i-icon name="star" size="11" style="color:#E8CC7C" hint="Proficient saving throw"></i-icon></span></span></div>
        </div>
      </section>
      <section aria-label="Skills" style="position:relative;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><h2 style="margin:0;font:18px/1 Forum,serif;font-weight:400;color:#C9A24E">Skills</h2></div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 14px">
          <div class="sk"><span class="dot dotOn" role="img" aria-label="Proficient" title="Proficient"></span><span style="flex:1 1 auto;min-width:0">Athletics</span><b class="num" style="font-size:17px">+6</b></div>
          <div class="sk"><span class="dot dotOn" role="img" aria-label="Proficient" title="Proficient"></span><span style="flex:1 1 auto;min-width:0">Insight</span><b class="num" style="font-size:17px">+4</b></div>
          <div class="sk"><span class="dot dotOn" role="img" aria-label="Proficient" title="Proficient"></span><span style="flex:1 1 auto;min-width:0">Intimidation</span><b class="num" style="font-size:17px">+6</b></div>
          <div class="sk"><span class="dot dotOn" role="img" aria-label="Proficient" title="Proficient"></span><span style="flex:1 1 auto;min-width:0">Persuasion</span><b class="num" style="font-size:17px">+6</b></div>
          <div class="sk"><span class="dot" role="img" aria-label="Not proficient" title="Not proficient"></span><span style="flex:1 1 auto;min-width:0">Perception</span><b class="num" style="font-size:17px">+1</b></div>
          <div class="sk"><span class="dot" role="img" aria-label="Not proficient" title="Not proficient"></span><span style="flex:1 1 auto;min-width:0">Religion</span><b class="num" style="font-size:17px">−1</b></div>
          <div class="sk"><span class="dot" role="img" aria-label="Not proficient" title="Not proficient"></span><span style="flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px"><span>Stealth</span><i-icon name="broken-arrow" size="15" style="color:#ECA98F" hint="Disadvantage (armor)"></i-icon></span><b class="num" style="font-size:17px">−1</b></div>
          <div class="sk"><span class="dot" role="img" aria-label="Not proficient" title="Not proficient"></span><span style="flex:1 1 auto;min-width:0">Medicine</span><b class="num" style="font-size:17px">+1</b></div>
        </div>
      </section>
    </aside>`;
};

const centre = () => `
    <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
      <section class="leaf" aria-label="Attacks" style="transform:rotate(.35deg);display:flex;flex-direction:column;gap:8px">
        <x-tex kind="paper"></x-tex>
        <h2 class="leafTitle" style="position:relative"><i-icon name="crossed-swords" size="20" style="color:#8A6A2A"></i-icon>Attacks</h2>
        <div style="position:relative;display:grid;grid-template-columns:30px minmax(0,1.4fr) 56px minmax(0,1fr) auto;gap:5px 10px;align-items:center">
          <span></span><span class="th">Attack</span><span class="th">To hit</span><span class="th">Damage</span><span></span>
          <span class="iring"><i-icon name="broadsword" size="17"></i-icon></span>
          <b style="font-size:16px;min-width:0">Longsword</b>
          <b class="num" style="font-size:23px">+6</b>
          <span style="display:flex;flex-direction:column;gap:2px;line-height:1"><b class="num" style="font-size:20px">1d8+3</b><span class="th">slashing</span></span>
          <button class="btn btnBrass" type="button" aria-label="Roll Longsword" title="Roll"><i-icon name="dice-twenty-faces-twenty" size="17"></i-icon>Roll</button>
          <div style="grid-column:2 / 6;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="chip">versatile 1d10</span><span class="chip"><i-icon name="sword-array" size="13" style="color:#8A6A2A"></i-icon>mastery Sap</span><span class="chip chipD"><i-icon name="belt-buckles" size="13"></i-icon>equipped</span></div>
          <div style="grid-column:1 / 6;height:1px;background:linear-gradient(90deg,#CBB68C,rgba(203,182,140,.2))"></div>
          <span class="iring"><i-icon name="thrown-spear" size="17"></i-icon></span>
          <b style="font-size:16px;min-width:0">Javelin ×4</b>
          <b class="num" style="font-size:23px">+6</b>
          <span style="display:flex;flex-direction:column;gap:2px;line-height:1"><b class="num" style="font-size:20px">1d6+3</b><span class="th">piercing</span></span>
          <button class="btn btnBrass" type="button" aria-label="Roll Javelin" title="Roll"><i-icon name="dice-twenty-faces-twenty" size="17"></i-icon>Roll</button>
          <div style="grid-column:2 / 6;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="chip">thrown 30/120</span><span class="chip"><i-icon name="sword-array" size="13" style="color:#8A6A2A"></i-icon>mastery Slow</span></div>
          <div style="grid-column:1 / 6;height:1px;background:linear-gradient(90deg,#CBB68C,rgba(203,182,140,.2))"></div>
          <span class="iring"><i-icon name="fist" size="17"></i-icon></span>
          <b style="font-size:16px;min-width:0">Unarmed strike</b>
          <b class="num" style="font-size:23px">+6</b>
          <span style="display:flex;flex-direction:column;gap:2px;line-height:1"><b class="num" style="font-size:20px">4</b><span class="th">bludgeoning</span></span>
          <button class="btn btnBrass" type="button" aria-label="Roll Unarmed strike" title="Roll"><i-icon name="dice-twenty-faces-twenty" size="17"></i-icon>Roll</button>
        </div>
      </section>
      <section class="leaf" aria-label="Resources" style="transform:rotate(-.3deg) translateY(-3px);display:flex;flex-direction:column;gap:10px">
        <x-tex kind="paper"></x-tex>
        <h2 class="leafTitle" style="position:relative"><i-icon name="candle-flame" size="20" style="color:#8A6A2A"></i-icon>Resources</h2>
        <div style="position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px">
          <div class="block">
            <div style="display:flex;align-items:center;gap:8px"><span class="iring"><i-icon name="healing" size="16"></i-icon></span><b style="font-size:16px;flex:1 1 auto;min-width:0">Lay on Hands</b><button class="btn btnBrass" type="button" aria-label="Spend Lay on Hands points"><i-icon name="minus" size="13"></i-icon>Spend</button></div>
            <div class="gauge" style="height:12px"><div style="width:72%;height:100%;background:linear-gradient(180deg,#E8CC7C,#C9A24E 55%,#A98335)"></div></div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="num" style="font-size:17px">18 / 25 <span style="font-family:Alegreya,serif;font-size:14px;color:#5B4A36">points</span></span><span class="hint" style="display:flex;align-items:center;gap:4px"><i-icon name="night-sleep" size="14" style="color:#8A6A2A"></i-icon>long rest</span></div>
          </div>
          <div class="block">
            <div style="display:flex;align-items:center;gap:8px"><span class="iring"><i-icon name="holy-symbol" size="16"></i-icon></span><b style="font-size:16px;flex:1 1 auto;min-width:0">Channel Divinity</b><button class="btn btnBrass" type="button" aria-label="Use Channel Divinity"><i-icon name="check-mark" size="13"></i-icon>Use</button></div>
            <div style="display:flex;gap:4px;align-items:center;min-height:28px"><x-seal state="full" icon="holy-symbol" size="28" hint="Channel Divinity use — 2 of 2 left" seed="2"></x-seal><x-seal state="full" icon="holy-symbol" size="28" hint="Channel Divinity use — 2 of 2 left" seed="3"></x-seal></div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="num" style="font-size:17px">2 / 2</span><span class="hint" style="display:flex;align-items:center;gap:4px"><i-icon name="campfire" size="14" style="color:#8A6A2A"></i-icon>short rest</span></div>
          </div>
          <div class="block">
            <div style="display:flex;align-items:center;gap:8px"><span class="iring"><i-icon name="sword-brandish" size="16"></i-icon></span><b style="font-size:16px;flex:1 1 auto;min-width:0">Paladin's Smite</b><button class="btn btnBrass" type="button" aria-label="Use Paladin's Smite"><i-icon name="check-mark" size="13"></i-icon>Use</button></div>
            <div style="display:flex;gap:4px;align-items:center;min-height:28px"><x-seal state="full" icon="sword-brandish" size="28" hint="Paladin's Smite free cast — 1 of 1 left" seed="4"></x-seal></div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="num" style="font-size:17px">1 / 1 <span style="font-family:Alegreya,serif;font-size:14px;color:#5B4A36">free cast</span></span><span class="hint" style="display:flex;align-items:center;gap:4px"><i-icon name="night-sleep" size="14" style="color:#8A6A2A"></i-icon>long rest</span></div>
          </div>
          <div class="block">
            <div style="display:flex;align-items:center;gap:8px"><span class="iring"><i-icon name="crystal-wand" size="16"></i-icon></span><b style="font-size:16px;flex:1 1 auto;min-width:0">Wand of Magic Missiles</b><button class="btn btnBrass" type="button" aria-label="Use a wand charge"><i-icon name="check-mark" size="13"></i-icon>Use</button></div>
            <div style="display:flex;gap:3px;align-items:center;min-height:28px"><x-seal state="full" icon="crystal-wand" size="26" hint="Wand charge — 5 of 7 left" seed="1"></x-seal><x-seal state="full" icon="crystal-wand" size="26" hint="Wand charge — 5 of 7 left" seed="2"></x-seal><x-seal state="full" icon="crystal-wand" size="26" hint="Wand charge — 5 of 7 left" seed="3"></x-seal><x-seal state="full" icon="crystal-wand" size="26" hint="Wand charge — 5 of 7 left" seed="4"></x-seal><x-seal state="full" icon="crystal-wand" size="26" hint="Wand charge — 5 of 7 left" seed="5"></x-seal><x-seal state="spent" icon="crystal-wand" size="26" hint="Wand charge spent — 5 of 7 left" seed="6"></x-seal><x-seal state="spent" icon="crystal-wand" size="26" hint="Wand charge spent — 5 of 7 left" seed="7"></x-seal></div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="num" style="font-size:17px">5 / 7 <span style="font-family:Alegreya,serif;font-size:14px;color:#5B4A36">charges</span></span><span class="hint" style="display:flex;align-items:center;gap:4px"><i-icon name="sunrise" size="14" style="color:#8A6A2A"></i-icon>dawn</span></div>
          </div>
        </div>
      </section>
      <section class="leaf" aria-label="Conditions and death saves" style="transform:rotate(.2deg);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px">
        <x-tex kind="paper"></x-tex>
        <div style="position:relative;display:flex;flex-direction:column;gap:8px">
          <h2 class="leafTitle"><i-icon name="poison-bottle" size="20" style="color:#8A6A2A"></i-icon>Conditions</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button class="cond" type="button" aria-expanded="false" aria-label="Poisoned, 3 rounds left, from Giant Spider" title="Poisoned, 3 rounds left, from Giant Spider"><i-icon name="poison-bottle" size="16"></i-icon>Poisoned<span class="dur">3 rounds</span></button>
            <button class="cond" type="button" aria-expanded="false" aria-label="Frightened, indefinite" title="Frightened, indefinite"><i-icon name="terror" size="16"></i-icon>Frightened</button>
            <button class="btn btnGhost" type="button" style="height:36px"><i-icon name="plus" size="14"></i-icon>Add condition</button>
          </div>
        </div>
        <div style="position:relative;display:flex;flex-direction:column;gap:4px">
          <h2 class="leafTitle"><i-icon name="skull" size="20" style="color:#8A6A2A"></i-icon>Death saves</h2>
          <div style="display:grid;grid-template-columns:auto repeat(3,36px);gap:0 2px;align-items:center">
            <span style="font-size:15px">Successes</span><button class="ring" type="button" aria-label="Death save success 1" title="Mark success"><span class="ringI"></span></button><button class="ring" type="button" aria-label="Death save success 2" title="Mark success"><span class="ringI"></span></button><button class="ring" type="button" aria-label="Death save success 3" title="Mark success"><span class="ringI"></span></button>
            <span style="font-size:15px">Failures</span><button class="ring" type="button" aria-label="Death save failure 1" title="Mark failure"><span class="ringI ringF"></span></button><button class="ring" type="button" aria-label="Death save failure 2" title="Mark failure"><span class="ringI ringF"></span></button><button class="ring" type="button" aria-label="Death save failure 3" title="Mark failure"><span class="ringI ringF"></span></button>
          </div>
        </div>
      </section>
      <section class="leaf" aria-label="Features" style="transform:rotate(-.25deg);display:flex;flex-direction:column;gap:8px">
        <x-tex kind="paper"></x-tex>
        <h2 class="leafTitle" style="position:relative"><i-icon name="laurels" size="20" style="color:#8A6A2A"></i-icon>Features</h2>
        <div style="position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 18px;align-items:start">
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <div class="src"><i-icon name="templar-shield" size="16" style="color:#8A6A2A" hint="Class: Paladin"></i-icon>Paladin</div>
            <div class="feat" title="From Paladin, level 1"><i-icon name="templar-shield" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Lay on Hands</span><span class="lvlBadge" title="Level 1">lv 1</span><a href="#" class="ico icoSm" aria-label="Details: Lay on Hands" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="feat" title="From Paladin, level 1"><i-icon name="templar-shield" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Spellcasting</span><span class="lvlBadge" title="Level 1">lv 1</span><a href="#" class="ico icoSm" aria-label="Details: Spellcasting" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="feat" title="From Paladin, level 1"><i-icon name="templar-shield" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Weapon Mastery</span><span class="lvlBadge" title="Level 1">lv 1</span><a href="#" class="ico icoSm" aria-label="Details: Weapon Mastery" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="feat" title="From Paladin, level 2"><i-icon name="templar-shield" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Fighting Style: Protection</span><span class="lvlBadge" title="Level 2">lv 2</span><a href="#" class="ico icoSm" aria-label="Details: Fighting Style: Protection" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="feat" title="From Paladin, level 2"><i-icon name="templar-shield" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Paladin's Smite</span><span class="lvlBadge" title="Level 2">lv 2</span><a href="#" class="ico icoSm" aria-label="Details: Paladin's Smite" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="feat" title="From Paladin, level 3"><i-icon name="templar-shield" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Channel Divinity: Sacred Weapon</span><span class="lvlBadge" title="Level 3">lv 3</span><a href="#" class="ico icoSm" aria-label="Details: Channel Divinity: Sacred Weapon" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="feat" title="From Paladin, level 5"><i-icon name="templar-shield" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Extra Attack</span><span class="lvlBadge" title="Level 5">lv 5</span><a href="#" class="ico icoSm" aria-label="Details: Extra Attack" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="feat" title="From Paladin, level 5"><i-icon name="templar-shield" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Faithful Steed</span><span class="lvlBadge" title="Level 5">lv 5</span><a href="#" class="ico icoSm" aria-label="Details: Faithful Steed" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <div class="src"><i-icon name="holy-symbol" size="16" style="color:#8A6A2A" hint="Subclass: Oath of Devotion"></i-icon>Oath of Devotion</div>
            <div class="feat" title="From Oath of Devotion, level 3"><i-icon name="holy-symbol" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Sacred Weapon</span><span class="lvlBadge" title="Level 3">lv 3</span><a href="#" class="ico icoSm" aria-label="Details: Sacred Weapon" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="src"><i-icon name="person" size="16" style="color:#8A6A2A" hint="Species: Human"></i-icon>Human</div>
            <div class="feat" title="From Human"><i-icon name="person" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Resourceful</span><a href="#" class="ico icoSm" aria-label="Details: Resourceful" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="feat" title="From Human"><i-icon name="person" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Skillful</span><a href="#" class="ico icoSm" aria-label="Details: Skillful" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="feat" title="From Human"><i-icon name="person" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Versatile</span><a href="#" class="ico icoSm" aria-label="Details: Versatile" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
            <div class="src"><i-icon name="medal" size="16" style="color:#8A6A2A" hint="Background: Soldier"></i-icon>Soldier</div>
            <div class="feat" title="From Soldier, feat"><i-icon name="medal" size="16" style="color:#8A6A2A"></i-icon><span style="flex:1 1 auto;min-width:0">Savage Attacker</span><span class="chip" style="height:18px;font-size:14px;padding:0 5px">feat</span><a href="#" class="ico icoSm" aria-label="Details: Savage Attacker" title="Details"><i-icon name="info" size="14"></i-icon></a></div>
          </div>
        </div>
      </section>
    </div>`;

const right = (o) => {
  const sel = o.sel === 'bless' ? ' srowOn' : '';
  return `
    <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
      <section class="leaf" aria-label="Spells" style="transform:rotate(-.25deg);display:flex;flex-direction:column;gap:3px;padding-top:26px">
        <x-tex kind="paper"></x-tex>
        <div role="status" class="ribbon"><div class="ribbonIn"><i-icon name="concentration-orb" size="16" hint="Concentrating on Bless, round 3"></i-icon><b>Concentrating: Bless</b><span style="opacity:.92">round 3</span></div></div>
        <div style="position:relative;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h2 class="leafTitle"><i-icon name="spell-book" size="20" style="color:#8A6A2A"></i-icon>Spells</h2><span class="chip"><i-icon name="charm" size="14" style="color:#8A6A2A"></i-icon>Charisma</span><span class="chip">Save DC 14</span><span class="chip">Spell attack +6</span></div>
        <div class="lvl" style="padding-top:6px"><span style="display:flex;gap:3px;align-items:center"><x-seal state="full" text="I" size="26" fs="30" hint="Spell slot, level 1 — 3 of 4 left" seed="1"></x-seal><x-seal state="full" text="I" size="26" fs="30" hint="Spell slot, level 1 — 3 of 4 left" seed="2"></x-seal><x-seal state="full" text="I" size="26" fs="30" hint="Spell slot, level 1 — 3 of 4 left" seed="3"></x-seal><x-seal state="spent" text="I" size="26" fs="30" hint="Spell slot spent, level 1 — 3 of 4 left" seed="4"></x-seal></span><span style="font:14px/1 Alegreya,serif;color:#5B4A36">Level 1 slots</span><span class="num" style="font-size:16px">3 / 4</span><span class="lvlRule"></span><span class="hint" style="display:flex;align-items:center;gap:4px;font-family:Alegreya,serif"><i-icon name="night-sleep" size="14" style="color:#8A6A2A"></i-icon>long rest</span></div>
        <div class="srow${sel}"><i-icon name="sparkles" size="18" style="color:#8A6A2A"></i-icon><span style="display:flex;align-items:center;gap:8px;min-width:0"><span>Bless</span><span class="chip chipV" style="height:20px" title="Concentrating on Bless, round 3"><i-icon name="concentration-orb" size="12" hint="Concentrating on Bless, round 3"></i-icon>concentrating</span></span><span style="display:flex;gap:4px;align-items:center"><a href="#" class="ico icoSm" aria-label="Details: Bless" title="Details"><i-icon name="info" size="14"></i-icon></a><button class="btn btnBrass" type="button" style="height:28px" aria-label="Cast Bless"><i-icon name="magic-swirl" size="14"></i-icon>Cast</button></span></div>
        <div class="srow"><i-icon name="healing" size="18" style="color:#8A6A2A"></i-icon><span>Cure Wounds</span><button class="btn btnBrass" type="button" style="height:28px" aria-label="Cast Cure Wounds"><i-icon name="magic-swirl" size="14"></i-icon>Cast</button></div>
        <div class="srow"><i-icon name="sword-brandish" size="18" style="color:#8A6A2A"></i-icon><span>Divine Smite</span><button class="btn btnBrass" type="button" style="height:28px" aria-label="Cast Divine Smite"><i-icon name="magic-swirl" size="14"></i-icon>Cast</button></div>
        <div class="srow"><i-icon name="magic-shield" size="18" style="color:#8A6A2A"></i-icon><span>Shield of Faith</span><button class="btn btnBrass" type="button" style="height:28px" aria-label="Cast Shield of Faith"><i-icon name="magic-swirl" size="14"></i-icon>Cast</button></div>
        <div class="srow"><i-icon name="holy-symbol" size="18" style="color:#8A6A2A"></i-icon><span style="display:flex;align-items:center;gap:6px;min-width:0"><span>Protection from Evil and Good</span><i-icon name="fleur-de-lys" size="14" style="color:#8A6A2A" hint="Always prepared (Oath of Devotion)"></i-icon></span><button class="btn btnBrass" type="button" style="height:28px" aria-label="Cast Protection from Evil and Good"><i-icon name="magic-swirl" size="14"></i-icon>Cast</button></div>
        <div class="srow"><i-icon name="angel-wings" size="18" style="color:#8A6A2A"></i-icon><span style="display:flex;align-items:center;gap:6px;min-width:0"><span>Sanctuary</span><i-icon name="fleur-de-lys" size="14" style="color:#8A6A2A" hint="Always prepared (Oath of Devotion)"></i-icon></span><button class="btn btnBrass" type="button" style="height:28px" aria-label="Cast Sanctuary"><i-icon name="magic-swirl" size="14"></i-icon>Cast</button></div>
        <div class="lvl" style="padding-top:6px"><span style="display:flex;gap:3px;align-items:center"><x-seal state="full" text="II" size="26" fs="28" hint="Spell slot, level 2 — 2 of 2 left" seed="5"></x-seal><x-seal state="full" text="II" size="26" fs="28" hint="Spell slot, level 2 — 2 of 2 left" seed="6"></x-seal></span><span style="font:14px/1 Alegreya,serif;color:#5B4A36">Level 2 slots</span><span class="num" style="font-size:16px">2 / 2</span><span class="lvlRule"></span><span class="hint" style="display:flex;align-items:center;gap:4px;font-family:Alegreya,serif"><i-icon name="night-sleep" size="14" style="color:#8A6A2A"></i-icon>long rest</span></div>
        <div class="srow"><i-icon name="hearts" size="18" style="color:#8A6A2A"></i-icon><span>Aid</span><button class="btn btnBrass" type="button" style="height:28px" aria-label="Cast Aid"><i-icon name="magic-swirl" size="14"></i-icon>Cast</button></div>
        <div class="srow"><i-icon name="bandage-roll" size="18" style="color:#8A6A2A"></i-icon><span>Lesser Restoration</span><button class="btn btnBrass" type="button" style="height:28px" aria-label="Cast Lesser Restoration"><i-icon name="magic-swirl" size="14"></i-icon>Cast</button></div>
        <div class="srow"><i-icon name="scales" size="18" style="color:#8A6A2A"></i-icon><span style="display:flex;align-items:center;gap:6px;min-width:0"><span>Zone of Truth</span><i-icon name="fleur-de-lys" size="14" style="color:#8A6A2A" hint="Always prepared (Oath of Devotion)"></i-icon></span><button class="btn btnBrass" type="button" style="height:28px" aria-label="Cast Zone of Truth"><i-icon name="magic-swirl" size="14"></i-icon>Cast</button></div>
        <div class="srow"><i-icon name="meditation" size="18" style="color:#8A6A2A"></i-icon><span style="display:flex;align-items:center;gap:6px;min-width:0"><span>Calm Emotions</span><i-icon name="fleur-de-lys" size="14" style="color:#8A6A2A" hint="Always prepared (Oath of Devotion)"></i-icon></span><button class="btn btnBrass" type="button" style="height:28px" aria-label="Cast Calm Emotions"><i-icon name="magic-swirl" size="14"></i-icon>Cast</button></div>
      </section>
      <section aria-label="Bag" style="position:relative;display:flex;flex-direction:column;gap:0">
        <svg viewBox="0 0 460 30" preserveAspectRatio="none" width="100%" height="30" aria-hidden="true" style="display:block"><path d="M150 32 C170 2 290 2 310 32" fill="none" stroke="#1E110A" stroke-width="13"/><path d="M150 32 C170 2 290 2 310 32" fill="none" stroke="#5A3A26" stroke-width="9"/><path d="M150 32 C170 2 290 2 310 32" fill="none" stroke="#C9A24E" stroke-width="1" stroke-dasharray="3 4" opacity=".55"/></svg>
        <div style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;height:54px;padding:0 18px 4px;box-sizing:border-box;border-radius:16px 16px 4px 4px;background:linear-gradient(180deg,#75503A,#6A4630 55%,#5A3A26);box-shadow:inset 0 0 0 1px rgba(201,162,78,.4),inset 0 -10px 14px rgba(0,0,0,.35),0 -2px 6px rgba(0,0,0,.4);outline:1px dashed rgba(201,162,78,.45);outline-offset:-6px">
          <x-tex kind="leather" style="border-radius:16px 16px 4px 4px"></x-tex>
          <h2 style="position:relative;margin:0;font:21px/1 Forum,serif;font-weight:400;color:#E8CC7C;display:flex;align-items:center;gap:8px;text-shadow:0 1px 1px rgba(0,0,0,.6)"><i-icon name="swap-bag" size="20"></i-icon>Bag</h2>
          <button class="btn btnBrass" type="button" style="position:relative"><i-icon name="plus" size="14"></i-icon>Add item</button>
        </div>
        <div style="position:relative;display:flex;flex-direction:column;gap:10px;padding:22px 12px 14px;border-radius:6px 6px 30px 30px;background:linear-gradient(180deg,#4A2E1E,#3B2416 70%,#31200F);box-shadow:0 14px 26px rgba(0,0,0,.62),inset 0 0 0 1px rgba(201,162,78,.3),inset 0 -2px 0 rgba(0,0,0,.4);outline:1px dashed rgba(201,162,78,.4);outline-offset:-7px">
          <x-tex kind="leather" style="border-radius:6px 6px 30px 30px"></x-tex>
          <div aria-hidden="true" style="position:absolute;left:50%;top:-16px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;z-index:2">
            <span style="display:block;width:18px;height:12px;background:linear-gradient(90deg,#4A2E1E,#6A4630,#4A2E1E);box-shadow:inset 0 0 0 1px rgba(201,162,78,.4)"></span>
            <svg viewBox="0 0 30 30" width="30" height="30"><rect x="3" y="3" width="24" height="24" rx="4" fill="none" stroke="#C9A24E" stroke-width="4"/><rect x="3" y="3" width="24" height="24" rx="4" fill="none" stroke="#8A6A2A" stroke-width="1.2"/><path d="M15 3 V18" stroke="#E8CC7C" stroke-width="3" stroke-linecap="round"/><circle cx="15" cy="18" r="2.4" fill="#8A6A2A"/></svg>
          </div>
          <div style="position:relative;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:8px;border-radius:6px;background:#1A0E08;box-shadow:inset 0 3px 8px rgba(0,0,0,.85),inset 0 0 0 1px rgba(201,162,78,.2)">
            <button class="slot" type="button" title="Chain mail, 55 lb, equipped"><span class="tagE" role="img" aria-label="Equipped" title="Equipped">E</span><span class="slotIco"><i-icon name="chain-mail" size="20"></i-icon></span><span class="slotCap"><span>Chain mail</span><span class="slotSub">55 lb</span></span></button>
            <button class="slot" type="button" title="Shield, 6 lb, equipped"><span class="tagE" role="img" aria-label="Equipped" title="Equipped">E</span><span class="slotIco"><i-icon name="round-shield" size="20"></i-icon></span><span class="slotCap"><span>Shield</span><span class="slotSub">6 lb</span></span></button>
            <button class="slot" type="button" title="Longsword, 3 lb, equipped"><span class="tagE" role="img" aria-label="Equipped" title="Equipped">E</span><span class="slotIco"><i-icon name="broadsword" size="20"></i-icon></span><span class="slotCap"><span>Longsword</span><span class="slotSub">3 lb</span></span></button>
            <button class="slot" type="button" title="Javelin, 4, 8 lb"><span class="qty">×4</span><span class="slotIco"><i-icon name="thrown-spear" size="20"></i-icon></span><span class="slotCap"><span>Javelin</span><span class="slotSub">8 lb</span></span></button>
            <button class="slot" type="button" title="Ring of Protection, equipped, attuned, rare"><span class="tagE" role="img" aria-label="Equipped" title="Equipped">E</span><span class="gem" role="img" aria-label="Attuned" title="Attuned"></span><span class="slotIco"><i-icon name="ring" size="20"></i-icon></span><span class="slotCap"><span>Ring of Protection</span><span class="slotSub">rare</span></span></button>
            <button class="slot slotOn" type="button" aria-pressed="true" title="Wand of Magic Missiles, 1 lb, 5 of 7 charges, uncommon"><span class="slotIco"><i-icon name="crystal-wand" size="20"></i-icon></span><span class="slotCap"><span>Wand of Magic Missiles</span><span class="slotSub">5/7 charges</span></span></button>
            <button class="slot" type="button" title="Potion of Healing, 2, 1 lb, consumable, common"><span class="qty">×2</span><span class="slotIco"><i-icon name="health-potion" size="20"></i-icon></span><span class="slotCap"><span>Potion of Healing</span><span class="slotSub">1 lb, common</span></span></button>
            <button class="slot" type="button" title="Holy symbol (amulet), 1 lb, equipped"><span class="tagE" role="img" aria-label="Equipped" title="Equipped">E</span><span class="slotIco"><i-icon name="gem-pendant" size="20"></i-icon></span><span class="slotCap"><span>Holy symbol (amulet)</span><span class="slotSub">1 lb</span></span></button>
            <button class="slot" type="button" title="Healer's kit, 3 lb, 3 uses left"><span class="slotIco"><i-icon name="medical-pack" size="20"></i-icon></span><span class="slotCap"><span>Healer's kit</span><span class="slotSub">3 lb, 3 uses left</span></span></button>
            <button class="slot" type="button" title="Backpack, 5 lb"><span class="slotIco"><i-icon name="backpack" size="20"></i-icon></span><span class="slotCap"><span>Backpack</span><span class="slotSub">5 lb</span></span></button>
            <button class="slot" type="button" title="Bedroll, 7 lb"><span class="slotIco"><i-icon name="rolled-cloth" size="20"></i-icon></span><span class="slotCap"><span>Bedroll</span><span class="slotSub">7 lb</span></span></button>
            <button class="slot" type="button" title="Rations, 10, 20 lb"><span class="qty">×10</span><span class="slotIco"><i-icon name="bread" size="20"></i-icon></span><span class="slotCap"><span>Rations</span><span class="slotSub">20 lb</span></span></button>
            <button class="slot" type="button" title="Rope, 50 ft, 5 lb"><span class="slotIco"><i-icon name="rope-coil" size="20"></i-icon></span><span class="slotCap"><span>Rope, 50 ft</span><span class="slotSub">5 lb</span></span></button>
            <button class="slot" type="button" title="Torch, 10, 10 lb"><span class="qty">×10</span><span class="slotIco"><i-icon name="torch" size="20"></i-icon></span><span class="slotCap"><span>Torch</span><span class="slotSub">10 lb</span></span></button>
            <button class="slot" type="button" title="Waterskin, 5 lb"><span class="slotIco"><i-icon name="water-flask" size="20"></i-icon></span><span class="slotCap"><span>Waterskin</span><span class="slotSub">5 lb</span></span></button>
            <button class="slot" type="button" title="Dice set"><span class="slotIco"><i-icon name="dice-six-faces-six" size="20"></i-icon></span><span class="slotCap"><span>Dice set</span></span></button>
          </div>
          <div style="position:relative;display:flex;flex-direction:column;gap:8px;padding:0 4px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><i-icon name="crystal-wand" size="16" style="color:#E8CC7C"></i-icon><b style="font-size:16px;color:#F3E6C8">Wand of Magic Missiles</b><span class="chip chipD">1 lb</span><span class="chip chipD">uncommon</span></div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><button class="btn btnBrass" type="button"><i-icon name="check-mark" size="14"></i-icon>Use</button><button class="btn btnLeather" type="button"><i-icon name="aura" size="14"></i-icon>Attune</button><button class="btn btnLeather" type="button"><i-icon name="belt-buckles" size="14"></i-icon>Equip</button><button class="btn btnLeather" type="button"><i-icon name="info" size="14"></i-icon>Details</button></div>
          </div>
        </div>
      </section>
      <section aria-label="Coins and carried weight" style="position:relative;display:flex;flex-wrap:wrap;gap:14px 18px;align-items:stretch">
        <div style="flex:1 1 300px;display:flex;align-items:center;gap:8px;padding:4px 0;min-width:0">
          <svg viewBox="0 0 56 66" width="52" height="62" aria-hidden="true"><path d="M14 22 C4 32 2 48 10 58 C16 65 40 65 46 58 C54 48 52 32 42 22 Z" fill="#1A0E08" opacity=".55" transform="translate(2,3)"/><path d="M14 22 C4 32 2 48 10 58 C16 65 40 65 46 58 C54 48 52 32 42 22 Z" fill="#4A2E1E" stroke="#2E1B11" stroke-width="1"/><path d="M19 26 C11 34 10 46 15 54" fill="none" stroke="#6A4630" stroke-width="2.5" opacity=".9" stroke-linecap="round"/><path d="M12 29 C6 37 5 49 12 56" fill="none" stroke="#C9A24E" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/><path d="M14 22 Q28 17 42 22 Q28 28 14 22 Z" fill="#2E1B11"/><path d="M17 12 C22 5 34 5 39 12 L42 22 Q28 17 14 22 Z" fill="#5A3A26" stroke="#2E1B11" stroke-width="1"/><path d="M11 20 Q28 27 45 20" fill="none" stroke="#C9A24E" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="20" r="2.6" fill="#E8CC7C"/><circle cx="46" cy="20" r="2.6" fill="#E8CC7C"/></svg>
          <div class="coinStack"><svg viewBox="0 0 36 28" width="34" height="26" aria-hidden="true"><ellipse cx="18" cy="22" rx="15" ry="5" fill="#A3A8B3"/><ellipse cx="18" cy="18.5" rx="15" ry="5" fill="#E6E9EF"/><ellipse cx="18" cy="14.5" rx="15" ry="5" fill="#A3A8B3"/><ellipse cx="18" cy="11" rx="15" ry="5" fill="#E6E9EF"/><ellipse cx="18" cy="7" rx="15" ry="5" fill="#A3A8B3"/><ellipse cx="18" cy="5" rx="15" ry="5" fill="#E6E9EF" stroke="#C7CBD2" stroke-width=".6"/></svg><span class="num" style="font-size:17px;color:#F3E6C8">4 <span style="font-family:Alegreya,serif;font-size:14px;color:#E0C27A">pp</span></span></div>
          <div class="coinStack"><svg viewBox="0 0 36 28" width="34" height="26" aria-hidden="true"><ellipse cx="18" cy="22" rx="15" ry="5" fill="#9E7E2E"/><ellipse cx="18" cy="18.5" rx="15" ry="5" fill="#E0B64A"/><ellipse cx="18" cy="14.5" rx="15" ry="5" fill="#9E7E2E"/><ellipse cx="18" cy="11" rx="15" ry="5" fill="#E0B64A"/><ellipse cx="18" cy="7" rx="15" ry="5" fill="#9E7E2E"/><ellipse cx="18" cy="5" rx="15" ry="5" fill="#E0B64A" stroke="#F3D98A" stroke-width=".6"/></svg><span class="num" style="font-size:17px;color:#F3E6C8">38 <span style="font-family:Alegreya,serif;font-size:14px;color:#E0C27A">gp</span></span></div>
          <div class="coinStack"><svg viewBox="0 0 36 28" width="34" height="26" aria-hidden="true"><ellipse cx="18" cy="22" rx="15" ry="5" fill="#8A9097"/><ellipse cx="18" cy="18.5" rx="15" ry="5" fill="#C8CDD3"/><ellipse cx="18" cy="14.5" rx="15" ry="5" fill="#8A9097"/><ellipse cx="18" cy="11" rx="15" ry="5" fill="#C8CDD3"/><ellipse cx="18" cy="7" rx="15" ry="5" fill="#8A9097"/><ellipse cx="18" cy="5" rx="15" ry="5" fill="#C8CDD3" stroke="#E3E6EA" stroke-width=".6"/></svg><span class="num" style="font-size:17px;color:#F3E6C8">12 <span style="font-family:Alegreya,serif;font-size:14px;color:#E0C27A">sp</span></span></div>
          <div class="coinStack"><svg viewBox="0 0 36 28" width="34" height="26" aria-hidden="true"><ellipse cx="18" cy="22" rx="15" ry="5" fill="#7A4524"/><ellipse cx="18" cy="18.5" rx="15" ry="5" fill="#B5693A"/><ellipse cx="18" cy="14.5" rx="15" ry="5" fill="#7A4524"/><ellipse cx="18" cy="11" rx="15" ry="5" fill="#B5693A"/><ellipse cx="18" cy="7" rx="15" ry="5" fill="#7A4524"/><ellipse cx="18" cy="5" rx="15" ry="5" fill="#B5693A" stroke="#D38B5C" stroke-width=".6"/></svg><span class="num" style="font-size:17px;color:#F3E6C8">55 <span style="font-family:Alegreya,serif;font-size:14px;color:#E0C27A">cp</span></span></div>
          <div style="display:flex;flex-direction:column;gap:3px;flex:1 1 auto;min-width:0;align-items:flex-end;white-space:nowrap"><span style="font-size:14px;color:#E0C27A;line-height:1">Total value</span><span class="num" style="font-size:19px;color:#F3E6C8">≈ 79 gp</span></div>
        </div>
        <div class="strap" style="flex:1 1 210px;display:flex;flex-direction:column;gap:7px;padding:9px 14px;justify-content:center;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="display:flex;align-items:center;gap:5px;font-size:14px;color:#E0C27A;line-height:1"><i-icon name="weight" size="15"></i-icon>Carried weight</span><span class="chip chipD" style="height:22px"><i-icon name="feather" size="13"></i-icon>lightly loaded</span></div>
          <div style="display:flex;align-items:center;gap:10px"><div class="gauge" style="flex:1 1 auto;height:12px"><div style="width:45%;height:100%;background:linear-gradient(180deg,#E8CC7C,#C9A24E 55%,#A98335)"></div></div><b class="num" style="font-size:18px;color:#F3E6C8;white-space:nowrap">108 / 240 lb</b></div>
        </div>
      </section>
    </div>`;
};

// Sheet strap (desktop): zone 2 primaries, zone 3 icon-only secondaries with hints, concentration note right.
const strap = (o) => {
  const on = (k) => (o.active === k ? ' icoOn' : '');
  const pressed = (k) => (o.active === k ? ' aria-pressed="true" aria-expanded="true"' : ' aria-pressed="false"');
  return `
  <footer aria-label="Actions" style="${o.pos === 'abs' ? 'position:absolute;left:0;right:0;bottom:0' : 'position:relative'};z-index:6;display:flex;flex-direction:column;background:linear-gradient(180deg,#5A3A26,#4A2E1E 50%,#3B2416);box-shadow:0 -4px 14px rgba(0,0,0,.6),inset 0 1px 0 rgba(201,162,78,.5);flex:0 0 auto">
    <x-tex kind="leather"></x-tex>
    <div class="rivets" style="position:relative"></div>
    <div style="position:relative;display:flex;align-items:center;gap:10px;padding:6px 22px">
      <button class="btn btnEmber btnL" type="button"><i-icon name="health-decrease" size="18"></i-icon>Damage</button>
      <button class="btn btnMoss btnL" type="button"><i-icon name="health-increase" size="18"></i-icon>Heal</button>
      <button class="btn btnBrass btnL" type="button"><i-icon name="dice-twenty-faces-twenty" size="18"></i-icon>Roll</button>
      <button class="btn btnLeather btnL" type="button"><i-icon name="campfire" size="18" style="color:#E8CC7C"></i-icon>Short rest</button>
      <button class="btn btnLeather btnL" type="button"><i-icon name="night-sleep" size="18" style="color:#E8CC7C"></i-icon>Long rest</button>
      <span aria-hidden="true" style="width:2px;height:32px;background:linear-gradient(180deg,rgba(201,162,78,0),#C9A24E,rgba(201,162,78,0));flex:0 0 auto"></span>
      <button class="ico${on('cond')}" type="button" aria-label="Add condition" title="Add condition"${pressed('cond')}><i-icon name="poison-bottle" size="20"></i-icon></button>
      <button class="ico${on('notes')}" type="button" aria-label="Notes" title="Notes"${pressed('notes')}><i-icon name="notebook" size="20"></i-icon></button>
      <button class="ico${on('log')}" type="button" aria-label="Roll log" title="Roll log"${pressed('log')}><i-icon name="rolling-dices" size="20"></i-icon></button>
      <button class="ico${on('export')}" type="button" aria-label="Export" title="Export"${pressed('export')}><i-icon name="share" size="20"></i-icon></button>
      <button class="ico${on('edit')}" type="button" aria-label="Edit or override" title="Edit or override"${pressed('edit')}><i-icon name="quill" size="20"></i-icon></button>
      <span style="flex:1 1 auto"></span>
      <span style="display:flex;align-items:center;gap:8px;font-size:14px;color:#E0C27A"><i-icon name="concentration-orb" size="16" style="color:#B3A0E6" hint="Concentrating on Bless, round 3"></i-icon>Concentrating: Bless, round 3</span>
    </div>
    <div class="rivets" style="position:relative"></div>
  </footer>`;
};

// Flow strap (level-up): zone 1 Cancel · Back, zone 2 Next / Finish, right: the flow note.
const flowstrap = (o) => {
  const next = o.next || 'Next';
  const off = o.nextoff ? ` disabled="disabled" aria-disabled="true" title="${o.nextoff}"` : '';
  const offCls = o.nextoff ? ' btnOff' : '';
  const reason = o.nextoff ? `<span class="hint" style="color:#E0C27A;display:flex;align-items:center;gap:5px"><i-icon name="info" size="14" style="color:#C9A24E"></i-icon>${o.nextoff}</span>` : '';
  const note = o.note ? `<span style="display:flex;align-items:center;gap:8px;font-size:14px;color:#E0C27A"><i-icon name="upgrade" size="16" style="color:#C9A24E"></i-icon>${o.note}</span>` : '';
  const backTitle = o.backtitle || 'Back to the previous step';
  return `
  <footer aria-label="Actions" style="${o.pos === 'abs' ? 'position:absolute;left:0;right:0;bottom:0' : 'position:relative'};z-index:6;display:flex;flex-direction:column;background:linear-gradient(180deg,#5A3A26,#4A2E1E 50%,#3B2416);box-shadow:0 -4px 14px rgba(0,0,0,.6),inset 0 1px 0 rgba(201,162,78,.5);flex:0 0 auto">
    <x-tex kind="leather"></x-tex>
    <div class="rivets" style="position:relative"></div>
    <div style="position:relative;display:flex;align-items:center;gap:10px;padding:6px 22px">
      <button class="btn btnGhostL btnL" type="button" title="Leave the level up; nothing is saved"><i-icon name="cross-mark" size="15"></i-icon>Cancel</button>
      <button class="btn btnLeather btnL" type="button" title="${backTitle}"><i-icon name="return-arrow" size="17" style="color:#E8CC7C"></i-icon>Back</button>
      <span aria-hidden="true" style="width:2px;height:32px;background:linear-gradient(180deg,rgba(201,162,78,0),#C9A24E,rgba(201,162,78,0));flex:0 0 auto"></span>
      <button class="btn btnBrass btnL${offCls}" type="button"${off}>${next}<i-icon name="${o.nexticon || 'check-mark'}" size="17"></i-icon></button>
      ${reason}
      <span style="flex:1 1 auto"></span>
      ${note}
    </div>
    <div class="rivets" style="position:relative"></div>
  </footer>`;
};

// Level-up stepper (desktop, vertical parchment leaf). cur = 1..4; done steps show wax seals and their result hint.
const steps = (o) => {
  const cur = +o.cur || 1;
  const lv = o.level || '6';
  const list = [
    { n: 1, label: 'Which class?', hint: o.h1 || `Paladin ${lv}` },
    { n: 2, label: 'Hit points', hint: o.h2 || '' },
    { n: 3, label: o.l3 || 'Class choices', hint: o.h3 || '', group: o.group === 'yes' },
    { n: 4, label: 'Review', hint: '' },
  ];
  const rows = list.map((s) => {
    if (s.n === 1 && o.lock1 === 'yes') {
      // house rule "multiclassing" off: the class step is decided by the campaign; done-and-locked, hint on hover only
      return `<span class="step" style="position:relative" tabindex="0" aria-disabled="true" aria-describedby="tipLock1"><x-seal state="full" icon="padlock" size="26" label="Decided by the campaign" seed="7"></x-seal><span>${s.label}<span class="stepHint">${s.hint}</span></span><span class="tipUp" id="tipLock1" role="tooltip" style="left:0;transform:none;white-space:normal;width:224px">Multiclassing is off in The Emberfall Company — ask your DM</span></span>`;
    }
    const done = s.n < cur, isCur = s.n === cur;
    const cls = isCur ? ' stepCur' : (done ? '' : ' stepTodo');
    const n = done ? `<x-seal state="full" icon="check-mark" size="26" label="Done" seed="${s.n}"></x-seal>` : (s.group ? `<span class="stepN" style="box-shadow:none"><i-icon name="padlock" size="13" style="color:#5B4A36" hint="Appears after the class is chosen"></i-icon></span>` : `<span class="stepN">${s.n}</span>`);
    const tag = done ? 'a' : 'span';
    const href = done ? ' href="#"' : '';
    const hint = (done || isCur) && s.hint ? `<span class="stepHint">${s.hint}</span>` : (s.group ? `<span class="stepHint">after the class</span>` : '');
    return `<${tag} class="step${cls}"${href}${isCur ? ' aria-current="step"' : ''}${s.group ? ' aria-disabled="true"' : ''}>${n}<span>${s.label}${hint}</span></${tag}>`;
  }).join('');
  return `
      <nav class="leaf stepsLeaf" aria-label="Level-up steps" style="transform:rotate(.25deg)">
        <x-tex kind="paper"></x-tex>
        <div style="position:relative;display:flex;align-items:center;gap:8px;padding:2px 8px 8px"><i-icon name="upgrade" size="20" style="color:#8A6A2A"></i-icon><h2 class="leafTitle" style="font-size:20px">Level up to ${lv}</h2></div>
        <div style="position:relative;display:flex;flex-direction:column;gap:2px">${rows}</div>
        <div class="hint" style="position:relative;padding:10px 8px 2px">Back and Cancel return to the Play tab</div>
      </nav>`;
};

// ---------- phone ----------
const pwood = () => `
  <x-tex kind="wood"></x-tex>
  <div class="vign" aria-hidden="true" style="position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 90% 40% at 95% -2%,rgba(107,74,30,.7) 0%,rgba(107,74,30,.28) 40%,rgba(36,23,16,0) 72%)"></div>`;

const pbar = (o) => `
  <div class="pbar">
    <x-tex kind="leather"></x-tex>
    <button class="ico icoP" type="button" aria-label="${o.leftlabel || 'Меню'}" title="${o.leftlabel || 'Меню'}" style="position:relative"><i-icon name="${o.left || 'hamburger-menu'}" size="22"></i-icon></button>
    <div class="pbarT">${o.title || 'Іляна Ворн'}</div>
    ${o.right ? `<button class="ico icoP" type="button" aria-label="${o.rightlabel}" title="${o.rightlabel}" style="position:relative"><i-icon name="${o.right}" size="22"></i-icon></button>` : '<span></span>'}
  </div>`;

const ptabs = (o) => {
  const a = o.active || 'combat';
  const t = (id, icon, label) => `<button class="tabb${a === id ? ' tabbOn' : ''}" type="button"${a === id ? ' aria-current="page"' : ''}>${a === id ? '<span class="tabGlow" aria-hidden="true"></span>' : ''}<i-icon name="${icon}" size="24" style="position:relative"></i-icon><span style="position:relative">${label}</span></button>`;
  return `
  <nav aria-label="Розділи аркуша" style="position:relative;z-index:3;flex:0 0 auto;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));height:62px;background:linear-gradient(180deg,#2E1B11,#241710);box-shadow:inset 0 2px 0 #8A6A2A,inset 0 3px 0 #3B2416">
    <x-tex kind="leather"></x-tex>
    ${t('combat', 'crossed-swords', 'Бій')}${t('spells', 'spell-book', 'Заклинання')}${t('bag', 'swap-bag', 'Сумка')}${t('hero', 'laurels', 'Герой')}${t('more', 'hamburger-menu', 'Ще')}
  </nav>`;
};

const pactions = () => `
  <div aria-label="Дії" style="position:relative;z-index:3;flex:0 0 auto;display:flex;flex-direction:column;background:linear-gradient(180deg,#5A3A26,#4A2E1E 50%,#3B2416);box-shadow:0 -4px 12px rgba(0,0,0,.6),inset 0 1px 0 rgba(201,162,78,.5)">
    <x-tex kind="leather"></x-tex>
    <div class="rivets" style="position:relative"></div>
    <div style="position:relative;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;padding:4px 10px 6px">
      <button class="act btnEmber" type="button"><i-icon name="health-decrease" size="20"></i-icon>Шкода</button>
      <button class="act btnMoss" type="button"><i-icon name="health-increase" size="20"></i-icon>Лікування</button>
      <button class="act btnBrass" type="button"><i-icon name="dice-twenty-faces-twenty" size="20"></i-icon>Кинути</button>
      <button class="act btnLeather" type="button" style="color:#E8CC7C"><i-icon name="campfire" size="20"></i-icon>Відпочинок</button>
      <button class="act btnLeather" type="button" style="color:#E8CC7C" aria-label="Ще дії" title="Ще дії"><i-icon name="hamburger-menu" size="20"></i-icon>Ще</button>
    </div>
  </div>`;

// A2 phone Combat tab: header + scrolling body (used behind the phone bottom sheets)
const pcombat = () => `
  <header style="position:relative;z-index:2;display:flex;flex-direction:column;gap:7px;padding:8px 14px 9px;background:linear-gradient(170deg,#5A3A26 0%,#4A2E1E 55%,#3B2416 100%);box-shadow:0 4px 12px rgba(0,0,0,.6),inset 0 -1px 0 rgba(201,162,78,.4);flex:0 0 auto;outline:1px dashed rgba(201,162,78,.35);outline-offset:-6px">
    <x-tex kind="leather"></x-tex>
    <div style="position:relative;display:flex;align-items:center;gap:10px">
      <div style="width:50px;height:56px;flex:0 0 auto;border-radius:4px;padding:3px;box-sizing:border-box;background:linear-gradient(180deg,#E8CC7C 0%,#C9A24E 45%,#A98335 80%,#8A6A2A 100%);box-shadow:inset 0 1px 0 rgba(255,241,200,.7),inset 0 -1px 0 rgba(70,48,12,.7),0 2px 4px rgba(0,0,0,.6)">
        <div role="img" aria-label="Портрет, монограма ІВ" style="width:100%;height:100%;border-radius:2px;background:radial-gradient(circle at 50% 35%,#432A1A,#241710 80%);display:flex;align-items:center;justify-content:center;font-family:Forum,serif;font-size:21px;line-height:1;color:#C9A24E;box-shadow:inset 0 0 8px rgba(0,0,0,.85)">ІВ</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto">
        <h1 style="margin:0;font:24px/1.1 Forum,serif;font-weight:400;color:#F6E8CC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Іляна Ворн</h1>
        <div style="font-size:15px;line-height:1.1;color:#E0C27A;display:flex;align-items:center;gap:6px"><i-icon name="holy-symbol" size="14"></i-icon>Паладин 5</div>
      </div>
      <svg viewBox="0 0 82 96" width="50" height="58" role="img" aria-label="Клас броні 18" style="flex:0 0 auto"><defs><linearGradient id="shBrassP" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8CC7C"/><stop offset=".5" stop-color="#C9A24E"/><stop offset="1" stop-color="#8A6A2A"/></linearGradient></defs><path d="M41 4 L75 14 V44 C75 66 58 84 41 92 C24 84 7 66 7 44 V14 Z" fill="#1A0E08" opacity=".6" transform="translate(2,3)"/><path d="M41 4 L75 14 V44 C75 66 58 84 41 92 C24 84 7 66 7 44 V14 Z" fill="url(#shBrassP)" stroke="#5E4418" stroke-width="1.5"/><path d="M41 11 L68 19 V44 C68 62 54 77 41 84 C28 77 14 62 14 44 V19 Z" fill="#2E1B11" stroke="#7E5F24" stroke-width="1"/><text x="41" y="51" text-anchor="middle" dominant-baseline="central" font-family="Forum, serif" font-size="42" fill="#F6E8CC">18</text></svg>
    </div>
    <div class="strap" aria-label="Очки здоров'я" style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:center;padding:7px 12px 7px 8px">
      <div style="display:flex;align-items:center;gap:8px">
        <div aria-hidden="true" style="width:14px;height:40px;border-radius:4px;background:linear-gradient(180deg,#E8CC7C,#C9A24E 50%,#8A6A2A);box-shadow:inset 0 0 0 2px #5E4418,0 1px 2px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center"><span style="display:block;width:4px;height:22px;background:#1E110A;border-radius:2px"></span></div>
        <div class="num" style="font-size:38px;color:#F6E8CC;display:flex;align-items:baseline;gap:4px;text-shadow:0 2px 2px rgba(0,0,0,.5)"><span>31</span><span style="font-size:20px;color:#C9A24E">/ 44</span></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:14px;color:#E0C27A;line-height:1"><span style="display:flex;align-items:center;gap:4px"><i-icon name="heart" size="14"></i-icon>Очки здоров'я</span><span style="display:flex;align-items:center;gap:4px;white-space:nowrap"><i-icon name="heart-plus" size="14"></i-icon>Тимчасові ОЗ <b class="num" style="font-size:17px;color:#F6E8CC">5</b></span></div>
        <div class="gauge" title="31 з 44, плюс 5 тимчасових"><div style="width:70.5%;height:100%;background:linear-gradient(180deg,#D15A3E,#B8432A 55%,#8E3220)"></div><div style="width:11.4%;height:100%;background:repeating-linear-gradient(135deg,#E8CC7C 0 3px,#A98335 3px 6px)"></div></div>
      </div>
    </div>
    <div style="position:relative;display:flex;align-items:center;gap:8px">
      <span class="chip chipV chipP" role="status" title="Концентрація: Благословення, раунд 3" style="font-size:15px;max-width:100%;overflow:hidden"><i-icon name="concentration-orb" size="15" hint="Концентрація: Благословення, раунд 3"></i-icon><b style="white-space:nowrap">Концентрація: Благословення</b><span style="opacity:.9;white-space:nowrap">раунд 3</span></span>
    </div>
  </header>
  <div style="position:relative;z-index:1;flex:1 1 auto;min-height:0;overflow:hidden;padding:10px 12px 16px;display:flex;flex-direction:column;gap:10px;box-sizing:border-box">
    <section class="leaf leafP" style="transform:rotate(.3deg);display:flex;align-items:center;gap:8px;padding:10px 12px">
      <x-tex kind="paper"></x-tex>
      <label for="hp" style="position:relative;flex:1 1 auto;min-width:0;font-size:16px;font-weight:700;display:flex;align-items:center;gap:6px"><i-icon name="heart" size="16" style="color:#8E3220"></i-icon>Очки здоров'я</label>
      <button class="ico icoP" type="button" aria-label="Зменшити очки здоров'я" title="Зменшити" style="position:relative"><i-icon name="minus" size="20"></i-icon></button>
      <input class="hpIn" id="hp" type="number" value="31" min="0" max="44" style="position:relative">
      <button class="ico icoP" type="button" aria-label="Збільшити очки здоров'я" title="Збільшити" style="position:relative"><i-icon name="plus" size="20"></i-icon></button>
    </section>
    <section aria-label="Захист і рух" style="position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
      <div class="badge"><span class="badgeL">Клас броні</span><span class="badgeV"><i-icon name="shield" size="20" style="color:#C9A24E"></i-icon>18</span></div>
      <div class="badge"><span class="badgeL">Ініціатива</span><span class="badgeV"><i-icon name="stopwatch" size="20" style="color:#C9A24E"></i-icon>+0</span></div>
      <div class="badge"><span class="badgeL">Швидкість</span><span class="badgeV"><i-icon name="boots" size="20" style="color:#C9A24E"></i-icon>30 <span style="font-size:17px;color:#E0C27A">фт</span></span></div>
    </section>
    <section class="leaf leafP" aria-label="Рятівні кидки" style="transform:rotate(-.3deg);display:flex;flex-direction:column;gap:6px;padding:8px 12px 7px">
      <x-tex kind="paper"></x-tex>
      <div style="position:relative;display:flex;align-items:baseline;justify-content:space-between;gap:8px"><h2 class="leafTitle" style="font-size:18px"><i-icon name="shield" size="17" style="color:#8A6A2A"></i-icon>Рятівні кидки</h2></div>
      <div style="position:relative;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px">
        <div class="sv"><x-seal state="full" text="+3" size="46" hint="Рятівний кидок Сили +3" seed="1"></x-seal><span class="svL">СИЛ</span></div>
        <div class="sv"><x-seal state="full" text="+0" size="46" hint="Рятівний кидок Спритності +0" seed="2"></x-seal><span class="svL">СПР</span></div>
        <div class="sv"><x-seal state="full" text="+2" size="46" hint="Рятівний кидок Статури +2" seed="3"></x-seal><span class="svL">СТА</span></div>
        <div class="sv"><x-seal state="full" text="−1" size="46" hint="Рятівний кидок Інтелекту −1" seed="4"></x-seal><span class="svL">ІНТ</span></div>
        <div class="sv"><x-seal state="full" text="+4" size="46" hint="Мудрість +4, майстерність" seed="5"></x-seal><span class="svL">МДР<i-icon name="star" size="11" style="color:#8A6A2A" hint="Майстерність у рятівному кидку"></i-icon></span></div>
        <div class="sv"><x-seal state="full" text="+6" size="46" hint="Харизма +6, майстерність" seed="6"></x-seal><span class="svL">ХАР<i-icon name="star" size="11" style="color:#8A6A2A" hint="Майстерність у рятівному кидку"></i-icon></span></div>
      </div>
    </section>
    <section class="leaf leafP" aria-label="Атаки" style="transform:rotate(.25deg);display:flex;flex-direction:column;gap:5px;padding:9px 12px">
      <x-tex kind="paper"></x-tex>
      <h2 class="leafTitle" style="position:relative;font-size:18px"><i-icon name="crossed-swords" size="17" style="color:#8A6A2A"></i-icon>Атаки</h2>
      <div class="arow" style="position:relative">
        <span class="iring iringP"><i-icon name="broadsword" size="18"></i-icon></span>
        <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><b style="font-size:16px;line-height:1.1">Довгий меч</b><span style="font-size:15px;line-height:1.15;color:#5B4A36">1к8+3 рубаючий</span></span>
        <b class="num" style="font-size:24px">+6</b>
        <button class="btn btnBrass btnP" type="button" aria-label="Кинути: Довгий меч" style="padding:0 12px"><i-icon name="dice-twenty-faces-twenty" size="18"></i-icon>Кинути</button>
      </div>
      <div class="rule" style="position:relative"></div>
      <div class="arow" style="position:relative">
        <span class="iring iringP"><i-icon name="thrown-spear" size="18"></i-icon></span>
        <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><b style="font-size:16px;line-height:1.1">Дротик ×4</b><span style="font-size:15px;line-height:1.15;color:#5B4A36">1к6+3 колючий</span></span>
        <b class="num" style="font-size:24px">+6</b>
        <button class="btn btnBrass btnP" type="button" aria-label="Кинути: Дротик" style="padding:0 12px"><i-icon name="dice-twenty-faces-twenty" size="18"></i-icon>Кинути</button>
      </div>
    </section>
  </div>`;

// phone flow strap (level-up): Скасувати · Назад · Далі / Завершити підвищення
const pflow = (o) => {
  const next = o.next || 'Далі';
  const off = o.nextoff ? ` disabled="disabled" aria-disabled="true" title="${o.nextoff}"` : '';
  return `
  <div aria-label="Дії" style="position:relative;z-index:3;flex:0 0 auto;display:flex;flex-direction:column;background:linear-gradient(180deg,#5A3A26,#4A2E1E 50%,#3B2416);box-shadow:0 -4px 12px rgba(0,0,0,.6),inset 0 1px 0 rgba(201,162,78,.5)">
    <x-tex kind="leather"></x-tex>
    <div class="rivets" style="position:relative"></div>
    <div style="position:relative;display:grid;grid-template-columns:44px 44px minmax(0,1fr);gap:10px;padding:6px 12px 8px;align-items:center">
      <button class="ico icoP" type="button" aria-label="Скасувати підвищення рівня" title="Скасувати підвищення рівня"><i-icon name="cross-mark" size="18"></i-icon></button>
      <button class="ico icoP" type="button" aria-label="Назад" title="${o.backtitle || 'Назад до попереднього кроку'}"><i-icon name="return-arrow" size="20"></i-icon></button>
      <button class="btn btnBrass btnP${o.nextoff ? ' btnOff' : ''}" type="button"${off} style="padding:0 12px;justify-content:center">${next}<i-icon name="${o.nexticon || 'check-mark'}" size="16"></i-icon></button>
    </div>
  </div>`;
};

// phone step strip
const pstrip = (o) => `
    <div class="pstrip" role="group" aria-label="Крок ${o.n} з ${o.of}: ${o.label}">
      <x-tex kind="leather"></x-tex>
      <button class="ico icoP" type="button" aria-label="Усі кроки" title="Усі кроки" aria-haspopup="dialog" style="position:relative"><i-icon name="hamburger-menu" size="20"></i-icon></button>
      <div style="position:relative;display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0"><span class="pstripC">Крок ${o.n} з ${o.of}</span><span class="pstripL">${o.label}</span></div>
      <div class="gauge gauge8" style="position:relative;width:80px" role="progressbar" aria-valuemin="1" aria-valuemax="${o.of}" aria-valuenow="${o.n}" aria-label="Крок ${o.n} з ${o.of}"><div style="width:${Math.round((+o.n / +o.of) * 100)}%;height:100%;background:linear-gradient(90deg,#8A6A2A,#C9A24E);border-radius:4px"></div></div>
    </div>`;

// phone Timeline tab content (under Ще → Хроніка); icon-only revert buttons with hints
const ptimeline = (o) => {
  const rev = (label) => `<button class="ico icoP icoLeaf" type="button" aria-label="Відкотити: ${label}" title="Відкотити"><i-icon name="anticlockwise-rotation" size="18"></i-icon></button>`;
  const row = (icon, color, text, time, right) => `<div class="tl" style="grid-template-columns:26px minmax(0,1fr) auto;min-height:52px;font-size:15px;gap:8px"><i-icon name="${icon}" size="20" style="color:${color}"></i-icon><span style="display:flex;flex-direction:column;gap:3px;min-width:0"><span>${text}</span><span class="tlTime" style="text-align:left;min-width:0">${time}</span></span>${right}</div>`;
  const tipOpen = '';
  const rev1 = o.tip === 'none' ? rev('Накладено: Благословення') : `<span class="glyph" tabindex="0" aria-describedby="tipRev1">${rev('Накладено: Благословення')}<span class="tip" id="tipRev1" role="tooltip" style="left:auto;right:0;transform:none;font-size:15px;white-space:normal;width:230px">Відкотити<span class="tipSub">Героя буде перераховано без цієї події; пізніші події залишаться.</span></span></span>`;
  return `
    <div style="position:relative;display:flex;align-items:center;gap:6px;flex-wrap:wrap" role="group" aria-label="Фільтр подій">
      <button class="chip chipBtn chipOn" type="button" aria-pressed="true" style="height:36px"><i-icon name="hourglass" size="13"></i-icon>Усе</button>
      <button class="chip chipBtn" type="button" aria-pressed="false" style="height:36px"><i-icon name="crossed-swords" size="13" style="color:#8A6A2A"></i-icon>Гра</button>
      <button class="chip chipBtn" type="button" aria-pressed="false" style="height:36px"><i-icon name="anvil" size="13" style="color:#8A6A2A"></i-icon>Білд</button>
      <button class="chip chipBtn" type="button" aria-pressed="false" style="height:36px"><i-icon name="stack" size="13" style="color:#8A6A2A"></i-icon>Пакети</button>
      <button class="ico icoP" type="button" aria-label="Пошук подій" title="Пошук подій" style="margin-left:auto"><i-icon name="magnifying-glass" size="20"></i-icon></button>
    </div>
    <section class="leaf leafP" aria-label="Хроніка" style="transform:rotate(.2deg);display:flex;flex-direction:column;gap:2px;padding:8px 12px 10px">
      <x-tex kind="paper"></x-tex>
      <div class="day" style="position:relative;font-size:17px;padding:6px 0 2px"><i-icon name="candle-flame" size="16" style="color:#8A6A2A"></i-icon>Сьогодні · Сесія 7<span class="lvlRule"></span><span class="th" style="font-size:13px">2 лист. 2026</span></div>
      <div style="position:relative;display:flex;flex-direction:column">
        ${row('fire-spell-cast', '#574489', 'Накладено: <b>Благословення</b> (комірка 1 рівня); розпочато концентрацію.', '21:42', rev1)}
        ${row('broken-heart', '#8E3220', 'Отримано <b>7 шкоди</b> від Гігантського павука (38 → 31).', '21:40', rev('Отримано 7 шкоди'))}
        ${row('skull', '#8E3220', 'Отримано стан <b>Отруєний</b> на 3 раунди, від Гігантського павука.', '21:38', rev('Отримано стан Отруєний'))}
        ${row('campfire', '#8A6A2A', '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span>Взято <b>короткий відпочинок</b>: витрачено 1 кістку хітів, відновлено 8.</span><button class="exp" type="button" aria-expanded="false" aria-label="Показати 3 події" title="Показати 3 події" style="width:30px;height:30px"><i-icon name="plus" size="12"></i-icon></button><span class="hint" style="font-size:14px">3 події</span></span>', '21:10', rev('Взято короткий відпочинок'))}
        ${row('heart-plus', '#8A6A2A', 'Отримано <b>5 тимчасових</b> хітів.', '20:55', rev('Отримано 5 тимчасових хітів'))}
      </div>
      <div class="day" style="position:relative;font-size:17px;padding:10px 0 2px"><i-icon name="candle-flame" size="16" style="color:#8A6A2A"></i-icon>Сесія 6<span class="lvlRule"></span><span class="th" style="font-size:13px">26 жовт. 2026</span></div>
      <div style="position:relative;display:flex;flex-direction:column">
        ${row('laurels', '#8A6A2A', 'Нараховано <b>500 досвіду</b> (6 000 → 6 500).', '23:05', rev('Нараховано 500 досвіду'))}
        ${row('swap-bag', '#8A6A2A', 'Додано <b>Зілля лікування</b> ×2.', '22:48', rev('Додано Зілля лікування'))}
        ${row('scroll-unfurled', '#8A6A2A', 'Додано нотатку <b>«Борги та послуги»</b>.', '22:10', rev('Додано нотатку'))}
        ${row('broken-heart', '#645238', '<span class="tlRev">Отримано 12 шкоди від Культиста (40 → 28).</span>', '20:12', `<span class="chip" style="height:30px;font-size:14px" title="Відкочено о 20:14 — героя перераховано без цієї події"><i-icon name="anticlockwise-rotation" size="12" style="color:#8A6A2A"></i-icon>Відкочено 20:14</span>`)}
      </div>
      <div class="day" style="position:relative;font-size:17px;padding:10px 0 2px"><i-icon name="wax-seal" size="16" style="color:#8A6A2A"></i-icon>Створення та рівні<span class="lvlRule"></span><span class="th" style="font-size:13px">13 вер. – 5 жовт.</span></div>
      <div style="position:relative;display:flex;flex-direction:column">
        ${row('upgrade', '#8A6A2A', '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span>Досягла <b>5 рівня</b> (Паладин): +10 хітів, Додаткова атака, Вірний скакун.</span><button class="exp" type="button" aria-expanded="false" aria-label="Показати 4 події" title="Показати 4 події" style="width:30px;height:30px"><i-icon name="plus" size="12"></i-icon></button><span class="hint" style="font-size:14px">4 події</span></span>', '5 жовт.', rev('Досягла 5 рівня'))}
        ${row('wax-seal', '#8A6A2A', 'Створено: <b>Іляна Ворн</b> — Людина, Солдат, Паладин 1.', '13 вер.', `<span class="lockt" style="height:44px" title="Створення не відкочується; видаліть героя"><i-icon name="padlock" size="14"></i-icon></span>`)}
      </div>
    </section>`;
};

module.exports = { rail, wood, folio, centre, right, strap, flowstrap, steps, pwood, pbar, ptabs, pactions, pcombat, pflow, pstrip, ptimeline };
