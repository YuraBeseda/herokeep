/**
 * `localStorage` reads and writes that never throw: private browsing, disabled storage or a full
 * quota just mean "nothing stored" and "not saved". Shared by the per-device preferences
 * (`ThemeService`, `DisplayPrefsService`).
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private browsing, disabled storage, quota, etc.) */
  }
}
