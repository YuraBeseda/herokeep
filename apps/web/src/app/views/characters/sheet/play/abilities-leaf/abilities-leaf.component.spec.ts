import { TestBed } from '@angular/core/testing';
import { RollLogService } from '@shared/services/roll-log/roll-log.service';
import { CharacterStore } from '@shared/stores/character.store';
import { seedFighter } from '../../testing/character-fixtures';
import { setupLeafSpec } from '../play-spec-support';
import { AbilitiesLeafComponent } from './abilities-leaf.component';

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
