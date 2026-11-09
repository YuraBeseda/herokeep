import type { ContentIndex, Facts } from '@hk/engine';

export type FeatureOriginKind = 'class' | 'subclass' | 'species' | 'background' | 'feat' | 'option';
export type FeatureGroupKind = FeatureOriginKind | 'other';

/** Where a feature comes from: the entity that hands it out and, for a class row, the level. */
export interface FeatureOrigin {
  readonly kind: FeatureOriginKind;
  readonly entityId: string;
  /** Level gained (class and subclass only). */
  readonly level?: number;
  /** Order among the character's classes (class order); 0 for the other kinds. */
  readonly rank: number;
}

export interface FeatureGroup<V extends { readonly origin: FeatureOrigin | null }> {
  readonly key: string;
  readonly kind: FeatureGroupKind;
  /** The source entity; absent for the pooled Feats / Chosen options / Other groups. */
  readonly entityId?: string;
  readonly features: V[];
}

const KIND_ORDER: readonly FeatureGroupKind[] = [
  'class',
  'subclass',
  'species',
  'background',
  'feat',
  'option',
  'other',
];
const POOLED: ReadonlySet<FeatureGroupKind> = new Set(['feat', 'option', 'other']);

/**
 * Groups feature views by their provenance, in the order Class (one group per class, in class
 * order), Subclass, Species, Background, Feats, Chosen options. A view without provenance goes to
 * a trailing group: no feature is ever dropped. Inside a group, features go by level gained
 * (stable; no level last).
 */
export function groupFeaturesBySource<V extends { readonly origin: FeatureOrigin | null }>(
  views: readonly V[],
): FeatureGroup<V>[] {
  const groups = new Map<string, FeatureGroup<V> & { rank: number }>();
  for (const view of views) {
    const kind: FeatureGroupKind = view.origin?.kind ?? 'other';
    const entityId = POOLED.has(kind) ? undefined : view.origin?.entityId;
    const key = entityId ? `${kind}:${entityId}` : kind;
    let group = groups.get(key);
    if (!group) {
      group = { key, kind, entityId, features: [], rank: view.origin?.rank ?? 0 };
      groups.set(key, group);
    }
    group.features.push(view);
  }
  const level = (v: V): number => v.origin?.level ?? Number.POSITIVE_INFINITY;
  return [...groups.values()]
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.rank - b.rank)
    .map(({ rank: _rank, ...group }) => ({
      ...group,
      features: group.features
        .map((feature, i) => ({ feature, i }))
        .sort((a, b) => level(a.feature) - level(b.feature) || a.i - b.i)
        .map(({ feature }) => feature),
    }));
}

/**
 * The origin of every feature the character holds, by feature id, read from the pack's own grant
 * structure: class and subclass level rows (up to the character's level in that class), the
 * species' and background's grants, the background's origin feat, then feats and features picked by
 * a decision. The first source to reach a feature wins, in that order. Only structure is read —
 * which entity lists which feature — so no rule lives here.
 */
export function featureOrigins(facts: Facts, index: ContentIndex): Map<string, FeatureOrigin> {
  const origins = new Map<string, FeatureOrigin>();

  const claim = (entityId: string, origin: FeatureOrigin): void => {
    const queue = [entityId];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (origins.has(id)) continue;
      origins.set(id, origin);
      for (const grant of index.get(id)?.grants ?? []) queue.push(grant.feature);
    }
  };

  facts.classes.forEach((entry, rank) => {
    const classId = index.resolveClassRef(entry.classId) ?? entry.classId;
    const cls = index.get(classId);
    if (cls?.type !== 'class') return;
    claim(classId, { kind: 'class', entityId: classId, rank });
    for (const row of cls.levels) {
      if (row.level > entry.level) continue;
      for (const grant of row.grants) {
        claim(grant.feature, { kind: 'class', entityId: classId, level: row.level, rank });
      }
    }
  });
  facts.classes.forEach((entry, rank) => {
    const sub = entry.subclassId ? index.get(entry.subclassId) : undefined;
    if (sub?.type !== 'subclass') return;
    claim(sub.id, { kind: 'subclass', entityId: sub.id, rank });
    for (const row of sub.levels) {
      if (row.level > entry.level) continue;
      for (const grant of row.grants) {
        claim(grant.feature, { kind: 'subclass', entityId: sub.id, level: row.level, rank });
      }
    }
  });

  const system = index.system();
  for (const entityType of ['species', 'background'] as const) {
    const slot = system.compositionSlots.find(
      (s) => s.at === 'creation' && s.entityType === entityType,
    );
    const picked = slot ? facts.decisions[`${system.id}@0/${slot.id}`]?.[0] : undefined;
    const entity = picked ? index.get(picked) : undefined;
    if (!picked || !entity) continue;
    claim(picked, { kind: entityType, entityId: picked, rank: 0 });
    if (entity.type === 'background') {
      claim(entity.originFeat, { kind: 'feat', entityId: entity.originFeat, rank: 0 });
    }
  }

  for (const selection of Object.values(facts.decisions)) {
    for (const id of selection) {
      const type = index.get(id)?.type;
      if (type === 'feat') claim(id, { kind: 'feat', entityId: id, rank: 0 });
      else if (type === 'feature') claim(id, { kind: 'option', entityId: id, rank: 0 });
    }
  }
  return origins;
}
