import type { Overlay } from './merge.ts';
import corrections from './corrections.json' with { type: 'json' };
import systemChoices from './system-choices.json' with { type: 'json' };
import species from './species.json' with { type: 'json' };
import backgrounds from './backgrounds.json' with { type: 'json' };
import fightingStyles from './fighting-styles.json' with { type: 'json' };
import feats from './feats.json' with { type: 'json' };
import fighter from './fighter.json' with { type: 'json' };
import wizard from './wizard.json' with { type: 'json' };

export interface Overlays {
  corrections: Overlay[];
  systemChoices: Overlay[];
  species: Overlay[];
  backgrounds: Overlay[];
  fightingStyles: Overlay[];
  feats: Overlay[];
  fighter: Overlay[];
  wizard: Overlay[];
}

/**
 * Reads and types the eight overlay JSON files under `src/overlays/`. Each is a plain `Overlay[]`
 * (see `merge.ts`); callers filter by which entity array they're patching (`applyOverlays` throws
 * on an overlay whose `id` matches nothing in the array it's given).
 */
export function loadOverlays(): Overlays {
  return {
    corrections,
    systemChoices,
    species,
    backgrounds,
    fightingStyles,
    feats,
    fighter: fighter as Overlay[],
    wizard: wizard as Overlay[],
  };
}
