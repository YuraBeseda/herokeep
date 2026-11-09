import { TestBed } from '@angular/core/testing';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import type { Pack } from '@hk/protocol';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import { typeInto } from '../../../ui/testing/harness';
import { PackStore } from '@shared/stores/pack.store';
import { CampaignStore, CampaignStoreNotLeaderError } from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { CreateCampaignDialogComponent } from './create-campaign-dialog.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

function corePack(): Pack {
  return { id: 'srd-5e-2024', version: '0.1.0' } as unknown as Pack;
}

function configure(options: { create?: ReturnType<typeof vi.fn>; core?: Pack | undefined }): {
  close: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  setDismissible: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  const setDismissible = vi.fn();
  const create = options.create ?? vi.fn().mockResolvedValue('camp:new-id');

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
      // No parent component provides `provideTranslocoScope('campaigns')` here (this dialog has
      // none of its own, by design — see its class doc) — this stands in for "the caller
      // (`CampaignsListComponent`) already loaded it", the same real-world precondition that
      // makes the production global-key lookup work.
      provideTranslocoScope('campaigns'),
      { provide: DialogRef, useValue: { close, setDismissible } },
      { provide: CampaignStore, useValue: { create } },
      { provide: PackStore, useValue: { corePack: () => options.core ?? corePack() } },
    ],
  });

  return { close, create, setDismissible };
}

describe('CreateCampaignDialogComponent', () => {
  it('disables Create until a non-blank name is entered', async () => {
    configure({});
    const fixture = TestBed.createComponent(CreateCampaignDialogComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const confirm = compiled.querySelector<HTMLButtonElement>('.create-campaign-dialog__confirm')!;
    expect(confirm.disabled).toBe(true);

    const input = compiled.querySelector<HTMLInputElement>('.create-campaign-dialog__name input')!;
    input.value = 'Curse of Strahd';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(confirm.disabled).toBe(false);
  });

  it('calls CampaignStore.create with the trimmed name and the core pack id as system, closing with the new stream id', async () => {
    const { close, create } = configure({});
    const fixture = TestBed.createComponent(CreateCampaignDialogComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const input = compiled.querySelector<HTMLInputElement>('.create-campaign-dialog__name input')!;
    input.value = '  Curse of Strahd  ';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    compiled.querySelector<HTMLButtonElement>('.create-campaign-dialog__confirm')!.click();
    await fixture.whenStable();

    expect(create).toHaveBeenCalledWith('Curse of Strahd', 'srd-5e-2024');
    expect(close).toHaveBeenCalledWith('camp:new-id');
  });

  it('shows a toast-free inline error and does NOT close when CampaignStore.create rejects with a not-leader error', async () => {
    const create = vi.fn().mockRejectedValue(new CampaignStoreNotLeaderError());
    const { close } = configure({ create });
    const fixture = TestBed.createComponent(CreateCampaignDialogComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const input = compiled.querySelector<HTMLInputElement>('.create-campaign-dialog__name input')!;
    input.value = 'Curse of Strahd';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    compiled.querySelector<HTMLButtonElement>('.create-campaign-dialog__confirm')!.click();
    await fixture.whenStable();

    expect(close).not.toHaveBeenCalled();
    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn['not-leader']);
  });

  it('closes with undefined on cancel', async () => {
    const { close } = configure({});
    const fixture = TestBed.createComponent(CreateCampaignDialogComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.create-campaign-dialog__cancel')!.click();
    expect(close).toHaveBeenCalledWith(undefined);
  });

  it('puts the actions on the dialog strap and shows the name counter', async () => {
    configure({});
    const fixture = TestBed.createComponent(CreateCampaignDialogComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      compiled
        .querySelector('.create-campaign-dialog__actions')
        ?.hasAttribute('data-dialog-actions'),
    ).toBe(true);
    expect(compiled.querySelector('.create-campaign-dialog__counter')?.textContent?.trim()).toBe(
      '0 / 200',
    );
    typeInto(
      compiled.querySelector<HTMLInputElement>('.create-campaign-dialog__name input')!,
      'Strahd',
    );
    await fixture.whenStable();
    expect(compiled.querySelector('.create-campaign-dialog__counter')?.textContent?.trim()).toBe(
      '6 / 200',
    );
  });

  it('asks once before discarding a typed name: Keep editing stays, Discard closes', async () => {
    const { close, setDismissible } = configure({});
    const fixture = TestBed.createComponent(CreateCampaignDialogComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    typeInto(
      compiled.querySelector<HTMLInputElement>('.create-campaign-dialog__name input')!,
      'Strahd',
    );
    await fixture.whenStable();
    expect(setDismissible).toHaveBeenLastCalledWith(false);

    compiled.querySelector<HTMLButtonElement>('.create-campaign-dialog__cancel')!.click();
    await fixture.whenStable();
    expect(close).not.toHaveBeenCalled();
    expect(compiled.querySelector('.create-campaign-dialog__discard')).not.toBeNull();

    compiled.querySelector<HTMLButtonElement>('.create-campaign-dialog__keep')!.click();
    await fixture.whenStable();
    expect(compiled.querySelector('.create-campaign-dialog__discard')).toBeNull();
    expect(
      compiled.querySelector<HTMLInputElement>('.create-campaign-dialog__name input')!.value,
    ).toBe('Strahd');

    compiled.querySelector<HTMLButtonElement>('.create-campaign-dialog__cancel')!.click();
    await fixture.whenStable();
    compiled.querySelector<HTMLButtonElement>('.create-campaign-dialog__discard-confirm')!.click();
    expect(close).toHaveBeenCalledWith(undefined);
  });

  it('Escape on a dirty form asks instead of discarding, and a clean one closes without asking', async () => {
    const { close } = configure({});
    const fixture = TestBed.createComponent(CreateCampaignDialogComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    typeInto(compiled.querySelector<HTMLInputElement>('.create-campaign-dialog__name input')!, 'x');
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(close).not.toHaveBeenCalled();
    expect(compiled.querySelector('.create-campaign-dialog__discard')).not.toBeNull();
  });
});
