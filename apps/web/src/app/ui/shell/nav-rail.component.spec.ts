import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '@shared/services/auth/auth.service';
import { hintOf, press } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { ShellCampaignContext, type ShellCampaign } from './campaign-context.service';
import { HkNavRailComponent } from './nav-rail.component';

@Component({ template: '' })
class Stub {}

async function setup(opts: { user?: string; campaign?: ShellCampaign | null } = {}) {
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
          status: signal(opts.user ? 'authed' : 'anon'),
          user: signal(opts.user ? { userId: 'u1', username: opts.user } : null),
        },
      },
      { provide: ShellCampaignContext, useValue: { current: signal(opts.campaign ?? null) } },
    ],
  }).compileComponents();
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/campaigns');
  const fixture = TestBed.createComponent(HkNavRailComponent);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement, router };
}

describe('HkNavRailComponent', () => {
  it('is the primary navigation landmark', async () => {
    const { el } = await setup();
    expect(el.querySelector('nav')!.getAttribute('aria-label')).toBe('Primary navigation');
  });

  it('has the six sections, in order, as named links to their routes', async () => {
    const { el } = await setup();
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav a.hk-rail__link'));
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Home',
      'Heroes',
      'Campaigns',
      'Library',
      'Packs',
      'Settings',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/',
      '/characters',
      '/campaigns',
      '/library',
      '/packs',
      '/settings',
    ]);
  });

  it('marks only the current section', async () => {
    const { el } = await setup();
    const current = Array.from(el.querySelectorAll('nav a.hk-rail__link')).filter(
      (a) => a.getAttribute('aria-current') === 'page',
    );
    expect(current.map((a) => a.getAttribute('aria-label'))).toEqual(['Campaigns']);
  });

  it('shows each section name as a hint on keyboard focus', async () => {
    const { el } = await setup();
    const library = el.querySelector('nav a[aria-label="Library"]')!;
    expect(hintOf(library)).toBe('Library');
  });

  it('navigates on a real click', async () => {
    const { fixture, el, router } = await setup();
    press(el.querySelector('nav a[aria-label="Library"]')!);
    await fixture.whenStable();
    expect(router.url).toBe('/library');
  });

  it('keeps About reachable at /about', async () => {
    const { el } = await setup();
    expect(el.querySelector('a[href="/about"]')!.getAttribute('aria-label')).toBe('About');
  });

  describe('account button', () => {
    it('is a Log in link to /login while signed out', async () => {
      const { el } = await setup();
      const link = el.querySelector<HTMLAnchorElement>('a.app-shell__login-link')!;
      expect(link.getAttribute('href')).toBe('/login');
      expect(link.getAttribute('aria-label')).toBe('Log in');
    });

    it('goes to /settings and names the user while signed in', async () => {
      const { el } = await setup({ user: 'alice' });
      expect(el.querySelector('a.app-shell__login-link')).toBeNull();
      const link = el.querySelector<HTMLAnchorElement>('a.hk-rail__account')!;
      expect(link.getAttribute('href')).toBe('/settings');
      expect(link.getAttribute('aria-label')).toBe('Account: alice');
    });
  });

  describe('campaign chip', () => {
    it('is absent without a campaign context', async () => {
      const { el } = await setup();
      expect(el.querySelector('.hk-rail__campaign')).toBeNull();
    });

    it('links to the campaign, named, with the full name as its hint', async () => {
      const { el } = await setup({ campaign: { id: 'c9', name: 'The Emberfall Company' } });
      const chip = el.querySelector<HTMLAnchorElement>('a.hk-rail__campaign')!;
      expect(chip.getAttribute('href')).toBe('/g/c9');
      expect(chip.getAttribute('aria-label')).toBe('Campaign: The Emberfall Company');
      expect(hintOf(chip)).toBe('Campaign: The Emberfall Company');
    });

    it('falls back to a plain Campaign label while the name is unknown', async () => {
      const { el } = await setup({ campaign: { id: 'c9', name: null } });
      expect(el.querySelector('a.hk-rail__campaign')!.getAttribute('aria-label')).toBe('Campaign');
    });
  });
});
