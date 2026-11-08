import { TestBed } from '@angular/core/testing';
import { TabBarService, type TabItem } from './tab-bar.service';

const tabs: TabItem[] = [
  { id: 'combat', label: 'shell.icon.play', icon: 'play', route: ['/c', '1', 'play'] },
];

describe('TabBarService', () => {
  it('is hidden until tabs are set and hidden again by null', () => {
    const service = TestBed.inject(TabBarService);
    expect(service.tabs()).toBeNull();
    service.set(tabs);
    expect(service.tabs()).toBe(tabs);
    service.set(null);
    expect(service.tabs()).toBeNull();
  });
});
