import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import campaignsEn from '../../assets/i18n/campaigns/en.json';
import charactersEn from '../../assets/i18n/characters/en.json';
import shellEn from '../../assets/i18n/shell/en.json';
import { HkActionStrapComponent } from '../ui/action-strap/action-strap.component';
import {
  ActionStrapService,
  type StrapAction,
  type StrapConfig,
} from '../ui/action-strap/action-strap.service';
import { stubViewport } from '../ui/testing/viewport';
import { buildCampaignStrap } from './campaigns/shell/campaign-strap';
import { buildCampaignsListStrap } from './campaigns/list/list-strap';
import { buildSheetStrap } from './characters/sheet/sheet-strap';
import { buildLibraryStrap } from './library/browse/library-strap';
import { buildLibraryDetailStrap } from './library/detail/library-detail-strap';
import { buildHomebrewEditorStrap } from './packs/homebrew/homebrew-editor-strap';
import { buildHomebrewListStrap } from './packs/homebrew/homebrew-list-strap';
import { buildPackDetailStrap } from './packs/pack-detail-strap';
import { buildPacksListStrap } from './packs/packs-list-strap';

/** Every scope the app ships is available; the strap host still only resolves its own (shell). */
class AllScopesLoader implements TranslocoLoader {
  getTranslation(path: string) {
    if (path === 'shell/en') return of(shellEn);
    if (path === 'campaigns/en') return of(campaignsEn);
    if (path === 'characters/en') return of(charactersEn);
    return of({});
  }
}

const noop = (): void => undefined;

/** A translation key left on screen: `scope.some.key` with no spaces. */
const RAW_KEY = /\b(?:shell|campaigns|characters|library|settings)\.[\w-]+(?:\.[\w-]+)*/;

