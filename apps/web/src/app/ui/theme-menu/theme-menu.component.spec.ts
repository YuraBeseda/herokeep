import { TestBed } from '@angular/core/testing';
import { ThemeService } from '@shared/services/theme/theme.service';
import { press } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkThemeMenuComponent } from './theme-menu.component';

async function setup(inline: boolean) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [provideShellTransloco()],
  }).compileComponents();
  const theme = TestBed.inject(ThemeService);
  theme.setTheme('tavern');
  const fixture = TestBed.createComponent(HkThemeMenuComponent);
  fixture.componentRef.setInput('inline', inline);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, el, theme, settle };
}

const radios = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));

describe('HkThemeMenuComponent', () => {
  it('inline: a radio group of the three themes with the current one checked', async () => {
    const { el } = await setup(true);
    expect(el.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Theme');
    expect(radios(el).map((r) => r.textContent?.trim())).toEqual(['Tavern', 'Scroll', 'Plain']);
    expect(radios(el).map((r) => r.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('switches the theme through ThemeService on a real click', async () => {
    const { el, theme, settle } = await setup(true);
    press(radios(el)[1]);
    await settle();
    expect(theme.theme()).toBe('scroll');
    expect(radios(el).map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('popover: starts closed behind a Theme button and opens the same radio group', async () => {
    const { el, settle } = await setup(false);
    const trigger = el.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
    expect(trigger.getAttribute('aria-label')).toBe('Theme');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(radios(el)).toHaveLength(0);
    press(trigger);
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(radios(el)).toHaveLength(3);
  });

  it('popover: Escape closes and returns focus to the button', async () => {
    const { el, settle } = await setup(false);
    document.body.append(el);
    const trigger = el.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
    trigger.focus();
    press(trigger);
    await settle();
    radios(el)[0].focus();
    radios(el)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(radios(el)).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
    el.remove();
  });

  it('popover: a pointer press outside closes it; picking a theme closes it too', async () => {
    const { el, theme, settle } = await setup(false);
    const trigger = el.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
    press(trigger);
    await settle();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(radios(el)).toHaveLength(0);

    press(trigger);
    await settle();
    press(radios(el)[2]);
    await settle();
    expect(theme.theme()).toBe('plain');
    expect(radios(el)).toHaveLength(0);
  });
});
