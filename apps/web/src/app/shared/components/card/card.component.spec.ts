import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CardComponent } from './card.component';

@Component({
  selector: 'app-card-host',
  imports: [CardComponent],
  template: `
    <hk-card [header]="header()">
      <p>{{ body() }}</p>
    </hk-card>
  `,
})
class HostComponent {
  readonly header = signal<string | undefined>(undefined);
  readonly body = signal('Body content');
}

describe('CardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  it('does not render a header element when header is not provided', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.hk-card__header')).toBeNull();
  });

  it('renders the header text when header is provided', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.header.set('Spells');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const header = compiled.querySelector('.hk-card__header');
    expect(header?.textContent?.trim()).toBe('Spells');
  });

  it('always renders projected content', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('p')?.textContent?.trim()).toBe('Body content');
  });
});
