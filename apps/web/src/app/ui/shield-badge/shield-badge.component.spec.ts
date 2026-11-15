import { TestBed } from '@angular/core/testing';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkShieldBadgeComponent } from './shield-badge.component';

async function make(inputs: Record<string, unknown>) {
  await TestBed.configureTestingModule({
    providers: [provideShellTransloco()],
  }).compileComponents();
  const fixture = TestBed.createComponent(HkShieldBadgeComponent);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('HkShieldBadgeComponent', () => {
  it('is an image named by the armor class, with the number drawn on the plate', async () => {
    const { el } = await make({ value: 18 });
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Armor class 18');
    expect(el.querySelector('text')!.textContent).toBe('18');
  });

  it('lets the caller supply the full sourced description', async () => {
    const { fixture, el } = await make({
      value: 20,
      hint: 'Armor class 20, +2 from Shield of Faith',
    });
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toBe(
      'Armor class 20, +2 from Shield of Faith',
    );
    expect(el.hasAttribute('aria-describedby')).toBe(false);
    el.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(el.getAttribute('aria-describedby')).toMatch(/^hk-tip-/);
  });

  it('has an m and an s size', async () => {
    const { fixture, el } = await make({ value: 12 });
    expect(el.querySelector('svg')!.getAttribute('width')).toBe('82');
    fixture.componentRef.setInput('size', 's');
    await fixture.whenStable();
    expect(el.querySelector('svg')!.getAttribute('width')).toBe('56');
  });
});
