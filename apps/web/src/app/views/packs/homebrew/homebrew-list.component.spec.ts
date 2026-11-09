import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HomebrewService } from '@shared/services/packs/homebrew.service';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { HkpackDelivery } from '@shared/services/packs/hkpack-delivery';
import {
  HkpackAssetsMissingError,
  HkpackWriter,
} from '@shared/services/packs/hkpack-writer.service';
import { PackUsageService } from '../pack-usage.service';

const deliver = vi.fn().mockResolvedValue('saved');
import { HomebrewNewChooserComponent } from './homebrew-new-chooser.component';
import packsEn from '../../../../assets/i18n/packs/en.json';
import { HomebrewDeleteConfirmComponent, HomebrewListComponent } from './homebrew-list.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'packs/en' ? packsEn : {});
  }
}

const base = { tags: [], prerequisites: [], effects: [], grants: [], choices: [] };
const parsed = parsePack({
  format: 1,
  id: 'homebrew-aaaaaaaa',
  version: '0.1.3',
  kind: 'content',
  system: '5e-2024',
  name: 'My homebrew',
  dependencies: [{ id: 'srd-5e-2024', range: '^0.1.0' }],
  entities: [
    {
      ...base,
      type: 'item',
      id: 'homebrew-aaaaaaaa:item/coral-knife',
      name: 'Coral Knife',
      category: 'gear',
    },
    { ...base, type: 'item', id: 'homebrew-aaaaaaaa:item/shell', name: 'Shell', category: 'gear' },
    {
      ...base,
      type: 'species',
      id: 'homebrew-aaaaaaaa:species/tidekin',
      name: 'Tidekin',
      size: 'medium',
      speed: 30,
      creatureType: 'humanoid',
    },
  ],
});
if (!parsed.ok) throw new Error('homebrew list fixture does not parse');
const PACK: Pack = parsed.pack;

async function setup(
  confirm: unknown,
  updateCheckFailed = false,
  heroes: { id: string; name: string; pins: Record<string, string> }[] = [],
  extra: { writer?: unknown; pack?: Pack } = {},
) {
  const remove = vi.fn().mockResolvedValue({
    pack: PACK,
    diagnostics: [],
    fastForwarded: ['char:a'],
    pending: ['char:b'],
    updateCheckFailed,
  });
  const open = vi.fn((..._args: unknown[]) => ({
    closed: Promise.resolve(confirm),
    close: vi.fn(),
  }));
  const show = vi.fn();
  TestBed.configureTestingModule({
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
        provide: HomebrewService,
        useValue: { pack: signal<Pack | null>(extra.pack ?? PACK), remove },
      },
      { provide: HkpackDelivery, useValue: { deliver } },
      ...(extra.writer ? [{ provide: HkpackWriter, useValue: extra.writer }] : []),
      { provide: DialogService, useValue: { open } },
      { provide: PackUsageService, useValue: { heroPins: () => Promise.resolve(heroes) } },
      {
        provide: EngineFacade,
        useValue: {
          index: () => ({ byType: () => [] }),
          localizer: () => ({ name: (id: string) => id }),
        },
      },
      { provide: ToastService, useValue: { show } },
    ],
  });
  const fixture = TestBed.createComponent(HomebrewListComponent);
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }
  return { fixture, root: fixture.nativeElement as HTMLElement, remove, open, show };
}

const settle = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await fixture.whenStable();
};

