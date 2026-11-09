import { TestBed } from '@angular/core/testing';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { DiscardChangesDialogComponent } from './discard-changes-dialog.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'campaigns/en' ? campaignsEn : {});
  }
}

describe('DiscardChangesDialogComponent', () => {
  async function mount(): Promise<{ el: HTMLElement; close: ReturnType<typeof vi.fn> }> {
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
        provideTranslocoScope('campaigns'),
        { provide: DialogRef, useValue: { close } },
      ],
    });
    const fixture = TestBed.createComponent(DiscardChangesDialogComponent);
    await fixture.whenStable();
    await fixture.whenStable();
    return { el: fixture.nativeElement as HTMLElement, close };
  }

  it('is titled and explains what is lost, with Keep editing and Discard on the strap', async () => {
    const { el } = await mount();
    expect(el.querySelector('[data-dialog-title]')?.textContent?.trim()).toBe(
      campaignsEn.discard.title,
    );
    expect(el.querySelector('.discard-changes-dialog__body')?.textContent?.trim()).toBe(
      campaignsEn.discard.body,
    );
    const actions = el.querySelector('[data-dialog-actions]')!;
    expect(
      Array.from(actions.querySelectorAll('button')).map((b) => b.textContent?.trim()),
    ).toEqual([campaignsEn.discard.keep, campaignsEn.discard.confirm]);
  });

  it('answers false for Keep editing and true for Discard', async () => {
    const { el, close } = await mount();
    const [keep, discard] = Array.from(
      el.querySelectorAll<HTMLButtonElement>('[data-dialog-actions] button'),
    );
    keep.click();
    discard.click();
    expect(close.mock.calls).toEqual([[false], [true]]);
    expect(discard.classList.contains('hk-button--ember')).toBe(true);
  });
});
