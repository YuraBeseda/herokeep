import { Component, linkedSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ItemEntity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';
import {
  ARMOR_CATEGORIES,
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
import { HomebrewFormBase } from './homebrew-form.base';

type Category = ItemEntity['category'];
type Rarity = NonNullable<ItemEntity['rarity']>;
type Weapon = NonNullable<ItemEntity['weapon']>;
type Armor = NonNullable<ItemEntity['armor']>;

/**
 * Quick homebrew item (ruling 10): name, description, category, rarity, weight, attunement, plus
 * the structural block its category needs — a weapon's damage dice/type/properties/mastery/range,
 * an armor's category/AC/Dex cap/Strength/Stealth, a shield's AC bonus. Everything else about the
 * item is description text.
 */
@Component({
  selector: 'app-homebrew-item-form',
  imports: [TranslocoDirective, FormsModule, ButtonComponent, NumberFieldComponent],
  providers: [provideTranslocoScope('packs')],
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

  protected readonly category = linkedSignal<Category>(() => this.entity()?.category ?? 'gear');
  protected readonly rarity = linkedSignal<Rarity | ''>(() => this.entity()?.rarity ?? '');
  protected readonly weight = linkedSignal<number | null>(() => this.entity()?.weight ?? null);
  protected readonly attunement = linkedSignal(() => this.entity()?.attunement?.required ?? false);

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

  protected setCategory(value: string): void {
    this.category.set(value as Category);
  }

  protected setRarity(value: string): void {
    this.rarity.set(value as Rarity | '');
  }

  protected setWeaponKind(value: string): void {
    this.weaponKind.set(value as Weapon['kind']);
  }

  protected setWeaponCategory(value: string): void {
    this.weaponCategory.set(value as Weapon['category']);
  }

  protected setArmorCategory(value: string): void {
    this.armorCategory.set(value as Armor['category']);
  }

  protected toggleProperty(property: string, checked: boolean): void {
    this.properties.update((list) =>
      checked
        ? [...list.filter((p) => p !== property), property]
        : list.filter((p) => p !== property),
    );
  }

  protected validate(): FieldErrors {
    const errors: Record<string, string> = {};
    const weight = this.weight();
    if (weight !== null && !(weight >= 0)) errors['weight'] = 'homebrew.field.item.weight-invalid';
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
    const item: ItemEntity = {
      ...entityShell(id, this.name(), this.description()),
      type: 'item',
      category,
      ...(rarity ? { rarity } : {}),
      ...(weight !== null ? { weight } : {}),
      ...(this.attunement() ? { attunement: { required: true } } : {}),
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
