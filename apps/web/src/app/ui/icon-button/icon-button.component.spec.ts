import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import shellEn from '../../../assets/i18n/shell/en.json';
import shellRu from '../../../assets/i18n/shell/ru.json';
import shellUk from '../../../assets/i18n/shell/uk.json';
import { UI_ICONS, type UiIconName } from '../icons/vocabulary';
import { HkIconButtonComponent } from './icon-button.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'shell/en') return of(shellEn);
    if (langPath === 'shell/ru') return of(shellRu);
    if (langPath === 'shell/uk') return of(shellUk);
    return of({});
  }
}

@Component({
  selector: 'app-icon-button-host',
  imports: [HkIconButtonComponent],
  template: `
    <button
      hk-icon-button
      [icon]="icon()"
      [hint]="UI_ICONS[icon()].hint"
      [variant]="variant()"
      [size]="size()"
    ></button>
  `,
})
class HostComponent {
  protected readonly UI_ICONS = UI_ICONS;
  readonly icon = signal<UiIconName>('roll');
  readonly variant = signal<'brass' | 'ghost' | 'ember' | 'moss'>('brass');
  readonly size = signal<'s' | 'm' | 'l'>('m');
}

describe('HkIconButtonComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let button: HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTransloco({
          config: {
            availableLangs: ['en', 'ru', 'uk'],
            defaultLang: 'en',
            fallbackLang: 'en',
            reRenderOnLangChange: true,
            prodMode: true,
          },
          loader: StubLoader,
        }),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
  });

  afterEach(() => fixture.destroy());

  it('renders aria-label from the translated hint', () => {
    expect(button.getAttribute('aria-label')).toBe('Roll');
  });

  it('shows the same translated text as a tooltip on focus', () => {
    button.dispatchEvent(new Event('focus'));
    const tip = document.body.querySelector('[role="tooltip"]');
    expect(tip?.textContent).toContain('Roll');
    expect(button.getAttribute('aria-describedby')).toBe(tip?.id);
    button.dispatchEvent(new Event('blur'));
  });

  it('draws the ui sprite symbol for its icon, hidden from assistive tech', () => {
    const use = button.querySelector('hk-icon use')!;
    expect(use.getAttribute('href')).toBe('assets/icons/sprite.svg#ui-roll');
    expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('follows icon and hint changes', async () => {
    fixture.componentInstance.icon.set('heal');
    await fixture.whenStable();
    expect(button.getAttribute('aria-label')).toBe('Heal');
    expect(button.querySelector('hk-icon use')!.getAttribute('href')).toBe(
      'assets/icons/sprite.svg#ui-heal',
    );
  });

  it('exposes variant and size as classes', async () => {
    expect(button.classList.contains('hk-icon-button--brass')).toBe(true);
    expect(button.classList.contains('hk-icon-button--m')).toBe(true);
    fixture.componentInstance.variant.set('ember');
    fixture.componentInstance.size.set('s');
    await fixture.whenStable();
    expect(button.classList.contains('hk-icon-button--ember')).toBe(true);
    expect(button.classList.contains('hk-icon-button--s')).toBe(true);
  });
});

describe('UI_ICONS vocabulary', () => {
  const entries = Object.entries(UI_ICONS);

  function lookup(tree: unknown, key: string): unknown {
    return key.split('.').reduce<unknown>((node, part) => {
      return typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
    }, tree);
  }

  it('has the core vocabulary', () => {
    expect(entries.length).toBeGreaterThanOrEqual(80);
    expect(UI_ICONS.concentration.gi).toBe('concentration-orb');
  });

  it.each(entries)('%s has a non-empty hint in en, ru and uk', (_name, entry) => {
    expect(entry.hint.startsWith('shell.icon.')).toBe(true);
    const key = entry.hint.slice('shell.'.length);
    for (const bundle of [shellEn, shellRu, shellUk]) {
      const value = lookup(bundle, key);
      expect(typeof value === 'string' && value.length > 0).toBe(true);
    }
  });
});
