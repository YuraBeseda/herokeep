import { TestBed } from '@angular/core/testing';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkAbilitySealComponent } from './ability-seal.component';

async function make(inputs: Record<string, unknown>) {
  await TestBed.configureTestingModule({
    providers: [provideShellTransloco()],
  }).compileComponents();
  const fixture = TestBed.createComponent(HkAbilitySealComponent);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const base = { ability: 'Strength', score: 16, modifier: 3, save: 6, saveProficient: true };

describe('HkAbilitySealComponent', () => {
  it('embosses the signed modifier in the wax seal and names the ability beneath', async () => {
    const { el } = await make(base);
    const texts = Array.from(el.querySelectorAll('hk-wax-seal text')).map((t) => t.textContent);
    expect(texts).toEqual(['+3', '+3']);
    expect(el.querySelector('.hk-ability__name')!.textContent?.trim()).toBe('Strength');
  });

  it('writes a negative modifier with a real minus sign', async () => {
    const { el } = await make({ ...base, modifier: -1 });
    expect(el.querySelector('hk-wax-seal text')!.textContent).toBe('−1');
  });

  it('is an image carrying the ability, score and modifier', async () => {
    const { el } = await make(base);
    expect(el.querySelector('hk-wax-seal svg')!.getAttribute('aria-label')).toBe(
      'Strength 16, modifier +3',
    );
  });

  it('shows the score on a brass plate with a hint, and no words', async () => {
    const { fixture, el } = await make(base);
    const plate = el.querySelector('.hk-ability__score')!;
    expect(plate.textContent?.trim()).toBe('16');
    expect(plate.hasAttribute('aria-describedby')).toBe(false);
    plate.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(plate.getAttribute('aria-describedby')).toMatch(/^hk-tip-/);
    expect(plate.getAttribute('aria-label')).toBe('Score 16');
  });

  it('shows the save on a leather plate with a shield glyph and the proficiency star as glyphs only', async () => {
    const { fixture, el } = await make(base);
    const save = el.querySelector('.hk-ability__save')!;
    expect(save.textContent?.trim()).toBe('+6');
    expect(save.getAttribute('aria-label')).toBe('Saving throw +6');
    const uses = Array.from(save.querySelectorAll('hk-icon use')).map((u) =>
      u.getAttribute('href'),
    );
    expect(uses).toEqual(['assets/icons/sprite.svg#ui-save', 'assets/icons/sprite.svg#gi-star']);
    const star = el.querySelector('.hk-ability__star')!;
    expect(star.getAttribute('aria-label')).toBe('Proficient saving throw');
    expect(star.hasAttribute('aria-describedby')).toBe(false);
    star.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(star.getAttribute('aria-describedby')).toMatch(/^hk-tip-/);
    // R14: neither glyph prints its hint.
    expect(save.textContent).not.toMatch(/proficient|saving/i);
  });

  it('omits the star when not proficient', async () => {
    const { el } = await make({ ...base, saveProficient: false });
    expect(el.querySelector('.hk-ability__star')).toBeNull();
    expect(
      el.querySelector('.hk-ability__save')!.classList.contains('hk-ability__save--prof'),
    ).toBe(false);
  });

  it('has a compact (phone) seal size', async () => {
    const { fixture, el } = await make(base);
    expect(el.querySelector('hk-wax-seal')!.classList.contains('hk-wax-seal--l')).toBe(true);
    fixture.componentRef.setInput('compact', true);
    await fixture.whenStable();
    expect(el.classList.contains('hk-ability--compact')).toBe(true);
  });
});
