import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChipComponent } from './chip.component';

@Component({
  selector: 'app-chip-host',
  imports: [ChipComponent],
  template: `
    <hk-chip
      [selected]="selected()"
      [removable]="removable()"
      (remove)="onRemove()"
      (click)="onActivate()"
    >
      {{ label() }}
      <span hk-chip-remove>{{ removeLabel() }}</span>
    </hk-chip>
  `,
})
class HostComponent {
  readonly selected = signal(false);
  readonly removable = signal(false);
  readonly label = signal('Wizard');
  readonly removeLabel = signal('Remove');
  activations = 0;
  removals = 0;

  onActivate(): void {
    this.activations++;
  }

  onRemove(): void {
    this.removals++;
  }
}

describe('ChipComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  it('reflects selected via aria-pressed and a host class', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const chip = compiled.querySelector('hk-chip')!;
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.classList.contains('hk-chip--selected')).toBe(false);

    fixture.componentInstance.selected.set(true);
    await fixture.whenStable();
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.classList.contains('hk-chip--selected')).toBe(true);
  });

  it('does not render a remove affordance when not removable', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.hk-chip__remove')).toBeNull();
  });

  it('renders a remove affordance and emits remove without activating the chip when removable', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.removable.set(true);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const removeButton = compiled.querySelector<HTMLButtonElement>('.hk-chip__remove')!;
    expect(removeButton).not.toBeNull();

    removeButton.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.removals).toBe(1);
    expect(fixture.componentInstance.activations).toBe(0);
  });

  it('activates via a click on the chip itself', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const chip = compiled.querySelector<HTMLElement>('hk-chip')!;

    chip.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.activations).toBe(1);
  });

  it('is keyboard-activatable via Enter on the chip itself', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const chip = compiled.querySelector('hk-chip')!;

    expect(chip.getAttribute('tabindex')).toBe('0');
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();

    expect(fixture.componentInstance.activations).toBe(1);
  });
});
