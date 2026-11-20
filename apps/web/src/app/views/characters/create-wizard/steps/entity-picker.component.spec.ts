import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { provideEngineScope } from '@shared/services/engine/engine-scope.providers';
import { CharacterEngineScope } from '@shared/stores/character-engine-scope';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { press } from '../../../../ui/testing/harness';
import { PickerToolsService } from '../picker-tools.service';
import shellEn from '../../../../../assets/i18n/shell/en.json';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import sampleJson from '../../../../../testing/fixtures/packs/sample-content.json';
import { HkPeekHostComponent } from '../../../../ui/description-drawer/peek-host.component';
import { PeekService } from '../../../../ui/description-drawer/peek.service';
import { DialogRef } from '../../../../ui/dialog/dialog.service';
import { EntityPickerComponent } from './entity-picker.component';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling) — `pretest`
// (apps/web/package.json) builds it before this file ever runs.
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
const speciesIds = corePack.entities
  .filter((e) => e.type === 'species')
  .map((e) => e.id)
  .sort();

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    if (langPath === 'shell/en') return of(shellEn);
    return of({});
  }
}

@Component({
  selector: 'app-entity-picker-host',
  imports: [EntityPickerComponent, HkPeekHostComponent],
  template: `
    <hk-peek-host />
    <hk-entity-picker
      [ids]="ids()"
      [selectedIds]="selectedIds()"
      [limit]="limit()"
      [gates]="gates()"
      [layout]="layout()"
      (toggled)="onToggle($event)"
    />
  `,
})
class HostComponent {
  readonly ids = signal<readonly string[]>([]);
  readonly selectedIds = signal<readonly string[]>([]);
  readonly limit = signal<number | undefined>(undefined);
  readonly gates = signal<ReadonlyMap<string, string>>(new Map());
  readonly layout = signal<'cards' | 'rows'>('cards');
  readonly toggled: string[] = [];

  onToggle(id: string): void {
    this.toggled.push(id);
  }
}

function configure(): void {
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [
      provideRouter([]),
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
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
    ],
  });
}

