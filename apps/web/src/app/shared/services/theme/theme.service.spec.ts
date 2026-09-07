import { TestBed } from '@angular/core/testing';
// WATCH ITEM (Task 2 review): exercise the `@shared/*` tsconfig alias under the
// Vitest-based `@angular/build:unit-test` builder — see task-3-report.md for the result.
import { ThemeService } from '@shared/services/theme/theme.service';

describe('ThemeService', () => {
  beforeEach(() => localStorage.removeItem('hk.theme'));
  it('defaults to dark and stamps <html data-theme>', () => {
    const svc = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(svc.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
  it('setTheme persists and re-stamps', () => {
    const svc = TestBed.inject(ThemeService);
    svc.setTheme('light');
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('hk.theme')).toBe('light');
  });
});
