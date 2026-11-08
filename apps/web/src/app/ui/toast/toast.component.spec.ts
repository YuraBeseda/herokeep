import { hintOf, mount, press } from '../testing/harness';
import { HkToastComponent } from './toast.component';

describe('HkToastComponent', () => {
  it('shows the message and an optional detail line as a status', async () => {
    const { el } = await mount(HkToastComponent, { message: 'Rolled 17', detail: '1d20 (12) + 5' });
    const toast = el.querySelector('.hk-toast')!;
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.querySelector('.hk-toast__body')!.textContent).toContain('Rolled 17');
    expect(toast.querySelector('.hk-toast__sub')!.textContent?.trim()).toBe('1d20 (12) + 5');
  });

  it('is an alert, and wears its class, for an error', async () => {
    const { el } = await mount(HkToastComponent, { message: 'Could not save', variant: 'error' });
    const toast = el.querySelector('.hk-toast')!;
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.classList.contains('hk-toast--error')).toBe(true);
  });

  it('dismisses through a named icon button on a real press', async () => {
    const { fixture, el } = await mount(HkToastComponent, { message: 'Saved', dismissable: true });
    const dismissed = vi.fn();
    fixture.componentInstance.dismissed.subscribe(dismissed);
    const button = el.querySelector<HTMLButtonElement>('button')!;
    expect(hintOf(button)).toBe('Close');
    press(button);
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  it('has no button unless dismissable', async () => {
    const { el } = await mount(HkToastComponent, { message: 'Saved' });
    expect(el.querySelector('button')).toBeNull();
  });
});
