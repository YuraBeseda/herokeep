import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Component, inject, signal, viewChild, type ElementRef } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter, Router } from '@angular/router';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { hintOf, press } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkDrawerComponent } from './drawer.component';

@Component({ template: '' })
class Page {}

@Component({ template: `<button type="button" class="inner">{{ text }}</button>` })
class InnerDialog {
  protected readonly text = 'Inner';
}

@Component({ template: `<div role="menu"></div>` })
class InnerPopover {}

@Component({
  imports: [HkDrawerComponent],
  template: `
    <button type="button" class="in-dialog-opener" #opener (click)="open.set(true)">
      {{ openerText }}
    </button>
    <hk-drawer [(open)]="open" [heading]="heading" [opener]="openerRef()">
      <p class="body">{{ bodyText }}</p>
    </hk-drawer>
  `,
})
class DrawerInDialog {
  readonly open = signal(false);
  readonly openerRef = viewChild<ElementRef<HTMLElement>>('opener');
  protected readonly openerText = 'Details';
  protected readonly heading = 'Longsword';
  protected readonly bodyText = 'A blade';
}

@Component({
  imports: [HkDrawerComponent],
  template: `
    <button type="button" class="opener" #opener (click)="open.set(!open())">
      {{ openerText }}
    </button>
    <button type="button" class="elsewhere">{{ elsewhereText }}</button>
    <hk-drawer [(open)]="open" [heading]="heading" [opener]="openerRef()">
      <p class="body">{{ bodyText }}</p>
      <button hkDrawerAction type="button" class="act" (click)="dialogs.open(Inner)">
        {{ actionText }}
      </button>
    </hk-drawer>
  `,
})
class Host {
  protected readonly dialogs = inject(DialogService);
  protected readonly Inner = InnerDialog;
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
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
  );

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

  it('closes on a press on the scrim, the only thing under the pointer outside the panel', async () => {
    const { fixture, el } = await setup();
    await openIt(fixture);
    press(el.querySelector('.hk-drawer__scrim')!);
    await fixture.whenStable();
    expect(panel(el)).toBeNull();
  });

  it('stays open on a press on its own header', async () => {
    const { fixture, el } = await setup();
    await openIt(fixture);
    press(panel(el)!.querySelector('h2')!);
    await fixture.whenStable();
    expect(panel(el)).not.toBeNull();
  });

  describe('with a dialog opened from inside it', () => {
    afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.remove()));

    async function openDialog(fixture: ComponentFixture<Host>) {
      await openIt(fixture);
      press((fixture.nativeElement as HTMLElement).querySelector('.act')!);
      await fixture.whenStable();
      expect(document.querySelector('.cdk-overlay-container hk-dialog')).not.toBeNull();
    }

    it('Escape closes only the dialog, not the drawer beneath it', async () => {
      const { fixture, el } = await setup();
      await openDialog(fixture);
      key(document.querySelector('.inner')!, 'Escape');
      await fixture.whenStable();
      expect(document.querySelector('.cdk-overlay-container hk-dialog')).toBeNull();
      expect(panel(el)).not.toBeNull();

      key(document.body, 'Escape');
      await fixture.whenStable();
      expect(panel(el)).toBeNull();
    });

    it('a press inside the dialog leaves the drawer open', async () => {
      const { fixture, el } = await setup();
      await openDialog(fixture);
      press(document.querySelector('.inner')!);
      await fixture.whenStable();
      expect(panel(el)).not.toBeNull();
    });

    it('a press on the dialog backdrop leaves the drawer open', async () => {
      const { fixture, el } = await setup();
      await openDialog(fixture);
      press(document.querySelector('.hk-overlay-backdrop')!);
      await fixture.whenStable();
      expect(document.querySelector('.cdk-overlay-container hk-dialog')).toBeNull();
      expect(panel(el)).not.toBeNull();
    });
  });

  describe('with a popover (a CDK overlay that is not a dialog) or a toast above it', () => {
    afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.remove()));

    it('Escape leaves the drawer open while the popover pane is up, and closes it once gone', async () => {
      const { fixture, el } = await setup();
      await openIt(fixture);
      const popover = TestBed.inject(Overlay).create();
      popover.attach(new ComponentPortal(InnerPopover));
      await fixture.whenStable();

      key(document.body, 'Escape');
      await fixture.whenStable();
      expect(panel(el)).not.toBeNull();

      popover.dispose();
      key(document.body, 'Escape');
      await fixture.whenStable();
      expect(panel(el)).toBeNull();
    });

    it('a pane that holds no dialog or popover (a toast) does not swallow Escape', async () => {
      const { fixture, el } = await setup();
      await openIt(fixture);
      const toast = TestBed.inject(Overlay).create();
      toast.attach(new ComponentPortal(InnerDialog));
      await fixture.whenStable();

      key(document.body, 'Escape');
      await fixture.whenStable();
      expect(panel(el)).toBeNull();
      toast.dispose();
    });
  });

  describe('hosted inside an open dialog (the add-item picker)', () => {
    afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.remove()));

    const dialog = () => document.querySelector('.cdk-overlay-container hk-dialog');
    const drawerPanel = () => document.querySelector('.cdk-overlay-container .hk-drawer__panel');

    async function openDrawerInDialog() {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        providers: [provideShellTransloco(), provideRouter([{ path: '', component: Page }])],
      }).compileComponents();
      await TestBed.inject(Router).navigateByUrl('/');
      const fixture = TestBed.createComponent(Host);
      await fixture.whenStable();
      TestBed.inject(DialogService).open(DrawerInDialog);
      await fixture.whenStable();
      press(document.querySelector('.in-dialog-opener')!);
      await fixture.whenStable();
      expect(drawerPanel()).not.toBeNull();
      return fixture;
    }

    it('a press on its scrim closes the drawer and leaves the dialog open', async () => {
      const fixture = await openDrawerInDialog();
      press(document.querySelector('.cdk-overlay-container .hk-drawer__scrim')!);
      await fixture.whenStable();
      expect(drawerPanel()).toBeNull();
      expect(dialog()).not.toBeNull();
    });

    it('Escape closes the drawer only, and a second Escape closes the dialog', async () => {
      const fixture = await openDrawerInDialog();
      key(document.activeElement ?? document.body, 'Escape');
      await fixture.whenStable();
      expect(drawerPanel()).toBeNull();
      expect(dialog()).not.toBeNull();

      key(document.activeElement ?? document.body, 'Escape');
      await fixture.whenStable();
      expect(dialog()).toBeNull();
    });

    it('a press inside the dialog but outside the drawer closes the drawer', async () => {
      const fixture = await openDrawerInDialog();
      press(document.querySelector('.cdk-overlay-container hk-dialog')!);
      await fixture.whenStable();
      expect(drawerPanel()).toBeNull();
      expect(dialog()).not.toBeNull();
    });
  });
});
