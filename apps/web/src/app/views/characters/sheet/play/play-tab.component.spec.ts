import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { propose, type Sheet } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../../assets/i18n/characters/ru.json';
import { seedFighter, seedWizard } from '../testing/character-fixtures';
import { PlayTabComponent } from './play-tab.component';

// `Sheet['resources'][number]`/`Sheet['actions'][number]` recovered as indexed-access aliases,
// same trick `play-tab.component.ts` itself uses (its barrel doesn't re-export `derive/*.ts`'s
// per-field row types directly — see that file's own comment on `ResourceView`/`ActionView`).
type ResourceView = Sheet['resources'][number];
type ActionView = Sheet['actions'][number];

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling), same fixture-loading
// approach as `character.store.spec.ts`/`create-wizard.component.spec.ts`.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) {
    throw new Error(
      `fixture pack at ${path} failed validation: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

// A minimal, hand-built translation pack (mirrors `pack.store.spec.ts`'s own `translationPack()`
// fixture shape — a plain `Pack` literal, no `parsePack` needed) covering exactly the two
// feature-granted resource/action names task-1-brief.md's carry fix exercises: `second-wind`
// (fighter-1, `derive/resources.ts`'s `source`) and `action-surge` (fighter-2,
// `derive/actions.ts`'s `source`) — both granted by a FEATURE entity, never the class itself, so
// `ResourceView.source`/`ActionView.source` (`ae.feature ?? ae.source`) resolves to the feature id.
const RU_SECOND_WIND_NAME = 'Второе дыхание';
const RU_ACTION_SURGE_NAME = 'Рывок';
const ruTranslationPack: Pack = {
  format: 1,
  id: 'srd-5e-2024-ru-test',
  version: '0.1.0',
  kind: 'translation',
  name: 'RU test',
  authors: [],
  dependencies: [],
  locale: 'ru',
  translates: { id: PACK_ID, range: `^${PACK_VERSION}` },
  entities: [],
  overrides: [],
  assets: [],
  i18n: {},
  strings: {
    'feature/fighter-second-wind': { name: RU_SECOND_WIND_NAME },
    'feature/fighter-action-surge': { name: RU_ACTION_SURGE_NAME },
  },
};

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    if (langPath === 'characters/ru') return of(charactersRu);
    return of({});
  }
}

function configureReal(extraPacks: Pack[] = []): void {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      {
        provide: PackStore,
        useValue: {
          packs: signal([corePack, ...extraPacks]),
          ready: signal(true),
          corePack: signal(corePack),
        },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
    ],
  });
}

function statValues(compiled: HTMLElement, containerSelector: string): string[] {
  return Array.from(
    compiled.querySelectorAll(`${containerSelector} hk-stat-tile .hk-stat-tile__value`),
  ).map((el) => el.textContent?.trim() ?? '');
}

describe('PlayTabComponent', () => {
  beforeEach(async () => {
    configureReal();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    TestBed.inject(HkDb).close();
  });

  it("renders fighter-1's hp max / AC / proficiency bonus straight off the store's sheet (12 / 19 / +2)", async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const coreStats = statValues(compiled, '.play-tab__stats');
    expect(coreStats[0]).toBe('19'); // AC
    expect(coreStats[2]).toBe('+2'); // proficiency bonus

    const hpStats = statValues(compiled, '.play-tab__hp-stats');
    // Controller ruling R11: `CreateWizardState.buildTransaction()` tops current HP up to the
    // derived max via an explicit `hp.changed {delta, kind: 'set'}` right after `level.gained` —
    // `facts.hp.current` itself still defaults to the literal `0`, not the `'max'` sentinel
    // (`reduce/facts.ts`'s `initialFacts`), but this fixture (like every real creation) goes
    // through that same wizard path, not a hand-written event list.
    expect(hpStats[0]).toBe('12'); // current
    expect(hpStats[1]).toBe('12'); // max
  });

  it("opens the AC tile's hkDerived popover listing at least 3 contributions (armor, shield, fighting style), localized", async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const acTile = compiled.querySelector<HTMLElement>('.play-tab__stats hk-stat-tile')!;
    acTile.click();
    TestBed.tick();

    const overlay = document.querySelector('.cdk-overlay-container')!;
    const rows = overlay.querySelectorAll('.derived-popover__row');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const text = overlay.textContent ?? '';
    expect(text).toContain('Chain Mail');
    expect(text).toContain('Shield');
    expect(text).toContain('Defense');
  });

  it("renders a wizard stream's level-1 spell slots as an hk-pips row matching spellcasting (2 slots, none used)", async () => {
    await seedWizard('Elowen');

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const slotRow = compiled.querySelector('.play-tab__slot-row')!;
    expect(slotRow).not.toBeNull();
    const pips = slotRow.querySelectorAll('.hk-pips__pip');
    expect(pips).toHaveLength(2);
    expect(slotRow.querySelectorAll('.hk-pips__pip--filled')).toHaveLength(0);
  });
});

// task-2-brief.md: the HP bar/damage/heal/temp-HP inputs, death-save buttons and the inspiration
// toggle — the play tab's first controls that actually mutate the character (everything above is
// still read-only). Every scenario seeds a REAL fighter-1 stream (`seedFighter`, hp.max 12,
// hp.current topped up to 12 — see the first describe block's own R11 comment) and drives the
// rendered DOM, so each assertion exercises the exact `propose.*` -> `CharacterStore.appendTx`
// wiring a player's click would.
describe('PlayTabComponent — HP, death saves, inspiration controls', () => {
  beforeEach(async () => {
    configureReal();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  function amountInput(compiled: HTMLElement): HTMLInputElement {
    return compiled.querySelector<HTMLInputElement>('.play-tab__hp-controls input[type="number"]')!;
  }

  function buttonNamed(compiled: HTMLElement, selector: string, text: string): HTMLButtonElement {
    const button = Array.from(compiled.querySelectorAll<HTMLButtonElement>(selector)).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`no button matching "${text}" under ${selector}`);
    return button;
  }

  async function typeAmount(
    fixture: { whenStable(): Promise<unknown> },
    input: HTMLInputElement,
    value: number,
  ): Promise<void> {
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  /** `play-tab.component.ts`'s propose->appendTx wiring is fire-and-forget (mirrors `sheet-shell.
   * component.ts`'s own `xpAward` submit — see `tryPropose`'s doc), so a single `whenStable()`
   * right after a click doesn't reliably wait for `CharacterStore.appendTx`'s own (real,
   * unmocked fake-indexeddb) async chain to settle. Mirrors `level-up.component.spec.ts`'s /
   * `build-tab.component.spec.ts`'s own `pollUntil`. */
  async function pollUntil(
    fixture: { whenStable(): Promise<unknown> },
    predicate: () => boolean,
    maxIterations = 50,
  ): Promise<void> {
    for (let i = 0; i < maxIterations && !predicate(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
    expect(predicate()).toBe(true);
  }

  it("renders fighter-1's hk-hp-bar with widths matching current/max/temp off the store's sheet", async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const fill = compiled.querySelector<HTMLElement>('.play-tab__hp-bar .hk-hp-bar__fill')!;
    // fighter-1: hp.current 12 / hp.max 12 -> a full bar.
    expect(fill.style.width).toBe('100%');
  });

  it("damage 5 via the amount input + Damage button appends the proposer's exact hp.changed event and drops current from 12 to 7", async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    await typeAmount(fixture, amountInput(compiled), 5);
    buttonNamed(compiled, '.play-tab__hp-controls button', charactersEn.sheet.hp.damage).click();
    await pollUntil(fixture, () => characterStore.sheet()?.hp.current === 7);

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'hp.changed',
      payload: { delta: -5, kind: 'damage' },
    });
    expect(characterStore.sheet()?.hp.current).toBe(7);
  });

  it('heal past max clamps to the derived max (propose.heal clamping behavior)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    // Fighter-1 starts full (12/12) — damage it down first so a large heal has room to clamp.
    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 5)); // -> current 7

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    await typeAmount(fixture, amountInput(compiled), 100);
    buttonNamed(compiled, '.play-tab__hp-controls button', charactersEn.sheet.hp.heal).click();
    await pollUntil(fixture, () => characterStore.sheet()?.hp.current === 12);

    expect(characterStore.sheet()?.hp.current).toBe(12);
  });

  it('adding temp HP via the input + button appends hp.changed{kind:"temp"} and sets sheet.hp.temp', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    await typeAmount(fixture, amountInput(compiled), 4);
    buttonNamed(compiled, '.play-tab__hp-controls button', charactersEn.sheet.hp.addTemp).click();
    await pollUntil(fixture, () => characterStore.sheet()?.hp.temp === 4);

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'hp.changed',
      payload: { delta: 4, kind: 'temp' },
    });
    expect(characterStore.sheet()?.hp.temp).toBe(4);
  });

  it('death-save buttons are hidden while current HP is above 0, and appear once it drops to 0', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.play-tab__death-save-actions')).toBeNull();

    // 20 clamps to the reachable 12 (current + temp) -> current lands exactly on 0.
    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 20));
    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;
    expect(characterStore.sheet()?.hp.current).toBe(0);
    expect(compiled.querySelector('.play-tab__death-save-actions')).not.toBeNull();
  });

  it('clicking the death-save Success button round-trips into sheet.hp.deathSaves.successes', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 20)); // -> current 0

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(
      compiled,
      '.play-tab__death-save-actions button',
      charactersEn.sheet.hp.deathSaveSuccess,
    ).click();
    await pollUntil(fixture, () => characterStore.sheet()?.hp.deathSaves.successes === 1);

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'death_save.recorded',
      payload: { result: 'success' },
    });
    expect(characterStore.sheet()?.hp.deathSaves.successes).toBe(1);
  });

  it('the inspiration toggle appends inspiration.changed and flips sheet.inspiration both ways', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(characterStore.sheet()?.inspiration).toBe(false);

    const toggle = compiled.querySelector<HTMLButtonElement>('.play-tab__inspiration-toggle')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    await pollUntil(fixture, () => characterStore.sheet()?.inspiration === true);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'inspiration.changed',
      payload: { value: true },
    });
    expect(characterStore.sheet()?.inspiration).toBe(true);
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    await pollUntil(fixture, () => characterStore.sheet()?.inspiration === false);
    expect(characterStore.sheet()?.inspiration).toBe(false);
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });
});

// task-1-brief.md carry fix (plan-5 review finding, owner-flag "ActionView/ResourceView English
// names"): `ResourceView.name`/`ActionView.name` are baked-at-build-time ENGLISH strings (never
// routed through the Localizer — `derive/resources.ts`/`derive/actions.ts`'s own class docs), but
// `.source` (`ae.feature ?? ae.source`) is always a resolvable entity id. `resourceLabel`/
// `actionLabel` must prefer `localizer.name(view.source)` over the baked name, falling back to it
// only when the source doesn't resolve (mirrors `resolveName`'s own defensive convention).
describe('PlayTabComponent — resource/action name localization', () => {
  beforeEach(async () => {
    configureReal([ruTranslationPack]);
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it("renders second-wind's LOCALIZED granting-feature name (not the baked 'Second Wind') once the locale switches to ru", async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    TestBed.inject(LocaleService).setLocale('ru');
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const resourceCard = compiled.querySelector('.play-tab__resource');
    expect(resourceCard).not.toBeNull();
    const text = resourceCard!.textContent ?? '';
    expect(text).toContain(RU_SECOND_WIND_NAME);
    expect(text).not.toContain('Second Wind');
  });

  it("renders action-surge's LOCALIZED granting-feature name (not the baked 'Action Surge') once the locale switches to ru", async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    // Fighter-2's own row grants `feature/fighter-action-surge` (an `action.define`) with no
    // choices of its own — a bare `level.gained` is enough, no XP/decision bookkeeping needed
    // (mirrors `level-up.state.spec.ts`'s own direct-`appendTx` fixture pattern).
    await characterStore.appendTx([
      {
        type: 'level.gained',
        v: 1,
        payload: { classId: 'srd-5e-2024:class/fighter', level: 2, hpRoll: 5 },
      },
    ]);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    TestBed.inject(LocaleService).setLocale('ru');
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.querySelector('.play-tab__actions')?.textContent ?? '';
    expect(text).toContain(RU_ACTION_SURGE_NAME);
    expect(text).not.toContain('Action Surge');
  });

  it('resourceLabel/actionLabel fall back to the baked view.name when the source entity does not resolve', async () => {
    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();

    const component = fixture.componentInstance as unknown as {
      resourceLabel(view: ResourceView): string;
      actionLabel(view: ActionView): string;
    };

    const fakeResource: ResourceView = {
      id: 'ghost-resource',
      name: 'Ghost Resource',
      max: { value: 1, contributions: [] },
      used: 0,
      reset: 'shortRest',
      display: 'pips',
      source: 'srd-5e-2024:feature/does-not-exist',
    };
    expect(component.resourceLabel(fakeResource)).toBe('Ghost Resource');

    const fakeAction: ActionView = {
      id: 'ghost-action',
      name: 'Ghost Action',
      kind: 'free',
      description: '',
      source: 'srd-5e-2024:feature/does-not-exist',
    };
    expect(component.actionLabel(fakeAction)).toBe('Ghost Action');
  });
});

// task-3-brief.md: slot/resource pips, prepare/unprepare (capped), cast (cantrip direct per
// R-pf3, leveled via `CastDialogComponent`), and the concentration chip/End button. Every
// scenario hand-appends the exact `slot.spent`/`spell.learned`/`spell.prepared`/`spell.cast`
// events a real play session would produce, then drives the rendered DOM — same "exercise the
// real propose->appendTx wiring, not the component in isolation" convention as the HP describe
// block above.
describe('PlayTabComponent — slots, resources, casting, concentration controls', () => {
  const WIZARD_CLASS_ID = 'srd-5e-2024:class/wizard';
  const BURNING_HANDS = 'srd-5e-2024:spell/burning-hands';
  const MAGE_ARMOR = 'srd-5e-2024:spell/mage-armor';
  const MAGIC_MISSILE = 'srd-5e-2024:spell/magic-missile';
  const SHIELD_SPELL = 'srd-5e-2024:spell/shield';
  const THUNDERWAVE = 'srd-5e-2024:spell/thunderwave';
  const ACID_SPLASH = 'srd-5e-2024:spell/acid-splash'; // cantrip, concentration: false
  const DANCING_LIGHTS = 'srd-5e-2024:spell/dancing-lights'; // cantrip, concentration: true
  const DETECT_MAGIC = 'srd-5e-2024:spell/detect-magic'; // level 1, concentration: true
  const BANE = 'srd-5e-2024:spell/bane'; // level 1, concentration: true (off-list; reducer doesn't validate class eligibility)

  function learned(spellId: string, classId = WIZARD_CLASS_ID) {
    return { type: 'spell.learned', v: 1, payload: { spellId, classId, source: 'levelUp' } };
  }

  function prepared(spellId: string, classId = WIZARD_CLASS_ID) {
    return { type: 'spell.prepared', v: 1, payload: { spellId, classId } };
  }

  beforeEach(async () => {
    // Guards against locale leakage from the (file-order-earlier) "resource/action name
    // localization" describe block above: `LocaleService.setLocale('ru')` there persists to REAL
    // `localStorage` (`shared/services/i18n/locale.service.ts`'s `STORAGE_KEY`), which Angular's
    // `TestBed` teardown never clears between tests/describe blocks — a later describe block's
    // fresh `TranslocoService` would otherwise read that stale 'ru' back on construction and
    // silently render every button/label in this block's assertions in Russian.
    localStorage.removeItem('hk.locale');
    configureReal();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });

  async function pollUntil(
    fixture: { whenStable(): Promise<unknown> },
    predicate: () => boolean,
    maxIterations = 50,
  ): Promise<void> {
    for (let i = 0; i < maxIterations && !predicate(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
    expect(predicate()).toBe(true);
  }

  function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`no button matching "${text}"`);
    return button;
  }

  function spellRow(compiled: HTMLElement, name: string): HTMLElement {
    const rows = Array.from(compiled.querySelectorAll<HTMLElement>('.play-tab__spell-lists li'));
    const row = rows.find(
      (r) => r.querySelector('.play-tab__spell-name')?.textContent?.trim() === name,
    );
    if (!row) throw new Error(`no spell row for "${name}"`);
    return row;
  }

  // The Known and Prepared lists can both render a row for the SAME spell (a prepared spell is
  // also known) — the Known row gets a Prepare/Unprepare toggle, only the Prepared row gets a
  // Cast button, so a test that needs the CAST affordance must scope to the Prepared `<div>`
  // specifically (identified by its own `<h3>` subtitle), not just "a `<li>` matching this name".
  function preparedListSection(compiled: HTMLElement): HTMLElement {
    const headers = Array.from(compiled.querySelectorAll<HTMLElement>('.play-tab__spell-lists h3'));
    const header = headers.find(
      (h) => h.textContent?.trim() === charactersEn.sheet.spellcasting.prepared,
    );
    if (!header) throw new Error('no "Prepared spells" section rendered');
    return header.parentElement!;
  }

  it('spending a level-1 slot pip appends slot.spent{level:1} and increments used; restoring via a filled pip appends slot.restored{level:1} (no count) and decrements by exactly one', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const slotRow = compiled.querySelector('.play-tab__slot-row')!;

    slotRow.querySelectorAll<HTMLButtonElement>('.hk-pips__pip')[0].click();
    await pollUntil(fixture, () => characterStore.sheet()?.spellcasting[0].slots[0].used === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'slot.spent',
      payload: { level: 1 },
    });

    slotRow.querySelectorAll<HTMLButtonElement>('.hk-pips__pip')[1].click();
    await pollUntil(fixture, () => characterStore.sheet()?.spellcasting[0].slots[0].used === 2);

    // Both pips are now filled — restoring via the FIRST one must drop `used` by exactly one
    // (1), never reset it to 0 (the full-reset form `resource.restored` uses by default, and
    // which `slot.restored` deliberately does NOT — see `play-tab.component.ts`'s own comment).
    slotRow.querySelectorAll<HTMLButtonElement>('.hk-pips__pip')[0].click();
    await pollUntil(fixture, () => characterStore.sheet()?.spellcasting[0].slots[0].used === 1);
    const restoreEvent = characterStore.events().at(-1)!;
    expect(restoreEvent.type).toBe('slot.restored');
    expect(restoreEvent.payload).toEqual({ level: 1 });
  });

  it('spending a resource pip appends resource.spent{resourceId} (default +1); restoring via a filled pip appends resource.restored{resourceId,count:1} and decrements by exactly one, not a full reset', async () => {
    await seedFighter('Ivan'); // fighter-1's second-wind resource: max 2, display 'pips'
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const resourceCard = compiled.querySelector('.play-tab__resource')!;

    resourceCard.querySelectorAll<HTMLButtonElement>('.hk-pips__pip')[0].click();
    await pollUntil(fixture, () => characterStore.sheet()?.resources[0]?.used === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'resource.spent',
      payload: { resourceId: 'second-wind' },
    });

    resourceCard.querySelectorAll<HTMLButtonElement>('.hk-pips__pip')[1].click();
    await pollUntil(fixture, () => characterStore.sheet()?.resources[0]?.used === 2);

    resourceCard.querySelectorAll<HTMLButtonElement>('.hk-pips__pip')[0].click();
    await pollUntil(fixture, () => characterStore.sheet()?.resources[0]?.used === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'resource.restored',
      payload: { resourceId: 'second-wind', count: 1 },
    });
  });

  it('prepared cap blocks preparing a 5th spell with a toast, and appends no spell.prepared event', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([
      learned(BURNING_HANDS),
      learned(MAGE_ARMOR),
      learned(MAGIC_MISSILE),
      learned(SHIELD_SPELL),
      learned(THUNDERWAVE), // learned but left unprepared — the one this test attempts to prepare
      prepared(BURNING_HANDS),
      prepared(MAGE_ARMOR),
      prepared(MAGIC_MISSILE),
      prepared(SHIELD_SPELL), // 4 == wizard-1's preparedMax
    ]);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    const eventsBefore = characterStore.events().length;

    const row = spellRow(compiled, 'Thunderwave');
    buttonNamed(row, charactersEn.sheet.spellcasting.prepare).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
    expect(showSpy).toHaveBeenCalledWith('characters.sheet.spellcasting.preparedMaxReached', {
      max: 4,
    });
  });

  it('unpreparing a prepared spell appends spell.unprepared and its known-list row flips back to a Prepare button', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(BURNING_HANDS), prepared(BURNING_HANDS)]);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    const row = spellRow(compiled, 'Burning Hands');
    buttonNamed(row, charactersEn.sheet.spellcasting.unprepare).click();
    await pollUntil(
      fixture,
      () => !characterStore.sheet()!.spellcasting[0].prepared.includes(BURNING_HANDS),
    );

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'spell.unprepared',
      payload: { spellId: BURNING_HANDS, classId: WIZARD_CLASS_ID },
    });

    compiled = fixture.nativeElement as HTMLElement;
    const refreshedRow = spellRow(compiled, 'Burning Hands');
    expect(() => buttonNamed(refreshedRow, charactersEn.sheet.spellcasting.prepare)).not.toThrow();
  });

  it('R-pf3: casting a known cantrip appends spell.cast{spellId,level:0,slotUsed:false} directly, with no dialog and no concentration key', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(ACID_SPLASH)]);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const row = spellRow(compiled, 'Acid Splash');
    buttonNamed(row, charactersEn.sheet.spellcasting.cast).click();
    await pollUntil(fixture, () => characterStore.events().at(-1)?.type === 'spell.cast');

    expect(characterStore.events().at(-1)!.payload).toEqual({
      spellId: ACID_SPLASH,
      level: 0,
      slotUsed: false,
    });
    expect(document.querySelector('.cdk-overlay-container hk-dialog')).toBeNull();
  });

  it('casting a concentration cantrip while already concentrating shows the inline replaces-note next to its own Cast button', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(DANCING_LIGHTS)]);
    // Establishes concentration on a DIFFERENT spell first (the reducer doesn't validate class
    // spell-list eligibility, so any real concentration spell id works as the precondition).
    await characterStore.appendTx(
      propose.cast(characterStore.sheet()!, BANE, { level: 1, concentration: true }),
    );

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const row = spellRow(compiled, 'Dancing Lights');
    expect(row.querySelector('.play-tab__concentration-note')?.textContent?.trim()).toBe(
      charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
    );
  });

  it('leveled cast via the dialog spends the chosen slot and sets concentration when the spell has it', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(DETECT_MAGIC), prepared(DETECT_MAGIC)]);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(preparedListSection(compiled), charactersEn.sheet.spellcasting.cast).click();
    TestBed.tick();

    // The dialog's own Cast/confirm button carries the SAME translated label as the row's own
    // Cast button — located by its dialog-scoped text (`document`, not `compiled`: the CDK
    // overlay attaches to `document.body`, outside the fixture's root).
    const overlay = document.querySelector('.cdk-overlay-container')!;
    buttonNamed(overlay as HTMLElement, charactersEn.sheet.spellcasting.castDialog.confirm).click();
    TestBed.tick();

    await pollUntil(fixture, () => characterStore.sheet()?.spellcasting[0].slots[0].used === 1);

    expect(characterStore.events().at(-1)!.type).toBe('spell.cast');
    expect(characterStore.events().at(-1)!.payload).toEqual({
      spellId: DETECT_MAGIC,
      level: 1,
      concentration: true,
    });
    expect(characterStore.sheet()?.concentration?.spellId).toBe(DETECT_MAGIC);
  });

  it('the cast dialog shows the "replaces current concentration" note when already concentrating on something else', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(DETECT_MAGIC), prepared(DETECT_MAGIC)]);
    await characterStore.appendTx(
      propose.cast(characterStore.sheet()!, BANE, { level: 1, concentration: true }),
    );

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(preparedListSection(compiled), charactersEn.sheet.spellcasting.cast).click();
    TestBed.tick();

    expect(document.body.textContent).toContain(
      charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
    );
  });

  it('a slot spent by another action while the cast dialog is still open surfaces a genuine slot.none-left ProposeError, mapped to its own toast (not the generic fallback)', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([learned(BURNING_HANDS), prepared(BURNING_HANDS)]);
    // Leaves exactly ONE level-1 slot free (wizard-1 has 2) — the dialog opens with that single
    // option selected by default.
    await characterStore.appendTx(propose.spendSlot(characterStore.sheet()!, 1));

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');

    buttonNamed(preparedListSection(compiled), charactersEn.sheet.spellcasting.cast).click();
    TestBed.tick();

    // The RACE: while the dialog is open (still holding its stale "1 slot available" snapshot),
    // spend that very last slot out from under it via a concurrent action (another tab, another
    // quick pip click elsewhere).
    await characterStore.appendTx(propose.spendSlot(characterStore.sheet()!, 1));
    const eventsBeforeConfirm = characterStore.events().length;

    const overlay = document.querySelector('.cdk-overlay-container')!;
    buttonNamed(overlay as HTMLElement, charactersEn.sheet.spellcasting.castDialog.confirm).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBeforeConfirm); // no spell.cast appended
    expect(showSpy).toHaveBeenCalledWith('characters.validation.slot.none-left');
  });

  it('End concentration appends concentration.ended{} and clears the chip', async () => {
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(
      propose.cast(characterStore.sheet()!, BANE, { level: 1, concentration: true }),
    );

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    const chip = compiled.querySelector('.play-tab__concentration')!;
    expect(chip.textContent).toContain('Bane');

    buttonNamed(chip as HTMLElement, charactersEn.sheet.hp.endConcentration).click();
    await pollUntil(fixture, () => characterStore.sheet()?.concentration === undefined);

    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'concentration.ended',
      payload: {},
    });
    compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.play-tab__concentration')).toBeNull();
  });
});
