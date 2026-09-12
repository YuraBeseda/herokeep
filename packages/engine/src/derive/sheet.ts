import type { Diagnostic } from '../diagnostics.ts';
import type { Facts, InventoryEntry } from '../reduce/facts.ts';
import type { AbilitiesResult, AbilityBlock } from './abilities.ts';
import type { ActionView } from './actions.ts';
import type { AttackRow } from './attacks.ts';
import type { HpResult } from './hp.ts';
import type { Derived } from './modifiers.ts';
import type { ResourceView } from './resources.ts';
import type { SpellcastingBlock } from './spellcasting.ts';

export interface ChoiceRequest {
  choiceId: string;
  ownerId: string;
  count: number;
}

/**
 * The full character sheet — plan 5's UI contract (task-13-brief.md). Plain data, JSON-serializable
 * (every value is a plain object/array/primitive; `Derived<number>`'s `contributions` are themselves
 * plain objects — see modifiers.ts).
 */
export interface Sheet {
  name: string;
  system: string;
  level: number;
  classes: { classId: string; level: number; subclassId?: string }[];
  pins: Record<string, string>;
  abilities: Record<string, AbilityBlock>;
  prof: number;
  skills: AbilitiesResult['skills'];
  passivePerception: number;
  speed: Record<string, Derived<number>>;
  senses: AbilitiesResult['senses'];
  languages: AbilitiesResult['languages'];
  ac: Derived<number>;
  hp: HpResult;
  /** dex mod + `initiative.bonus` effects — assembled in derive/index.ts, no sibling module owns it. */
  initiative: Derived<number>;
  attacks: AttackRow[];
  attacksPerAction: number;
  spellcasting: SpellcastingBlock[];
  resources: ResourceView[];
  actions: ActionView[];
  /** Union (by kind+target) of armor/weapon/tool/language proficiency, assembled in derive/index.ts. */
  proficiencies: { kind: string; target: string; level: string; sources: string[] }[];
  /** `resolved: false` for an entry whose `itemId` no longer resolves in the content index — an unknown-id chip. */
  inventory: (InventoryEntry & { resolved: boolean })[];
  currency: Facts['currency'];
  inspiration: boolean;
  conditions: HpResult['conditions'];
  xp: number;
  grammaticalGender: Facts['grammaticalGender'];
  /** Creation-time outstanding choices PLUS every class/subclass level-row choice at or below the character's current level in that class (task-13-brief.md). */
  outstandingChoices: ChoiceRequest[];
  issues: Diagnostic[];
}
