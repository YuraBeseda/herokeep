import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveAnnouncer } from '@angular/cdk/a11y';
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
import { RollLogService } from '@shared/services/roll-log/roll-log.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../../assets/i18n/characters/ru.json';
import { levelUpToTwo, seedFighter, seedWizard } from '../testing/character-fixtures';
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

// task-4-brief.md: the condition-add dialog (localized picker + data-driven level stepper),
// per-chip remove, and the new Notes section's add/edit/remove dialogs. Every scenario drives the
// real `ConditionDialogComponent`/`NoteDialogComponent`/`NoteDeleteConfirmComponent` overlays this
// component opens via `DialogService`, same "exercise the real propose->appendTx wiring" and
// `pollUntil` conventions the slots/resources describe block above establishes.
describe('PlayTabComponent — conditions and notes controls', () => {
  const EXHAUSTION_ID = 'srd-5e-2024:condition/exhaustion';
  const BLINDED_ID = 'srd-5e-2024:condition/blinded';

  beforeEach(async () => {
    // Same locale-leak guard as the slots/resources describe block above (`hk.locale` persists to
    // REAL localStorage and TestBed teardown never clears it between describe blocks).
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

  function overlay(): HTMLElement {
    return document.querySelector<HTMLElement>('.cdk-overlay-container')!;
  }

  it('adding a non-level condition round-trips into sheet.conditions and renders a localized chip', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.conditions.add).click();
    TestBed.tick();

    const select = overlay().querySelector<HTMLSelectElement>('select')!;
    select.value = BLINDED_ID;
    select.dispatchEvent(new Event('change'));
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.conditions.addDialog.confirm).click();

    await pollUntil(fixture, () => (characterStore.sheet()?.conditions.length ?? 0) === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'condition.added',
      payload: { conditionId: BLINDED_ID },
    });

    compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.play-tab__conditions')!.textContent).toContain('Blinded');
  });

  it('exhaustion added at level 3, then re-added at level 2, replaces the entry (reducer replace-by-conditionId)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    async function addExhaustion(level: number): Promise<void> {
      buttonNamed(compiled, charactersEn.sheet.conditions.add).click();
      TestBed.tick();
      const select = overlay().querySelector<HTMLSelectElement>('select')!;
      select.value = EXHAUSTION_ID;
      select.dispatchEvent(new Event('change'));
      TestBed.tick();
      const levelInput = overlay().querySelector<HTMLInputElement>('input[type="number"]')!;
      levelInput.value = String(level);
      levelInput.dispatchEvent(new Event('input'));
      TestBed.tick();
      buttonNamed(overlay(), charactersEn.sheet.conditions.addDialog.confirm).click();
      await pollUntil(
        fixture,
        () =>
          characterStore.sheet()?.conditions.find((c) => c.conditionId === EXHAUSTION_ID)?.level ===
          level,
      );
    }

    await addExhaustion(3);
    expect(characterStore.sheet()!.conditions).toHaveLength(1);

    await addExhaustion(2);
    expect(characterStore.sheet()!.conditions).toHaveLength(1);
    expect(characterStore.sheet()!.conditions[0]).toMatchObject({
      conditionId: EXHAUSTION_ID,
      level: 2,
    });
  });

  it('removing a condition via the chip clears it from sheet.conditions', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.condition(characterStore.sheet()!, BLINDED_ID, true));

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const removeButton = compiled.querySelector<HTMLButtonElement>(
      '.play-tab__conditions .hk-chip__remove',
    )!;
    removeButton.click();

    await pollUntil(fixture, () => (characterStore.sheet()?.conditions.length ?? 0) === 0);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'condition.removed',
      payload: { conditionId: BLINDED_ID },
    });
  });

  it('note add/edit/remove round-trips through propose.note (each via its own dialog)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    // Add
    buttonNamed(compiled, charactersEn.sheet.notes.add).click();
    TestBed.tick();
    const addTitleInput = overlay().querySelector<HTMLInputElement>('input[type="text"]')!;
    addTitleInput.value = 'Loot';
    addTitleInput.dispatchEvent(new Event('input'));
    const addBodyInput = overlay().querySelector<HTMLTextAreaElement>('textarea')!;
    addBodyInput.value = 'A sword.';
    addBodyInput.dispatchEvent(new Event('input'));
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.notes.dialog.save).click();

    await pollUntil(fixture, () => (characterStore.facts()?.notes.length ?? 0) === 1);
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'note.added',
      payload: { title: 'Loot', body: 'A sword.' },
    });

    compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.play-tab__notes')!.textContent).toContain('Loot');

    // Edit
    buttonNamed(compiled, charactersEn.sheet.notes.edit).click();
    TestBed.tick();
    const editBodyInput = overlay().querySelector<HTMLTextAreaElement>('textarea')!;
    expect(editBodyInput.value).toBe('A sword.');
    editBodyInput.value = 'A +1 sword.';
    editBodyInput.dispatchEvent(new Event('input'));
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.notes.dialog.save).click();

    await pollUntil(fixture, () => characterStore.facts()?.notes[0]?.body === 'A +1 sword.');
    expect(characterStore.events().at(-1)).toMatchObject({ type: 'note.updated' });

    // Remove (behind its own confirm dialog)
    compiled = fixture.nativeElement as HTMLElement;
    buttonNamed(compiled, charactersEn.sheet.notes.remove).click();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.notes.deleteConfirm.confirm).click();

    await pollUntil(fixture, () => (characterStore.facts()?.notes.length ?? 0) === 0);
    expect(characterStore.events().at(-1)).toMatchObject({ type: 'note.removed' });
  });

  it('cancelling the remove-note confirm dialog appends nothing and keeps the note', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(
      propose.note('added', { id: '01930000-0000-7000-8000-000000000001', title: 'Loot' }),
    );

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const eventsBefore = characterStore.events().length;

    buttonNamed(compiled, charactersEn.sheet.notes.remove).click();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.notes.deleteConfirm.cancel).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
    expect(characterStore.facts()?.notes).toHaveLength(1);
  });

  it('a note body over the protocol byte limit is blocked in the dialog with a localized message, and appends nothing', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const eventsBefore = characterStore.events().length;

    buttonNamed(compiled, charactersEn.sheet.notes.add).click();
    TestBed.tick();
    const bodyInput = overlay().querySelector<HTMLTextAreaElement>('textarea')!;
    bodyInput.value = 'x'.repeat(8193); // 1 over NoteAddedV1.shape.body's Zod .max(8192)
    bodyInput.dispatchEvent(new Event('input'));
    TestBed.tick();

    expect(overlay().querySelector('.note-dialog__error')).not.toBeNull();
    const saveButton = buttonNamed(overlay(), charactersEn.sheet.notes.dialog.save);
    expect(saveButton.disabled).toBe(true);
    saveButton.click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
  });
});

