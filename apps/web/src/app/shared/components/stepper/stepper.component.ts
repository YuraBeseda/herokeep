import { Component, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

export interface HkStepperStep {
  readonly id: string;
  readonly labelKey: string;
  readonly state: 'todo' | 'current' | 'done' | 'blocked';
}

// The wizard owns `activeId` and each step's `state`; this component never derives either
// itself. Clicking is gated purely on `state` — 'done' (revisit a completed step) and
// 'current' (re-click the active step, a no-op the wizard can still react to) are
// clickable; 'todo' and 'blocked' are not, regardless of `activeId`.
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
    return step.state === 'done' || step.state === 'current';
  }

  protected onStepClick(step: HkStepperStep): void {
    if (!this.isClickable(step)) {
      return;
    }
    this.stepSelected.emit(step.id);
  }
}
