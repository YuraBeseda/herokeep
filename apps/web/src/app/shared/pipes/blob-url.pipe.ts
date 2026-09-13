import {
  inject,
  Pipe,
  signal,
  type OnDestroy,
  type PipeTransform,
  type Signal,
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
 * `transform()` call would fight this pipe's own hash-keyed CACHE (below). Returning a `Signal`
 * instead keeps the fetch-once-per-hash lifecycle explicit and lets a template compose it with
 * other signals the normal way.
 *
 * PURITY: marked `pure: true` (Angular's default — no `pure` option below), unlike
 * `EventSentencePipe`'s deliberate `pure: false`. That pipe must be impure because ITS return
 * value depends on external state (the active locale) the framework gives it no other way to
 * observe. This pipe's `transform(hash)` is a genuine pure function of its own argument: the SAME
 * `hash` string always yields the SAME cached `Signal` instance (see `cache`, below), and that
 * signal's own VALUE changes over time entirely through normal signal reactivity, not through
 * `transform()` being re-invoked — so Angular only needs to call `transform()` again when `hash`
 * itself changes, which is exactly the pure-pipe contract.
 *
 * CACHE + REVOKE: `cache` maps a hash to its long-lived signal so repeated `transform()` calls for
 * the same hash (a list re-rendering, a template re-evaluating) never re-fetch or leak a second
 * object URL. `objectUrls` remembers every URL THIS pipe instance created so `ngOnDestroy` (fired
 * once per template's own pipe binding when its host view is destroyed — Angular's normal pipe
 * lifecycle) revokes every one of them, per doc-07's object-URL lifecycle expectations.
 */
@Pipe({ name: 'blobUrl' })
export class BlobUrlPipe implements PipeTransform, OnDestroy {
  private readonly blobsRepository = inject(BlobsRepository);
  private readonly cache = new Map<string, Signal<string | undefined>>();
  private readonly objectUrls = new Map<string, string>();

  private static readonly EMPTY: Signal<string | undefined> = signal<string | undefined>(
    undefined,
  ).asReadonly();

  transform(hash: string | undefined): Signal<string | undefined> {
    if (!hash) return BlobUrlPipe.EMPTY;

    const cached = this.cache.get(hash);
    if (cached) return cached;

    const state = signal<string | undefined>(undefined);
    const readOnly = state.asReadonly();
    this.cache.set(hash, readOnly);
    void this.load(hash, state);
    return readOnly;
  }

  ngOnDestroy(): void {
    for (const url of this.objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
    this.cache.clear();
  }

  private async load(hash: string, state: { set(value: string | undefined): void }): Promise<void> {
    const row = await this.blobsRepository.get(hash);
    if (!row) return;
    // `Uint8Array`'s DOM lib type is generic over `ArrayBufferLike` (which admits
    // `SharedArrayBuffer`), while `BlobPart` requires a plain `ArrayBuffer` view — a real blob row
    // is always backed by a plain `ArrayBuffer` (structured-clone via IndexedDB, never a shared
    // buffer), so this cast is safe, not a type-check bypass of anything this code actually does.
    const url = URL.createObjectURL(
      new Blob([row.bytes as unknown as BlobPart], { type: row.mime }),
    );
    this.objectUrls.set(hash, url);
    state.set(url);
  }
}
