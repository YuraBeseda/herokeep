import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import charactersEn from '../../../assets/i18n/characters/en.json';
import charactersRu from '../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../assets/i18n/characters/uk.json';
import shellEn from '../../../assets/i18n/shell/en.json';
import shellRu from '../../../assets/i18n/shell/ru.json';
import shellUk from '../../../assets/i18n/shell/uk.json';

const BUNDLES: Record<string, unknown> = {
  'characters/en': charactersEn,
  'characters/ru': charactersRu,
  'characters/uk': charactersUk,
  'shell/en': shellEn,
  'shell/ru': shellRu,
  'shell/uk': shellUk,
};

class Loader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of((BUNDLES[langPath] ?? {}) as Record<string, unknown>);
  }
}

/** Transloco wired to the real `characters` and `shell` bundles, for the Home / heroes-list specs. */
export function provideCharactersTransloco() {
  return [
    provideTransloco({
      config: {
        availableLangs: ['en', 'ru', 'uk'],
        defaultLang: 'en',
        fallbackLang: 'en',
        reRenderOnLangChange: true,
        prodMode: true,
      },
      loader: Loader,
    }),
    provideTranslocoMessageformat(),
  ];
}
