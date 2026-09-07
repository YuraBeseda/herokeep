# ToastService / hk-toast

`ToastService` (root-provided) queues short, auto-dismissing notifications in a single
shared CDK overlay (`hk-toast`, an `aria-live="polite"` region). Lazily creates its
overlay on the first `show()` call.

## Usage

```ts
private readonly toast = inject(ToastService);

save(): void {
  this.toast.show('library.toast.saved');
}

delete(name: string): void {
  this.toast.show('library.toast.deleted', { name });
}
```

## API

`show(key: string, params?: Record<string, unknown>): void`

- `key` is a **full, global** Transloco key (same global-resolution approach as
  `hk-search-field` — see that SKILL.md — since `hk-toast` renders `*transloco="let t"`
  with no scope of its own and calls `t(key, params)`).
- `params` are interpolated with Transloco's default `{{param}}` substitution.
- At most **3 toasts are visible at once**; a 4th `show()` call queues until a slot frees.
- Each visible toast auto-dismisses after **4000ms**; dismissing promotes the next queued
  toast (if any), which then gets its own fresh 4000ms timer starting from that moment.

## Do / Don't

Do call `show()` for fire-and-forget confirmations; there's no return value or ability to
dismiss a specific toast early — it isn't meant for anything the user needs to act on. Don't
rely on toast text alone for anything critical — screen readers announce it via
`aria-live="polite"`, which can be missed if it fires alongside other, more assertive
announcements.
