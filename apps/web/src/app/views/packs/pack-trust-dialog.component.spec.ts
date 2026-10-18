import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Diagnostic } from '@hk/engine';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import type { PackImportPreview } from '@shared/services/packs/hkpack-reader.service';
import { PackStore } from '@shared/stores/pack.store';
import packsEn from '../../../assets/i18n/packs/en.json';
import sampleJson from '../../../testing/fixtures/packs/sample-content.json';
import { PackTrustDialogComponent } from './pack-trust-dialog.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'packs/en') return of(packsEn);
    return of({});
  }
}

const ICON_HASH = 'sha256:86be52bdb7547413cafb3ed175a806a798c65de98b40849e0b974c47d187de65';
const OVERRIDE_TARGET = 'srd-5e-2024:spell/fireball';

function samplePack(): Pack {
  const parsed = parsePack(sampleJson);
  if (!parsed.ok) throw new Error('sample-content.json fixture no longer parses');
  return parsed.pack;
}

/** A preview shaped exactly like `HkpackReader.read` returns for the sample fixture (summary
 * written out by hand from the fixture, not recomputed, so this spec pins the rendering). */
function mkPreview(overrides: Partial<PackImportPreview> = {}): PackImportPreview {
  return {
    pack: samplePack(),
    canonicalJson: '{}',
    assets: new Map([[ICON_HASH, { bytes: new Uint8Array(34), kind: 'icon', mime: 'image/webp' }]]),
    diagnostics: [],
    summary: {
      entityCounts: { item: 1, spell: 1, feat: 1, species: 1 },
      overrides: [],
      assetCount: 1,
      assetBytes: 34,
      dependencies: [{ id: 'srd-5e-2024', range: '^0.1.0' }],
    },
    alreadyInstalled: false,
    ...overrides,
  };
}

function setup(
  preview: PackImportPreview,
  options: { importContent?: ReturnType<typeof vi.fn> } = {},
) {
  const close = vi.fn();
  const importContent = options.importContent ?? vi.fn().mockResolvedValue(undefined);
  const show = vi.fn();
  const render = vi.fn((markdown: string) => Promise.resolve(markdown));

  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      { provide: DIALOG_DATA, useValue: preview },
      { provide: DialogRef, useValue: { close } },
      { provide: PackStore, useValue: { importContent } },
      { provide: ToastService, useValue: { show } },
      { provide: MarkdownService, useValue: { render } },
      { provide: LocaleService, useValue: { locale: signal('en') } },
    ],
  });

  return { close, importContent, show, render };
}

