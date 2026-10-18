import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { PackRemoveDependentsError, PackStore } from '@shared/stores/pack.store';
import packsEn from '../../../assets/i18n/packs/en.json';
import sampleJson from '../../../testing/fixtures/packs/sample-content.json';
import { PackDetailComponent, PackRemoveConfirmComponent } from './pack-detail.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'packs/en') return of(packsEn);
    return of({});
  }
}

const SAMPLE_KEY = 'sample-content@1.0.0';

function samplePack(): Pack {
  const parsed = parsePack(sampleJson);
  if (!parsed.ok) throw new Error('sample-content.json fixture no longer parses');
  return parsed.pack;
}

const CORE = {
  ...samplePack(),
  id: 'srd-5e-2024',
  version: '0.1.0',
  name: 'SRD 5.2.1',
  dependencies: [],
  assets: [],
  entities: [],
} as Pack;

let nextEventId = 1;
function mkEvent(stream: string, type: string, payload: unknown): Event {
  const id = `00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  return {
    id,
    stream,
    ts: '2026-10-18T00:00:00.000Z',
    actor: { userId: 'local', deviceId: 'dev_1', role: 'owner' },
    type,
    v: 1,
    payload,
  };
}

/** Seeds a stored character whose event log creates it (core pinned) and then appends `extra`. */
async function seedCharacter(name: string, extra: (stream: string) => Event[]): Promise<void> {
  const stream = `char:00000000-0000-4000-8000-${String(nextEventId++).padStart(12, '0')}`;
  await TestBed.inject(CharactersRepository).put({
    id: stream,
    name,
    system: 'srd-5e-2024',
    archived: false,
    updatedAt: 1000,
  });
  await TestBed.inject(EventsRepository).append([
    mkEvent(stream, 'character.created', {
      name,
      system: 'srd-5e-2024',
      engineVersion: '0.0.0',
      corePack: { id: 'srd-5e-2024', version: '0.1.0' },
    }),
    ...extra(stream),
  ]);
}

const pinSample = (stream: string) => [
  mkEvent(stream, 'pack.pinned', { packId: 'sample-content', version: '1.0.0' }),
];

async function setup(
  key: string,
  options: { confirm?: unknown; dependents?: Pack[]; removeError?: unknown } = {},
) {
  const removeContent =
    options.removeError === undefined
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(options.removeError);
  const dependentsOf = vi.fn(() => options.dependents ?? []);
  const open = vi.fn(() => ({ closed: Promise.resolve(options.confirm), close: vi.fn() }));
  const show = vi.fn();
  const paramMap = convertToParamMap({ key });

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
      { provide: ActivatedRoute, useValue: { paramMap: of(paramMap), snapshot: { paramMap } } },
      {
        provide: PackStore,
        useValue: {
          corePack: signal<Pack | undefined>(CORE),
          installedContent: signal<Pack[]>([samplePack()]),
          removeContent,
          dependentsOf,
        },
      },
      { provide: DialogService, useValue: { open } },
      { provide: ToastService, useValue: { show } },
      {
        provide: MarkdownService,
        useValue: { render: (markdown: string) => Promise.resolve(markdown) },
      },
      { provide: LocaleService, useValue: { locale: signal('en') } },
    ],
  });

  const db = TestBed.inject(HkDb);
  await Promise.all([db.characters.clear(), db.events.clear(), db.snapshots.clear()]);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  return { removeContent, open, show, navigate };
}

async function render() {
  const fixture = TestBed.createComponent(PackDetailComponent);
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe('PackDetailComponent', () => {
  it('shows the pack information and how many stored characters pin it', async () => {
    await setup(SAMPLE_KEY);
    await seedCharacter('Aria', pinSample);
    await seedCharacter('Brann', pinSample);
    // Pinned, then opted out — not counted.
    await seedCharacter('Cora', (stream) => [
      ...pinSample(stream),
      mkEvent(stream, 'pack.unpinned', { packId: 'sample-content' }),
    ]);
    // A different version of the same pack — not counted.
    await seedCharacter('Dain', (stream) => [
      mkEvent(stream, 'pack.pinned', { packId: 'sample-content', version: '0.9.0' }),
    ]);
    await seedCharacter('Edda', () => []);

    const { root } = await render();

    expect(root.querySelector('.pack-detail__title')?.textContent).toContain('Sample content');
    expect(root.querySelector('.pack-info__license')?.textContent).toContain('CC-BY-4.0');
    expect(root.querySelector('.pack-detail__used-by')?.textContent?.trim()).toBe(
      'Used by 2 characters',
    );
    expect(root.querySelector('.pack-detail__remove')).not.toBeNull();
  });

  it('Remove asks for confirmation, then removes the pack and navigates to /packs', async () => {
    const { removeContent, open, navigate, show } = await setup(SAMPLE_KEY, { confirm: true });
    await seedCharacter('Aria', pinSample);
    await seedCharacter('Brann', pinSample);
    const { fixture, root } = await render();

    root.querySelector<HTMLButtonElement>('.pack-detail__remove')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(open).toHaveBeenCalledWith(PackRemoveConfirmComponent, {
      data: { name: 'Sample content', count: 2 },
    });
    expect(removeContent).toHaveBeenCalledWith(SAMPLE_KEY);
    expect(show).toHaveBeenCalledWith('packs.remove-success');
    expect(navigate).toHaveBeenCalledWith(['/packs']);
  });

  it('a cancelled confirmation removes nothing', async () => {
    const { removeContent, navigate } = await setup(SAMPLE_KEY, { confirm: false });
    const { fixture, root } = await render();

    root.querySelector<HTMLButtonElement>('.pack-detail__remove')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(removeContent).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lists the installed packs that depend on it and disables Remove', async () => {
    const addon = {
      ...samplePack(),
      id: 'sample-addon',
      name: 'Sample add-on',
      dependencies: [{ id: 'sample-content', range: '^1.0.0' }],
    } as Pack;
    const { removeContent } = await setup(SAMPLE_KEY, { confirm: true, dependents: [addon] });
    const { fixture, root } = await render();

    expect(root.querySelector('.pack-detail__dependents')?.textContent?.trim()).toBe(
      '1 installed pack depends on this pack. Remove it first.',
    );
    expect(
      [...root.querySelectorAll('.pack-detail__dependent')].map((li) => li.textContent?.trim()),
    ).toEqual(['Sample add-on 1.0.0']);
    const remove = root.querySelector<HTMLButtonElement>('.pack-detail__remove')!;
    expect(remove.disabled).toBe(true);
    remove.click();
    await fixture.whenStable();
    expect(removeContent).not.toHaveBeenCalled();
  });

  it('a removal the store refuses for dependents shows the dependents toast', async () => {
    const { show, navigate } = await setup(SAMPLE_KEY, {
      confirm: true,
      removeError: new PackRemoveDependentsError(SAMPLE_KEY, ['sample-addon@1.0.0']),
    });
    const { fixture, root } = await render();

    root.querySelector<HTMLButtonElement>('.pack-detail__remove')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(show).toHaveBeenCalledWith('packs.remove-failed-dependents');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('the core pack has no Remove action', async () => {
    await setup('srd-5e-2024@0.1.0');
    const { root } = await render();

    expect(root.querySelector('.pack-detail__title')?.textContent).toContain('SRD 5.2.1');
    expect(root.querySelector('.pack-detail__remove')).toBeNull();
    expect(root.querySelector('.pack-detail__core-note')?.textContent?.trim()).toBe(
      packsEn.detail['core-note'],
    );
  });

  it('an unknown key shows the not-found state', async () => {
    await setup('nope@1.0.0');
    const { root } = await render();
    expect(root.querySelector('.pack-detail__not-found')?.textContent?.trim()).toBe(
      packsEn.detail['not-found'],
    );
    expect(root.querySelector('.pack-detail__remove')).toBeNull();
  });
});

describe('PackRemoveConfirmComponent', () => {
  function configure(count: number) {
    const close = vi.fn();
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
        { provide: DIALOG_DATA, useValue: { name: 'Sample content', count } },
        { provide: DialogRef, useValue: { close } },
      ],
    });
    return { close };
  }

  it('warns that pinning characters will show unresolved references', async () => {
    const { close } = configure(2);
    const fixture = TestBed.createComponent(PackRemoveConfirmComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-dialog-title]')?.textContent).toContain('Sample content');
    expect(root.querySelector('.pack-remove-confirm__body')?.textContent?.trim()).toBe(
      '2 characters use this pack. After removal they will show unresolved references until you reinstall it.',
    );

    root.querySelector<HTMLButtonElement>('.pack-remove-confirm__confirm')!.click();
    expect(close).toHaveBeenCalledWith(true);
  });

  it('Cancel closes with false', async () => {
    const { close } = configure(0);
    const fixture = TestBed.createComponent(PackRemoveConfirmComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    root.querySelector<HTMLButtonElement>('.pack-remove-confirm__cancel')!.click();
    expect(close).toHaveBeenCalledWith(false);
  });
});
