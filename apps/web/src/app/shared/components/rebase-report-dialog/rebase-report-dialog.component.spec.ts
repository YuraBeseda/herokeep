import { TestBed } from '@angular/core/testing';
import type { RebasePlan } from '@hk/engine';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../../assets/i18n/characters/uk.json';
import { DIALOG_DATA, DialogRef } from '../dialog/dialog.service';
import {
  RebaseReportDialogComponent,
  type RebaseReportDialogData,
} from './rebase-report-dialog.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'characters/en' ? charactersEn : {});
  }
}

const PLAN: RebasePlan = {
  changes: [
    { path: 'speed.walk.value', before: 30, after: 35 },
    { path: 'pins.sample-content', before: '1.0.0', after: undefined },
  ],
  invalid: [
    {
      choiceId: 'srd-5e-2024:system/5e-2024@0/species',
      selection: ['sample-content:species/moonkin'],
      reason: 'selection-missing',
    },
  ],
  migrations: [],
  events: [{ type: 'pack.unpinned', v: 1, payload: { packId: 'sample-content' } }],
};

function configure(data: RebaseReportDialogData | undefined): { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      { provide: DialogRef, useValue: { close } },
      ...(data ? [{ provide: DIALOG_DATA, useValue: data }] : []),
    ],
  });
  return { close };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('RebaseReportDialogComponent (plan 15 Task 4, minimal)', () => {
  it('lists the sheet changes and the invalid choices with their reason, under the given title', async () => {
    configure({ plan: PLAN, title: 'Turn off Sample content?' });
    const fixture = TestBed.createComponent(RebaseReportDialogComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    expect(text(root.querySelector('[data-dialog-title]'))).toBe('Turn off Sample content?');
    const changes = Array.from(root.querySelectorAll('.rebase-report__change')).map(text);
    expect(changes).toEqual(['speed.walk.value: 30 → 35', 'pins.sample-content: 1.0.0 → (none)']);
    const invalid = root.querySelector('.rebase-report__invalid-item');
    expect(text(invalid)).toContain('srd-5e-2024:system/5e-2024@0/species');
    expect(text(invalid)).toContain('The selected option is no longer available.');
    expect(root.querySelector('.rebase-report__empty')).toBeNull();
  });

  it('Confirm closes with true and Cancel with false; both emit their output', async () => {
    const { close } = configure({ plan: PLAN, title: 'T' });
    const fixture = TestBed.createComponent(RebaseReportDialogComponent);
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.componentInstance.cancelled.subscribe(cancelled);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    root.querySelector<HTMLButtonElement>('.rebase-report__confirm')!.click();
    expect(close).toHaveBeenLastCalledWith(true);
    expect(confirmed).toHaveBeenCalledTimes(1);

    root.querySelector<HTMLButtonElement>('.rebase-report__cancel')!.click();
    expect(close).toHaveBeenLastCalledWith(false);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('takes the plan/title inputs over DIALOG_DATA, and says so when nothing changes', async () => {
    configure(undefined);
    const fixture = TestBed.createComponent(RebaseReportDialogComponent);
    fixture.componentRef.setInput('plan', { changes: [], invalid: [], migrations: [], events: [] });
    fixture.componentRef.setInput('title', 'Embedded');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    expect(text(root.querySelector('[data-dialog-title]'))).toBe('Embedded');
    expect(text(root.querySelector('.rebase-report__empty'))).toBe('Nothing on the sheet changes.');
  });

  it('every reason and dialog string exists in en, ru and uk', () => {
    for (const locale of [charactersEn, charactersRu, charactersUk]) {
      const rebase = (locale as { rebase?: Record<string, unknown> }).rebase;
      expect(Object.keys(rebase ?? {}).sort()).toEqual(
        [
          'cancel',
          'change',
          'changes-title',
          'confirm',
          'invalid-title',
          'no-changes',
          'none',
          'reason',
        ].sort(),
      );
      expect(Object.keys((rebase?.['reason'] as object | undefined) ?? {}).sort()).toEqual([
        'choice-missing',
        'prerequisite-failed',
        'selection-deprecated',
        'selection-missing',
      ]);
    }
  });
});
