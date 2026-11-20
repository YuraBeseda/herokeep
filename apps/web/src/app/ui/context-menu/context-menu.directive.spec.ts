import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideShellTransloco } from '../testing/transloco-testing';
import { overlayRoot } from '../testing/overlay';
import type { HkMenuItem, HkMenuItems } from './context-menu.types';
import { HkContextMenuDirective } from './context-menu.directive';
import { HkMenuButtonComponent } from './menu-button.component';

@Component({
  selector: 'app-menu-host',
  imports: [HkContextMenuDirective, HkMenuButtonComponent],
  template: `<div class="row" [hkContextMenu]="rowItems()">
      <button type="button" class="inner">{{ name }}</button>
    </div>
    <hk-menu-button [items]="items" />`,
})
class HostComponent {
  protected readonly name = 'Longsword';
  readonly ran = signal<string[]>([]);
  /** Where focus was when an item ran: the peek and dialogs take it as their opener. */
  focusAtRun: Element | null = null;
  readonly items = (): HkMenuItem[] => [
    {
      id: 'use',
      labelKey: 'shell.icon.use',
      icon: 'ui:use',
      detail: '+5',
      run: () => {
        this.focusAtRun = document.activeElement;
        this.ran.update((r) => [...r, 'use']);
      },
    },
    {
      id: 'equip',
      labelKey: 'shell.icon.equip',
      hintKey: 'shell.icon.details',
      run: () => undefined,
    },
    {
      id: 'attune',
      labelKey: 'shell.icon.attune',
      disabledReasonKey: 'shell.icon.lock',
      run: () => this.ran.update((r) => [...r, 'attune']),
    },
  ];
  readonly rowItems = signal<HkMenuItems | null>(this.items);
}

const menuItems = () =>
  Array.from(overlayRoot().querySelectorAll<HTMLElement>('.hk-menu [role="menuitem"]'));

function key(target: Element, init: KeyboardEventInit & { keyCode?: number }): void {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode });
  target.dispatchEvent(event);
}

function pointer(el: Element, type: string, x: number, y: number): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerType: { value: 'touch' },
    clientX: { value: x },
    clientY: { value: y },
  });
  el.dispatchEvent(event);
}

describe('HkContextMenuDirective', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let row: HTMLElement;
  let inner: HTMLButtonElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [provideShellTransloco()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    document.body.append(fixture.nativeElement as HTMLElement);
    await settle();
    row = (fixture.nativeElement as HTMLElement).querySelector('.row')!;
    inner = row.querySelector('.inner')!;
  });

  afterEach(() => {
    (fixture.nativeElement as HTMLElement).remove();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('right-click opens the menu', async () => {
    row.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 120,
        clientY: 80,
      }),
    );
    await settle();
    expect(menuItems().map((i) => i.querySelector('.hk-menu__label')?.textContent?.trim())).toEqual(
      ['Use', 'Equip', 'Attune'],
    );
    // The pane's position at the pointer is checked in a real browser (e2e/play-actions.spec.ts):
    // jsdom has no layout for the CDK's connected position strategy.
  });

  it('long-press 500 ms opens; 300 ms does not; a 10 px move cancels', () => {
    vi.useFakeTimers();
    pointer(inner, 'pointerdown', 10, 10);
    vi.advanceTimersByTime(300);
    pointer(inner, 'pointerup', 10, 10);
    vi.advanceTimersByTime(500);
    expect(menuItems()).toHaveLength(0);

    pointer(inner, 'pointerdown', 10, 10);
    pointer(inner, 'pointermove', 22, 10);
    vi.advanceTimersByTime(600);
    expect(menuItems()).toHaveLength(0);

    pointer(inner, 'pointerdown', 10, 10);
    vi.advanceTimersByTime(500);
    fixture.detectChanges();
    expect(menuItems()).toHaveLength(3);
    expect(row.classList).toContain('hk-context-menu-host'); // suppresses the native callout
  });

  it('Shift+F10 opens with focus on the first item; Escape restores focus', async () => {
    inner.focus();
    key(inner, { key: 'F10', shiftKey: true, keyCode: 121 });
    await settle();
    expect(document.activeElement).toBe(menuItems()[0]);
    key(menuItems()[0], { key: 'Escape', keyCode: 27 });
    await settle();
    expect(menuItems()).toHaveLength(0);
    expect(document.activeElement).toBe(inner);
  });

  it('the ContextMenu key opens it too, and an item runs', async () => {
    inner.focus();
    key(inner, { key: 'ContextMenu', keyCode: 93 });
    await settle();
    menuItems()[0].click();
    await settle();
    expect(fixture.componentInstance.ran()).toEqual(['use']);
    expect(menuItems()).toHaveLength(0);
  });

  it('a disabled item shows its reason and does not run', async () => {
    row.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
    );
    await settle();
    const [use, equip, attune] = menuItems();
    expect(use.querySelector('.hk-menu__detail')?.textContent?.trim()).toBe('+5');
    expect(equip.querySelector('.hk-menu__hint')?.textContent?.trim()).toBe('Details');
    expect(attune.getAttribute('aria-disabled')).toBe('true');
    expect(attune.querySelector('.hk-menu__hint')?.textContent?.trim()).toBe('Locked');
    attune.click();
    await settle();
    expect(fixture.componentInstance.ran()).toEqual([]);
  });

  it('hk-menu-button: a named, hinted button opening the same menu', async () => {
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'hk-menu-button button',
    )!;
    expect(button.getAttribute('aria-label')).toBe('More actions');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    button.click();
    await settle();
    expect(menuItems()).toHaveLength(3);
  });

  it('an item runs after the menu closed and focus is back on the opener', async () => {
    inner.focus();
    key(inner, { key: 'F10', shiftKey: true, keyCode: 121 });
    await settle();
    menuItems()[0].click();
    await settle();
    expect(fixture.componentInstance.focusAtRun).toBe(inner);

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'hk-menu-button button',
    )!;
    button.focus();
    button.click();
    await settle();
    menuItems()[0].click();
    await settle();
    expect(fixture.componentInstance.focusAtRun).toBe(button);
  });

  it('with no items the native context menu is left alone', async () => {
    fixture.componentInstance.rowItems.set(null);
    await settle();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    row.dispatchEvent(event);
    inner.focus();
    key(inner, { key: 'F10', shiftKey: true, keyCode: 121 });
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(menuItems()).toHaveLength(0);
    expect(row.classList).not.toContain('hk-context-menu-host');
  });
});
