import type { Choice, Entity, Predicate } from '@hk/protocol';

export interface EntityRef {
  path: string;
  id: string;
}

function predicateRefs(p: Predicate, path: string): EntityRef[] {
  if ('all' in p) return p.all.flatMap((q, i) => predicateRefs(q, `${path}.all.${i}`));
  if ('any' in p) return p.any.flatMap((q, i) => predicateRefs(q, `${path}.any.${i}`));
  if ('not' in p) return predicateRefs(p.not, `${path}.not`);
  for (const key of ['hasFeature', 'hasFeat', 'hasSpell', 'species', 'class', 'subclass', 'condition'] as const) {
    if (key in p) return [{ path: `${path}.${key}`, id: (p as Record<string, string>)[key]! }];
  }
  return [];
}

function choiceRefs(c: Choice, path: string): EntityRef[] {
  const refs: EntityRef[] = c.prerequisites.flatMap((p, i) => predicateRefs(p, `${path}.prerequisites.${i}`));
  if ('static' in c.pick) refs.push(...c.pick.static.map((id, i) => ({ path: `${path}.pick.static.${i}`, id })));
  if ('equipmentOption' in c.pick) {
    c.pick.equipmentOption.forEach((opt, i) =>
      opt.forEach((it, j) => refs.push({ path: `${path}.pick.equipmentOption.${i}.${j}.item`, id: it.item })),
    );
  }
  return refs;
}

export function collectEntityRefs(e: Entity): EntityRef[] {
  const refs: EntityRef[] = [];
  e.grants.forEach((g, i) => {
    refs.push({ path: `grants.${i}.feature`, id: g.feature });
    if (g.when) refs.push(...predicateRefs(g.when, `grants.${i}.when`));
  });
  e.prerequisites.forEach((p, i) => refs.push(...predicateRefs(p, `prerequisites.${i}`)));
  e.choices.forEach((c, i) => refs.push(...choiceRefs(c, `choices.${i}`)));
  e.effects.forEach((ef, i) => {
    const path = `effects.${i}`;
    if (ef.when) refs.push(...predicateRefs(ef.when, `${path}.when`));
    switch (ef.type) {
      case 'spell.grant':
        refs.push({ path: `${path}.spell`, id: ef.spell });
        break;
      case 'spell.listAdd':
        ef.spells.forEach((id, j) => refs.push({ path: `${path}.spells.${j}`, id }));
        break;
      case 'condition.immunity':
        ef.conditions.forEach((id, j) => refs.push({ path: `${path}.conditions.${j}`, id }));
        break;
      case 'spellcasting.define':
        if (Array.isArray(ef.list)) ef.list.forEach((id, j) => refs.push({ path: `${path}.list.${j}`, id }));
        break;
      case 'item.grant':
        refs.push({ path: `${path}.item`, id: ef.item });
        break;
      case 'language.grant':
        refs.push({ path: `${path}.language`, id: ef.language });
        break;
      default:
        break;
    }
  });
  if (e.deprecated?.replacedBy) refs.push({ path: 'deprecated.replacedBy', id: e.deprecated.replacedBy });
  switch (e.type) {
    case 'background':
      refs.push({ path: 'originFeat', id: e.originFeat });
      break;
    case 'subclass':
      refs.push({ path: 'class', id: e.class });
      e.levels.forEach((row, i) => {
        row.grants.forEach((g, j) => refs.push({ path: `levels.${i}.grants.${j}.feature`, id: g.feature }));
        row.choices.forEach((c, j) => refs.push(...choiceRefs(c, `levels.${i}.choices.${j}`)));
      });
      break;
    case 'class':
      if (e.multiclass) refs.push(...predicateRefs(e.multiclass.prerequisites, 'multiclass.prerequisites'));
      e.levels.forEach((row, i) => {
        row.grants.forEach((g, j) => refs.push({ path: `levels.${i}.grants.${j}.feature`, id: g.feature }));
        row.choices.forEach((c, j) => refs.push(...choiceRefs(c, `levels.${i}.choices.${j}`)));
      });
      break;
    case 'system':
      e.conditions.forEach((id, i) => refs.push({ path: `conditions.${i}`, id }));
      for (const [ref, p] of Object.entries(e.multiclass?.prerequisites ?? {})) {
        refs.push(...predicateRefs(p, `multiclass.prerequisites.${ref}`));
      }
      break;
    default:
      break;
  }
  return refs;
}
