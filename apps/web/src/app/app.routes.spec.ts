import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { App } from './app';
import { routes } from './app.routes';
import shellEn from '../assets/i18n/shell/en.json';

function configureTestBed(): void {
  TestBed.configureTestingModule({
    providers: [provideRouter(routes)],
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

  it('renders the shell nav with 4 routerLink anchors', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const links = compiled.querySelectorAll('a[routerLink]');
    expect(links.length).toBe(4);
  });

  it('mounts the home route inside the shell and renders its content', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-home .home__tagline')).toBeTruthy();
  });
});
