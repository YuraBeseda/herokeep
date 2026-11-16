import type { StartingOption } from '@hk/protocol';
import names from '../overlays/starting-equipment-names.json' with { type: 'json' };
import { itemId } from '../ids.ts';
import { readFixture, pkSlug } from '../upstream.ts';

export type Resolved = { item: string; qty?: number; count?: number } | { note: string };
type Overlay = Record<string, string | { note: string } | { item: string; qty: number; count?: number }>;

/**
 * Parses "Choose A or B: (A) 2 Daggers, Pack, and 15 GP; or (B) 75 GP" into the options.
 * `resolve(name)` maps an item name as written (count stripped) to a pack item or a note; it may
 * fix `qty` for bundles ("20 Arrows" is one `arrows-20`). It must throw on an unknown name.
 */
export function parseStartingEquipment(text: string, resolve: (name: string) => Resolved): StartingOption[] {
  const chunks = text.split(/\(([ABC])\)/).slice(1);
  const options: StartingOption[] = [];
  for (let i = 0; i < chunks.length; i += 2) {
    const opt: StartingOption = { label: chunks[i] as 'A' | 'B' | 'C', items: [], notes: [], gp: 0 };
    const body = chunks[i + 1]!.replace(/[;\s]*(or\s*)?$/, '');
    for (const raw of body.split(/,\s*(?:and\s+)?/)) {
      const piece = raw.trim().replace(/^and\s+/, '');
      const gp = /^(\d+) GP$/.exec(piece);
      if (gp) {
        opt.gp += Number(gp[1]);
        continue;
      }
      const m = /^(\d+) (.+)$/.exec(piece);
      const r = resolve(m ? m[2]! : piece);
      if ('note' in r) opt.notes.push(r.note);
      else {
        const count = m ? Number(m[1]) : 1;
        // A fixed overlay qty (bundles) must be for exactly the written count; `count` is the bundle size.
        if (r.qty !== undefined && count > 1 && r.count !== count)
          throw new Error(
            `starting equipment: count ${count} on "${m![2]}" conflicts with its fixed overlay quantity ${r.qty}`,
          );
        opt.items.push({ item: r.item, qty: r.qty ?? count });
      }
    }
    options.push(opt);
  }
  return options;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

let itemSlugs: Set<string> | undefined;

/** Builds the options for one class/background; throws naming `source` and the item on an unknown name. */
export function startingEquipmentFor(text: string, source: string): StartingOption[] {
  itemSlugs ??= new Set(readFixture('Item').map((r) => pkSlug(String(r.pk))));
  const overlay = names as Overlay;
  let options: StartingOption[];
  try {
    options = parseStartingEquipment(text, (name) => {
      const o = overlay[name];
      if (typeof o === 'string') return { item: o };
      if (o) return o;
      const slug = slugify(name);
      for (const s of [slug, slug.replace(/s$/, ''), slug.replace(/es$/, '')])
        if (itemSlugs!.has(s)) return { item: itemId(s) };
      throw new Error(
        `starting equipment: "${name}" (${source}) matches no item and is not in starting-equipment-names.json`,
      );
    });
  } catch (e) {
    if (e instanceof Error && !e.message.includes(`(${source})`))
      throw new Error(`${e.message} (${source})`, { cause: e });
    throw e;
  }
  if (options.length === 0) throw new Error(`starting equipment: no options found in "${source}"`);
  return options;
}
