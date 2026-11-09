import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { routes } from '../../app.routes';
import settingsEn from '../../../assets/i18n/settings/en.json';
import { SettingsComponent } from './settings.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'settings/en' ? settingsEn : {});
  }
}

/** The real route table: the redirect is what is under test, so nothing here is a copy of it. */
async function open(url: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideTransloco({
        config: {
          availableLangs: ['en'],
          defaultLang: 'en',
          prodMode: true,
          reRenderOnLangChange: true,
        },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, SettingsComponent);
  harness.detectChanges();
  await harness.fixture.whenStable();
  return harness;
}

describe('Settings routing', () => {
  const scrolled: Element[] = [];
  // jsdom has no scrollIntoView; remember whatever is there so the prototype is left as found.
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeEach(() => {
    scrolled.length = 0;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  });

  afterEach(() => {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('/about redirects to /settings#about and lands on the visible About & licences section', async () => {
    const harness = await open('/about');

    expect(TestBed.inject(Router).url).toBe('/settings#about');
    const about = harness.routeNativeElement!.querySelector<HTMLElement>('#about');
    expect(about).not.toBeNull();
    expect(about!.closest('[hidden]')).toBeNull();
    expect(getComputedStyle(about!).display).not.toBe('none');
    expect(about!.textContent).toContain(settingsEn.about.title);
    // The view scrolled that very section into place and the index marks it current.
    expect(scrolled).toContain(about);
    const current = harness.routeNativeElement!.querySelectorAll(
      '.settings__index a[aria-current]',
    );
    expect(Array.from(current).map((a) => (a as HTMLElement).dataset['section'])).toEqual([
      'about',
    ]);
  });

  it('an index link moves the fragment, scrolls to its section and takes over aria-current', async () => {
    const harness = await open('/settings');
    expect(scrolled).toEqual([]);

    const link = harness.routeNativeElement!.querySelector<HTMLAnchorElement>(
      '.settings__index a[data-section="packs"]',
    )!;
    link.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/settings#packs');
    expect(scrolled.map((el) => el.id)).toEqual(['packs']);
    const current = harness.routeNativeElement!.querySelectorAll(
      '.settings__index a[aria-current]',
    );
    expect(Array.from(current).map((a) => (a as HTMLElement).dataset['section'])).toEqual([
      'packs',
    ]);
  });

  it('moves focus to the section heading the redirect lands on, for keyboard and screen-reader users', async () => {
    const harness = await open('/about');

    const heading = harness.routeNativeElement!.querySelector<HTMLElement>('#about h2')!;
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
  });

  it('clicking the link of the section already shown scrolls to it again', async () => {
    const harness = await open('/settings#packs');
    const link = harness.routeNativeElement!.querySelector<HTMLAnchorElement>(
      '.settings__index a[data-section="packs"]',
    )!;
    scrolled.length = 0;

    link.click();
    await harness.fixture.whenStable();

    expect(scrolled.map((el) => el.id)).toEqual(['packs']);
  });
});
