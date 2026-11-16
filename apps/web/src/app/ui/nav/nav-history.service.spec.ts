import { ViewportScroller } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { ApplicationRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { appRouterScrolling } from '../../app.config';
import { NavHistoryService } from './nav-history.service';

function setup() {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const service = TestBed.inject(NavHistoryService);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { service, navigate };
}

@Component({ selector: 'hk-nav-scroll-root', template: '' })
class Blank {}

// R74: the in-app Back returns to where the previous screen was scrolled to.
describe('NavHistoryService scroll restoration', () => {
  const scrolled = (spy: unknown, ...args: unknown[]) =>
    vi.waitFor(() => expect(spy).toHaveBeenLastCalledWith(...args));

  function scrollSetup() {
    TestBed.configureTestingModule({
      providers: [
        provideLocationMocks(),
        provideRouter(
          [
            { path: 'a', component: Blank },
            { path: 'b', component: Blank },
            { path: 'home', component: Blank },
          ],
          appRouterScrolling,
        ),
      ],
    });
    document.body.appendChild(document.createElement('hk-nav-scroll-root'));
    TestBed.inject(ApplicationRef).bootstrap(Blank);
    const service = TestBed.inject(NavHistoryService);
    const router = TestBed.inject(Router);
    const scroller = TestBed.inject(ViewportScroller);
    let position: [number, number] = [0, 0];
    vi.spyOn(scroller, 'getScrollPosition').mockImplementation(() => position);
    const scrollTo = vi
      .spyOn(scroller, 'scrollToPosition')
      .mockImplementation((p) => (position = [p[0], p[1]]));
    // The shell records each committed URL (app.ts); do the same here.
    const go = async (url: string) => {
      await router.navigateByUrl(url);
      service.push(router.url);
    };
    return { service, scrollTo, go, scrollBy: (y: number) => (position = [0, y]) };
  }

  it('returns to the scroll position the screen was left at', async () => {
    const { service, scrollTo, go, scrollBy } = scrollSetup();
    await go('/a');
    await scrolled(scrollTo, [0, 0]); // the router's own scroll to the top lands first
    scrollBy(640);
    await go('/b');
    await scrolled(scrollTo, [0, 0]);
    service.back(['/home']);
    await scrolled(scrollTo, [0, 640]);
  });

  it('hands the list offset it was left at back to the next list after Back, not after a forward step', async () => {
    const { service, go } = scrollSetup();
    await go('/a');
    service.registerListScroll(() => 300);
    await go('/b');
    service.back(['/home']);
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/a'));
    expect(service.takeListScroll()).toBe(300);
    expect(service.takeListScroll()).toBeUndefined();
    await go('/b');
    expect(service.takeListScroll()).toBeUndefined();
  });

  it('still opens a forward navigation at the top', async () => {
    const { scrollTo, go, scrollBy } = scrollSetup();
    await go('/a');
    scrollBy(640);
    await go('/b');
    await scrolled(scrollTo, [0, 0]);
  });

  it('opens the fallback at the top when there is nothing to go back to', async () => {
    const { service, scrollTo, go, scrollBy } = scrollSetup();
    await go('/a');
    scrollBy(640);
    service.back(['/home']);
    await scrolled(scrollTo, [0, 0]);
  });
});

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
