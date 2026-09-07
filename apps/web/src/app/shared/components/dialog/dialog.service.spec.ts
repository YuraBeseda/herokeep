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

function escapeKeydown(): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true });
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
});
