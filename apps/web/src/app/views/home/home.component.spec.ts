import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { emptyFacts, ENGINE_VERSION } from '@hk/engine';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HeroReaderService, type ImportResult } from '@shared/services/export/hero-reader.service';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { HkDb, type CharacterRow } from '@shared/services/storage/dexie.db';
import { SettingsRepository } from '@shared/services/storage/settings.repository';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';
import { ActionStrapService } from '../../ui/action-strap/action-strap.service';
import { press } from '../../ui/testing/harness';
import shellEn from '../../../assets/i18n/shell/en.json';
import { provideCharactersTransloco } from '../characters/transloco-testing';
import { HomeComponent } from './home.component';

const ILYANA = 'char:00000000-0000-4000-8000-000000000001';
const BRAMBLE = 'char:00000000-0000-4000-8000-000000000002';
const MAREN = 'char:00000000-0000-4000-8000-000000000003';

function mkRow(id: string, name: string, updatedAt: number): CharacterRow {
  return { id, name, system: 'srd-5e-2024', archived: false, updatedAt };
}

const importFn = vi.fn();

async function setup(
  options: {
    heroes?: CharacterRow[];
    lastOpened?: string;
    campaigns?: { id: string; name: string; role: 'dm' | 'player' }[];
    classes?: { id: string; classId: string; level: number }[];
  } = {},
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideCharactersTransloco(),
      provideRouter([]),
      { provide: HeroReaderService, useValue: { import: importFn } },
      {
        provide: EngineFacade,
        useValue: { localizer: () => ({ name: (id: string) => id.split('/').pop() }) },
      },
    ],
  });
  const db = TestBed.inject(HkDb);
  await Promise.all([
    db.settings.clear(),
    db.characters.clear(),
    db.snapshots.clear(),
    db.events.clear(),
    db.campaigns.clear(),
    db.blobs.clear(),
  ]);
  await db.characters.bulkPut(options.heroes ?? []);
  if (options.lastOpened) {
    await TestBed.inject(SettingsRepository).setLastOpened(options.lastOpened, 5000);
  }
  for (const c of options.classes ?? []) {
    const facts = emptyFacts(c.id);
    facts.classes = [{ classId: c.classId, level: c.level }];
    await TestBed.inject(SnapshotsRepository).put(c.id, {
      seq: 1,
      facts,
      engineVersion: ENGINE_VERSION,
    });
  }
  for (const c of options.campaigns ?? []) {
    await TestBed.inject(CampaignsRepository).put({
      ...c,
      system: 'srd-5e-2024',
      lastSeq: 0,
      updatedAt: 1,
    });
  }
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(HomeComponent);
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await fixture.whenStable();
    }
  };
  await settle();
  return { fixture, el: fixture.nativeElement as HTMLElement, navigate, settle };
}

const strap = (id: string) => {
  const config = TestBed.inject(ActionStrapService).config();
  return [...(config?.primary ?? []), ...(config?.secondary ?? [])].find((a) => a.id === id);
};
const q = <T extends Element>(el: ParentNode, sel: string) => el.querySelector<T>(sel);

