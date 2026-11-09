import { TestBed } from '@angular/core/testing';
import { DisplayPrefsService } from '@shared/services/theme/display-prefs.service';

const KEYS = ['hk.density', 'hk.motion'];

describe('DisplayPrefsService', () => {
  beforeEach(() => KEYS.forEach((key) => localStorage.removeItem(key)));
  afterEach(() => {
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
});
