import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import authEn from '../../../assets/i18n/auth/en.json';
import { HkRecoveryCodesComponent } from './recovery-codes.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'auth/en' ? authEn : {});
  }
}

const CODES = ['aaaa-1111', 'bbbb-2222', 'cccc-3333'];

async function mountCodes() {
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
  const fixture = TestBed.createComponent(HkRecoveryCodesComponent);
  fixture.componentRef.setInput('codes', CODES);
  await fixture.whenStable();
  const show = vi.spyOn(TestBed.inject(ToastService), 'show').mockImplementation(() => undefined);
  return { el: fixture.nativeElement as HTMLElement, show };
}

describe('HkRecoveryCodesComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists every code in a labelled list and says each works once', async () => {
    const { el } = await mountCodes();

    const items = [...el.querySelectorAll('.recovery-codes__code')].map((li) => li.textContent);
    expect(items).toEqual(CODES);
    expect(el.querySelector('.recovery-codes__list')?.getAttribute('aria-label')).toBe(
      authEn.register.codesStep.listLabel,
    );
    expect(el.querySelector('.recovery-codes__once')?.textContent?.trim()).toBe(
      authEn.register.codesStep.once,
    );
  });

  it('Copy writes the codes, one per line, and toasts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { el, show } = await mountCodes();

    el.querySelector<HTMLButtonElement>('.recovery-codes__copy')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writeText).toHaveBeenCalledWith(CODES.join('\n'));
    expect(show).toHaveBeenCalledWith('auth.register.codesStep.copied');
  });

  it('a refused clipboard toasts the failure', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { el, show } = await mountCodes();

    el.querySelector<HTMLButtonElement>('.recovery-codes__copy')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(show).toHaveBeenCalledWith('auth.register.codesStep.copy-failed');
  });

  it('Download saves the codes as a .txt file', async () => {
    const createObjectURL = vi.fn(() => 'blob:codes');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { el } = await mountCodes();

    el.querySelector<HTMLButtonElement>('.recovery-codes__download')!.click();

    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(await blob.text()).toBe(`${CODES.join('\n')}\n`);
    expect(click).toHaveBeenCalledTimes(1);
  });
});