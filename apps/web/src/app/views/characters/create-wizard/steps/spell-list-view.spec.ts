import { signal } from '@angular/core';
import type { Localizer } from '@hk/engine';
import { SPELL_ROWS_PER_PAGE, SpellListView } from './spell-list-view';

const localizer = {
  locale: 'en',
  name: (id: string) => `Spell ${id}`,
  text: () => ({ text: '', locale: 'en', isFallback: false }),
  choicePrompt: () => ({ text: '', locale: 'en', isFallback: false }),
} satisfies Localizer;

describe('SpellListView', () => {
  const ids = Array.from({ length: 150 }, (_, i) => String(i).padStart(3, '0'));
  const make = () => new SpellListView(signal(ids), () => undefined, signal(localizer));

  it('renders one page of rows, then more on request, never the whole list at once', () => {
    const view = make();
    expect(view.rows()).toHaveLength(SPELL_ROWS_PER_PAGE);
    expect(view.hidden()).toBe(150 - SPELL_ROWS_PER_PAGE);
    view.showMore();
    expect(view.rows()).toHaveLength(2 * SPELL_ROWS_PER_PAGE);
    view.showMore();
    expect(view.rows()).toHaveLength(150);
    expect(view.hidden()).toBe(0);
  });

  it('searches the whole list, not just the page on screen', () => {
    const view = make();
    view.query.set('149');
    expect(view.rows()).toEqual(['149']);
    expect(view.hidden()).toBe(0);
  });

  it('offers a search only for a long list', () => {
    expect(make().showSearch()).toBe(true);
    expect(
      new SpellListView(signal(ids.slice(0, 5)), () => undefined, signal(localizer)).showSearch(),
    ).toBe(false);
  });
});
