import { effect, Injectable, signal, type Signal } from '@angular/core';

/** How tall the sheet's list rows are: 28 px (compact) or 36 px (comfortable). */
export type Density = 'compact' | 'comfortable';

const DENSITY_KEY = 'hk.density';
const MOTION_KEY = 'hk.motion';
const DENSITIES: readonly Density[] = ['compact', 'comfortable'];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private browsing, disabled storage, quota, etc.) */
  }
}

function readDensity(): Density {
  const stored = read(DENSITY_KEY);
  return DENSITIES.find((d) => d === stored) ?? 'compact';
}

/** Motion is on unless the person switched it off; anything else stored is ignored. */
function readMotion(): boolean {
  return read(MOTION_KEY) !== 'off';
}

/**
 * The two Appearance choices that sit beside the theme (Settings, board ST01): row density and
 * motion. Both are per-device conveniences kept in `localStorage` (like the theme and the
 * language) and stamped on `<html>` as `data-density` / `data-motion`; a stylesheet rule turns
 * motion off when `data-motion="off"`. The system's own reduced-motion request is honoured by the
 * components' media queries whatever this says.
 */
@Injectable({ providedIn: 'root' })
export class DisplayPrefsService {
  private readonly densityState = signal<Density>(readDensity());
  private readonly motionState = signal<boolean>(readMotion());

  readonly density: Signal<Density> = this.densityState.asReadonly();
  /** Whether animation is allowed (`true`) or switched off (`false`). */
  readonly motion: Signal<boolean> = this.motionState.asReadonly();

  // I/O boundary: stamps the choices onto <html> and persists them whenever they change.
  private readonly stampAndPersist = effect(() => {
    const density = this.densityState();
    const motion = this.motionState() ? 'on' : 'off';
    document.documentElement.dataset['density'] = density;
    document.documentElement.dataset['motion'] = motion;
    write(DENSITY_KEY, density);
    write(MOTION_KEY, motion);
  });

  setDensity(density: Density): void {
    this.densityState.set(density);
  }

  setMotion(on: boolean): void {
    this.motionState.set(on);
  }
}
