import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { StatTileComponent } from './stat-tile.component';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({ sheet: { stats: { hp: 'Hit Points' } } });
  }
}

@Component({
  selector: 'app-stat-tile-host',
  imports: [StatTileComponent],
  template: `
    <hk-stat-tile
      [labelKey]="'sheet.stats.hp'"
      [value]="value()"
      [sub]="sub()"
      [emphasized]="emphasized()"
    />
  `,
})
class HostComponent {
  readonly value = signal<number | string>(19);
  readonly sub = signal<string | undefined>(undefined);
  readonly emphasized = signal(false);
}

describe('StatTileComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTransloco({
          config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
          loader: StubLoader,
        }),
      ],
    }).compileComponents();
  });

  it('renders the translated label and the numeric value', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.hk-stat-tile__label')?.textContent?.trim()).toBe('Hit Points');
    expect(compiled.querySelector('.hk-stat-tile__value')?.textContent?.trim()).toBe('19');
  });

  it('accepts a string value (e.g. a formatted modifier)', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.value.set('+2');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.hk-stat-tile__value')?.textContent?.trim()).toBe('+2');
  });

  it('does not render sub when omitted, but renders it once provided', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.hk-stat-tile__sub')).toBeNull();

    fixture.componentInstance.sub.set('+2 from shield');
    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.hk-stat-tile__sub')?.textContent?.trim()).toBe(
      '+2 from shield',
    );
  });

  it('reflects emphasized as a host class', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.emphasized.set(true);
    await fixture.whenStable();
    const host = (fixture.nativeElement as HTMLElement).querySelector('hk-stat-tile')!;
    expect(host.classList.contains('hk-stat-tile--emphasized')).toBe(true);

    fixture.componentInstance.emphasized.set(false);
    await fixture.whenStable();
    expect(host.classList.contains('hk-stat-tile--emphasized')).toBe(false);
  });
});
