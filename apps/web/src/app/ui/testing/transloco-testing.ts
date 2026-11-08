import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import shellEn from '../../../assets/i18n/shell/en.json';
import shellRu from '../../../assets/i18n/shell/ru.json';
import shellUk from '../../../assets/i18n/shell/uk.json';

class ShellLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'shell/en') return of(shellEn);
    if (langPath === 'shell/ru') return of(shellRu);
    if (langPath === 'shell/uk') return of(shellUk);
    return of({});
  }
}

/** Transloco wired to the real `shell` bundles, for specs of the `ui/` components. */
export function provideShellTransloco() {
  return [provideShellTranslocoCore(), provideTranslocoMessageformat()];
}

function provideShellTranslocoCore() {
  return provideTransloco({
    config: {
      availableLangs: ['en', 'ru', 'uk'],
      defaultLang: 'en',
      fallbackLang: 'en',
      reRenderOnLangChange: true,
      prodMode: true,
    },
    loader: ShellLoader,
  });
}
