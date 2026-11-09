import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { HkButtonComponent } from '../../ui/button/button.component';
import { HkLeafComponent } from '../../ui/leaf/leaf.component';

/**
 * The wildcard route's screen (board X01): an address no route matches. Says what happened, shows
 * the address as typed (the URL is kept, so a mistyped link can be fixed in place) and offers the
 * two ways back — the heroes and Home. A missing HERO has its own state inside the sheet shell.
 */
@Component({
  selector: 'app-not-found',
  imports: [TranslocoDirective, HkButtonComponent, HkLeafComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './not-found.component.html',
  styleUrl: './not-found.component.scss',
})
export class NotFoundComponent {
  private readonly router = inject(Router);

  /** The path as the user typed it, without the query or fragment. */
  protected readonly path = this.router.url.split(/[?#]/, 1)[0];

  protected go(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
