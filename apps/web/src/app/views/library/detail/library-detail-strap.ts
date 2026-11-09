import type { StrapConfig } from '../../../ui/action-strap/action-strap.service';

export type HeroAddKind = 'item' | 'spell';

export interface LibraryDetailStrapState {
  readonly back: () => void;
  /** Present when the entry can be added to the hero the person came from. */
  readonly add: { readonly kind: HeroAddKind; readonly run: () => void } | null;
  /** The hero's campaign locks edits. */
  readonly locked: boolean;
}

/**
 * The strap on a library entry (boards LB02, LB03): Back in zone 1 and, when the entry was opened
 * from a hero's sheet and the sheet has a path for it, "Add to hero" in zone 2 (an item goes into
 * the bag; a known spell is prepared). The button is left out for everything else.
 */
export function buildLibraryDetailStrap(state: LibraryDetailStrapState): StrapConfig {
  return {
    exit: [
      {
        id: 'back',
        label: 'shell.strap.back',
        icon: 'leave',
        kind: 'parchment',
        run: state.back,
      },
    ],
    primary: state.add
      ? [
          {
            id: 'add-to-hero',
            label:
              state.add.kind === 'spell'
                ? 'shell.strap.library-prepare'
                : 'shell.strap.library-add-to-hero',
            icon: state.add.kind === 'spell' ? 'spells' : 'bag',
            kind: 'primary',
            run: state.add.run,
            ...(state.locked ? { disabled: true, disabledReason: 'shell.strap.edit-locked' } : {}),
          },
        ]
      : [],
  };
}
