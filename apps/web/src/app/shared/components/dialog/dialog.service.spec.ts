import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DIALOG_DATA, DialogRef, DialogService } from './dialog.service';

@Component({
  selector: 'app-test-dialog-content',
  template: `<button type="button" class="content-button">{{ data }}</button>`,
})
class TestDialogContentComponent {
  protected readonly data = inject(DIALOG_DATA);
  protected readonly dialogRef = inject(DialogRef);
}

/** The exact accessible-name text this fixture's title resolves to — asserted against directly in
 * the specs below, and interpolated (never a literal text node, same convention
 * `TestDialogContentComponent` above already uses) so `@angular-eslint/template/i18n` has nothing
 * to flag in a component that only ever exists for this spec. */
const TEST_TITLE_TEXT = 'Delete this thing?';

// task-12 fix round (axe `aria-dialog-name`, serious): every dialog content component's own title
// heading carries `[data-dialog-title]` — `DialogComponent` looks for it after the portal attaches
// and wires the shell's `aria-labelledby` to it. This fixture mirrors that real-consumer shape
// (a titled `<h2 data-dialog-title>`), unlike `TestDialogContentComponent` above (deliberately
// title-less, for the fallback/no-name-at-all cases already covered).
@Component({
  selector: 'app-test-titled-dialog-content',
  template: `<h2 data-dialog-title>{{ titleText }}</h2>
    <button type="button" class="content-button">{{ confirmText }}</button>`,
})
class TestTitledDialogContentComponent {
  protected readonly titleText = TEST_TITLE_TEXT;
  protected readonly confirmText = 'confirm';
}

function escapeKeydown(): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true });
}

// plan-10 task-7 fix round 1 (finding 1): a real consumer (`LeaveCampaignDialogComponent`) calls
// `DialogRef.setDismissible` itself, from inside its own busy/settled lifecycle — this fixture
// exposes the same call via two plain buttons so the specs below can drive it exactly the way a
// real opened component would, rather than reaching into DI for the instance directly (the content
// component lives in its OWN child injector, created per `open()` call — not one `TestBed.inject`
// can reach from the test's own root injector).
@Component({
  selector: 'app-test-dismissible-dialog-content',
  template: `
    <button type="button" class="block-dismiss" (click)="dialogRef.setDismissible(false)">
      {{ blockText }}
    </button>
    <button type="button" class="allow-dismiss" (click)="dialogRef.setDismissible(true)">
      {{ allowText }}
    </button>
  `,
})
class TestDismissibleDialogContentComponent {
  protected readonly dialogRef = inject(DialogRef);
  // Interpolated (never a literal text node) — same convention `TestTitledDialogContentComponent`
  // above already establishes — so `@angular-eslint/template/i18n` has nothing to flag in a
  // fixture that only ever exists for this spec.
  protected readonly blockText = 'block';
  protected readonly allowText = 'allow';
}

