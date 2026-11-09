import type { StrapConfig } from '../../../ui/action-strap/action-strap.service';
import type { HomebrewFormType } from './entity-form.helpers';

/** What the homebrew editor strap's buttons do; the editor supplies the callbacks. */
export interface HomebrewEditorStrapHandlers {
  readonly type: HomebrewFormType;
  readonly cancel: () => void;
  readonly save: () => void;
  readonly markdownHelp: () => void;
  readonly busy: boolean;
  /** `false` while the entry is not found (nothing to save). */
  readonly canSave: boolean;
  /** Already-translated right-hand note: "Unsaved changes" or "N fields need attention". */
  readonly note?: string;
}

/**
 * The strap on the homebrew forms (board PK05): Cancel in zone 1 (it leaves through the dirty-form
 * guard), Save in zone 2 (labelled by the entry type, loading while the save is awaited), Markdown
 * help in zone 3, and the unsaved/attention note on the right.
 */
export function buildHomebrewEditorStrap(h: HomebrewEditorStrapHandlers): StrapConfig {
  return {
    exit: [
      { id: 'cancel', label: 'shell.strap.cancel', icon: 'close', kind: 'ghost', run: h.cancel },
    ],
    primary: [
      {
        id: 'save-entry',
        label: `shell.strap.homebrew-save-${h.type}`,
        icon: 'save',
        kind: 'primary',
        disabled: !h.canSave || h.busy,
        run: h.save,
      },
    ],
    secondary: [
      {
        id: 'markdown-help',
        label: 'shell.strap.markdown-help',
        icon: 'details',
        kind: 'icon',
        run: h.markdownHelp,
      },
    ],
    ...(h.note ? { status: h.note } : {}),
  };
}
