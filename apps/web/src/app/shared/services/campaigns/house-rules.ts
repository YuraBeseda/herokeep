import type { CampaignSettingsV2 } from '@hk/protocol';

/** The campaign's house rules, including the four plan-18 allow/deny rules (absent = allowed). */
export type HouseRules = CampaignSettingsV2['houseRules'];

/** The four boolean house rules a hero-side gate can read. */
export type HouseRuleKey =
  'playersManageConditions' | 'startingGold' | 'multiclassing' | 'playersAddItems';

/** Whether `rule` allows the action. No campaign context (solo hero) or no settings document yet
 * → allowed; a rule key absent from the document (older @1 settings) → allowed. */
export function houseRuleAllows(
  rule: HouseRuleKey,
  campaign:
    | { settings: { houseRules: HouseRules } | null; members?: ReadonlyMap<string, { role: string }> }
    | null
    | undefined,
  userId?: string,
): boolean {
  // The campaign DM's own hero is never bound by the players' rules.
  if (userId !== undefined && campaign?.members?.get(userId)?.role === 'dm') return true;
  return campaign?.settings?.houseRules[rule] !== false;
}
