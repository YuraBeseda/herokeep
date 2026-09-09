import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { UpdateService } from '@shared/services/pwa/update.service';
import { App } from './app';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({});
  }
}

describe('App', () => {
  let updateAvailable: ReturnType<typeof signal<boolean>>;
  let activate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    updateAvailable = signal(false);
    activate = vi.fn();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
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
        // The real `UpdateService` depends on `SwUpdate`, which in turn needs a service-worker
        // registration provider this shell test doesn't set up — `UpdateService` has its own
        // dedicated spec against a stubbed `SwUpdate` (update.service.spec.ts), so here the shell
        // only needs a lightweight double for the banner's presentational contract.
        { provide: UpdateService, useValue: { updateAvailable, activate } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render a router-outlet shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('hides the update banner when no update is available', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-shell__update')).toBeNull();
  });

  it('shows the update banner and reloads via UpdateService.activate() on click', async () => {
    updateAvailable.set(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const button = compiled.querySelector<HTMLButtonElement>('.app-shell__update-button');
    expect(button).toBeTruthy();

    button?.click();
    await fixture.whenStable();

    expect(activate).toHaveBeenCalledTimes(1);
  });
});
