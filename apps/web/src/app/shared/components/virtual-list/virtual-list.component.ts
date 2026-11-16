import {
  Component,
  DestroyRef,
  Injector,
  TemplateRef,
  afterNextRender,
  contentChild,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { filter, take } from 'rxjs';
import { NavHistoryService } from '../../../ui/nav/nav-history.service';
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
  private readonly viewport = viewChild.required(CdkVirtualScrollViewport);

  constructor() {
    // Back (in-app or browser) returns to where this list was scrolled to when it was left.
    const nav = inject(NavHistoryService);
    const injector = inject(Injector);
    const restore = nav.takeListScroll();
    inject(DestroyRef).onDestroy(
      nav.registerListScroll(() => this.viewport().measureScrollOffset()),
    );
    afterNextRender(() => {
      if (restore === undefined) return;
      // The scrollable height exists once the viewport has rendered a non-empty range.
      this.viewport()
        .renderedRangeStream.pipe(
          filter((range) => range.end > 0),
          take(1),
        )
        .subscribe(() =>
          // The content height is applied on the next render; scrolling earlier is clamped to 0.
          afterNextRender(() => this.viewport().scrollToOffset(restore), { injector }),
        );
    });
  }
}
