import { describe, expect, it } from 'vitest';
import { propose } from '../../src/propose/index.ts';

describe('propose.note', () => {
  it('"added" emits note.added with title and body', () => {
    expect(propose.note('added', { id: 'n1', title: 'Plot hook', body: 'Ask the barkeep.' })).toEqual([
      { type: 'note.added', v: 1, payload: { id: 'n1', title: 'Plot hook', body: 'Ask the barkeep.' } },
    ]);
  });

  it('"updated" with only body given omits title from the payload', () => {
    expect(propose.note('updated', { id: 'n1', body: 'New body.' })).toEqual([
      { type: 'note.updated', v: 1, payload: { id: 'n1', body: 'New body.' } },
    ]);
  });

  it('"removed" carries only id when title/body are not given', () => {
    expect(propose.note('removed', { id: 'n1' })).toEqual([{ type: 'note.removed', v: 1, payload: { id: 'n1' } }]);
  });
});
