import {
  inject,
  Pipe,
  signal,
  type OnDestroy,
  type PipeTransform,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';

/**
 * `hash | blobUrl` → a `Signal<string | undefined>` of a `blob:` object URL for that
 * `BlobsRepository` row (`undefined` while the fetch is in flight, `hash` is falsy, or no row
 * exists). A caller reads the CURRENT value by calling the returned signal in the template:
 * `[src]="(portrait.hash | blobUrl)()"` — consistent with this codebase's zoneless/signals style
 * everywhere else (`CharacterStore`'s own signal-typed public API, etc.).
 *
 * ASYNC PIPE PATTERN CHOICE (task-8-brief.md asks this be documented): this codebase has exactly
 * one pre-existing `@Pipe` (`event-sentence.pipe.ts`'s `EventSentencePipe`), and it's synchronous
 * — no async precedent to follow. Angular's own `AsyncPipe` unwraps a `Promise`/`Observable`
 * directly to a value, but that shape doesn't fit here: `BlobsRepository.get` is a plain `Promise`
 * with no natural "repeat on every change" semantics, and re-subscribing an `Observable` per
 * `transform()` call would fight this pipe's own per-instance CURRENT-value tracking (below).
 * Returning a `Signal` instead keeps the fetch lifecycle explicit and lets a template compose it
 * with other signals the normal way.
 *
 * PURITY: marked `pure: true` (Angular's default — no `pure` option below), unlike
 * `EventSentencePipe`'s deliberate `pure: false`. That pipe must be impure because ITS return
 * value depends on external state (the active locale) the framework gives it no other way to
 * observe. This pipe's `transform(hash)` is a genuine pure function of its own argument: the SAME
 * `hash` string always yields the SAME `Signal` instance for as long as this pipe instance hasn't
 * moved on to a different hash (see `currentState`, below), and that signal's own VALUE changes
 * over time entirely through normal signal reactivity, not through `transform()` being re-invoked
 * — so Angular only needs to call `transform()` again when `hash` itself changes, which is exactly
 * the pure-pipe contract.
 *
 * CURRENT-VALUE TRACKING + REVOKE (fix-round 1, finding 1): Angular creates one pipe INSTANCE per
 * template binding location (one per row in a `@for`, or once for a non-repeated binding) — so
 * instance fields are a valid per-call-site tracker. This pipe tracks exactly ONE "current"
 * hash/url pair per instance, not a hash-keyed cache of every hash it's ever seen: a call site only
 * ever needs to DISPLAY one hash at a time, and a hash-keyed cache (this pipe's pre-fix-round-1
 * shape) would accumulate an object URL per DISTINCT hash a call site is ever bound to over its
 * lifetime — leaking every superseded one until the whole pipe instance (not just that one stale
 * URL) is destroyed. A portrait re-upload (the shell header stays mounted, `thumbHash` changes) or
 * a list row's thumb changing are exactly this case. `transform()` now revokes the PREVIOUS
 * instance-current URL (if any) the moment a DIFFERENT hash arrives — including a transition to/
 * from `undefined` — before starting the new fetch, so at most one object URL is ever outstanding
 * per pipe instance at a time.
 *
 * IMPLEMENTATION NOTE (NG0600): `transform()` runs DURING Angular's template render pass, which
 * forbids writing to an EXISTING signal synchronously (`signal.set(...)` inside a pure-pipe
 * evaluation throws `NG0600`). `URL.revokeObjectURL(...)` is a plain side effect, not a signal
 * write, so it's safe to call synchronously here — but starting a new hash's loading state is done
 * by handing back a freshly-CONSTRUCTED `signal(undefined)` (initialization, not a write to an
 * already-published signal) rather than resetting the previous one; only `load()`'s own
 * post-`await` `.set()` ever mutates a signal that's already been returned to a template, which is
 * always safe (it runs as a microtask/macrotask, never mid-render). `loadToken` guards against a
 * stale in-flight fetch (for a hash this instance has since moved on from) resolving late and
 * clobbering a newer hash's state.
 */
@Pipe({ name: 'blobUrl' })
export class BlobUrlPipe implements PipeTransform, OnDestroy {
  private readonly blobsRepository = inject(BlobsRepository);

  // This instance's current hash/signal/url — see class doc. `currentHash` starts `undefined`,
  // which is itself a valid "current" value (matches `transform(undefined)` on first call, below).
  private currentHash: string | undefined;
  private currentUrl: string | undefined;
  private currentState: Signal<string | undefined> = signal<string | undefined>(
    undefined,
  ).asReadonly();
  // Incremented on every hash change; an in-flight `load()` only applies its result if this is
  // still the token it was handed — see `load()`.
  private loadToken = 0;

  transform(hash: string | undefined): Signal<string | undefined> {
    if (hash === this.currentHash) return this.currentState;

    this.currentHash = hash;
    this.revokeCurrentUrl();

    const state = signal<string | undefined>(undefined);
    this.currentState = state.asReadonly();
    const token = ++this.loadToken;
    if (hash) void this.load(hash, token, state);
    return this.currentState;
  }

  ngOnDestroy(): void {
    this.revokeCurrentUrl();
  }

  private revokeCurrentUrl(): void {
    if (this.currentUrl === undefined) return;
    URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = undefined;
  }

  private async load(
    hash: string,
    token: number,
    state: WritableSignal<string | undefined>,
  ): Promise<void> {
    const row = await this.blobsRepository.get(hash);
    // A NEWER `transform()` call (a different hash) may have superseded this fetch while it was
    // in flight — bail WITHOUT creating an object URL at all, so there is never one to revoke for
    // a hash this instance no longer displays.
    if (token !== this.loadToken || !row) return;
    // `Uint8Array`'s DOM lib type is generic over `ArrayBufferLike` (which admits
    // `SharedArrayBuffer`), while `BlobPart` requires a plain `ArrayBuffer` view — a real blob row
    // is always backed by a plain `ArrayBuffer` (structured-clone via IndexedDB, never a shared
    // buffer), so this cast is safe, not a type-check bypass of anything this code actually does.
    const url = URL.createObjectURL(
      new Blob([row.bytes as unknown as BlobPart], { type: row.mime }),
    );
    this.currentUrl = url;
    state.set(url);
  }
}
