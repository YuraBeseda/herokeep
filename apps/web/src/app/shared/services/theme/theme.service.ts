import { effect, Injectable, signal, type Signal } from '@angular/core';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'hk.theme';

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : null;
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
  private readonly themeState = signal<Theme>(readStoredTheme() ?? 'dark');
  readonly theme: Signal<Theme> = this.themeState.asReadonly();

  // I/O boundary: stamps the active theme onto <html> and persists it whenever it changes.
  private readonly stampAndPersist = effect(() => {
    const theme = this.themeState();
    document.documentElement.dataset['theme'] = theme;
    persistTheme(theme);
  });

  // Methods
  setTheme(theme: Theme): void {
    this.themeState.set(theme);
  }

  toggle(): void {
    this.themeState.set(this.themeState() === 'dark' ? 'light' : 'dark');
  }
}
