import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { LogTabComponent } from './log-tab.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

describe('LogTabComponent', () => {
  it('renders the placeholder heading (Task 10 replaces this)', async () => {
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
      ],
    });

    const fixture = TestBed.createComponent(LogTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.log-tab__placeholder')?.textContent?.trim()).toBe(
      campaignsEn.log.placeholder,
    );
  });
});
