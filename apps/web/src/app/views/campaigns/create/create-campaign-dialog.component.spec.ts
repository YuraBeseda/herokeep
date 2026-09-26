import { TestBed } from '@angular/core/testing';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import type { Pack } from '@hk/protocol';
import { DialogRef } from '@shared/components/dialog/dialog.service';
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
} {
  const close = vi.fn();
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
      // No parent component provides `provideTranslocoScope('campaigns')` here (this dialog has
      // none of its own, by design — see its class doc) — this stands in for "the caller
      // (`CampaignsListComponent`) already loaded it", the same real-world precondition that
      // makes the production global-key lookup work.
      provideTranslocoScope('campaigns'),
      { provide: DialogRef, useValue: { close } },
      { provide: CampaignStore, useValue: { create } },
      { provide: PackStore, useValue: { corePack: () => options.core ?? corePack() } },
    ],
  });

  return { close, create };
}

describe('CreateCampaignDialogComponent', () => {
  it('disables Create until a non-blank name is entered', async () => {
    configure({});
    const fixture = TestBed.createComponent(CreateCampaignDialogComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const confirm = compiled.querySelector<HTMLButtonElement>('.create-campaign-dialog__confirm')!;
    expect(confirm.disabled).toBe(true);

    const input = compiled.querySelector<HTMLInputElement>('input[name="name"]')!;
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

    const input = compiled.querySelector<HTMLInputElement>('input[name="name"]')!;
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

    const input = compiled.querySelector<HTMLInputElement>('input[name="name"]')!;
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
});
