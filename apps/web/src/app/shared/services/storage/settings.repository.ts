import { inject, Injectable } from '@angular/core';
import { HkDb } from './dexie.db';

/** Minimal key/value persistence used by settings-facing stores (Task 13). */
@Injectable({ providedIn: 'root' })
export class SettingsRepository {
  private readonly db = inject(HkDb);

  // Methods
  async get<T>(key: string): Promise<T | undefined> {
    const row = await this.db.settings.get(key);
    return row?.value as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
  }
}
