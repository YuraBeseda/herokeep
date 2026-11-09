import { LiveAnnouncer } from '@angular/cdk/a11y';
import { computed, effect, inject, Injectable, resource, signal } from '@angular/core';
import { parseRollSpec, roll } from '@hk/engine';
import type { CampaignSettings, CampaignVisibility, RollLogged } from '@hk/protocol';
import { bareCharacterId } from '@shared/services/campaigns/campaign-link-sequence';
import { projectCampaign } from '@shared/services/campaigns/campaign-projection';
import { campaignIdOfCharacter } from '@shared/services/campaigns/character-campaign-link';
import { cryptoRng } from '@shared/services/engine/rng';
import { RollLogService } from '@shared/services/roll-log/roll-log.service';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import { CharacterStore, type DraftEvent } from '@shared/stores/character.store';
import type { AdvantageMode } from './roll-log-panel.component';

// A dice-notation modifier TERM (`parseRollSpec`, `packages/engine/src/dice/parse.ts`): `0` omits
// the term entirely, a positive value needs an explicit `+`, a negative one already carries `-`.
const modifierTerm = (n: number): string => (n === 0 ? '' : n > 0 ? `+${n}` : `${n}`);

export type D20RollKind = 'check' | 'save' | 'skill' | 'attackToHit' | 'spellAttack';

// [plan-10 task-10-brief.md, ruling 5] Maps this sheet's roll vocabulary onto `RollLoggedV1.kind`
// for campaign publishing: a skill check IS an ability check, a spell attack IS a to-hit roll; the
// schema's `'spell'` and `'custom'` kinds stay unused by the sheet.
const ROLL_KIND_MAP: Record<D20RollKind, RollLogged['kind']> = {
  check: 'check',
  save: 'save',
  skill: 'check',
  attackToHit: 'attack',
  spellAttack: 'attack',
};

/** The scoped `t()` shape every roll accepts: `LiveAnnouncer` needs the resolved STRING right now. */
export type ScopedT = (key: string, params?: Record<string, unknown>) => string;

/**
 * Dice rolling for the character sheet, shared by every leaf that has a Roll button (abilities,
 * skills, attacks, spells, death saves) and by the roll-log dialog. It was `PlayTabComponent`'s
 * private roller; the logic is unchanged. Every tap-to-roll uses the row's ALREADY-DERIVED total as
 * the modifier — never recomputed here. It owns the advantage toggle (one-shot: consumed by the
 * next d20 roll) and, in campaign context, the sticky roll visibility and the best-effort
 * `roll.logged` publish. Provided in root: it holds no pack-dependent state, so it does not need
 * the sheet's scoped `EngineFacade`.
 */
@Injectable({ providedIn: 'root' })
export class PlayRollsService {
  private readonly characterStore = inject(CharacterStore);
  private readonly rollLogService = inject(RollLogService);
  private readonly liveAnnouncer = inject(LiveAnnouncer);
  private readonly campaignStore = inject(CampaignStore);
  private readonly eventsRepository = inject(EventsRepository);
  private readonly syncService = inject(SyncService);

  /** The roll-log panel's advantage toggle: consumed by the NEXT d20 roll, then back to normal. */
  readonly advantageMode = signal<AdvantageMode>('normal');

  /** `undefined` unless this character is campaign-linked AND the campaign has a live session open
   * (`SyncService.syncState`, the gate the party-overview publisher uses). */
  private readonly rollStreamId = computed<string | undefined>(() => {
    const campaignId = campaignIdOfCharacter(this.characterStore.events());
    if (!campaignId) return undefined;
    const streamId = `camp:${campaignId}`;
    return this.syncService.syncState(streamId)() === 'offline' ? undefined : streamId;
  });

  /** Fetches the linked campaign's OWN settings straight from storage (never `campaignStore.state()`,
   * which reflects whichever campaign this tab has open for viewing elsewhere). */
  private readonly campaignRollSettings = resource({
    params: () => this.rollStreamId(),
    loader: async ({ params }): Promise<CampaignSettings | null> => {
      if (!params) return null;
      const events = await this.eventsRepository.byStream(params);
      return projectCampaign(events).settings;
    },
  });

  /** Ruling 5: "'private' shown only if `allowPrivateRolls`" (default true while no settings
   * document exists). `undefined` hides the picker entirely (no live campaign context). */
  readonly rollVisibilityOptions = computed<readonly CampaignVisibility[] | undefined>(() => {
    if (!this.rollStreamId()) return undefined;
    const allowPrivate = this.campaignRollSettings.value()?.visibility.allowPrivateRolls ?? true;
    return allowPrivate ? (['everyone', 'dm', 'private'] as const) : (['everyone', 'dm'] as const);
  });

  /** Sticky (not one-shot): applies to every subsequent roll until the player changes it. */
  readonly rollVisibility = signal<CampaignVisibility>('everyone');

  // Resets the sticky pick to the campaign's own default whenever campaign context first resolves.
  private readonly resetRollVisibilityDefault = effect(() => {
    if (!this.rollStreamId()) return;
    this.rollVisibility.set(this.campaignRollSettings.value()?.visibility.rolls ?? 'everyone');
  });

