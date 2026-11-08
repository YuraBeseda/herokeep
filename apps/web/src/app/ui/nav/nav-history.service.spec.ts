import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NavHistoryService } from './nav-history.service';

function setup() {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const service = TestBed.inject(NavHistoryService);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { service, navigate };
}

describe('NavHistoryService', () => {
  it('goes back to the sheet tab the user came from (Review Focus 3 pin)', () => {
    const { service, navigate } = setup();
    service.push('/c/1/play');
    service.push('/c/1/level-up');
    service.back(['/characters']);
    expect(navigate).toHaveBeenCalledWith('/c/1/play');
  });

  it('goes to the fallback when there is no earlier in-app path', () => {
    const { service } = setup();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    service.push('/c/1/level-up');
    service.back(['/c', '1', 'play']);
    expect(navigate).toHaveBeenCalledWith(['/c', '1', 'play']);
  });

  it('goes to the fallback when nothing was ever recorded', () => {
    const { service } = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    service.back(['/characters']);
    expect(navigate).toHaveBeenCalledWith(['/characters']);
  });

  it('ignores query-only and fragment-only repeats of the current path', () => {
    const { service, navigate } = setup();
    service.push('/library');
    service.push('/library/x');
    service.push('/library/x?q=1');
    service.push('/library/x?q=2#top');
    service.back(['/']);
    expect(navigate).toHaveBeenCalledWith('/library');
  });

  it('walks back one distinct path at a time', () => {
    const { service, navigate } = setup();
    service.push('/');
    service.push('/characters');
    service.push('/c/1/play');
    service.back(['/']);
    expect(navigate).toHaveBeenLastCalledWith('/characters');
    // The arrival at /characters is recorded by the router; it replaces, not stacks.
    service.push('/characters');
    service.back(['/']);
    expect(navigate).toHaveBeenLastCalledWith('/');
  });

  it('keeps the query of the previous entry when going back', () => {
    const { service, navigate } = setup();
    service.push('/library?q=fire');
    service.push('/library/fireball');
    service.back(['/library']);
    expect(navigate).toHaveBeenCalledWith('/library?q=fire');
  });

  it('treats a browser Back traversal as a step back, not a new entry', () => {
    const { service, navigate } = setup();
    service.push('/a');
    service.push('/b');
    service.push('/a', 'traverse');
    navigate.mockClear();
    const fallback = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    service.back(['/home']);
    // The stack is now just /a (the /b entry was popped): nothing earlier, so the fallback is used.
    expect(fallback).toHaveBeenCalledWith(['/home']);
  });

  it('exposes the current path', () => {
    const { service } = setup();
    service.push('/g/9/party?x=1');
    expect(service.currentPath()).toBe('/g/9/party');
  });
});
