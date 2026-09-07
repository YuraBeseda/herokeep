import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabsComponent } from './tabs.component';

// jsdom's `KeyboardEvent` does not derive the legacy `keyCode` property from `key`/`code`
// the way real browsers do, and `@angular/cdk/a11y`'s `ListKeyManager` still switches on
// `event.keyCode` — so tests must supply it explicitly or every key press is a silent no-op.
const KEY_CODES: Record<string, number> = { ArrowLeft: 37, ArrowRight: 39, End: 35, Home: 36 };

function keydown(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, keyCode: KEY_CODES[key], bubbles: true });
}

@Component({
  selector: 'app-tabs-host',
  imports: [TabsComponent],
  template: `<hk-tabs [tabs]="tabs()" [(selected)]="selected" />`,
})
class HostComponent {
  readonly tabs = signal([
    { id: 'species', label: 'Species' },
    { id: 'classes', label: 'Classes' },
    { id: 'spells', label: 'Spells' },
  ]);
  selected = signal<string | undefined>('species');
}

describe('TabsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  it('renders a tablist with a tab per entry, marking the selected one', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = Array.from(compiled.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Species', 'Classes', 'Spells']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('updates the selected model when a tab is clicked', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const tabs = compiled.querySelectorAll<HTMLButtonElement>('[role="tab"]');

    tabs[1].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.selected()).toBe('classes');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
  });

  it('moves focus and selection with ArrowRight/ArrowLeft', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const tablist = compiled.querySelector<HTMLElement>('[role="tablist"]')!;
    const tabs = compiled.querySelectorAll<HTMLButtonElement>('[role="tab"]');

    tabs[0].focus();
    tablist.dispatchEvent(keydown('ArrowRight'));
    TestBed.tick();
    await fixture.whenStable();

    expect(fixture.componentInstance.selected()).toBe('classes');
    expect(document.activeElement).toBe(tabs[1]);

    tablist.dispatchEvent(keydown('ArrowLeft'));
    TestBed.tick();
    await fixture.whenStable();

    expect(fixture.componentInstance.selected()).toBe('species');
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('moves focus and selection to the first/last tab with Home/End', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const tablist = compiled.querySelector<HTMLElement>('[role="tablist"]')!;
    const tabs = compiled.querySelectorAll<HTMLButtonElement>('[role="tab"]');

    tabs[0].focus();
    tablist.dispatchEvent(keydown('End'));
    TestBed.tick();
    await fixture.whenStable();

    expect(fixture.componentInstance.selected()).toBe('spells');
    expect(document.activeElement).toBe(tabs[2]);

    tablist.dispatchEvent(keydown('Home'));
    TestBed.tick();
    await fixture.whenStable();

    expect(fixture.componentInstance.selected()).toBe('species');
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('gives only the selected tab a tabindex of 0 (roving tabindex)', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const tabs = compiled.querySelectorAll<HTMLButtonElement>('[role="tab"]');

    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
    expect(tabs[2].tabIndex).toBe(-1);
  });
});
