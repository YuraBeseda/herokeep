import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import packsEn from '../../../../assets/i18n/packs/en.json';
import { HomebrewLeaveConfirmComponent } from './homebrew-leave-confirm.component';
import { HomebrewNewChooserComponent } from './homebrew-new-chooser.component';
import { MarkdownHelpComponent } from './markdown-help.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'packs/en' ? packsEn : {});
  }
}

async function render<T>(component: Type<T>) {
  const close = vi.fn();
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
      { provide: DialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(component);
  await fixture.whenStable();
  return { close, root: fixture.nativeElement as HTMLElement };
}

describe('homebrew dialogs (plan 17 B12b)', () => {
  it('the new-entry chooser offers the four types and closes with the chosen one', async () => {
    const { close, root } = await render(HomebrewNewChooserComponent);
    const types = [...root.querySelectorAll<HTMLButtonElement>('.hb-chooser__type')];
    expect(types.map((b) => b.dataset['type'])).toEqual(['item', 'spell', 'feat', 'species']);
    expect(types[1].textContent).toContain(packsEn.homebrew.new.spell);
    types[1].click();
    expect(close).toHaveBeenCalledWith('spell');
  });

  it('the chooser Cancel closes with nothing', async () => {
    const { close, root } = await render(HomebrewNewChooserComponent);
    root.querySelector<HTMLButtonElement>('[data-dialog-actions] button')!.click();
    expect(close).toHaveBeenCalledWith(undefined);
  });

  it('the leave confirm closes false on Keep editing and true on Discard changes', async () => {
    const { close, root } = await render(HomebrewLeaveConfirmComponent);
    expect(root.querySelector('[data-dialog-title]')?.textContent?.trim()).toBe(
      packsEn.homebrew.leave.title,
    );
    root.querySelector<HTMLButtonElement>('.hb-leave-confirm__keep')!.click();
    expect(close).toHaveBeenLastCalledWith(false);
    root.querySelector<HTMLButtonElement>('.hb-leave-confirm__discard')!.click();
    expect(close).toHaveBeenLastCalledWith(true);
  });

  it('the Markdown help lists the syntax samples and closes', async () => {
    const { close, root } = await render(MarkdownHelpComponent);
    expect(root.querySelectorAll('.md-help__list dt')).toHaveLength(4);
    expect(root.querySelector('.md-help__list')?.textContent).toContain('**bold**');
    root.querySelector<HTMLButtonElement>('[data-dialog-actions] button')!.click();
    expect(close).toHaveBeenCalled();
  });
});
