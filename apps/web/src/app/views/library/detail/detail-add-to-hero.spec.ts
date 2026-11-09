import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ToastService } from '@shared/components/toast/toast.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { CharacterStore } from '@shared/stores/character.store';
import { of } from 'rxjs';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { seedFighter, seedWizard } from '../../characters/sheet/testing/character-fixtures';
import { pollUntil, setupLeafSpec } from '../../characters/sheet/play/play-spec-support';
import { LibraryDetailComponent } from './detail.component';

// "Add to hero" (plan 17 B12a): the library entry opened from a sheet (`?for=<characterId>`) reuses
// the sheet's own add paths — an item into the bag, a known spell prepared. Every scenario seeds a
// REAL character (the store holds its events) and asserts on the events the click appends.
const DAGGER = 'srd-5e-2024:item/dagger';
const FIREBALL = 'srd-5e-2024:spell/fireball';
const BURNING_HANDS = 'srd-5e-2024:spell/burning-hands';
const ACID_SPLASH = 'srd-5e-2024:spell/acid-splash';
const ALERT = 'srd-5e-2024:feat/alert';
const WIZARD_CLASS = 'srd-5e-2024:class/wizard';

let entityId = DAGGER;
let forId: string | null = null;

function routeStub() {
  const paramMap = convertToParamMap({ id: entityId });
  const queryParamMap = convertToParamMap(forId ? { for: forId } : {});
  return {
    paramMap: of(paramMap),
    queryParamMap: of(queryParamMap),
    snapshot: { paramMap, queryParamMap },
  };
}

describe('LibraryDetailComponent - Add to hero', () => {
  setupLeafSpec([], [provideRouter([]), { provide: ActivatedRoute, useFactory: routeStub }]);

  beforeEach(() => {
    entityId = DAGGER;
    forId = null;
  });

  async function open(id: string, characterId: string | null) {
    entityId = id;
    forId = characterId;
    const fixture = TestBed.createComponent(LibraryDetailComponent);
    await fixture.whenStable();
    const strap = TestBed.inject(ActionStrapService);
    return {
      fixture,
      strap,
      add: () => strap.config()?.primary.find((a) => a.id === 'add-to-hero'),
    };
  }

  it('an item opened from the sheet goes into the bag through the sheet add path', async () => {
    const heroId = await seedFighter('Ivan');
    const store = TestBed.inject(CharacterStore);
    const toast = vi.spyOn(TestBed.inject(ToastService), 'show');
    const { fixture, add } = await open(DAGGER, heroId);

    expect(add()?.label).toBe('shell.strap.library-add-to-hero');
    expect(add()?.kind).toBe('primary');
    const before = store.events().length;
    add()?.run();
    await pollUntil(fixture, () => store.events().length > before);

    expect(store.events().at(-1)).toMatchObject({
      type: 'item.added',
      payload: { itemId: DAGGER, qty: 1 },
    });
    expect(store.sheet()!.inventory.some((row) => row.itemId === DAGGER)).toBe(true);
    expect(toast).toHaveBeenCalledWith('library.detail.added', { name: 'Dagger' });
  });

  it('a spell the hero knows but has not prepared is prepared, as the sheet Prepare button does', async () => {
    const heroId = await seedWizard('Elowen');
    const store = TestBed.inject(CharacterStore);
    await store.appendTx([
      {
        type: 'spell.learned',
        v: 1,
        payload: { spellId: BURNING_HANDS, classId: WIZARD_CLASS, source: 'levelUp' },
      },
    ]);
    const { fixture, add } = await open(BURNING_HANDS, heroId);

    expect(add()?.label).toBe('shell.strap.library-prepare');
    add()?.run();
    await pollUntil(fixture, () => store.sheet()!.spellcasting[0].prepared.includes(BURNING_HANDS));
    expect(store.events().at(-1)).toMatchObject({
      type: 'spell.prepared',
      payload: { spellId: BURNING_HANDS, classId: WIZARD_CLASS },
    });
  });

  it('gives no button without a hero context, and none for a hero that is not the loaded one', async () => {
    const heroId = await seedFighter('Ivan');

    expect((await open(DAGGER, null)).add()).toBeUndefined();
    expect((await open(DAGGER, `${heroId}-other`)).add()).toBeUndefined();
  });

  it('gives no button for a spell the hero does not know, a cantrip, or a spell already prepared', async () => {
    const heroId = await seedWizard('Elowen');
    const store = TestBed.inject(CharacterStore);
    await store.appendTx([
      {
        type: 'spell.learned',
        v: 1,
        payload: { spellId: ACID_SPLASH, classId: WIZARD_CLASS, source: 'levelUp' },
      },
      {
        type: 'spell.learned',
        v: 1,
        payload: { spellId: BURNING_HANDS, classId: WIZARD_CLASS, source: 'levelUp' },
      },
      { type: 'spell.prepared', v: 1, payload: { spellId: BURNING_HANDS, classId: WIZARD_CLASS } },
    ]);

    expect((await open(FIREBALL, heroId)).add()).toBeUndefined(); // not known
    expect((await open(ACID_SPLASH, heroId)).add()).toBeUndefined(); // a cantrip is not prepared
    expect((await open(BURNING_HANDS, heroId)).add()).toBeUndefined(); // already prepared
  });

  it('gives no button for entry types the sheet has no add path for', async () => {
    const heroId = await seedFighter('Ivan');

    expect((await open(ALERT, heroId)).add()).toBeUndefined();
    expect((await open('srd-5e-2024:class/fighter', heroId)).add()).toBeUndefined();
  });

  it('keeps Back in the strap and sends it to the library when there is no earlier screen', async () => {
    const { fixture, strap } = await open(DAGGER, null);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    expect(strap.config()?.exit?.map((a) => a.id)).toEqual(['back']);
    strap.config()?.exit?.[0]?.run();
    expect(navigate).toHaveBeenCalledWith(['/library']);

    const page = fixture.nativeElement as HTMLElement;
    page.querySelector<HTMLButtonElement>('.library-detail__back')!.click();
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('a cross-link in the description keeps the hero context', async () => {
    const heroId = await seedFighter('Ivan');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vi.spyOn(TestBed.inject(MarkdownService), 'render').mockResolvedValue(
      TestBed.inject(DomSanitizer).bypassSecurityTrustHtml(
        '<p><a data-entity-id="srd-5e-2024:condition/prone">Prone</a></p>',
      ),
    );
    const { fixture } = await open(FIREBALL, heroId);
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLAnchorElement>('a[data-entity-id]')!
      .click();

    expect(navigate).toHaveBeenCalledWith(['/library', 'srd-5e-2024:condition/prone'], {
      queryParams: { for: heroId },
    });
  });
});
