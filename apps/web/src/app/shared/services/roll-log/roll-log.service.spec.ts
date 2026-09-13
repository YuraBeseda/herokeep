import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CharacterStore } from '@shared/stores/character.store';
import { RollLogService } from './roll-log.service';

// `CharacterStore` is stubbed down to the one signal this service reads (`streamId`) — Angular's
// `useValue` provider typing accepts a partial literal here (same precedent
// `characters-list.component.spec.ts`/`create-wizard.component.spec.ts` already establish for
// stubbing `CharacterStore`), so no real pack/fake-indexeddb setup is needed for this unit.
function configure(streamId = signal<string | undefined>('char:a')): typeof streamId {
  TestBed.configureTestingModule({
    providers: [{ provide: CharacterStore, useValue: { streamId } }],
  });
  return streamId;
}

function injectService(): RollLogService {
  const service = TestBed.inject(RollLogService);
  // Flushes the constructor's `clearOnStreamChange` effect FIRST RUN (mirrors
  // `theme.service.spec.ts`'s own `TestBed.tick()` right after `TestBed.inject`) — that effect
  // unconditionally clears on every run, including its initial one, so entries added before this
  // flush could otherwise be wiped out by a later, incidental `TestBed.tick()`.
  TestBed.tick();
  return service;
}

describe('RollLogService', () => {
  it('adds roll entries newest-first, minting id/ts itself', () => {
    configure();
    const service = injectService();

    service.add({
      labelKey: 'sheet.roll.entries.check',
      params: { name: 'Strength' },
      dice: [{ sides: 20, value: 12, kept: true }],
      modifier: 3,
      total: 15,
    });
    service.add({
      labelKey: 'sheet.roll.entries.save',
      params: { name: 'Dexterity' },
      dice: [{ sides: 20, value: 8, kept: true }],
      modifier: 1,
      total: 9,
    });

    expect(service.entries().map((e) => e.labelKey)).toEqual([
      'sheet.roll.entries.save',
      'sheet.roll.entries.check',
    ]);
    expect(service.entries()[0]?.total).toBe(9);
    expect(service.entries()[0]?.id).toEqual(expect.any(String));
    expect(service.entries()[0]?.ts).toEqual(expect.any(String));
  });

  it('caps the log at 50 entries, dropping the oldest', () => {
    configure();
    const service = injectService();

    for (let i = 0; i < 55; i++) {
      service.add({
        labelKey: 'sheet.roll.entries.check',
        params: {},
        dice: [],
        modifier: 0,
        total: i,
      });
    }

    const entries = service.entries();
    expect(entries).toHaveLength(50);
    expect(entries[0]?.total).toBe(54); // newest survives
    expect(entries[49]?.total).toBe(5); // oldest surviving entry (0..4 fell off the cap)
  });

  it('clears the log when the character stream changes', () => {
    const streamId = configure();
    const service = injectService();
    service.add({
      labelKey: 'sheet.roll.entries.check',
      params: {},
      dice: [],
      modifier: 0,
      total: 1,
    });
    expect(service.entries()).toHaveLength(1);

    streamId.set('char:b');
    TestBed.tick();

    expect(service.entries()).toHaveLength(0);
  });

  it('addManual flags the entry manual with no dice breakdown', () => {
    configure();
    const service = injectService();

    service.addManual('sheet.roll.manual.labels.other', { note: 'physical dice' }, 17);

    const [entry] = service.entries();
    expect(entry).toMatchObject({
      labelKey: 'sheet.roll.manual.labels.other',
      params: { note: 'physical dice' },
      dice: [],
      modifier: 0,
      total: 17,
      manual: true,
    });
  });

  it('clear() empties the log', () => {
    configure();
    const service = injectService();
    service.add({
      labelKey: 'sheet.roll.entries.check',
      params: {},
      dice: [],
      modifier: 0,
      total: 1,
    });

    service.clear();

    expect(service.entries()).toHaveLength(0);
  });
});
