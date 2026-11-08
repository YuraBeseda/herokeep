import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { hintOf, press } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { stubViewport } from '../testing/viewport';
import { HkActionStrapComponent } from './action-strap.component';
import { ActionStrapService, type StrapAction, type StrapConfig } from './action-strap.service';

function act(id: string, over: Partial<StrapAction> = {}): StrapAction {
  return {
    id,
    label: `shell.icon.${id}`,
    icon: id as StrapAction['icon'],
    kind: 'primary',
    run: vi.fn(),
    ...over,
  };
}

async function setup(config: StrapConfig | null, phone = false) {
  stubViewport({ phone, coarse: phone });
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [provideShellTransloco(), provideRouter([])],
  }).compileComponents();
  const service = TestBed.inject(ActionStrapService);
  if (config) service.set(config);
  const fixture = TestBed.createComponent(HkActionStrapComponent);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, el, service, settle };
}

const names = (root: ParentNode) =>
  Array.from(root.querySelectorAll('button')).map(
    (b) => b.getAttribute('aria-label') ?? b.textContent?.trim(),
  );

afterEach(() => vi.unstubAllGlobals());

describe('HkActionStrapComponent', () => {
  it('renders nothing, and reserves no height, without a config', async () => {
    const { el } = await setup(null);
    expect(el.querySelector('footer')).toBeNull();
    expect(el.textContent?.trim()).toBe('');
  });

  it('is a labelled footer landmark with the three zones left to right', async () => {
    const { el } = await setup({
      exit: [act('home', { kind: 'ghost' })],
      primary: [act('damage', { kind: 'ember' }), act('heal'), act('roll')],
      secondary: [act('notes', { kind: 'icon' }), act('export', { kind: 'icon' })],
    });
    const footer = el.querySelector('footer')!;
    expect(footer.getAttribute('aria-label')).toBe('Actions');
    const groups = Array.from(footer.querySelectorAll('[role="group"]'));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Leave this screen',
      'Main actions',
      'More actions',
    ]);
    expect(names(footer)).toEqual(['Home', 'Damage', 'Heal', 'Roll', 'Notes', 'Export']);
  });

  it('omits the exit and secondary zones when the screen has none', async () => {
    const { el } = await setup({ primary: [act('roll')] });
    expect(el.querySelectorAll('[role="group"]')).toHaveLength(1);
  });

  it('keeps the same buttons, in the same order, when set again with the same ids', async () => {
    const { el, service, settle } = await setup({
      primary: [act('damage'), act('heal'), act('roll')],
    });
    const before = Array.from(el.querySelectorAll('button'));
    service.set({
      primary: [act('damage', { disabled: true }), act('heal'), act('roll')],
      status: 'Concentrating on Bless',
    });
    await settle();
    const after = Array.from(el.querySelectorAll('button'));
    expect(after).toHaveLength(3);
    expect(after.every((node, i) => node === before[i])).toBe(true);
  });

  it('runs an action on a real click sequence', async () => {
    const roll = act('roll');
    const { el } = await setup({ primary: [roll] });
    press(el.querySelector('button')!);
    expect(roll.run).toHaveBeenCalledTimes(1);
  });

  it('keeps a disabled action in its slot, blocks it and explains why in its hint', async () => {
    const heal = act('heal', { disabled: true, disabledReason: 'shell.icon.lock' });
    const { el } = await setup({ primary: [act('damage'), heal] });
    const button = el.querySelectorAll('button')[1];
    expect(button.getAttribute('aria-disabled')).toBe('true');
    press(button);
    expect(heal.run).not.toHaveBeenCalled();
    expect(hintOf(button)).toBe('Locked');
  });

  it('shows the status note last, on the right, on desktop', async () => {
    const { el } = await setup({ primary: [act('roll')], status: 'Concentrating on Bless' });
    const note = el.querySelector('.hk-astrap__note')!;
    expect(note.textContent).toContain('Concentrating on Bless');
    expect(el.querySelector('footer .hk-astrap__row')!.lastElementChild).toBe(note);
  });

  it('icon-only secondary actions carry an aria-label and a hint', async () => {
    const { el } = await setup({
      primary: [act('roll')],
      secondary: [act('notes', { kind: 'icon' })],
    });
    const notes = el.querySelector<HTMLButtonElement>('[aria-label="Notes"]')!;
    expect(hintOf(notes)).toBe('Notes');
  });

  describe('on a phone', () => {
    const config = (): StrapConfig => ({
      exit: [act('home', { kind: 'ghost' })],
      primary: [act('damage'), act('heal')],
      secondary: [act('notes', { kind: 'icon' }), act('export', { kind: 'icon' })],
    });

    it('collapses zone 3 into one More button and hides the secondary icons', async () => {
      const { el } = await setup(config(), true);
      expect(names(el)).toEqual(['Home', 'Damage', 'Heal', 'More actions']);
      expect(el.querySelector('[aria-label="Notes"]')).toBeNull();
    });

    it('does not render a More button when the screen has no secondary actions', async () => {
      const { el } = await setup({ primary: [act('roll')] }, true);
      expect(names(el)).toEqual(['Roll']);
    });

    it('opens a sheet with the same order and runs the chosen action, then closes', async () => {
      const cfg = config();
      const { el, settle } = await setup(cfg, true);
      press(el.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!);
      await settle();
      const sheet = el.querySelector('[role="dialog"]')!;
      expect(sheet).not.toBeNull();
      expect(
        Array.from(sheet.querySelectorAll('button')).map((b) => b.textContent?.trim()),
      ).toEqual(['Notes', 'Export']);
      press(sheet.querySelectorAll('button')[1]);
      await settle();
      expect(cfg.secondary![1].run).toHaveBeenCalledTimes(1);
      expect(el.querySelector('[role="dialog"]')).toBeNull();
    });

    it('closes on Escape and returns focus to the More button', async () => {
      const { el, settle } = await setup(config(), true);
      const more = el.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!;
      document.body.append(el);
      more.focus();
      press(more);
      await settle();
      el.querySelector('[role="dialog"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await settle();
      expect(el.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(more);
      el.remove();
    });

    it('closes on a pointer press outside, and stops listening once closed', async () => {
      const add = vi.spyOn(document, 'addEventListener');
      const remove = vi.spyOn(document, 'removeEventListener');
      const { el, settle } = await setup(config(), true);
      press(el.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!);
      await settle();
      expect(add.mock.calls.some(([type]) => type === 'pointerdown')).toBe(true);
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await settle();
      expect(el.querySelector('[role="dialog"]')).toBeNull();
      expect(remove.mock.calls.some(([type]) => type === 'pointerdown')).toBe(true);
      add.mockRestore();
      remove.mockRestore();
    });
  });
});
