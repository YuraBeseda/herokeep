# DialogService / hk-dialog

`DialogService` (root-provided) opens any standalone component into a CDK overlay,
wrapped in an `hk-dialog` shell that supplies the surface styling, backdrop, and focus
trap. Centered modal by default; pass `{ sheet: true }` for a full-width bottom sheet
(same overlay, different position/sizing — not a separate component).

## Usage

```ts
// confirm-delete.component.ts
@Component({ selector: 'app-confirm-delete', ... })
export class ConfirmDeleteComponent {
  protected readonly data = inject<{ name: string }>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  confirm(): void {
    this.dialogRef.close(true);
  }
}
```

```ts
const handle = this.dialogService.open(ConfirmDeleteComponent, { data: { name: 'Aria' } });
const confirmed = await handle.closed; // true | undefined (ESC/backdrop/no-arg close())
```

## API

`DialogService.open<T>(component: Type<T>, opts?: { data?: unknown; sheet?: boolean })`
returns `{ closed: Promise<unknown>; close(result?: unknown): void }`.

- `opts.data` is available in the opened component via `inject(DIALOG_DATA)`.
- The opened component can close itself via `inject(DialogRef).close(result)`; the caller
  can also close it externally via the returned handle's `close()`.
- ESC and a backdrop click both close with `result === undefined`.
- On open, focus moves into the dialog automatically (`cdkTrapFocusAutoCapture` on the
  `hk-dialog__surface` wrapper — the first tabbable element inside the opened component, or
  the surface itself if none). Don't drop `cdkTrapFocusAutoCapture` from the template; without
  it the trap still blocks Tab from leaving the dialog, but nothing ever moves focus in on
  open, leaving keyboard focus stuck on whatever triggered `open()`.
- Closing (any path) restores focus to whatever element had focus when `open()` was called.

## Do / Don't

Do keep the opened component "component-only" — there is no templates-as-content API, by
design; if you need one-off markup, wrap it in a tiny component. Don't assume `closed`
resolves with a specific shape — it's whatever `close(result)` was called with, `undefined`
for ESC/backdrop dismissal.
