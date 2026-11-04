import { effect, Injectable, signal, type Signal } from '@angular/core';
import { THEME_IDS, type ThemeId } from '@hk/ui-tokens/themes';

export type Theme = ThemeId;

const STORAGE_KEY = 'hk.theme';
const DEFAULT_THEME: Theme = 'tavern';

/** Values stored before the tavern/scroll/plain themes existed. */
const LEGACY_THEMES: Readonly<Record<string, Theme>> = { dark: 'tavern', light: 'scroll' };

function isTheme(value: string): value is Theme {
  return (THEME_IDS as readonly string[]).includes(value);
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    if (isTheme(stored)) return stored;
    return LEGACY_THEMES[stored] ?? null;
  } catch {
    return null;
  }
}

function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private browsing, disabled storage, quota, etc.) */
  }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  // Properties
  private readonly themeState = signal<Theme>(readStoredTheme() ?? DEFAULT_THEME);
  readonly theme: Signal<Theme> = this.themeState.asReadonly();

  // I/O boundary: stamps the active theme onto <html> and persists it whenever it changes.
  // (Persisting on the first run also rewrites a migrated legacy value as its new name.)
  private readonly stampAndPersist = effect(() => {
    const theme = this.themeState();
    document.documentElement.dataset['theme'] = theme;
    persistTheme(theme);
  });

  // Methods
  setTheme(theme: Theme): void {
    this.themeState.set(theme);
  }

  /** Quick switch between the two decorated themes; plain returns to the default. */
  toggle(): void {
    this.themeState.set(this.themeState() === 'tavern' ? 'scroll' : 'tavern');
  }
}
