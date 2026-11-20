import type { StrapAction, StrapConfig } from '../../../ui/action-strap/action-strap.service';

/** What the sheet strap's buttons do; the shell supplies the callbacks. */
export interface SheetStrapHandlers {
  readonly focusHpAmount: () => void;
  readonly rollPlain: () => void;
  readonly shortRest: () => void;
  readonly longRest: () => void;
  readonly addCondition: () => void;
  readonly toggleNotes: () => void;
  readonly toggleRollLog: () => void;
  readonly exportHero: () => void;
  readonly toggleWakeLock: () => void;
  readonly edit: () => void;
}

export interface SheetStrapState {
  /** The campaign edit lock is on: the mutating actions are disabled with the reason. */
  readonly locked: boolean;
  /** The campaign whose house rule leaves conditions to the DM; Add condition is disabled with it. */
  readonly conditionsDeniedIn?: string;
  /** An export is in progress: Export is disabled until it settles. */
  readonly exporting: boolean;
  /** Keep-screen-awake state; absent when the Wake Lock API is unavailable (the button is hidden). */
  readonly wakeLock?: { readonly active: boolean };
  /** Already-translated concentration note for the status slot. */
  readonly status?: string;
  /** The sheet's path prefix (`['/c', id]`) so the strap survives tab changes inside it. */
  readonly scope: readonly string[];
}

/**
 * The sheet's action strap (spec §3, board `IA-ActionStrap`): Damage · Heal · Roll · Short rest ·
 * Long rest | Add condition · Notes · Roll log · Export · Edit, with the concentration note in the
 * status slot. A pure builder: the shell calls it from an effect and hands the result to
 * `ActionStrapService`.
 */
export function buildSheetStrap(state: SheetStrapState, h: SheetStrapHandlers): StrapConfig {
  const mutating = (action: StrapAction): StrapAction =>
    state.locked
      ? { ...action, disabled: true, disabledReason: 'shell.strap.edit-locked' }
      : action;
  // The edit lock outranks the house rule (it blocks more), so a locked action keeps its reason.
  const houseRule = (action: StrapAction): StrapAction =>
    state.conditionsDeniedIn !== undefined && !action.disabled
      ? {
          ...action,
          disabled: true,
          disabledReason: 'shell.strap.house-rule-conditions',
          disabledReasonParams: { campaign: state.conditionsDeniedIn },
        }
      : action;
  return {
    primary: [
      mutating({
        id: 'damage',
        label: 'shell.icon.damage',
        icon: 'damage',
        kind: 'ember',
        run: h.focusHpAmount,
      }),
      mutating({
        id: 'heal',
        label: 'shell.icon.heal',
        icon: 'heal',
        kind: 'primary',
        run: h.focusHpAmount,
      }),
      { id: 'roll', label: 'shell.icon.roll', icon: 'roll', kind: 'primary', run: h.rollPlain },
      mutating({
        id: 'short-rest',
        label: 'shell.icon.short-rest',
        icon: 'short-rest',
        kind: 'ghost',
        run: h.shortRest,
      }),
      mutating({
        id: 'long-rest',
        label: 'shell.icon.long-rest',
        icon: 'long-rest',
        kind: 'ghost',
        run: h.longRest,
      }),
    ],
    secondary: [
      houseRule(
        mutating({
          id: 'add-condition',
          label: 'shell.strap.add-condition',
          icon: 'condition',
          kind: 'icon',
          run: h.addCondition,
        }),
      ),
      { id: 'notes', label: 'shell.icon.notes', icon: 'notes', kind: 'icon', run: h.toggleNotes },
      {
        id: 'roll-log',
        label: 'shell.strap.roll-log',
        icon: 'roll',
        kind: 'icon',
        run: h.toggleRollLog,
      },
      {
        id: 'export',
        label: 'shell.icon.export',
        icon: 'export',
        kind: 'icon',
        disabled: state.exporting,
        run: h.exportHero,
      },
      ...(state.wakeLock
        ? [
            {
              id: 'wake-lock',
              label: 'shell.icon.wake-lock',
              icon: 'wake-lock',
              kind: 'icon',
              pressed: state.wakeLock.active,
              run: h.toggleWakeLock,
            } satisfies StrapAction,
          ]
        : []),
      { id: 'edit', label: 'shell.icon.edit', icon: 'edit', kind: 'icon', run: h.edit },
    ],
    ...(state.status ? { status: state.status } : {}),
    scope: state.scope,
  };
}
