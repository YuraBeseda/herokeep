import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HkLeafComponent } from './leaf.component';

@Component({
  selector: 'app-leaf-host',
  imports: [HkLeafComponent],
  template: `
    <hk-leaf [title]="'Resources'" [icon]="'ui:features'" [phone]="phone()">
      <button hkLeafActions type="button" id="act">{{ text }}</button>
      <nav hkLeafTabs id="tabs">{{ text }}</nav>
      <p id="body">{{ text }}</p>
    </hk-leaf>
    <hk-leaf [title]="'Second'" />
  `,
})
class HostComponent {
  text = 'x';
  readonly phone = signal(false);
}

describe('HkLeafComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => fixture.destroy());

  it('is a labelled section whose h2 carries the title', () => {
    const section = root.querySelector('section')!;
    const h2 = section.querySelector('h2')!;
    expect(h2.textContent?.trim()).toBe('Resources');
    expect(section.getAttribute('aria-labelledby')).toBe(h2.id);
  });

  it('gives every leaf its own heading id', () => {
    const ids = Array.from(root.querySelectorAll('h2')).map((h) => h.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('draws the section glyph hidden from assistive tech', () => {
    const use = root.querySelector('h2 hk-icon use')!;
    expect(use.getAttribute('href')).toBe('assets/icons/sprite.svg#ui-features');
    expect(root.querySelector('h2 svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('projects header actions into the head, tabs under it and the body below', () => {
    expect(root.querySelector('.hk-leaf__actions #act')).not.toBeNull();
    expect(root.querySelector('.hk-leaf__tabs #tabs')).not.toBeNull();
    expect(root.querySelector('.hk-leaf__body #body')).not.toBeNull();
  });

  it('draws no glyph when no icon is given', () => {
    const second = root.querySelectorAll('hk-leaf')[1] as HTMLElement;
    expect(second.querySelector('h2 hk-icon')).toBeNull();
  });

  it('switches to the phone padding', async () => {
    fixture.componentInstance.phone.set(true);
    await fixture.whenStable();
    expect(root.querySelector('hk-leaf')!.classList.contains('hk-leaf--phone')).toBe(true);
  });
});
