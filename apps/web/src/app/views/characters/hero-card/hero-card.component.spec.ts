import { TestBed } from '@angular/core/testing';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import { HkDb, type CharacterRow } from '@shared/services/storage/dexie.db';
import { press } from '../../../ui/testing/harness';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import { provideCharactersTransloco } from '../transloco-testing';
import type { HeroSummary } from '../hero-summary.service';
import { HeroCardComponent } from './hero-card.component';

const ROW: CharacterRow = {
  id: 'char:00000000-0000-4000-8000-000000000001',
  name: 'Ilyana Vorn',
  system: 'srd-5e-2024',
  archived: false,
  updatedAt: Date.UTC(2026, 9, 25, 20, 14),
};
const SUMMARY: HeroSummary = {
  classes: [
    { classId: 'srd:class/fighter', level: 3 },
    { classId: 'srd:class/rogue', level: 1 },
  ],
  campaign: { id: 'camp-1', name: 'The Emberfall Company' },
};

async function mount(inputs: Record<string, unknown> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideCharactersTransloco(),
      {
        provide: EngineFacade,
        useValue: { localizer: () => ({ name: (id: string) => id.split('/').pop() }) },
      },
    ],
  });
  const fixture = TestBed.createComponent(HeroCardComponent);
  fixture.componentRef.setInput('row', ROW);
  fixture.componentRef.setInput('summary', SUMMARY);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, el, settle };
}

const q = <T extends Element>(el: ParentNode, sel: string) => el.querySelector<T>(sel);

