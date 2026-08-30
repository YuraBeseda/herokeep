import {
  type Entity,
  EntitySchema,
  type EntityQuery,
  type EntityType,
  type Pack,
  type SystemEntity,
  parseEntityId,
} from '@hk/protocol';
import { type Diagnostic, error } from '../diagnostics.ts';
import { type Pins, resolveDependencyOrder, selectPackVersions } from './deps.ts';
import { applyPatch } from './patch.ts';

export interface ContentIndexOptions {
  pins?: Pins;
  roots?: string[];
}

export interface ContentIndex {
  get(id: string): Entity | undefined;
  has(id: string): boolean;
  byType(type: EntityType): Entity[];
  query(q: EntityQuery): Entity[];
  system(): SystemEntity;
  packs(): Pack[];
  translationPacks(): Pack[];
  resolveClassRef(ref: string): string | undefined;
  readonly diagnostics: Diagnostic[];
}

const byIdAsc = (a: Entity, b: Entity) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function createContentIndex(input: Pack[], opts: ContentIndexOptions = {}): ContentIndex {
  const diagnostics: Diagnostic[] = [];
  const { selected, diagnostics: selDiag } = selectPackVersions(input, opts.pins);
  diagnostics.push(...selDiag);
  const roots = opts.roots ?? [...selected.keys()];
  const { order, diagnostics: depDiag } = resolveDependencyOrder(selected, roots);
  diagnostics.push(...depDiag);

  const entities = new Map<string, Entity>();
  const contentPacks = order.filter((p) => p.kind !== 'translation');
  for (const pack of contentPacks) {
    for (const e of pack.entities) {
      if (entities.has(e.id))
        diagnostics.push(
          error('index.duplicateId', `Entity "${e.id}" defined by more than one pack`, { entityId: e.id }),
        );
      else entities.set(e.id, e);
    }
  }
  for (const pack of contentPacks) {
    pack.overrides.forEach((o, i) => {
      const target = entities.get(o.target);
      const path = `overrides.${i}`;
      if (!target) {
        diagnostics.push(
          error('index.overrideTargetMissing', `${pack.id} overrides missing entity "${o.target}"`, {
            path,
            entityId: o.target,
          }),
        );
        return;
      }
      const patched = applyPatch(target, o.patch);
      if (!patched.ok) {
        diagnostics.push(
          error('index.overrideFailed', `${pack.id}: ${patched.error} (op ${patched.opIndex})`, {
            path,
            entityId: o.target,
          }),
        );
        return;
      }
      const revalidated = EntitySchema.safeParse(patched.result);
      if (!revalidated.success) {
        diagnostics.push(
          error('index.overrideInvalid', `${pack.id}: override produces an invalid entity`, {
            path,
            entityId: o.target,
          }),
        );
        return;
      }
      entities.set(o.target, revalidated.data);
    });
  }

  const classSlugToId = new Map<string, string>();
  for (const e of entities.values()) {
    if (e.type === 'class') {
      const slug = parseEntityId(e.id)?.slug;
      if (slug && !classSlugToId.has(slug)) classSlugToId.set(slug, e.id);
    }
  }
  const resolveClassRef = (ref: string): string | undefined => (entities.has(ref) ? ref : classSlugToId.get(ref));

  const all = [...entities.values()].sort(byIdAsc);
  const byType = new Map<EntityType, Entity[]>();
  for (const e of all) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);

  const index: ContentIndex = {
    get: (id) => entities.get(id),
    has: (id) => entities.has(id),
    byType: (type) => byType.get(type) ?? [],
    query(q) {
      const wantClasses = q.classes?.map((c) => resolveClassRef(c) ?? c);
      return (byType.get(q.type) ?? []).filter((e) => {
        if (q.tags && !q.tags.every((t) => e.tags.includes(t))) return false;
        if (q.level !== undefined && !(e.type === 'spell' && e.level === q.level)) return false;
        if (q.school !== undefined && !(e.type === 'spell' && e.school === q.school)) return false;
        if (wantClasses) {
          if (e.type === 'spell') {
            const have = e.classes.map((c) => resolveClassRef(c) ?? c);
            if (!wantClasses.some((c) => have.includes(c))) return false;
          } else if (e.type === 'subclass') {
            if (!wantClasses.includes(e.class)) return false;
          } else return false;
        }
        return true;
      });
    },
    system() {
      const s = (byType.get('system') ?? [])[0];
      if (s?.type !== 'system') throw new Error('No system entity in content index');
      return s;
    },
    packs: () => contentPacks,
    translationPacks: () => order.filter((p) => p.kind === 'translation'),
    resolveClassRef,
    diagnostics,
  };
  return index;
}
