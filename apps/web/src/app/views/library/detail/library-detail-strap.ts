import type { StrapAction, StrapConfig } from '../../../ui/action-strap/action-strap.service';

export type HeroAddKind = 'item' | 'spell';

export interface LibraryDetailStrapState {
  readonly back: () => void;
  /**
   * Present for the entry types the sheet can add (items, spells). `reason` is the shell key of why
   * it cannot be used right now (no hero context, a cantrip, ...); `null` when it can.
   */
  readonly add: {
    readonly kind: HeroAddKind;
    readonly run: () => void;
    readonly reason: string | null;
  } | null;
  /** The hero's campaign locks edits. */
  readonly locked: boolean;
  /** Copy the entry's link; `unavailable` is the shell key of why the clipboard cannot be used. */
  readonly copy: { readonly run: () => void; readonly unavailable: string | null };
  /** Open the pack the entry comes from; absent when the pack is not installed. */
  readonly openPack: (() => void) | null;
}

/**
 * The strap on a library entry (boards LB02, LB03): Back in zone 1; "Add to hero" in zone 2 for an
 * item (into the bag) or a spell (prepared), enabled with a hero context and drawn disabled with
 * its reason otherwise, so the slot stays where it is; Copy link and Open the pack in zone 3.
 */
export function buildLibraryDetailStrap(state: LibraryDetailStrapState): StrapConfig {
  // A missing hero context is the first thing to fix, so it outranks the edit lock.
  const reason = state.add?.reason ?? (state.locked ? 'shell.strap.edit-locked' : null);
  const secondary: StrapAction[] = [
    {
      id: 'copy-link',
      label: 'shell.strap.library-copy-link',
      icon: 'export',
      kind: 'icon',
      run: state.copy.run,
      ...(state.copy.unavailable ? { disabled: true, disabledReason: state.copy.unavailable } : {}),
    },
  ];
  if (state.openPack) {
    secondary.push({
      id: 'open-pack',
      label: 'shell.strap.library-open-pack',
      icon: 'packs',
      kind: 'icon',
      run: state.openPack,
    });
  }
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
            ...(reason ? { disabled: true, disabledReason: reason } : {}),
          },
        ]
      : [],
    secondary,
  };
}
