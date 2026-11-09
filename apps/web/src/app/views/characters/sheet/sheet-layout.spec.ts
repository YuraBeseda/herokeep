import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { propose } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { HeroWriterService } from '@shared/services/export/hero-writer.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { TabBarService } from '../../../ui/tab-bar/tab-bar.service';
import { stubViewport } from '../../../ui/testing/viewport';
import { routes } from '../../../app.routes';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import shellEn from '../../../../assets/i18n/shell/en.json';
import { seedFighter, seedWizard } from './testing/character-fixtures';

// B9a: the play sheet as leaves, the phone tabs and the strap. These specs drive the REAL routes
// (`app.routes.ts`) through `RouterTestingHarness`, so they assert the composition a user gets at a
// URL: which leaves each route renders, where route and width meet, and what the strap holds.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

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

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    if (langPath === 'campaigns/en') return of(campaignsEn);
    if (langPath === 'shell/en') return of(shellEn);
    return of({});
  }
}

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

const ANTITOXIN_STACK = '00000000-0000-4000-8000-0000000000a1';

const LEAVES = [
  'app-vitals-leaf',
  'app-abilities-leaf',
  'app-skills-leaf',
  'app-attacks-leaf',
  'app-resources-leaf',
  'app-conditions-leaf',
  'app-features-leaf',
  'app-proficiencies-leaf',
  'app-spells-leaf',
  'app-bag-leaf',
];

function leavesIn(root: Element): string[] {
  return LEAVES.filter((leaf) => root.querySelector(leaf) !== null);
}

function mainOf(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('.sheet-shell__main')!;
}

function strapIds(): { primary: string[]; secondary: string[] } {
  const config = TestBed.inject(ActionStrapService).config();
  return {
    primary: (config?.primary ?? []).map((a) => a.id),
    secondary: (config?.secondary ?? []).map((a) => a.id),
  };
}

