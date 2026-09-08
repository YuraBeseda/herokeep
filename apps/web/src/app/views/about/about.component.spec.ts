import { TestBed } from '@angular/core/testing';
import { ATTRIBUTION } from '@hk/content/attribution';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import aboutEn from '../../../assets/i18n/about/en.json';
import aboutRu from '../../../assets/i18n/about/ru.json';
import aboutUk from '../../../assets/i18n/about/uk.json';
import shellEn from '../../../assets/i18n/shell/en.json';
import authors from '../../../assets/icons/authors.json';
import { AboutComponent } from './about.component';

// The legal-attribution.md "Third-party assets and their notices" table's open5e row, copied
// verbatim (also see about/en.json's `open5e.credit`, which must match this exactly).
const OPEN5E_CREDIT = 'Structured SRD data derived from the Open5e project (https://open5e.com).';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'about/en') return of(aboutEn);
    if (langPath === 'about/ru') return of(aboutRu);
    if (langPath === 'about/uk') return of(aboutUk);
    if (langPath === 'shell/en') return of(shellEn);
    return of({});
  }
}

function configure() {
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
    ],
  });
}

describe('AboutComponent', () => {
  it('renders the SRD attribution EXACTLY as imported from @hk/content/attribution — not a copy', async () => {
    configure();
    const fixture = TestBed.createComponent(AboutComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.querySelector('.about__srd-attribution')?.textContent?.trim();

    expect(ATTRIBUTION.length).toBeGreaterThan(50); // guards against a hollowed-out fixture
    expect(text).toBe(ATTRIBUTION);
  });

  it('the game-icons credit line contains a humanized author from the real authors.json', async () => {
    configure();
    const fixture = TestBed.createComponent(AboutComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.querySelector('.about__icons-credit')?.textContent ?? '';

    expect((authors as readonly string[]).length).toBeGreaterThan(0);
    const [firstSlug] = authors as readonly string[];
    const humanized = firstSlug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    expect(text).toContain(humanized);
    expect(text).toContain('https://game-icons.net');
    expect(text).toContain('CC BY 3.0');
  });

  it('renders the open5e credit line verbatim', async () => {
    configure();
    const fixture = TestBed.createComponent(AboutComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const text = compiled.querySelector('.about__open5e-credit')?.textContent?.trim();

    expect(text).toBe(OPEN5E_CREDIT);
  });

  it('shows the app name and version', async () => {
    configure();
    const fixture = TestBed.createComponent(AboutComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.about__app-name')?.textContent?.trim()).toBe('Herokeep');
    expect(compiled.querySelector('.about__version')?.textContent).toContain('0.1.0');
  });
});
