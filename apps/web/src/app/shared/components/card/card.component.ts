import { Component, input } from '@angular/core';

@Component({
  selector: 'hk-card',
  templateUrl: './card.component.html',
  styleUrl: './card.component.scss',
})
export class CardComponent {
  // Inputs
  readonly header = input<string | undefined>(undefined);
}