describe('play sheet leaves, phone tabs and strap (plan 17 B9a)', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
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
            packs: signal([corePack]),
            installedContent: signal([corePack]),
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
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
      db.blobs.clear(),
      db.campaigns.clear(),
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.replaceChildren());
    TestBed.inject(HkDb).close();
  });

  it('at tablet/desktop width the folio holds the vitals, abilities and skills and the Play tab every other leaf, once each', async () => {
    const id = await seedWizard('Elowen');

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await harness.fixture.whenStable();
    const root = harness.routeNativeElement!;

    expect(leavesIn(root.querySelector('.sheet-shell__folio')!)).toEqual([
      'app-vitals-leaf',
      'app-abilities-leaf',
      'app-skills-leaf',
    ]);
    expect(leavesIn(mainOf(root))).toEqual([
      'app-attacks-leaf',
      'app-resources-leaf',
      'app-conditions-leaf',
      'app-features-leaf',
      'app-proficiencies-leaf',
      'app-spells-leaf',
      'app-bag-leaf',
    ]);
    for (const leaf of LEAVES) expect(root.querySelectorAll(leaf)).toHaveLength(1);
    expect(TestBed.inject(TabBarService).tabs()).toBeNull();
  });

  it('a phone-tab URL resolves to the Play tab at tablet/desktop width', async () => {
    const id = await seedFighter('Ivan');

    const harness = await RouterTestingHarness.create(`/c/${id}/combat`);
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toMatch(/\/play$/);
    expect(mainOf(harness.routeNativeElement!).querySelector('.play-tab')).not.toBeNull();
  });

  it('below 768 px /play lands on the Combat tab and the shell sets the five phone tabs on the tab bar', async () => {
    stubViewport({ phone: true });
    const id = await seedFighter('Ivan');

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toMatch(/\/combat$/);
    const tabs = TestBed.inject(TabBarService).tabs();
    expect(tabs?.map((t) => t.id)).toEqual(['combat', 'spells', 'bag', 'hero', 'more']);
    expect(tabs?.map((t) => t.route.at(-1))).toEqual(['combat', 'spells', 'bag', 'hero', 'more']);
    // The folio shrinks to the identity row: no folio tab row, no leaves beside the routed tab.
    const root = harness.routeNativeElement!;
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(leavesIn(root.querySelector('.sheet-shell__folio')!)).toEqual([]);
  });

  it("the Combat tab's DOM order is HP, AC/initiative/speed, saves, attacks, resources, conditions, death saves, inspiration", async () => {
    stubViewport({ phone: true });
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    // 20 clamps to the reachable 12 -> current HP lands on 0, so the death saves show.
    await characterStore.appendTx(propose.damage(characterStore.sheet()!, 20));

    const harness = await RouterTestingHarness.create(`/c/${id}/combat`);
    await harness.fixture.whenStable();
    const main = mainOf(harness.routeNativeElement!);

    const order = [
      '.hk-hp-gauge__current',
      'hk-shield-badge',
      '.vitals__initiative',
      '.vitals__speed',
      'app-abilities-leaf',
      'app-attacks-leaf',
      'app-resources-leaf',
      'app-conditions-leaf .conditions__add',
      'hk-death-saves',
      'hk-inspiration-toggle',
    ].map((selector) => main.querySelector(selector));
    order.forEach((el, i) => expect(el, `element #${i}`).not.toBeNull());
    for (let i = 1; i < order.length; i++) {
      const follows = order[i - 1]!.compareDocumentPosition(order[i]!);
      expect(follows & Node.DOCUMENT_POSITION_FOLLOWING, `#${i} follows #${i - 1}`).toBeTruthy();
    }
  });

  it.each([
    [
      'combat',
      [
        'app-vitals-leaf',
        'app-abilities-leaf',
        'app-attacks-leaf',
        'app-resources-leaf',
        'app-conditions-leaf',
      ],
    ],
    ['spells', ['app-spells-leaf']],
    ['bag', ['app-bag-leaf']],
    [
      'hero',
      ['app-abilities-leaf', 'app-skills-leaf', 'app-features-leaf', 'app-proficiencies-leaf'],
    ],
    ['more', []],
  ])('the %s tab renders only its own leaves', async (tab, expected) => {
    stubViewport({ phone: true });
    const id = await seedWizard('Elowen');

    const harness = await RouterTestingHarness.create(`/c/${id}/${tab}`);
    await harness.fixture.whenStable();

    expect(leavesIn(mainOf(harness.routeNativeElement!))).toEqual(expected);
  });

  it('the More tab lists Build, Timeline, Notes, Roll log, Content packs and Export, and Level up only when XP allows it', async () => {
    stubViewport({ phone: true });
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const harness = await RouterTestingHarness.create(`/c/${id}/more`);
    await harness.fixture.whenStable();
    const main = mainOf(harness.routeNativeElement!);
    const labels = (): string[] =>
      Array.from(main.querySelectorAll('.more__row')).map((el) => el.textContent?.trim() ?? '');

    expect(labels()).toEqual([
      charactersEn.sheet.tabs.build,
      charactersEn.sheet.tabs.timeline,
      charactersEn.sheet.notes.title,
      charactersEn.sheet.roll.logTitle,
      charactersEn.sheet.more.packs,
      charactersEn.sheet.header.export,
    ]);

    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);
    await pollUntil(harness.fixture, () => characterStore.advancements().length > 0);
    await harness.fixture.whenStable();
    expect(labels().at(-1)).toBe(charactersEn.sheet.header.levelUp);
  });

  it('the sheet strap is Damage · Heal · Roll · Short rest · Long rest | Add condition · Notes · Roll log · Export · Edit, scoped to the sheet so it survives tab changes', async () => {
    const id = await seedFighter('Ivan');
    const router = TestBed.inject(Router);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await pollUntil(harness.fixture, () => strapIds().primary.length > 0);

    expect(strapIds()).toEqual({
      primary: ['damage', 'heal', 'roll', 'short-rest', 'long-rest'],
      secondary: ['add-condition', 'notes', 'roll-log', 'export', 'edit'],
    });
    expect(TestBed.inject(ActionStrapService).config()?.scope).toEqual([
      '/c',
      router.url.split('/')[2],
    ]);

    await harness.navigateByUrl(`/c/${id}/build`);
    await harness.fixture.whenStable();
    expect(strapIds().primary).toEqual(['damage', 'heal', 'roll', 'short-rest', 'long-rest']);
    await harness.navigateByUrl(`/c/${id}/timeline`);
    await harness.fixture.whenStable();
    expect(strapIds().primary).toEqual(['damage', 'heal', 'roll', 'short-rest', 'long-rest']);
  });

  it('the sheet strap does not linger on the level-up screen, and comes back with the sheet', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 300 } }]);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await pollUntil(harness.fixture, () => strapIds().primary.length > 0);

    await harness.navigateByUrl(`/c/${id}/level-up`);
    await harness.fixture.whenStable();
    expect(strapIds().primary).toEqual([]);

    await harness.navigateByUrl(`/c/${id}/play`);
    await pollUntil(harness.fixture, () => strapIds().primary.length > 0);
    expect(strapIds().primary).toEqual(['damage', 'heal', 'roll', 'short-rest', 'long-rest']);
  });

  /** A `matchMedia` stub whose phone query can be flipped, firing the change listeners (a resize). */
  function switchableViewport(phone: boolean): (next: boolean) => void {
    let matches = phone;
    const listeners: ((event: { matches: boolean }) => void)[] = [];
    vi.stubGlobal('matchMedia', (query: string) => ({
      media: query,
      get matches() {
        return query.includes('max-width') ? matches : false;
      },
      addEventListener: (_: string, l: (event: { matches: boolean }) => void) => listeners.push(l),
      removeEventListener: () => undefined,
    }));
    return (next) => {
      matches = next;
      listeners.forEach((l) => l({ matches: next }));
    };
  }

  it('on a phone /play resolves to Combat before it activates: the Play tab is never mounted', async () => {
    stubViewport({ phone: true });
    const id = await seedFighter('Ivan');
    const router = TestBed.inject(Router);
    const ended: string[] = [];
    router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) ended.push(event.urlAfterRedirects);
    });

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await harness.fixture.whenStable();

    expect(ended.every((url) => !url.endsWith('/play'))).toBe(true);
    expect(router.url).toMatch(/\/combat$/);
    expect(mainOf(harness.routeNativeElement!).querySelector('.play-tab')).toBeNull();
  });

  it('a resize across the breakpoint keeps the place: Spells -> Play at tablet width -> Spells again', async () => {
    const flip = switchableViewport(true);
    const id = await seedFighter('Ivan');
    const router = TestBed.inject(Router);

    const harness = await RouterTestingHarness.create(`/c/${id}/spells`);
    await harness.fixture.whenStable();
    expect(router.url).toMatch(/\/spells$/);

    flip(false);
    await pollUntil(harness.fixture, () => router.url.endsWith('/play'));
    flip(true);
    await pollUntil(harness.fixture, () => router.url.endsWith('/spells'));
  });

  it('on desktop /spells, /bag and /hero resolve to Play', async () => {
    const id = await seedFighter('Ivan');
    const router = TestBed.inject(Router);
    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    for (const tab of ['spells', 'bag', 'hero']) {
      await harness.navigateByUrl(`/c/${id}/${tab}`);
      expect(router.url, tab).toMatch(/\/play$/);
    }
  });

  it('keeps both the query and the fragment when the guard redirects (?a=1#f)', async () => {
    const id = await seedFighter('Ivan');
    const router = TestBed.inject(Router);
    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await harness.navigateByUrl(`/c/${id}/bag?a=1#f`);
    expect(router.url).toBe(`/c/${id}/play?a=1#f`);
  });

  it('keeps the query and fragment when a phone /play redirects to its tab', async () => {
    stubViewport({ phone: true });
    const id = await seedFighter('Ivan');
    const router = TestBed.inject(Router);
    const harness = await RouterTestingHarness.create(`/c/${id}/more`);
    await harness.navigateByUrl(`/c/${id}/play?a=1#f`);
    expect(router.url).toBe(`/c/${id}/more?a=1#f`);
  });

  it('the phone tab bar marks More current on Build and Timeline, which More lists', async () => {
    stubViewport({ phone: true });
    const id = await seedFighter('Ivan');
    const harness = await RouterTestingHarness.create(`/c/${id}/more`);
    await harness.fixture.whenStable();
    const more = TestBed.inject(TabBarService)
      .tabs()!
      .find((t) => t.id === 'more')!;
    expect(more.alsoActive?.map((r) => r.at(-1))).toEqual(['build', 'timeline']);
  });

  it('Export is disabled while the export is pending and enabled again after success and after failure', async () => {
    const id = await seedFighter('Ivan');
    const writer = TestBed.inject(HeroWriterService);
    let settle!: (value: 'ok' | Error) => void;
    vi.spyOn(writer, 'export').mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          settle = (value) =>
            value === 'ok'
              ? resolve({ blob: new Blob(['z']), fileName: 'Ivan.hero', warnings: [] })
              : reject(value);
        }),
    );
    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await pollUntil(harness.fixture, () => strapIds().secondary.length > 0);
    const exportAction = () =>
      TestBed.inject(ActionStrapService)
        .config()!
        .secondary!.find((a) => a.id === 'export')!;

    expect(exportAction().disabled).toBeFalsy();
    exportAction().run();
    await pollUntil(harness.fixture, () => exportAction().disabled === true);

    settle('ok');
    await pollUntil(harness.fixture, () => !exportAction().disabled);

    exportAction().run();
    await pollUntil(harness.fixture, () => exportAction().disabled === true);
    settle(new Error('boom'));
    await pollUntil(harness.fixture, () => !exportAction().disabled);
  });

  it('the strap Damage action brings the player to the HP amount field', async () => {
    const id = await seedFighter('Ivan');
    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    document.body.append(harness.routeNativeElement!);
    await pollUntil(harness.fixture, () => strapIds().primary.length > 0);

    TestBed.inject(ActionStrapService)
      .config()!
      .primary.find((a) => a.id === 'damage')!
      .run();

    expect(document.activeElement).toBe(document.querySelector('.hk-hp-gauge__amount'));
  });

  it("the satchel shows the selected item's Unequip / Details / quantity / Remove actions, and Unequip round-trips into the sheet", async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await harness.fixture.whenStable();
    const root = harness.routeNativeElement!;
    const acBefore = characterStore.sheet()!.ac.value;

    const slot = Array.from(root.querySelectorAll<HTMLButtonElement>('.hk-slot')).find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('Chain Mail'),
    )!;
    expect(slot).toBeDefined();
    expect(root.querySelector('.bag__actions')).toBeNull();

    slot.click();
    await harness.fixture.whenStable();
    const actionLabels = Array.from(root.querySelectorAll('.bag__actions button')).map(
      (b) => b.getAttribute('aria-label') ?? b.textContent?.trim(),
    );
    expect(actionLabels).toEqual([
      charactersEn.sheet.inventory.unequip,
      charactersEn.sheet.inventory.details,
      charactersEn.sheet.inventory.qtyDecrease,
      charactersEn.sheet.inventory.qtyIncrease,
      charactersEn.sheet.inventory.remove,
    ]);

    root.querySelector<HTMLButtonElement>('.bag__equip')!.click();
    await pollUntil(harness.fixture, () => characterStore.sheet()!.ac.value < acBefore);
    expect(characterStore.events().at(-1)).toMatchObject({ type: 'item.unequipped' });
  });

  it('Use on a consumable takes one from the stack, and the last one removes the entry', async () => {
    const id = await seedFighter('Ivan');
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.appendTx(
      propose.addItem(
        characterStore.sheet()!,
        { itemId: 'srd-5e-2024:item/antitoxin', qty: 2 },
        () => ANTITOXIN_STACK,
      ),
    );

    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await harness.fixture.whenStable();
    const root = harness.routeNativeElement!;
    const stack = (): number | undefined =>
      characterStore.sheet()!.inventory.find((r) => r.instanceId === ANTITOXIN_STACK)?.qty;

    Array.from(root.querySelectorAll<HTMLButtonElement>('.hk-slot'))
      .find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Antitoxin'))!
      .click();
    await harness.fixture.whenStable();

    root.querySelector<HTMLButtonElement>('.bag__use')!.click();
    await pollUntil(harness.fixture, () => stack() === 1);

    // Using the LAST one removes the entry, so it asks first (like Remove): cancel keeps it...
    const eventsBefore = characterStore.events().length;
    root.querySelector<HTMLButtonElement>('.bag__use')!.click();
    TestBed.tick();
    const overlay = document.querySelector<HTMLElement>('.cdk-overlay-container')!;
    expect(overlay.querySelector('.item-remove-confirm__title')).not.toBeNull();
    overlay.querySelector<HTMLButtonElement>('.item-remove-confirm__actions button')!.click();
    await harness.fixture.whenStable();
    expect(stack()).toBe(1);
    expect(characterStore.events().length).toBe(eventsBefore);

    // ...and confirming removes it.
    root.querySelector<HTMLButtonElement>('.bag__use')!.click();
    TestBed.tick();
    overlay.querySelectorAll<HTMLButtonElement>('.item-remove-confirm__actions button')[1].click();
    await pollUntil(harness.fixture, () => stack() === undefined);
    expect(characterStore.events().at(-1)).toMatchObject({ type: 'item.removed' });
  });
});
