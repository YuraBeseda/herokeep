import { Component } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'app-home',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('shell')],
  styleUrl: './home.component.scss',
  templateUrl: './home.component.html',
})
export class HomeComponent {}
