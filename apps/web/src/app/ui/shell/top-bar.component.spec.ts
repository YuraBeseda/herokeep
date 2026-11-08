import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '@shared/services/auth/auth.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { press } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkTopBarComponent } from './top-bar.component';

@Component({ template: '' })
class Stub {}

async function setup(user?: string) {
  const setLocale = vi.fn();
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [
      provideShellTransloco(),
      provideRouter(
        ['', 'characters', 'campaigns', 'library', 'settings', 'packs', 'about', 'login'].map(
          (path) => ({ path, component: Stub }),
        ),
      ),
      {
        provide: AuthService,
        useValue: {
          status: signal(user ? 'authed' : 'anon'),
          user: signal(user ? { userId: 'u1', username: user } : null),
        },
      },
      { provide: LocaleService, useValue: { locale: signal('en'), setLocale } },
    ],
  }).compileComponents();
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/library');
  const fixture = TestBed.createComponent(HkTopBarComponent);
  fixture.componentRef.setInput('title', 'Library');
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, el, router, settle, setLocale };
}

const folio = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button.hk-topbar__folio')!;
const drawer = (el: HTMLElement) => el.querySelector('[role="dialog"]');

describe('HkTopBarComponent', () => {
  it('shows the screen title and a folio button that opens the menu', async () => {
    const { el } = await setup();
    expect(el.querySelector('.hk-topbar__title')!.textContent?.trim()).toBe('Library');
    expect(folio(el).getAttribute('aria-label')).toBe('Open the menu');
    expect(folio(el).getAttribute('aria-expanded')).toBe('false');
    expect(drawer(el)).toBeNull();
  });

  it('gives an ellipsised title its full text as a hint', async () => {
    const { el } = await setup();
    expect(el.querySelector('.hk-topbar__title')!.getAttribute('aria-label')).toBeNull();
    // The title is a heading-less paragraph; the full text is the tooltip source.
    expect(el.querySelector('.hk-topbar__title')!.hasAttribute('aria-describedby')).toBe(true);
  });

  describe('drawer', () => {
    it('opens on a real press: six sections in order, account, theme and language', async () => {
      const { el, settle } = await setup();
      press(folio(el));
      await settle();
      const panel = drawer(el)!;
      expect(folio(el).getAttribute('aria-expanded')).toBe('true');
      expect(panel.getAttribute('aria-label')).toBe('Menu');
      const sections = Array.from(panel.querySelectorAll('a.hk-drawer__section'));
      expect(sections.map((a) => a.textContent?.trim())).toEqual([
        'Home',
        'Heroes',
        'Campaigns',
        'Library',
        'Packs',
        'Settings',
      ]);
      expect(sections.map((a) => a.getAttribute('aria-current'))).toEqual([
        null,
        null,
        null,
        'page',
        null,
        null,
      ]);
      expect(panel.querySelector('a.hk-drawer__account')!.getAttribute('href')).toBe('/login');
      expect(panel.querySelector('[role="radiogroup"]')).not.toBeNull();
      expect(
        Array.from(panel.querySelectorAll('.hk-drawer__language button')).map((b) =>
          b.textContent?.trim(),
        ),
      ).toEqual(['English', 'Русский', 'Українська']);
    });

    it('links About and the signed-in account', async () => {
      const { el, settle } = await setup('alice');
      press(folio(el));
      await settle();
      const panel = drawer(el)!;
      expect(panel.querySelector('a[href="/about"]')).not.toBeNull();
      const account = panel.querySelector('a.hk-drawer__account')!;
      expect(account.getAttribute('href')).toBe('/settings');
      expect(account.textContent).toContain('alice');
    });

    it('switches the language through LocaleService', async () => {
      const { el, settle, setLocale } = await setup();
      press(folio(el));
      await settle();
      press(el.querySelectorAll<HTMLButtonElement>('.hk-drawer__language button')[1]);
      expect(setLocale).toHaveBeenCalledWith('ru');
    });

    it('closes on Escape and gives focus back to the folio button', async () => {
      const { el, settle } = await setup();
      document.body.append(el);
      folio(el).focus();
      press(folio(el));
      await settle();
      drawer(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(drawer(el)).toBeNull();
      expect(document.activeElement).toBe(folio(el));
      el.remove();
    });

    it('closes with the same control that opened it', async () => {
      const { el, settle } = await setup();
      press(folio(el));
      await settle();
      press(folio(el));
      await settle();
      expect(drawer(el)).toBeNull();
    });

    it('closes on a pointer press outside and removes its document listener', async () => {
      const remove = vi.spyOn(document, 'removeEventListener');
      const { el, settle } = await setup();
      press(folio(el));
      await settle();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await settle();
      expect(drawer(el)).toBeNull();
      expect(remove.mock.calls.some(([type]) => type === 'pointerdown')).toBe(true);
      remove.mockRestore();
    });

    it('does not close on a press inside the panel', async () => {
      const { el, settle } = await setup();
      press(folio(el));
      await settle();
      drawer(el)!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await settle();
      expect(drawer(el)).not.toBeNull();
    });

    it('closes after following a section link', async () => {
      const { el, router, settle } = await setup();
      press(folio(el));
      await settle();
      press(el.querySelector('a.hk-drawer__section[href="/packs"]')!);
      await settle();
      await new Promise((r) => setTimeout(r));
      await settle();
      expect(router.url).toBe('/packs');
      expect(drawer(el)).toBeNull();
    });
  });
});
