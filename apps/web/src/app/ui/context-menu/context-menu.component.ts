import { CdkMenu, CdkMenuItem } from '@angular/cdk/menu';
import { Component, signal, type TemplateRef, viewChild } from '@angular/core';
import { provideTranslocoScope, TranslocoPipe } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import type { HkMenuItem } from './context-menu.types';

/**
 * `hk-context-menu` — the menu surface (a parchment list of `cdkMenuItem`s) that `[hkContextMenu]`
 * and `<hk-menu-button>` open. It renders nothing in place: it only holds the panel template, and
 * the opener sets `items` just before the panel is attached.
 */
@Component({
  selector: 'hk-context-menu',
  imports: [CdkMenu, CdkMenuItem, IconComponent, TranslocoPipe],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './context-menu.component.html',
  styleUrl: './context-menu.component.scss',
})
export class HkContextMenuComponent {
  readonly items = signal<readonly HkMenuItem[]>([]);
  readonly template = viewChild.required<TemplateRef<unknown>>('panel');
}
