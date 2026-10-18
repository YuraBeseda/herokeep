import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { HomebrewService } from '@shared/services/packs/homebrew.service';
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

async function setup(confirm: unknown) {
  const remove = vi.fn().mockResolvedValue({
    pack: PACK,
    diagnostics: [],
    fastForwarded: ['char:a'],
    pending: ['char:b'],
  });
  const open = vi.fn(() => ({ closed: Promise.resolve(confirm), close: vi.fn() }));
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
      { provide: HomebrewService, useValue: { pack: signal<Pack | null>(PACK), remove } },
      { provide: DialogService, useValue: { open } },
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
      packsEn['entity-type'].item,
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
  });
});
