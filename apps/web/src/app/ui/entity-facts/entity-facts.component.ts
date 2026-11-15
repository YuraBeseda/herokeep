import { Component, computed, input } from '@angular/core';
import type { Entity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { factRowsFor } from './entity-facts.formatters';

/** The type-specific fact grid (level/school/…, category/cost/…, hitDie/saves/…, size/speed) on
 * an entity detail page. Renders nothing for entity types with no structured facts. */
@Component({
  selector: 'app-entity-facts',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('library')],
  templateUrl: './entity-facts.component.html',
  styleUrl: './entity-facts.component.scss',
})
export class EntityFactsComponent {
  // Inputs
  readonly entity = input.required<Entity>();

  // Properties
  protected readonly rows = computed(() => factRowsFor(this.entity()));
}
