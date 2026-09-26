import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router, provideRouter } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { ApiError } from '@shared/services/api/api-fetch';
import { CampaignStore, CampaignStoreNotLeaderError } from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { JoinComponent } from './join.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

function configure(options: {
  join?: ReturnType<typeof vi.fn>;
  code?: string;
  queryCode?: string;
}): { join: ReturnType<typeof vi.fn> } {
  const join = options.join ?? vi.fn().mockResolvedValue('camp:new-id');

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
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
      { provide: CampaignStore, useValue: { join } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap(options.code ? { code: options.code } : {}),
            queryParamMap: convertToParamMap(options.queryCode ? { code: options.queryCode } : {}),
          },
        },
      },
    ],
  });

  return { join };
}

describe('JoinComponent', () => {
  it('pre-fills the code field from the :code route param (the QR/link deep-link target)', async () => {
    configure({ code: '7QX4M2HN' });
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('input[name="code"]')!;
    expect(input.value).toBe('7QX4M2HN');
  });

  it('starts blank when reached via bare /join (no param, no query code)', async () => {
    configure({});
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('input[name="code"]')!;
    expect(input.value).toBe('');
  });

  it('sends the trimmed code and optional display name to CampaignStore.join, then navigates to the new campaign lobby', async () => {
    const { join } = configure({});
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    const codeInput = compiled.querySelector<HTMLInputElement>('input[name="code"]')!;
    codeInput.value = '  7qx4-m2hn  ';
    codeInput.dispatchEvent(new Event('input'));
    const nameInput = compiled.querySelector<HTMLInputElement>('input[name="displayName"]')!;
    nameInput.value = 'Bob';
    nameInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    // Sloppy input goes to the server as-is (trimmed only) — the SERVER normalizes case/dashes,
    // per task-6-brief.md's binding "Plan facts" ("the join form should accept sloppy input and
    // let the server normalize").
    expect(join).toHaveBeenCalledWith('7qx4-m2hn', 'Bob');
    expect(navigateSpy).toHaveBeenCalledWith(['/g', 'new-id', 'lobby']);
  });

  it('shows the invalid-code message for a 404 ApiError', async () => {
    const join = vi.fn().mockRejectedValue(new ApiError(404, 'not_found', 'Invalid join code'));
    configure({ join });
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const codeInput = compiled.querySelector<HTMLInputElement>('input[name="code"]')!;
    codeInput.value = 'BADCODE1';
    codeInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn.join.errors.invalidCode);
  });

  it('shows the full-campaign message for a limit_exceeded ApiError', async () => {
    const join = vi.fn().mockRejectedValue(new ApiError(409, 'limit_exceeded', 'full'));
    configure({ join });
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const codeInput = compiled.querySelector<HTMLInputElement>('input[name="code"]')!;
    codeInput.value = 'ABCD1234';
    codeInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn.join.errors.full);
  });

  it('surfaces the not-leader error key verbatim without a generic fallback', async () => {
    const join = vi.fn().mockRejectedValue(new CampaignStoreNotLeaderError());
    configure({ join });
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const codeInput = compiled.querySelector<HTMLInputElement>('input[name="code"]')!;
    codeInput.value = 'ABCD1234';
    codeInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    const error = compiled.querySelector('[role="alert"]');
    expect(error?.textContent?.trim()).toBe(campaignsEn['not-leader']);
  });

  it('disables the submit button until a non-blank code is entered', async () => {
    configure({});
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector<HTMLButtonElement>('.join__confirm')!.disabled).toBe(true);

    const codeInput = compiled.querySelector<HTMLInputElement>('input[name="code"]')!;
    codeInput.value = 'ABCD1234';
    codeInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(compiled.querySelector<HTMLButtonElement>('.join__confirm')!.disabled).toBe(false);
  });
});
