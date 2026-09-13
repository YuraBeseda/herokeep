import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
  type ComponentRef,
} from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  type CdkPortalOutletAttachedRef,
  type ComponentPortal,
  PortalModule,
} from '@angular/cdk/portal';

/** Per-instance suffix for an auto-assigned title id — module-scoped counter, not a UUID; same
 * "deterministic and good enough for an in-page DOM id" convention `SheetSectionComponent`'s own
 * `nextSheetSectionId` already uses. */
let nextDialogTitleId = 0;

/** The one CSS attribute selector every dialog CONTENT component's own title heading carries
 * (`<h2 class="…__title" data-dialog-title>` — see each consumer). A plain data attribute, not a
 * directive: the portal-attached content's injector is rooted at the app's own root (see
 * `dialog.service.ts`'s `contentInjector`), not at THIS component, so a directive couldn't inject
 * its way back up to register itself here anyway — reading the rendered DOM after attach is the
 * only thing that actually crosses that boundary. */
const DIALOG_TITLE_SELECTOR = '[data-dialog-title]';

// The shell every `DialogService.open()` call attaches to the overlay. It owns the visible
// "surface" (background, radius, sheet-vs-centered sizing), the focus trap, AND the dialog's own
// accessible name — the caller's own component is attached *inside* it via a nested
// `ComponentPortal`, injected as `contentPortal` — see dialog.service.ts.
//
// Accessible name (task-12 fix round — axe `aria-dialog-name`, serious: every dialog previously
// had `role="dialog" aria-modal="true"` and NO name at all): once the portal's content actually
// attaches, this shell looks for that content's OWN `[data-dialog-title]` element (every current
// dialog has exactly one — its title `<h2>`) and wires `aria-labelledby` to it, assigning that
// element a fresh id first if it doesn't already have one (never overwrites an existing id, so a
// consumer that already needs one of its own for something else is unaffected). A dialog whose
// content has no such element (none exist today, but `ariaLabel` covers one that might) falls back
// to the caller-supplied `ariaLabel` (`DialogOptions.ariaLabel` — `dialog.service.ts`) as a plain
// `aria-label` instead. Neither present -> neither attribute is set, same as before this fix — the
// fallback is a safety net, not a guarantee that silently masks a genuinely title-less dialog a
// future consumer forgets to label.
@Component({
  selector: 'hk-dialog',
  imports: [PortalModule, CdkTrapFocus],
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss',
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    '[class.hk-dialog--sheet]': 'sheet()',
    '[attr.aria-labelledby]': 'titleId()',
    '[attr.aria-label]': 'fallbackAriaLabel()',
  },
})
export class DialogComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly contentPortal = input.required<ComponentPortal<unknown>>();
  readonly sheet = input(false);
  /** Fallback accessible name (`DialogOptions.ariaLabel`) — only ever rendered as `aria-label` when
   * no `[data-dialog-title]` element was found in the attached content (see `onAttached`). */
  readonly ariaLabel = input<string | undefined>(undefined);

  protected readonly titleId = signal<string | undefined>(undefined);

  protected readonly fallbackAriaLabel = computed(() =>
    this.titleId() === undefined ? (this.ariaLabel() ?? null) : null,
  );

  /** `cdkPortalOutlet`'s `(attached)` — fires once, synchronously within the attaching change
   * detection pass, the moment the portal's component is CREATED and its host element inserted —
   * NOT once that component's own template has necessarily finished rendering. A `ComponentPortal`
   * (the only kind `DialogService.open()` ever creates) always yields a `ComponentRef`, never the
   * `EmbeddedViewRef` half of `CdkPortalOutletAttachedRef`.
   *
   * Every current dialog content wraps its title in `*transloco="let t"` (`TranslocoDirective`),
   * whose embedded view doesn't necessarily stamp synchronously within THIS same attach — confirmed
   * the hard way (a real consumer spec failed with a one-shot synchronous query here, even though
   * the exact same query against a translation-free test fixture in `dialog.service.spec.ts`
   * succeeded). So this tries the synchronous query first (cheap, and correct for anything that
   * doesn't need one more tick) and, only if that finds nothing yet, falls back to a
   * `MutationObserver` on the attached root — disconnected the instant a title is found OR this
   * dialog is destroyed, whichever comes first. This makes the wiring correct regardless of
   * whatever async rendering pattern a future dialog's content uses, not just today's transloco
   * timing specifically. */
  protected onAttached(ref: CdkPortalOutletAttachedRef): void {
    const nativeElement = (ref as ComponentRef<unknown>).location?.nativeElement as
      HTMLElement | undefined;
    if (!nativeElement) return;

    if (this.tryResolveTitle(nativeElement)) return;

    const observer = new MutationObserver(() => {
      if (this.tryResolveTitle(nativeElement)) observer.disconnect();
    });
    observer.observe(nativeElement, { childList: true, subtree: true });
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  /** Looks for `[data-dialog-title]` under `root` right now; if found, assigns it a fresh id
   * (unless it already has one — never overwritten) and publishes it via `titleId`. Returns
   * whether a title element was found, so `onAttached` knows whether it still needs the
   * `MutationObserver` fallback. */
  private tryResolveTitle(root: HTMLElement): boolean {
    const titleEl = root.querySelector<HTMLElement>(DIALOG_TITLE_SELECTOR);
    if (!titleEl) return false;
    if (!titleEl.id) {
      titleEl.id = `hk-dialog-title-${nextDialogTitleId++}`;
    }
    this.titleId.set(titleEl.id);
    return true;
  }
}