  rollAbilityCheck(name: string, modifier: number, t: ScopedT): number {
    return this.performD20Roll('check', { name }, modifier, t);
  }

  rollAbilitySave(name: string, save: number, t: ScopedT): number {
    return this.performD20Roll('save', { name }, save, t);
  }

  rollSkill(name: string, total: number, t: ScopedT): number {
    return this.performD20Roll('skill', { name }, total, t);
  }

  /** The strap's Roll: a plain d20 (no modifier), logged as a check of the given name. */
  rollPlainCheck(name: string, t: ScopedT): number {
    return this.performD20Roll('check', { name }, 0, t);
  }

  /** A plain d20 with no modifier (death saves): logged as a save of the given name. */
  rollPlainSave(name: string, t: ScopedT): number {
    return this.performD20Roll('save', { name }, 0, t);
  }

  rollAttackToHit(name: string, toHit: number, t: ScopedT): number {
    return this.performD20Roll('attackToHit', { name }, toHit, t);
  }

  rollSpellAttack(name: string, attack: number, t: ScopedT): number {
    return this.performD20Roll('spellAttack', { name }, attack, t);
  }

  /** Damage never takes advantage (a d20-only mechanic); the row's own dice string is parsed and
   * the bonus added to the parsed roll's total, never string-concatenated into the spec. */
  rollAttackDamage(name: string, dice: string, bonus: number, t: ScopedT): void {
    const result = roll(parseRollSpec(dice), cryptoRng);
    const total = result.total + bonus;
    const formula = `${dice}${modifierTerm(bonus)}`;
    const streamId = this.characterStore.streamId();

    this.rollLogService.add({
      labelKey: 'sheet.roll.entries.attackDamage',
      params: { name },
      dice: result.dice,
      modifier: bonus,
      total,
      formula,
      kind: 'damage',
      ...(streamId ? { characterId: bareCharacterId(streamId) } : {}),
    });
    this.publishRoll(
      'damage',
      formula,
      result.dice,
      total,
      t('sheet.roll.entries.attackDamage', { name }),
    );
    void this.liveAnnouncer.announce(t('sheet.roll.announce.attackDamage', { name, total }));
  }

  // `1d20` (or, under advantage/disadvantage, `2d20kh1`/`2d20kl1` — the engine's own keep
  // semantics) plus the modifier is the ENTIRE spec; `roll()`/`cryptoRng` do the actual rolling.
  private performD20Roll(
    kind: D20RollKind,
    params: Record<string, unknown>,
    modifier: number,
    t: ScopedT,
  ): number {
    const mode = this.advantageMode();
    const diceTerm = mode === 'adv' ? '2d20kh1' : mode === 'dis' ? '2d20kl1' : '1d20';
    const formula = `${diceTerm}${modifierTerm(modifier)}`;
    const result = roll(parseRollSpec(formula), cryptoRng);
    const rollKind = ROLL_KIND_MAP[kind];
    const streamId = this.characterStore.streamId();

    this.rollLogService.add({
      labelKey: `sheet.roll.entries.${kind}`,
      params,
      dice: result.dice,
      modifier,
      total: result.total,
      formula,
      kind: rollKind,
      ...(streamId ? { characterId: bareCharacterId(streamId) } : {}),
      ...(mode !== 'normal' ? { advantage: mode } : {}),
    });
    // Published AFTER the local entry, from the SAME roll (never recomputed). `label` is a
    // pre-rendered plain string: the wire schema stores it verbatim for every member's locale.
    this.publishRoll(
      rollKind,
      formula,
      result.dice,
      result.total,
      t(`sheet.roll.entries.${kind}`, params),
    );
    // One-shot: advantage/disadvantage applies to exactly the roll that just consumed it.
    this.advantageMode.set('normal');
    void this.liveAnnouncer.announce(
      t(`sheet.roll.announce.${kind}`, { ...params, total: result.total }),
    );
    return result.total;
  }

  // The actual publish, once per roll (ruling 5: "the ROLLER publishes, one event per roll, no
  // debounce"). Best-effort: failures (leadership lost, logged out, a schema reject) are swallowed.
  private publishRoll(
    kind: RollLogged['kind'],
    formula: string,
    dice: readonly { sides: number; value: number }[],
    total: number,
    label: string,
  ): void {
    const streamId = this.rollStreamId();
    if (!streamId) return;
    const characterStreamId = this.characterStore.streamId();
    if (!characterStreamId) return;

    const draft: DraftEvent = {
      type: 'roll.logged',
      v: 1,
      payload: {
        characterId: bareCharacterId(characterStreamId),
        label,
        formula,
        // ALL rolled dice (kept AND dropped); the schema has no per-die `kept` flag.
        results: dice.map((d) => ({ die: `d${d.sides}`, value: d.value })),
        total,
        kind,
        visibility: this.rollVisibility(),
      } satisfies RollLogged,
    };
    void this.campaignStore.appendToStream(streamId, [draft]).catch(() => {
      // Best-effort background publish.
    });
  }
}
