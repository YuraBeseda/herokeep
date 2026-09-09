import { TestBed } from '@angular/core/testing';
import { InstallPromptService } from './install-prompt.service';

/** Minimal shape of the (non-standard, Chromium-only) `beforeinstallprompt` event this service
 * listens for — `Event` itself has none of these members, so tests build a plain object and
 * dispatch it through `window.dispatchEvent`, which is exactly how the real event arrives. */
function fireBeforeInstallPrompt(userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>): {
  prompt: ReturnType<typeof vi.fn>;
} {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: typeof prompt;
    userChoice: typeof userChoice;
  };
  event.prompt = prompt;
  event.userChoice = userChoice;
  window.dispatchEvent(event);
  return { prompt };
}

describe('InstallPromptService', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: navigator.userAgent,
    });
  });

  it('starts with canInstall false', () => {
    const service = TestBed.inject(InstallPromptService);
    expect(service.canInstall()).toBe(false);
  });

  it('exposes canInstall after a synthetic beforeinstallprompt', () => {
    const service = TestBed.inject(InstallPromptService);

    fireBeforeInstallPrompt(Promise.resolve({ outcome: 'accepted' }));

    expect(service.canInstall()).toBe(true);
  });

  it('prompt() replays the captured event and resolves true when accepted', async () => {
    const service = TestBed.inject(InstallPromptService);
    const { prompt } = fireBeforeInstallPrompt(Promise.resolve({ outcome: 'accepted' }));

    await expect(service.prompt()).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(service.canInstall()).toBe(false);
  });

  it('prompt() resolves false when dismissed, and clears canInstall either way', async () => {
    const service = TestBed.inject(InstallPromptService);
    fireBeforeInstallPrompt(Promise.resolve({ outcome: 'dismissed' }));

    await expect(service.prompt()).resolves.toBe(false);
    expect(service.canInstall()).toBe(false);
  });

  it('prompt() resolves false when no event was ever captured', async () => {
    const service = TestBed.inject(InstallPromptService);
    await expect(service.prompt()).resolves.toBe(false);
  });

  it('clears canInstall on appinstalled', () => {
    const service = TestBed.inject(InstallPromptService);
    fireBeforeInstallPrompt(Promise.resolve({ outcome: 'accepted' }));
    expect(service.canInstall()).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));

    expect(service.canInstall()).toBe(false);
  });

  it('showIosHint is true on an iOS Safari-shaped user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });

    const service = TestBed.inject(InstallPromptService);

    expect(service.showIosHint()).toBe(true);
  });

  it('showIosHint is false on a non-iOS user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    });

    const service = TestBed.inject(InstallPromptService);

    expect(service.showIosHint()).toBe(false);
  });
});
