import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  Component,
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
 */
@Component({
  selector: 'hk-drawer',
  imports: [CdkTrapFocus, HkIconButtonComponent],
  templateUrl: './drawer.component.html',
  styleUrl: './drawer.component.scss',
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
          // A dialog opened from the drawer owns Escape; its handler has already run (it prevents
          // default) or it is still open above us.
          if (this.dialogOpenAbove()) return;
          event.preventDefault();
          this.dismiss(true);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        onCleanup(() => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
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
    if (!(target instanceof Node)) return;
    // Inside the panel is inside; the scrim (also in the host) is the outside under the pointer.
    if (this.host.nativeElement.querySelector('.hk-drawer__panel')?.contains(target)) return;
    // A dialog or sheet stacked above the drawer lives in the CDK overlay container: not outside.
    if (target instanceof Element && target.closest('.cdk-overlay-container')) return;
    const opener = this.openerElement();
    if (opener?.contains(target)) return;
    this.dismiss(false);
  }

  private dialogOpenAbove(): boolean {
    return document.querySelector('.cdk-overlay-container hk-dialog') !== null;
  }

  private openerElement(): HTMLElement | null {
    const opener = this.opener();
    if (!opener) return null;
    return opener instanceof ElementRef ? opener.nativeElement : opener;
  }

  private dismiss(restoreFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (restoreFocus) (this.openerElement() ?? this.returnTo)?.focus();
  }
}
