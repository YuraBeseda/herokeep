import { inject, Injectable, signal, type Signal } from '@angular/core';
import { cryptoRng } from '../engine/rng';
import { SettingsRepository } from '../storage/settings.repository';

/**
 * Device-unique homebrew pack ids (plan 15 ruling 10 as amended in Task 7 fix round 1): every
 * device authors its own homebrew line, `homebrew-<8 lowercase hex>`, generated once and persisted
 * in settings. Another device's homebrew pack (arriving inside a `.hero`) is then an ordinary
 * installed content pack under ITS id and can never replace or be merged into this device's line;
 * its entity ids (`<packId>:<type>/<slug>`) never collide with ours either.
 */
export const HOMEBREW_PACK_PREFIX = 'homebrew-';
/** Settings key holding this device's homebrew pack id. */
export const HOMEBREW_PACK_ID_KEY = 'homebrewPackId';

const HOMEBREW_PACK_ID_RE = /^homebrew-[0-9a-f]{8}$/;

/** Whether `id` is a homebrew pack id (this device's or another device's). */
export function isHomebrewPackId(id: string): boolean {
  return HOMEBREW_PACK_ID_RE.test(id);
}

/** A fresh `homebrew-<8 hex>` id from the app's crypto RNG (`cryptoRng`, never the engine). */
export function newHomebrewPackId(rng: () => number = cryptoRng): string {
  const value = Math.floor(rng() * 2 ** 32) >>> 0;
  return `${HOMEBREW_PACK_PREFIX}${value.toString(16).padStart(8, '0')}`;
}

/**
 * This device's homebrew pack id: read (or generated and persisted) once, from construction on.
 * `id()` is `null` until that first settings read resolves; `ensure()` awaits it.
 */
@Injectable({ providedIn: 'root' })
export class HomebrewIdService {
  private readonly settingsRepository = inject(SettingsRepository);

  private readonly idState = signal<string | null>(null);
  readonly id: Signal<string | null> = this.idState.asReadonly();

  private readonly loading: Promise<string> = this.load();

  constructor() {
    // A failed settings read surfaces through `ensure()` (a save refuses); never unhandled here.
    this.loading.catch(() => undefined);
  }

  /** This device's homebrew pack id, generating and persisting it on first use. */
  ensure(): Promise<string> {
    return this.loading;
  }

  // I/O boundary: get-or-create under `HOMEBREW_PACK_ID_KEY`. A stored value that is not a valid
  // homebrew id (e.g. dev data from before the device-unique ruling) is replaced.
  private async load(): Promise<string> {
    const stored = await this.settingsRepository.get<string>(HOMEBREW_PACK_ID_KEY);
    let id = stored;
    if (id === undefined || !isHomebrewPackId(id)) {
      id = newHomebrewPackId();
      await this.settingsRepository.set(HOMEBREW_PACK_ID_KEY, id);
    }
    this.idState.set(id);
    return id;
  }
}
