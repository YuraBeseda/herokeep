import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'hk-skeleton',
  templateUrl: './skeleton.component.html',
  styleUrl: './skeleton.component.scss',
  host: {
    'aria-hidden': 'true',
  },
})
export class SkeletonComponent {
  // Inputs
  readonly lines = input(1);
  readonly width = input<string | undefined>(undefined);

  // Derived
  protected readonly barIndexes = computed(() =>
    Array.from({ length: this.lines() }, (_, index) => index),
  );
}
