import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideShellTransloco } from '../../ui/testing/transloco-testing';
import { press } from '../../ui/testing/harness';
import shellEn from '../../../assets/i18n/shell/en.json';
import { NotFoundComponent } from './not-found.component';

async function open(url: string) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideShellTransloco(),
      provideRouter([
        { path: 'characters', component: NotFoundComponent },
        { path: '', pathMatch: 'full', component: NotFoundComponent },
        { path: '**', component: NotFoundComponent },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  await harness.fixture.whenStable();
  return { harness, el: harness.routeNativeElement!, router: TestBed.inject(Router) };
}

describe('NotFoundComponent', () => {
  it('names the problem and shows the address that was not found', async () => {
    const { el } = await open('/no/such/place');
    expect(el.querySelector('hk-leaf h2')?.textContent?.trim()).toBe(shellEn.notFound.title);
    expect(el.textContent).toContain(shellEn.notFound.body);
    expect(el.querySelector('.not-found__address')?.textContent).toContain('/no/such/place');
  });

  it('offers a way back to the heroes and to Home', async () => {
    const { el, router } = await open('/no/such/place');
    const buttons = Array.from(el.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      shellEn.notFound.heroes,
      shellEn.notFound.home,
    ]);

    press(buttons[0]);
    await new Promise((r) => setTimeout(r, 0));
    expect(router.url).toBe('/characters');
  });

  it('the Home button goes to the home screen', async () => {
    const { el, router } = await open('/no/such/place');
    const home = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === shellEn.notFound.home,
    )!;
    press(home);
    await new Promise((r) => setTimeout(r, 0));
    expect(router.url).toBe('/');
  });
});
