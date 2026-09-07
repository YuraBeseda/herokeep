import { TestBed } from '@angular/core/testing';
import { provideTransloco, TranslocoService, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { LocaleService } from '@shared/services/i18n/locale.service';

const STORAGE_KEY = 'hk.locale';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({});
  }
}

function configureTestBed(): void {
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
    ],
  });
}

describe('LocaleService', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    configureTestBed();
  });

  it('defaults to en with empty storage', () => {
    const service = TestBed.inject(LocaleService);
    TestBed.tick();
    expect(service.locale()).toBe('en');
    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('en');
  });

  it('exposes contentLocale as the same signal that drives the UI locale', () => {
    const service = TestBed.inject(LocaleService);
    TestBed.tick();
    expect(service.contentLocale()).toBe(service.locale());
  });

  it('setLocale persists to storage and switches the active Transloco lang, without reload', () => {
    const service = TestBed.inject(LocaleService);
    service.setLocale('ru');
    TestBed.tick();
    expect(service.locale()).toBe('ru');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('ru');
    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('ru');
  });

  it('stamps document.documentElement.lang with the active locale', () => {
    const service = TestBed.inject(LocaleService);
    service.setLocale('uk');
    TestBed.tick();
    expect(document.documentElement.lang).toBe('uk');
  });

  it('falls back to en when the stored locale is not a valid locale', () => {
    localStorage.setItem(STORAGE_KEY, 'fr');
    const service = TestBed.inject(LocaleService);
    TestBed.tick();
    expect(service.locale()).toBe('en');
  });

  it('resumes the stored locale on initialization', () => {
    localStorage.setItem(STORAGE_KEY, 'uk');
    const service = TestBed.inject(LocaleService);
    TestBed.tick();
    expect(service.locale()).toBe('uk');
    expect(TestBed.inject(TranslocoService).getActiveLang()).toBe('uk');
  });
});
