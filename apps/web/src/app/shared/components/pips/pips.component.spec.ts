import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { PipsComponent } from './pips.component';

// ICU-style single-brace interpolation (`{index}`, not `{{index}}`) — same
// `provideTranslocoMessageformat()` pairing every real `characters/*.json` string relies on
// (`assets/i18n/characters/en.json`'s own `"{count} / {max}"`-style keys), so this test exercises
// the SAME interpolation syntax `labelKey` consumers actually ship, not Transloco's unused default.
class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({ characters: { sheet: { pipLabel: 'Pip {index} of {max} ({level})' } } });
  }
}

@Component({
  selector: 'app-pips-host',
  imports: [PipsComponent],
  template: `
    <hk-pips
      [max]="max()"
      [used]="used()"
      [labelKey]="'characters.sheet.pipLabel'"
      [labelParams]="{ level: 3 }"
      [viewReadonly]="readonly()"
      (spend)="onSpend()"
      (restore)="onRestore()"
    />
  `,
})
class HostComponent {
  readonly max = signal(3);
  readonly used = signal(1);
  readonly readonly = signal(false);
  spendCount = 0;
  restoreCount = 0;

  onSpend(): void {
    this.spendCount++;
  }

  onRestore(): void {
    this.restoreCount++;
  }
}

function pipButtons(compiled: HTMLElement): HTMLButtonElement[] {
  return Array.from(compiled.querySelectorAll<HTMLButtonElement>('.hk-pips__pip'));
}

describe('PipsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTransloco({
          config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
          loader: StubLoader,
        }),
        provideTranslocoMessageformat(),
      ],
    }).compileComponents();
  });

  it('renders exactly `max` pips, the first `used` filled and aria-pressed=true, the rest empty and aria-pressed=false', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const pips = pipButtons(compiled);
    expect(pips).toHaveLength(3);
    expect(pips.map((p) => p.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(pips[0].classList.contains('hk-pips__pip--filled')).toBe(true);
    expect(pips[1].classList.contains('hk-pips__pip--filled')).toBe(false);
  });

  it('gives each pip an accessible aria-label built from labelKey + {index, max} + labelParams', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const pips = pipButtons(compiled);
    expect(pips[0].getAttribute('aria-label')).toBe('Pip 1 of 3 (3)');
    expect(pips[2].getAttribute('aria-label')).toBe('Pip 3 of 3 (3)');
  });

  it('clicking an empty (unfilled) pip emits spend, not restore', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    pipButtons(compiled)[1].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.spendCount).toBe(1);
    expect(fixture.componentInstance.restoreCount).toBe(0);
  });

  it('clicking a filled pip emits restore, not spend', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    pipButtons(compiled)[0].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.restoreCount).toBe(1);
    expect(fixture.componentInstance.spendCount).toBe(0);
  });

  it('bounds: at used=0 no pip is filled (nothing restorable); at used=max every pip is filled (nothing spendable)', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.used.set(0);
    await fixture.whenStable();
    let compiled = fixture.nativeElement as HTMLElement;
    expect(pipButtons(compiled).every((p) => p.getAttribute('aria-pressed') === 'false')).toBe(
      true,
    );

    fixture.componentInstance.used.set(3);
    await fixture.whenStable();
    compiled = fixture.nativeElement as HTMLElement;
    expect(pipButtons(compiled).every((p) => p.getAttribute('aria-pressed') === 'true')).toBe(true);
  });

  it('renders zero pips when max <= 0', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.max.set(0);
    fixture.componentInstance.used.set(0);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(pipButtons(compiled)).toHaveLength(0);
  });

  // plan-10 task-9-brief.md: the DM party-sheet drill-in's readonly-input refactor — pinned
  // separately from the (untouched, still-passing-unmodified-above) default-`false` behavior.
  describe('readonly', () => {
    it('disables every pip regardless of fill state, and neither spend nor restore ever emits', async () => {
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.readonly.set(true);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const pips = pipButtons(compiled);
      expect(pips.every((p) => p.disabled)).toBe(true);
      // Fill state is still visibly communicated — a read-only viewer must still SEE what's spent.
      expect(pips[0].getAttribute('aria-pressed')).toBe('true');
      expect(pips[1].getAttribute('aria-pressed')).toBe('false');

      pips[0].click();
      pips[1].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.spendCount).toBe(0);
      expect(fixture.componentInstance.restoreCount).toBe(0);
    });

    it('defaults to false — a consumer that never sets it is byte-identical to before this task', async () => {
      const fixture = TestBed.createComponent(HostComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(pipButtons(compiled).some((p) => p.disabled)).toBe(false);
    });
  });
});
