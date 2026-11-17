import iconsMapJson from '@hk/content/icons';
import { UI_ICONS } from './icons/vocabulary';

/** Every `gi-<slug>` in the sprite: the same two sources `tools/build-sprite.ts` builds it from. */
export const SPRITE_SLUGS: readonly string[] = [
  ...new Set([
    ...[
      ...Object.values(iconsMapJson.categories as Record<string, string>),
      ...Object.values(iconsMapJson.entities as Record<string, string>),
    ].map((icon) => icon.slice('gi:'.length)),
    ...Object.values(UI_ICONS).map((entry) => entry.gi),
  ]),
].sort();
