import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { BagItem } from '../bag-item';
import { hintOf, mount, press } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkItemRowComponent } from './item-row.component';

const ring: BagItem = {
  id: 'ring',
  name: 'Ring of Protection',
  icon: 'gi:ring',
  rarity: 'rare',
  rarityLabel: 'rare',
  sub: '0/7',
  depleted: true,
  equipped: true,
  attuned: true,
  qty: 3,
};

function select(el: HTMLElement) {
  return el.querySelector<HTMLButtonElement>('.hk-item__select')!;
}
function details(el: HTMLElement) {
  return el.querySelector<HTMLButtonElement>('.hk-item__details')!;
}

describe('HkItemRowComponent', () => {
  it('shows the name over a sub-line with the rarity word and the sub text', async () => {
    const { el } = await mount(HkItemRowComponent, { item: ring });
    expect(el.querySelector('.hk-item__title')!.textContent?.trim()).toBe('Ring of Protection');
    expect(el.querySelector('.hk-item__sub')!.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'rare · 0/7',
    );
  });

  it('names the select button with every visible value', async () => {
    const { el } = await mount(HkItemRowComponent, { item: ring });
    expect(select(el).getAttribute('aria-label')).toBe(
      'Ring of Protection, rare, 0/7, Quantity 3, Equipped, Attuned',
    );
  });

  it('shows the equipped, attuned and quantity marks with their hints', async () => {
    const { el } = await mount(HkItemRowComponent, { item: ring });
    const tag = el.querySelector<HTMLElement>('.hk-tagE')!;
    const gem = el.querySelector<HTMLElement>('.hk-gem')!;
    const qty = el.querySelector<HTMLElement>('.hk-qty')!;
    expect(hintOf(tag)).toBe('Equipped');
    expect(hintOf(gem)).toBe('Attuned');
    expect(hintOf(qty)).toBe('Quantity 3');
    expect(qty.textContent?.trim()).toBe('×3');
  });

  it('gives an out-of-charges sub-caption the danger ink class', async () => {
    const { el } = await mount(HkItemRowComponent, { item: ring });
    expect(el.querySelector('.hk-item__sub--depleted')).not.toBeNull();
    const fine = await mount(HkItemRowComponent, { item: { ...ring, depleted: false } });
    expect(fine.el.querySelector('.hk-item__sub--depleted')).toBeNull();
  });

  it('omits marks that do not apply', async () => {
    const { el } = await mount(HkItemRowComponent, {
      item: { id: 'x', name: 'Rope', icon: 'gi:rope-coil' },
    });
    expect(el.querySelector('.hk-tagE, .hk-gem, .hk-qty')).toBeNull();
  });

  it('reports selection from a real press and shows pressed state', async () => {
    const { fixture, el } = await mount(HkItemRowComponent, { item: ring });
    let selected = 0;
    fixture.componentInstance.select.subscribe(() => selected++);
    press(select(el));
    press(select(el), 'touch');
    expect(selected).toBe(2);
    fixture.componentRef.setInput('selected', true);
    await fixture.whenStable();
    expect(select(el).getAttribute('aria-pressed')).toBe('true');
    expect(el.classList.contains('hk-item--selected')).toBe(true);
  });

  it('has a details button that names the item, hints, and emits details', async () => {
    const { fixture, el } = await mount(HkItemRowComponent, { item: ring });
    let opened = 0;
    fixture.componentInstance.details.subscribe(() => opened++);
    expect(details(el).getAttribute('aria-label')).toBe('Details of Ring of Protection');
    expect(hintOf(details(el))).toBe('Details of Ring of Protection');
    press(details(el));
    expect(opened).toBe(1);
  });

  it('puts the full name in a hint on the select button when it is ellipsised', async () => {
    const long = {
      id: 'l',
      name: 'A very long item name that cannot fit on a phone row',
      icon: 'gi:ring',
    };
    const { el } = await mount(HkItemRowComponent, { item: long });
    expect(hintOf(select(el))).toBe('A very long item name that cannot fit on a phone row');
  });

  it('renders an unidentified item in italics and says so in its name', async () => {
    const { el } = await mount(HkItemRowComponent, {
      item: { id: 'u', name: 'Mysterious ring', icon: 'gi:ring', unknown: true },
    });
    expect(el.querySelector('.hk-item__title--unknown')).not.toBeNull();
    expect(select(el).getAttribute('aria-label')).toBe('Mysterious ring, Unknown item');
  });

  it('reveals the projected action strip only while selected', async () => {
    @Component({
      imports: [HkItemRowComponent],
      template: `<hk-item-row [item]="item" [selected]="on()"
        ><div hkItemActions id="strip"></div
      ></hk-item-row>`,
    })
    class Host {
      item = ring;
      on = signal(false);
    }
    await TestBed.configureTestingModule({
      providers: [provideShellTransloco()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#strip')).toBeNull();
    fixture.componentInstance.on.set(true);
    await fixture.whenStable();
    expect(el.querySelector('#strip')).not.toBeNull();
  });
});