async function renderDialog() {
  const fixture = TestBed.createComponent(PackTrustDialogComponent);
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe('PackTrustDialogComponent', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('shows every ADR-008 enable-screen field from the preview', async () => {
    setup(mkPreview());
    const { root } = await renderDialog();
    const text = root.textContent ?? '';

    // Title (name) + version, authors, license, attribution (through the markdown renderer).
    expect(root.querySelector('[data-dialog-title]')?.textContent).toContain('Sample content');
    expect(text).toContain('1.0.0');
    expect(root.querySelector('.pack-info__authors')?.textContent).toContain(
      'Herokeep test fixtures',
    );
    expect(root.querySelector('.pack-info__license')?.textContent).toContain('CC-BY-4.0');
    expect(root.querySelector('.pack-info__attribution')?.textContent).toContain(
      'Herokeep sample content pack (test fixture).',
    );

    // Entity counts by type.
    for (const type of ['item', 'spell', 'feat', 'species'] as const) {
      const row = root.querySelector<HTMLElement>(`.pack-info__count[data-type="${type}"]`);
      expect(row, type).not.toBeNull();
      expect(row!.textContent).toContain(packsEn['entity-type'][type]);
      expect(row!.textContent).toContain('1');
    }
    expect(root.querySelectorAll('.pack-info__count')).toHaveLength(4);

    // Assets: count + size (34 B), dependencies (the core), no overrides, no warnings.
    const assets = root.querySelector<HTMLElement>('.pack-info__assets')!;
    expect(assets.textContent).toContain('1 image');
    expect(assets.textContent).toContain('34 B');
    const deps = root.querySelector<HTMLElement>('.pack-info__dependencies')!;
    expect(deps.textContent).toContain('srd-5e-2024');
    expect(deps.textContent).toContain('^0.1.0');
    expect(root.querySelector('.pack-info__overrides')?.textContent).toContain(
      packsEn.info['overrides-none'],
    );
    expect(root.querySelector('.pack-info__warnings')).toBeNull();
  });

  it('lists the declared override targets and validation warnings when present', async () => {
    const warning: Diagnostic = {
      severity: 'warning',
      code: 'unused-asset',
      message: 'Asset is not referenced by any entity',
    };
    setup(
      mkPreview({
        diagnostics: [warning],
        summary: { ...mkPreview().summary, overrides: [OVERRIDE_TARGET] },
      }),
    );
    const { root } = await renderDialog();

    const overrides = root.querySelector<HTMLElement>('.pack-info__overrides')!;
    expect(overrides.textContent).toContain(packsEn.info.overrides);
    expect(overrides.querySelector('.pack-info__override')?.textContent).toContain(OVERRIDE_TARGET);

    const warnings = root.querySelector<HTMLElement>('.pack-info__warnings')!;
    expect(warnings.textContent).toContain(packsEn.info.warnings);
    expect(warnings.textContent).toContain('unused-asset');
    expect(warnings.textContent).toContain('Asset is not referenced by any entity');
  });

  it('Install stores the preview once, toasts success and closes', async () => {
    const preview = mkPreview();
    const { close, importContent, show } = setup(preview);
    const { fixture, root } = await renderDialog();

    const install = root.querySelector<HTMLButtonElement>('.pack-trust-dialog__install')!;
    expect(install.disabled).toBe(false);
    expect(install.getAttribute('aria-describedby')).toBeNull();
    install.click();
    await fixture.whenStable();

    expect(importContent).toHaveBeenCalledTimes(1);
    expect(importContent).toHaveBeenCalledWith(preview);
    expect(show).toHaveBeenCalledWith('packs.import-success');
    expect(close).toHaveBeenCalledWith(true);
  });

  it('a failed install toasts install-failed and keeps the dialog open', async () => {
    const importContent = vi.fn().mockRejectedValue(new Error('quota'));
    const { close, show } = setup(mkPreview(), { importContent });
    const { fixture, root } = await renderDialog();

    root.querySelector<HTMLButtonElement>('.pack-trust-dialog__install')!.click();
    await fixture.whenStable();

    expect(show).toHaveBeenCalledWith('packs.install-failed');
    expect(close).not.toHaveBeenCalled();
  });

  it('Cancel closes without storing anything', async () => {
    const { close, importContent, show } = setup(mkPreview());
    const { fixture, root } = await renderDialog();

    root.querySelector<HTMLButtonElement>('.pack-trust-dialog__cancel')!.click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledWith(false);
    expect(importContent).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('an already-installed preview disables Install with an aria-describedby reason', async () => {
    const { importContent } = setup(mkPreview({ alreadyInstalled: true }));
    const { root } = await renderDialog();

    const install = root.querySelector<HTMLButtonElement>('.pack-trust-dialog__install')!;
    expect(install.disabled).toBe(true);
    const reasonId = install.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    expect(root.querySelector(`#${reasonId}`)?.textContent?.trim()).toBe(
      packsEn.trust['already-installed'],
    );
    install.click();
    expect(importContent).not.toHaveBeenCalled();
  });

  it('an error diagnostic disables Install with the first error as the reason', async () => {
    setup(
      mkPreview({
        diagnostics: [
          { severity: 'error', code: 'unresolved-ref', message: 'Unknown entity x' },
          { severity: 'error', code: 'second', message: 'Second error' },
        ],
      }),
    );
    const { root } = await renderDialog();

    const install = root.querySelector<HTMLButtonElement>('.pack-trust-dialog__install')!;
    expect(install.disabled).toBe(true);
    const reason = root.querySelector(`#${install.getAttribute('aria-describedby')}`);
    expect(reason?.textContent).toContain('Unknown entity x');
    expect(reason?.textContent).not.toContain('Second error');
  });

  describe('opened through DialogService', () => {
    function openReal(preview: PackImportPreview) {
      const importContent = vi.fn().mockResolvedValue(undefined);
      TestBed.configureTestingModule({
        providers: [
          provideTransloco({
            config: {
              availableLangs: ['en', 'ru', 'uk'],
              defaultLang: 'en',
              fallbackLang: 'en',
              reRenderOnLangChange: true,
              prodMode: true,
            },
            loader: StubLoader,
          }),
          provideTranslocoMessageformat(),
          { provide: PackStore, useValue: { importContent } },
          { provide: ToastService, useValue: { show: vi.fn() } },
          {
            provide: MarkdownService,
            useValue: { render: (markdown: string) => Promise.resolve(markdown) },
          },
          { provide: LocaleService, useValue: { locale: signal('en') } },
        ],
      });
      const handle = TestBed.inject(DialogService).open(PackTrustDialogComponent, {
        data: preview,
      });
      return { handle, importContent };
    }

    it('moves focus inside the dialog on open', async () => {
      const getClientRects = vi
        .spyOn(HTMLElement.prototype, 'getClientRects')
        .mockReturnValue([{}] as unknown as DOMRectList);
      try {
        const { handle } = openReal(mkPreview());
        TestBed.tick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        TestBed.tick();
        TestBed.tick();

        const surface = document.querySelector('.hk-dialog__surface')!;
        expect(surface.querySelector('app-pack-trust-dialog')).not.toBeNull();
        expect(surface.contains(document.activeElement)).toBe(true);
        handle.close();
      } finally {
        getClientRects.mockRestore();
      }
    });

    it('Escape closes the dialog without installing', async () => {
      const { handle, importContent } = openReal(mkPreview());
      TestBed.tick();

      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
      );
      TestBed.tick();

      expect(await handle.closed).toBeUndefined();
      expect(document.querySelector('app-pack-trust-dialog')).toBeNull();
      expect(importContent).not.toHaveBeenCalled();
    });
  });
});