describe('HeroCardComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(HkDb).close();
  });

  it('shows the name, the class line and the campaign chip', async () => {
    const { el } = await mount();
    expect(q(el, '.hero-card__name')?.textContent?.trim()).toBe('Ilyana Vorn');
    expect(q(el, '.hero-card__classes')?.textContent?.trim()).toBe('fighter 3 · rogue 1');
    expect(q(el, '.hero-card__campaign')?.textContent).toContain('The Emberfall Company');
  });

  it('falls back to the system id when the classes are unknown, and shows no campaign chip', async () => {
    const { el } = await mount({ summary: undefined });
    expect(q(el, '.hero-card__classes')?.textContent?.trim()).toBe('srd-5e-2024');
    expect(q(el, '.hero-card__campaign')).toBeNull();
  });

  it('shows when the hero was last played, in the active locale', async () => {
    const { el } = await mount();
    const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(ROW.updatedAt);
    expect(q(el, '.hero-card__played')?.textContent?.trim()).toBe(`Last played ${date}`);
  });

  it('the Open button names the hero with every value the card shows', async () => {
    const { el } = await mount();
    const open = q<HTMLButtonElement>(el, '.hero-card__open')!;
    expect(open.textContent?.trim()).toBe('Open');
    expect(open.getAttribute('aria-label')).toBe(
      'Open Ilyana Vorn, fighter 3 · rogue 1, The Emberfall Company',
    );
  });

  it('pressing Open emits `opened`', async () => {
    const { fixture, el } = await mount();
    const opened = vi.fn();
    fixture.componentInstance.opened.subscribe(opened);
    press(q(el, '.hero-card__open')!);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('a long name is ellipsised with its full text in a hint', async () => {
    const long = 'Ярослава-Милослава Гостомисловна Золотоволоса-Вишнева';
    const { el } = await mount({ row: { ...ROW, name: long } });
    vi.useFakeTimers();
    q(el, '.hero-card__name')!.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(400);
    expect(document.body.querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(long);
  });

  describe('portrait', () => {
    it('shows the monogram when there is no thumb', async () => {
      const { el } = await mount();
      expect(q(el, 'hk-portrait-frame')?.textContent).toContain('IV');
      expect(q(el, 'hk-portrait-frame img')).toBeNull();
    });

    it('shows the thumb once its blob resolves', async () => {
      URL.createObjectURL = vi.fn(() => 'blob:thumb');
      URL.revokeObjectURL = vi.fn();
      const hash = `sha256:${'a'.repeat(64)}`;
      const { fixture, el } = await mount();
      await TestBed.inject(BlobsRepository).put(hash, 'image/webp', new Uint8Array([1]), {
        kind: 'thumb',
        width: 256,
        height: 256,
      });
      fixture.componentRef.setInput('row', { ...ROW, portraitThumbHash: hash });
      for (let i = 0; i < 20 && !q(el, 'hk-portrait-frame img'); i++) {
        await new Promise((r) => setTimeout(r, 0));
        fixture.detectChanges();
      }
      expect(q(el, 'hk-portrait-frame img')?.getAttribute('src')).toBe('blob:thumb');
    });
  });

  describe('sync state', () => {
    it('is absent without a state', async () => {
      const { el } = await mount();
      expect(q(el, '.hero-card__sync')).toBeNull();
    });

    it('is a chip with a word, exposed as data and as the accessible name', async () => {
      const { el } = await mount({ sync: { bucket: 'synced', count: 0 } });
      const sync = q(el, '.hero-card__sync')!;
      expect(sync.getAttribute('data-sync-state')).toBe('synced');
      expect(sync.getAttribute('aria-label')).toBe(charactersEn.list.sync.tooltip.synced);
      expect(sync.textContent?.trim()).toBe(charactersEn.list.sync.tooltip.synced);
    });

    it('says how many changes are pending, in the word and the name', async () => {
      const { el } = await mount({ sync: { bucket: 'pending', count: 4 } });
      const sync = q(el, '.hero-card__sync')!;
      expect(sync.getAttribute('data-sync-state')).toBe('pending');
      expect(sync.getAttribute('aria-label')).toBe('4 changes pending');
      expect(sync.textContent).toContain('4 changes pending');
    });
  });

  describe('more menu', () => {
    it('is not offered unless the screen asks for it', async () => {
      const { el } = await mount();
      expect(q(el, '.hero-card__more')).toBeNull();
    });

    it('opens on press, naming the hero, with Delete as the only item', async () => {
      const { el, settle } = await mount({ menu: true });
      const more = q<HTMLButtonElement>(el, '.hero-card__more')!;
      expect(more.getAttribute('aria-label')).toBe('More actions for Ilyana Vorn');
      expect(more.getAttribute('aria-expanded')).toBe('false');
      expect(q(el, '[role="menu"]')).toBeNull();

      press(more);
      await settle();

      expect(more.getAttribute('aria-expanded')).toBe('true');
      const items = Array.from(el.querySelectorAll('[role="menuitem"]'));
      expect(items.map((i) => i.textContent?.trim())).toEqual([charactersEn.list.delete]);
    });

    it('Escape closes it and returns focus to the button', async () => {
      const { el, settle } = await mount({ menu: true });
      document.body.append(el);
      const more = q<HTMLButtonElement>(el, '.hero-card__more')!;
      press(more);
      await settle();
      q<HTMLElement>(el, '[role="menuitem"]')!.focus();

      q(el, '[role="menu"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await settle();

      expect(q(el, '[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(more);
      el.remove();
    });

    it('a press outside closes it', async () => {
      const { el, settle } = await mount({ menu: true });
      press(q(el, '.hero-card__more')!);
      await settle();
      expect(q(el, '[role="menu"]')).not.toBeNull();

      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await settle();

      expect(q(el, '[role="menu"]')).toBeNull();
    });

    it('a press inside the card keeps it open', async () => {
      const { el, settle } = await mount({ menu: true });
      press(q(el, '.hero-card__more')!);
      await settle();
      q(el, '[role="menu"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await settle();
      expect(q(el, '[role="menu"]')).not.toBeNull();
    });

    it('Delete emits `deleteRequested` and closes the menu', async () => {
      const { fixture, el, settle } = await mount({ menu: true });
      const requested = vi.fn();
      fixture.componentInstance.deleteRequested.subscribe(requested);
      press(q(el, '.hero-card__more')!);
      await settle();

      press(q(el, '[role="menuitem"]')!);
      await settle();

      expect(requested).toHaveBeenCalledTimes(1);
      expect(q(el, '[role="menu"]')).toBeNull();
    });

    it('Delete is disabled while the screen is busy', async () => {
      const { fixture, el, settle } = await mount({ menu: true, busy: true });
      const requested = vi.fn();
      fixture.componentInstance.deleteRequested.subscribe(requested);
      press(q(el, '.hero-card__more')!);
      await settle();
      const item = q<HTMLButtonElement>(el, '[role="menuitem"]')!;
      expect(item.disabled).toBe(true);
      press(item);
      expect(requested).not.toHaveBeenCalled();
    });
  });
});
