import { computed, effect, signal, untracked, type Signal } from '@angular/core';

export interface FlowStep {
  readonly id: string;
}

export interface FlowOptions<TStep extends FlowStep> {
  /** Every step of the flow in canonical order, answered ones included (what the stepper shows). */
  readonly all: Signal<readonly TStep[]>;
  /** The steps still to do, in the same order: the unanswered ones plus the free-form ones. */
  readonly remaining: Signal<readonly TStep[]>;
  /** The canonical order. It places a step that has just left `remaining` against the others. */
  readonly compare: (a: TStep, b: TStep) => number;
  /** An unanswered step that must be done before the flow may finish (the "return to" shortcut never skips it). */
  readonly isRequired?: (step: TStep) => boolean;
  /** A step that stays open once answered, instead of the flow advancing past it. */
  readonly holdsWhenAnswered?: (step: TStep) => boolean;
  /** Whether Next may leave this step (e.g. the name is valid). Defaults to always. */
  readonly canAdvance?: (step: TStep) => boolean;
  /** Whether anything has changed, so Cancel has to ask. */
  readonly dirty: Signal<boolean>;
  /** Asks the user to confirm leaving; resolves `true` to leave. */
  readonly confirmLeave: () => Promise<boolean>;
  /** Leaves the flow (back to where the user came from). */
  readonly leave: () => void;
}

/**
 * The navigation of a multi-step flow (the creation wizard now, level-up next) — spec §2.3.
 *
 * - **Next** goes to the first step still to do after the current one, in canonical order, and
 *   never skips one. Coming from a review's Edit link (`go(id, { returnTo })`) it first visits any
 *   required step that is still unanswered, then returns to the step it came from.
 * - **Back** returns to the previous step in the user's own path (steps they left by Next, by the
 *   stepper or by an answer completing), not to the previous slot of the list: a step answered and
 *   gone from `remaining` is still where Back lands. With no path it falls back to the previous
 *   step in canonical order.
 * - **Cancel** leaves, asking first only when `dirty`.
 * - A step that is answered while it is the current one moves the flow on to the next step still to
 *   do, unless `holdsWhenAnswered` says that step stays open.
 *
 * The controller owns the cursor and the path only; it never reads the draft. Create it in an
 * injection context (it registers one effect).
 */
export class FlowController<TStep extends FlowStep> {
  private readonly currentIdSignal = signal('');
  private readonly path = signal<readonly string[]>([]);
  private readonly returnToSignal = signal<string | null>(null);
  private lastCurrent: TStep | undefined;
  private previousRemaining = new Set<string>();

  /** Id of the step the user is on. */
  readonly currentId: Signal<string> = this.currentIdSignal.asReadonly();
  /** The step the user is on; `undefined` only while the flow has no steps yet. */
  readonly current: Signal<TStep | undefined> = computed(() => {
    const id = this.currentIdSignal();
    return this.options.all().find((step) => step.id === id);
  });
  /** The step an Edit link came from, while the user is editing on its behalf. */
  readonly returnTo: Signal<string | null> = this.returnToSignal.asReadonly();

  /** Where Next goes from here, or `undefined` on the last step. */
  readonly nextTarget: Signal<TStep | undefined> = computed(() => this.resolveNext());
  readonly canNext: Signal<boolean> = computed(() => {
    const current = this.current();
    if (!current) return false;
    return (this.options.canAdvance?.(current) ?? true) && this.nextTarget() !== undefined;
  });
  readonly canBack: Signal<boolean> = computed(() => this.resolveBack() !== undefined);

  private readonly options: FlowOptions<TStep>;

  constructor(options: FlowOptions<TStep>) {
    this.options = options;
    effect(() => {
      const all = this.options.all();
      const remaining = this.options.remaining();
      untracked(() => this.reconcile(all, remaining));
    });
  }

  /** Jumps to a step (the stepper, an Edit link). `returnTo` makes Next come back to that step. */
  go(id: string, options?: { readonly returnTo?: string }): void {
    const target = this.options.all().find((step) => step.id === id);
    if (!target || id === this.currentIdSignal()) return;
    this.moveTo(target, true);
    this.returnToSignal.set(options?.returnTo ?? null);
  }

