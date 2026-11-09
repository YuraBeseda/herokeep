import { Injectable } from '@angular/core';
import { deliverHeroBundle, type HeroDeliveryOutcome } from '../export/hero-delivery';

/** The file-extension list the save picker offers for a `.hkpack`. */
const HKPACK_EXTENSIONS = ['.hkpack'] as const;

/**
 * Hands a built `.hkpack` to the shared delivery ladder (save picker, share sheet, download).
 * A class so the packs screens inject it and their specs can replace it.
 */
@Injectable({ providedIn: 'root' })
export class HkpackDelivery {
  deliver(blob: Blob, fileName: string, description: string): Promise<HeroDeliveryOutcome> {
    return deliverHeroBundle(blob, fileName, description, HKPACK_EXTENSIONS);
  }
}
