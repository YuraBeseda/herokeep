import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import { ApiError } from '@shared/services/api/api-fetch';
import { AuthService } from '@shared/services/auth/auth.service';
import authEn from '../../../assets/i18n/auth/en.json';
import { typeInto } from '../../ui/testing/harness';
import { RecoveryCodesDialogComponent } from './recovery-codes-dialog.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'auth/en' ? authEn : {});
  }
}

const CODES = ['aaaa-1111', 'bbbb-2222'];

async function mountDialog(regenerate: ReturnType<typeof vi.fn>) {
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
      { provide: AuthService, useValue: { regenerateRecoveryCodes: regenerate } },
    ],
  });
  const fixture = TestBed.createComponent(RecoveryCodesDialogComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  async function submit(password: string) {
    typeInto(el.querySelector<HTMLInputElement>('input[type="password"]')!, password);
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('.recovery-codes-dialog__submit')!.click();
    await fixture.whenStable();
  }
  return { el, close, submit };
}

describe('RecoveryCodesDialogComponent', () => {
  it('asks for the password first and warns that the old codes stop working', async () => {
    const { el } = await mountDialog(vi.fn());

    expect(el.querySelector('input[type="password"]')).not.toBeNull();
    expect(el.querySelector('.recovery-codes-dialog__warning')?.textContent?.trim()).toBe(
      authEn.regenerate.warning,
    );
    expect(el.querySelector('hk-recovery-codes')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('.recovery-codes-dialog__submit')!.disabled).toBe(
      true,
    );
  });

  it('shows the new codes with copy and download after the password is accepted', async () => {
    const regenerate = vi.fn().mockResolvedValue(CODES);
    const { el, submit } = await mountDialog(regenerate);

    await submit('correct horse');

    expect(regenerate).toHaveBeenCalledWith('correct horse');
    expect([...el.querySelectorAll('.recovery-codes__code')].map((li) => li.textContent)).toEqual(
      CODES,
    );
    expect(el.querySelector('.recovery-codes__copy')).not.toBeNull();
    expect(el.querySelector('.recovery-codes__download')).not.toBeNull();
    expect(document.activeElement).toBe(el.querySelector('.recovery-codes-dialog__saved'));
    expect(el.querySelector('.recovery-codes-dialog__warning')?.textContent?.trim()).toBe(
      authEn.regenerate.warning,
    );
    expect(el.querySelector('input[type="password"]')).toBeNull();
  });

  it('a wrong password shows the login error text and no codes', async () => {
    const regenerate = vi
      .fn()
      .mockRejectedValue(new ApiError(401, 'unauthorized', 'Unauthorized'));
    const { el, submit } = await mountDialog(regenerate);

    await submit('nope');

    expect(el.textContent).toContain(authEn.errors.invalidCredentials);
    expect(el.querySelector('.recovery-codes__code')).toBeNull();
  });

  it('an expired session shows the session-expired text, not the login error', async () => {
    const regenerate = vi.fn().mockRejectedValue(new ApiError(401, 'session_expired', 'expired'));
    const { el, submit } = await mountDialog(regenerate);

    await submit('pw');

    expect(el.textContent).toContain(authEn.errors.sessionExpired);
    expect(el.textContent).not.toContain(authEn.errors.invalidCredentials);
  });

  it('Done closes the dialog', async () => {
    const { el, close, submit } = await mountDialog(vi.fn().mockResolvedValue(CODES));
    await submit('pw');

    el.querySelector<HTMLButtonElement>('.recovery-codes-dialog__done')!.click();

    expect(close).toHaveBeenCalled();
  });
});