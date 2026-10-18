import type { Provider, Type } from '@angular/core';
import { DialogService } from '../../components/dialog/dialog.service';
import { EngineFacade, EngineScope } from './engine.facade';

// Kept out of `engine.facade.ts` (which is in the initial bundle) so `DialogService` and the CDK
// overlay it pulls in stay in the lazy chunks of the scoped screens that use this.

/**
 * Component-level providers that scope `EngineFacade` to `scope`'s pins (see `EngineScope`), plus
 * a component-level `DialogService`: its `inject(Injector)` is then this component's element
 * injector, so every dialog opened from inside the subtree gets a content injector parented to the
 * OPENER and resolves the scoped facade (the provenance popover, add-item, …) instead of the root.
 */
export function provideEngineScope(scope: Type<EngineScope>): Provider[] {
  return [EngineFacade, { provide: EngineScope, useExisting: scope }, DialogService];
}
