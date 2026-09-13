import { TestBed } from '@angular/core/testing';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { ConditionDialogComponent, type ConditionDialogData } from './condition-dialog.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return langPath === 'characters/en' ? of(charactersEn) : of({});
  }
}

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      provideTranslocoScope('characters'),
    ],
  });
}

function open(data: ConditionDialogData) {
  const service = TestBed.inject(DialogService);
  return service.open(ConditionDialogComponent, { data });
}

const BASE_DATA: ConditionDialogData = {
  options: [
    { id: 'srd-5e-2024:condition/blinded', name: 'Blinded', levelBearing: false },
    { id: 'srd-5e-2024:condition/exhaustion', name: 'Exhaustion', levelBearing: true },
  ],
};

function buttonNamed(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`no button matching "${text}"`);
  return button;
}

describe('ConditionDialogComponent', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('lists every option and selects the first by default', () => {
    configure();
    open(BASE_DATA);
    TestBed.tick();

    const options = Array.from(document.querySelectorAll<HTMLOptionElement>('option'));
    expect(options.map((o) => o.value)).toEqual([
      'srd-5e-2024:condition/blinded',
      'srd-5e-2024:condition/exhaustion',
    ]);
    expect(options[0]?.selected).toBe(true);
  });

  it('hides the level stepper for a non-level-bearing condition (the default selection)', () => {
    configure();
    open(BASE_DATA);
    TestBed.tick();

    expect(document.querySelector('input[type="number"]')).toBeNull();
  });

  it('shows a min-1, NO-max level stepper once a level-bearing condition is selected', () => {
    configure();
    open(BASE_DATA);
    TestBed.tick();

    const select = document.querySelector<HTMLSelectElement>('select')!;
    select.value = 'srd-5e-2024:condition/exhaustion';
    select.dispatchEvent(new Event('change'));
    TestBed.tick();

    const level = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(level).not.toBeNull();
    expect(level.min).toBe('1');
    // Controller ruling (task-4-brief.md): no cap constant, even though the pack's own
    // `levels: 6` marks exhaustion as level-bearing — that field gates the STEPPER's visibility
    // only, never a UI-enforced maximum.
    expect(level.max).toBe('');
  });

  it('confirm closes with {conditionId, level} for a level-bearing selection at the default level 1', async () => {
    configure();
    const handle = open(BASE_DATA);
    TestBed.tick();

    const select = document.querySelector<HTMLSelectElement>('select')!;
    select.value = 'srd-5e-2024:condition/exhaustion';
    select.dispatchEvent(new Event('change'));
    TestBed.tick();

    buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({
      conditionId: 'srd-5e-2024:condition/exhaustion',
      level: 1,
    });
  });

  it('confirm closes with an undefined level for a non-level-bearing (default) selection', async () => {
    configure();
    const handle = open(BASE_DATA);
    TestBed.tick();

    buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({
      conditionId: 'srd-5e-2024:condition/blinded',
      level: undefined,
    });
  });

  it('a changed level on the stepper is carried through to confirm', async () => {
    configure();
    const handle = open(BASE_DATA);
    TestBed.tick();

    const select = document.querySelector<HTMLSelectElement>('select')!;
    select.value = 'srd-5e-2024:condition/exhaustion';
    select.dispatchEvent(new Event('change'));
    TestBed.tick();

    const level = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    level.value = '3';
    level.dispatchEvent(new Event('input'));
    TestBed.tick();

    buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({
      conditionId: 'srd-5e-2024:condition/exhaustion',
      level: 3,
    });
  });

  it('cancel closes with undefined', async () => {
    configure();
    const handle = open(BASE_DATA);
    TestBed.tick();

    buttonNamed(charactersEn.sheet.conditions.addDialog.cancel).click();
    TestBed.tick();

    expect(await handle.closed).toBeUndefined();
  });
});
