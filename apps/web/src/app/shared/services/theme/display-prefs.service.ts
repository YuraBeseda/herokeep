import { readStored, writeStored } from '../../helpers/safe-storage';
import { effect, Injectable, signal, type Signal } from '@angular/core';

/** How tall the sheet's list rows are: 28 px (compact) or 36 px (comfortable). */
export type Density = 'compact' | 'comfortable';

const DENSITY_KEY = 'hk.density';
const MOTION_KEY = 'hk.motion';
const DENSITIES: readonly Density[] = ['compact', 'comfortable'];

function readDensity(): Density {
  const stored = readStored(DENSITY_KEY);
  return DENSITIES.find((d) => d === stored) ?? 'compact';
}

/** Whether the system asks for reduced motion (`prefers-reduced-motion: reduce`). */
function systemWantsReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Motion follows the person's explicit choice when one is stored; with none, it follows the system
 * (ruling R60): off for someone whose system asks for reduced motion, on otherwise.
 */
function readMotion(): boolean {
  const stored = readStored(MOTION_KEY);
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return !systemWantsReducedMotion();
}

/**
 * The two Appearance choices that sit beside the theme (Settings, board ST01): row density and
 * motion. Both are per-device conveniences kept in `localStorage` (like the theme and the
 * language) and stamped on `<html>` as `data-density` / `data-motion`; a stylesheet rule turns
 * motion off when `data-motion="off"`. With no stored motion choice the default follows the
 * system's reduced-motion request.
 */
@Injectable({ providedIn: 'root' })
export class DisplayPrefsService {
  private readonly densityState = signal<Density>(readDensity());
  private readonly motionState = signal<boolean>(readMotion());

  readonly density: Signal<Density> = this.densityState.asReadonly();
  /** Whether animation is allowed (`true`) or switched off (`false`). */
  readonly motion: Signal<boolean> = this.motionState.asReadonly();

  // I/O boundary: stamps the choices onto <html>. Nothing is persisted here: a value is stored
  // only when the person changes it (below), so an untouched default keeps following the system.
  private readonly stamp = effect(() => {
    document.documentElement.dataset['density'] = this.densityState();
    document.documentElement.dataset['motion'] = this.motionState() ? 'on' : 'off';
  });

  setDensity(density: Density): void {
    this.densityState.set(density);
    writeStored(DENSITY_KEY, density);
  }

  setMotion(on: boolean): void {
    this.motionState.set(on);
    writeStored(MOTION_KEY, on ? 'on' : 'off');
  }
}