describe('HomebrewListComponent', () => {
  it('groups the pack entities by type in item/spell/feat/species order, with edit links and New links', async () => {
    const { root } = await setup(false);

    const groups = [...root.querySelectorAll<HTMLElement>('.hb-list__group')];
    expect(groups.map((g) => g.dataset['type'])).toEqual(['item', 'spell', 'feat', 'species']);
    const names = (g: HTMLElement) =>
      [...g.querySelectorAll('.hb-list__name')].map((n) => n.textContent?.trim());
    expect(names(groups[0])).toEqual(['Coral Knife', 'Shell']);
    expect(names(groups[1])).toEqual([]);
    expect(groups[1].querySelector('.hb-list__empty')?.textContent?.trim()).toBe(
      packsEn.homebrew.empty,
    );
    expect(names(groups[3])).toEqual(['Tidekin']);
    expect(groups[0].querySelector('.hb-list__heading')?.textContent?.trim()).toBe(
      `${packsEn['entity-type'].item} · 2`,
    );

    const edit = groups[3].querySelector<HTMLAnchorElement>('.hb-list__edit');
    expect(edit?.getAttribute('href')).toBe('/packs/homebrew/edit/species/tidekin');
    expect(edit?.getAttribute('aria-label')).toBe('Edit Tidekin');
    const newLinks = [...root.querySelectorAll<HTMLAnchorElement>('.hb-list__new-link')];
    expect(newLinks.map((a) => a.getAttribute('href'))).toEqual([
      '/packs/homebrew/new/item',
      '/packs/homebrew/new/spell',
      '/packs/homebrew/new/feat',
      '/packs/homebrew/new/species',
    ]);
    expect(root.querySelector('.hb-list__version')?.textContent).toContain('0.1.3');
  });

  it('reads the facts of each entry under its name and shows the heroes that pin the pack', async () => {
    const { root } = await setup(false, false, [
      { id: 'char:a', name: 'Aria', pins: { 'homebrew-aaaaaaaa': '0.1.0' } },
      { id: 'char:b', name: 'Brann', pins: { 'homebrew-aaaaaaaa': '0.1.3' } },
      { id: 'char:c', name: 'Cora', pins: {} },
    ]);
    const sub = (id: string) =>
      root.querySelector(`[data-entity-id="${id}"] .hb-list__sub`)?.textContent ?? '';
    expect(sub('homebrew-aaaaaaaa:item/coral-knife')).toContain(
      packsEn.homebrew.enum.category.gear,
    );
    expect(sub('homebrew-aaaaaaaa:species/tidekin')).toContain('30 ft');
    const users = [...root.querySelectorAll('.hb-list__user')];
    expect(users.map((u) => u.querySelector('strong')?.textContent)).toEqual(['Aria', 'Brann']);
    expect(users[0].textContent).toContain('an update waits on Build');
    expect(users[1].textContent).not.toContain('an update waits on Build');
    expect(root.querySelector('.hb-list__count')?.textContent).toContain('3 entries');
    expect(root.querySelector('.hb-list__count')?.textContent).toContain('used by 2 heroes');
  });

  it('the strap has Back, New (the type chooser) and Export; Export is disabled without a pack', async () => {
    const { open } = await setup(false);
    const config = TestBed.inject(ActionStrapService).config()!;
    expect(config.exit?.map((a) => a.id)).toEqual(['back']);
    expect(config.primary.map((a) => a.id)).toEqual(['new-entry']);
    expect(config.secondary?.map((a) => a.id)).toEqual(['import-entries', 'export-pack']);
    expect(config.secondary?.[1].disabled).toBe(false);

    open.mockReturnValue({ closed: Promise.resolve('feat'), close: vi.fn() });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    config.primary[0].run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(open).toHaveBeenCalledWith(HomebrewNewChooserComponent);
    expect(navigate).toHaveBeenCalledWith(['/packs/homebrew/new', 'feat']);
  });

  it('draws Import into My homebrew disabled, with its reason on the action', async () => {
    await setup(false);
    const action = TestBed.inject(ActionStrapService)
      .config()!
      .secondary!.find((a) => a.id === 'import-entries')!;
    expect(action.disabled).toBe(true);
    expect(action.disabledReason).toBe('shell.strap.homebrew-import-none');
  });

  it('Export hands the built archive to the delivery ladder; failures toast their reason', async () => {
    const blob = new Blob(['zip']);
    const exportFn = vi
      .fn()
      .mockResolvedValueOnce({ blob, fileName: 'homebrew-aaaaaaaa-0.1.3.hkpack' })
      .mockRejectedValueOnce(new HkpackAssetsMissingError('homebrew-aaaaaaaa@0.1.3'))
      .mockRejectedValueOnce(new Error('disk'));
    const { show } = await setup(false, false, [], { writer: { export: exportFn } });
    const exportAction = () =>
      TestBed.inject(ActionStrapService)
        .config()!
        .secondary!.find((a) => a.id === 'export-pack')!;
    expect(exportAction().disabled).toBe(false);

    exportAction().run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deliver).toHaveBeenCalledWith(blob, 'homebrew-aaaaaaaa-0.1.3.hkpack', 'My homebrew');
    expect(show).not.toHaveBeenCalled();

    exportAction().run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(show).toHaveBeenLastCalledWith('packs.export-assets-missing');
    exportAction().run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(show).toHaveBeenLastCalledWith('packs.export-failed');
  });

  it('reads a spell as a cantrip or a level, with a plural-aware casting time and the class list', async () => {
    const spell = (slug: string, level: number, value: number, unit: string) => ({
      ...base,
      type: 'spell',
      id: `homebrew-aaaaaaaa:spell/${slug}`,
      name: slug,
      level,
      school: 'evocation',
      castingTime: { value, unit },
      range: { kind: 'touch' },
      components: { v: true, s: false, m: false },
      duration: { kind: 'instantaneous' },
      concentration: false,
      ritual: false,
      classes: ['wizard'],
    });
    const parsedSpells = parsePack({
      format: 1,
      id: 'homebrew-aaaaaaaa',
      version: '0.1.0',
      kind: 'content',
      system: '5e-2024',
      name: 'My homebrew',
      dependencies: [{ id: 'srd-5e-2024', range: '^0.1.0' }],
      entities: [spell('spark', 0, 1, 'action'), spell('ward', 3, 10, 'minute')],
    });
    if (!parsedSpells.ok) throw new Error('spell fixture does not parse');
    const { root } = await setup(false, false, [], { pack: parsedSpells.pack });
    const sub = (slug: string) =>
      root.querySelector(`[data-entity-id="homebrew-aaaaaaaa:spell/${slug}"] .hb-list__sub`)
        ?.textContent ?? '';
    expect(sub('spark')).toContain('Cantrip, evocation');
    expect(sub('spark')).toContain('1 action');
    expect(sub('ward')).toContain('Level 3, evocation');
    expect(sub('ward')).toContain('10 minutes');
  });

  it('uses the tooltip directive instead of native titles and names its icon-only Edit link', async () => {
    const { root } = await setup(false);
    expect(root.querySelectorAll('.hb-list [title]')).toHaveLength(0);
    const edit = root.querySelector('.hb-list__edit')!;
    expect(edit.getAttribute('aria-label')).toBe('Edit Coral Knife');
  });

  it('Delete asks for confirmation; Cancel deletes nothing', async () => {
    const { fixture, root, open, remove } = await setup(false);

    root
      .querySelector<HTMLButtonElement>(
        '[data-entity-id="homebrew-aaaaaaaa:item/shell"] .hb-list__delete',
      )!
      .click();
    await settle(fixture);

    expect(open).toHaveBeenCalledWith(HomebrewDeleteConfirmComponent, { data: { name: 'Shell' } });
    expect(remove).not.toHaveBeenCalled();
  });

  it('a confirmed Delete removes the entity and toasts the updated and pending counts', async () => {
    const { fixture, root, remove, show } = await setup(true);

    root
      .querySelector<HTMLButtonElement>(
        '[data-entity-id="homebrew-aaaaaaaa:item/shell"] .hb-list__delete',
      )!
      .click();
    await settle(fixture);
    await settle(fixture);

    expect(remove).toHaveBeenCalledWith('homebrew-aaaaaaaa:item/shell');
    expect(show).toHaveBeenCalledWith('packs.homebrew.removed', { updated: 1 });
    expect(show).toHaveBeenCalledWith('packs.homebrew.pending', { count: 1 });
    expect(show).not.toHaveBeenCalledWith('packs.homebrew.update-check-failed');
  });

  it('a Delete whose update check failed adds the update-check note', async () => {
    const { fixture, root, show } = await setup(true, true);

    root
      .querySelector<HTMLButtonElement>(
        '[data-entity-id="homebrew-aaaaaaaa:item/shell"] .hb-list__delete',
      )!
      .click();
    await settle(fixture);
    await settle(fixture);

    expect(show).toHaveBeenCalledWith('packs.homebrew.removed', { updated: 1 });
    expect(show).toHaveBeenCalledWith('packs.homebrew.update-check-failed');
  });
});
