import { Component, TemplateRef, contentChild, input } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { NgTemplateOutlet } from '@angular/common';

@Component({
  selector: 'hk-virtual-list',
  imports: [ScrollingModule, NgTemplateOutlet],
  templateUrl: './virtual-list.component.html',
  styleUrl: './virtual-list.component.scss',
})
export class VirtualListComponent<T> {
  // Inputs
  readonly items = input.required<readonly T[]>();
  readonly itemSize = input(56);

  // Content: a single row template, projected via `<ng-template let-item>` — the consumer
  // never needs a marker directive, since there is only ever one row template to find.
  protected readonly rowTemplate = contentChild.required(TemplateRef);
}
