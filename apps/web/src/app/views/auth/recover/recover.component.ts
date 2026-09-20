import { Component } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';

/**
 * Placeholder shell for `/recover` (Task 4 brief). Task 5 builds the real form: username + one
 * recovery code + new password (checked with `checkPassword`, same rules as register), then
 * `AuthService.reset` and a redirect once logged back in. See `login.component.ts`'s header
 * comment for why this shell is intentionally minimal.
 */
@Component({
  selector: 'app-recover',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('auth')],
  templateUrl: './recover.component.html',
  styleUrl: './recover.component.scss',
})
export class RecoverComponent {}
