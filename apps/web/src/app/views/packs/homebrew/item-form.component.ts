import { HkTooltipDirective } from '../../../ui/tooltip/tooltip.directive';
import { Component, computed, forwardRef, linkedSignal } from '@angular/core';
import { FormulaSchema, RegainDiceSchema, type ItemEntity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { HkFilterChipsComponent } from '../../../ui/filter-chips/filter-chips.component';
import type { FilterChipOption } from '../../../ui/filter-chips/filter-chip.component';
import { HkLeafComponent } from '../../../ui/leaf/leaf.component';
import { HkNumberFieldComponent } from '../../../ui/number-field/number-field.component';
import { HkSelectComponent } from '../../../ui/select/select.component';
import { HkTagChipComponent } from '../../../ui/tag-chip/tag-chip.component';
import { HkTextFieldComponent } from '../../../ui/text-field/text-field.component';
import { HkTextareaComponent } from '../../../ui/textarea/textarea.component';
import { HkToggleComponent } from '../../../ui/toggle/toggle.component';
import {
  ARMOR_CATEGORIES,
  CHARGE_RESETS,
  entityShell,
  firstOf,
  isDice,
  ITEM_CATEGORIES,
  RARITIES,
  REQUIRED_KEY,
  WEAPON_CATEGORIES,
  WEAPON_KINDS,
  wholeNumber,
  type FieldErrors,
} from './entity-form.helpers';
import { HOMEBREW_FORM, HomebrewFormBase, type PacksT } from './homebrew-form.base';
import { IconComponent } from '../../../shared/icons/icon.component';

type Category = ItemEntity['category'];
type Rarity = NonNullable<ItemEntity['rarity']>;
type Weapon = NonNullable<ItemEntity['weapon']>;
type Armor = NonNullable<ItemEntity['armor']>;
type Reset = NonNullable<ItemEntity['charges']>['reset'];

/**
 * Quick homebrew item (board PK05): name, description, category, rarity, weight, cost, attunement,
 * charges, plus the structural block its category needs — a weapon's damage dice/type/properties/
 * mastery/range, an armor's category/AC/Dex cap/Strength/Stealth, a shield's AC bonus. Everything
 * else about the item is description text. The icon field arrives with slice 2 and is not here.
 * Beside the form, a preview reads the item the way a sheet row would.
 */
@Component({
  selector: 'app-homebrew-item-form',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkTextFieldComponent,
    HkTextareaComponent,
    HkSelectComponent,
    HkNumberFieldComponent,
    HkToggleComponent,
    HkFilterChipsComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    IconComponent,
  ],
  providers: [
    provideTranslocoScope('packs'),
    { provide: HOMEBREW_FORM, useExisting: forwardRef(() => ItemFormComponent) },
  ],
  templateUrl: './item-form.component.html',
  styleUrl: './homebrew-form.scss',
})
export class ItemFormComponent extends HomebrewFormBase<ItemEntity> {
  protected readonly type = 'item' as const;
  protected readonly categories = ITEM_CATEGORIES;
  protected readonly rarities = RARITIES;
  protected readonly weaponKinds = WEAPON_KINDS;
  protected readonly weaponCategories = WEAPON_CATEGORIES;
  protected readonly armorCategories = ARMOR_CATEGORIES;
  protected readonly chargeResets = CHARGE_RESETS;

  protected readonly category = linkedSignal<Category>(() => this.entity()?.category ?? 'gear');
  protected readonly rarity = linkedSignal<Rarity | ''>(() => this.entity()?.rarity ?? '');
  protected readonly weight = linkedSignal<number | null>(() => this.entity()?.weight ?? null);
  protected readonly costAmount = linkedSignal<number | null>(
    () => this.entity()?.cost?.amount ?? null,
  );
  protected readonly costCurrency = linkedSignal(
    () => this.entity()?.cost?.currency ?? firstOf(this.vocabulary().currencies),
  );
  protected readonly attunement = linkedSignal(() => this.entity()?.attunement?.required ?? false);
  protected readonly chargesMax = linkedSignal(() => this.entity()?.charges?.max ?? '');
  protected readonly chargesReset = linkedSignal<Reset>(
    () => this.entity()?.charges?.reset ?? 'longRest',
  );
  protected readonly chargesRegain = linkedSignal(() => this.entity()?.charges?.regain ?? '');

  protected readonly weaponKind = linkedSignal<Weapon['kind']>(
    () => this.entity()?.weapon?.kind ?? 'melee',
  );
  protected readonly weaponCategory = linkedSignal<Weapon['category']>(
    () => this.entity()?.weapon?.category ?? 'simple',
  );
  protected readonly damage = linkedSignal(() => {
    const damage = this.entity()?.weapon?.damage;
    return typeof damage === 'string' ? damage : '';
  });
  protected readonly damageType = linkedSignal(
    () => this.entity()?.weapon?.damageType ?? firstOf(this.vocabulary().damageTypes),
  );
  protected readonly properties = linkedSignal<readonly string[]>(
    () => this.entity()?.weapon?.properties ?? [],
  );
  protected readonly mastery = linkedSignal(() => this.entity()?.weapon?.mastery ?? '');
  protected readonly rangeNormal = linkedSignal<number | null>(
    () => this.entity()?.weapon?.range?.normal ?? null,
  );
  protected readonly rangeLong = linkedSignal<number | null>(
    () => this.entity()?.weapon?.range?.long ?? null,
  );

