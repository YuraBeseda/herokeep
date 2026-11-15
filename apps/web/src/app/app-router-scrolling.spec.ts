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
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

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
    return {
      router: TestBed.inject(Router),
      location: TestBed.inject(Location),
      scrollTo,
      scrollBy: (y: number) => (position = [0, y]),
    };
  }

  it('opens a forward navigation at the top', async () => {
    const { router, scrollTo, scrollBy } = setup();
    await router.navigateByUrl('/wizard');
    await settle();
    scrollBy(293);
    await router.navigateByUrl('/sheet');
    await settle();
    expect(scrollTo).toHaveBeenLastCalledWith([0, 0]);
  });

  it('restores the previous position on Back', async () => {
    const { router, location, scrollTo, scrollBy } = setup();
    await router.navigateByUrl('/wizard');
    await settle();
    scrollBy(293);
    await router.navigateByUrl('/sheet');
    await settle();
    location.back();
    await settle();
    expect(scrollTo).toHaveBeenLastCalledWith([0, 293], { behavior: 'instant' });
  });
});
