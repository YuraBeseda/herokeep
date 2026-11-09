import { Component, input } from '@angular/core';
import { HkWaxSealComponent } from '../../ui/wax-seal/wax-seal.component';

/**
 * The centred parchment leaf every auth step is drawn on (board AU01): a wax seal with the step's
 * glyph beside its title, the form body, and, at the foot, the form's own leather strap that
 * carries the primary action (the Dialog pattern).
 *
 * Content slots: `[authTitle]` is the step's `<h1>`; the default slot is the body, which may be a
 * `<form>` that ends with a `[data-auth-strap]` element, so the submit button sits inside it. The
 * seal's hint is the step's title, passed as `sealHint`.
 */
@Component({
  selector: 'app-auth-card',
  imports: [HkWaxSealComponent],
  templateUrl: './auth-card.component.html',
  styleUrl: './auth-card.component.scss',
})
export class AuthCardComponent {
  /** A sprite id (`ui:<name>`) for the seal's glyph. */
  readonly glyph = input.required<string>();
  /** Translated accessible name of the seal. */
  readonly sealHint = input.required<string>();
  /** Varies the outline of the seal between the four steps. */
  readonly seed = input(0);
}
