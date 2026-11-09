import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ToastService } from '@shared/components/toast/toast.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { CharacterStore } from '@shared/stores/character.store';
import { of } from 'rxjs';
import { HkActionStrapComponent } from '../../../ui/action-strap/action-strap.component';
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

// The route is one object for the whole module, so each entry opened in a test reads the id and
// hero context current at its construction (getters, not a snapshot taken once).
function routeStub() {
  const params = () => convertToParamMap({ id: entityId });
  const query = () => convertToParamMap(forId ? { for: forId } : {});
  return {
    get paramMap() {
      return of(params());
    },
    get queryParamMap() {
      return of(query());
    },
    get snapshot() {
      return { paramMap: params(), queryParamMap: query() };
    },
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
    fixture.detectChanges();
    TestBed.tick();
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

  it('draws the button disabled, with its reason in the hint and aria, without a hero context or for a hero that is gone', async () => {
    const heroId = await seedFighter('Ivan');

    for (const forHero of [null, `${heroId}-gone`]) {
      const { fixture, add } = await open(DAGGER, forHero);
      await fixture.whenStable();
      expect(add()?.disabled).toBe(true);
      expect(add()?.disabledReason).toBe('shell.strap.library-no-hero');
    }
    // The same slot in the real strap host: aria-disabled, the reason in a hidden description.
    const { fixture } = await open(DAGGER, null);
    const host = TestBed.createComponent(HkActionStrapComponent);
    await host.whenStable();
    host.detectChanges();
    const button = (host.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-action="add-to-hero"]',
    )!;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.querySelector('.hk-button__label')?.textContent?.trim()).toBe('Add to hero');
    const described = button
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('Open this entry from a hero');
    expect(fixture).toBeTruthy();
  });

  it('a reload with ?for= and no loaded hero loads the hero and enables the button', async () => {
    const heroId = await seedFighter('Ivan');
    await seedFighter('Other'); // the store now holds another hero, as after a reload
    const store = TestBed.inject(CharacterStore);
    expect(store.streamId()).not.toBe(heroId);

    const { fixture, add } = await open(DAGGER, heroId);
    await pollUntil(fixture, () => add()?.disabled !== true);

    expect(store.streamId()).toBe(heroId);
    const before = store.events().length;
    add()?.run();
    await pollUntil(fixture, () => store.events().length > before);
    expect(store.events().at(-1)).toMatchObject({
      type: 'item.added',
      payload: { itemId: DAGGER },
    });
  });

  it('draws a spell button disabled with the reason when the hero cannot prepare it', async () => {
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
    const reasonFor = async (id: string) => (await open(id, heroId)).add()?.disabledReason;

    expect(await reasonFor(FIREBALL)).toBe('shell.strap.library-not-known');
    expect(await reasonFor(ACID_SPLASH)).toBe('shell.strap.library-cantrip');
    expect(await reasonFor(BURNING_HANDS)).toBe('shell.strap.library-already-prepared');
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
  it('Copy link writes the entry link (without the hero) to the clipboard and says so', async () => {
    const heroId = await seedFighter('Ivan');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      const toast = vi.spyOn(TestBed.inject(ToastService), 'show');
      const { strap } = await open(FIREBALL, heroId);
      const copy = strap.config()?.secondary?.find((a) => a.id === 'copy-link');

      expect(copy?.disabled).toBeUndefined();
      copy?.run();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const link = writeText.mock.calls[0]?.[0] as string;
      expect(decodeURIComponent(link)).toBe(`${location.origin}/library/${FIREBALL}`);
      expect(link).not.toContain('for=');
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('library.detail.linkCopied'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Copy link is disabled with its reason where the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    try {
      const { strap } = await open(FIREBALL, null);
      const copy = strap.config()?.secondary?.find((a) => a.id === 'copy-link');
      expect(copy?.disabled).toBe(true);
      expect(copy?.disabledReason).toBe('shell.strap.library-no-clipboard');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Open the pack goes to the packs screen for the entry source pack', async () => {
    const { strap } = await open(FIREBALL, null);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const openPack = strap.config()?.secondary?.find((a) => a.id === 'open-pack');

    expect(openPack).toBeDefined();
    openPack?.run();
    expect(navigate).toHaveBeenCalledWith(['/packs', 'srd-5e-2024@0.1.0']);
  });
});
