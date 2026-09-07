import { Component, computed, input } from '@angular/core';

const GI_PREFIX = 'gi:';

@Component({
  selector: 'hk-icon',
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
})
export class IconComponent {
  // Inputs
  readonly icon = input.required<string>();

  // A `gi:<slug>` id's slug half, used to build the sprite `<use>` href. Throws when `icon`
  // isn't `gi:`-prefixed — every icon this app renders comes from the vendored game-icons
  // sprite, so an unprefixed value is a caller bug, not a state to render around.
  protected readonly slug = computed(() => {
    const value = this.icon();
    if (!value.startsWith(GI_PREFIX)) {
      throw new Error(`hk-icon: icon must be a "gi:<slug>" id, got "${value}"`);
    }
    return value.slice(GI_PREFIX.length);
  });
}