describe('EntityPickerComponent', () => {
  beforeEach(() => configure());

  it('renders a card with the localized name for each provided entity id', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(speciesIds);
    await fixture.whenStable();

    const names = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.hk-picker-card__name'),
    ).map((el) => el.textContent?.trim());
    expect(names.length).toBe(speciesIds.length);
    expect(names).toContain('Human');
  });

  it('clicking a card select button emits toggle with that entity id', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(speciesIds);
    await fixture.whenStable();

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.hk-picker-card__choose',
    );
    expect(button).toBeTruthy();
    button!.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.toggled.length).toBe(1);
    expect(speciesIds).toContain(fixture.componentInstance.toggled[0]);
  });

  it("marks a selected id's button as pressed", async () => {
    const humanId = speciesIds.find((id) => id.endsWith('/human'))!;
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(speciesIds);
    fixture.componentInstance.selectedIds.set([humanId]);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const humanRow = Array.from(compiled.querySelectorAll('hk-picker-card')).find(
      (card) => card.querySelector('.hk-picker-card__name')?.textContent?.trim() === 'Human',
    );
    const button = humanRow?.querySelector('.hk-picker-card__choose');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  it('a gated card is disabled unless it is selected: a selected gated card stays deselectable', async () => {
    const humanId = speciesIds.find((id) => id.endsWith('/human'))!;
    const elfId = speciesIds.find((id) => id.endsWith('/elf'))!;
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(speciesIds);
    fixture.componentInstance.selectedIds.set([humanId]);
    fixture.componentInstance.gates.set(
      new Map([
        [humanId, 'Already chosen'],
        [elfId, 'Already chosen'],
      ]),
    );
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const buttonFor = (name: string) =>
      Array.from(compiled.querySelectorAll('hk-picker-card'))
        .find((card) => card.querySelector('.hk-picker-card__name')?.textContent?.trim() === name)
        ?.querySelector<HTMLButtonElement>('.hk-picker-card__choose');

    // Gated and NOT selected: refused (the button reads as disabled and a press does nothing).
    const elf = buttonFor('Elf')!;
    expect(elf.getAttribute('aria-disabled')).toBe('true');
    elf.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.toggled).toEqual([]);
    // Gated but selected: still pressed, and still clickable so the pick can be undone.
    const human = buttonFor('Human')!;
    expect(human.getAttribute('aria-pressed')).toBe('true');
    expect(human.getAttribute('aria-disabled')).not.toBe('true');
    human.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.toggled).toEqual([humanId]);
  });

  it('filters cards by the search field text', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(speciesIds);
    await fixture.whenStable();

    vi.useFakeTimers();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    expect(input).toBeTruthy();
    input!.value = 'huma';
    input!.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    TestBed.tick();
    vi.useRealTimers();
    await fixture.whenStable();

    const names = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.hk-picker-card__name'),
    ).map((el) => el.textContent?.trim());
    expect(names).toEqual(['Human']);
  });

  // Controller ruling (task-6 fix round): `limit` caps how many (search-filtered) cards render,
  // with a hint naming the remainder — task 8's 339-spell picker will pass this. 100 real spell
  // ids stand in for a "synthetic" large option set here (their exact names don't matter, only
  // that there are ≥100 with distinct names).
  it('caps rendered cards at `limit` and shows a hint with the remaining count; narrowing the search below the limit removes it', async () => {
    const spellEntities = corePack.entities
      .filter((e) => e.type === 'spell')
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const first100 = spellEntities.slice(0, 100);
    expect(first100.length).toBe(100);

    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(first100.map((e) => e.id));
    fixture.componentInstance.limit.set(20);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('hk-picker-card').length).toBe(20);
    expect(compiled.querySelector('.entity-picker__more')?.textContent).toContain('80');

    // The longest name among the 100 is the search term least likely to also be a substring of
    // another entry's name — computed from the real data rather than a hardcoded guess, so this
    // holds regardless of exact SRD pack content.
    const longest = [...first100].sort((a, b) => b.name.length - a.name.length)[0];
    const matchCount = first100.filter((e) =>
      e.name.toLowerCase().includes(longest.name.toLowerCase()),
    ).length;
    expect(matchCount).toBeLessThan(20);

    vi.useFakeTimers();
    const input = compiled.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = longest.name;
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    TestBed.tick();
    vi.useRealTimers();
    await fixture.whenStable();

    expect(compiled.querySelectorAll('hk-picker-card').length).toBe(matchCount);
    expect(compiled.querySelector('.entity-picker__more')).toBeNull();
  });
});

