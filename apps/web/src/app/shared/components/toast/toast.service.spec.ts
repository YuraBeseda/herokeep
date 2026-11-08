import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { TabBarService } from '../../../ui/tab-bar/tab-bar.service';
import { stubViewport } from '../../../ui/testing/viewport';
import { ToastService } from './toast.service';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({
      toast: {
        saved: 'Saved successfully',
        deleted: 'Deleted {{name}}',
      },
    });
  }
}

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    // Fake timers from the start of every test (not just the ones that advance time): each
    // `show()` schedules a real `setTimeout` otherwise, which would keep firing — against a
    // torn-down service/overlay — well after its own test finished.
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideTransloco({
          config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
          loader: StubLoader,
        }),
      ],
    });
    service = TestBed.inject(ToastService);
  });

  afterEach(() => {
    // Flush any still-pending dismiss timers before switching back, so nothing outlives the
    // test, then remove the overlay container CDK appended directly to <body> — nothing else
    // tears it down, so a later spec would otherwise see this one's leftover DOM.
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('renders the translated key in an aria-live polite region', () => {
    service.show('toast.saved');
    TestBed.tick();

    const region = document.querySelector('[aria-live="polite"]');
    expect(region?.textContent).toContain('Saved successfully');
  });

  it('interpolates params into the translated key', () => {
    service.show('toast.deleted', { name: 'Aria' });
    TestBed.tick();

    const region = document.querySelector('[aria-live="polite"]');
    expect(region?.textContent).toContain('Deleted Aria');
  });

  it('auto-dismisses a toast after 4000ms', () => {
    service.show('toast.saved');
    TestBed.tick();
    expect(document.querySelectorAll('.hk-toast')).toHaveLength(1);

    vi.advanceTimersByTime(3999);
    TestBed.tick();
    expect(document.querySelectorAll('.hk-toast')).toHaveLength(1);

    vi.advanceTimersByTime(1);
    TestBed.tick();
    expect(document.querySelectorAll('.hk-toast')).toHaveLength(0);
  });

  it('caps visible toasts at 3 and queues the rest', () => {
    service.show('toast.saved');
    service.show('toast.saved');
    service.show('toast.saved');
    service.show('toast.saved');
    TestBed.tick();

    expect(document.querySelectorAll('.hk-toast')).toHaveLength(3);

    vi.advanceTimersByTime(4000);
    TestBed.tick();

    // The first 3 dismiss together, which promotes the queued 4th toast and starts its timer.
    expect(document.querySelectorAll('.hk-toast')).toHaveLength(1);

    vi.advanceTimersByTime(4000);
    TestBed.tick();
    expect(document.querySelectorAll('.hk-toast')).toHaveLength(0);
  });

  it('renders each toast through the presentational hk-toast slip', () => {
    service.show('toast.saved');
    TestBed.tick();

    const slip = document.querySelector('.cdk-overlay-container hk-toast-host hk-toast .hk-toast');
    expect(slip?.textContent).toContain('Saved successfully');
    expect(slip?.getAttribute('role')).toBe('status');
  });

  const hostOf = () => document.querySelector('.cdk-overlay-container hk-toast-host')!;
  const strapAction = {
    id: 'roll',
    label: 'toast.saved',
    icon: 'roll',
    kind: 'primary',
    run: () => undefined,
  } as const;

  it('reserves no strap height while no strap is set', () => {
    service.show('toast.saved');
    TestBed.tick();
    expect(hostOf().classList.contains('hk-toast-host--strap')).toBe(false);
    expect(hostOf().classList.contains('hk-toast-host--tabs')).toBe(false);
  });

  it('lifts the toasts above the strap while one is set, and drops them when it clears', () => {
    const strap = TestBed.inject(ActionStrapService);
    strap.set({ primary: [strapAction] });
    service.show('toast.saved');
    TestBed.tick();
    expect(hostOf().classList.contains('hk-toast-host--strap')).toBe(true);

    strap.clear();
    TestBed.tick();
    expect(hostOf().classList.contains('hk-toast-host--strap')).toBe(false);
  });

  it('also clears the phone tab bar when tabs are set on a phone', () => {
    stubViewport({ phone: true });
    try {
      TestBed.inject(TabBarService).set([
        { id: 'play', label: 'toast.saved', icon: 'play', route: ['/c', '1', 'play'] },
      ]);
      service.show('toast.saved');
      TestBed.tick();
      expect(hostOf().classList.contains('hk-toast-host--tabs')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
