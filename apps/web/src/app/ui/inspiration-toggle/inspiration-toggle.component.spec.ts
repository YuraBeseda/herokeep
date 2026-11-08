import { hintOf, mount } from '../testing/harness';
import { HkInspirationToggleComponent } from './inspiration-toggle.component';

describe('HkInspirationToggleComponent', () => {
  it('is a toggle button showing "none" when off', async () => {
    const { el } = await mount(HkInspirationToggleComponent, { active: false });
    const button = el.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('.hk-toggle__word')!.textContent?.trim()).toBe('none');
    expect(el.querySelector('hk-icon')).not.toBeNull();
  });

  it('shows "available" and is pressed when on', async () => {
    const { el } = await mount(HkInspirationToggleComponent, { active: true });
    const button = el.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.hk-toggle__word')!.textContent?.trim()).toBe('available');
  });

  it('names the effect of pressing in its label and hint', async () => {
    const { fixture, el } = await mount(HkInspirationToggleComponent, { active: false });
    const button = el.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-label')).toBe(
      'Heroic inspiration: none. Press to mark a grant.',
    );
    fixture.componentRef.setInput('active', true);
    await fixture.whenStable();
    expect(button.getAttribute('aria-label')).toBe(
      'Heroic inspiration: available. Press to spend it.',
    );
    expect(hintOf(button)).toBe('Heroic inspiration: available. Press to spend it.');
  });

  it('emits the new state when pressed', async () => {
    const { fixture, el } = await mount(HkInspirationToggleComponent, { active: false });
    const seen: boolean[] = [];
    fixture.componentInstance.activeChange.subscribe((v) => seen.push(v));
    el.querySelector('button')!.click();
    fixture.componentRef.setInput('active', true);
    await fixture.whenStable();
    el.querySelector('button')!.click();
    expect(seen).toEqual([true, false]);
  });

  it('stays focusable but inert when blocked, with the reason only in the hint', async () => {
    const reason = 'The campaign does not allow self-granting';
    const { fixture, el } = await mount(HkInspirationToggleComponent, {
      active: false,
      disabledReason: reason,
    });
    const button = el.querySelector<HTMLButtonElement>('button')!;
    const seen: boolean[] = [];
    fixture.componentInstance.activeChange.subscribe((v) => seen.push(v));
    button.click();
    expect(seen).toEqual([]);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(hintOf(button)).toBe(reason);
    expect(el.textContent).not.toContain('campaign');
  });
});
