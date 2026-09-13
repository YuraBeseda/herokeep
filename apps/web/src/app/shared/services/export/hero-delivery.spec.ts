import { deliverHeroBundle } from './hero-delivery';

const blob = new Blob(['zip bytes'], { type: 'application/zip' });
const fileName = 'Ivan.hero';

describe('deliverHeroBundle', () => {
  afterEach(() => {
    // jsdom itself never defines these — undo whatever a test stubbed onto the globals so the
    // next test (and every OTHER spec file sharing this jsdom instance) sees the ladder's true
    // first-available rung again.
    Reflect.deleteProperty(window, 'showSaveFilePicker');
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
    vi.restoreAllMocks();
  });

  it('uses showSaveFilePicker when available, writing the blob and returning "saved"', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const showSaveFilePicker = vi.fn().mockResolvedValue({ createWritable });
    Object.assign(window, { showSaveFilePicker });

    const outcome = await deliverHeroBundle(blob, fileName);

    expect(outcome).toBe('saved');
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: fileName }),
    );
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalled();
  });

  it('passes a caller-supplied description through to showSaveFilePicker (fix-wave review, minor finding 5: localized, never a bare English literal)', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const showSaveFilePicker = vi.fn().mockResolvedValue({ createWritable });
    Object.assign(window, { showSaveFilePicker });

    await deliverHeroBundle(blob, fileName, 'Персонаж Herokeep');

    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        types: [expect.objectContaining({ description: 'Персонаж Herokeep' })],
      }),
    );
  });

  it('the user cancelling the save picker (AbortError) returns "cancelled" without falling through', async () => {
    const showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    Object.assign(window, { showSaveFilePicker });
    const share = vi.fn();
    Object.assign(navigator, { share, canShare: vi.fn().mockReturnValue(true) });

    const outcome = await deliverHeroBundle(blob, fileName);

    expect(outcome).toBe('cancelled');
    expect(share).not.toHaveBeenCalled();
  });

  it('falls through to navigator.share when showSaveFilePicker is unavailable and canShare({files}) is true', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share, canShare: vi.fn().mockReturnValue(true) });

    const outcome = await deliverHeroBundle(blob, fileName);

    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    const call = share.mock.calls[0][0] as { files: File[] };
    expect(call.files).toHaveLength(1);
    expect(call.files[0]?.name).toBe(fileName);
  });

  it('skips navigator.share when canShare({files}) is false, falling through to the <a download> fallback', async () => {
    const share = vi.fn();
    Object.assign(navigator, { share, canShare: vi.fn().mockReturnValue(false) });
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-hero-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const outcome = await deliverHeroBundle(blob, fileName);

    expect(outcome).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-hero-url');
  });

  it('falls all the way to the <a download> fallback when neither API is available', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-hero-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const outcome = await deliverHeroBundle(blob, fileName);

    expect(outcome).toBe('downloaded');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-hero-url');
  });
});
