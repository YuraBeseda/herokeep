import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Component, Injector, inject, viewChild, type TemplateRef } from '@angular/core';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { provideEngineScope } from '@shared/services/engine/engine-scope.providers';
import { CharacterEngineScope } from '@shared/stores/character-engine-scope';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import sampleJson from '../../../testing/fixtures/packs/sample-content.json';
import libraryEn from '../../../assets/i18n/library/en.json';
import shellEn from '../../../assets/i18n/shell/en.json';
import { HkPeekHostComponent } from './peek-host.component';
import { PeekService } from './peek.service';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

function readPack(json: unknown): Pack {
  const result = parsePack(json);
  if (!result.ok) throw new Error('fixture pack failed validation');
  return result.pack;
}

const corePack = readPack(
  JSON.parse(
    readFileSync(
      join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
      'utf8',
    ),
  ),
);
const samplePack = readPack(sampleJson);
const SCOPED_ID = 'sample-content:feat/lunar-insight';

class Loader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(
      ({ 'library/en': libraryEn, 'shell/en': shellEn } as Record<string, object>)[langPath] ?? {},
    );
  }
}

/** A hero-scoped caller: only its injector sees the pack the hero pins. */
@Component({
  selector: 'app-scoped-caller',
  providers: [CharacterEngineScope, provideEngineScope(CharacterEngineScope)],
  template: `
    <ng-template #actions>
      <button type="button" class="choose">{{ label }}</button>
    </ng-template>
  `,
})
class ScopedCaller {
  protected readonly label = 'Choose';
  readonly actions = viewChild.required<TemplateRef<unknown>>('actions');
  readonly injector = inject(Injector);
}

@Component({
  imports: [HkPeekHostComponent, ScopedCaller],
  template: `<app-scoped-caller /><hk-peek-host />`,
})
class Page {
  readonly caller = viewChild.required(ScopedCaller);
}

describe('HkPeekHostComponent', () => {
  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTransloco({
          config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
          loader: Loader,
        }),
        provideTranslocoMessageformat(),
        {
          provide: PackStore,
          useValue: { packs: signal([corePack, samplePack]), ready: signal(true) },
        },
        {
          provide: CharacterStore,
          useValue: {
            facts: signal({
              pins: { [corePack.id]: corePack.version, [samplePack.id]: samplePack.version },
            }),
            streamId: signal('char:hero-1'),
          },
        },
      ],
    }).compileComponents();
  });

  async function open(scoped: boolean): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(Page);
    await fixture.whenStable();
    const caller = fixture.componentInstance.caller();
    TestBed.inject(PeekService).open(
      SCOPED_ID,
      undefined,
      scoped ? { injector: caller.injector, actions: caller.actions() } : undefined,
    );
    await fixture.whenStable();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders under the caller injector: its scoped pack resolves and its actions render', async () => {
    const el = await open(true);
    expect(el.querySelector('[role="dialog"] h2')?.textContent?.trim()).toBe('Lunar Insight');
    expect(el.querySelector('hk-description-drawer .choose')?.textContent?.trim()).toBe('Choose');
    expect(
      decodeURIComponent(el.querySelector('a.hk-description__open-page')!.getAttribute('href')!),
    ).toBe(`/library/${SCOPED_ID}?for=char:hero-1`);
  });

  it('without a context it resolves at the root, where the pinned pack is unknown', async () => {
    const el = await open(false);
    expect(el.querySelector('.hk-description__not-found')).not.toBeNull();
    expect(el.querySelector('.choose')).toBeNull();
  });
});