async function render(config: StrapConfig, phone = false): Promise<HTMLElement> {
  stubViewport({ phone, coarse: phone });
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTransloco({
        config: {
          availableLangs: ['en'],
          defaultLang: 'en',
          prodMode: true,
          reRenderOnLangChange: true,
        },
        loader: AllScopesLoader,
      }),
      provideTranslocoMessageformat(),
    ],
  }).compileComponents();
  TestBed.inject(ActionStrapService).set(config);
  const fixture = TestBed.createComponent(HkActionStrapComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

/** Everything a person can read on the strap: text, accessible names and hidden reasons. */
function readable(el: HTMLElement): string {
  const names = Array.from(el.querySelectorAll('[aria-label]')).map((n) =>
    n.getAttribute('aria-label'),
  );
  return [el.textContent, ...names].join(' | ');
}

const campaignHandlers = {
  effect: noop,
  toggleSession: noop,
  exportCampaign: noop,
  openSheet: noop,
};

const sheetHandlers = {
  focusHpAmount: noop,
  rollPlain: noop,
  shortRest: noop,
  longRest: noop,
  addCondition: noop,
  toggleNotes: noop,
  toggleRollLog: noop,
  exportHero: noop,
  edit: noop,
};

afterEach(() => vi.unstubAllGlobals());

describe('strap labels resolve through the real strap host (no raw keys)', () => {
  const cases: [string, StrapConfig][] = [
    ['campaigns list', buildCampaignsListStrap({ create: noop, join: noop })],
    [
      'campaign DM, nothing selected, idle',
      buildCampaignStrap(
        {
          role: 'dm',
          selected: false,
          sessionActive: false,
          canOpenSheet: false,
          scope: ['/g', 'x'],
        },
        campaignHandlers,
      ),
    ],
    [
      'campaign DM, selected, session running',
      buildCampaignStrap(
        {
          role: 'dm',
          selected: true,
          sessionActive: true,
          canOpenSheet: false,
          scope: ['/g', 'x'],
        },
        campaignHandlers,
      ),
    ],
    [
      'campaign player with a hero',
      buildCampaignStrap(
        {
          role: 'player',
          selected: false,
          sessionActive: false,
          canOpenSheet: true,
          scope: ['/g', 'x'],
        },
        campaignHandlers,
      ),
    ],
    [
      'sheet, locked by house rules',
      buildSheetStrap({ locked: true, exporting: false, scope: ['/c', 'x'] }, sheetHandlers),
    ],
    [
      'library browse',
      buildLibraryStrap({
        newHomebrew: noop,
        importPack: noop,
        focusFilter: noop,
        focusSearch: noop,
      }),
    ],
    [
      'library entry with an item to add',
      buildLibraryDetailStrap({
        back: noop,
        add: { kind: 'item', run: noop, reason: null },
        locked: false,
        copy: { run: noop, unavailable: null },
        openPack: noop,
      }),
    ],
    [
      'library entry with a spell to prepare, locked by house rules',
      buildLibraryDetailStrap({
        back: noop,
        add: { kind: 'spell', run: noop, reason: null },
        locked: true,
        copy: { run: noop, unavailable: null },
        openPack: noop,
      }),
    ],
    ['packs list', buildPacksListStrap({ importPack: noop, newHomebrew: noop, importing: false })],
    [
      'packs list, importing',
      buildPacksListStrap({ importPack: noop, newHomebrew: noop, importing: true }),
    ],
    ['pack detail', buildPackDetailStrap({ back: noop, exportPack: noop, exportReason: null })],
    ...(
      [
        'shell.strap.packs-export-core',
        'shell.strap.packs-export-invalid',
        'shell.strap.packs-export-none',
        'shell.strap.packs-export-busy',
      ] as const
    ).map((reason): [string, StrapConfig] => [
      `pack detail, Export unavailable (${reason})`,
      buildPackDetailStrap({ back: noop, exportPack: noop, exportReason: reason }),
    ]),
    [
      'homebrew list',
      buildHomebrewListStrap({ back: noop, newEntry: noop, exportPack: noop, exportReason: null }),
    ],
    [
      'homebrew list, nothing to export',
      buildHomebrewListStrap({
        back: noop,
        newEntry: noop,
        exportPack: noop,
        exportReason: 'shell.strap.packs-export-none',
      }),
    ],
    ...(['item', 'spell', 'feat', 'species'] as const).map((type): [string, StrapConfig] => [
      `homebrew editor, ${type}`,
      buildHomebrewEditorStrap({
        type,
        cancel: noop,
        save: noop,
        markdownHelp: noop,
        busy: false,
        canSave: true,
        note: 'Unsaved changes',
      }),
    ]),
    ...[
      'shell.strap.library-no-hero',
      'shell.strap.library-cantrip',
      'shell.strap.library-already-prepared',
      'shell.strap.library-no-prepare',
      'shell.strap.library-not-known',
    ].map((reason): [string, StrapConfig] => [
      `library entry, Add to hero unavailable (${reason})`,
      buildLibraryDetailStrap({
        back: noop,
        add: { kind: 'spell', run: noop, reason },
        locked: false,
        copy: { run: noop, unavailable: 'shell.strap.library-no-clipboard' },
        openPack: null,
      }),
    ]),
  ];

  it.each(cases)('%s', async (_name, config) => {
    const text = readable(await render(config));
    expect(text).not.toMatch(RAW_KEY);
    const labels = [...config.primary, ...(config.secondary ?? [])] as StrapAction[];
    expect(labels.length).toBeGreaterThan(0);
  });

  it('library entry without a hero context shows only Back', async () => {
    const config = buildLibraryDetailStrap({
      back: noop,
      add: null,
      locked: false,
      copy: { run: noop, unavailable: null },
      openPack: null,
    });
    const text = readable(await render(config));
    expect(text).not.toMatch(RAW_KEY);
    expect(text).toContain('Back');
    expect(config.primary).toEqual([]);
  });
  it('a missing hero context outranks the edit lock as the reason Add to hero is unavailable', () => {
    const state = {
      back: noop,
      copy: { run: noop, unavailable: null },
      openPack: null,
    };
    const noHero = buildLibraryDetailStrap({
      ...state,
      add: { kind: 'item', run: noop, reason: 'shell.strap.library-no-hero' },
      locked: true,
    });
    expect(noHero.primary[0]?.disabledReason).toBe('shell.strap.library-no-hero');

    const locked = buildLibraryDetailStrap({
      ...state,
      add: { kind: 'item', run: noop, reason: null },
      locked: true,
    });
    expect(locked.primary[0]?.disabledReason).toBe('shell.strap.edit-locked');
  });
});
