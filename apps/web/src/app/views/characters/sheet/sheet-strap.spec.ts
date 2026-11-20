import { buildSheetStrap, type SheetStrapHandlers, type SheetStrapState } from './sheet-strap';

const noop = (): void => undefined;
const handlers: SheetStrapHandlers = {
  focusHpAmount: noop,
  rollPlain: noop,
  shortRest: noop,
  longRest: noop,
  addCondition: noop,
  toggleNotes: noop,
  toggleRollLog: noop,
  exportHero: noop,
  toggleWakeLock: noop,
  edit: noop,
};
const addCondition = (state: SheetStrapState) =>
  buildSheetStrap(state, handlers).secondary?.find((a) => a.id === 'add-condition');

describe('buildSheetStrap — house rule: players manage their own conditions', () => {
  it('draws Add condition disabled with the house-rule reason and the campaign name', () => {
    const action = addCondition({
      locked: false,
      conditionsDeniedIn: 'The Emberfall Company',
      exporting: false,
      scope: ['/c', '1'],
    });
    expect(action?.disabled).toBe(true);
    expect(action?.disabledReason).toBe('shell.strap.house-rule-conditions');
    expect(action?.disabledReasonParams).toEqual({ campaign: 'The Emberfall Company' });
  });

  it('keeps the edit-lock reason when both apply, and stays enabled when neither does', () => {
    const both = { locked: true, conditionsDeniedIn: 'X', exporting: false, scope: ['/c', '1'] };
    expect(addCondition(both)?.disabledReason).toBe('shell.strap.edit-locked');
    const free = { locked: false, exporting: false, scope: ['/c', '1'] };
    expect(addCondition(free)?.disabled).toBeFalsy();
  });
});

describe('buildSheetStrap — keep screen awake', () => {
  const wake = (state: Partial<SheetStrapState>) =>
    buildSheetStrap({ locked: false, exporting: false, scope: ['/c', '1'], ...state }, handlers)
      .secondary?.find((a) => a.id === 'wake-lock');

  it('is a pressed-state icon button when the Wake Lock API exists', () => {
    expect(wake({ wakeLock: { active: false } })).toMatchObject({ kind: 'icon', pressed: false });
    expect(wake({ wakeLock: { active: true } })?.pressed).toBe(true);
  });

  it('is absent when the API is unavailable', () => {
    expect(wake({})).toBeUndefined();
  });
});
