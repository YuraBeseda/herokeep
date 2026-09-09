import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { UpdateService } from '@shared/services/pwa/update.service';
import { App } from './app';
import { routes } from './app.routes';
import shellEn from '../assets/i18n/shell/en.json';

function configureTestBed(): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      // Same rationale as app.spec.ts: `UpdateService` needs `SwUpdate`, which needs a real
      // service-worker registration this route test doesn't set up. `UpdateService` itself is
      // covered by its own spec.
      { provide: UpdateService, useValue: { updateAvailable: signal(false), activate: vi.fn() } },
    ],
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { en: {}, 'shell/en': shellEn },
        translocoConfig: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        preloadLangs: true,
      }),
    ],
  });
}

describe('app routes', () => {
  beforeEach(() => configureTestBed());

  it.each(['/', '/library', '/library/goblin', '/settings', '/about'])(
    'resolves %s without error',
    async (url) => {
      const harness = await RouterTestingHarness.create(url);
      expect(harness.routeNativeElement).toBeTruthy();
    },
  );

  it('renders the shell nav with 4 routerLink anchors using the real translations', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const links = compiled.querySelectorAll<HTMLAnchorElement>('a[routerLink]');
    expect(links.length).toBe(4);
    // Compare against the imported JSON, not re-typed literals, so this cannot drift from the
    // real translation file — a typo'd key or an unresolved scope would render the raw key
    // string instead and fail this assertion.
    const actual = Array.from(links).map((link) => link.textContent?.trim());
    expect(actual).toEqual([
      shellEn.nav.home,
      shellEn.nav.library,
      shellEn.nav.settings,
      shellEn.nav.about,
    ]);
  });

  it('mounts the home route inside the shell and renders its content', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const tagline = compiled.querySelector('app-home .home__tagline');
    expect(tagline?.textContent?.trim()).toBe(shellEn.home.tagline);
  });
});
