import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { CampaignWriterService } from '@shared/services/export/campaign-writer.service';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import {
  CampaignExportDialogComponent,
  type CampaignExportDialogData,
} from './campaign-export-dialog.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

const DATA: CampaignExportDialogData = {
  campaignId: '00000000-0000-4000-8000-0000000000a1',
  name: 'The Sunless Citadel',
};

function configure(options: {
  exportFn?: ReturnType<typeof vi.fn>;
  data?: CampaignExportDialogData;
}): {
  close: ReturnType<typeof vi.fn>;
  exportFn: ReturnType<typeof vi.fn>;
  toastShow: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  const exportFn =
    options.exportFn ??
    vi.fn().mockResolvedValue({
      blob: new Blob(['zip bytes'], { type: 'application/zip' }),
      fileName: 'The Sunless Citadel.herocampaign',
    });
  const toastShow = vi.fn();

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
      { provide: DialogRef, useValue: { close, setDismissible: vi.fn() } },
      { provide: DIALOG_DATA, useValue: options.data ?? DATA },
      { provide: CampaignWriterService, useValue: { export: exportFn } },
      { provide: ToastService, useValue: { show: toastShow } },
    ],
  });

  return { close, exportFn, toastShow };
}

async function whenStable(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await fixture.whenStable();
  await fixture.whenStable();
}

describe('CampaignExportDialogComponent', () => {
  it('has an accessible title (data-dialog-title) and states inclusions/exclusions per ruling 9 (no member characters, no images, no import)', async () => {
    configure({});
    const fixture = TestBed.createComponent(CampaignExportDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    const title = compiled.querySelector('[data-dialog-title]');
    expect(title).not.toBeNull();
    expect(title!.textContent?.trim()).toBe(campaignsEn.export.title);
    expect(compiled.textContent).toContain(campaignsEn.export.body);
  });

  it('Cancel closes with false and never calls the writer', async () => {
    const { close, exportFn } = configure({});
    const fixture = TestBed.createComponent(CampaignExportDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.campaign-export-dialog__cancel')!.click();

    expect(close).toHaveBeenCalledWith(false);
    expect(exportFn).not.toHaveBeenCalled();
  });

  it('Export calls CampaignWriterService.export with the dialog data, delivers the bundle (jsdom falls through to the <a download> fallback), toasts success, and closes with true', async () => {
    const { close, exportFn, toastShow } = configure({});
    const fixture = TestBed.createComponent(CampaignExportDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.campaign-export-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(exportFn).toHaveBeenCalledWith(DATA.campaignId, DATA.name);
    expect(toastShow).toHaveBeenCalledWith('campaigns.export.success');
    expect(close).toHaveBeenCalledWith(true);
  });

  it('a CampaignWriterService.export failure toasts export.failure and leaves the dialog open', async () => {
    const exportFn = vi.fn().mockRejectedValue(new Error('boom'));
    const { close, toastShow } = configure({ exportFn });
    const fixture = TestBed.createComponent(CampaignExportDialogComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('.campaign-export-dialog__confirm')!.click();
    await whenStable(fixture);

    expect(toastShow).toHaveBeenCalledWith('campaigns.export.failure');
    expect(close).not.toHaveBeenCalled();
  });
});
