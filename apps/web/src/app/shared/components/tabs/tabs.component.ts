import { Component, Injector, inject, input, model, viewChildren } from '@angular/core';
import { FocusKeyManager } from '@angular/cdk/a11y';
import { TabFocusableDirective } from './tab-focusable.directive';

export interface HkTab {
  readonly id: string;
  readonly label: string;
}

@Component({
  selector: 'hk-tabs',
  imports: [TabFocusableDirective],
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.scss',
  host: {
    '(keydown)': 'onKeydown($event)',
  },
})
export class TabsComponent {
  // Dependencies
  private readonly injector = inject(Injector);

  // Inputs / model
  // Labels arrive already translated — this component never renders literal text of its own.
  readonly tabs = input.required<HkTab[]>();
  readonly selected = model<string>();

  // View
  private readonly tabButtons = viewChildren(TabFocusableDirective);

  private readonly keyManager = new FocusKeyManager<TabFocusableDirective>(
    this.tabButtons,
    this.injector,
  )
    .withHorizontalOrientation('ltr')
    .withHomeAndEnd(true)
    .withWrap();

  private initialized = false;

  constructor() {
    this.keyManager.change.subscribe((index) => {
      const tab = this.tabs()[index];
      if (tab) {
        this.selected.set(tab.id);
      }
    });
  }

  // Methods

  protected onTabClick(tab: HkTab, index: number): void {
    this.selected.set(tab.id);
    this.keyManager.setActiveItem(index);
  }

  protected onKeydown(event: KeyboardEvent): void {
    this.syncInitialActiveItem();
    this.keyManager.onKeydown(event);
  }

  protected isRovingTabStop(tab: HkTab, index: number): boolean {
    const current = this.selected();
    return current ? tab.id === current : index === 0;
  }

  // Tells the key manager which tab is active before the first arrow-key press, without
  // stealing focus on render (`updateActiveItem`, unlike `setActiveItem`, doesn't call
  // `.focus()`). Runs once; after that the key manager tracks its own active item.
  private syncInitialActiveItem(): void {
    if (this.initialized) {
      return;
    }
    const tabs = this.tabs();
    const current = this.selected();
    const index = Math.max(
      0,
      tabs.findIndex((tab) => tab.id === current),
    );
    this.keyManager.updateActiveItem(index);
    this.initialized = true;
  }
}
