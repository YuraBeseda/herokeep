import { Component } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';

/**
 * Placeholder shell for `/register` (Task 4 brief). Task 5 builds the real form: live
 * `checkPassword` verdicts, device label, then the ADR-012 recovery-codes step (6 grouped codes,
 * copy/download, an "I saved my codes" confirm gate before `AuthService.register` is treated as
 * done). See `login.component.ts`'s header comment for why this shell is intentionally minimal.
 */
@Component({
  selector: 'app-register',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('auth')],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {}
