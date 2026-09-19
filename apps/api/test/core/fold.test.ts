import { describe, expect, it } from 'vitest';
import { foldUsername } from '../../src/core/db/fold.ts';

describe('foldUsername', () => {
  it('lowercases plain ASCII', () => {
    expect(foldUsername('Alice')).toBe('alice');
  });

  it('folds full-width Latin (compatibility-decomposition) to plain lowercase ASCII', () => {
    // U+FF21..U+FF3A etc. ("ＡＬＩＣＥ") are NFKC-compatible with plain ASCII "ALICE".
    expect(foldUsername('ＡＬＩＣＥ')).toBe('alice');
  });

  it('lowercases Cyrillic the same way regardless of input case', () => {
    expect(foldUsername('Юра')).toBe(foldUsername('юра'));
    expect(foldUsername('Юра')).toBe('юра');
  });

  it('two visually-confusable spellings collide after folding', () => {
    expect(foldUsername('Alice')).toBe(foldUsername('ＡＬＩＣＥ'));
  });
});
