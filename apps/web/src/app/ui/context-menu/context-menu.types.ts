/** One entry of a context menu (`[hkContextMenu]`, `<hk-menu-button>`). Keys are full i18n keys. */
export interface HkMenuItem {
  id: string;
  labelKey: string; // i18n key
  icon?: string; // sprite id
  detail?: string; // right-aligned value, e.g. "+5"
  hintKey?: string; // one-line explanation under the label
  disabledReasonKey?: string; // disabled when set; shown as the hint
  run: () => void;
}

/** A menu's items, or a function resolving them when the menu opens. */
export type HkMenuItems = HkMenuItem[] | (() => HkMenuItem[]);

export function resolveMenuItems(items: HkMenuItems): HkMenuItem[] {
  return typeof items === 'function' ? items() : items;
}
