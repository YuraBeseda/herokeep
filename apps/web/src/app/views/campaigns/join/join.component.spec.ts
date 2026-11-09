import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router, provideRouter } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { typeInto } from '../../../ui/testing/harness';
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
  discard?: boolean;
}): { join: ReturnType<typeof vi.fn>; dialogOpen: ReturnType<typeof vi.fn> } {
  const join = options.join ?? vi.fn().mockResolvedValue('camp:new-id');
  const dialogOpen = vi.fn().mockReturnValue({ closed: Promise.resolve(options.discard ?? true) });

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
      { provide: DialogService, useValue: { open: dialogOpen } },
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

  return { join, dialogOpen };
}

describe('JoinComponent', () => {
  it('pre-fills the code field from the :code route param (the QR/link deep-link target)', async () => {
    configure({ code: '7QX4M2HN' });
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('.join__code input')!;
    expect(input.value).toBe('7QX4M2HN');
  });

  it('starts blank when reached via bare /join (no param, no query code)', async () => {
    configure({});
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('.join__code input')!;
    expect(input.value).toBe('');
  });

  it('sends the trimmed code and optional display name to CampaignStore.join, then navigates to link-character (plan-10 task-7)', async () => {
    const { join } = configure({});
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const compiled = fixture.nativeElement as HTMLElement;

    const codeInput = compiled.querySelector<HTMLInputElement>('.join__code input')!;
    codeInput.value = '  7qx4-m2hn  ';
    codeInput.dispatchEvent(new Event('input'));
    const nameInput = compiled.querySelector<HTMLInputElement>('.join__display-name input')!;
    nameInput.value = 'Bob';
    nameInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    // Sloppy input goes to the server as-is (trimmed only) — the SERVER normalizes case/dashes,
    // per task-6-brief.md's binding "Plan facts" ("the join form should accept sloppy input and
    // let the server normalize").
    expect(join).toHaveBeenCalledWith('7qx4-m2hn', 'Bob');
    expect(navigateSpy).toHaveBeenCalledWith(['/g', 'new-id', 'link-character']);
  });

  it('shows the invalid-code message for a 404 ApiError', async () => {
    const join = vi.fn().mockRejectedValue(new ApiError(404, 'not_found', 'Invalid join code'));
    configure({ join });
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const codeInput = compiled.querySelector<HTMLInputElement>('.join__code input')!;
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

    const codeInput = compiled.querySelector<HTMLInputElement>('.join__code input')!;
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

    const codeInput = compiled.querySelector<HTMLInputElement>('.join__code input')!;
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

    const codeInput = compiled.querySelector<HTMLInputElement>('.join__code input')!;
    codeInput.value = 'ABCD1234';
    codeInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(compiled.querySelector<HTMLButtonElement>('.join__confirm')!.disabled).toBe(false);
  });

  it('explains what joining does and links back to the campaigns', async () => {
    configure({});
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.join__intro')?.textContent?.trim()).toBe(
      campaignsEn.join.intro,
    );
    expect(compiled.querySelector('.join__back')?.getAttribute('href')).toBe('/campaigns');
  });

  it('leaves silently while the form is untouched, even with a code prefilled from the link', async () => {
    const { dialogOpen } = configure({ code: 'ABCD1234' });
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    expect(await fixture.componentInstance.canLeave()).toBe(true);
    expect(dialogOpen).not.toHaveBeenCalled();
  });

  it('asks once before leaving a form the user has typed in, and honours the answer', async () => {
    const stay = configure({ discard: false });
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    typeInto(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.join__code input')!,
      'ABCD',
    );
    await fixture.whenStable();
    expect(await fixture.componentInstance.canLeave()).toBe(false);
    expect(stay.dialogOpen).toHaveBeenCalledOnce();
  });

  it('does not ask after a successful join', async () => {
    const { dialogOpen } = configure({});
    const fixture = TestBed.createComponent(JoinComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    typeInto(compiled.querySelector<HTMLInputElement>('.join__code input')!, 'ABCD1234');
    await fixture.whenStable();
    compiled.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(await fixture.componentInstance.canLeave()).toBe(true);
    expect(dialogOpen).not.toHaveBeenCalled();
  });
});
