import { Component, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

export interface HkStepperStep {
  readonly id: string;
  readonly labelKey: string;
  readonly state: 'todo' | 'current' | 'done' | 'blocked';
}

// The wizard owns `activeId` and each step's `state`; this component never derives either
// itself. Clicking is gated purely on `state` — 'done' (revisit a completed step), 'current'
// (re-click the active step, a no-op the wizard can still react to), and 'blocked' (revisit a
// step whose recorded decision is currently invalid, so the user can fix it — plan-5
// task-7-fix-report.md) are all clickable; only 'todo' (not yet reached) is not, regardless of
// `activeId`.
@Component({
  selector: 'hk-stepper',
  imports: [TranslocoDirective],
  templateUrl: './stepper.component.html',
  styleUrl: './stepper.component.scss',
})
export class StepperComponent {
  // Inputs / Outputs
  readonly steps = input.required<HkStepperStep[]>();
  readonly activeId = input.required<string>();
  readonly stepSelected = output<string>();

  // Methods

  protected isClickable(step: HkStepperStep): boolean {
    return step.state === 'done' || step.state === 'current' || step.state === 'blocked';
  }

  protected onStepClick(step: HkStepperStep): void {
    if (!this.isClickable(step)) {
      return;
    }
    this.stepSelected.emit(step.id);
  }
}
