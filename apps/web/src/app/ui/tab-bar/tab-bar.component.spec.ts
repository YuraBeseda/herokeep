import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { press } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { stubViewport } from '../testing/viewport';
import { HkTabBarComponent } from './tab-bar.component';
import { TabBarService, type TabItem } from './tab-bar.service';

@Component({ template: '' })
class Stub {}

const tabs: TabItem[] = [
  { id: 'play', label: 'shell.icon.play', icon: 'play', route: ['/c', '1', 'play'] },
  { id: 'spells', label: 'shell.icon.spells', icon: 'spells', route: ['/c', '1', 'spells'] },
  { id: 'bag', label: 'shell.icon.bag', icon: 'bag', route: ['/c', '1', 'bag'] },
];

async function setup(phone: boolean, set: readonly TabItem[] | null) {
  stubViewport({ phone, coarse: phone });
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [provideShellTransloco(), provideRouter([{ path: 'c/:id/:tab', component: Stub }])],
  }).compileComponents();
  TestBed.inject(TabBarService).set(set);
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/c/1/play');
  const fixture = TestBed.createComponent(HkTabBarComponent);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement, router };
}

afterEach(() => vi.unstubAllGlobals());

describe('HkTabBarComponent', () => {
  it('renders nothing without tabs', async () => {
    const { el } = await setup(true, null);
    expect(el.querySelector('nav')).toBeNull();
  });

  it('renders nothing on tablet and desktop even with tabs', async () => {
    const { el } = await setup(false, tabs);
    expect(el.querySelector('nav')).toBeNull();
  });

  it('is a labelled nav of links in order, the current one marked', async () => {
    const { el } = await setup(true, tabs);
    const nav = el.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Sections of this screen');
    const links = Array.from(nav.querySelectorAll('a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Play', 'Spells', 'Bag']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/c/1/play',
      '/c/1/spells',
      '/c/1/bag',
    ]);
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', null, null]);
  });

  it('follows a real click to the tab and moves the current mark', async () => {
    const { fixture, el, router } = await setup(true, tabs);
    press(el.querySelectorAll('a')[1]);
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    expect(router.url).toBe('/c/1/spells');
    expect(el.querySelectorAll('a')[1].getAttribute('aria-current')).toBe('page');
  });
});
