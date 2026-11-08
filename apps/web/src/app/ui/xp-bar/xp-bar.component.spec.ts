import { TestBed } from '@angular/core/testing';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkXpBarComponent } from './xp-bar.component';

async function make(inputs: Record<string, unknown>) {
  await TestBed.configureTestingModule({
    providers: [provideShellTransloco()],
  }).compileComponents();
  const fixture = TestBed.createComponent(HkXpBarComponent);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('HkXpBarComponent', () => {
  it('is a progressbar from the level floor to the next threshold', async () => {
    const { el } = await make({ xp: 6500, floor: 6500, next: 14000 });
    const bar = el.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuemin')).toBe('6500');
    expect(bar.getAttribute('aria-valuemax')).toBe('14000');
    expect(bar.getAttribute('aria-valuenow')).toBe('6500');
    expect(bar.getAttribute('aria-label')).toBe('6,500 of 14,000 XP');
  });

  it('fills (xp - floor) / (next - floor)', async () => {
    const { el } = await make({ xp: 10250, floor: 6500, next: 14000 });
    expect(el.querySelector<HTMLElement>('.hk-gauge__xp')!.style.width).toBe('50%');
  });

  it('clamps to the track and to the floor', async () => {
    const full = await make({ xp: 99999, floor: 0, next: 300 });
    expect(full.el.querySelector<HTMLElement>('.hk-gauge__xp')!.style.width).toBe('100%');
    expect(full.el.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe(
      '300',
    );
  });

  it('shows the XP label and the count with thousands separators', async () => {
    const { el } = await make({ xp: 6500, floor: 6500, next: 14000 });
    expect(el.querySelector('.hk-xp-bar__label')!.textContent?.trim()).toBe('XP');
    expect(el.querySelector('.hk-xp-bar__count')!.textContent?.trim()).toBe('6,500 / 14,000');
  });

  it('switches ink for a leaf surface', async () => {
    const { el } = await make({ xp: 1, floor: 0, next: 300, surface: 'leaf' });
    expect(el.classList.contains('hk-xp-bar--leaf')).toBe(true);
  });
});
