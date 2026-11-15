import { TestBed } from '@angular/core/testing';
import { seedFighter } from '../testing/character-fixtures';
import { setupLeafSpec } from './play-spec-support';
import { PlayTabComponent } from './play-tab.component';

// R39 tablet sub-tabs: a tablist with roving tabindex, arrow-key navigation and tabpanels.
describe('PlayTabComponent sub-tabs', () => {
  setupLeafSpec();

  async function mount() {
    await seedFighter('Ivan');
    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    return { fixture, root, tabs };
  }

  function press(el: HTMLElement, key: string): void {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  it('ArrowRight and ArrowLeft move selection and focus between the tabs (roving tabindex)', async () => {
    const { fixture, root, tabs } = await mount();
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1]);

    tabs[0].focus();
    press(tabs[0], 'ArrowRight');
    await fixture.whenStable();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0]);
    expect(document.activeElement).toBe(tabs[1]);
    expect(root.querySelector('.play-tab')!.getAttribute('data-section')).toBe('spells');

    press(tabs[1], 'ArrowLeft');
    await fixture.whenStable();
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('each tab controls a labelled tabpanel', async () => {
    const { root, tabs } = await mount();
    for (const tab of tabs) {
      const panel = root.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`);
      expect(panel, tab.id).not.toBeNull();
      expect(panel!.getAttribute('role')).toBe('tabpanel');
      expect(panel!.getAttribute('aria-labelledby')).toBe(tab.id);
    }
  });
});
