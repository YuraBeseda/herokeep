import { formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it('formats sub-kilobyte sizes with the "b" unit and no fraction', () => {
    expect(formatBytes(0, 'en')).toEqual({ amount: '0', unit: 'b' });
    expect(formatBytes(512, 'en')).toEqual({ amount: '512', unit: 'b' });
    expect(formatBytes(1023, 'en')).toEqual({ amount: '1,023', unit: 'b' });
  });

  it('switches to "kb" at 1024 bytes, one fraction digit', () => {
    expect(formatBytes(1024, 'en')).toEqual({ amount: '1', unit: 'kb' });
    expect(formatBytes(1536, 'en')).toEqual({ amount: '1.5', unit: 'kb' });
    expect(formatBytes(1024 * 1023, 'en')).toEqual({ amount: '1,023', unit: 'kb' });
  });

  it('switches to "mb" at 1024*1024 bytes, one fraction digit', () => {
    expect(formatBytes(1024 * 1024, 'en')).toEqual({ amount: '1', unit: 'mb' });
    expect(formatBytes(1024 * 1024 * 2.5, 'en')).toEqual({ amount: '2.5', unit: 'mb' });
  });

  it('formats the numeric amount per the given locale', () => {
    // Russian/Ukrainian use a comma as the decimal separator.
    expect(formatBytes(1536, 'ru').amount).toBe('1,5');
    expect(formatBytes(1024 * 1024 * 2.5, 'uk').amount).toBe('2,5');
  });

  it('never returns a display string containing a hardcoded unit word', () => {
    const result = formatBytes(2048, 'en');
    expect(result.amount).not.toMatch(/[A-Za-z]/);
  });
});
