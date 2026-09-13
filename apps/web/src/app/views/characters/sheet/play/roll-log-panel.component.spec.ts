import { LiveAnnouncer } from '@angular/cdk/a11y';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { RollLogService } from '@shared/services/roll-log/roll-log.service';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { RollLogPanelComponent } from './roll-log-panel.component';

// `RollLogService` only ever reads `CharacterStore.streamId` (its own "cleared on switch" effect)
// — stubbed down to that one signal, same `useValue` precedent `roll-log.service.spec.ts` and
// `characters-list.component.spec.ts` already establish, so this component's spec needs no real
// pack/fake-indexeddb setup either.
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
      { provide: CharacterStore, useValue: { streamId: signal<string | undefined>('char:test') } },
    ],
  });
}

function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`no button matching "${text}"`);
  return button;
}

describe('RollLogPanelComponent', () => {
  beforeEach(() => configure());

  it('shows the empty message with no entries, and renders logged entries newest-first via hk-dice-result', async () => {
    const fixture = TestBed.createComponent(RollLogPanelComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain(charactersEn.sheet.roll.empty);

    const rollLogService = TestBed.inject(RollLogService);
    rollLogService.add({
      labelKey: 'sheet.roll.entries.check',
      params: { name: 'Strength' },
      dice: [{ sides: 20, value: 11, kept: true }],
      modifier: 2,
      total: 13,
    });
    rollLogService.add({
      labelKey: 'sheet.roll.entries.save',
      params: { name: 'Dexterity' },
      dice: [{ sides: 20, value: 4, kept: true }],
      modifier: 1,
      total: 5,
    });
    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;

    const totals = Array.from(compiled.querySelectorAll('.hk-dice-result__total')).map((el) =>
      el.textContent?.trim(),
    );
    // Newest first: the Dexterity save (total 5) was added last.
    expect(totals).toEqual(['= 5', '= 13']);
  });

  it('the advantage toggle group defaults to Normal and is mutually exclusive', async () => {
    const fixture = TestBed.createComponent(RollLogPanelComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(
      buttonNamed(compiled, charactersEn.sheet.roll.advantage.normal).getAttribute('aria-pressed'),
    ).toBe('true');

    buttonNamed(compiled, charactersEn.sheet.roll.advantage.advantage).click();
    await fixture.whenStable();

    expect(fixture.componentInstance.advantageMode()).toBe('adv');
    expect(
      buttonNamed(compiled, charactersEn.sheet.roll.advantage.advantage).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
    expect(
      buttonNamed(compiled, charactersEn.sheet.roll.advantage.normal).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('a manual entry logs a flagged roll, clears the amount field, and announces it', async () => {
    const fixture = TestBed.createComponent(RollLogPanelComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;
    const announceSpy = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

    const amountInput = compiled.querySelector<HTMLInputElement>(
      '.roll-log-panel__manual input[type="number"]',
    )!;
    amountInput.value = '17';
    amountInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    buttonNamed(compiled, charactersEn.sheet.roll.manual.add).click();
    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;

    const rollLogService = TestBed.inject(RollLogService);
    expect(rollLogService.entries()).toHaveLength(1);
    expect(rollLogService.entries()[0]).toMatchObject({
      labelKey: 'sheet.roll.manual.labels.check',
      dice: [],
      total: 17,
      manual: true,
    });
    expect(announceSpy).toHaveBeenCalledTimes(1);

    const amountAfter = compiled.querySelector<HTMLInputElement>(
      '.roll-log-panel__manual input[type="number"]',
    )!;
    expect(amountAfter.value).toBe('');
  });

  it('Clear log empties the log and brings back the empty message', async () => {
    const fixture = TestBed.createComponent(RollLogPanelComponent);
    await fixture.whenStable();
    const rollLogService = TestBed.inject(RollLogService);
    rollLogService.add({
      labelKey: 'sheet.roll.entries.check',
      params: { name: 'Strength' },
      dice: [],
      modifier: 0,
      total: 1,
    });
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;

    buttonNamed(compiled, charactersEn.sheet.roll.clear).click();
    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;

    expect(rollLogService.entries()).toHaveLength(0);
    expect(compiled.textContent).toContain(charactersEn.sheet.roll.empty);
  });
});
