import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { CampaignEditLockBannerComponent } from './campaign-edit-lock-banner.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return langPath === 'campaigns/en' ? of(campaignsEn) : of({});
  }
}

function configure(): void {
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
    ],
  });
}

describe('CampaignEditLockBannerComponent', () => {
  beforeEach(() => configure());

  it('renders nothing when mode is undefined (not locked)', async () => {
    const fixture = TestBed.createComponent(CampaignEditLockBannerComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.campaign-edit-lock-banner')).toBeNull();
  });

  it('renders the "locked" copy as a status region when mode is "locked"', async () => {
    const fixture = TestBed.createComponent(CampaignEditLockBannerComponent);
    fixture.componentRef.setInput('mode', 'locked');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const banner = compiled.querySelector('.campaign-edit-lock-banner');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent?.trim()).toBe(campaignsEn.edit.locked);
  });

  it('renders the DISTINCT "dmApprovalV1" copy when mode is "dmApprovalV1" (OWNER-FLAG: v1 has no approval queue)', async () => {
    const fixture = TestBed.createComponent(CampaignEditLockBannerComponent);
    fixture.componentRef.setInput('mode', 'dmApprovalV1');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const banner = compiled.querySelector('.campaign-edit-lock-banner');
    expect(banner?.textContent?.trim()).toBe(campaignsEn.edit.dmApprovalV1);
    expect(campaignsEn.edit.dmApprovalV1).not.toBe(campaignsEn.edit.locked);
  });
});
