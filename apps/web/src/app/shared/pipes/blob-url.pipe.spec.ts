import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BlobsRepository } from '@shared/services/storage/blobs.repository';
import type { BlobRow } from '@shared/services/storage/dexie.db';
import { BlobUrlPipe } from './blob-url.pipe';

const ROW: BlobRow = {
  hash: 'sha256:abc',
  mime: 'image/webp',
  bytes: new Uint8Array([1, 2, 3]),
  size: 3,
  kind: 'thumb',
};

const ROW_B: BlobRow = {
  hash: 'sha256:def',
  mime: 'image/png',
  bytes: new Uint8Array([9, 9]),
  size: 2,
  kind: 'thumb',
};

@Component({
  selector: 'app-blob-url-host',
  imports: [BlobUrlPipe],
  template: `@if ((hash() | blobUrl)(); as url) {
    <img [src]="url" alt="" />
  }`,
})
class HostComponent {
  readonly hash = signal<string | undefined>(undefined);
}

describe('BlobUrlPipe', () => {
  let get: ReturnType<typeof vi.fn<BlobsRepository['get']>>;
  let createObjectURL: ReturnType<typeof vi.fn<(obj: Blob | MediaSource) => string>>;
  let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    get = vi.fn<BlobsRepository['get']>().mockResolvedValue(ROW);
    createObjectURL = vi.fn<(obj: Blob | MediaSource) => string>(() => 'blob:fake-url');
    revokeObjectURL = vi.fn<(url: string) => void>();
    // jsdom (this app's unit-test environment) does not reliably implement these — stub them
    // directly rather than depend on jsdom's actual Blob-URL support.
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    TestBed.configureTestingModule({
      providers: [{ provide: BlobsRepository, useValue: { get, put: vi.fn() } }],
    });
  });

  it('resolves a hash to an object URL created from the stored blob bytes/mime', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.hash.set('sha256:abc');
    await fixture.whenStable();

    expect(get).toHaveBeenCalledWith('sha256:abc');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0]?.[0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect((blobArg as Blob).type).toBe('image/webp');

    const img = (fixture.nativeElement as HTMLElement).querySelector('img');
    expect(img?.getAttribute('src')).toBe('blob:fake-url');
  });

  it('caches: transforming the SAME hash again does not re-fetch or re-create a second URL', async () => {
    const pipe = TestBed.runInInjectionContext(() => new BlobUrlPipe());
    const first = pipe.transform('sha256:abc');
    const second = pipe.transform('sha256:abc');
    expect(second).toBe(first); // same signal instance — no new fetch was even scheduled

    await Promise.resolve();
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes every object URL it created once the pipe is destroyed', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.hash.set('sha256:abc');
    await fixture.whenStable();
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    fixture.destroy();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('an undefined hash resolves to an undefined URL without ever calling the repository', async () => {
    const pipe = TestBed.runInInjectionContext(() => new BlobUrlPipe());
    const result = pipe.transform(undefined);
    expect(result()).toBeUndefined();
    await Promise.resolve();
    expect(get).not.toHaveBeenCalled();
  });

  it('a hash the repository cannot find leaves the signal undefined (no crash)', async () => {
    get.mockResolvedValue(undefined);
    const pipe = TestBed.runInInjectionContext(() => new BlobUrlPipe());
    const result = pipe.transform('sha256:missing');
    await Promise.resolve();
    await Promise.resolve();
    expect(result()).toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  // --- Fix round 1, finding 1: revoke-on-hash-change (no leak mid-lifecycle) -------------------

  it('revokes the PREVIOUS object URL as soon as a DIFFERENT hash arrives — not just at ngOnDestroy', async () => {
    get.mockImplementation((hash: string) =>
      Promise.resolve(hash === ROW.hash ? ROW : hash === ROW_B.hash ? ROW_B : undefined),
    );
    let urlCount = 0;
    createObjectURL.mockImplementation(() => `blob:fake-url-${++urlCount}`);

    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.hash.set(ROW.hash);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe(
      'blob:fake-url-1',
    );
    expect(revokeObjectURL).not.toHaveBeenCalled();

    // Same call site (one pipe instance, one binding), a DIFFERENT hash — e.g. a portrait
    // re-upload while the shell stays mounted, or a list row's thumbHash changing.
    fixture.componentInstance.hash.set(ROW_B.hash);
    await fixture.whenStable();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url-1');
    expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe(
      'blob:fake-url-2',
    );
    // Only ONE outstanding URL at a time — never revoked twice for the same value.
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes the current object URL when the hash flips back to undefined (e.g. portrait.cleared)', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.hash.set(ROW.hash);
    await fixture.whenStable();
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    fixture.componentInstance.hash.set(undefined);
    await fixture.whenStable();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    expect((fixture.nativeElement as HTMLElement).querySelector('img')).toBeNull();
  });

  it('a stale in-flight fetch for a SUPERSEDED hash resolves late but never creates a leaked object URL', async () => {
    // Each hash change returns its OWN fresh signal (see the pipe's own "IMPLEMENTATION NOTE
    // (NG0600)" doc) — a real template always reads the LATEST `transform()` return value, so
    // this asserts against THAT (`state`, from the second call), not the first (now-abandoned)
    // one.
    let resolveFirst!: (row: BlobRow) => void;
    get.mockImplementationOnce(() => new Promise<BlobRow>((resolve) => (resolveFirst = resolve)));
    get.mockImplementationOnce(() => Promise.resolve(ROW_B));
    let urlCount = 0;
    createObjectURL.mockImplementation(() => `blob:fake-url-${++urlCount}`);

    const pipe = TestBed.runInInjectionContext(() => new BlobUrlPipe());
    pipe.transform(ROW.hash); // starts loading ROW, still pending
    const state = pipe.transform(ROW_B.hash); // supersedes it before the first load ever resolved
    await Promise.resolve();
    await Promise.resolve();
    expect(state()).toBe('blob:fake-url-1'); // ROW_B's own load already won

    resolveFirst(ROW); // the stale first fetch finally resolves
    await Promise.resolve();
    await Promise.resolve();

    expect(state()).toBe('blob:fake-url-1'); // unchanged — the stale resolution was ignored
    expect(createObjectURL).toHaveBeenCalledTimes(1); // never created a URL for the stale ROW
  });
});