// task-5-brief.md: inventory add-from-library/custom, equip/attune toggles, the qty stepper,
// remove (behind its own confirm dialog), the weight display + section total (Self-Review's
// WEIGHT note), and the currency editor. Every scenario seeds the REAL `seedFighter` fixture
// (chain mail + longsword + shield, all equipped — plan-5 golden) and drives the real
// `AddItemDialogComponent`/`CustomItemDialogComponent`/`ItemRemoveConfirmComponent` overlays this
// component opens via `DialogService`, same `pollUntil` conventions every describe block above
// establishes.
describe('PlayTabComponent — inventory and currency controls', () => {
  const DAGGER_ID = 'srd-5e-2024:item/dagger';
  const LONGSWORD_ID = 'srd-5e-2024:item/longsword';
  const SHIELD_ID = 'srd-5e-2024:item/shield';
  // `attunement: { required: true }` (packages/protocol/src/pack/entities-content.ts's
  // `ItemEntitySchema`) — the one fixture used everywhere below that needs a REAL
  // attunement-eligible pack item; chain mail/longsword/shield (seedFighter's starting gear)
  // carry no `attunement` data at all, so they're the negative fixture for the same tests.
  const AMULET_ID = 'srd-5e-2024:item/amulet-of-health';

  beforeEach(async () => {
    // Same locale-leak guard every other describe block in this file documents (`hk.locale`
    // persists to REAL localStorage; `TestBed` teardown never clears it between blocks).
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

  function overlay(): HTMLElement {
    return document.querySelector<HTMLElement>('.cdk-overlay-container')!;
  }

  function inventoryRowFor(compiled: HTMLElement, nameSubstring: string): HTMLElement {
    const rows = Array.from(compiled.querySelectorAll<HTMLElement>('.play-tab__inventory-item'));
    const row = rows.find((r) => r.textContent?.includes(nameSubstring));
    if (!row) throw new Error(`no inventory row containing "${nameSubstring}"`);
    return row;
  }

  it('add-from-library appends item.added with a fresh uuid instanceId and renders the new row', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const instanceIdsBefore = new Set(characterStore.sheet()!.inventory.map((i) => i.instanceId));

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.inventory.addFromLibrary).click();
    TestBed.tick();

    vi.useFakeTimers();
    const searchInput = overlay().querySelector<HTMLInputElement>('input[type="search"]')!;
    searchInput.value = 'Dagger';
    searchInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    TestBed.tick();
    vi.useRealTimers();

    const card = Array.from(overlay().querySelectorAll('.entity-picker__card')).find(
      (c) => c.querySelector('.entity-picker__name')?.textContent?.trim() === 'Dagger',
    )!;
    card.querySelector<HTMLButtonElement>('.entity-picker__select')!.click();

    await pollUntil(
      fixture,
      () => (characterStore.sheet()?.inventory.length ?? 0) > instanceIdsBefore.size,
    );

    const added = characterStore.events().at(-1)!;
    expect(added).toMatchObject({ type: 'item.added', payload: { itemId: DAGGER_ID, qty: 1 } });
    const instanceId = (added.payload as { instanceId: string }).instanceId;
    // A fresh UUIDv7 — sortable/time-ordered, RFC 9562 version-7 nibble + RFC 4122 variant bits
    // (`shared/helpers/uuid.ts`).
    expect(instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(instanceIdsBefore.has(instanceId)).toBe(false);

    compiled = fixture.nativeElement as HTMLElement;
    expect(inventoryRowFor(compiled, 'Dagger')).not.toBeNull();
  });

  it('a custom item renders by its name with the unresolved styling, and item.added carries custom:{} with no itemId', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.inventory.addCustom).click();
    TestBed.tick();
    const nameInput = overlay().querySelector<HTMLInputElement>('input[type="text"]')!;
    nameInput.value = 'Lucky Coin';
    nameInput.dispatchEvent(new Event('input'));
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.inventory.customDialog.confirm).click();

    await pollUntil(fixture, () => characterStore.events().at(-1)?.type === 'item.added');
    const added = characterStore.events().at(-1)!;
    expect(added.payload).toEqual({
      instanceId: (added.payload as { instanceId: string }).instanceId,
      name: 'Lucky Coin',
      qty: 1,
      custom: {},
    });

    compiled = fixture.nativeElement as HTMLElement;
    const row = inventoryRowFor(compiled, 'Lucky Coin');
    expect(row.classList.contains('play-tab__inventory-item--unresolved')).toBe(true);
    // No itemId -> no resolved item entity -> nothing to gate an Attune toggle on.
    const attuneButton = Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === charactersEn.sheet.inventory.attune,
    );
    expect(attuneButton).toBeUndefined();
  });

  it('a custom item with notes appends item.added then a second item.updated{notes} sharing the same instanceId and txId (one appendTx call)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.inventory.addCustom).click();
    TestBed.tick();
    const nameInput = overlay().querySelector<HTMLInputElement>('input[type="text"]')!;
    nameInput.value = 'Strange Key';
    nameInput.dispatchEvent(new Event('input'));
    const notesInput = overlay().querySelector<HTMLTextAreaElement>('textarea')!;
    notesInput.value = 'Opens something.';
    notesInput.dispatchEvent(new Event('input'));
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.inventory.customDialog.confirm).click();

    await pollUntil(fixture, () => characterStore.events().at(-1)?.type === 'item.updated');
    const events = characterStore.events();
    const added = events.at(-2)!;
    const updated = events.at(-1)!;
    expect(added).toMatchObject({ type: 'item.added', payload: { name: 'Strange Key' } });
    expect(updated).toMatchObject({
      type: 'item.updated',
      payload: {
        notes: 'Opens something.',
        instanceId: (added.payload as { instanceId: string }).instanceId,
      },
    });
    expect(updated.txId).toBeDefined();
    expect(updated.txId).toBe(added.txId);
  });

  it('unequipping chain mail via its inventory row toggle drops sheet.ac (real pack armor no longer contributes)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const acBefore = characterStore.sheet()!.ac.value;
    expect(acBefore).toBe(19);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const row = inventoryRowFor(compiled, 'Chain Mail');
    buttonNamed(row, charactersEn.sheet.inventory.unequip).click();

    await pollUntil(fixture, () => characterStore.sheet()!.ac.value !== acBefore);
    expect(characterStore.sheet()!.ac.value).toBeLessThan(acBefore);
    expect(characterStore.events().at(-1)?.type).toBe('item.unequipped');
  });

  it('attune blocks once attunementMax (3) items are already attuned, with a toast mapped to its own key (not the generic fallback)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    for (const row of characterStore.sheet()!.inventory) {
      await characterStore.appendTx(propose.attune(characterStore.sheet()!, row.instanceId, true));
    }
    expect(characterStore.sheet()!.inventory.filter((i) => i.attuned)).toHaveLength(3);
    // The 4th item is clicked THROUGH THE UI below (unlike the 3 above, attuned directly via
    // `propose.attune` — the engine itself has no item-type gate, only the count) — it must be a
    // REAL attunement-eligible pack item, or the (now gated) Attune button wouldn't even render.
    await characterStore.appendTx(
      propose.addItem(
        characterStore.sheet()!,
        { itemId: AMULET_ID, qty: 1 },
        () => '01930000-0000-7000-8000-000000000099',
      ),
    );

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toastService = TestBed.inject(ToastService);
    const showSpy = vi.spyOn(toastService, 'show');
    const eventsBefore = characterStore.events().length;

    const row = inventoryRowFor(compiled, 'Amulet of Health');
    buttonNamed(row, charactersEn.sheet.inventory.attune).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
    expect(showSpy).toHaveBeenCalledWith('characters.validation.attune.max');
  });

  it('the attune toggle does NOT render for a pack item with no attunement data (chain mail, longsword)', async () => {
    await seedFighter('Ivan');
    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    for (const name of ['Chain Mail', 'Longsword', 'Shield']) {
      const row = inventoryRowFor(compiled, name);
      const attuneButton = Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === charactersEn.sheet.inventory.attune,
      );
      expect(attuneButton, `expected no Attune button on the "${name}" row`).toBeUndefined();
    }
  });

  it('the attune toggle DOES render for an attunement-required pack item (Amulet of Health)', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(
      propose.addItem(
        characterStore.sheet()!,
        { itemId: AMULET_ID, qty: 1 },
        () => '01930000-0000-7000-8000-000000000098',
      ),
    );

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const row = inventoryRowFor(compiled, 'Amulet of Health');
    expect(() => buttonNamed(row, charactersEn.sheet.inventory.attune)).not.toThrow();
  });

  it('the qty stepper increments/decrements via item.updated{qty}, decrement disabled at qty 1', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    const row = inventoryRowFor(compiled, 'Longsword');
    const decreaseButton = row.querySelector<HTMLButtonElement>(
      `[aria-label="${charactersEn.sheet.inventory.qtyDecrease}"]`,
    )!;
    expect(decreaseButton.disabled).toBe(true); // qty starts at 1

    const increaseButton = row.querySelector<HTMLButtonElement>(
      `[aria-label="${charactersEn.sheet.inventory.qtyIncrease}"]`,
    )!;
    increaseButton.click();
    await pollUntil(
      fixture,
      () => characterStore.sheet()?.inventory.find((i) => i.itemId === LONGSWORD_ID)?.qty === 2,
    );
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'item.updated',
      payload: { qty: 2 },
    });

    compiled = fixture.nativeElement as HTMLElement;
    const refreshedDecrease = inventoryRowFor(
      compiled,
      'Longsword',
    ).querySelector<HTMLButtonElement>(
      `[aria-label="${charactersEn.sheet.inventory.qtyDecrease}"]`,
    )!;
    expect(refreshedDecrease.disabled).toBe(false);
    refreshedDecrease.click();
    await pollUntil(
      fixture,
      () => characterStore.sheet()?.inventory.find((i) => i.itemId === LONGSWORD_ID)?.qty === 1,
    );
    expect(characterStore.events().at(-1)).toMatchObject({
      type: 'item.updated',
      payload: { qty: 1 },
    });
  });

  it('remove appends item.removed only after the confirm dialog is accepted; cancel appends nothing', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;
    const eventsBefore = characterStore.events().length;

    buttonNamed(inventoryRowFor(compiled, 'Shield'), charactersEn.sheet.inventory.remove).click();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.inventory.deleteConfirm.cancel).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
    expect(characterStore.sheet()!.inventory.some((i) => i.itemId === SHIELD_ID)).toBe(true);

    compiled = fixture.nativeElement as HTMLElement;
    buttonNamed(inventoryRowFor(compiled, 'Shield'), charactersEn.sheet.inventory.remove).click();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.inventory.deleteConfirm.confirm).click();

    await pollUntil(
      fixture,
      () => !characterStore.sheet()?.inventory.some((i) => i.itemId === SHIELD_ID),
    );
    expect(characterStore.events().at(-1)?.type).toBe('item.removed');
  });

  it('currency: entering gp 15 from a non-zero gp start computes the delta correctly and leaves other denominations unchanged', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(propose.currency(characterStore.sheet()!, { gp: 5, sp: 2 }));
    expect(characterStore.sheet()!.currency).toEqual({ cp: 0, sp: 2, ep: 0, gp: 5, pp: 0 });

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // Denomination field order matches `denominations` (cp, sp, ep, gp, pp) — index 3 is gp.
    const gpInput = Array.from(
      compiled.querySelectorAll<HTMLInputElement>(
        '.play-tab__inventory-currency-fields input[type="number"]',
      ),
    )[3];
    gpInput.value = '15';
    gpInput.dispatchEvent(new Event('input'));
    TestBed.tick();

    buttonNamed(compiled, charactersEn.sheet.inventory.currencyApply).click();

    await pollUntil(fixture, () => characterStore.sheet()?.currency.gp === 15);
    const changed = characterStore.events().at(-1)!;
    expect(changed).toMatchObject({ type: 'currency.changed', payload: { gp: 10 } });
    // Only `gp` actually changed — no other denomination key rode along in the event.
    expect(Object.keys(changed.payload as object)).toEqual(['gp']);
    expect(characterStore.sheet()!.currency).toEqual({ cp: 0, sp: 2, ep: 0, gp: 15, pp: 0 });
  });

  it('inventory rows show the resolved item entity weight (qty-multiplied); the section header shows a simple total', async () => {
    await seedFighter('Ivan');
    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // Real SRD pack weights: chain mail 55 lb + longsword 3 lb + shield 6 lb = 64 lb (each qty 1).
    const totalWeightEl = compiled.querySelector('.play-tab__inventory-total-weight')!;
    expect(totalWeightEl.textContent).toContain('64');

    const chainMailWeight = inventoryRowFor(compiled, 'Chain Mail').querySelector(
      '.play-tab__inventory-item-weight',
    )!;
    expect(chainMailWeight.textContent).toContain('55');
  });
});

