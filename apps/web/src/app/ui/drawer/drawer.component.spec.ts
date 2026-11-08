import { Component, signal, viewChild, type ElementRef } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter, Router } from '@angular/router';
import { hintOf, press } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkDrawerComponent } from './drawer.component';

@Component({ template: '' })
class Page {}

@Component({
  imports: [HkDrawerComponent],
  template: `
    <button type="button" class="opener" #opener (click)="open.set(!open())">
      {{ openerText }}
    </button>
    <button type="button" class="elsewhere">{{ elsewhereText }}</button>
    <hk-drawer [(open)]="open" [heading]="heading" [opener]="openerRef()">
      <p class="body">{{ bodyText }}</p>
      <button hkDrawerAction type="button" class="act">{{ actionText }}</button>
    </hk-drawer>
  `,
})
class Host {
  readonly open = signal(false);
  readonly openerRef = viewChild<ElementRef<HTMLElement>>('opener');
  protected readonly openerText = 'Open';
  protected readonly elsewhereText = 'Elsewhere';
  protected readonly heading = 'Fireball';
  protected readonly bodyText = 'A bright streak';
  protected readonly actionText = 'Choose';
}

async function setup(): Promise<{ fixture: ComponentFixture<Host>; el: HTMLElement }> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [
      provideShellTransloco(),
      provideRouter([
        { path: '', component: Page },
        { path: 'library', component: Page },
      ]),
    ],
  }).compileComponents();
  await TestBed.inject(Router).navigateByUrl('/');
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const panel = (el: HTMLElement) => el.querySelector<HTMLElement>('[role="dialog"]');
const key = (target: Element, name: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

async function openIt(fixture: ComponentFixture<Host>) {
  const opener = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.opener')!;
  opener.focus();
  press(opener);
  await fixture.whenStable();
}

describe('HkDrawerComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing while closed', async () => {
    const { el } = await setup();
    expect(panel(el)).toBeNull();
  });

  it('opens as a modal dialog named by its heading, with the body and the action slot', async () => {
    const { fixture, el } = await setup();
    await openIt(fixture);
    const dialog = panel(el)!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = dialog.querySelector('h2')!;
    expect(title.textContent?.trim()).toBe('Fireball');
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(dialog.querySelector('.body')!.textContent).toContain('A bright streak');
    expect(dialog.querySelector('.hk-drawer__actions .act')).not.toBeNull();
  });

  it('moves focus into the drawer on open', async () => {
    // jsdom has no layout, so CDK's "is this tabbable" visibility check needs client rects.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    const { fixture, el } = await setup();
    await openIt(fixture);
    await fixture.whenStable();
    expect(panel(el)!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe('H2');
  });

  it('closes on Escape and returns focus to the opener', async () => {
    const { fixture, el } = await setup();
    await openIt(fixture);
    key(document.activeElement!, 'Escape');
    await fixture.whenStable();
    expect(panel(el)).toBeNull();
    expect(fixture.componentInstance.open()).toBe(false);
    expect(document.activeElement).toBe(el.querySelector('.opener'));
  });

  it('closes through its named Close button and returns focus to the opener', async () => {
    const { fixture, el } = await setup();
    await openIt(fixture);
    const close = panel(el)!.querySelector<HTMLButtonElement>('button[hk-icon-button]')!;
    expect(hintOf(close)).toBe('Close');
    press(close);
    await fixture.whenStable();
    expect(panel(el)).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('.opener'));
  });

  it('closes on a press outside, but not on a press inside or on its opener', async () => {
    const { fixture, el } = await setup();
    await openIt(fixture);

    press(panel(el)!.querySelector('.body')!);
    await fixture.whenStable();
    expect(panel(el)).not.toBeNull();

    // The opener toggles the drawer itself; the outside rule must not close it first.
    const opener = el.querySelector<HTMLElement>('.opener')!;
    opener.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(panel(el)).not.toBeNull();

    press(el.querySelector('.elsewhere')!);
    await fixture.whenStable();
    expect(panel(el)).toBeNull();
  });

  it('adds its document listeners on open and removes them on close', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { fixture, el } = await setup();
    const kinds = (spy: typeof add) => spy.mock.calls.map((c) => c[0]);
    expect(kinds(add)).not.toContain('pointerdown');

    await openIt(fixture);
    expect(kinds(add)).toContain('pointerdown');
    expect(kinds(remove)).not.toContain('pointerdown');

    press(el.querySelector('.elsewhere')!);
    await fixture.whenStable();
    expect(kinds(remove)).toContain('pointerdown');
  });

  it('removes its document listeners when destroyed while open', async () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { fixture } = await setup();
    await openIt(fixture);
    const before = remove.mock.calls.filter((c) => c[0] === 'pointerdown').length;
    fixture.destroy();
    expect(remove.mock.calls.filter((c) => c[0] === 'pointerdown').length).toBeGreaterThan(before);
  });

  it('closes when a navigation starts, and never changes the URL itself', async () => {
    const { fixture, el } = await setup();
    const location = TestBed.inject(Location);
    const before = location.path();
    await openIt(fixture);
    expect(location.path()).toBe(before);

    await TestBed.inject(Router).navigateByUrl('/library');
    await fixture.whenStable();
    expect(panel(el)).toBeNull();
    expect(fixture.componentInstance.open()).toBe(false);
  });
});
