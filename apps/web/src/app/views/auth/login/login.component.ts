import { Component } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';

/**
 * Placeholder shell for `/login` (Task 4 brief: route scaffolding only). Task 5 builds the real
 * form (username/password/device-label fields wired to `AuthService.login`, `authErrorKey`-mapped
 * error messages, a 429-lockout-aware submit state). This component's only job right now is to
 * prove the route resolves, is lazy-loaded, sits behind `redirectAuthedGuard`, and renders through
 * the real `auth` Transloco scope — hence the one real heading below, not a TODO stub.
 */
@Component({
  selector: 'app-login',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('auth')],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {}