  protected readonly armorCategory = linkedSignal<Armor['category']>(
    () => this.entity()?.armor?.category ?? 'light',
  );
  protected readonly ac = linkedSignal<number | null>(() => this.entity()?.armor?.ac ?? null);
  protected readonly dexCap = linkedSignal<number | null>(
    () => this.entity()?.armor?.dexCap ?? null,
  );
  protected readonly strength = linkedSignal<number | null>(
    () => this.entity()?.armor?.strength ?? null,
  );
  protected readonly stealthDisadvantage = linkedSignal(
    () => this.entity()?.armor?.stealthDisadvantage ?? false,
  );
  protected readonly shieldAc = linkedSignal<number | null>(
    () => this.entity()?.shield?.ac ?? null,
  );

  protected snapshot(): string {
    return JSON.stringify([
      this.category(),
      this.rarity(),
      this.weight(),
      this.costAmount(),
      this.costCurrency(),
      this.attunement(),
      this.chargesMax(),
      this.chargesReset(),
      this.chargesRegain(),
      this.weaponKind(),
      this.weaponCategory(),
      this.damage(),
      this.damageType(),
      this.properties(),
      this.mastery(),
      this.rangeNormal(),
      this.rangeLong(),
      this.armorCategory(),
      this.ac(),
      this.dexCap(),
      this.strength(),
      this.stealthDisadvantage(),
      this.shieldAc(),
    ]);
  }

  // Select options (memoised by content in the base).
  protected categoryOptions(t: PacksT) {
    return this.enumOptions(t, 'category', this.categories);
  }
  protected rarityOptions(t: PacksT) {
    return this.opts('rarity', [
      { value: '', label: t('homebrew.field.item.rarity-none') },
      ...this.rarities.map((value) => ({ value, label: t(`homebrew.enum.rarity.${value}`) })),
    ]);
  }
  protected kindOptions(t: PacksT) {
    return this.enumOptions(t, 'weapon-kind', this.weaponKinds);
  }
  protected weaponCategoryOptions(t: PacksT) {
    return this.enumOptions(t, 'weapon-category', this.weaponCategories);
  }
  protected armorCategoryOptions(t: PacksT) {
    return this.enumOptions(t, 'armor-category', this.armorCategories);
  }
  protected masteryOptions(t: PacksT) {
    return this.slugOptions(
      'mastery',
      this.vocabulary().masteries,
      t('homebrew.field.item.mastery-none'),
    );
  }
  protected damageTypeOptions() {
    return this.slugOptions('damage-type', this.vocabulary().damageTypes);
  }
  protected currencyOptions() {
    return this.slugOptions('currency', this.vocabulary().currencies);
  }
  protected resetOptions(t: PacksT) {
    return this.enumOptions(t, 'charge-reset', this.chargeResets);
  }
  private propertyOptionsMemo: readonly FilterChipOption[] = [];
  protected propertyOptions(): readonly FilterChipOption[] {
    const next = this.vocabulary().weaponProperties.map((value) => ({ id: value, label: value }));
    const same =
      next.length === this.propertyOptionsMemo.length &&
      next.every((o, i) => o.id === this.propertyOptionsMemo[i]?.id);
    return same ? this.propertyOptionsMemo : (this.propertyOptionsMemo = next);
  }

  protected setCategory(value: string | null): void {
    if (value) this.category.set(value as Category);
  }
  protected setRarity(value: string | null): void {
    this.rarity.set((value ?? '') as Rarity | '');
  }
  protected setWeaponKind(value: string | null): void {
    if (value) this.weaponKind.set(value as Weapon['kind']);
  }
  protected setWeaponCategory(value: string | null): void {
    if (value) this.weaponCategory.set(value as Weapon['category']);
  }
  protected setArmorCategory(value: string | null): void {
    if (value) this.armorCategory.set(value as Armor['category']);
  }
  protected setChargesReset(value: string | null): void {
    if (value) this.chargesReset.set(value as Reset);
  }

  /** The lines of the sheet-style preview: damage, range, weight, rarity, attunement, charges. */
  protected readonly preview = computed(() => {
    const category = this.category();
    const tags: { key: string; params: Record<string, unknown> }[] = [];
    if (category === 'weapon' && this.damage().trim()) {
      tags.push({
        key: 'homebrew.preview.damage',
        params: { dice: this.damage().trim(), type: this.damageType() },
      });
    }
    const range = this.rangeOrNull();
    if (category === 'weapon' && range) {
      tags.push({
        key: 'homebrew.preview.range',
        params: { normal: range.normal, long: range.long },
      });
    }
    if (category === 'armor' && this.ac() !== null) {
      tags.push({ key: 'homebrew.preview.ac', params: { ac: this.ac() } });
    }
    if (category === 'shield' && this.shieldAc() !== null) {
      tags.push({ key: 'homebrew.preview.shield', params: { ac: this.shieldAc() } });
    }
    const weight = this.weight();
    if (weight !== null && weight >= 0) {
      tags.push({ key: 'homebrew.sub.weight', params: { weight } });
    }
    return tags;
  });

