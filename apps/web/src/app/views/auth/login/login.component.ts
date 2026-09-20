import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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
      await this.router.navigate(['/characters']);
    } catch (err) {
      this.errorKey.set(authErrorKey(err));
    } finally {
      this.submitting.set(false);
    }
  }
}
