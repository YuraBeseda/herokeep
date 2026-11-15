import { TestBed } from '@angular/core/testing';
import { HkStatTileComponent } from './stat-tile.component';

function make(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(HkStatTileComponent);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('HkStatTileComponent', () => {
  it('puts the label before the value (a labelled pair)', () => {
    const { el } = make({ label: 'Initiative', value: '+2' });
    expect(el.querySelector('.hk-stat-tile__label')!.textContent?.trim()).toBe('Initiative');
    expect(el.querySelector('.hk-stat-tile__value')!.textContent?.trim()).toBe('+2');
    expect(el.textContent?.replace(/\s+/g, ' ').trim()).toBe('Initiative +2');
  });

  it('draws the optional glyph beside the value, hidden from assistive tech', () => {
    const { el } = make({ label: 'Speed', value: '30 ft', icon: 'ui:speed' });
    expect(el.querySelector('.hk-stat-tile__value hk-icon use')!.getAttribute('href')).toBe(
      'assets/icons/sprite.svg#ui-speed',
    );
    expect(el.querySelector('.hk-stat-tile__value svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('has no glyph when none is given', () => {
    const { el } = make({ label: 'Speed', value: 30 });
    expect(el.querySelector('hk-icon')).toBeNull();
  });

  it('lights up when on', async () => {
    const { fixture, el } = make({ label: 'Inspiration', value: '1' });
    expect(el.classList.contains('hk-stat-tile--on')).toBe(false);
    fixture.componentRef.setInput('on', true);
    await fixture.whenStable();
    expect(el.classList.contains('hk-stat-tile--on')).toBe(true);
  });

  it('carries an optional hint as a described tooltip target', () => {
    const { fixture, el } = make({ label: 'Speed', value: 30, hint: 'Overridden by hand' });
    expect(el.hasAttribute('aria-describedby')).toBe(false);
    el.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(el.getAttribute('aria-describedby')).toMatch(/^hk-tip-/);
  });
});
