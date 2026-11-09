import { readStored, writeStored } from './safe-storage';

describe('safe-storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('hk.test');
  });

  it('round-trips a value', () => {
    writeStored('hk.test', 'x');
    expect(readStored('hk.test')).toBe('x');
  });

  it('reads null for a key never written', () => {
    expect(readStored('hk.test')).toBeNull();
  });

  it('never throws when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(readStored('hk.test')).toBeNull();
    expect(() => writeStored('hk.test', 'x')).not.toThrow();
  });
});