describe('DialogService', () => {
  let service: DialogService;
  let trigger: HTMLButtonElement;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DialogService);
    trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
  });

  afterEach(() => {
    // CDK appends its overlay container directly to <body>; nothing else tears it down
    // between tests, so remove it explicitly to avoid leaking overlays across specs.
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    trigger.remove();
  });

  it('opens the given component inside the overlay and injects DIALOG_DATA', () => {
    const handle = service.open(TestDialogContentComponent, { data: 'hello dialog' });
    TestBed.tick();

    const overlay = document.querySelector('.cdk-overlay-container');
    expect(overlay?.querySelector('hk-dialog')).not.toBeNull();
    expect(overlay?.textContent).toContain('hello dialog');

    handle.close();
  });

  it('moves focus into the dialog panel on open (cdkTrapFocusAutoCapture)', () => {
    // `@angular/cdk/a11y`'s `InteractivityChecker.isVisible` requires `hasGeometry()` (real
    // `offsetWidth`/`offsetHeight`/`getClientRects()`), which jsdom never reports as non-zero —
    // so every element looks invisible/unfocusable to the focus trap unless geometry is
    // stubbed, regardless of how many ticks run. This mirrors what a real browser reports for
    // any rendered, visible element.
    const getClientRects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue([{}] as unknown as DOMRectList);
    try {
      const handle = service.open(TestDialogContentComponent);
      // `cdkTrapFocusAutoCapture`'s initial-focus capture is registered via `afterNextRender`
      // from inside `ngAfterContentInit` during the first tick — it only runs on a
      // *subsequent* tick, not synchronously within the same one that attaches the component.
      TestBed.tick();
      TestBed.tick();

      const surface = document.querySelector('.hk-dialog__surface')!;
      expect(surface).not.toBeNull();
      expect(document.activeElement).not.toBe(trigger);
      expect(surface.contains(document.activeElement)).toBe(true);

      handle.close();
    } finally {
      getClientRects.mockRestore();
    }
  });

  it('closes on Escape, resolves the closed promise, and restores focus', async () => {
    const handle = service.open(TestDialogContentComponent);
    TestBed.tick();

    const contentButton = document.querySelector<HTMLButtonElement>('.content-button')!;
    contentButton.focus();
    expect(document.activeElement).toBe(contentButton);

    // `OverlayKeyboardDispatcher` listens on `document.body` (via `Renderer2.listen('body', ...)`),
    // not `document` — dispatching there directly (rather than on some descendant that bubbles
    // up to it) is what its listener actually observes.
    document.body.dispatchEvent(escapeKeydown());
    TestBed.tick();

    const result = await handle.closed;
    expect(result).toBeUndefined();
    expect(document.querySelector('hk-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('applies the sheet class variant when opened with { sheet: true }', () => {
    const handle = service.open(TestDialogContentComponent, { sheet: true });
    TestBed.tick();

    const shell = document.querySelector('hk-dialog');
    expect(shell?.classList.contains('hk-dialog--sheet')).toBe(true);

    handle.close();
  });

  it('does not apply the sheet class by default', () => {
    const handle = service.open(TestDialogContentComponent);
    TestBed.tick();

    const shell = document.querySelector('hk-dialog');
    expect(shell?.classList.contains('hk-dialog--sheet')).toBe(false);

    handle.close();
  });

  it('closes on a backdrop click, resolving the closed promise with undefined', async () => {
    const handle = service.open(TestDialogContentComponent);
    TestBed.tick();

    const backdrop = document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!;
    expect(backdrop).not.toBeNull();
    backdrop.click();
    TestBed.tick();

    expect(await handle.closed).toBeUndefined();
    expect(document.querySelector('hk-dialog')).toBeNull();
  });

  it('close(result) resolves the closed promise with that result', async () => {
    const handle = service.open(TestDialogContentComponent);
    TestBed.tick();

    handle.close('confirmed');

    expect(await handle.closed).toBe('confirmed');
  });

  // plan-10 task-7 fix round 1 (finding 1): a multi-step operation in flight (e.g. a campaign
  // leave sequence between its two acks) must not be silently abandonable via ESC/backdrop.
  describe('DialogRef.setDismissible', () => {
    it('blocks Escape from closing the dialog while dismissible(false)', () => {
      const handle = service.open(TestDismissibleDialogContentComponent);
      TestBed.tick();
      document.querySelector<HTMLButtonElement>('.block-dismiss')!.click();

      document.body.dispatchEvent(escapeKeydown());
      TestBed.tick();

      expect(document.querySelector('hk-dialog')).not.toBeNull();
      handle.close();
    });

    it('blocks a backdrop click from closing the dialog while dismissible(false)', () => {
      const handle = service.open(TestDismissibleDialogContentComponent);
      TestBed.tick();
      document.querySelector<HTMLButtonElement>('.block-dismiss')!.click();

      document.querySelector<HTMLElement>('.cdk-overlay-backdrop')!.click();
      TestBed.tick();

      expect(document.querySelector('hk-dialog')).not.toBeNull();
      handle.close();
    });

    it('re-allows ESC/backdrop dismissal once set back to dismissible(true)', async () => {
      const handle = service.open(TestDismissibleDialogContentComponent);
      TestBed.tick();
      document.querySelector<HTMLButtonElement>('.block-dismiss')!.click();
      document.querySelector<HTMLButtonElement>('.allow-dismiss')!.click();

      document.body.dispatchEvent(escapeKeydown());
      TestBed.tick();

      expect(await handle.closed).toBeUndefined();
      expect(document.querySelector('hk-dialog')).toBeNull();
    });

    it("never blocks the opened component's OWN explicit close() — only the passive ESC/backdrop paths", async () => {
      const handle = service.open(TestDismissibleDialogContentComponent);
      TestBed.tick();
      document.querySelector<HTMLButtonElement>('.block-dismiss')!.click();

      handle.close('confirmed');

      expect(await handle.closed).toBe('confirmed');
    });
  });

  // task-12 fix round (axe `aria-dialog-name`, serious — every dialog previously had
  // `role="dialog" aria-modal="true"` and NO accessible name at all; never caught because no
  // e2e test had opened a dialog before task 12's own scenario (d)).

  it('gives the role="dialog" panel an accessible name via aria-labelledby, wired to the content\'s own [data-dialog-title] element', () => {
    const handle = service.open(TestTitledDialogContentComponent);
    TestBed.tick();

    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel).not.toBeNull();

    const labelledBy = panel.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const titleEl = document.getElementById(labelledBy!);
    expect(titleEl?.textContent).toBe(TEST_TITLE_TEXT);
    // The accessible-name computation axe performs: aria-labelledby wins, and it resolves.
    expect(panel.hasAttribute('aria-label')).toBe(false);

    handle.close();
  });

  it('falls back to the given ariaLabel when the content has no [data-dialog-title] element', () => {
    const handle = service.open(TestDialogContentComponent, { ariaLabel: 'Fallback dialog name' });
    TestBed.tick();

    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.getAttribute('aria-label')).toBe('Fallback dialog name');
    expect(panel.hasAttribute('aria-labelledby')).toBe(false);

    handle.close();
  });

  it('has neither aria-labelledby nor aria-label when the content has no title and no ariaLabel was given (the un-fixed, still-broken shape)', () => {
    const handle = service.open(TestDialogContentComponent);
    TestBed.tick();

    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.hasAttribute('aria-labelledby')).toBe(false);
    expect(panel.hasAttribute('aria-label')).toBe(false);

    handle.close();
  });
});
