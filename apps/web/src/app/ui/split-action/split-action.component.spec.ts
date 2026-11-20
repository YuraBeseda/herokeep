import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideShellTransloco } from '../testing/transloco-testing';
import type { HkMenuItem } from '../context-menu/context-menu.types';
import { HkSplitActionComponent } from './split-action.component';

const ran: string[] = [];
const items: HkMenuItem[] = ['damage', 'heal', 'temp'].map((id) => ({
  id,
  labelKey: `shell.ui.hp.${id === 'temp' ? 'temp' : id}`,
  run: () => ran.push(id),
}));

async function make(): Promise<ComponentFixture<HkSplitActionComponent>> {
  await TestBed.configureTestingModule({ providers: [provideShellTransloco()] }).compileComponents();
  const fixture = TestBed.createComponent(HkSplitActionComponent);
  fixture.componentRef.setInput('items', items);
  fixture.componentRef.setInput('storageKey', 'test-hp');
  fixture.componentRef.setInput('defaultId', 'damage');
  await fixture.whenStable();
  return fixture;
}
const main = (f: { nativeElement: HTMLElement }) =>
  f.nativeElement.querySelector<HTMLButtonElement>('.hk-split__main')!;

describe('HkSplitActionComponent', () => {
  beforeEach(() => {
    localStorage.clear();
    ran.length = 0;
  });

  it('defaults to Damage and runs it from the main button', async () => {
    const f = await make();
    expect(main(f).textContent).toContain('Damage');
    main(f).click();
    expect(ran).toEqual(['damage']);
  });

  it('runs and remembers a menu choice, across re-render and a new instance', async () => {
    const f = await make();
    (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.hk-menu-button')!.click();
    await f.whenStable();
    document.querySelector<HTMLButtonElement>('[data-menu-item="heal"]')!.click();
    await new Promise((r) => setTimeout(r));
    await f.whenStable();
    expect(ran).toEqual(['heal']);
    expect(main(f).textContent).toContain('Heal');
    expect(localStorage.getItem('hk.split.test-hp')).toBe('heal');
    TestBed.resetTestingModule();
    expect(main(await make()).textContent).toContain('Heal');
  });

  it('falls back to Damage when storage throws or holds an unknown id', async () => {
    localStorage.setItem('hk.split.test-hp', 'nope');
    expect(main(await make()).textContent).toContain('Damage');
    TestBed.resetTestingModule();
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(main(await make()).textContent).toContain('Damage');
    } finally {
      spy.mockRestore();
    }
  });
});
