import { effect, inject, Injectable, signal, type Signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';

export type Locale = 'en' | 'ru' | 'uk';

const STORAGE_KEY = 'hk.locale';
const AVAILABLE_LOCALES: readonly Locale[] = ['en', 'ru', 'uk'];

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (AVAILABLE_LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage unavailable (private browsing, disabled storage, quota, etc.) */
  }
}

// Picks the first of the browser's preferred languages (in order) whose primary subtag
// (`ru-RU` -> `ru`) is one of our available locales.
function matchBrowserLocale(): Locale | null {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of languages) {
    const primary = tag?.split('-')[0]?.toLowerCase();
    if (isLocale(primary)) {
      return primary;
    }
  }
  return null;
}

function resolveInitialLocale(): Locale {
  return readStoredLocale() ?? matchBrowserLocale() ?? 'en';
}

@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly translocoService = inject(TranslocoService);

  // Properties
  private readonly localeState = signal<Locale>(resolveInitialLocale());
  readonly locale: Signal<Locale> = this.localeState.asReadonly();
  // One signal drives both the UI locale and the content (rules-text) locale.
  readonly contentLocale: Signal<Locale> = this.locale;

  // I/O boundary: persists the active locale, switches Transloco's active lang (no page reload),
  // and stamps <html lang> whenever the locale changes.
  private readonly persistAndActivate = effect(() => {
    const locale = this.localeState();
    persistLocale(locale);
    this.translocoService.setActiveLang(locale);
    document.documentElement.lang = locale;
  });

  // Methods
  setLocale(locale: Locale): void {
    this.localeState.set(locale);
  }
}
