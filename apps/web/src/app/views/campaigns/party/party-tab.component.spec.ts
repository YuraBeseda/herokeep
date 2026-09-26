import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { PartyTabComponent } from './party-tab.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

describe('PartyTabComponent', () => {
  it('renders the placeholder heading (Task 8 replaces this)', async () => {
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

    const fixture = TestBed.createComponent(PartyTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.party-tab__placeholder')?.textContent?.trim()).toBe(
      campaignsEn.party.placeholder,
    );
  });
});
