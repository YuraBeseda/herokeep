import { inject } from '@angular/core';
import { DialogService } from '@app/ui/dialog/dialog.service';
import {
  DerivedPopoverContentComponent,
  type DerivedValue,
} from '@shared/directives/derived-popover.directive';

/**
 * Opens the provenance popover of a derived number (the same dialog `hkDerived` opens: every
 * contribution behind it, with localized source names). For the design components that draw their
 * numbers inside (ability seal, skill row, attack row, pool bar), which report `inspect` instead of
 * carrying the directive. Call in an injection context; returns the opener.
 */
export function breakdownOpener(): (value: DerivedValue) => void {
  const dialogService = inject(DialogService);
  return (value) => void dialogService.open(DerivedPopoverContentComponent, { data: value });
}
