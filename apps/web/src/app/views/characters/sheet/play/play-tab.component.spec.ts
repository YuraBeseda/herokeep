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

  it("renders a wizard stream's level-1 spell slots as dot rows matching spellcasting (2 slots, none used)", async () => {
    await seedWizard('Elowen');

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const slotRow = compiled.querySelector('.play-tab__slot-row')!;
    expect(slotRow).not.toBeNull();
    const dots = slotRow.querySelectorAll('.play-tab__dot');
    expect(dots).toHaveLength(2);
    expect(slotRow.querySelectorAll('.play-tab__dot--filled')).toHaveLength(0);
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
