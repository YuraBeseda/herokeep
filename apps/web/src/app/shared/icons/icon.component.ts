import { Component, computed, input } from '@angular/core';

const GI_PREFIX = 'gi:';
const UI_PREFIX = 'ui:';

@Component({
  selector: 'hk-icon',
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
})
export class IconComponent {
  // Inputs
  readonly icon = input.required<string>();

  // The sprite symbol id for `icon`: `gi:<slug>` -> `gi-<slug>` (a vendored game-icons glyph),
  // `ui:<name>` -> `ui-<name>` (a vocabulary entry from `ui/icons/vocabulary.ts`). Throws on any
  // other value — every icon this app renders comes from the vendored sprite, so an unprefixed
  // value is a caller bug, not a state to render around.
  protected readonly symbol = computed(() => {
    const value = this.icon();
    if (value.startsWith(GI_PREFIX)) return `gi-${value.slice(GI_PREFIX.length)}`;
    if (value.startsWith(UI_PREFIX)) return `ui-${value.slice(UI_PREFIX.length)}`;
    throw new Error(`hk-icon: icon must be a "gi:<slug>" or "ui:<name>" id, got "${value}"`);
  });
}
