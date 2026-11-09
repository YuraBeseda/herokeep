import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { Router } from '@angular/router';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { stubViewport } from '../../../ui/testing/viewport';
import { routes } from '../../../app.routes';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import { configureReal as configureBase, resetDb } from './play/play-spec-support';
import { seedFighter } from './testing/character-fixtures';
import { provideRouter } from '@angular/router';

// B9b: Notes and Roll log are drawers the sheet shell hosts. Every entry point (the strap on tablet
// and desktop, the More tab on a phone) opens the SAME drawer, one at a time.

function strapAction(id: string): { run(): void } {
  const config = TestBed.inject(ActionStrapService).config();
  const action = [...(config?.primary ?? []), ...(config?.secondary ?? [])].find(
    (a) => a.id === id,
  );
  if (!action) throw new Error(`no strap action "${id}"`);
  return action;
}

const drawerNamed = (root: ParentNode, title: string): HTMLElement | null =>
  Array.from(root.querySelectorAll<HTMLElement>('.hk-drawer__panel')).find(
    (panel) => panel.querySelector('h2')?.textContent?.trim() === title,
  ) ?? null;

describe('sheet drawers — Notes and Roll log', () => {
  beforeEach(async () => {
    localStorage.removeItem('hk.locale');
    configureBase([], [provideRouter(routes)]);
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.replaceChildren());
    localStorage.removeItem('hk.locale');
  });

  it('the strap Notes and Roll log actions open the drawers in the sheet, one at a time', async () => {
    const id = await seedFighter('Ivan');
    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    const fixture = harness.fixture;
    await fixture.whenStable();
    const root = harness.routeNativeElement!;
    expect(root.querySelector('.hk-drawer__panel')).toBeNull();

    strapAction('notes').run();
    await fixture.whenStable();
    expect(drawerNamed(root, charactersEn.sheet.notes.title)).not.toBeNull();
    expect(drawerNamed(root, charactersEn.sheet.roll.logTitle)).toBeNull();

    strapAction('roll-log').run();
    await fixture.whenStable();
    expect(drawerNamed(root, charactersEn.sheet.roll.logTitle)).not.toBeNull();
    expect(drawerNamed(root, charactersEn.sheet.notes.title)).toBeNull();
    expect(root.querySelectorAll('.hk-drawer__panel')).toHaveLength(1);
  });

  it('pressing the strap button again closes its drawer', async () => {
    const id = await seedFighter('Ivan');
    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await harness.fixture.whenStable();
    const root = harness.routeNativeElement!;

    strapAction('notes').run();
    await harness.fixture.whenStable();
    expect(drawerNamed(root, charactersEn.sheet.notes.title)).not.toBeNull();
    strapAction('notes').run();
    await harness.fixture.whenStable();
    expect(drawerNamed(root, charactersEn.sheet.notes.title)).toBeNull();
  });

  it('opens no dialog in the overlay (the old note list and roll-log dialogs are gone)', async () => {
    const id = await seedFighter('Ivan');
    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await harness.fixture.whenStable();

    strapAction('notes').run();
    strapAction('roll-log').run();
    await harness.fixture.whenStable();
    expect(document.querySelector('.cdk-overlay-container hk-dialog')).toBeNull();
  });

  it('on a phone the More tab Notes and Roll log rows open the same drawers', async () => {
    stubViewport({ phone: true });
    const id = await seedFighter('Ivan');
    const harness = await RouterTestingHarness.create(`/c/${id}/more`);
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toMatch(/\/more$/);
    const root = harness.routeNativeElement!;

    root.querySelector<HTMLButtonElement>('.more__notes')!.click();
    await harness.fixture.whenStable();
    expect(drawerNamed(root, charactersEn.sheet.notes.title)).not.toBeNull();

    root.querySelector<HTMLButtonElement>('.more__roll-log')!.click();
    await harness.fixture.whenStable();
    expect(drawerNamed(root, charactersEn.sheet.roll.logTitle)).not.toBeNull();
    expect(drawerNamed(root, charactersEn.sheet.notes.title)).toBeNull();
  });

  it('the drawer closes on a tab change inside the sheet', async () => {
    const id = await seedFighter('Ivan');
    const harness = await RouterTestingHarness.create(`/c/${id}/play`);
    await harness.fixture.whenStable();
    const root = harness.routeNativeElement!;
    strapAction('roll-log').run();
    await harness.fixture.whenStable();
    expect(drawerNamed(root, charactersEn.sheet.roll.logTitle)).not.toBeNull();

    await harness.navigateByUrl(`/c/${id}/timeline`);
    await harness.fixture.whenStable();
    expect(root.querySelector('.hk-drawer__panel')).toBeNull();
  });
});
