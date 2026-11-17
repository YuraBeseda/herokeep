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

/** The same hashes read from a hero's own stream (`item.added` payloads). A snapshot lags the
 * stream (it is written only every `SNAPSHOT_EVERY` events), so references come from events. A
 * removed item's icon stays referenced, which only keeps one small blob. */
export function eventIconBlobHashes(
  events: readonly { readonly type: string; readonly payload: unknown }[],
): string[] {
  return customIconBlobHashes(
    events.flatMap((e) =>
      e.type === 'item.added' ? [e.payload as { custom?: Record<string, unknown> }] : [],
    ),
  );
}
