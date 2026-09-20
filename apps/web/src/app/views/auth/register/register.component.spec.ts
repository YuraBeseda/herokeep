import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import authEn from '../../../../assets/i18n/auth/en.json';
import { RegisterComponent } from './register.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'auth/en') return of(authEn);
    return of({});
  }
}

describe('RegisterComponent', () => {
  it('renders the /register heading through the real auth scope (proves the i18n scope wiring)', async () => {
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

    const fixture = TestBed.createComponent(RegisterComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.register__title')?.textContent?.trim()).toBe(
      authEn.register.title,
    );
  });
});
