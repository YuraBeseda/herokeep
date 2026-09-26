import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { authErrorKey, AuthService } from '@shared/services/auth/auth.service';
import { defaultDeviceLabel } from '@shared/services/auth/device-label';

/**
 * `/login` (task-5-brief.md): username/password/device-label → `AuthService.login`. Error
 * mapping is entirely delegated to `authErrorKey` (`auth.service.ts`) — it already resolves a
 * 401 to the generic "invalid credentials" key (no existence hints), a 429 to the lockout key,
 * and a network-level (`status: 0`) failure to the offline key; this component never inspects
 * `err.status`/`err.code` itself, just renders whatever scope-relative key comes back.
 *
 * `?returnUrl=` (plan-10 task-6-brief.md's `authGuard`): on a successful login, navigates back to
 * whatever URL `authGuard` redirected FROM (e.g. a deep-linked `/g/<id>/lobby`) instead of always
 * bouncing to `/characters`. Guarded to a same-app relative path (`startsWith('/')`, rejecting a
 * protocol-relative `//host/...` value too) before ever calling `navigateByUrl` — defense in depth
 * only, since `Router.navigateByUrl` already can't leave the SPA for an absolute/external URL (it
 * parses the string as an internal route and no-ops/errors instead of touching
 * `window.location`), but a same-app-only allowlist costs nothing and removes any doubt.
 */
@Component({
  selector: 'app-login',
  imports: [TranslocoDirective, RouterLink, ButtonComponent],
  providers: [provideTranslocoScope('auth')],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // Form state — plain signals bound with `[value]`/`(input)`, same convention as
  // `create-wizard`'s name field (see that component's template for the precedent).
  protected readonly username = signal('');
  protected readonly password = signal('');
  // Ruling 6: prefilled from browser hints, user-editable.
  protected readonly deviceLabel = signal(defaultDeviceLabel());

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  protected async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) return;

    this.errorKey.set(undefined);
    this.submitting.set(true);
    try {
      await this.authService.login(this.username(), this.password(), this.deviceLabel());
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')) {
        await this.router.navigateByUrl(returnUrl);
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
