import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { StepperComponent, type HkStepperStep } from './stepper.component';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({
      wizard: {
        steps: {
          name: 'Name',
          species: 'Species',
          class: 'Class',
          review: 'Review',
        },
      },
    });
  }
}

@Component({
  selector: 'app-stepper-host',
  imports: [StepperComponent],
  template: `
    <hk-stepper [steps]="steps()" [activeId]="activeId()" (stepSelected)="onSelected($event)">
      <p>{{ bodyText() }}</p>
      <div hk-stepper-footer>
        <button type="button">{{ footerLabel() }}</button>
      </div>
    </hk-stepper>
  `,
})
class HostComponent {
  readonly steps = signal<HkStepperStep[]>([
    { id: 'name', labelKey: 'wizard.steps.name', state: 'done' },
    { id: 'species', labelKey: 'wizard.steps.species', state: 'current' },
    { id: 'class', labelKey: 'wizard.steps.class', state: 'todo' },
    { id: 'review', labelKey: 'wizard.steps.review', state: 'blocked' },
  ]);
  readonly activeId = signal('species');
  readonly bodyText = signal('Body for species');
  readonly footerLabel = signal('Next');
  readonly selectedIds: string[] = [];

  onSelected(id: string): void {
    this.selectedIds.push(id);
  }
}

describe('StepperComponent', () => {
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

  it('renders an <ol> of steps with translated labels and marks the active one', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('ol')).not.toBeNull();
    const steps = Array.from(compiled.querySelectorAll<HTMLButtonElement>('ol button'));
    expect(steps.map((s) => s.textContent?.trim())).toEqual(['Name', 'Species', 'Class', 'Review']);
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    expect(steps[0].getAttribute('aria-current')).toBeNull();
    expect(steps[2].getAttribute('aria-current')).toBeNull();
  });

  it('renders the default-slotted body and the footer slot content', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('p')?.textContent).toContain('species');
    expect(compiled.querySelector('[hk-stepper-footer] button')?.textContent).toContain('Next');
  });

  it('disables only todo steps, keeping done/current/blocked clickable', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const steps = compiled.querySelectorAll<HTMLButtonElement>('ol button');

    expect(steps[0].disabled).toBe(false); // done
    expect(steps[1].disabled).toBe(false); // current
    expect(steps[2].disabled).toBe(true); // todo
    // 'blocked' means "decided but currently invalid" — clickable so the user can revisit and
    // fix it, NOT "unreachable" (see the class doc's click-gating comment).
    expect(steps[3].disabled).toBe(false); // blocked
  });

  it('emits stepSelected for clickable (done/current/blocked) steps, never todo', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const steps = compiled.querySelectorAll<HTMLButtonElement>('ol button');

    steps[2].click(); // todo — must not emit
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedIds).toEqual([]);

    steps[3].click(); // blocked — emits
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedIds).toEqual(['review']);

    steps[0].click(); // done — emits
    await fixture.whenStable();
    expect(fixture.componentInstance.selectedIds).toEqual(['review', 'name']);
  });
});
