import { hintOf, mount, press, typeInto } from '../testing/harness';
import { HkSearchFieldComponent } from './search-field.component';

const base = { label: 'Search the library', placeholder: 'Spells, items…' };

function input(el: HTMLElement) {
  return el.querySelector<HTMLInputElement>('input')!;
}
function clear(el: HTMLElement) {
  return el.querySelector<HTMLButtonElement>('.hk-search__clear');
}

describe('HkSearchFieldComponent', () => {
  afterEach(() => vi.useRealTimers());

  it('wraps a search input in a label and shows the placeholder', async () => {
    const { el } = await mount(HkSearchFieldComponent, base);
    expect(input(el).type).toBe('search');
    expect(input(el).placeholder).toBe('Spells, items…');
    expect(el.querySelector('label')!.contains(input(el))).toBe(true);
    expect(el.querySelector('.hk-visually-hidden')!.textContent?.trim()).toBe('Search the library');
  });

  it('commits the typed text 150ms after the last keystroke', async () => {
    const { fixture, el } = await mount(HkSearchFieldComponent, base);
    vi.useFakeTimers();
    typeInto(input(el), 'fi');
    vi.advanceTimersByTime(100);
    typeInto(input(el), 'fire');
    vi.advanceTimersByTime(149);
    expect(fixture.componentInstance.value()).toBe('');
    vi.advanceTimersByTime(1);
    expect(fixture.componentInstance.value()).toBe('fire');
  });

  it('shows the clear button only when there is text, and clears at once', async () => {
    const { fixture, el } = await mount(HkSearchFieldComponent, { ...base, value: 'fire' });
    expect(input(el).value).toBe('fire');
    expect(clear(el)).not.toBeNull();
    let cleared = 0;
    fixture.componentInstance.cleared.subscribe(() => cleared++);
    press(clear(el)!);
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('');
    expect(input(el).value).toBe('');
    expect(clear(el)).toBeNull();
    expect(cleared).toBe(1);
  });

  it('gives the clear button a name and a hint', async () => {
    const { el } = await mount(HkSearchFieldComponent, { ...base, value: 'x' });
    expect(clear(el)!.getAttribute('aria-label')).toBe('Clear search');
    expect(hintOf(clear(el)!)).toBe('Clear search');
  });

  it('clears on Escape while there is text, and leaves Escape alone when empty', async () => {
    const { fixture, el } = await mount(HkSearchFieldComponent, { ...base, value: 'fire' });
    const empty = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input(el).dispatchEvent(empty);
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('');
    expect(empty.defaultPrevented).toBe(true);
    const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input(el).dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
  });

  it('follows the value when the parent changes it', async () => {
    const { fixture, el } = await mount(HkSearchFieldComponent, base);
    fixture.componentRef.setInput('value', 'dagger');
    await fixture.whenStable();
    expect(input(el).value).toBe('dagger');
  });

  it('has the leather variant class', async () => {
    const { el } = await mount(HkSearchFieldComponent, { ...base, variant: 'leather' });
    expect(el.querySelector('.hk-search--leather')).not.toBeNull();
  });

  it('cancels a pending commit when destroyed', async () => {
    const { fixture, el } = await mount(HkSearchFieldComponent, base);
    vi.useFakeTimers();
    typeInto(input(el), 'x');
    const instance = fixture.componentInstance;
    fixture.destroy();
    vi.advanceTimersByTime(500);
    expect(instance.value()).toBe('');
  });
});
