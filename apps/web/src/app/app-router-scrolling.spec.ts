import { ApplicationRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ViewportScroller } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Location } from '@angular/common';
import { provideRouter, Router } from '@angular/router';
import { appRouterScrolling } from './app.config';

@Component({ selector: 'hk-scroll-root', template: '' })
class Blank {}

// R73: a forward navigation opens the page at the top; only Back restores the old position.
describe('appRouterScrolling', () => {
  // The router scrolls after a timeout/animation frame; wait for the call itself, never a fixed delay.
  const scrolled = (spy: unknown, ...args: unknown[]) =>
    vi.waitFor(() => expect(spy).toHaveBeenLastCalledWith(...args));

  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideLocationMocks(),
        provideRouter(
          [
            { path: '', component: Blank },
            { path: 'wizard', component: Blank },
            { path: 'sheet', component: Blank },
          ],
          appRouterScrolling,
        ),
      ],
    });
    // The router starts its scroller from the app's bootstrap listener, so bootstrap a root.
    document.body.appendChild(document.createElement('hk-scroll-root'));
    TestBed.inject(ApplicationRef).bootstrap(Blank);
    const scroller = TestBed.inject(ViewportScroller);
    let position: [number, number] = [0, 0];
    vi.spyOn(scroller, 'getScrollPosition').mockImplementation(() => position);
    const scrollTo = vi
      .spyOn(scroller, 'scrollToPosition')
      .mockImplementation((p) => (position = [p[0], p[1]]));
    const scrollToAnchor = vi.spyOn(scroller, 'scrollToAnchor').mockImplementation(() => undefined);
    return {
      scrollToAnchor,
      router: TestBed.inject(Router),
      location: TestBed.inject(Location),
      scrollTo,
      scrollBy: (y: number) => (position = [0, y]),
    };
  }

  it('opens a forward navigation at the top', async () => {
    const { router, scrollTo, scrollBy } = setup();
    await router.navigateByUrl('/wizard');
    await scrolled(scrollTo, [0, 0]);
    scrollTo.mockClear();
    scrollBy(293);
    await router.navigateByUrl('/sheet');
    await scrolled(scrollTo, [0, 0]);
  });

  it('restores the previous position on Back', async () => {
    const { router, location, scrollTo, scrollBy } = setup();
    await router.navigateByUrl('/wizard');
    await scrolled(scrollTo, [0, 0]);
    scrollBy(293);
    await router.navigateByUrl('/sheet');
    await scrolled(scrollTo, [0, 0]);
    location.back();
    await scrolled(scrollTo, [0, 293], { behavior: 'instant' });
  });

  it('scrolls a navigation with a fragment to its anchor, not to the top', async () => {
    const { router, scrollTo, scrollToAnchor } = setup();
    await router.navigateByUrl('/wizard');
    await scrolled(scrollTo, [0, 0]);
    scrollTo.mockClear();
    await router.navigateByUrl('/sheet#frag');
    await scrolled(scrollToAnchor, 'frag');
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
