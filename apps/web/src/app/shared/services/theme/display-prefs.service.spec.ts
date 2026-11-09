import { TestBed } from '@angular/core/testing';
import { DisplayPrefsService } from '@shared/services/theme/display-prefs.service';

const KEYS = ['hk.density', 'hk.motion'];

describe('DisplayPrefsService', () => {
  beforeEach(() => KEYS.forEach((key) => localStorage.removeItem(key)));
  afterEach(() => {
    vi.unstubAllGlobals();
    KEYS.forEach((key) => localStorage.removeItem(key));
    delete document.documentElement.dataset['density'];
    delete document.documentElement.dataset['motion'];
  });

  it('defaults to compact rows and motion on, and stamps <html>', () => {
    const svc = TestBed.inject(DisplayPrefsService);
    TestBed.tick();
    expect(svc.density()).toBe('compact');
    expect(svc.motion()).toBe(true);
    expect(document.documentElement.getAttribute('data-density')).toBe('compact');
    expect(document.documentElement.getAttribute('data-motion')).toBe('on');
  });

  it('setDensity persists, re-stamps and survives a fresh service', () => {
    const svc = TestBed.inject(DisplayPrefsService);
    svc.setDensity('comfortable');
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable');
    expect(localStorage.getItem('hk.density')).toBe('comfortable');

    TestBed.resetTestingModule();
    expect(TestBed.inject(DisplayPrefsService).density()).toBe('comfortable');
  });

  it('setMotion(false) persists "off", re-stamps and survives a fresh service', () => {
    const svc = TestBed.inject(DisplayPrefsService);
    svc.setMotion(false);
    TestBed.tick();
    expect(svc.motion()).toBe(false);
    expect(document.documentElement.getAttribute('data-motion')).toBe('off');
    expect(localStorage.getItem('hk.motion')).toBe('off');

    TestBed.resetTestingModule();
    expect(TestBed.inject(DisplayPrefsService).motion()).toBe(false);
  });

  it('ignores an unknown stored value', () => {
    localStorage.setItem('hk.density', 'huge');
    localStorage.setItem('hk.motion', 'sometimes');
    const svc = TestBed.inject(DisplayPrefsService);
    expect(svc.density()).toBe('compact');
    expect(svc.motion()).toBe(true);
  });

  describe('system reduced motion (ruling R60)', () => {
    const stubReduced = (reduce: boolean): void => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
    };

    it('starts with motion off, and stamps data-motion off, when nothing is stored and the system asks for reduced motion', () => {
      stubReduced(true);
      const svc = TestBed.inject(DisplayPrefsService);
      TestBed.tick();
      expect(svc.motion()).toBe(false);
      expect(document.documentElement.getAttribute('data-motion')).toBe('off');
    });

    it('starts with motion on when the system does not ask', () => {
      stubReduced(false);
      expect(TestBed.inject(DisplayPrefsService).motion()).toBe(true);
    });

    it('an explicit "on" wins over the system request', () => {
      stubReduced(true);
      localStorage.setItem('hk.motion', 'on');
      expect(TestBed.inject(DisplayPrefsService).motion()).toBe(true);
    });

    it('persists nothing at boot: only a choice the person makes is stored', () => {
      stubReduced(true);
      const svc = TestBed.inject(DisplayPrefsService);
      TestBed.tick();
      expect(localStorage.getItem('hk.motion')).toBeNull();
      expect(localStorage.getItem('hk.density')).toBeNull();

      svc.setDensity('comfortable');
      TestBed.tick();
      expect(localStorage.getItem('hk.density')).toBe('comfortable');
      expect(localStorage.getItem('hk.motion')).toBeNull();
    });
  });
});