describe('HomeComponent', () => {
  afterEach(() => TestBed.inject(HkDb).close());

  describe('first run (no heroes)', () => {
    it('invites the user to start, instead of a Continue leaf', async () => {
      const { el } = await setup();
      expect(q(el, '.home__continue')).toBeNull();
      const invitation = q(el, '.home__invitation')!;
      expect(invitation.textContent).toContain(shellEn.home.invitation.title);
      expect(invitation.textContent).toContain(shellEn.home.invitation.body);
      expect(q(el, '.home__heroes')).toBeNull();
    });

    it('puts New hero, Import and Join by code in the strap, in that order', async () => {
      await setup();
      const config = TestBed.inject(ActionStrapService).config();
      expect(config?.primary.map((a) => a.id)).toEqual(['new-hero', 'import', 'join-code']);
      expect(config?.primary.map((a) => a.label)).toEqual([
        'shell.strap.new-hero',
        'shell.strap.import',
        'shell.strap.join-code',
      ]);
    });
  });

  describe('with heroes', () => {
    const heroes = [
      mkRow(ILYANA, 'Ilyana Vorn', 3000),
      mkRow(BRAMBLE, 'Bramble Underfoot', 2000),
      mkRow(MAREN, 'Sister Maren', 1000),
    ];

    it('Continue shows the hero that was opened last, not the newest', async () => {
      const { el } = await setup({ heroes, lastOpened: MAREN });
      const cont = q(el, '.home__continue')!;
      expect(q(cont, '.home__continue-name')?.textContent?.trim()).toBe('Sister Maren');
      expect(q(el, '.home__invitation')).toBeNull();
    });

    it('Continue falls back to the most recently changed hero when none was opened yet', async () => {
      const { el } = await setup({ heroes });
      expect(q(el, '.home__continue-name')?.textContent?.trim()).toBe('Ilyana Vorn');
    });

    it('Continue is hidden, and the rest of Home still works, when the last opened hero was deleted', async () => {
      const { el } = await setup({ heroes, lastOpened: 'char:deleted' });
      expect(q(el, '.home__continue')).toBeNull();
      expect(el.querySelectorAll('.home__heroes app-hero-card').length).toBe(3);
    });

    it('Continue shows the class line and Open goes to the sheet', async () => {
      const { el, navigate } = await setup({
        heroes,
        lastOpened: ILYANA,
        classes: [{ id: ILYANA, classId: 'srd:class/cleric', level: 4 }],
      });
      expect(q(el, '.home__continue-classes')?.textContent?.trim()).toBe('cleric 4');

      press(q(el, '.home__continue-open')!);

      expect(navigate).toHaveBeenCalledWith(['/c', ILYANA]);
    });

    it('the Open button names the hero with the class line', async () => {
      const { el } = await setup({ heroes, lastOpened: ILYANA });
      expect(q(el, '.home__continue-open')?.getAttribute('aria-label')).toBe(
        'Open Ilyana Vorn, srd-5e-2024',
      );
    });

    it('lists the heroes as cards, newest first, and All heroes goes to the list', async () => {
      const { el, navigate } = await setup({ heroes, lastOpened: ILYANA });
      const names = Array.from(el.querySelectorAll('.home__heroes .hero-card__name')).map((n) =>
        n.textContent?.trim(),
      );
      expect(names).toEqual(['Ilyana Vorn', 'Bramble Underfoot', 'Sister Maren']);

      press(q(el, '.home__heroes-all')!);
      expect(navigate).toHaveBeenCalledWith(['/characters']);
    });

    it('opening a hero card goes to its sheet', async () => {
      const { el, navigate } = await setup({ heroes });
      press(el.querySelectorAll('.home__heroes .hero-card__open')[1]);
      expect(navigate).toHaveBeenCalledWith(['/c', BRAMBLE]);
    });

    it('shows no Tonight slip (no live-session signal is available to Home)', async () => {
      const { el } = await setup({ heroes, lastOpened: ILYANA });
      expect(q(el, '.home__tonight')).toBeNull();
    });
  });

  describe('campaigns', () => {
    it('lists each campaign with the role of the user in it, and a press opens it', async () => {
      const { el, navigate } = await setup({
        campaigns: [
          { id: 'c1', name: 'The Emberfall Company', role: 'dm' },
          { id: 'c2', name: 'Tombs of the Salt King', role: 'player' },
        ],
      });
      const rows = Array.from(el.querySelectorAll('.home__campaign'));
      expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        expect.stringContaining('The Emberfall Company'),
        expect.stringContaining('Tombs of the Salt King'),
      ]);
      expect(rows[0].textContent).toContain(shellEn.home.campaigns.role.dm);
      expect(rows[1].textContent).toContain(shellEn.home.campaigns.role.player);

      press(rows[1].querySelector('button')!);
      expect(navigate).toHaveBeenCalledWith(['/g', 'c2']);
    });

    it('shows no campaigns row when the user has none', async () => {
      const { el } = await setup();
      expect(q(el, '.home__campaigns')).toBeNull();
    });

    it('All campaigns goes to the campaigns list', async () => {
      const { el, navigate } = await setup({
        campaigns: [{ id: 'c1', name: 'The Emberfall Company', role: 'dm' }],
      });
      press(q(el, '.home__campaigns-all')!);
      expect(navigate).toHaveBeenCalledWith(['/campaigns']);
    });
  });

  describe('strap actions', () => {
    it('New hero goes to the wizard', async () => {
      const { navigate } = await setup();
      strap('new-hero')!.run();
      expect(navigate).toHaveBeenCalledWith(['/characters/new']);
    });

    it('Join by code goes to /join', async () => {
      const { navigate } = await setup();
      strap('join-code')!.run();
      expect(navigate).toHaveBeenCalledWith(['/join']);
    });

    it('Import opens the .hero file picker, and a picked file is imported and shown', async () => {
      const result: ImportResult = {
        characterId: MAREN,
        name: 'Sister Maren',
        mode: 'created',
        imported: 2,
        skippedDuplicates: 0,
        warnings: [],
      };
      importFn.mockImplementationOnce(async () => {
        await TestBed.inject(HkDb).characters.put(mkRow(MAREN, 'Sister Maren', 9000));
        return result;
      });
      const { el, settle } = await setup();
      const input = q<HTMLInputElement>(el, '.home__import-input')!;
      expect(input.getAttribute('accept')).toBe('.hero');
      const click = vi.spyOn(input, 'click');

      strap('import')!.run();
      expect(click).toHaveBeenCalledTimes(1);

      Object.defineProperty(input, 'files', {
        value: [new File([new Uint8Array([1])], 'maren.hero')],
        configurable: true,
      });
      input.dispatchEvent(new Event('change'));
      await settle();

      expect(importFn).toHaveBeenCalledTimes(1);
      expect(q(el, '.home__continue-name')?.textContent?.trim()).toBe('Sister Maren');
    });

    it('has no zone 3 on Home and keeps no strap after the screen closes', async () => {
      const { fixture } = await setup();
      expect(TestBed.inject(ActionStrapService).config()?.secondary ?? []).toEqual([]);
      fixture.destroy();
      expect(TestBed.inject(ActionStrapService).config()).toBeNull();
    });
  });

  it('offers the Library as a quick action', async () => {
    const { el, navigate } = await setup();
    press(q(el, '.home__library')!);
    expect(navigate).toHaveBeenCalledWith(['/library']);
  });
});
