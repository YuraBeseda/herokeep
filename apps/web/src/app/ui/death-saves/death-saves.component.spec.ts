import { hintOf, mount } from '../testing/harness';
import { HkDeathSavesComponent } from './death-saves.component';

function rings(el: HTMLElement, kind: 'success' | 'failure') {
  return Array.from(el.querySelectorAll<HTMLButtonElement>(`.hk-ring[data-kind="${kind}"]`));
}

describe('HkDeathSavesComponent', () => {
  it('has labelled Successes and Failures rows of three toggle buttons each', async () => {
    const { el } = await mount(HkDeathSavesComponent, { successes: 0, failures: 0 });
    const labels = Array.from(el.querySelectorAll('.hk-death__label')).map((l) =>
      l.textContent?.trim(),
    );
    expect(labels).toEqual(['Successes', 'Failures']);
    expect(rings(el, 'success')).toHaveLength(3);
    expect(rings(el, 'failure')).toHaveLength(3);
  });

  it('marks the first n rings as pressed with the marked hint', async () => {
    const { el } = await mount(HkDeathSavesComponent, { successes: 2, failures: 1 });
    expect(rings(el, 'success').map((r) => r.getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
      'false',
    ]);
    expect(rings(el, 'success').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Success, marked',
      'Success, marked',
      'Mark success',
    ]);
    expect(rings(el, 'failure').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Failure, marked',
      'Mark failure',
      'Mark failure',
    ]);
    expect(hintOf(rings(el, 'success')[2])).toBe('Mark success');
  });

  it('renders every ring through hk-wax-seal, filled when marked and spent otherwise', async () => {
    const { el } = await mount(HkDeathSavesComponent, { successes: 1, failures: 0 });
    const seals = Array.from(el.querySelectorAll('hk-wax-seal'));
    expect(seals).toHaveLength(6);
    expect(el.querySelectorAll('hk-wax-seal.hk-wax-seal--filled')).toHaveLength(1);
    expect(el.querySelectorAll('hk-wax-seal.hk-wax-seal--spent')).toHaveLength(5);
  });

  it('emits the ring that was pressed', async () => {
    const { fixture, el } = await mount(HkDeathSavesComponent, { successes: 0, failures: 0 });
    const seen: unknown[] = [];
    fixture.componentInstance.ringToggle.subscribe((v) => seen.push(v));
    rings(el, 'success')[1].click();
    rings(el, 'failure')[0].click();
    expect(seen).toEqual([
      { kind: 'success', index: 1 },
      { kind: 'failure', index: 0 },
    ]);
  });

  it('has a Roll button that emits roll', async () => {
    const { fixture, el } = await mount(HkDeathSavesComponent, { successes: 0, failures: 0 });
    const roll = el.querySelector<HTMLButtonElement>('.hk-death__roll')!;
    expect(roll.getAttribute('aria-label')).toBe('Roll');
    let rolled = 0;
    fixture.componentInstance.roll.subscribe(() => rolled++);
    roll.click();
    expect(rolled).toBe(1);
  });

  it('clamps out-of-range counts to the three rings', async () => {
    const { el } = await mount(HkDeathSavesComponent, { successes: 9, failures: -2 });
    expect(rings(el, 'success').every((r) => r.getAttribute('aria-pressed') === 'true')).toBe(true);
    expect(rings(el, 'failure').every((r) => r.getAttribute('aria-pressed') === 'false')).toBe(
      true,
    );
  });
});
