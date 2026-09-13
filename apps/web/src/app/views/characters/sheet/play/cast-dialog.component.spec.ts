import { TestBed } from '@angular/core/testing';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { CastDialogComponent, type CastDialogData } from './cast-dialog.component';

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

function open(data: CastDialogData) {
  const service = TestBed.inject(DialogService);
  return service.open(CastDialogComponent, { data });
}

const BASE_DATA: CastDialogData = {
  spellName: 'Burning Hands',
  spellLevel: 1,
  spellConcentration: false,
  alreadyConcentrating: false,
  availableSlots: [{ level: 1, max: 2, used: 0 }],
};

describe('CastDialogComponent', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('lists each available slot as an option (level + remaining), never a "no slot" option', () => {
    configure();
    open({
      ...BASE_DATA,
      availableSlots: [
        { level: 1, max: 2, used: 1 },
        { level: 2, max: 1, used: 0 },
      ],
    });
    TestBed.tick();

    const options = Array.from(document.querySelectorAll<HTMLOptionElement>('option'));
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.value)).toEqual(['1', '2']);
    expect(options[0].textContent).toContain('1');
    expect(options.some((o) => o.value === '' || /no slot/i.test(o.textContent ?? ''))).toBe(false);
  });

  it('shows the "no slots available" message and disables confirm when availableSlots is empty', () => {
    configure();
    open({ ...BASE_DATA, availableSlots: [] });
    TestBed.tick();

    expect(document.querySelector('option')).toBeNull();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const confirmButton = buttons.find(
      (b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm,
    )!;
    expect(confirmButton.disabled).toBe(true);
  });

  it('shows the "replaces current concentration" note only when the spell concentrates AND the sheet is already concentrating', () => {
    configure();
    open({ ...BASE_DATA, spellConcentration: true, alreadyConcentrating: true });
    TestBed.tick();

    expect(document.body.textContent).toContain(
      charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
    );
  });

  it('hides the replaces-concentration note when the spell has no concentration tag', () => {
    configure();
    open({ ...BASE_DATA, spellConcentration: false, alreadyConcentrating: true });
    TestBed.tick();

    expect(document.body.textContent).not.toContain(
      charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
    );
  });

  it('hides the replaces-concentration note when not currently concentrating, even if the spell concentrates', () => {
    configure();
    open({ ...BASE_DATA, spellConcentration: true, alreadyConcentrating: false });
    TestBed.tick();

    expect(document.body.textContent).not.toContain(
      charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
    );
  });

  it('confirm closes the dialog with the (default, first-option) selected slot level', async () => {
    configure();
    const handle = open({
      ...BASE_DATA,
      availableSlots: [
        { level: 1, max: 2, used: 1 },
        { level: 2, max: 1, used: 0 },
      ],
    });
    TestBed.tick();

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    buttons
      .find((b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm)!
      .click();
    TestBed.tick();

    expect(await handle.closed).toBe(1);
  });

  it('confirm closes with a CHANGED slot selection when the select is changed before confirming', async () => {
    configure();
    const handle = open({
      ...BASE_DATA,
      availableSlots: [
        { level: 1, max: 2, used: 1 },
        { level: 2, max: 1, used: 0 },
      ],
    });
    TestBed.tick();

    const select = document.querySelector<HTMLSelectElement>('select')!;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    TestBed.tick();

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    buttons
      .find((b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm)!
      .click();
    TestBed.tick();

    expect(await handle.closed).toBe(2);
  });

  it('cancel closes the dialog with undefined', async () => {
    configure();
    const handle = open(BASE_DATA);
    TestBed.tick();

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    buttons
      .find((b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.cancel)!
      .click();
    TestBed.tick();

    expect(await handle.closed).toBeUndefined();
  });
});
