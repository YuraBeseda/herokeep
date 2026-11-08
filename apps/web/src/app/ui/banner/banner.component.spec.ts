import { hintOf, mount, press } from '../testing/harness';
import { HkBannerComponent } from './banner.component';

describe('HkBannerComponent', () => {
  it('is a status region with an optional title and the sentence', async () => {
    const { el } = await mount(HkBannerComponent, { heading: 'Offline' });
    expect(el.getAttribute('role')).toBeNull();
    const region = el.querySelector('[role="status"]')!;
    expect(region.querySelector('.hk-banner__title')!.textContent?.trim()).toBe('Offline');
  });

  it('is an alert when it reports a failure', async () => {
    const { el } = await mount(HkBannerComponent, { urgent: true });
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it('wears the variant class', async () => {
    const { el } = await mount(HkBannerComponent, { variant: 'arcane' });
    expect(el.querySelector('.hk-banner')!.classList.contains('hk-banner--arcane')).toBe(true);
  });

  it('has no dismiss control unless dismissable', async () => {
    const { el } = await mount(HkBannerComponent, {});
    expect(el.querySelector('button')).toBeNull();
  });

  it('dismisses through a named icon button with a hint, on a real press', async () => {
    const { fixture, el } = await mount(HkBannerComponent, { dismissable: true });
    const dismissed = vi.fn();
    fixture.componentInstance.dismissed.subscribe(dismissed);
    const button = el.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-label')).toBe('Close');
    expect(hintOf(button)).toBe('Close');
    press(button);
    expect(dismissed).toHaveBeenCalledTimes(1);
  });
});
