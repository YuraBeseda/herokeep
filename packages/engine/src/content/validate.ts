import { type Choice, type Entity, PACK_LIMITS, type Pack, parseChoiceId, parseEntityId } from '@hk/protocol';
import { type Diagnostic, error, warning } from '../diagnostics.ts';
import { validateEffects } from '../effects/validate.ts';
import { findChoice } from './choices.ts';
import { createContentIndex } from './index.ts';
import { collectEntityRefs } from './refs.ts';

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

function choiceDiagnostics(
  c: Choice,
  owner: Entity,
  path: string,
  rowLevel: number | undefined,
  resolveClass: (r: string) => string | undefined,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const parsed = parseChoiceId(c.id);
  if (parsed?.entityId !== owner.id)
    out.push(
      error('choice.idMismatch', `Choice id "${c.id}" must start with the owning entity id "${owner.id}"`, {
        path: `${path}.id`,
        entityId: owner.id,
      }),
    );
  if (c.at.kind === 'classLevel') {
    if (!resolveClass(c.at.class))
      out.push(
        warning('ref.classUnresolved', `Class "${c.at.class}" not found for choice "${c.id}"`, {
          path: `${path}.at.class`,
          entityId: owner.id,
        }),
      );
    if (rowLevel !== undefined && c.at.level !== rowLevel)
      out.push(
        error(
          'class.rowLevelMismatch',
          `Choice "${c.id}" is at level ${c.at.level} but sits in the level ${rowLevel} row`,
          { path: `${path}.at.level`, entityId: owner.id },
        ),
      );
  }
  return out;
}

export function validatePack(pack: Pack, available: Pack[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const bytes = utf8Bytes(JSON.stringify(pack));
  if (bytes > PACK_LIMITS.maxBytes)
    out.push(error('pack.tooLarge', `Pack is ${bytes} bytes; limit is ${PACK_LIMITS.maxBytes}`));

  const others = available.filter((p) => !(p.id === pack.id && p.version === pack.version));
  const index = createContentIndex([...others, pack], { roots: [pack.id] });
  const depsDiagnostics = index.diagnostics.filter((d) => d.code.startsWith('deps.'));
  if (depsDiagnostics.length > 0) {
    out.push(...depsDiagnostics);
    return out; // nothing below (including other index diagnostics) is meaningful without the closure
  }
  out.push(...index.diagnostics);

  const assetHashes = new Set(pack.assets.map((a) => a.hash));
  pack.entities.forEach((e, i) => {
    const base = `entities.${i}`;
    if (e.description && utf8Bytes(e.description) > PACK_LIMITS.maxDescriptionBytes) {
      out.push(
        error(
          'entity.descriptionTooLong',
          `Description of "${e.id}" exceeds ${PACK_LIMITS.maxDescriptionBytes} bytes`,
          { path: `${base}.description`, entityId: e.id },
        ),
      );
    }
    if (e.icon?.startsWith('sha256:') && !assetHashes.has(e.icon)) {
      out.push(
        error('asset.missing', `Icon ${e.icon} of "${e.id}" is not listed in pack.assets`, {
          path: `${base}.icon`,
          entityId: e.id,
        }),
      );
    }
    for (const ref of collectEntityRefs(e)) {
      if (!index.has(ref.id))
        out.push(
          error('ref.missing', `"${e.id}" references missing entity "${ref.id}"`, {
            path: `${base}.${ref.path}`,
            entityId: e.id,
          }),
        );
    }
    out.push(...validateEffects(e.effects, `${base}.effects`, e.id));
    const resolveClass = (r: string) => index.resolveClassRef(r);
    e.choices.forEach((c, j) => out.push(...choiceDiagnostics(c, e, `${base}.choices.${j}`, undefined, resolveClass)));
    if (e.type === 'class' || e.type === 'subclass') {
      e.levels.forEach((row, r) =>
        row.choices.forEach((c, j) =>
          out.push(...choiceDiagnostics(c, e, `${base}.levels.${r}.choices.${j}`, row.level, resolveClass)),
        ),
      );
    }
  });

  const checkStrings = (strings: Record<string, unknown>, targetPackId: string, path: string) => {
    for (const key of Object.keys(strings)) {
      const fullId = `${targetPackId}:${key}`;
      const choice = parseChoiceId(fullId);
      const unknown = choice ? !findChoice(index, fullId) : parseEntityId(fullId) === null || !index.has(fullId);
      if (unknown)
        out.push(
          warning('i18n.unknownKey', `Translation key "${key}" does not match an entity in ${targetPackId}`, {
            path: `${path}.${key}`,
          }),
        );
    }
  };
  if (pack.kind === 'translation' && pack.translates && pack.strings)
    checkStrings(pack.strings, pack.translates.id, 'strings');
  for (const [locale, strings] of Object.entries(pack.i18n)) checkStrings(strings, pack.id, `i18n.${locale}`);

  return out;
}
