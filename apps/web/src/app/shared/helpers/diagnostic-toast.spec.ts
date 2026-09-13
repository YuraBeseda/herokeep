import { diagnosticKey } from './diagnostic-toast';

describe('diagnosticKey', () => {
  it('maps a code present in knownCodes to its scope-relative validation.<code> key', () => {
    expect(diagnosticKey('selection.count', new Set(['selection.count']))).toBe(
      'validation.selection.count',
    );
  });

  it('falls back to validation.generic for a code absent from knownCodes', () => {
    expect(diagnosticKey('hitdice.none-left', new Set(['selection.count']))).toBe(
      'validation.generic',
    );
  });

  it('falls back to validation.generic for every code when knownCodes is empty', () => {
    expect(diagnosticKey('anything', new Set())).toBe('validation.generic');
  });
});
