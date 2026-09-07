import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VirtualListComponent } from './virtual-list.component';

interface Row {
  readonly id: string;
  readonly label: string;
}

@Component({
  selector: 'app-virtual-list-host',
  imports: [VirtualListComponent],
  template: `
    <hk-virtual-list
      [items]="items()"
      [itemSize]="itemSize()"
      style="display: block; height: 300px;"
    >
      <ng-template let-item>
        <div class="row">{{ item.label }}</div>
      </ng-template>
    </hk-virtual-list>
  `,
})
class HostComponent {
  readonly items = signal<Row[]>(
    Array.from({ length: 50 }, (_, i) => ({ id: `row-${i}`, label: `Row ${i}` })),
  );
  readonly itemSize = signal(56);
}

describe('VirtualListComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  it('wraps a cdk-virtual-scroll-viewport', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('cdk-virtual-scroll-viewport')).not.toBeNull();
  });

  it('renders projected rows for the visible items using the consumer template', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const rows = compiled.querySelectorAll('.row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent?.trim()).toBe('Row 0');
  });

  it('re-renders when the items input changes', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();

    fixture.componentInstance.items.set([{ id: 'only', label: 'Only Row' }]);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const rows = compiled.querySelectorAll('.row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent?.trim()).toBe('Only Row');
  });
});