/** A weapon mastery list is long: it reads as rows, each with a tick seal and an info button. */
describe('EntityPickerComponent — rows, filters and the drawer action (plan 17)', () => {
  beforeEach(() => configure());
  const weaponIds = corePack.entities
    .filter((e) => e.type === 'item' && e.weapon?.mastery)
    .map((e) => e.id);

  async function mountRows(selected: string[] = []) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(weaponIds);
    fixture.componentInstance.selectedIds.set(selected);
    fixture.componentInstance.layout.set('rows');
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('rows toggle on a press of the row and open the description from the info button without picking', async () => {
    const { fixture, root } = await mountRows();
    const rows = root.querySelectorAll<HTMLElement>('.entity-picker__row');
    expect(rows.length).toBe(weaponIds.length);
    expect(root.querySelector('hk-picker-card')).toBeNull();

    press(rows[0].querySelector<HTMLElement>('.entity-picker__toggle')!);
    expect(fixture.componentInstance.toggled).toHaveLength(1);

    press(rows[1].querySelector<HTMLElement>('.entity-picker__info')!);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('hk-description-drawer [role="dialog"]')).not.toBeNull();
    expect(fixture.componentInstance.toggled).toHaveLength(1);
  });

  it('a selected row wears the tick seal and is pressed; its accessible name carries the visible facts', async () => {
    const { root } = await mountRows([weaponIds[0]]);
    const selected = root.querySelector('.entity-picker__row--selected')!;
    expect(selected.querySelector('hk-wax-seal')).not.toBeNull();
    const toggle = selected.querySelector('.entity-picker__toggle')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const name = selected.querySelector('.entity-picker__name')!.textContent.trim();
    expect(toggle.getAttribute('aria-label')).toContain(name);
    const chips = Array.from(selected.querySelectorAll('.hk-tag-chip__label'));
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(toggle.getAttribute('aria-label')).toContain(chip.textContent.trim());
    }
  });

  it('a gated row stays listed, reads disabled and does not pick', async () => {
    const { fixture, root } = await mountRows();
    fixture.componentInstance.gates.set(new Map([[weaponIds[0], 'Already chosen']]));
    await fixture.whenStable();
    const toggle = root.querySelector<HTMLElement>(
      '.entity-picker__row--gated .entity-picker__toggle',
    )!;
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    press(toggle);
    expect(fixture.componentInstance.toggled).toEqual([]);
  });

  it('the facet chips filter the options, and clearing them brings every option back', async () => {
    const { fixture, root } = await mountRows();
    const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('button[hk-filter-chip]'));
    expect(chips.length).toBeGreaterThan(1);
    const total = root.querySelectorAll('.entity-picker__row').length;
    press(chips[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    const filtered = root.querySelectorAll('.entity-picker__row').length;
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(total);
    press(root.querySelector<HTMLElement>('.hk-filter-chips__clear')!);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelectorAll('.entity-picker__row')).toHaveLength(total);
  });

  it('the drawer carries a Choose button that picks the option it describes, then reads Chosen', async () => {
    const { fixture, root } = await mountRows();
    press(root.querySelector<HTMLElement>('.entity-picker__info')!);
    fixture.detectChanges();
    await fixture.whenStable();
    const action = () => root.querySelector<HTMLButtonElement>('.entity-picker__drawer-choose')!;
    expect(action().getAttribute('aria-pressed')).toBe('false');
    press(action());
    expect(fixture.componentInstance.toggled).toHaveLength(1);
    fixture.componentInstance.selectedIds.set([fixture.componentInstance.toggled[0]]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(action().getAttribute('aria-pressed')).toBe('true');
  });
});

describe('EntityPickerComponent — inside a dialog (the add-item picker)', () => {
  beforeEach(() => {
    configure();
    TestBed.overrideProvider(DialogRef, { useValue: new DialogRef(() => undefined) });
  });

  it('keeps its description drawer local (not the app-root peek), and its Choose button picks', async () => {
    const weaponIds = corePack.entities
      .filter((e) => e.type === 'item' && e.weapon?.mastery)
      .map((e) => e.id);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(weaponIds);
    fixture.componentInstance.layout.set('rows');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    press(root.querySelector<HTMLElement>('.entity-picker__info')!);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(TestBed.inject(PeekService).current()).toBeNull();
    expect(root.querySelector('hk-peek-host hk-description-drawer')).toBeNull();
    expect(
      root.querySelector('hk-entity-picker hk-description-drawer [role="dialog"]'),
    ).not.toBeNull();
    press(root.querySelector<HTMLElement>('hk-entity-picker .entity-picker__drawer-choose')!);
    expect(fixture.componentInstance.toggled).toEqual([weaponIds[0]]);
  });
});

/** Inside the wizard the strap's Filter and Search buttons reach the picker through the tools service. */
describe('EntityPickerComponent — strap tools (plan 17)', () => {
  @Component({
    selector: 'app-tools-host',
    imports: [EntityPickerComponent],
    providers: [PickerToolsService],
    template: `<hk-entity-picker [ids]="ids" />`,
  })
  class ToolsHostComponent {
    readonly ids = speciesIds;
    readonly tools = inject(PickerToolsService);
  }

  beforeEach(() => configure());

  it('registers while mounted, reports its chips, folds them away on Filter and focuses the search on Search', async () => {
    const fixture = TestBed.createComponent(ToolsHostComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const tools = fixture.componentInstance.tools;
    expect(tools.active()).toBe(true);
    expect(tools.hasFilters()).toBe(true);
    expect(root.querySelector('button[hk-filter-chip]')).not.toBeNull();

    tools.toggleFilters(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('button[hk-filter-chip]')).toBeNull();

    // Folding the chips away also clears a chip that was applied, so no filter stays out of sight.
    tools.toggleFilters(false);
    fixture.detectChanges();
    await fixture.whenStable();
    press(root.querySelector<HTMLElement>('button[hk-filter-chip]')!);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelectorAll('hk-picker-card').length).toBeLessThan(speciesIds.length);
    tools.toggleFilters(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelectorAll('hk-picker-card')).toHaveLength(speciesIds.length);

    document.body.append(root);
    tools.requestSearch();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(root.querySelector('input[type="search"]'));
    root.remove();

    fixture.destroy();
    expect(tools.active()).toBe(false);
  });
});

