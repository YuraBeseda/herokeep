import {
  type CharacterAppearanceSet,
  type CharacterCreated,
  type CharacterGenderSet,
  type CharacterOptionsSet,
  type CharacterRenamed,
  type DecisionCleared,
  type NoteAdded,
  type NoteRemoved,
  type NoteUpdated,
  type PackPinned,
  type PortraitSet,
} from '@hk/protocol';
import { type Facts, type NoteEntry, requireCreated } from '../facts.ts';
import type { Handler } from '../reducer.ts';

/** These events describe multiplayer/campaign concepts that don't apply to a solo character. */
const notApplicableSolo: Handler = () => 'not-applicable-solo';

export const HANDLERS: Record<string, Handler> = {
  'character.created@1': (f, e) => {
    if (f.created) return 'already-created';
    const p = e.payload as CharacterCreated;
    return {
      ...f,
      created: true,
      name: p.name,
      system: p.system,
      grammaticalGender: p.grammaticalGender,
      createdWith: { engineVersion: p.engineVersion },
      pins: { ...f.pins, [p.corePack.id]: p.corePack.version },
    };
  },

  'pack.pinned@1': (f, e) => {
    const p = e.payload as PackPinned;
    return { ...f, pins: { ...f.pins, [p.packId]: p.version } };
  },

  // `decision.made@1` lives in handlers/leveling.ts (next to level.gained); decision.cleared
  // stays here since it deletes from both `decisions` and `decisionContexts`.
  'decision.cleared@1': (f, e) => {
    const p = e.payload as DecisionCleared;
    const skip = requireCreated(f);
    if (skip) return skip;
    const decisions = { ...f.decisions };
    delete decisions[p.choiceId];
    const decisionContexts = { ...f.decisionContexts };
    delete decisionContexts[p.choiceId];
    return { ...f, decisions, decisionContexts };
  },

  'character.renamed@1': (f, e) => {
    const p = e.payload as CharacterRenamed;
    return requireCreated(f) ?? { ...f, name: p.name };
  },

  'character.appearance_set@1': (f, e) => {
    const p = e.payload as CharacterAppearanceSet;
    const skip = requireCreated(f);
    if (skip) return skip;
    const appearance = { ...f.appearance };
    const fields = ['age', 'height', 'weight', 'eyes', 'hair', 'skin', 'description'] as const;
    for (const key of fields) {
      const v = p[key];
      if (v !== undefined) appearance[key] = v;
    }
    return { ...f, appearance };
  },

  'character.gender_set@1': (f, e) => {
    const p = e.payload as CharacterGenderSet;
    return requireCreated(f) ?? { ...f, grammaticalGender: p.grammaticalGender };
  },

  // Plan 14 (phase 4 slice 4) Task 5, ruling 8: per-key merge, last write per key wins. An
  // explicit `'off'` is RECORDED (a choice, not a deletion). `f.options ?? {}` tolerates a facts
  // snapshot cached before this field existed (same ENGINE_VERSION, so `reduce` resumes it).
  'character.options.set@1': (f, e) => {
    const p = e.payload as CharacterOptionsSet;
    const skip = requireCreated(f);
    if (skip) return skip;
    const options = { ...(f.options as Facts['options'] | undefined) };
    if (p.encumbrance !== undefined) options.encumbrance = p.encumbrance;
    return { ...f, options };
  },

  'character.archived@1': (f) => requireCreated(f) ?? { ...f, archived: true },
  'character.restored@1': (f) => requireCreated(f) ?? { ...f, archived: false },

  // Multiplayer/campaign concepts: recorded as no-ops until the campaign stream exists.
  'character.owner_transferred@1': notApplicableSolo,
  'character.campaign_joined@1': notApplicableSolo,
  'character.campaign_left@1': notApplicableSolo,
  'level.granted@1': notApplicableSolo,
  'history.compacted@1': notApplicableSolo,

  'portrait.set@1': (f, e) => {
    const p = e.payload as PortraitSet;
    return requireCreated(f) ?? { ...f, portrait: { hash: p.hash, thumbHash: p.thumbHash } };
  },

  'portrait.cleared@1': (f) => {
    const skip = requireCreated(f);
    if (skip) return skip;
    const next = { ...f };
    delete next.portrait;
    return next;
  },

  'note.added@1': (f, e) => {
    const p = e.payload as NoteAdded;
    const skip = requireCreated(f);
    if (skip) return skip;
    const note: NoteEntry = { id: p.id, title: p.title ?? '', body: p.body ?? '' };
    return { ...f, notes: [...f.notes, note] };
  },

  'note.updated@1': (f, e) => {
    const p = e.payload as NoteUpdated;
    const skip = requireCreated(f);
    if (skip) return skip;
    const notes = f.notes.map((n): NoteEntry =>
      n.id === p.id
        ? {
            ...n,
            ...(p.title !== undefined ? { title: p.title } : {}),
            ...(p.body !== undefined ? { body: p.body } : {}),
          }
        : n,
    );
    return { ...f, notes };
  },

  'note.removed@1': (f, e) => {
    const p = e.payload as NoteRemoved;
    const skip = requireCreated(f);
    if (skip) return skip;
    return { ...f, notes: f.notes.filter((n) => n.id !== p.id) };
  },
};
