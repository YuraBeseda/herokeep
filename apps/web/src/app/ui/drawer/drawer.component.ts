import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  model,
  untracked,
} from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';
import { phoneLayout } from '../shell/viewport';

/** Below this width a peek drawer is a modal bottom sheet; at or above it, a non-modal side panel. */
const PEEK_SHEET_QUERY = '(max-width: 899.98px)';

let nextDrawerId = 0;

type Opener = ElementRef<HTMLElement> | HTMLElement | null | undefined;

/**
 * `hk-drawer` — the one side drawer (design-system DescriptionDrawer chrome): a parchment panel
 * sliding in from the right on tablet and desktop, a full-height bottom sheet with a grip on a
 * phone. It owns the open state through `[(open)]`, the heading with a Close button, the body (its
 * content) and a footer slot for `[hkDrawerAction]` buttons.
 *
 * It never touches the URL. It closes on: its Close button, Escape (focus goes back to `opener`,
 * or to whatever was focused when it opened), a press outside it (the `opener` is exempt, since the
 * opener toggles it) and a router `NavigationStart` (a deep link or browser Back must not leave it
 * open over the next screen). Focus moves in on open and stays trapped. The document listeners
 * exist only while it is open.
 *
 * `peek`: the description peek (one host, `PeekService`). At >= 900 px it is non-modal: a fixed
 * right panel with no scrim, no focus trap and no outside-press close, so the page under it keeps
 * scrolling; below 900 px it is a modal bottom sheet. A `[hkDrawerHeadAction]` sits in the header.
 */
@Component({
  selector: 'hk-drawer',
  imports: [CdkTrapFocus, HkIconButtonComponent],
  templateUrl: './drawer.component.html',
  styleUrl: './drawer.component.scss',
  host: { '[class.hk-drawer--peek]': 'peek()' },
})
export class HkDrawerComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  readonly open = model(false);
  /** Already-translated heading; also the dialog's accessible name. */
  readonly heading = input.required<string>();
  /** The control that opens the drawer: focus returns to it, and pressing it never counts as outside. */
  readonly opener = input<Opener>(null);
  /** The non-modal description peek (see the class doc). */
  readonly peek = input(false);

  private readonly sheet = phoneLayout(PEEK_SHEET_QUERY);
  protected readonly modal = computed(() => !this.peek() || this.sheet());

  protected readonly titleId = `hk-drawer-title-${nextDrawerId++}`;
  private returnTo: HTMLElement | null = null;

  constructor() {
    // The document listeners live exactly as long as the drawer is open: added here, removed by the
    // effect's cleanup when `open` flips to false and when the component is destroyed.
    effect((onCleanup) => {
      if (!this.open()) return;
      untracked(() => {
        this.returnTo = document.activeElement as HTMLElement | null;
        const onPointerDown = (event: Event): void => this.onOutsidePress(event);
        const onKeyDown = (event: KeyboardEvent): void => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          // Whatever is stacked above the drawer (a confirm dialog opened from it) owns Escape:
          // its handler has already run (it prevents default) or it is still open above us, so
          // one Escape closes only the topmost overlay.
          if (this.overlayOpenAbove()) return;
          // A non-modal peek leaves the page usable: Escape there (a search field, a menu) is not ours.
          if (!this.modal() && !this.ownsFocus()) return;
          event.preventDefault();
          event.stopPropagation();
          this.dismiss(true);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        // Capture phase: a drawer hosted inside a dialog (the add-item picker) must see Escape
        // before the dialog's own overlay handler does, and stop it there.
        document.addEventListener('keydown', onKeyDown, true);
        onCleanup(() => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
        });
      });
    });

    const navigations = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart && this.open()) this.dismiss(false);
    });
    this.destroyRef.onDestroy(() => navigations.unsubscribe());
  }

  protected close(): void {
    this.dismiss(true);
  }

  private onOutsidePress(event: Event): void {
    const target = event.target;
    if (!(target instanceof Node) || !this.modal()) return;
    // Inside the panel is inside; the scrim (also in the host) is the outside under the pointer.
    if (this.host.nativeElement.querySelector('.hk-drawer__panel')?.contains(target)) return;
    // A dialog or sheet stacked above the drawer lives in the CDK overlay container: not outside.
    // The overlay that HOSTS the drawer (an add-item dialog) is not above it: pressing there is.
    if (target instanceof Element && target.closest('.cdk-overlay-container')) {
      const pane = target.closest('.cdk-overlay-pane');
      const hostedInOverlay = this.host.nativeElement.closest('.cdk-overlay-container') !== null;
      if (pane ? !pane.contains(this.host.nativeElement) : !hostedInOverlay) return;
    }
    const opener = this.openerElement();
    if (opener?.contains(target)) return;
    this.dismiss(false);
  }

  private overlayOpenAbove(): boolean {
    // A dialog or popover (menu, listbox) in a CDK overlay pane stacked above the drawer counts,
    // not the pane that hosts it. A pane that holds neither (a toast) never owns Escape.
    return Array.from(
      document.querySelectorAll(
        '.cdk-overlay-container .cdk-overlay-pane:has([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])',
      ),
    ).some((pane) => !pane.contains(this.host.nativeElement));
  }

  private ownsFocus(): boolean {
    const active = document.activeElement;
    return (
      !active ||
      active === document.body ||
      !!this.host.nativeElement.querySelector('.hk-drawer__panel')?.contains(active)
    );
  }

  private openerElement(): HTMLElement | null {
    const opener = this.opener();
    if (!opener) return null;
    return opener instanceof ElementRef ? opener.nativeElement : opener;
  }

  private dismiss(restoreFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (!restoreFocus) return;
    // An opener that left the DOM (its row re-rendered, its step closed) cannot take focus back.
    const target = [this.openerElement(), this.returnTo].find((el) => el?.isConnected);
    target?.focus();
  }
}
