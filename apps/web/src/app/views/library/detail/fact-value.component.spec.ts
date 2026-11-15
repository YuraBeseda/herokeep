import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import libraryEn from '../../../../assets/i18n/library/en.json';
import libraryRu from '../../../../assets/i18n/library/ru.json';
import libraryUk from '../../../../assets/i18n/library/uk.json';
import { LocaleService } from '@shared/services/i18n/locale.service';
import type { FactValue } from '../../../ui/entity-facts/entity-facts.formatters';
import { FactValueComponent } from './fact-value.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'library/en') return of(libraryEn);
    if (langPath === 'library/ru') return of(libraryRu);
    if (langPath === 'library/uk') return of(libraryUk);
    return of({});
  }
}

async function render(lang: string, value: FactValue) {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['en', 'ru', 'uk'], defaultLang: 'en', prodMode: true },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
    ],
  });
  TestBed.inject(LocaleService).setLocale(lang as 'en' | 'ru' | 'uk');
  const fixture = TestBed.createComponent(FactValueComponent);
  fixture.componentRef.setInput('value', value);
  await fixture.whenStable();
  return (fixture.nativeElement as HTMLElement).textContent?.trim();
}

describe('FactValueComponent', () => {
  afterEach(() => localStorage.removeItem('hk.locale'));

  it('shows plain text as it is', async () => {
    expect(await render('en', { kind: 'text', text: '2 gp' })).toBe('2 gp');
  });

  const weight: FactValue = { kind: 'key', key: 'fact.unit.lb', params: { value: 3 } };

  it('resolves a keyed unit in English', async () => {
    expect(await render('en', weight)).toBe('3 lb');
  });

  it('resolves a keyed unit with its plural form in Russian', async () => {
    expect(await render('ru', weight)).toBe('3 фунта');
  });

  it('resolves a keyed unit with its plural form in Ukrainian', async () => {
    expect(await render('uk', weight)).toBe('3 фунти');
  });
});
