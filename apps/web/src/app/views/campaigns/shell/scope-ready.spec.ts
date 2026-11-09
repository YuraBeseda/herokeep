import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { delay, of } from 'rxjs';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { campaignsScopeReady } from './scope-ready';

/** The campaigns bundle arrives a tick late, like the lazily loaded scope does. */
class SlowLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return langPath === 'campaigns/en' ? of(campaignsEn).pipe(delay(5)) : of({});
  }
}

@Component({ selector: 'app-scope-ready-host', template: '' })
class HostComponent {
  readonly ready = campaignsScopeReady(['list.create', 'list.join']);
}

describe('campaignsScopeReady', () => {
  it('stays empty until the campaigns scope is loaded, then emits the translated labels', async () => {
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
          loader: SlowLoader,
        }),
        provideTranslocoScope('campaigns'),
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    expect(fixture.componentInstance.ready()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await fixture.whenStable();
    expect(fixture.componentInstance.ready()).toEqual([
      campaignsEn.list.create,
      campaignsEn.list.join,
    ]);
  });
});
