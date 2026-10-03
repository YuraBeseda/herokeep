import type { Overlay } from './merge.ts';
import corrections from './corrections.json' with { type: 'json' };
import systemChoices from './system-choices.json' with { type: 'json' };
import species from './species.json' with { type: 'json' };
import backgrounds from './backgrounds.json' with { type: 'json' };
import fightingStyles from './fighting-styles.json' with { type: 'json' };
import feats from './feats.json' with { type: 'json' };
import barbarian from './barbarian.json' with { type: 'json' };
import cleric from './cleric.json' with { type: 'json' };
import fighter from './fighter.json' with { type: 'json' };
import warlock from './warlock.json' with { type: 'json' };
import wizard from './wizard.json' with { type: 'json' };
import rogue from './rogue.json' with { type: 'json' };
import monk from './monk.json' with { type: 'json' };
import paladin from './paladin.json' with { type: 'json' };
import ranger from './ranger.json' with { type: 'json' };
import bard from './bard.json' with { type: 'json' };
import sorcerer from './sorcerer.json' with { type: 'json' };

export interface Overlays {
  corrections: Overlay[];
  systemChoices: Overlay[];
  species: Overlay[];
  backgrounds: Overlay[];
  fightingStyles: Overlay[];
  feats: Overlay[];
  barbarian: Overlay[];
  cleric: Overlay[];
  fighter: Overlay[];
  warlock: Overlay[];
  wizard: Overlay[];
  rogue: Overlay[];
  monk: Overlay[];
  paladin: Overlay[];
  ranger: Overlay[];
  bard: Overlay[];
  sorcerer: Overlay[];
}

/**
 * Reads and types the eleven overlay JSON files under `src/overlays/`. Each is a plain `Overlay[]`
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
    barbarian: barbarian as Overlay[],
    cleric: cleric as Overlay[],
    fighter: fighter as Overlay[],
    warlock: warlock as Overlay[],
    wizard: wizard as Overlay[],
    rogue: rogue as Overlay[],
    monk: monk as Overlay[],
    paladin: paladin as Overlay[],
    ranger: ranger as Overlay[],
    bard: bard as Overlay[],
    sorcerer: sorcerer as Overlay[],
  };
}
