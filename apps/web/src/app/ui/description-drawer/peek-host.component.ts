import { NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { HkDescriptionDrawerComponent } from './description-drawer.component';
import { PeekService } from './peek.service';

/**
 * `hk-peek-host` — the one place the description peek renders (`app.html`, out of every
 * transformed ancestor). The drawer is stamped under the caller's injector (`ctx.injector`), so a
 * hero's or the wizard's scope (pinned packs, `?for=`, proficiency-gated counts) still applies;
 * the caller's `ctx.actions` template fills the footer.
 */
@Component({
  selector: 'hk-peek-host',
  imports: [HkDescriptionDrawerComponent, NgTemplateOutlet],
  template: `
    @if (peek.current(); as peeked) {
      <ng-template #drawer>
        <hk-description-drawer
          [peek]="true"
          [entity]="peeked.entityId"
          [opener]="peeked.opener"
          [open]="true"
          (openChange)="$event || peek.close()"
        >
          <ng-container
            ngProjectAs="[hkDrawerAction]"
            [ngTemplateOutlet]="peeked.ctx?.actions ?? null"
          />
        </hk-description-drawer>
      </ng-template>
      <ng-container
        [ngTemplateOutlet]="drawer"
        [ngTemplateOutletInjector]="peeked.ctx?.injector ?? null"
      />
    }
  `,
})
export class HkPeekHostComponent {
  protected readonly peek = inject(PeekService);
}