describe('EntityPickerComponent — descriptions open in the description drawer', () => {
  beforeEach(() => configure());

  it('every option opens its own description in the drawer, headed by its name, and closes on Escape', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(speciesIds);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const names = Array.from(root.querySelectorAll('.hk-picker-card__name')).map(
      (el) => el.textContent?.trim() ?? '',
    );
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('.hk-picker-card__body'));
    expect(buttons.length).toBe(speciesIds.length);
    expect(root.querySelector('hk-description-drawer .hk-drawer__panel')).toBeNull();

    for (const [i, button] of buttons.entries()) {
      press(button);
      fixture.detectChanges();
      await fixture.whenStable();
      const heading = root.querySelector('hk-description-drawer .hk-drawer__title');
      expect(heading?.textContent?.trim(), `option ${i}`).toBe(names[i]);
      expect(root.querySelector('hk-description-drawer [role="dialog"]')).not.toBeNull();
      // Opening a description never picks the option.
      expect(fixture.componentInstance.toggled).toEqual([]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(root.querySelector('hk-description-drawer [role="dialog"]')).toBeNull();
    }
  });
});

// --- Plan 15 Task 4 fix round 1: an expanded card's description renders its `[[id]]` cross-links
// against the picker's (scoped) pack set — `MarkdownService` is root-provided, so the picker
// passes its own localizer.
describe('EntityPickerComponent — cross-links inside a character scope (plan 15 Task 4)', () => {
  const MOONKIN = 'sample-content:species/moonkin';
  const LUNAR = 'sample-content:feat/lunar-insight';

  @Component({
    selector: 'app-scoped-picker-host',
    imports: [EntityPickerComponent, HkPeekHostComponent],
    providers: [CharacterEngineScope, provideEngineScope(CharacterEngineScope)],
    template: `<hk-entity-picker [ids]="ids" /><hk-peek-host />`,
  })
  class ScopedHostComponent {
    readonly ids = [MOONKIN];
  }

  beforeEach(() => {
    const parsed = parsePack(sampleJson);
    if (!parsed.ok) throw new Error('sample-content.json fixture no longer parses');
    // The moonkin's description gains a cross-link to the pack's own feat.
    const sample: Pack = {
      ...parsed.pack,
      entities: parsed.pack.entities.map((e) =>
        e.id === MOONKIN ? { ...e, description: `Kin of [[${LUNAR}]].` } : e,
      ),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTransloco({
          config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
          loader: StubLoader,
        }),
        provideTranslocoMessageformat(),
        {
          provide: PackStore,
          useValue: {
            packs: signal([corePack, sample]),
            ready: signal(true),
            corePack: signal(corePack),
          },
        },
        {
          provide: CharacterStore,
          useValue: {
            facts: signal({
              pins: { [corePack.id]: corePack.version, [sample.id]: sample.version },
            }),
            streamId: signal(undefined),
          },
        },
      ],
    });
  });

  it("names a cross-linked entity of the character's pinned pack in the drawer description", async () => {
    const fixture = TestBed.createComponent(ScopedHostComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.hk-picker-card__name')?.textContent?.trim()).toBe('Moonkin');

    press(root.querySelector<HTMLElement>('.hk-picker-card__body')!);
    const link = 'hk-description-drawer .hk-description__body a';
    for (let i = 0; i < 20 && !root.querySelector(link); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      await fixture.whenStable();
    }

    const anchor = root.querySelector(link);
    expect(anchor?.textContent).toBe('Lunar Insight');
    expect(anchor?.getAttribute('data-entity-id')).toBe(LUNAR);
  });
});
