import { TestBed } from '@angular/core/testing';
// WATCH ITEM (Task 2 review): exercise the `@shared/*` tsconfig alias under the
// Vitest-based `@angular/build:unit-test` builder — see task-3-report.md for the result.
import { ThemeService } from '@shared/services/theme/theme.service';

describe('ThemeService', () => {
  beforeEach(() => localStorage.removeItem('hk.theme'));

  it('defaults to tavern and stamps <html data-theme>', () => {
    const svc = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(svc.theme()).toBe('tavern');
    expect(document.documentElement.getAttribute('data-theme')).toBe('tavern');
  });

  it('setTheme persists and re-stamps', () => {
    const svc = TestBed.inject(ThemeService);
    svc.setTheme('plain');
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('plain');
    expect(localStorage.getItem('hk.theme')).toBe('plain');
  });

  it('migrates a stored dark theme to tavern', () => {
    localStorage.setItem('hk.theme', 'dark');
    const svc = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(svc.theme()).toBe('tavern');
    expect(localStorage.getItem('hk.theme')).toBe('tavern');
  });

  it('migrates a stored light theme to scroll', () => {
    localStorage.setItem('hk.theme', 'light');
    const svc = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(svc.theme()).toBe('scroll');
    expect(document.documentElement.getAttribute('data-theme')).toBe('scroll');
    expect(localStorage.getItem('hk.theme')).toBe('scroll');
  });

  it('keeps a stored current theme as is', () => {
    localStorage.setItem('hk.theme', 'scroll');
    expect(TestBed.inject(ThemeService).theme()).toBe('scroll');
  });

  it('falls back to tavern for an unknown stored value', () => {
    localStorage.setItem('hk.theme', 'neon');
    expect(TestBed.inject(ThemeService).theme()).toBe('tavern');
  });

  it('toggle swaps tavern and scroll and sends plain to tavern', () => {
    const svc = TestBed.inject(ThemeService);
    svc.toggle();
    expect(svc.theme()).toBe('scroll');
    svc.toggle();
    expect(svc.theme()).toBe('tavern');
    svc.setTheme('plain');
    svc.toggle();
    expect(svc.theme()).toBe('tavern');
  });
});
