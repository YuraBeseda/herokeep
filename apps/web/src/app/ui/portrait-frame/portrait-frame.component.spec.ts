import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkPortraitFrameComponent } from './portrait-frame.component';

@Component({
  selector: 'app-portrait-host',
  imports: [HkPortraitFrameComponent],
  template: `
    <hk-portrait-frame [name]="'Thorin Oakenshield'">
      <button hkPortraitEdit type="button" id="edit">{{ text }}</button>
    </hk-portrait-frame>
  `,
})
class HostComponent {
  text = 'x';
}

async function make(inputs: Record<string, unknown>) {
  await TestBed.configureTestingModule({
    providers: [provideShellTransloco()],
  }).compileComponents();
  const fixture = TestBed.createComponent(HkPortraitFrameComponent);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('HkPortraitFrameComponent', () => {
  it('falls back to a two-letter monogram from the name', async () => {
    const { el } = await make({ name: 'Thorin Oakenshield' });
    const well = el.querySelector('.hk-frame__well')!;
    expect(well.textContent?.trim()).toBe('TO');
    expect(well.getAttribute('role')).toBe('img');
    expect(well.getAttribute('aria-label')).toBe('Portrait placeholder, monogram TO');
    expect(el.querySelector('img')).toBeNull();
  });

  it('uses one letter for a one-word name and an explicit monogram when given', async () => {
    expect(
      (await make({ name: 'brana' })).el.querySelector('.hk-frame__well')!.textContent,
    ).toContain('B');
    TestBed.resetTestingModule();
    const { el } = await make({ name: 'x', monogram: 'IV' });
    expect(el.querySelector('.hk-frame__well')!.textContent?.trim()).toBe('IV');
  });

  it('shows the picture with its alt text when there is one', async () => {
    const { el } = await make({ name: 'Thorin', src: 'data:image/png;base64,AAAA' });
    const img = el.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('Portrait of Thorin');
    expect(el.querySelector('.hk-frame__well')!.getAttribute('aria-label')).toBeNull();
    expect(el.querySelector('.hk-frame__well')!.textContent?.trim()).toBe('');
  });

  it('has s, m and l sizes', async () => {
    const { fixture, el } = await make({ name: 'Thorin' });
    expect(el.classList.contains('hk-frame--m')).toBe(true);
    fixture.componentRef.setInput('size', 'l');
    await fixture.whenStable();
    expect(el.classList.contains('hk-frame--l')).toBe(true);
  });

  it('draws four hidden rivets', async () => {
    const { el } = await make({ name: 'Thorin' });
    expect(el.querySelectorAll('.hk-frame__rivet')).toHaveLength(4);
    expect(el.querySelector('.hk-frame__rivet')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('projects the edit control into the corner', async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideShellTransloco()],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.hk-frame__edit #edit'),
    ).not.toBeNull();
  });
});
