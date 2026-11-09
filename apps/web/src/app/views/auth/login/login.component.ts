import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { authErrorKey, AuthService } from '@shared/services/auth/auth.service';
import { defaultDeviceLabel } from '@shared/services/auth/device-label';
import { IconComponent } from '../../../shared/icons/icon.component';
import { HkBannerComponent } from '../../../ui/banner/banner.component';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { HkTextFieldComponent } from '../../../ui/text-field/text-field.component';
import { AuthCardComponent } from '../auth-card.component';
import { useAuthPage } from '../auth-page';
import { isSameAppPath, returnSection } from '../return-section';

/** The one failure that belongs under a field: it names the password, never the username (no
 * user-exists oracle), so it shows under the password. Every other failure is the whole form's. */
const PASSWORD_ERROR_KEY = 'errors.invalidCredentials';

/**
 * `/login` (task-5-brief.md): username/password/device-label → `AuthService.login`. Error
 * mapping is entirely delegated to `authErrorKey` (`auth.service.ts`) — it already resolves a
 * 401 to the generic "invalid credentials" key (no existence hints), a 429 to the lockout key,
 * and a network-level (`status: 0`) failure to the offline key; this component never inspects
 * `err.status`/`err.code` itself, just renders whatever scope-relative key comes back.
 *
 * `?returnUrl=` (plan-10 task-6-brief.md's `authGuard`): on a successful login, navigates back to
 * whatever URL `authGuard` redirected FROM (e.g. a deep-linked `/g/<id>/lobby`) instead of always
 * bouncing to `/characters`. Guarded to a same-app relative path (`isSameAppPath`: starts with one
 * slash, rejecting a protocol-relative `//host/...` value too) before ever calling `navigateByUrl`
 * — defense in depth only, since `Router.navigateByUrl` already can't leave the SPA for an
 * absolute/external URL, but a same-app-only allowlist costs nothing and removes any doubt. The same
 * URL names the section the person was sent from in a notice above the fields (board AU01).
 *
 * Board AU01: a centred leaf whose own leather strap carries the primary button; the page strap
 * (`useAuthPage`) keeps Back and Help.
 */
@Component({
  selector: 'app-login',
  imports: [
    TranslocoDirective,
    RouterLink,
    AuthCardComponent,
    HkBannerComponent,
    HkButtonComponent,
    HkTextFieldComponent,
    IconComponent,
  ],
  providers: [provideTranslocoScope('auth')],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** The URL `authGuard` sent the person from, when it is a usable same-app path. */
  private readonly returnUrl = (() => {
    const url = this.route.snapshot.queryParamMap.get('returnUrl');
    return isSameAppPath(url) ? url : null;
  })();
  /** The section name the notice uses, or `null` for a plain visit (no notice). */
  protected readonly redirectSection = returnSection(this.returnUrl);

  // Form state — plain signals bound with `[value]`/`(valueChange)`.
  protected readonly username = signal('');
  protected readonly password = signal('');
  // Ruling 6: prefilled from browser hints, user-editable.
  protected readonly deviceLabel = signal(defaultDeviceLabel());

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);
  protected readonly passwordErrorKey = computed(() =>
    this.errorKey() === PASSWORD_ERROR_KEY ? PASSWORD_ERROR_KEY : undefined,
  );
  protected readonly formErrorKey = computed(() =>
    this.errorKey() === PASSWORD_ERROR_KEY ? undefined : this.errorKey(),
  );

  constructor() {
    useAuthPage();
  }

  protected onUsernameInput(value: string): void {
    this.username.set(value);
    this.errorKey.set(undefined);
  }

  protected onPasswordInput(value: string): void {
    this.password.set(value);
    this.errorKey.set(undefined);
  }

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;

    this.errorKey.set(undefined);
    this.submitting.set(true);
    try {
      await this.authService.login(this.username(), this.password(), this.deviceLabel());
      if (this.returnUrl) {
        await this.router.navigateByUrl(this.returnUrl);
      } else {
        await this.router.navigate(['/characters']);
      }
    } catch (err) {
      this.errorKey.set(authErrorKey(err));
    } finally {
      this.submitting.set(false);
    }
  }
}
