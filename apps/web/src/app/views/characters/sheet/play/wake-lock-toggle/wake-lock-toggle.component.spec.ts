import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WakeLockService } from '@shared/services/pwa/wake-lock.service';
import { configureReal, resetDb } from '../play-spec-support';
import { WakeLockToggleComponent } from './wake-lock-toggle.component';
import { HkDb } from '@shared/services/storage/dexie.db';

// `WakeLockService` itself (request / re-acquire on visibilitychange / release against the real
// Screen Wake Lock API) is covered by its own spec — these assert the toggle's WIRING only: hidden
// entirely when `supported` is false ("absent API -> toggle hidden"), and visible + clickable
// (calling `enable()`/`disable()`, reflecting `active()`) when it is true. A stub provider stands in
// for the real service.
describe('WakeLockToggleComponent', () => {
  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  /** Has to run before ANY `TestBed.inject` in the test (`overrideProvider` after that throws), so
   * each `it` calls this itself instead of sharing a `beforeEach`. */
  async function setup(overrides: { supported?: boolean; active?: boolean } = {}): Promise<{
    enable: ReturnType<typeof vi.fn>;
    disable: ReturnType<typeof vi.fn>;
  }> {
    const activeState = signal(overrides.active ?? false);
    const enable = vi.fn(() => {
      activeState.set(true);
      return Promise.resolve();
    });
    const disable = vi.fn(() => {
      activeState.set(false);
      return Promise.resolve();
    });
    configureReal(
      [],
      [
        {
          provide: WakeLockService,
          useValue: {
            supported: overrides.supported ?? true,
            active: activeState.asReadonly(),
            enable,
            disable,
          },
        },
      ],
    );
    await resetDb();
    return { enable, disable };
  }

  it('the toggle is hidden entirely when the Wake Lock API is unsupported', async () => {
    await setup({ supported: false });

    const fixture = TestBed.createComponent(WakeLockToggleComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.wake-lock__toggle')).toBeNull();
  });

  it('the toggle is visible when supported, calls enable()/disable() on click, and reflects active()', async () => {
    const { enable, disable } = await setup({ supported: true, active: false });

    const fixture = TestBed.createComponent(WakeLockToggleComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const toggle = compiled.querySelector<HTMLButtonElement>('.wake-lock__toggle')!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    await fixture.whenStable();
    expect(enable).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    await fixture.whenStable();
    expect(disable).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });
});
