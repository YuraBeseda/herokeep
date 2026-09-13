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
});
