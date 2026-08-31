import type { Pack } from '@hk/protocol';
import { PACK_ID, PACK_VERSION, SYSTEM_ID } from '../version.ts';

/**
 * The verbatim SRD 5.2.1 attribution statement required by the Creative Commons Attribution 4.0
 * International License. Do not paraphrase or reword.
 */
export const ATTRIBUTION =
  'This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, ' +
  'available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 ' +
  'International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.';

/** The pack-level fields (everything except `entities`, `overrides`, `assets`, `i18n`, `strings`, `dependencies`, `translates`). */
export type PackManifest = Omit<
  Pack,
  'entities' | 'overrides' | 'assets' | 'i18n' | 'strings' | 'dependencies' | 'translates'
>;

/** The `srd-5e-2024` core pack manifest: identity, licensing, and attribution. */
export function packManifest(): PackManifest {
  return {
    format: 1,
    id: PACK_ID,
    version: PACK_VERSION,
    kind: 'core',
    system: SYSTEM_ID,
    name: 'SRD 5.2.1 (2024 rules)',
    description: 'The D&D 5e 2024 System Reference Document 5.2.1, packaged as a Herokeep core content pack.',
    authors: ['Wizards of the Coast (SRD 5.2.1)', 'Herokeep contributors'],
    license: 'CC-BY-4.0',
    attribution: ATTRIBUTION,
    locale: 'en',
  };
}
