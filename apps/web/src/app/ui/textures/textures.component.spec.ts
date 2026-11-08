import { TestBed } from '@angular/core/testing';
import { HkTexturesComponent } from './textures.component';

describe('HkTexturesComponent', () => {
  it('renders one hidden svg with the three texture filters and no data', () => {
    const fixture = TestBed.createComponent(HkTexturesComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const svgs = el.querySelectorAll('svg');
    expect(svgs).toHaveLength(1);
    expect(svgs[0].getAttribute('aria-hidden')).toBe('true');
    expect(Array.from(el.querySelectorAll('filter')).map((f) => f.id)).toEqual([
      'hkWood',
      'hkPaper',
      'hkLeather',
    ]);
    expect(el.querySelectorAll('feTurbulence')).toHaveLength(3);
    expect(el.textContent?.trim()).toBe('');
  });
});