// task-6-brief.md: short/long rest buttons + `RestDialogComponent`. `levelUpToTwo` (both fixtures'
// level-2 row has no outstanding choices) is what gives the fighter 2 hit dice to roll and the
// wizard 3 first-level slots to spend/restore — reused from `level-up.state.spec.ts`'s own binding
// spec per this task's own carried note ("leveling a seeded fighter to 2 gives 2 hit dice").
describe('PlayTabComponent — rest controls', () => {
  const FIGHTER = 'srd-5e-2024:class/fighter';
  const EXHAUSTION = 'srd-5e-2024:condition/exhaustion';
  const SECOND_WIND = 'second-wind';

  beforeEach(async () => {
    // Same locale-leak guard every other describe block in this file documents (`hk.locale`
    // persists to REAL localStorage; `TestBed` teardown never clears it between blocks).
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
    vi.restoreAllMocks();
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

  function overlay(): HTMLElement {
    return document.querySelector<HTMLElement>('.cdk-overlay-container')!;
  }

  /** Same scripting technique `rest-dialog.component.spec.ts` documents in full — mocks the
   * `crypto.getRandomValues` entropy `cryptoRng` draws from so each successive roll lands on an
   * exact face, consumed in call order. Narrowed to the EXACT `Uint32Array` length-1 shape
   * `cryptoRng` (`shared/services/engine/rng.ts`) passes — every other shape (notably `uuidv7`'s
   * own `Uint8Array(10)` draw, `shared/helpers/uuid.ts`) falls through to the REAL
   * `crypto.getRandomValues`. Scripting unconditionally, with no shape check, was tried first and
   * broke `uuidv7()`'s own entropy too — it zeroed everything past index 0 of whatever array it
   * was given, producing duplicate event ids (a real `BulkError`/`ConstraintError` from
   * `EventsRepository.append`'s `&id` primary key) the moment more than one id was minted in the
   * same millisecond, which a 4-draft short-rest `appendTx` always does. */
  function scriptRolls(targets: { value: number; sides: number }[]): void {
    let i = 0;
    const real = crypto.getRandomValues.bind(crypto) as (array: unknown) => unknown;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: unknown) => {
      if (array instanceof Uint32Array && array.length === 1) {
        const t = targets[i++];
        const frac = t ? (t.value - 0.5) / t.sides : 0;
        array[0] = Math.floor(frac * 2 ** 32);
        return array;
      }
      return real(array);
    }) as typeof crypto.getRandomValues);
  }

  it('short rest: rolling 2 hit dice heals by roll+con each (kept-style display), restores a shortRest-reset resource, and shares ONE txId across every appended event', async () => {
    await seedFighter('Ivan');
    await levelUpToTwo();
    const characterStore = TestBed.inject(CharacterStore);
    expect(characterStore.sheet()!.hp.hitDice[FIGHTER]).toMatchObject({
      die: 10,
      total: 2,
      remaining: 2,
    });
    const conMod = characterStore.sheet()!.abilities['con'].mod;

    // Damage down from full so the heal arithmetic below is unambiguous (no max clamp).
    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 10));
    const hpBeforeRest = characterStore.sheet()!.hp.current;

    // Spend Second Wind (fighter-1's `shortRest`-reset resource) so its restore is observable.
    await characterStore.appendTx([
      { type: 'resource.spent', v: 1, payload: { resourceId: SECOND_WIND } },
    ]);
    expect(characterStore.sheet()!.resources.find((r) => r.id === SECOND_WIND)?.used).toBe(1);

    const eventsBefore = characterStore.events().length;

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    scriptRolls([
      { value: 3, sides: 10 },
      { value: 2, sides: 10 },
    ]);

    buttonNamed(compiled, charactersEn.sheet.rest.short).click();
    TestBed.tick();

    const rollButton = (): HTMLButtonElement =>
      overlay().querySelector<HTMLButtonElement>('.rest-dialog__roll')!;

    rollButton().click();
    TestBed.tick();
    expect(overlay().querySelectorAll('.rest-dialog__die--kept')).toHaveLength(1);

    rollButton().click();
    TestBed.tick();
    expect(overlay().querySelectorAll('.rest-dialog__die--kept')).toHaveLength(2);
    expect(rollButton().disabled).toBe(true);

    buttonNamed(overlay(), charactersEn.sheet.rest.dialog.confirmShort).click();

    await pollUntil(fixture, () => characterStore.events().length > eventsBefore);

    const newEvents = characterStore.events().slice(eventsBefore);
    expect(newEvents.map((e) => e.type)).toEqual([
      'hit_dice.spent',
      'hit_dice.spent',
      'rest.taken',
      'resource.restored',
    ]);
    // ONE shared txId across every event this short rest appended (Global Constraints: "CONCAT
    // related proposals into ONE `appendTx` call").
    const txId = newEvents[0]?.txId;
    expect(txId).toBeDefined();
    expect(newEvents.every((e) => e.txId === txId)).toBe(true);

    expect(newEvents[0]).toMatchObject({
      type: 'hit_dice.spent',
      payload: { classId: FIGHTER, count: 1, healed: 3 + conMod },
    });
    expect(newEvents[1]).toMatchObject({
      type: 'hit_dice.spent',
      payload: { classId: FIGHTER, count: 1, healed: 2 + conMod },
    });

    // Heals by exactly rolls+con each: (3+conMod) + (2+conMod) added on top of the pre-rest HP.
    expect(characterStore.sheet()!.hp.current).toBe(hpBeforeRest + (3 + conMod) + (2 + conMod));
    expect(characterStore.sheet()!.hp.hitDice[FIGHTER]?.spent).toBe(2);
    expect(characterStore.sheet()!.hp.hitDice[FIGHTER]?.remaining).toBe(0);
    expect(characterStore.sheet()!.resources.find((r) => r.id === SECOND_WIND)?.used).toBe(0);
  });

  it('long rest: hp.current resolves to hp.max numerically, a spent spell slot restores, and exhaustion reduces from 2 to 1', async () => {
    // No `levelUpToTwo()` here (unlike the short-rest test above) — a level-1 wizard already has
    // slots to spend/restore (SRD level-1 wizard: 2 first-level slots), and exhaustion is a
    // condition level entirely independent of character class level. `seedWizard` deliberately
    // leaves its own level-1 skill/cantrip choices undecided (`character-fixtures.ts`'s own doc),
    // which would make `levelUpToTwo`'s `LevelUpState.complete()` unreachable for this fixture —
    // fine to skip since nothing here needs level 2.
    await seedWizard('Elowen');
    const characterStore = TestBed.inject(CharacterStore);
    const maxHp = characterStore.sheet()!.hp.max.value;

    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 5));
    await characterStore.appendTx(propose.spendSlot(characterStore.sheet()!, 1));
    await characterStore.appendTx(propose.condition(characterStore.sheet()!, EXHAUSTION, true, 2));

    expect(characterStore.sheet()!.hp.current).toBe(maxHp - 5);
    expect(characterStore.sheet()!.spellcasting[0]?.slots.find((s) => s.level === 1)?.used).toBe(1);
    expect(
      characterStore.sheet()!.conditions.find((c) => c.conditionId === EXHAUSTION)?.level,
    ).toBe(2);

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.rest.long).click();
    TestBed.tick();

    // No hit-dice picker on a long rest — it's a confirm-only dialog.
    expect(overlay().querySelector('.rest-dialog__hit-dice')).toBeNull();

    buttonNamed(overlay(), charactersEn.sheet.rest.dialog.confirmLong).click();

    await pollUntil(fixture, () => characterStore.sheet()?.hp.current === maxHp);

    expect(characterStore.sheet()!.hp.current).toBe(maxHp);
    expect(characterStore.sheet()!.spellcasting[0]?.slots.find((s) => s.level === 1)?.used).toBe(0);
    expect(
      characterStore.sheet()!.conditions.find((c) => c.conditionId === EXHAUSTION)?.level,
    ).toBe(1);
  });

  it('cancelling the short-rest dialog appends nothing', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const eventsBefore = characterStore.events().length;

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.rest.short).click();
    TestBed.tick();
    buttonNamed(overlay(), charactersEn.sheet.rest.dialog.cancel).click();
    await fixture.whenStable();

    expect(characterStore.events().length).toBe(eventsBefore);
  });
});

