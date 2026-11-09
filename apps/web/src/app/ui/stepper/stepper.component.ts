import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkDrawerComponent } from '../drawer/drawer.component';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { HkWaxSealComponent } from '../wax-seal/wax-seal.component';

export interface StepItem {
  readonly id: string;
  /** Already-translated step name. */
  readonly label: string;
  readonly state: 'done' | 'current' | 'todo' | 'locked';
  /** The step's answer, already translated ("Human"); shown under the name of a done step. */
  readonly summary?: string;
  /** Already-translated hint: why a locked group is locked, or what an invalid step needs. */
  readonly hint?: string;
  /** The step was answered but the answer is not acceptable yet; it stays reachable to be fixed. */
  readonly invalid?: boolean;
}

/**
 * `hk-stepper` — the wizard's step list (design-system Stepper). `vertical`: a parchment list where
 * done steps carry a wax seal, the current one is raised and a locked group shows a padlock with
 * its hint. `strip`: a leather bar "Step N of M · name" with an All steps button that opens the
 * whole list in a sheet.
 *
 * It shows what it is given and reports a choice through `stepSelected`: the host owns the cursor
 * and the order. A step is reachable when it is done, current or invalid; to-do and locked steps
 * are not (Next is how the user gets to them).
 */
@Component({
  selector: 'hk-stepper',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    IconComponent,
    HkDrawerComponent,
    HkIconButtonComponent,
    HkTooltipDirective,
    HkWaxSealComponent,
  ],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './stepper.component.html',
  styleUrl: './stepper.component.scss',
})
export class HkStepperComponent {
  // Inputs / Outputs
  readonly steps = input.required<readonly StepItem[]>();
  /** Id of the current step. */
  readonly current = input.required<string>();
  readonly variant = input<'vertical' | 'strip'>('vertical');
  readonly stepSelected = output<string>();

  protected readonly sheetOpen = signal(false);
  protected readonly position = computed(() => {
    const steps = this.steps();
    const index = steps.findIndex((step) => step.id === this.current());
    return {
      index: Math.max(index, 0),
      name: steps[index]?.label ?? '',
      percent: steps.length === 0 ? 0 : ((Math.max(index, 0) + 1) / steps.length) * 100,
    };
  });
  protected readonly allStepsButton = viewChild('allSteps', { read: ElementRef });

  protected reachable(step: StepItem): boolean {
    return step.state === 'done' || step.state === 'current' || step.invalid === true;
  }

  protected choose(step: StepItem): void {
    if (!this.reachable(step)) return;
    this.sheetOpen.set(false);
    this.stepSelected.emit(step.id);
  }
}
