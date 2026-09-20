import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import authEn from '../../../../assets/i18n/auth/en.json';
import { RecoverComponent } from './recover.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'auth/en') return of(authEn);
    return of({});
  }
}

describe('RecoverComponent', () => {
  it('renders the /recover heading through the real auth scope (proves the i18n scope wiring)', async () => {
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

    const fixture = TestBed.createComponent(RecoverComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.recover__title')?.textContent?.trim()).toBe(
      authEn.recover.title,
    );
  });
});
