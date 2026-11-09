import { mount, press } from '../testing/harness';
import { HkStepperComponent, type StepItem } from './stepper.component';

const STEPS: readonly StepItem[] = [
  { id: 'name', label: 'Name', state: 'done', summary: 'Aldric' },
  { id: 'species', label: 'Species', state: 'current' },
  { id: 'class', label: 'Class', state: 'todo' },
  { id: 'skills', label: 'Class choices', state: 'locked', hint: 'Choose a class first' },
  {
    id: 'abilities',
    label: 'Ability scores',
    state: 'todo',
    invalid: true,
    hint: 'Needs 6 scores',
  },
];

function names(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('.hk-stepper__name')).map((n) => n.textContent.trim());
}

describe('HkStepperComponent', () => {
  describe('vertical', () => {
    it('lists every step in order inside a labelled nav', async () => {
      const { el } = await mount(HkStepperComponent, { steps: STEPS, current: 'species' });
      expect(el.querySelector('nav')!.getAttribute('aria-label')).toBe('Steps');
      expect(names(el)).toEqual(['Name', 'Species', 'Class', 'Class choices', 'Ability scores']);
    });

    it('marks the current step, shows a seal on a done step and a padlock on a locked one', async () => {
      const { el } = await mount(HkStepperComponent, { steps: STEPS, current: 'species' });
      const steps = Array.from(el.querySelectorAll('.hk-stepper__step'));
      expect(steps[1].getAttribute('aria-current')).toBe('step');
      expect(steps[1].classList.contains('hk-stepper__step--current')).toBe(true);
      expect(steps[0].querySelector('hk-wax-seal')).not.toBeNull();
      expect(steps[0].textContent).toContain('Done');
      expect(steps[3].querySelector('.hk-stepper__lock')).not.toBeNull();
      expect(el.querySelector('.hk-stepper__summary')!.textContent).toBe('Aldric');
    });

    it('explains an unreachable or invalid step only through its hint, never as inline text', async () => {
      const { el } = await mount(HkStepperComponent, { steps: STEPS, current: 'species' });
      const steps = Array.from(el.querySelectorAll<HTMLElement>('.hk-stepper__step'));
      const hint = (step: HTMLElement): string | null => {
        step.dispatchEvent(new Event('focus'));
        const text = document.body.querySelector('[role="tooltip"]')?.textContent ?? null;
        step.dispatchEvent(new Event('blur'));
        return text;
      };
      expect(hint(steps[3])).toContain('Choose a class first'); // locked group
      expect(hint(steps[4])).toContain('Needs 6 scores'); // invalid
      expect(hint(steps[2])).toContain('Finish the steps before it'); // to do
      expect(hint(steps[0])).toBeNull(); // done: nothing to explain
      expect(el.textContent).not.toContain('Needs 6 scores');
    });

    it('reports a click on a done, current or invalid step, never on a to-do or locked one', async () => {
      const { fixture, el } = await mount(HkStepperComponent, { steps: STEPS, current: 'species' });
      const selected: string[] = [];
      fixture.componentInstance.stepSelected.subscribe((id: string) => selected.push(id));
      const steps = Array.from(el.querySelectorAll<HTMLElement>('.hk-stepper__step'));
      for (const step of steps) press(step);
      expect(selected).toEqual(['name', 'species', 'abilities']);
      expect(steps[2].getAttribute('aria-disabled')).toBe('true');
      expect(steps[3].getAttribute('aria-disabled')).toBe('true');
    });
  });

  describe('strip', () => {
    it('shows "Step N of M" over the step name with a progress gauge', async () => {
      const { el } = await mount(HkStepperComponent, {
        steps: STEPS,
        current: 'class',
        variant: 'strip',
      });
      expect(el.querySelector('.hk-stepper__count')!.textContent).toBe('Step 3 of 5');
      expect(el.querySelector('.hk-stepper__strip-name')!.textContent).toBe('Class');
      const gauge = el.querySelector('[role="progressbar"]')!;
      expect(gauge.getAttribute('aria-valuenow')).toBe('3');
      expect(gauge.getAttribute('aria-valuetext')).toBe('Step 3 of 5 · Class');
    });

    it('opens the full list in a sheet from the All steps button and picks a step from it', async () => {
      const { fixture, el } = await mount(HkStepperComponent, {
        steps: STEPS,
        current: 'class',
        variant: 'strip',
      });
      const selected: string[] = [];
      fixture.componentInstance.stepSelected.subscribe((id: string) => selected.push(id));

      expect(el.querySelector('.hk-stepper__step')).toBeNull();
      const all = el.querySelector<HTMLButtonElement>('.hk-stepper__all')!;
      expect(all.getAttribute('aria-label')).toBe('All steps');
      press(all);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(names(el)).toEqual(['Name', 'Species', 'Class', 'Class choices', 'Ability scores']);
      press(el.querySelectorAll<HTMLElement>('.hk-stepper__step')[0]);
      expect(selected).toEqual(['name']);
    });
  });
});
