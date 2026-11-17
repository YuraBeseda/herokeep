import { ItemIconRefSchema } from '@hk/protocol';

/** Plan 18: the uploaded-icon blob hashes a hero's custom items reference (`custom.icon`). */
export function customIconBlobHashes(
  inventory: readonly { readonly custom?: Readonly<Record<string, unknown>> }[] | undefined,
): string[] {
  const hashes = (inventory ?? []).flatMap((row) => {
    const ref = ItemIconRefSchema.safeParse(row.custom?.['icon']);
    return ref.success && ref.data.kind === 'blob' ? [ref.data.hash] : [];
  });
  return [...new Set(hashes)];
}