  next(): void {
    if (!this.canNext()) return;
    const target = this.nextTarget();
    if (!target) return;
    this.moveTo(target, true);
    if (target.id === this.returnToSignal()) this.returnToSignal.set(null);
  }

  back(): void {
    const target = this.resolveBack();
    if (!target) return;
    const path = [...this.path()];
    // Drop every entry up to and including the one Back lands on.
    const at = path.lastIndexOf(target.id);
    this.path.set(at === -1 ? path : path.slice(0, at));
    this.returnToSignal.set(null);
    this.moveTo(target, false);
  }

  /** Leaves the flow, asking first only when something has changed. Resolves `true` when it left. */
  async cancel(): Promise<boolean> {
    if (this.options.dirty() && !(await this.options.confirmLeave())) return false;
    this.options.leave();
    return true;
  }

  /**
   * Opens on a step named by a deep link. Only a step that exists right now can be opened: a flow
   * whose steps appear as the user answers (the wizard) opens its first step for any other id.
   */
  restore(id: string | null): void {
    const target = id === null ? undefined : this.options.all().find((step) => step.id === id);
    if (!target) return;
    this.path.set([]);
    this.returnToSignal.set(null);
    this.moveTo(target, false);
  }

  // ----------------------------------------------------------------------------------------------

  private moveTo(target: TStep, push: boolean): void {
    const from = this.currentIdSignal();
    if (push && from !== '' && from !== target.id) this.path.update((path) => [...path, from]);
    this.lastCurrent = target;
    this.currentIdSignal.set(target.id);
  }

  private reconcile(all: readonly TStep[], remaining: readonly TStep[]): void {
    const previous = this.previousRemaining;
    this.previousRemaining = new Set(remaining.map((step) => step.id));

    if (this.currentIdSignal() === '') {
      const first = all[0];
      if (first) this.moveTo(first, false);
    }

    const id = this.currentIdSignal();
    const inAll = all.find((step) => step.id === id);
    if (inAll) this.lastCurrent = inAll;
    const anchor = inAll ?? this.lastCurrent;
    if (!anchor) return;

    // Gone from the flow entirely (a class change dropped the spells step), or answered while it
    // was the current step. Either way the flow moves to the first step still to do after it —
    // unless that step is one the user keeps open after answering.
    const answered =
      inAll !== undefined &&
      previous.has(id) &&
      !this.previousRemaining.has(id) &&
      !(this.options.holdsWhenAnswered?.(inAll) ?? false);
    if (inAll !== undefined && !answered) return;

    const target =
      remaining.find((step) => this.options.compare(step, anchor) > 0) ??
      remaining.at(-1) ??
      all.at(-1);
    if (target && target.id !== id) this.moveTo(target, inAll !== undefined);
  }

  private resolveNext(): TStep | undefined {
    const current = this.current() ?? this.lastCurrent;
    if (!current) return undefined;
    const remaining = this.options.remaining();
    const returnTo = this.returnToSignal();
    if (returnTo !== null) {
      const required = this.options.isRequired;
      const blocking = required
        ? remaining.find((step) => step.id !== current.id && step.id !== returnTo && required(step))
        : undefined;
      if (blocking) return blocking;
      const back = this.options.all().find((step) => step.id === returnTo);
      if (back && back.id !== current.id) return back;
    }
    return remaining.find((step) => this.options.compare(step, current) > 0);
  }

  private resolveBack(): TStep | undefined {
    const all = this.options.all();
    const currentId = this.currentIdSignal();
    const path = this.path();
    for (let i = path.length - 1; i >= 0; i--) {
      if (path[i] === currentId) continue;
      const step = all.find((candidate) => candidate.id === path[i]);
      if (step) return step;
    }
    const index = all.findIndex((step) => step.id === currentId);
    return index > 0 ? all[index - 1] : undefined;
  }
}
