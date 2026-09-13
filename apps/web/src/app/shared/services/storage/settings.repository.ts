import { inject, Injectable } from '@angular/core';
import { uuidv7 } from '../../helpers/uuid';
import { HkDb } from './dexie.db';

const DEVICE_ID_KEY = 'deviceId';

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

  /**
   * This install's stable per-device id (Task 16/plan-5: the event envelope's `actor.deviceId`)
   * — get-or-create, generated once with `uuidv7` and persisted under a fixed settings key so it
   * survives across sessions and every `CharacterStore` instance shares the same value.
   */
  async deviceId(): Promise<string> {
    const existing = await this.get<string>(DEVICE_ID_KEY);
    if (existing !== undefined) return existing;
    const id = uuidv7();
    await this.set(DEVICE_ID_KEY, id);
    return id;
  }
}