// task-7-brief.md: tap-to-roll affordances on ability/save/skill/attack/spell-attack rows, all
// using the ROW'S already-derived total as the modifier (never recomputed here), an advantage/
// disadvantage toggle in the roll-log panel's header that applies to exactly the next d20 roll,
// and every roll both logged (`RollLogService`) and announced (CDK `LiveAnnouncer`).
describe('PlayTabComponent — dice roller and roll log', () => {
  beforeEach(async () => {
    // Same locale-leak guard every other describe block in this file documents.
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
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
    vi.restoreAllMocks();
  });

  function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`no button matching "${text}"`);
    return button;
  }

  function abilityCardFor(compiled: HTMLElement, label: string): HTMLElement {
    const cards = Array.from(compiled.querySelectorAll<HTMLElement>('.play-tab__ability'));
    const card = cards.find(
      (c) => c.querySelector('.hk-card__header')?.textContent?.trim() === label,
    );
    if (!card) throw new Error(`no ability card matching "${label}"`);
    return card;
  }

  function skillRowFor(compiled: HTMLElement, label: string): HTMLElement {
    const rows = Array.from(compiled.querySelectorAll<HTMLElement>('.play-tab__skill'));
    const row = rows.find(
      (r) => r.querySelector('.play-tab__skill-name')?.textContent?.trim() === label,
    );
    if (!row) throw new Error(`no skill row matching "${label}"`);
    return row;
  }

  /** Same scripting technique `rest-dialog.component.spec.ts` documents in full — narrowed to the
   * EXACT `Uint32Array` length-1 shape `cryptoRng` passes, so `uuidv7()`'s own entropy draw falls
   * through to the real `crypto.getRandomValues` untouched. Consumed in call order. */
  function scriptRolls(targets: { value: number; sides: number }[]): void {
    let i = 0;
    const real = crypto.getRandomValues.bind(crypto) as (array: unknown) => unknown;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: unknown) => {
      if (array instanceof Uint32Array && array.length === 1) {
        const t = targets[i++];
        const frac = t ? (t.value - 0.5) / t.sides : 0;
        array[0] = Math.floor(frac * 2 ** 32);
        return array;
      }
      return real(array);
    }) as typeof crypto.getRandomValues);
  }

  it('a skill roll uses 1d20 + the derived total exactly, logs it, and announces it', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const athleticsTotal = characterStore.sheet()!.skills['athletics'].total.value;

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const announceSpy = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

    scriptRolls([{ value: 14, sides: 20 }]);
    const athleticsRow = skillRowFor(compiled, 'Athletics');
    buttonNamed(athleticsRow, charactersEn.sheet.roll.skill).click();
    TestBed.tick();

    const rollLogService = TestBed.inject(RollLogService);
    expect(rollLogService.entries()).toHaveLength(1);
    const [entry] = rollLogService.entries();
    expect(entry).toMatchObject({
      labelKey: 'sheet.roll.entries.skill',
      params: { name: 'Athletics' },
      dice: [{ sides: 20, value: 14, kept: true }],
      modifier: athleticsTotal,
      total: 14 + athleticsTotal,
    });
    expect(entry?.advantage).toBeUndefined();
    expect(entry?.manual).toBeUndefined();

    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy.mock.calls[0]?.[0] as string).toContain(String(14 + athleticsTotal));
  });

  it('an ability check uses the plain mod, and a save uses the derived save total', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const strMod = characterStore.sheet()!.abilities['str'].mod;
    const strSave = characterStore.sheet()!.abilities['str'].save.value;

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const rollLogService = TestBed.inject(RollLogService);

    // ONE `scriptRolls` call covering both rolls in consumption order (`getRandomValues` is only
    // ever spied ONCE per test here — re-spying an already-spied `crypto.getRandomValues` would
    // capture the mock itself as "real", not the native implementation, and recurse).
    scriptRolls([
      { value: 9, sides: 20 },
      { value: 3, sides: 20 },
    ]);

    buttonNamed(abilityCardFor(compiled, 'Strength'), charactersEn.sheet.roll.check).click();
    TestBed.tick();
    expect(rollLogService.entries()[0]).toMatchObject({
      labelKey: 'sheet.roll.entries.check',
      modifier: strMod,
      total: 9 + strMod,
    });

    buttonNamed(abilityCardFor(compiled, 'Strength'), charactersEn.sheet.roll.save).click();
    TestBed.tick();
    expect(rollLogService.entries()[0]).toMatchObject({
      labelKey: 'sheet.roll.entries.save',
      modifier: strSave,
      total: 3 + strSave,
    });
  });

  it('advantage rolls 2d20 keep-highest for the next d20 roll only, then resets to Normal; disadvantage keeps lowest', async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const strMod = characterStore.sheet()!.abilities['str'].mod;

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const rollLogService = TestBed.inject(RollLogService);

    // ONE `scriptRolls` call covering both 2-die rolls in consumption order (see the previous
    // describe block's own comment: re-spying an already-spied `crypto.getRandomValues` within
    // the same test captures the MOCK itself as "real", not the native implementation).
    scriptRolls([
      { value: 5, sides: 20 },
      { value: 17, sides: 20 },
      { value: 16, sides: 20 },
      { value: 2, sides: 20 },
    ]);

    buttonNamed(compiled, charactersEn.sheet.roll.advantage.advantage).click();
    TestBed.tick();

    buttonNamed(abilityCardFor(compiled, 'Strength'), charactersEn.sheet.roll.check).click();
    TestBed.tick();

    expect(rollLogService.entries()[0]).toMatchObject({
      dice: [
        { sides: 20, value: 5, kept: false },
        { sides: 20, value: 17, kept: true },
      ],
      advantage: 'adv',
      total: 17 + strMod,
    });
    // One-shot: back to Normal after consuming the toggle.
    expect(
      buttonNamed(compiled, charactersEn.sheet.roll.advantage.normal).getAttribute('aria-pressed'),
    ).toBe('true');

    buttonNamed(compiled, charactersEn.sheet.roll.advantage.disadvantage).click();
    TestBed.tick();

    buttonNamed(abilityCardFor(compiled, 'Strength'), charactersEn.sheet.roll.check).click();
    TestBed.tick();

    expect(rollLogService.entries()[0]).toMatchObject({
      dice: [
        { sides: 20, value: 16, kept: false },
        { sides: 20, value: 2, kept: true },
      ],
      advantage: 'dis',
      total: 2 + strMod,
    });
  });

  it("an attack damage roll parses the row's own dice string and adds the derived bonus, with no advantage applied", async () => {
    await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    const longsword = characterStore.sheet()!.attacks[0];
    expect(longsword.damage.dice).toBe('1d8'); // fixture assumption — longsword, one-handed
    const bonus = longsword.damage.bonus.value;

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const rollLogService = TestBed.inject(RollLogService);

    // Advantage set beforehand must NOT affect a damage roll (d20-only mechanic).
    buttonNamed(compiled, charactersEn.sheet.roll.advantage.advantage).click();
    TestBed.tick();

    scriptRolls([{ value: 6, sides: 8 }]);
    const attackRow = compiled.querySelector<HTMLElement>('.play-tab__attacks tbody tr')!;
    buttonNamed(attackRow, charactersEn.sheet.roll.attackDamage).click();
    TestBed.tick();

    const [entry] = rollLogService.entries();
    expect(entry).toMatchObject({
      labelKey: 'sheet.roll.entries.attackDamage',
      dice: [{ sides: 8, value: 6, kept: true }],
      modifier: bonus,
      total: 6 + bonus,
    });
    expect(entry?.advantage).toBeUndefined();
    // The advantage toggle is untouched by a damage roll (never consumed).
    expect(
      buttonNamed(compiled, charactersEn.sheet.roll.advantage.advantage).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
  });

  it('a manual log entry appended through the panel is flagged manual and carries the typed total', async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const amountInput = compiled.querySelector<HTMLInputElement>(
      '.roll-log-panel__manual input[type="number"]',
    )!;
    amountInput.value = '11';
    amountInput.dispatchEvent(new Event('input'));
    TestBed.tick();

    buttonNamed(compiled, charactersEn.sheet.roll.manual.add).click();
    TestBed.tick();

    const rollLogService = TestBed.inject(RollLogService);
    expect(rollLogService.entries()[0]).toMatchObject({ total: 11, manual: true });
  });
});
