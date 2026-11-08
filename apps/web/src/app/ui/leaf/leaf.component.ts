import { Component, input } from '@angular/core';
import { IconComponent } from '../../shared/icons/icon.component';

let nextLeafId = 0;

/**
 * `hk-leaf` — the parchment section panel every sheet, picker and campaign screen is built from
 * (design-system Leaf): a titled leaf of paper with a warm shadow, an optional glyph, optional
 * header actions and optional tabs.
 *
 * Content slots: the default slot is the body; `[hkLeafActions]` goes in the title row (at most
 * one ghost button plus small icon buttons); `[hkLeafTabs]` sits under the title row.
 * `title` is already-translated text, sentence case. The leaf is a `<section>` labelled by its
 * `<h2>`. The tilt is alternated down a column by `:nth-child` and is 0 in the plain theme and
 * under reduced motion.
 */
@Component({
  selector: 'hk-leaf',
  imports: [IconComponent],
  templateUrl: './leaf.component.html',
  styleUrl: './leaf.component.scss',
  host: {
    '[class.hk-leaf--phone]': 'phone()',
    // The title is an input here, not a native tooltip.
    '[attr.title]': 'null',
  },
})
export class HkLeafComponent {
  // Inputs
  readonly title = input.required<string>();
  /** A sprite id (`ui:<name>` or `gi:<slug>`) for the section glyph. */
  readonly icon = input<string | null>(null);
  /** Phone density: 12px padding and a 16px body. */
  readonly phone = input(false);

  protected readonly titleId = `hk-leaf-title-${nextLeafId++}`;
}
