import { TestBed } from '@angular/core/testing';
import { RollLogService } from '@shared/services/roll-log/roll-log.service';
import { CharacterStore } from '@shared/stores/character.store';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { signed } from '../../../../../ui/format';
import { hintOf } from '../../../../../ui/testing/harness';
import { seedFighter } from '../../testing/character-fixtures';
import { setupLeafSpec } from '../play-spec-support';
import { AbilitiesLeafComponent } from './abilities-leaf.component';

describe('AbilitiesLeafComponent mode="full" (abilities with their skills)', () => {
  setupLeafSpec();

  async function mountFull(): Promise<HTMLElement> {
    await seedFighter('Ivan');
    const fixture = TestBed.createComponent(AbilitiesLeafComponent);
    document.body.append(fixture.nativeElement as HTMLElement);
    (fixture.nativeElement as HTMLElement).classList.add('spec-host');
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const block = (root: HTMLElement, id: string) =>
    root.querySelector<HTMLElement>(`.abilities__item[data-ability="${id}"]`)!;
  const skillNames = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('hk-skill-row .hk-sk__name')).map((n) => n.textContent?.trim());
  const menuItems = () =>
    Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container .hk-menu__item'));

  it('renders one block per ability in the system entity’s order, each with its own skills', async () => {
    const root = await mountFull();
    const system = TestBed.inject(EngineFacade).index().system();
    const ids = Array.from(root.querySelectorAll<HTMLElement>('.abilities__item')).map(
      (el) => el.dataset['ability'],
    );
    expect(ids).toEqual(system.abilities.map((a) => a.id));
    // Skill -> ability comes from the pack's skill entities.
    expect(skillNames(block(root, 'dex'))).toEqual(
      expect.arrayContaining(['Acrobatics', 'Sleight of Hand', 'Stealth']),
    );
    expect(skillNames(block(root, 'str'))).toEqual(['Athletics']);
    expect(skillNames(block(root, 'con'))).toEqual([]);
    const total = Array.from(root.querySelectorAll('hk-skill-row')).length;
    expect(total).toBe(Object.keys(TestBed.inject(CharacterStore).sheet()!.skills).length);
  });

  it('a skill row shows its bonus, its proficiency mark and a breakdown hint built from the sheet', async () => {
    const root = await mountFull();
    const sheet = TestBed.inject(CharacterStore).sheet()!;
    const row = block(root, 'str').querySelector<HTMLElement>('hk-skill-row')!;
    expect(row.querySelector('.hk-sk__mod')?.textContent?.trim()).toBe(
      signed(sheet.skills['athletics'].total.value),
    );
    expect(row.querySelector('.hk-dot--proficient')).not.toBeNull();
    expect(hintOf(row.querySelector('.hk-sk__mod')!)).toBe(
      `Strength ${signed(sheet.abilities['str'].mod)}, proficiency ${signed(sheet.prof)}`,
    );
  });

  it('the ability’s dice opens check and save with their values and hints; the proficient save is marked', async () => {
    const root = await mountFull();
    const str = TestBed.inject(CharacterStore).sheet()!.abilities['str'];
    const dice = block(root, 'str').querySelector<HTMLButtonElement>('hk-menu-button button')!;
    expect(dice.getAttribute('aria-label')).toBe('Roll Strength');
    dice.click();
    TestBed.tick();
    const text = menuItems().map((i) =>
      ['label', 'hint', 'detail']
        .map((part) => i.querySelector(`.hk-menu__${part}`)?.textContent?.trim())
        .join(' | '),
    );
    expect(text).toEqual([
      `Ability check | when you try something that might fail | ${signed(str.mod)}`,
      `Saving throw, proficient | when an effect such as a spell or a trap asks you to resist it | ${signed(str.save.value)}`,
    ]);
    const log = TestBed.inject(RollLogService);
    document.querySelector<HTMLElement>('.hk-menu [data-menu-item="save"]')!.click();
    await Promise.resolve();
    TestBed.tick();
    expect(log.entries()[0]).toMatchObject({
      labelKey: 'sheet.roll.entries.save',
      params: { name: 'Strength' },
      modifier: str.save.value,
    });
  });

  it('a skill row rolls its skill', async () => {
    const root = await mountFull();
    const total = TestBed.inject(CharacterStore).sheet()!.skills['athletics'].total.value;
    block(root, 'str').querySelector<HTMLButtonElement>('hk-skill-row button')!.click();
    TestBed.tick();
    expect(TestBed.inject(RollLogService).entries()[0]).toMatchObject({
      labelKey: 'sheet.roll.entries.skill',
      params: { name: 'Athletics' },
      modifier: total,
    });
  });

  it('proficiency dots are one tab stop per block; arrow keys move between them', async () => {
    const root = await mountFull();
    const dots = Array.from(block(root, 'dex').querySelectorAll<HTMLElement>('.hk-dot'));
    expect(dots.length).toBeGreaterThan(1);
    expect(dots.map((d) => d.tabIndex)).toEqual(dots.map((_, i) => (i === 0 ? 0 : -1)));
    dots[0].focus();
    dots[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    TestBed.tick();
    expect(document.activeElement).toBe(dots[1]);
    expect(dots[1].tabIndex).toBe(0);
    expect(dots[0].tabIndex).toBe(-1);
  });
});

describe('AbilitiesLeafComponent mode="saves" (phone Combat)', () => {
  setupLeafSpec();

  async function mountSaves(): Promise<HTMLElement> {
    await seedFighter('Ivan');
    const fixture = TestBed.createComponent(AbilitiesLeafComponent);
    fixture.componentRef.setInput('mode', 'saves');
    document.body.append(fixture.nativeElement as HTMLElement);
    (fixture.nativeElement as HTMLElement).classList.add('spec-host');
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const seal = (root: HTMLElement, id: string) =>
    root.querySelector<HTMLButtonElement>(`[data-ability="${id}"] .abilities__seal`)!;

  it('renders six seal buttons, each with its abbreviation', async () => {
    const root = await mountSaves();
    const seals = root.querySelectorAll('.abilities__seal');
    expect(seals).toHaveLength(6);
    const abbrs = Array.from(root.querySelectorAll('.abilities__abbr')).map((el) =>
      el.textContent?.trim(),
    );
    expect(abbrs).toEqual(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
  });

  it('the accessible name carries the full ability name, the bonus and the score; proficiency only where it applies', async () => {
    const root = await mountSaves();
    const abilities = TestBed.inject(CharacterStore).sheet()!.abilities;
    // A fighter is proficient in Strength saves and not in Dexterity saves.
    expect(abilities['str'].saveProficient).toBe(true);
    expect(abilities['dex'].saveProficient).toBe(false);
    const sign = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

    const str = seal(root, 'str').getAttribute('aria-label')!;
    expect(str).toContain('Strength saving throw');
    expect(str).toContain(sign(abilities['str'].save.value));
    expect(str).toContain(`score ${abilities['str'].score.value}`);
    expect(str).toContain('proficient');

    const dex = seal(root, 'dex').getAttribute('aria-label')!;
    expect(dex).toContain('Dexterity saving throw');
    expect(dex).toContain(sign(abilities['dex'].save.value));
    expect(dex).toContain(`score ${abilities['dex'].score.value}`);
    expect(dex).not.toContain('proficient');
  });

  it('clicking a seal rolls that save through the real roll path and logs it', async () => {
    const root = await mountSaves();
    const save = TestBed.inject(CharacterStore).sheet()!.abilities['str'].save.value;
    const log = TestBed.inject(RollLogService);
    expect(log.entries()).toHaveLength(0);
    seal(root, 'str').click();
    TestBed.tick();
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]).toMatchObject({
      labelKey: 'sheet.roll.entries.save',
      params: { name: 'Strength' },
      modifier: save,
    });
  });
});
