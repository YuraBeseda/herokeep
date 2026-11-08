import { Component, computed, input } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';

/**
 * `hk-portrait-frame` — a brass frame with four rivets around the portrait of a hero, falling
 * back to a monogram in the display face on a dark well (design-system PortraitFrame). Sizes: `s`
 * 50x56, `m` 98x118, `l` 140x168.
 *
 * `name` is the hero's name (also the source of the two-letter monogram unless `monogram` is
 * given); `src` is the picture URL, absent while there is none or while it loads. Project an
 * edit control (an `hk-icon-button`) into `[hkPortraitEdit]` to show it in the bottom-right
 * corner. The well is an image labelled "Portrait of <name>" or "Portrait placeholder, monogram X".
 */
@Component({
  selector: 'hk-portrait-frame',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './portrait-frame.component.html',
  styleUrl: './portrait-frame.component.scss',
  host: {
    '[class]': 'classes()',
  },
})
export class HkPortraitFrameComponent {
  // Inputs
  readonly name = input.required<string>();
  readonly src = input<string | null>(null);
  readonly monogram = input<string | null>(null);
  readonly size = input<'s' | 'm' | 'l'>('m');

  protected readonly letters = computed(() => {
    const given = this.monogram();
    if (given) return given;
    const words = this.name().trim().split(/\s+/).filter(Boolean);
    return words
      .slice(0, 2)
      .map((word) => Array.from(word)[0] ?? '')
      .join('')
      .toLocaleUpperCase();
  });
  protected readonly classes = computed(() => `hk-frame hk-frame--${this.size()}`);
}
