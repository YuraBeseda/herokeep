import { defaultDeviceLabel } from './device-label';

describe('defaultDeviceLabel', () => {
  it('prefers userAgentData brands/platform when present (modern Chromium)', () => {
    const label = defaultDeviceLabel({
      userAgentData: {
        brands: [
          { brand: 'Not.A.Brand', version: '8' },
          { brand: 'Chromium', version: '124' },
          { brand: 'Google Chrome', version: '124' },
        ],
        platform: 'Windows',
      },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0',
    });
    expect(label).toBe('Chromium on Windows');
  });

  it('falls back to parsing userAgent for Firefox on Windows (no userAgentData)', () => {
    const label = defaultDeviceLabel({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    });
    expect(label).toBe('Firefox on Windows');
  });

  it('falls back to parsing userAgent for Safari on macOS', () => {
    const label = defaultDeviceLabel({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
    });
    expect(label).toBe('Safari on macOS');
  });

  it('recognizes Android and iOS platforms from the user agent string', () => {
    expect(
      defaultDeviceLabel({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/124.0.0.0' }),
    ).toBe('Chrome on Android');
    expect(
      defaultDeviceLabel({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1',
      }),
    ).toBe('Safari on iOS');
  });

  it('falls back to navigator.platform when the user agent has no recognizable platform token', () => {
    const label = defaultDeviceLabel({ userAgent: 'SomeWeirdBrowser/1.0', platform: 'FreeBSD' });
    expect(label).toBe('Browser on FreeBSD');
  });

  it('never returns an empty string — falls back to just the browser name with no platform at all', () => {
    const label = defaultDeviceLabel({ userAgent: 'SomeWeirdBrowser/1.0' });
    expect(label).toBe('Browser');
  });

  it('ignores the greasing "Not.A.Brand" entry even when it is the only brand present', () => {
    const label = defaultDeviceLabel({
      userAgentData: { brands: [{ brand: 'Not/A)Brand', version: '99' }], platform: 'Windows' },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
    });
    expect(label).toBe('Chrome on Windows');
  });
});