  protected validate(): FieldErrors {
    const errors: Record<string, string> = {};
    const weight = this.weight();
    if (weight !== null && !(weight >= 0)) errors['weight'] = 'homebrew.field.item.weight-invalid';
    const cost = this.costAmount();
    if (cost !== null && (wholeNumber(cost) === null || cost < 0)) {
      errors['cost'] = 'homebrew.field.item.whole-number';
    }
    const max = this.chargesMax().trim();
    if (max && !FormulaSchema.safeParse(max).success) {
      errors['chargesMax'] = 'homebrew.field.item.charges-invalid';
    }
    if (
      this.chargesRegain() &&
      this.chargesReset() !== 'never' &&
      !RegainDiceSchema.safeParse(this.chargesRegain()).success
    ) {
      errors['chargesRegain'] = 'homebrew.field.item.charges-invalid';
    }
    switch (this.category()) {
      case 'weapon': {
        if (!this.damage().trim()) errors['damage'] = REQUIRED_KEY;
        else if (!isDice(this.damage())) errors['damage'] = 'homebrew.field.item.damage-invalid';
        if (!this.damageType()) errors['damageType'] = REQUIRED_KEY;
        const range = this.range();
        if (range === 'invalid') errors['range'] = 'homebrew.field.item.range-invalid';
        else if (range === undefined && this.weaponKind() === 'ranged')
          errors['range'] = REQUIRED_KEY;
        break;
      }
      case 'armor': {
        const ac = wholeNumber(this.ac());
        if (this.ac() === null) errors['ac'] = REQUIRED_KEY;
        else if (ac === null || ac < 10 || ac > 20) errors['ac'] = 'homebrew.field.item.ac-invalid';
        const dexCap = this.dexCap();
        if (dexCap !== null && (wholeNumber(dexCap) === null || dexCap < 0)) {
          errors['dexCap'] = 'homebrew.field.item.whole-number';
        }
        const strength = this.strength();
        if (strength !== null && (wholeNumber(strength) === null || strength < 1)) {
          errors['strength'] = 'homebrew.field.item.whole-number';
        }
        break;
      }
      case 'shield': {
        const bonus = wholeNumber(this.shieldAc());
        if (this.shieldAc() === null) errors['shieldAc'] = REQUIRED_KEY;
        else if (bonus === null || bonus < 1)
          errors['shieldAc'] = 'homebrew.field.item.whole-number';
        break;
      }
      default:
        break;
    }
    return errors;
  }

  protected build(id: string): ItemEntity {
    const category = this.category();
    const rarity = this.rarity();
    const weight = this.weight();
    const cost = this.costAmount();
    const max = this.chargesMax().trim();
    const reset = this.chargesReset();
    const regain = this.chargesRegain();
    const item: ItemEntity = {
      ...entityShell(id, this.name(), this.description()),
      type: 'item',
      category,
      ...(rarity ? { rarity } : {}),
      ...(weight !== null ? { weight } : {}),
      ...(cost !== null && this.costCurrency()
        ? { cost: { amount: cost, currency: this.costCurrency() } }
        : {}),
      ...(this.attunement() ? { attunement: { required: true } } : {}),
      ...(max
        ? {
            charges: {
              max,
              reset,
              ...(regain && reset !== 'never' ? { regain } : {}),
            },
          }
        : {}),
    };
    if (category === 'weapon') {
      const range = this.range();
      const mastery = this.mastery();
      item.weapon = {
        kind: this.weaponKind(),
        category: this.weaponCategory(),
        damage: this.damage().trim(),
        damageType: this.damageType(),
        properties: [...this.properties()].sort(),
        ...(mastery ? { mastery } : {}),
        ...(range && range !== 'invalid' ? { range } : {}),
      };
    } else if (category === 'armor') {
      const dexCap = this.dexCap();
      const strength = this.strength();
      item.armor = {
        category: this.armorCategory(),
        ac: this.ac() ?? 10,
        ...(dexCap !== null ? { dexCap } : {}),
        ...(strength !== null ? { strength } : {}),
        stealthDisadvantage: this.stealthDisadvantage(),
      };
    } else if (category === 'shield') {
      item.shield = { ac: this.shieldAc() ?? 1 };
    }
    return item;
  }

  private rangeOrNull(): { normal: number; long: number } | null {
    const range = this.range();
    return range && range !== 'invalid' ? range : null;
  }

  /** The weapon range: absent (both empty), `'invalid'`, or `{normal, long}`. */
  private range(): Weapon['range'] | 'invalid' {
    const normal = this.rangeNormal();
    const long = this.rangeLong();
    if (normal === null && long === null) return undefined;
    const n = wholeNumber(normal);
    const l = wholeNumber(long);
    if (n === null || l === null || n < 1 || l < n) return 'invalid';
    return { normal: n, long: l };
  }
}
