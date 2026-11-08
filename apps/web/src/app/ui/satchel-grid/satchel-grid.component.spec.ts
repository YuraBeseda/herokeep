import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideShellTransloco } from '../testing/transloco-testing';
import type { BagItem } from '../bag-item';
import { hintOf, mount, press } from '../testing/harness';
import { HkSatchelGridComponent } from './satchel-grid.component';

const ring: BagItem = {
  id: 'ring',
  name: 'Ring of Protection',
  icon: 'gi:ring',
  rarity: 'rare',
  rarityLabel: 'rare',
  equipped: true,
  attuned: true,
  sub: '0/7',
  depleted: true,
};
const arrows: BagItem = {
  id: 'arrows',
  name: 'Arrows',
  icon: 'gi:arrow-cluster',
  qty: 20,
  sub: '1 lb',
};
const rope: BagItem = {
  id: 'rope',
  name: 'Hempen rope with a rather long name indeed',
  icon: 'gi:rope-coil',
};
const items = [ring, arrows, rope];

function slots(el: HTMLElement) {
  return Array.from(el.querySelectorAll<HTMLButtonElement>('button.hk-slot'));
}

describe('HkSatchelGridComponent', () => {
  it('lists one slot button per item and pads with empty slots up to the minimum', async () => {
    const { el } = await mount(HkSatchelGridComponent, { items });
    expect(el.querySelector('ul')!.getAttribute('aria-label')).toBe('Bag');
    expect(slots(el)).toHaveLength(3);
    const empty = el.querySelectorAll('.hk-slot--empty');
    expect(empty).toHaveLength(13);
    expect(Array.from(empty).every((e) => e.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('does not pad past the items when there are more than the minimum', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `i${i}`,
      name: `Item ${i}`,
      icon: 'gi:ring',
    }));
    const { el } = await mount(HkSatchelGridComponent, { items: many });
    expect(slots(el)).toHaveLength(20);
    expect(el.querySelectorAll('.hk-slot--empty')).toHaveLength(0);
  });

  it('names a slot with every visible value: name, rarity, sub-caption, quantity, equipped, attuned', async () => {
    const { el } = await mount(HkSatchelGridComponent, { items });
    expect(slots(el)[0].getAttribute('aria-label')).toBe(
      'Ring of Protection, rare, 0/7, Equipped, Attuned',
    );
    expect(slots(el)[1].getAttribute('aria-label')).toBe('Arrows, 1 lb, Quantity 20');
  });

  it('gives the whole sentence as the hint on the slot, so ellipsised captions are never lost', async () => {
    const { el } = await mount(HkSatchelGridComponent, { items });
    expect(hintOf(slots(el)[2])).toBe('Hempen rope with a rather long name indeed');
    expect(hintOf(slots(el)[0])).toBe('Ring of Protection, rare, 0/7, Equipped, Attuned');
  });

  it('shows the quantity plate only above one, with a hint', async () => {
    const { el } = await mount(HkSatchelGridComponent, { items });
    expect(slots(el)[0].querySelector('.hk-qty')).toBeNull();
    const qty = slots(el)[1].querySelector<HTMLElement>('.hk-qty')!;
    expect(qty.textContent?.trim()).toBe('×20');
    expect(qty.getAttribute('aria-label')).toBe('Quantity 20');
    expect(hintOf(qty)).toBe('Quantity 20');
  });

  it('marks equipped with a tag and attuned with a gem, each with its hint', async () => {
    const { el } = await mount(HkSatchelGridComponent, { items });
    const tag = slots(el)[0].querySelector<HTMLElement>('.hk-tagE')!;
    const gem = slots(el)[0].querySelector<HTMLElement>('.hk-gem')!;
    expect(tag.getAttribute('aria-label')).toBe('Equipped');
    expect(hintOf(tag)).toBe('Equipped');
    expect(gem.getAttribute('aria-label')).toBe('Attuned');
    expect(hintOf(gem)).toBe('Attuned');
    expect(slots(el)[1].querySelector('.hk-tagE')).toBeNull();
    expect(slots(el)[1].querySelector('.hk-gem')).toBeNull();
  });

  it('draws the rarity rim and always prints the rarity word in the sub-caption', async () => {
    const { el } = await mount(HkSatchelGridComponent, { items });
    const first = slots(el)[0];
    expect(first.classList.contains('hk-slot--rarity')).toBe(true);
    expect(first.style.getPropertyValue('--rim')).toBe('var(--rarity-rare)');
    expect(first.querySelector('.hk-slot__sub')!.textContent).toContain('rare');
    expect(slots(el)[1].classList.contains('hk-slot--rarity')).toBe(false);
  });

  it('flags an out-of-charges sub-caption', async () => {
    const { el } = await mount(HkSatchelGridComponent, { items });
    expect(slots(el)[0].querySelector('.hk-slot__sub--depleted')).not.toBeNull();
  });

  it('marks the selected slot as pressed', async () => {
    const { el } = await mount(HkSatchelGridComponent, { items, selectedId: 'arrows' });
    expect(slots(el).map((s) => s.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(slots(el)[1].classList.contains('hk-slot--on')).toBe(true);
  });

  it('emits select with the item id from a real press, mouse and touch', async () => {
    const { fixture, el } = await mount(HkSatchelGridComponent, { items });
    const seen: string[] = [];
    fixture.componentInstance.select.subscribe((id) => seen.push(id));
    press(slots(el)[1]);
    press(slots(el)[2], 'touch');
    expect(seen).toEqual(['arrows', 'rope']);
  });
});

describe('HkSatchelGridComponent selected-item actions', () => {
  it('projects the [hkItemActions] strip only while a slot is selected', async () => {
    @Component({
      imports: [HkSatchelGridComponent],
      template: `<hk-satchel-grid [items]="items" [selectedId]="selected()"
        ><div hkItemActions id="strip"></div
      ></hk-satchel-grid>`,
    })
    class Host {
      readonly items = items;
      readonly selected = signal<string | null>(null);
    }
    await TestBed.configureTestingModule({
      providers: [provideShellTransloco()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#strip')).toBeNull();
    fixture.componentInstance.selected.set('arrows');
    await fixture.whenStable();
    expect(el.querySelector('.hk-satchel__strip #strip')).not.toBeNull();
  });
});
