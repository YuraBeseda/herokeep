import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { ItemIconRef } from '@hk/protocol';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { ImagePipelineService } from '../../shared/services/images/image-pipeline.service';
import { fieldId } from '../forms/value-accessor';
import { HkSearchFieldComponent } from '../search-field/search-field.component';
import { SPRITE_SLUGS } from '../sprite-slugs';

/**
 * `hk-icon-picker` — the item icon picker (board DL04): the hero's own glyphs first, then every
 * game icon in the sprite, a search over both, and "Upload your own" (resized on this device by
 * the image pipeline). `used` holds game-icon slugs (no `gi:` prefix). Emits `picked` with an
 * `ItemIconRef`; the caller owns where it is stored.
 */
@Component({
  selector: 'hk-icon-picker',
  imports: [NgTemplateOutlet, TranslocoDirective, IconComponent, HkSearchFieldComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './icon-picker.component.html',
  styleUrl: './icon-picker.component.scss',
})
export class IconPickerComponent {
  private readonly pipeline = inject(ImagePipelineService);

  readonly used = input<readonly string[]>([]);
  readonly value = input<ItemIconRef | null>(null);
  readonly picked = output<ItemIconRef>();

  protected readonly usedId = fieldId('hk-icon-picker-used');
  protected readonly allId = fieldId('hk-icon-picker-all');
  protected readonly query = signal('');
  protected readonly uploading = signal(false);
  protected readonly uploadFailed = signal(false);

  private readonly matches = computed(() => {
    const words = this.query()
      .trim()
      .toLowerCase()
      .split(/[\s-]+/)
      .filter(Boolean);
    return (slug: string) => words.every((word) => slug.includes(word));
  });
  protected readonly usedGlyphs = computed(() =>
    [...new Set(this.used())].filter((slug) => SPRITE_SLUGS.includes(slug) && this.matches()(slug)),
  );
  protected readonly otherGlyphs = computed(() => {
    const used = new Set(this.used());
    return SPRITE_SLUGS.filter((slug) => !used.has(slug) && this.matches()(slug));
  });

  protected chosen(slug: string): boolean {
    const value = this.value();
    return value?.kind === 'gi' && value.id === slug;
  }

  protected pick(slug: string): void {
    this.picked.emit({ kind: 'gi', id: slug });
  }

  protected async upload(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    this.uploading.set(true);
    this.uploadFailed.set(false);
    try {
      const { hash } = await this.pipeline.encodeIcon(file);
      this.picked.emit({ kind: 'blob', hash });
    } catch {
      this.uploadFailed.set(true);
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }
}
