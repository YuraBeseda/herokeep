import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FlowController } from './flow-controller';

interface Step {
  readonly id: string;
  readonly required?: boolean;
}

const ORDER = ['name', 'species', 'class', 'skills', 'equipment', 'review'];
const compare = (a: Step, b: Step): number => ORDER.indexOf(a.id) - ORDER.indexOf(b.id);
const STEPS: readonly Step[] = ORDER.map((id) => ({
  id,
  required: ['species', 'class', 'skills'].includes(id),
}));

/** A flow over a fixed list of steps where `answered` is the set of ids the user has answered. */
function setup(options?: { dirty?: boolean; confirm?: boolean; holds?: string[] }) {
  const answered = signal<ReadonlySet<string>>(new Set());
  const dirty = signal(options?.dirty ?? false);
  const leave = vi.fn();
  const confirmLeave = vi.fn().mockResolvedValue(options?.confirm ?? true);
  const all = signal<readonly Step[]>(STEPS);
  const remaining = signal<readonly Step[]>(STEPS);
  const refresh = (): void => {
    remaining.set(STEPS.filter((s) => !(s.required && answered().has(s.id))));
  };
  const flow = TestBed.runInInjectionContext(
    () =>
      new FlowController<Step>({
        all,
        remaining,
        compare,
        isRequired: (s) => s.required === true,
        holdsWhenAnswered: (s) => options?.holds?.includes(s.id) ?? false,
        dirty,
        confirmLeave,
        leave,
      }),
  );
  TestBed.tick();
  const answer = (id: string): void => {
    answered.update((set) => new Set(set).add(id));
    refresh();
    TestBed.tick();
  };
  return { flow, answer, all, remaining, dirty, leave, confirmLeave };
}

describe('FlowController', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('opens on the first step', () => {
    const { flow } = setup();
    expect(flow.currentId()).toBe('name');
    expect(flow.canBack()).toBe(false);
  });

  it('Next goes to the first step still to do after the current one and never skips one', () => {
    const { flow, answer } = setup();
    // The class is answered out of order; species and skills are still unanswered.
    answer('class');
    flow.next();
    expect(flow.currentId()).toBe('species');
    flow.next();
    // Class is done, so Next lands on the unanswered skills step, not past it.
    expect(flow.currentId()).toBe('skills');
    flow.next();
    expect(flow.currentId()).toBe('equipment');
    flow.next();
    expect(flow.currentId()).toBe('review');
    expect(flow.canNext()).toBe(false);
  });

  it('Next is blocked while canAdvance says the current step is not finished', () => {
    const answered = signal(false);
    const steps = signal<readonly Step[]>(STEPS);
    const flow = TestBed.runInInjectionContext(
      () =>
        new FlowController<Step>({
          all: steps,
          remaining: steps,
          compare,
          canAdvance: (s) => s.id !== 'name' || answered(),
          dirty: signal(false),
          confirmLeave: () => Promise.resolve(true),
          leave: () => undefined,
        }),
    );
    TestBed.tick();
    expect(flow.canNext()).toBe(false);
    answered.set(true);
    expect(flow.canNext()).toBe(true);
  });

  it('Back returns to the previous step in the path, including a step that was answered and left the list', () => {
    const { flow, answer } = setup();
    flow.next(); // species
    answer('species'); // answering the current step moves on to the next one still to do
    expect(flow.currentId()).toBe('class');

    flow.back();
    // species is answered (no longer in `remaining`) but Back still lands on it.
    expect(flow.currentId()).toBe('species');
    flow.back();
    expect(flow.currentId()).toBe('name');
    expect(flow.canBack()).toBe(false);
  });

  it('Back without a path falls back to the previous step in canonical order', () => {
    const { flow } = setup();
    flow.restore('class');
    expect(flow.currentId()).toBe('class');
    flow.back();
    expect(flow.currentId()).toBe('species');
  });

  it('answering the current step advances to the next step still to do', () => {
    const { flow, answer } = setup();
    flow.next(); // species
    answer('species');
    expect(flow.currentId()).toBe('class');
  });

  it('a step that holds when answered stays open until the user moves on', () => {
    const { flow, answer } = setup({ holds: ['class'] });
    flow.next(); // species
    flow.next(); // class
    answer('class');
    expect(flow.currentId()).toBe('class');
    flow.next();
    expect(flow.currentId()).toBe('skills');
  });

  it('an Edit jump returns to the step it came from on Next', () => {
    const { flow, answer } = setup();
    answer('species');
    answer('class');
    answer('skills');
    flow.go('review');
    expect(flow.currentId()).toBe('review');

    flow.go('species', { returnTo: 'review' });
    expect(flow.currentId()).toBe('species');
    expect(flow.returnTo()).toBe('review');
    flow.next();
    expect(flow.currentId()).toBe('review');
    expect(flow.returnTo()).toBeNull();
  });

  it('an Edit jump still visits a required step that became unanswered before returning', () => {
    const { flow, answer, all, remaining } = setup();
    answer('species');
    answer('class');
    answer('skills');
    flow.go('review');
    flow.go('class', { returnTo: 'review' });
    // Choosing a different class opens a new unanswered required step.
    remaining.set(STEPS.filter((s) => s.id === 'skills' || !s.required));
    all.set(STEPS);
    TestBed.tick();

    flow.next();
    expect(flow.currentId()).toBe('skills');
    flow.next();
    expect(flow.currentId()).toBe('review');
  });

  it('cancel leaves at once when nothing changed', async () => {
    const { flow, leave, confirmLeave } = setup({ dirty: false });
    await expect(flow.cancel()).resolves.toBe(true);
    expect(confirmLeave).not.toHaveBeenCalled();
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('cancel asks first when something changed, and stays if the user declines', async () => {
    const declined = setup({ dirty: true, confirm: false });
    await expect(declined.flow.cancel()).resolves.toBe(false);
    expect(declined.confirmLeave).toHaveBeenCalledTimes(1);
    expect(declined.leave).not.toHaveBeenCalled();

    const accepted = setup({ dirty: true, confirm: true });
    await expect(accepted.flow.cancel()).resolves.toBe(true);
    expect(accepted.leave).toHaveBeenCalledTimes(1);
  });

  it('restore opens a deep-linked step that exists, and ignores one that does not exist yet', () => {
    const all = signal<readonly Step[]>([STEPS[0], STEPS[5]]);
    const flow = TestBed.runInInjectionContext(
      () =>
        new FlowController<Step>({
          all,
          remaining: all,
          compare,
          dirty: signal(false),
          confirmLeave: () => Promise.resolve(true),
          leave: () => undefined,
        }),
    );
    TestBed.tick();
    flow.restore('class');
    expect(flow.currentId()).toBe('name');
    // A step that appears later does not pull the user away from where they are.
    all.set(STEPS);
    TestBed.tick();
    expect(flow.currentId()).toBe('name');

    flow.restore('review');
    expect(flow.currentId()).toBe('review');
    expect(flow.canBack()).toBe(true);
  });
});
