import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { hintOf, mount, press } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkPartyCardComponent } from './party-card.component';

const base = {
  name: 'Mira Vale',
  subtitle: 'Wizard 5 · played by Sam',
  ac: 14,
  hpCurrent: 14,
  hpMax: 22,
  hpTemp: 0,
};

describe('HkPartyCardComponent', () => {
  it('is an article labelled by the hero name', async () => {
    const { el } = await mount(HkPartyCardComponent, base);
    const article = el.querySelector('article')!;
    const heading = el.querySelector<HTMLElement>('.hk-party__name-text')!;
    expect(heading.textContent?.trim()).toBe('Mira Vale');
    expect(article.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('shows the portrait, the class and player line and the armor class shield', async () => {
    const { el } = await mount(HkPartyCardComponent, base);
    expect(el.querySelector('hk-portrait-frame')).not.toBeNull();
    expect(el.querySelector('.hk-party__sub')!.textContent?.trim()).toBe(
      'Wizard 5 · played by Sam',
    );
    expect(el.querySelector('hk-shield-badge [role="img"], hk-shield-badge')!).not.toBeNull();
    expect(el.querySelector('hk-shield-badge')!.textContent).toContain('14');
  });

  it('draws the HP strap as a meter with a text alternative and a visible numeral', async () => {
    const { el } = await mount(HkPartyCardComponent, base);
    const meter = el.querySelector<HTMLElement>('[role="meter"]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('14');
    expect(meter.getAttribute('aria-valuemax')).toBe('22');
    expect(meter.getAttribute('aria-valuetext')).toBe('14 of 22 hit points');
    expect(el.querySelector('.hk-party__hp-num')!.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '14 / 22',
    );
  });

  it('names its meter after the hero', async () => {
    const { el } = await mount(HkPartyCardComponent, base);
    expect(el.querySelector('[role="meter"]')!.getAttribute('aria-label')).toBe(
      'Hit points of Mira Vale',
    );
  });

  it('mentions temporary hit points in the meter text and draws them', async () => {
    const { el } = await mount(HkPartyCardComponent, { ...base, hpTemp: 5 });
    expect(el.querySelector('[role="meter"]')!.getAttribute('aria-valuetext')).toBe(
      '14 of 22 hit points, plus 5 temporary',
    );
    expect(el.querySelector('.hk-gauge__temp')).not.toBeNull();
  });

  it('clamps a meter that is out of range and survives zero max', async () => {
    const { el } = await mount(HkPartyCardComponent, { ...base, hpCurrent: 30, hpMax: 0 });
    const meter = el.querySelector('[role="meter"]')!;
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
      Number(meter.getAttribute('aria-valuemax')),
    );
  });

  it('lists conditions as condition chips and omits the row when there are none', async () => {
    const { el } = await mount(HkPartyCardComponent, {
      ...base,
      conditions: [
        { id: 'p', name: 'Poisoned' },
        { id: 'e', name: 'Exhaustion', level: 2 },
      ],
    });
    const chips = Array.from(el.querySelectorAll('hk-condition-chip'));
    expect(chips.map((c) => c.querySelector('.hk-cond__name')!.textContent?.trim())).toEqual([
      'Poisoned',
      'Exhaustion',
    ]);
    const none = await mount(HkPartyCardComponent, base);
    expect(none.el.querySelector('hk-condition-chip')).toBeNull();
    expect(none.el.querySelector('.hk-party__chips')).toBeNull();
  });

  it('shows the concentration orb only when concentrating, explained by its hint', async () => {
    const on = await mount(HkPartyCardComponent, { ...base, concentrating: true });
    const orb = on.el.querySelector<HTMLElement>('.hk-party__orb')!;
    expect(orb.getAttribute('role')).toBe('img');
    expect(orb.getAttribute('aria-label')).toBe('Concentration');
    expect(hintOf(orb)).toBe('Concentration');
    const off = await mount(HkPartyCardComponent, base);
    expect(off.el.querySelector('.hk-party__orb')).toBeNull();
  });

  it('shows the inspiration mark with a hint when the hero has inspiration', async () => {
    const { el } = await mount(HkPartyCardComponent, { ...base, inspiration: true });
    const mark = el.querySelector<HTMLElement>('.hk-party__inspiration')!;
    expect(mark.getAttribute('aria-label')).toBe('Heroic inspiration');
    expect(hintOf(mark)).toBe('Heroic inspiration');
  });

  it('says online or offline in words, and nothing when unknown', async () => {
    const online = await mount(HkPartyCardComponent, { ...base, online: true });
    expect(online.el.querySelector('.hk-party__presence')!.textContent?.trim()).toBe('Online');
    const offline = await mount(HkPartyCardComponent, { ...base, online: false });
    expect(offline.el.querySelector('.hk-party__presence')!.textContent?.trim()).toBe('Offline');
    const unknown = await mount(HkPartyCardComponent, base);
    expect(unknown.el.querySelector('.hk-party__presence')).toBeNull();
  });

  it('shows a dying chip with the caller-given hint', async () => {
    const { el } = await mount(HkPartyCardComponent, {
      ...base,
      hpCurrent: 0,
      dying: true,
      dyingHint: 'Dying: 1 success, 2 failures',
    });
    const chip = el.querySelector<HTMLElement>('.hk-party__dying')!;
    expect(chip.textContent?.trim()).toBe('Dying');
    expect(hintOf(chip)).toBe('Dying: 1 success, 2 failures');
    expect(el.querySelector('.hk-party__hp-num--dying')).not.toBeNull();
  });

  it('has an open button that names the hero and emits open', async () => {
    const { fixture, el } = await mount(HkPartyCardComponent, base);
    let opened = 0;
    fixture.componentInstance.open.subscribe(() => opened++);
    const button = el.querySelector<HTMLButtonElement>('.hk-party__open')!;
    expect(button.getAttribute('aria-label')).toBe('Open Mira Vale');
    expect(hintOf(button)).toBe('Open Mira Vale');
    press(button);
    press(button, 'touch');
    expect(opened).toBe(2);
  });

  it('omits the open button when the card is not openable', async () => {
    const { el } = await mount(HkPartyCardComponent, { ...base, openable: false });
    expect(el.querySelector('.hk-party__open')).toBeNull();
    const openable = await mount(HkPartyCardComponent, base);
    expect(openable.el.querySelector('.hk-party__open')).not.toBeNull();
  });

  it('projects quick-effect chips into the fx row, which is empty (and hidden) without them', async () => {
    @Component({
      imports: [HkPartyCardComponent],
      template: `<hk-party-card
        [name]="'Mira'"
        [subtitle]="'x'"
        [ac]="12"
        [hpCurrent]="5"
        [hpMax]="9"
      >
        <div hkPartyFx id="fx"></div>
      </hk-party-card>`,
    })
    class Host {}
    await TestBed.configureTestingModule({
      providers: [provideShellTransloco()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.hk-party__fx #fx')).not.toBeNull();
    const bare = await mount(HkPartyCardComponent, base);
    expect(bare.el.querySelector('.hk-party__fx')!.children).toHaveLength(0);
  });
});
