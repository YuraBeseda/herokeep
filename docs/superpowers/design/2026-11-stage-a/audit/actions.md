# Action inventory (buttons, links, icon-only controls)

Source: every `<button>`/`<a>` in `apps/web/src/app/views/**`, `shared/components/**` and `app.html`, with the i18n key resolved to en and uk. "icon-only" = no text label in the template (relies on aria-label). Dynamic = label is an expression (entity name, count, etc.).

Second part: labels actually observed on each captured screen (desktop capture, en then uk), which includes labels contributed by shared components.

## Part 1: by template

### Login

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/auth/login/login | login__submit | button (primary) | auth.login.submitting | Logging in… | Виконується вхід… |
| views/auth/login/login | login__submit | button (primary) | auth.login.submit | Log in | Увійти |
| views/auth/login/login | a | link -> /register | auth.login.registerLink | Create an account | Створити акаунт |
| views/auth/login/login | a | link -> /recover | auth.login.recoverLink | Forgot your password? | Забули пароль? |

### Recover

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/auth/recover/recover | recover__submit | button (primary) | auth.recover.submitting | Resetting password… | Скидання пароля… |
| views/auth/recover/recover | recover__submit | button (primary) | auth.recover.submit | Reset password | Скинути пароль |
| views/auth/recover/recover | a | link -> /login | auth.recover.loginLink | Back to log in | Повернутися до входу |

### Register

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/auth/register/confirm-leave-recovery-codes | button | button (ghost) | auth.register.codesStep.confirmLeave.stay | Stay and save them | Залишитися і зберегти |
| views/auth/register/confirm-leave-recovery-codes | button | button (danger) | auth.register.codesStep.confirmLeave.leave | Leave anyway | Все одно піти |
| views/auth/register/register | register__submit | button (primary) | auth.register.submitting | Creating account… | Створення акаунта… |
| views/auth/register/register | register__submit | button (primary) | auth.register.submit | Create account | Створити акаунт |
| views/auth/register/register | a | link -> /login | auth.register.loginLink | Already have an account? Log in | Вже є акаунт? Увійти |
| views/auth/register/register | button | button (ghost) | auth.register.codesStep.copy | Copy codes | Скопіювати коди |
| views/auth/register/register | button | button (ghost) | auth.register.codesStep.download | Download as .txt | Завантажити як .txt |
| views/auth/register/register | register__continue | button (primary) | auth.register.codesStep.continue | Continue | Продовжити |

### Dialog: create campaign

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/campaigns/create/create-campaign-dialog | create-campaign-dialog__cancel | button (ghost) | campaigns.create.cancel | Cancel | Скасувати |
| views/campaigns/create/create-campaign-dialog | create-campaign-dialog__confirm | button | campaigns.create.creating | Creating… | Створення… |
| views/campaigns/create/create-campaign-dialog | create-campaign-dialog__confirm | button | campaigns.create.confirm | Create | Створити |

### Join campaign

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/campaigns/join/join | join__back | link -> /campaigns | campaigns.join.back | Back to campaigns | Назад до кампаній |
| views/campaigns/join/join | join__confirm | button (primary) | campaigns.join.joining | Joining… | Підключення… |
| views/campaigns/join/join | join__confirm | button (primary) | campaigns.join.confirm | Join | Приєднатися |

### Campaign link character

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/campaigns/link-character/link-character | link-character__retry | button (primary) | campaigns.link.progress.retry | Retry | Повторити |
| views/campaigns/link-character/link-character | link-character__claimed-action | button (primary) | campaigns.link.claimed.retry | Try again | Повторити |
| views/campaigns/link-character/link-character | link-character__claimed-action | button (primary) | campaigns.link.claimed.retry | Try again | Повторити |
| views/campaigns/link-character/link-character | link-character__claimed-action | button (primary) | campaigns.link.claimed.action | Claim it | Заявити права |
| views/campaigns/link-character/link-character | link-character__pick | button (primary) | campaigns.link.pick | Link this character | Прив'язати цього персонажа |
| views/campaigns/link-character/link-character | link-character__resume | button (primary) | campaigns.link.resume | Finish linking | Завершити прив'язку |
| views/campaigns/link-character/link-character | link-character__resume-leave | button (primary) | campaigns.link.resumeLeave | Finish leaving | Завершити вихід |
| views/campaigns/link-character/link-character | link-character__sync-cta | button (ghost) | campaigns.link.notSyncedCta | Manage sync status | Керування синхронізацією |
| views/campaigns/link-character/link-character | link-character__create-new | button (ghost) | campaigns.link.createNew | Create a new character | Створити нового персонажа |
| views/campaigns/link-character/link-character | link-character__skip | button (ghost) | campaigns.link.skip | Skip for now | Пропустити |

### Campaigns list

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/campaigns/list/campaigns-list | campaigns-list__join | button (ghost) | campaigns.list.join | Join campaign | Приєднатися до кампанії |
| views/campaigns/list/campaigns-list | campaigns-list__create | button (primary) | campaigns.list.create | New campaign | Нова кампанія |
| views/campaigns/list/campaigns-list | campaigns-list__open | button | campaigns.roles. | (missing) | (missing) |

### Campaign lobby

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/campaigns/lobby/lobby | lobby__copy-link | button (ghost) | campaigns.lobby.joinCode.copyLink | Copy invite link | Скопіювати посилання-запрошення |
| views/campaigns/lobby/lobby | lobby__rotate | button (ghost) | campaigns.lobby.joinCode.rotating | Generating… | Генерація… |
| views/campaigns/lobby/lobby | lobby__rotate | button (ghost) | campaigns.lobby.joinCode.rotate | Generate a new code | Згенерувати новий код |
| views/campaigns/lobby/lobby | lobby__member-remove | button (danger) | campaigns.lobby.members.remove | Remove | Видалити |

### Campaign log tab

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/campaigns/log/log-tab | log-tab__session-end | button (danger) | campaigns.log.session.ending | Ending… | Завершуємо… |
| views/campaigns/log/log-tab | log-tab__session-end | button (danger) | campaigns.log.session.end | End session | Завершити сесію |
| views/campaigns/log/log-tab | log-tab__session-start-submit | button | campaigns.log.session.starting | Starting… | Починаємо… |
| views/campaigns/log/log-tab | log-tab__session-start-submit | button | campaigns.log.session.start | Start session | Почати сесію |
| views/campaigns/log/log-tab | button | button | campaigns.log.composer.visibility. | (missing) | (missing) |
| views/campaigns/log/log-tab | log-tab__composer-send | button (primary) | campaigns.log.composer.send | Send | Надіслати |

### Campaign party tab (+ dialogs)

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/campaigns/party/dm-effects-panel | dm-effects-panel__toggle | button (ghost) | campaigns.dmEffects.toggle | DM tools | Інструменти майстра |
| views/campaigns/party/dm-effects-panel | button | button (danger) | campaigns.dmEffects.hp.damage | Damage | Шкода |
| views/campaigns/party/dm-effects-panel | button | button (primary) | campaigns.dmEffects.hp.heal | Heal | Лікування |
| views/campaigns/party/dm-effects-panel | button | button (ghost) | campaigns.dmEffects.hp.addTemp | Add temp HP | Додати тимчасові ХП |
| views/campaigns/party/dm-effects-panel | button | button (primary) | campaigns.dmEffects.inspiration.grant | Grant inspiration | Дати натхнення |
| views/campaigns/party/dm-effects-panel | button | button (ghost) | campaigns.dmEffects.inspiration.revoke | Revoke inspiration | Забрати натхнення |
| views/campaigns/party/dm-effects-panel | button | button (ghost) | campaigns.dmEffects.conditions.add | Add condition | Додати стан |
| views/campaigns/party/dm-effects-panel | button | button (primary) | campaigns.dmEffects.xp.grant | Award XP | Нарахувати досвід |
| views/campaigns/party/dm-effects-panel | button | button (primary) | campaigns.dmEffects.level.grant | Grant a level | Видати рівень |
| views/campaigns/party/dm-effects-panel | button | button (ghost) | campaigns.dmEffects.item.grant | Grant item | Видати предмет |
| views/campaigns/party/dm-effects-panel | button | button (primary) | campaigns.dmEffects.override.apply | Apply override | Застосувати перевизначення |
| views/campaigns/party/dm-effects-panel | hk-number-field | control label [labelKey] | campaigns.dmEffects.hp.damageLabel | Damage amount | Кількість шкоди |
| views/campaigns/party/dm-effects-panel | hk-number-field | control label [labelKey] | campaigns.dmEffects.hp.healLabel | Heal amount | Кількість лікування |
| views/campaigns/party/dm-effects-panel | hk-number-field | control label [labelKey] | campaigns.dmEffects.hp.tempLabel | Temp HP amount | Тимчасові ХП |
| views/campaigns/party/dm-effects-panel | hk-number-field | control label [labelKey] | campaigns.dmEffects.xp.amountLabel | XP amount | Кількість досвіду |
| views/campaigns/party/dm-effects-panel | hk-number-field | control label [labelKey] | campaigns.dmEffects.level.countLabel | Levels to grant | Кількість рівнів |
| views/campaigns/party/dm-effects-panel | hk-number-field | control label [labelKey] | campaigns.dmEffects.item.qtyLabel | Quantity | Кількість |
| views/campaigns/party/handover-character-dialog | handover-character-dialog__member | button | (dynamic text) | | |
| views/campaigns/party/handover-character-dialog | handover-character-dialog__cancel | button (ghost) | campaigns.handover.cancel | Cancel | Скасувати |
| views/campaigns/party/handover-character-dialog | handover-character-dialog__confirm | button (primary) | campaigns.handover.confirm | Hand over | Передати |
| views/campaigns/party/handover-character-dialog | handover-character-dialog__retry | button (primary) | campaigns.handover.retry | Retry | Повторити |
| views/campaigns/party/member-sheet-dialog | member-sheet-dialog__close | button (ghost) | campaigns.memberSheet.close | Close | Закрити |
| views/campaigns/party/member-sheet-dialog | hk-stat-tile | control label [labelKey] | campaigns.memberSheet.ac | AC | КЗ |
| views/campaigns/party/member-sheet-dialog | hk-stat-tile | control label [labelKey] | campaigns.memberSheet.initiative | Initiative | Ініціатива |
| views/campaigns/party/member-sheet-dialog | hk-stat-tile | control label [labelKey] | campaigns.memberSheet.passivePerception | Passive Perception | Пасивна Увага |
| views/campaigns/party/member-sheet-dialog | hk-stat-tile | control label [labelKey] | campaigns.memberSheet.speed | Speed | Швидкість |
| views/campaigns/party/member-sheet-dialog | hk-pips | control label [labelKey] | campaigns.memberSheet.spellcasting.slotPipLabel | Level {level} spell slot {index} of {max} | Комірка заклинання {level} рівня, {index} з {max} |
| views/campaigns/party/member-sheet-dialog | hk-pips | control label [labelKey] | campaigns.memberSheet.resources.pipLabel | {name} use {index} of {max} | {name}, використання {index} з {max} |
| views/campaigns/party/party-tab | party-tab__add-pregen | button (ghost) | campaigns.party.addPregen | Add pregen | Додати заготовку персонажа |
| views/campaigns/party/party-tab | party-tab__link-cta-action | button (primary) | campaigns.party.linkCta.action | Link a character | Прив'язати персонажа |
| views/campaigns/party/party-tab | party-tab__view-sheet | button (ghost) | campaigns.party.card.viewSheet | View sheet | Переглянути лист |
| views/campaigns/party/party-tab | party-tab__unlink | button (danger) | campaigns.unlink.action | Unlink character | Відв'язати персонажа |
| views/campaigns/party/party-tab | party-tab__handover | button (primary) | campaigns.handover.action | Hand over to… | Передати… |
| views/campaigns/party/unlink-character-dialog | unlink-character-dialog__cancel | button (ghost) | campaigns.unlink.cancel | Cancel | Скасувати |
| views/campaigns/party/unlink-character-dialog | unlink-character-dialog__confirm | button (danger) | campaigns.unlink.confirm | Unlink | Відв'язати |
| views/campaigns/party/unlink-character-dialog | unlink-character-dialog__retry | button (primary) | campaigns.unlink.retry | Retry | Повторити |

### Campaign settings (+ export dialog)

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/campaigns/settings/campaign-export-dialog | campaign-export-dialog__cancel | button (ghost) | campaigns.export.cancel | Close | Закрити |
| views/campaigns/settings/campaign-export-dialog | campaign-export-dialog__confirm | button (primary) | campaigns.export.exporting | Exporting… | Експорт… |
| views/campaigns/settings/campaign-export-dialog | campaign-export-dialog__confirm | button (primary) | campaigns.export.confirm | Export | Експортувати |
| views/campaigns/settings/campaign-packs-section | campaign-packs__update | button (primary) | campaigns.settings.packs.update | Update campaign version to {version} | Оновити версію в кампанії до {version} |
| views/campaigns/settings/campaign-packs-section | button | button (ghost) | campaigns.settings.packs.disable | Disable | Вимкнути |
| views/campaigns/settings/campaign-packs-section | button | button (primary) | campaigns.settings.packs.enable | Enable | Увімкнути |
| views/campaigns/settings/campaign-packs-section | button | button (ghost) | campaigns.settings.packs.retry | Retry | Повторити |
| views/campaigns/settings/campaign-settings | campaign-settings__save | button (primary) | campaigns.settings.saving | Saving… | Збереження… |
| views/campaigns/settings/campaign-settings | campaign-settings__save | button (primary) | campaigns.settings.save | Save | Зберегти |
| views/campaigns/settings/campaign-settings | campaign-settings__export | button (ghost) | campaigns.settings.exportAction | Export campaign | Експортувати кампанію |
| views/campaigns/settings/campaign-settings | hk-number-field | control label [labelKey] | campaigns.settings.houseRules.attunementMax | Attunement limit | Ліміт налаштування на предмети |
| views/campaigns/settings/campaign-settings | hk-number-field | control label [labelKey] | campaigns.settings.houseRules.startingLevel | Starting level | Початковий рівень |

### Creation wizard shell

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/create-wizard/create-wizard | create-wizard__create | button (primary) | characters.wizard.review.create | Create character | Створити персонажа |
| views/characters/create-wizard/create-wizard | create-wizard__back | button (ghost) | characters.wizard.actions.back | Back | Назад |
| views/characters/create-wizard/create-wizard | create-wizard__next | button | characters.wizard.actions.next | Next | Далі |

### Creation wizard steps

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/create-wizard/steps/ability-scores-step | ability-scores-step__roll-all | button (ghost) | characters.wizard.abilityScores.rollAll | Roll all six | Кинути всі шість |
| views/characters/create-wizard/steps/ability-scores-step | hk-number-field | control label [labelKey] | characters.wizard.picker.valueLabel | Value | Значення |
| views/characters/create-wizard/steps/ability-scores-step | hk-number-field | control label [labelKey] | characters.wizard.picker.valueLabel | Value | Значення |
| views/characters/create-wizard/steps/choice-step | button | button (ghost) | characters.wizard.picker.addValue | Add | Додати |
| views/characters/create-wizard/steps/entity-picker | entity-picker__select | button +icon | (dynamic text) | | |
| views/characters/create-wizard/steps/entity-picker | entity-picker__expand | button | characters.wizard.picker.collapse | Hide description | Сховати опис |
| views/characters/create-wizard/steps/entity-picker | entity-picker__expand | button | characters.wizard.picker.expand | Show description | Показати опис |
| views/characters/create-wizard/steps/entity-picker | hk-search-field | control label [placeholderKey] | characters.wizard.picker.searchPlaceholder | Search… | Пошук… |
| views/characters/create-wizard/steps/entity-picker | hk-search-field | control label [clearLabelKey] | characters.wizard.picker.searchClear | Clear search | Очистити пошук |
| views/characters/create-wizard/steps/equipment-step | equipment-step__equip-toggle | button | characters.wizard.equipment.equipped | Equipped | Споряджено |
| views/characters/create-wizard/steps/equipment-step | equipment-step__equip-toggle | button | characters.wizard.equipment.equip | Equip | Спорядити |
| views/characters/create-wizard/steps/equipment-step | equipment-step__continue | button (ghost) | characters.wizard.equipment.continue | Continue | Далі |
| views/characters/create-wizard/steps/equipment-step | equipment-step__qty | control label [labelKey] | characters.wizard.equipment.qtyLabel | Quantity | Кількість |
| views/characters/create-wizard/steps/spells-step | spells-step__prepared-toggle | button | (dynamic text) | | |
| views/characters/create-wizard/steps/spells-step | spells-step__continue | button (ghost) | characters.wizard.spells.continue | Continue | Далі |

### Level-up

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/level-up/level-up | level-up__class-picker-option | button | characters.levelUp.classPicker.multiclass | Multiclass into {class} | Мультиклас: {class} |
| views/characters/level-up/level-up | level-up__class-picker-option | button | characters.levelUp.classPicker.levelUp | Level up {class} to {level} | Підвищити {class} до {level} рівня |
| views/characters/level-up/level-up | level-up__hp-roll | button | characters.levelUp.hp.roll | Roll | Кинути |
| views/characters/level-up/level-up | level-up__hp-average | button (ghost) | characters.levelUp.hp.average | Take average | Взяти середнє |
| views/characters/level-up/level-up | level-up__finish | button (primary) | characters.levelUp.review.finish | Finish level up | Завершити підвищення |
| views/characters/level-up/level-up | level-up__back | button (ghost) | characters.levelUp.actions.back | Back | Назад |
| views/characters/level-up/level-up | level-up__next | button | characters.levelUp.actions.next | Next | Далі |

### Characters list

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/list/characters-list | characters-list__import | button (ghost) | characters.list.import | Import | Імпорт |
| views/characters/list/characters-list | characters-list__create | button (primary) | characters.list.create | New character | Новий персонаж |
| views/characters/list/characters-list | characters-list__open | button | characters.sheet.portrait.alt | {name}'s portrait | Портрет {name} |
| views/characters/list/characters-list | characters-list__delete | button (danger) | characters.list.delete | Delete | Видалити |
| views/characters/list/install-banner | install-banner__install | button | characters.list.installBanner.install | Install | Встановити |
| views/characters/list/install-banner | install-banner__ios | button (ghost) | characters.list.installBanner.howToInstall | How to install | Як встановити |
| views/characters/list/install-banner | install-banner__dismiss | button (ghost) (aria-label) | characters.list.installBanner.dismiss | Dismiss | Приховати |

### Sheet: Build tab

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/sheet/build/build-packs-section | build-packs__update | button (ghost) | characters.sheet.build.packs.update | Update | Оновити |
| views/characters/sheet/build/build-packs-section | build-packs__update | button (ghost) (aria-label) | characters.sheet.build.packs.update-label | Update {name} to v{to} | Оновити {name} до v{to} |
| views/characters/sheet/build/build-tab | button | button | characters.sheet.build.outstanding.empty | All caught up — nothing left to decide. | Усе готово — вирішувати більше нічого. |
| views/characters/sheet/build/build-tab | button | button | characters.sheet.build.rename.label | Name | Ім'я |
| views/characters/sheet/build/build-tab | button | button | characters.sheet.build.rename.error | Enter a name, up to 200 characters. | Введіть ім'я довжиною до 200 символів. |
| views/characters/sheet/build/build-tab | button | button | characters.sheet.build.rename.save | Save | Зберегти |
| views/characters/sheet/build/build-tab | build-tab__portrait-upload | button (ghost) | characters.sheet.portrait.change | Change portrait | Змінити портрет |
| views/characters/sheet/build/build-tab | build-tab__portrait-upload | button (ghost) | characters.sheet.portrait.upload | Upload portrait | Завантажити портрет |
| views/characters/sheet/build/build-tab | build-tab__portrait-remove | button (ghost) | characters.sheet.portrait.remove | Remove portrait | Видалити портрет |
| views/characters/sheet/build/build-tab | button | button | characters.sheet.build.appearance.save | Save | Зберегти |

### Sheet shell (header, XP, tabs)

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/sheet/campaign-packs-banner | campaign-packs-banner__pin | button | characters.sheet.banner.campaign-packs.pin | Pin campaign packs | Підключити пакети кампанії |
| views/characters/sheet/sheet-shell | sheet-shell__export | button (ghost) | characters.sheet.header.export | Export | Експорт |
| views/characters/sheet/sheet-shell | sheet-shell__missing-packs-link | link -> /packs | characters.sheet.banner.missing-packs.link | Manage packs | Керувати пакетами |
| views/characters/sheet/sheet-shell | sheet-shell__xp-submit | button (ghost) | characters.sheet.header.xpAward | Award | Нарахувати |
| views/characters/sheet/sheet-shell | sheet-shell__level-up-badge | link -> ['level-up'] | characters.sheet.header.levelUpAvailable | Level up available | Доступне підвищення рівня |
| views/characters/sheet/sheet-shell | sheet-shell__undo-level-up | button (ghost) | characters.sheet.header.undoLevelUp | Undo level up | Скасувати підвищення рівня |
| views/characters/sheet/sheet-shell | sheet-shell__xp-field | control label [labelKey] | characters.sheet.header.xpAwardLabel | Award XP | Нарахувати досвід |

### Dialog: add from library

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/sheet/play/add-item-dialog | button | button (ghost) | characters.sheet.inventory.addDialog.cancel | Cancel | Скасувати |
| views/characters/sheet/play/add-item-dialog | hk-number-field | control label [labelKey] | characters.sheet.inventory.addDialog.qtyLabel | Quantity | Кількість |

### Dialog: cast

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/sheet/play/cast-dialog | button | button (ghost) | characters.sheet.spellcasting.castDialog.cancel | Cancel | Скасувати |
| views/characters/sheet/play/cast-dialog | button | button | characters.sheet.spellcasting.castDialog.confirm | Cast | Накласти |

### Dialog: add condition

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/sheet/play/condition-dialog | button | button (ghost) | characters.sheet.conditions.addDialog.cancel | Cancel | Скасувати |
| views/characters/sheet/play/condition-dialog | button | button | characters.sheet.conditions.addDialog.confirm | Add | Додати |
| views/characters/sheet/play/condition-dialog | hk-number-field | control label [labelKey] | characters.sheet.conditions.addDialog.levelLabel | Level | Рівень |

### Dialog: custom item

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/sheet/play/custom-item-dialog | button | button (ghost) | characters.sheet.inventory.customDialog.cancel | Cancel | Скасувати |
| views/characters/sheet/play/custom-item-dialog | button | button | characters.sheet.inventory.customDialog.confirm | Add | Додати |
| views/characters/sheet/play/custom-item-dialog | hk-number-field | control label [labelKey] | characters.sheet.inventory.customDialog.qtyLabel | Quantity | Кількість |

### Dialog: note

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/sheet/play/note-dialog | button | button (ghost) | characters.sheet.notes.dialog.cancel | Cancel | Скасувати |
| views/characters/sheet/play/note-dialog | button | button | characters.sheet.notes.dialog.save | Save | Зберегти |

### Sheet: Play tab

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/sheet/play/play-tab | play-tab__wake-lock-toggle | button | characters.sheet.wakeLock.on | Screen staying awake | Екран не вимикається |
| views/characters/sheet/play/play-tab | play-tab__wake-lock-toggle | button | characters.sheet.wakeLock.off | Keep screen awake | Не вимикати екран |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.roll.check | Roll check | Кинути перевірку |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.roll.save | Roll save | Кинути рятівний кидок |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.roll.skill | Roll | Кинути |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.hp.endConcentration | End concentration | Припинити концентрацію |
| views/characters/sheet/play/play-tab | button | button (danger) | characters.sheet.hp.damage | Damage | Шкода |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.hp.heal | Heal | Лікування |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.hp.addTemp | Add temp HP | Додати тимчасові ОЗ |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.hp.deathSaveSuccess | Success | Успіх |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.hp.deathSaveFailure | Failure | Провал |
| views/characters/sheet/play/play-tab | button | button | characters.sheet.hp.deathSaveCritSuccess | Critical success | Критичний успіх |
| views/characters/sheet/play/play-tab | button | button (danger) | characters.sheet.hp.deathSaveCritFailure | Critical failure | Критичний провал |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.rest.short | Short rest | Короткий відпочинок |
| views/characters/sheet/play/play-tab | button | button | characters.sheet.rest.long | Long rest | Тривалий відпочинок |
| views/characters/sheet/play/play-tab | play-tab__inspiration-toggle | button | characters.sheet.inspiration.on | Inspired | Є натхнення |
| views/characters/sheet/play/play-tab | play-tab__inspiration-toggle | button | characters.sheet.inspiration.off | Not inspired | Немає натхнення |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.roll.attackToHit | Roll to hit | Кинути атаку |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.roll.attackDamage | Roll damage | Кинути шкоду |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.roll.spellAttack | Roll spell attack | Кинути атаку заклинанням |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.spellcasting.cast | Cast | Накласти |
| views/characters/sheet/play/play-tab | button | button | characters.sheet.spellcasting.unprepare | Unprepare | Скасувати підготовку |
| views/characters/sheet/play/play-tab | button | button | characters.sheet.spellcasting.prepare | Prepare | Підготувати |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.spellcasting.cast | Cast | Накласти |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.spellcasting.unprepare | Unprepare | Скасувати підготовку |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.spellcasting.cast | Cast | Накласти |
| views/characters/sheet/play/play-tab | play-tab__action-toggle | button | characters.sheet.actions.resourceHint | ({resource}) | ({resource}) |
| views/characters/sheet/play/play-tab | play-tab__conditions-add | button (ghost) | characters.sheet.conditions.add | Add condition | Додати стан |
| views/characters/sheet/play/play-tab | button | button | characters.sheet.inventory.addFromLibrary | Add from library | Додати з бібліотеки |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.inventory.addCustom | Add custom item | Додати свій предмет |
| views/characters/sheet/play/play-tab | button | button (ghost) (aria-label) | characters.sheet.inventory.qtyDecrease | Decrease quantity | Зменшити кількість |
| views/characters/sheet/play/play-tab | button | button (ghost) (aria-label) | characters.sheet.inventory.qtyIncrease | Increase quantity | Збільшити кількість |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.inventory.unequip | Unequip | Зняти |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.inventory.equip | Equip | Спорядити |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.inventory.unattune | End attunement | Скасувати налаштування |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.inventory.attune | Attune | Налаштуватися |
| views/characters/sheet/play/play-tab | button | button (danger) | characters.sheet.inventory.remove | Remove item | Видалити предмет |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.inventory.currencyApply | Apply | Застосувати |
| views/characters/sheet/play/play-tab | play-tab__notes-add | button | characters.sheet.notes.add | Add note | Додати нотатку |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.notes.edit | Edit | Редагувати |
| views/characters/sheet/play/play-tab | button | button (ghost) | characters.sheet.notes.remove | Remove | Видалити |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.stats.ac | Armor Class | Клас броні |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.stats.initiative | Initiative | Ініціатива |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.stats.prof | Proficiency bonus | Бонус майстерності |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.stats.passivePerception | Passive Perception | Пасивна уважність |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.stats.speed | Speed | Швидкість |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.hp.current | Current | Поточні |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.hp.max | Max | Максимум |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.hp.temp | Temporary | Тимчасові |
| views/characters/sheet/play/play-tab | hk-number-field | control label [labelKey] | characters.sheet.hp.amountLabel | Amount | Кількість |
| views/characters/sheet/play/play-tab | hk-pips | control label [labelKey] | characters.sheet.spellcasting.slotPipLabel | Level {level} slot {index} of {max} | Комірка {level} рівня {index} з {max} |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.spellcasting.dc | Save DC | Складність рятівного кидка |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.spellcasting.attack | Attack bonus | Бонус атаки заклинанням |
| views/characters/sheet/play/play-tab | hk-stat-tile | control label [labelKey] | characters.sheet.spellcasting.cantripsKnown | Cantrips known | Відомо заговорів |
| views/characters/sheet/play/play-tab | hk-pips | control label [labelKey] | characters.sheet.spellcasting.pactPipLabel | Pact slot {index} of {max}, level {level} | Комірка Угоди {index} з {max}, {level} рівня |
| views/characters/sheet/play/play-tab | hk-pips | control label [labelKey] | characters.sheet.resources.pipLabel | {name} use {index} of {max} | {name}, використання {index} з {max} |
| views/characters/sheet/play/roll-log-panel | button | button | characters.sheet.roll.advantage.normal | Normal | Звичайно |
| views/characters/sheet/play/roll-log-panel | button | button | characters.sheet.roll.advantage.advantage | Advantage | Перевага |
| views/characters/sheet/play/roll-log-panel | button | button | characters.sheet.roll.advantage.disadvantage | Disadvantage | Завада |
| views/characters/sheet/play/roll-log-panel | button | button | characters.sheet.roll.visibility. | (missing) | (missing) |
| views/characters/sheet/play/roll-log-panel | button | button (ghost) | characters.sheet.roll.manual.add | Log roll | Записати кидок |
| views/characters/sheet/play/roll-log-panel | roll-log-panel__clear | button (ghost) | characters.sheet.roll.clear | Clear log | Очистити журнал |
| views/characters/sheet/play/roll-log-panel | hk-number-field | control label [labelKey] | characters.sheet.roll.manual.amountLabel | Total | Підсумок |

### Dialog: rest

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/sheet/play/rest-dialog | rest-dialog__roll | button (ghost) | characters.sheet.rest.dialog.roll | Roll d{die} | Кинути к{die} |
| views/characters/sheet/play/rest-dialog | button | button (ghost) | characters.sheet.rest.dialog.cancel | Cancel | Скасувати |
| views/characters/sheet/play/rest-dialog | button | button | characters.sheet.rest.dialog.confirmShort | Take short rest | Взяти короткий відпочинок |
| views/characters/sheet/play/rest-dialog | button | button | characters.sheet.rest.dialog.confirmLong | Take long rest | Взяти тривалий відпочинок |

### Sheet: Timeline tab

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/characters/sheet/timeline/timeline-tab | timeline-tab__expand | button | (dynamic text) | | |
| views/characters/sheet/timeline/timeline-tab | timeline-tab__revert | button (ghost) | characters.timeline.revert | Revert | Скасувати |

### Library browse

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/library/browse/browse | library-browse__row | button +icon | library.type. | (missing) | (missing) |
| views/library/browse/browse | library-browse__row | button +icon | library.en-tag | EN | EN |
| views/library/browse/browse | hk-search-field | control label [placeholderKey] | library.search.placeholder | Search the library | Пошук у бібліотеці |
| views/library/browse/browse | hk-search-field | control label [clearLabelKey] | library.search.clear | Clear search | Очистити пошук |

### Library detail

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/library/detail/detail | button | button (ghost) | library.detail.back | Back to library | Назад до бібліотеки |

### Homebrew list + editor

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/packs/homebrew/feat-form | hb-form__cancel | button (ghost) | packs.homebrew.field.cancel | Cancel | Скасувати |
| views/packs/homebrew/feat-form | hb-form__save | button | packs.homebrew.field.save | Save | Зберегти |
| views/packs/homebrew/homebrew-editor | hb-editor__back | link -> /packs/homebrew | packs.homebrew.back-to-list | Back to homebrew | До хоумбрю |
| views/packs/homebrew/homebrew-list | hb-list__back | link -> /packs | packs.homebrew.back | Back to packs | До пакетів |
| views/packs/homebrew/homebrew-list | hb-list__new-link | link -> ['/packs/homebrew/new', type] | packs.homebrew.new. | (missing) | (missing) |
| views/packs/homebrew/homebrew-list | hb-list__edit | link -> ['/packs/homebrew/edit', group.type, slugOf(entity)] | packs.homebrew.edit | Edit | Змінити |
| views/packs/homebrew/homebrew-list | hb-list__edit | link -> ['/packs/homebrew/edit', group.type, slugOf(entity)] (aria-label) | packs.homebrew.edit-label | Edit {name} | Змінити {name} |
| views/packs/homebrew/homebrew-list | hb-list__delete | button (ghost) | packs.homebrew.delete | Delete | Видалити |
| views/packs/homebrew/homebrew-list | hb-list__delete | button (ghost) (aria-label) | packs.homebrew.delete-label | Delete {name} | Видалити {name} |
| views/packs/homebrew/item-form | hb-form__cancel | button (ghost) | packs.homebrew.field.cancel | Cancel | Скасувати |
| views/packs/homebrew/item-form | hb-form__save | button | packs.homebrew.field.save | Save | Зберегти |
| views/packs/homebrew/item-form | hb-form__weight | control label [labelKey] | packs.homebrew.field.item.weight | Weight (lb) | Вага (фнт.) |
| views/packs/homebrew/item-form | hb-form__range-normal | control label [labelKey] | packs.homebrew.field.item.range-normal | Normal range (ft) | Звичайна дальність (фт.) |
| views/packs/homebrew/item-form | hb-form__range-long | control label [labelKey] | packs.homebrew.field.item.range-long | Long range (ft) | Максимальна дальність (фт.) |
| views/packs/homebrew/item-form | hb-form__ac | control label [labelKey] | packs.homebrew.field.item.ac | Armor Class | Клас захисту |
| views/packs/homebrew/item-form | hb-form__dex-cap | control label [labelKey] | packs.homebrew.field.item.dex-cap | Dexterity bonus cap (empty for none) | Межа бонусу Спритності (порожньо — без межі) |
| views/packs/homebrew/item-form | hb-form__strength | control label [labelKey] | packs.homebrew.field.item.strength | Strength required (empty for none) | Потрібна Сила (порожньо — без вимоги) |
| views/packs/homebrew/item-form | hb-form__shield-ac | control label [labelKey] | packs.homebrew.field.item.shield-ac | Armor Class bonus | Бонус до Класу захисту |
| views/packs/homebrew/species-form | hb-form__remove-trait | button (ghost) | packs.homebrew.field.species.remove-trait | Remove trait | Видалити особливість |
| views/packs/homebrew/species-form | hb-form__add-trait | button (ghost) | packs.homebrew.field.species.add-trait | Add trait | Додати особливість |
| views/packs/homebrew/species-form | hb-form__cancel | button (ghost) | packs.homebrew.field.cancel | Cancel | Скасувати |
| views/packs/homebrew/species-form | hb-form__save | button | packs.homebrew.field.save | Save | Зберегти |
| views/packs/homebrew/species-form | hb-form__speed | control label [labelKey] | packs.homebrew.field.species.speed | Walking speed (ft) | Швидкість ходьби (фт.) |
| views/packs/homebrew/spell-form | hb-form__cancel | button (ghost) | packs.homebrew.field.cancel | Cancel | Скасувати |
| views/packs/homebrew/spell-form | hb-form__save | button | packs.homebrew.field.save | Save | Зберегти |
| views/packs/homebrew/spell-form | hb-form__level | control label [labelKey] | packs.homebrew.field.spell.level | Level (0 is a cantrip) | Рівень (0 — замовляння) |
| views/packs/homebrew/spell-form | hb-form__casting-value | control label [labelKey] | packs.homebrew.field.spell.casting-value | Casting time | Час накладання |
| views/packs/homebrew/spell-form | hb-form__range-distance | control label [labelKey] | packs.homebrew.field.spell.range-distance | Distance | Відстань |
| views/packs/homebrew/spell-form | hb-form__duration-value | control label [labelKey] | packs.homebrew.field.spell.duration-value | Duration amount | Значення тривалості |

### Packs list + detail

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/packs/pack-detail | pack-detail__back | link -> /packs | packs.detail.back | Back to packs | До пакетів |
| views/packs/pack-detail | pack-detail__remove | button (danger) | packs.detail.remove | Remove pack | Видалити пакет |
| views/packs/packs-list | packs-list__homebrew | link -> /packs/homebrew | packs.homebrew.open | Homebrew | Хоумбрю |
| views/packs/packs-list | packs-list__import | button (primary) | packs.list.import | Import pack | Імпортувати пакет |
| views/packs/packs-list | packs-list__details-dismiss | button (ghost) | packs.list.import-details-dismiss | Dismiss | Сховати |
| views/packs/packs-list | packs-list__row | link -> ['/packs', packKey(core)] | packs.list.core-label | core rules | базові правила |
| views/packs/packs-list | packs-list__row | link -> ['/packs', packKey(core)] | packs.update-available | Update available | Доступне оновлення |
| views/packs/packs-list | packs-list__row | link -> ['/packs', packKey(pack)] | packs.list.other-device-homebrew | From another device | З іншого пристрою |
| views/packs/packs-list | packs-list__row | link -> ['/packs', packKey(pack)] | packs.update-available | Update available | Доступне оновлення |

### Dialog: pack trust

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/packs/pack-trust-dialog | pack-trust-dialog__cancel | button (ghost) | packs.trust.cancel | Cancel | Скасувати |
| views/packs/pack-trust-dialog | pack-trust-dialog__install | button (primary) | packs.trust.install | Install | Встановити |

### Settings

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| views/settings/settings | settings__persist-button | button | settings.storage.persist | Keep data on this device | Зберігати дані на цьому пристрої |
| views/settings/settings | settings__import-button | button | settings.packs.import-demo | Import the Russian sample pack | Імпортувати демо-пакет російською |
| views/settings/settings | settings__manage-packs | link -> /packs | settings.packs.manage | Manage packs | Керувати пакетами |
| views/settings/settings | settings__logout | button (ghost) | settings.account.logout | Log out | Вийти |
| views/settings/settings | settings__logout-all | button (danger) | settings.account.logout-all | Log out everywhere | Вийти всюди |
| views/settings/settings | settings__login-link | link -> /login | settings.account.login | Log in | Увійти |
| views/settings/settings | settings__register-link | link -> /register | settings.account.register | Create an account | Створити обліковий запис |
| views/settings/settings | settings__devices-retry | button (ghost) | settings.devices.retry | Try again | Повторити |
| views/settings/settings | settings__devices-revoke | button (danger) | settings.devices.revoke | Revoke | Відкликати |

### Shared components (used across screens)

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| shared/components/campaign-chip/campaign-chip | campaign-chip__link | link -> ['/g', id] | campaigns.chip.fallbackName | Linked campaign | Пов'язана кампанія |
| shared/components/campaign-chip/campaign-chip | campaign-chip__leave | button (ghost) | campaigns.chip.leave | Leave campaign | Покинути кампанію |
| shared/components/campaign-chip/leave-campaign-dialog | leave-campaign-dialog__cancel | button (ghost) | campaigns.leave.cancel | Cancel | Скасувати |
| shared/components/campaign-chip/leave-campaign-dialog | leave-campaign-dialog__confirm | button (danger) | campaigns.leave.confirm | Leave | Покинути |
| shared/components/campaign-chip/leave-campaign-dialog | leave-campaign-dialog__retry | button (primary) | campaigns.link.progress.retry | Retry | Повторити |
| shared/components/chip/chip | hk-chip__remove | button | (none) | | |
| shared/components/pips/pips | hk-pips__pip | button | (none) | | |
| shared/components/rebase-report-dialog/rebase-report-dialog | rebase-report__cancel | button (ghost) | characters.rebase.cancel | Cancel | Скасувати |
| shared/components/rebase-report-dialog/rebase-report-dialog | rebase-report__confirm | button (primary) | characters.rebase.confirm | Confirm | Підтвердити |
| shared/components/search-field/search-field | hk-search-field__clear | button | (none) | | |
| shared/components/sheet-section/sheet-section | hk-sheet-section__toggle | button | (dynamic text) | | |
| shared/components/stepper/stepper | hk-stepper__step | button | (dynamic text) | | |
| shared/components/tabs/tabs | hk-tabs__tab | button | (dynamic text) | | |

### App shell (header, nav, account)

| Template | Element | Kind | Key | en | uk |
|---|---|---|---|---|---|
| app.html | app-shell__update-button | button (ghost) | shell.app.update-reload | Reload | Оновити |
| app.html | app-shell__logout | button (ghost) | shell.account.logout | Log out | Вийти |
| app.html | app-shell__login-link | link -> /login | shell.account.login | Log in | Увійти |
| app.html | app-shell__theme-toggle | button (aria-label) | shell.app.theme-toggle | Toggle theme | Перемкнути тему |
| app.html | button | button (primary) | shell.app.core-error-retry | Try again | Повторити |

## Part 2: labels observed per captured screen (1280 px)

### about

- **en** (9): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`
- **uk** (9): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`

### campaign-link-character

- **en** (15): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`, `Link this character`, `Create a new character`, `Skip for now`
- **uk** (15): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`, `Прив'язати цього персонажа`, `Створити нового персонажа`, `Пропустити`

### campaign-link-character-eligible

- **en** (15): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`, `Link this character`, `Create a new character`, `Skip for now`

### campaign-lobby

- **en** (14): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`, `Copy invite link`, `Generate a new code`
- **uk** (15): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`, `Скопіювати посилання-запрошення`, `Згенерувати новий код`, `Видалити`

### campaign-lobby-dm

- **en** (15): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`, `Copy invite link`, `Generate a new code`, `Remove`
- **uk** (15): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`, `Скопіювати посилання-запрошення`, `Згенерувати новий код`, `Видалити`

### campaign-lobby-member

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`

### campaign-log

- **en** (17): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`, `Start session`, `Everyone`, `DM only`, `Private`, `Send`
- **uk** (17): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`, `Завершити сесію`, `Усі`, `Лише Майстер`, `Приватно`, `Надіслати`

### campaign-log-member

- **en** (16): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`, `Everyone`, `DM only`, `Private`, `Send`
- **uk** (16): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`, `Усі`, `Лише Майстер`, `Приватно`, `Надіслати`

### campaign-log-session

- **en** (17): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`, `End session`, `Everyone`, `DM only`, `Private`, `Send`
- **uk** (17): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`, `Завершити сесію`, `Усі`, `Лише Майстер`, `Приватно`, `Надіслати`

### campaign-party

- **en** (14): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`, `Add pregen`, `Link a character`
- **uk** (15): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`, `Додати заготовку персонажа`, `Прив'язати персонажа`, `Інструменти майстра`

### campaign-party-dm

- **en** (15): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`, `Add pregen`, `Link a character`, `DM tools`
- **uk** (15): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`, `Додати заготовку персонажа`, `Прив'язати персонажа`, `Інструменти майстра`

### campaign-party-member

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`

### campaign-settings

- **en** (31): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`, `Free`, `Needs DM approval`, `Locked`, `Experience points`, `Milestone`, `Roll`, `Average`, `Player's choice`, `Off`, `Standard`, `Variant (encumbered tiers)`, `Enable`, `Hidden`, `Overview only`, `Full sheets`, `Everyone`, `DM only`, `Save`, `Export campaign`
- **uk** (31): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`, `Вільно`, `Потребує схвалення майстра`, `Заблоковано`, `Очки досвіду`, `За віхами`, `Кидок кубика`, `Середнє значення`, `На вибір гравця`, `Вимкнено`, `Стандартне`, `Варіативне (за рівнями)`, `Увімкнути`, `Приховані`, `Лише огляд`, `Повні листи`, `Усі`, `Лише майстер`, `Зберегти`, `Експортувати кампанію`

### campaign-settings-member

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Party`, `Log`, `Lobby`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Група`, `Журнал`, `Лобі`

### campaigns-empty

- **en** (11): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Join campaign`, `New campaign`
- **uk** (11): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Приєднатися до кампанії`, `Нова кампанія`

### campaigns-list

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Join campaign`, `New campaign`, `Shadows over Thornwall DM`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Приєднатися до кампанії`, `Нова кампанія`, `Shadows over Thornwall МАЙСТЕР`

### campaigns-list-member

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Join campaign`, `New campaign`, `Shadows over Thornwall PLAYER`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Приєднатися до кампанії`, `Нова кампанія`, `Shadows over Thornwall ГРАВЕЦЬ`

### characters-empty

- **en** (11): `Log in`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Import`, `New character`
- **uk** (11): `Увійти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Імпорт`, `Новий персонаж`

### characters-list

- **en** (14): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Import`, `New character`, `MA Mira Ashveil srd-5e-2024`, `Delete`, `AS Aldric Stormborn srd-5e-2024`
- **uk** (16): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Імпорт`, `Новий персонаж`, `МЗ Мирослава Зоряна srd-5e-2024`, `Видалити`, `AS Aldric Stormborn srd-5e-2024`, `ОГ Орест Громовий srd-5e-2024`, `MA Mira Ashveil srd-5e-2024`

### characters-list-dark

- **en** (14): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Import`, `New character`, `MA Mira Ashveil srd-5e-2024`, `Delete`, `AS Aldric Stormborn srd-5e-2024`

### dialog-add-item

- **en** (62): ` [aria: Clear search]`, `Acid`, `Show description`, `Adamantine Armor (Breastplate)`, `Adamantine Armor (Chain Mail)`, `Adamantine Armor (Chain Shirt)`, `Adamantine Armor (Half Plate)`, `Adamantine Armor (Plate)`, `Adamantine Armor (Ring Mail)`, `Adamantine Armor (Scale Mail)`, `Adamantine Armor (Splint)`, `Airship`, `Alchemist's Fire`, `Alchemist's Supplies (50 GP)`, `Ammunition (+1)`, `Ammunition (+2)`, `Ammunition (+3)`, `Ammunition of Aberration Slaying`, `Ammunition of Beast Slaying`, `Ammunition of Celestial Slaying`, `Ammunition of Construct Slaying`, `Ammunition of Dragon Slaying`, `Ammunition of Elemental Slaying`, `Ammunition of Fey Slaying`, `Ammunition of Fiend Slaying`, `Ammunition of Giant Slaying`, `Ammunition of Humanoid Slaying`, `Ammunition of Monstrosity Slaying`, `Ammunition of Ooze Slaying`, `Ammunition of Plant Slaying`, `Ammunition of Undead Slaying`, `Amulet of Health`, `Amulet of Proof against Detection and Location`, `Amulet of the Planes`, `Animated Shield`, `Antitoxin`, `Apparatus of the Crab`, `Armor of Invulnerability`, `Armor of Resistance (Breastplate)`, `Armor of Resistance (Chain Mail)`, `Armor of Resistance (Chain Shirt)`, `Armor of Resistance (Half Plate)`, `Armor of Resistance (Hide Armor)`, `Armor of Resistance (Leather Armor)`, `Armor of Resistance (Padded)`, `Armor of Resistance (Plate)`, `Armor of Resistance (Ring Mail)`, `Armor of Resistance (Scale Mail)`, `Armor of Resistance (Splint)`, `Armor of Resistance (Studded Leather)`, `Armor of Vulnerability (Breastplate)`, `Armor of Vulnerability (Chain Mail)`, `Armor of Vulnerability (Chain Shirt)`, `Armor of Vulnerability (Half Plate Armor)`, `Armor of Vulnerability (Hide Armor)`, `Armor of Vulnerability (Leather Armor)`, `Armor of Vulnerability (Padded Armor)`, `Armor of Vulnerability (Plate Armor)`, `Armor of Vulnerability (Ring Mail)`, `Armor of Vulnerability (Scale Mail)`, `Armor of Vulnerability (Splint Armor)`, `Armor of Vulnerability (Studded Leather Armor)`
- **uk** (62): ` [aria: Очистити пошук]`, `Acid`, `Показати опис`, `Adamantine Armor (Breastplate)`, `Adamantine Armor (Chain Mail)`, `Adamantine Armor (Chain Shirt)`, `Adamantine Armor (Half Plate)`, `Adamantine Armor (Plate)`, `Adamantine Armor (Ring Mail)`, `Adamantine Armor (Scale Mail)`, `Adamantine Armor (Splint)`, `Airship`, `Alchemist's Fire`, `Alchemist's Supplies (50 GP)`, `Ammunition (+1)`, `Ammunition (+2)`, `Ammunition (+3)`, `Ammunition of Aberration Slaying`, `Ammunition of Beast Slaying`, `Ammunition of Celestial Slaying`, `Ammunition of Construct Slaying`, `Ammunition of Dragon Slaying`, `Ammunition of Elemental Slaying`, `Ammunition of Fey Slaying`, `Ammunition of Fiend Slaying`, `Ammunition of Giant Slaying`, `Ammunition of Humanoid Slaying`, `Ammunition of Monstrosity Slaying`, `Ammunition of Ooze Slaying`, `Ammunition of Plant Slaying`, `Ammunition of Undead Slaying`, `Amulet of Health`, `Amulet of Proof against Detection and Location`, `Amulet of the Planes`, `Animated Shield`, `Antitoxin`, `Apparatus of the Crab`, `Armor of Invulnerability`, `Armor of Resistance (Breastplate)`, `Armor of Resistance (Chain Mail)`, `Armor of Resistance (Chain Shirt)`, `Armor of Resistance (Half Plate)`, `Armor of Resistance (Hide Armor)`, `Armor of Resistance (Leather Armor)`, `Armor of Resistance (Padded)`, `Armor of Resistance (Plate)`, `Armor of Resistance (Ring Mail)`, `Armor of Resistance (Scale Mail)`, `Armor of Resistance (Splint)`, `Armor of Resistance (Studded Leather)`, `Armor of Vulnerability (Breastplate)`, `Armor of Vulnerability (Chain Mail)`, `Armor of Vulnerability (Chain Shirt)`, `Armor of Vulnerability (Half Plate Armor)`, `Armor of Vulnerability (Hide Armor)`, `Armor of Vulnerability (Leather Armor)`, `Armor of Vulnerability (Padded Armor)`, `Armor of Vulnerability (Plate Armor)`, `Armor of Vulnerability (Ring Mail)`, `Armor of Vulnerability (Scale Mail)`, `Armor of Vulnerability (Splint Armor)`, `Armor of Vulnerability (Studded Leather Armor)`

### dialog-add-item-search

- **en** (20): ` [aria: Clear search]`, `Potion of Animal Friendship`, `Show description`, `Potion of Clairvoyance`, `Potion of Climbing`, `Potion of Diminution`, `Potion of Flying`, `Potion of Gaseous Form`, `Potion of Giant Strength`, `Potion of Growth`, `Potion of Healing`, `Potion of Heroism`, `Potion of Invisibility`, `Potion of Mind Reading`, `Potion of Poison`, `Potion of Resistance`, `Potion of Speed`, `Potion of Water Breathing`, `Potions of Healing`, `Cancel`
- **uk** (20): ` [aria: Очистити пошук]`, `Potion of Animal Friendship`, `Показати опис`, `Potion of Clairvoyance`, `Potion of Climbing`, `Potion of Diminution`, `Potion of Flying`, `Potion of Gaseous Form`, `Potion of Giant Strength`, `Potion of Growth`, `Potion of Healing`, `Potion of Heroism`, `Potion of Invisibility`, `Potion of Mind Reading`, `Potion of Poison`, `Potion of Resistance`, `Potion of Speed`, `Potion of Water Breathing`, `Potions of Healing`, `Скасувати`

### dialog-campaign-export

- **en** (2): `Close`, `Export`
- **uk** (2): `Закрити`, `Експортувати`

### dialog-cast

- **en** (2): `Cancel`, `Cast`
- **uk** (2): `Скасувати`, `Накласти`

### dialog-condition

- **en** (2): `Cancel`, `Add`
- **uk** (2): `Скасувати`, `Додати`

### dialog-create-campaign

- **en** (2): `Cancel`, `Create`
- **uk** (2): `Скасувати`, `Створити`

### dialog-custom-item

- **en** (2): `Cancel`, `Add`
- **uk** (2): `Скасувати`, `Додати`

### dialog-leave-campaign

- **en** (2): `Cancel`, `Leave`
- **uk** (2): `Скасувати`, `Покинути`

### dialog-long-rest

- **en** (2): `Cancel`, `Take long rest`
- **uk** (2): `Скасувати`, `Взяти тривалий відпочинок`

### dialog-note

- **en** (2): `Cancel`, `Save`
- **uk** (2): `Скасувати`, `Зберегти`

### dialog-pack-trust

- **en** (2): `Cancel`, `Install`
- **uk** (2): `Скасувати`, `Встановити`

### dialog-remove-member

- **en** (2): `Cancel`, `Remove`
- **uk** (2): `Скасувати`, `Видалити`

### dialog-revert-confirm

- **en** (2): `Cancel`, `Revert`
- **uk** (1): `Скасувати`

### dialog-short-rest

- **en** (3): `Roll d10`, `Cancel`, `Take short rest`
- **uk** (3): `Кинути к10`, `Скасувати`, `Взяти короткий відпочинок`

### dialog-short-rest-rolled

- **en** (3): `Roll d10`, `Cancel`, `Take short rest`
- **uk** (3): `Кинути к10`, `Скасувати`, `Взяти короткий відпочинок`

### home

- **en** (9): `Log in`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`
- **uk** (9): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`

### homebrew-edit-item

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to homebrew`, `Cancel`, `Save`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `До хоумбрю`, `Скасувати`, `Зберегти`

### homebrew-list

- **en** (16): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to packs`, `New item`, `New spell`, `New feat`, `New species`, `Edit [aria: Edit Starlit Lantern]`, `Delete [aria: Delete Starlit Lantern]`
- **uk** (16): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `До пакетів`, `Новий предмет`, `Нове заклинання`, `Нова риса`, `Новий вид`, `Змінити [aria: Змінити Starlit Lantern]`, `Видалити [aria: Видалити Starlit Lantern]`

### homebrew-list-empty

- **en** (14): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to packs`, `New item`, `New spell`, `New feat`, `New species`

### homebrew-new-feat

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to homebrew`, `Cancel`, `Save`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `До хоумбрю`, `Скасувати`, `Зберегти`

### homebrew-new-item

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to homebrew`, `Cancel`, `Save`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `До хоумбрю`, `Скасувати`, `Зберегти`

### homebrew-new-species

- **en** (13): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to homebrew`, `Add trait`, `Cancel`, `Save`
- **uk** (13): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `До хоумбрю`, `Додати особливість`, `Скасувати`, `Зберегти`

### homebrew-new-spell

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to homebrew`, `Cancel`, `Save`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `До хоумбрю`, `Скасувати`, `Зберегти`

### join

- **en** (11): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to campaigns`, `Join`
- **uk** (11): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Назад до кампаній`, `Приєднатися`

### join-filled

- **en** (11): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to campaigns`, `Join`

### join-prefilled

- **en** (11): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to campaigns`, `Join`
- **uk** (11): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Назад до кампаній`, `Приєднатися`

### levelup-l3-s01-class-picker

- **uk** (18): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Доступне підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Підвищити Fighter до 3 рівня`, `Мультиклас: Barbarian`, `Мультиклас: Rogue`

### levelup-l3-s02-hp

- **uk** (22): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Доступне підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Очки здоров'я`, `Вибір`, `Огляд`, `Кинути`, `Взяти середнє`, `Назад`, `Далі`

### levelup-l3-s02-hp-chosen

- **uk** (22): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Доступне підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Очки здоров'я`, `Вибір`, `Огляд`, `Кинути`, `Взяти середнє`, `Назад`, `Далі`

### levelup-l3-s03-fighter-subclass

- **uk** (23): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Доступне підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Очки здоров'я`, `Вибір`, `Огляд`, ` [aria: Очистити пошук]`, `Champion`, `Показати опис`, `Назад`, `Далі`

### levelup-l3-s04-review

- **uk** (19): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Доступне підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Очки здоров'я`, `Огляд`, `Завершити підвищення`, `Назад`

### levelup-s01-class-picker

- **en** (18): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Level up available`, `Play`, `Build`, `Timeline`, `Level up Fighter to 2`, `Multiclass into Barbarian`, `Multiclass into Rogue`
- **uk** (18): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Доступне підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Підвищити Fighter до 2 рівня`, `Мультиклас: Barbarian`, `Мультиклас: Rogue`

### levelup-s02-hp

- **en** (21): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Level up available`, `Play`, `Build`, `Timeline`, `Hit points`, `Review`, `Roll`, `Take average`, `Back`, `Next`
- **uk** (21): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Доступне підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Очки здоров'я`, `Огляд`, `Кинути`, `Взяти середнє`, `Назад`, `Далі`

### levelup-s02-hp-chosen

- **en** (21): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Level up available`, `Play`, `Build`, `Timeline`, `Hit points`, `Review`, `Roll`, `Take average`, `Back`, `Next`
- **uk** (21): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Доступне підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Очки здоров'я`, `Огляд`, `Кинути`, `Взяти середнє`, `Назад`, `Далі`

### levelup-s03-review

- **en** (19): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Level up available`, `Play`, `Build`, `Timeline`, `Hit points`, `Review`, `Finish level up`, `Back`
- **uk** (19): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Доступне підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Очки здоров'я`, `Огляд`, `Завершити підвищення`, `Назад`

### library

- **en** (35): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Classes`, `Subclasses`, `Species`, `Backgrounds`, `Feats`, `Spells`, `Items`, `Features`, `Conditions`, `Skills`, `Languages`, `Rules`, ` [aria: Clear search]`, `Acid Arrow`, `Acid Splash`, `Aid`, `Alarm`, `Alter Self`, `Animal Friendship`, `Animal Messenger`, `Animal Shapes`, `Animate Dead`, `Animate Objects`, `Antilife Shell`, `Antimagic Field`, `Antipathy/Sympathy`
- **uk** (35): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Класи`, `Підкласи`, `Види`, `Передісторії`, `Риси`, `Заклинання`, `Предмети`, `Особливості`, `Стани`, `Навички`, `Мови`, `Правила`, ` [aria: Очистити пошук]`, `Acid Arrow EN`, `Acid Splash EN`, `Aid EN`, `Alarm EN`, `Alter Self EN`, `Animal Friendship EN`, `Animal Messenger EN`, `Animal Shapes EN`, `Animate Dead EN`, `Animate Objects EN`, `Antilife Shell EN`, `Antimagic Field EN`, `Antipathy/Sympathy EN`

### library-dark

- **en** (35): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Classes`, `Subclasses`, `Species`, `Backgrounds`, `Feats`, `Spells`, `Items`, `Features`, `Conditions`, `Skills`, `Languages`, `Rules`, ` [aria: Clear search]`, `Acid Arrow`, `Acid Splash`, `Aid`, `Alarm`, `Alter Self`, `Animal Friendship`, `Animal Messenger`, `Animal Shapes`, `Animate Dead`, `Animate Objects`, `Antilife Shell`, `Antimagic Field`, `Antipathy/Sympathy`

### library-detail

- **en** (9): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`
- **uk** (9): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`

### library-detail-class

- **en** (9): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`
- **uk** (9): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`

### library-filter

- **en** (34): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Classes`, `Subclasses`, `Species`, `Backgrounds`, `Feats`, `Spells`, `Items`, `Features`, `Conditions`, `Skills`, `Languages`, `Rules`, ` [aria: Clear search]`, `Champion`, `Circle of the Land`, `College of Lore`, `Draconic Sorcery`, `Evoker`, `Fiend Patron`, `Hunter`, `Life Domain`, `Oath of Devotion`, `Path of the Berserker`, `Thief`, `Warrior of the Open Hand`
- **uk** (34): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Класи`, `Підкласи`, `Види`, `Передісторії`, `Риси`, `Заклинання`, `Предмети`, `Особливості`, `Стани`, `Навички`, `Мови`, `Правила`, ` [aria: Очистити пошук]`, `Champion EN`, `Circle of the Land EN`, `College of Lore EN`, `Draconic Sorcery EN`, `Evoker EN`, `Fiend Patron EN`, `Hunter EN`, `Life Domain EN`, `Oath of Devotion EN`, `Path of the Berserker EN`, `Thief EN`, `Warrior of the Open Hand EN`

### library-search

- **en** (35): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Classes`, `Subclasses`, `Species`, `Backgrounds`, `Feats`, `Spells`, `Items`, `Features`, `Conditions`, `Skills`, `Languages`, `Rules`, ` [aria: Clear search]`, `Alchemist's Fire Items`, `Brazier of Commanding Fire Elementals Items`, `Bullets, Firearm (10) Items`, `Damage type: Fire Rules`, `Delayed Blast Fireball Spells`, `Faerie Fire Spells`, `Fire Bolt Spells`, `Fire Shield Spells`, `Fire Storm Spells`, `Fireball Spells`, `Necklace of Fireballs Items`, `Staff of Fire Items`, `Wall of Fire Spells`
- **uk** (35): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Класи`, `Підкласи`, `Види`, `Передісторії`, `Риси`, `Заклинання`, `Предмети`, `Особливості`, `Стани`, `Навички`, `Мови`, `Правила`, ` [aria: Очистити пошук]`, `Alchemist's Fire Предмети`, `Brazier of Commanding Fire Elementals Предмети`, `Bullets, Firearm (10) Предмети`, `Damage type: Fire Правила`, `Delayed Blast Fireball Заклинання`, `Faerie Fire Заклинання`, `Fire Bolt Заклинання`, `Fire Shield Заклинання`, `Fire Storm Заклинання`, `Fireball Заклинання`, `Necklace of Fireballs Предмети`, `Staff of Fire Предмети`, `Wall of Fire Заклинання`

### login

- **en** (11): `Log in`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Create an account`, `Forgot your password?`
- **uk** (11): `Увійти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Створити акаунт`, `Забули пароль?`

### login-error

- **en** (11): `Log in`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Create an account`, `Forgot your password?`
- **uk** (11): `Увійти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Створити акаунт`, `Забули пароль?`

### login-redirected

- **en** (11): `Log in`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Create an account`, `Forgot your password?`
- **uk** (11): `Увійти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Створити акаунт`, `Забули пароль?`

### pack-detail

- **en** (11): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to packs`, `Remove pack`
- **uk** (11): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `До пакетів`, `Видалити пакет`

### pack-detail-core

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Back to packs`, `https://www.dndbeyond.com/srd`, `https://creativecommons.org/licenses/by/4.0/legalcode`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `До пакетів`, `https://www.dndbeyond.com/srd`, `https://creativecommons.org/licenses/by/4.0/legalcode`

### packs-list

- **en** (13): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Homebrew`, `Import pack`, `SRD 5.2.1 (2024 rules) 0.1.0 core rules`, `Sample content 1.0.0`
- **uk** (15): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Хоумбрю`, `Імпортувати пакет`, `SRD 5.2.1 (2024 rules) 0.1.0 базові правила`, `My homebrew 0.1.0`, `Sample content 1.0.0`, `Sample content 1.1.0`

### packs-list-initial

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Homebrew`, `Import pack`, `SRD 5.2.1 (2024 rules) 0.1.0 core rules`

### recover

- **en** (11): `Log in`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Reset password`, `Back to log in`
- **uk** (11): `Увійти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Скинути пароль`, `Повернутися до входу`

### register-codes

- **en** (12): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Copy codes`, `Download as .txt`, `Continue`
- **uk** (12): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Скопіювати коди`, `Завантажити як .txt`, `Продовжити`

### register-form

- **en** (11): `Log in`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Create account`, `Already have an account? Log in`
- **uk** (11): `Увійти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Створити акаунт`, `Вже є акаунт? Увійти`

### register-form-errors

- **en** (11): `Log in`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Create account`, `Already have an account? Log in`
- **uk** (11): `Увійти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Створити акаунт`, `Вже є акаунт? Увійти`

### settings

- **en** (18): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `English`, `Русский`, `Українська`, `Dark`, `Light`, `Keep data on this device`, `Import the Russian sample pack`, `Manage packs`, `Log out everywhere`
- **uk** (18): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `English`, `Русский`, `Українська`, `Темна`, `Світла`, `Зберігати дані на цьому пристрої`, `Імпортувати демо-пакет російською`, `Керувати пакетами`, `Вийти всюди`

### settings-anon

- **en** (18): `Log in`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `English`, `Русский`, `Українська`, `Dark`, `Light`, `Keep data on this device`, `Import the Russian sample pack`, `Manage packs`, `Create an account`

### settings-fresh-account

- **uk** (18): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `English`, `Русский`, `Українська`, `Темна`, `Світла`, `Зберігати дані на цьому пристрої`, `Імпортувати демо-пакет російською`, `Керувати пакетами`, `Вийти всюди`

### sheet-build

- **en** (16): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Play`, `Build`, `Timeline`, `Save`, `Upload portrait`
- **uk** (16): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Гра`, `Білд`, `Хроніка`, `Зберегти`, `Завантажити портрет`

### sheet-build-caster

- **en** (16): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Play`, `Build`, `Timeline`, `Save`, `Upload portrait`
- **uk** (16): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Гра`, `Білд`, `Хроніка`, `Зберегти`, `Завантажити портрет`

### sheet-levelup-badge

- **en** (67): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Level up available`, `Play`, `Build`, `Timeline`, `Dice roller`, `Normal`, `Advantage`, `Disadvantage`, `Log roll`, `Clear log`, `Keep screen awake`, `17`, `+5`, `Roll check`, `Roll save`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Roll`, `Proficient`, `+3`, `ARMOR CLASS 17`, `INITIATIVE +1`, `SPEED 30 walk`, `MAX 12`, `Damage`, `Heal`, `Add temp HP`, `Short rest`, `Long rest`, `Not inspired`, `Roll to hit`, `1d8 +3`, `Roll damage`, `0 / 2`, ` [aria: Second Wind use 1 of 2]`, ` [aria: Second Wind use 2 of 2]`, `Actions`, `Add condition`, `Deafened Remove condition`, `Remove condition`, `Proficiencies`, `Inventory`, `Add from library`, `Add custom item`, `Equipped`, `− [aria: Decrease quantity]`, `+ [aria: Increase quantity]`, `Unequip`, `Remove item`
- **uk** (66): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Доступне підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Кидок костей`, `Звичайно`, `Перевага`, `Завада`, `Записати кидок`, `Очистити журнал`, `Не вимикати екран`, `17`, `+5`, `Кинути перевірку`, `Кинути рятівний кидок`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Кинути`, `Володіння`, `+3`, `КЛАС БРОНІ 17`, `ІНІЦІАТИВА +1`, `ШВИДКІСТЬ 30 walk`, `МАКСИМУМ 12`, `Шкода`, `Лікування`, `Додати тимчасові ОЗ`, `Короткий відпочинок`, `Тривалий відпочинок`, `Немає натхнення`, `Кинути атаку`, `1d8 +3`, `Кинути шкоду`, `0 / 2`, ` [aria: Second Wind, використання 1 з 2]`, ` [aria: Second Wind, використання 2 з 2]`, `Дії`, `Додати стан`, `Deafened Прибрати стан`, `Прибрати стан`, `Інвентар`, `Додати з бібліотеки`, `Додати свій предмет`, `Споряджено`, `− [aria: Зменшити кількість]`, `+ [aria: Збільшити кількість]`, `Зняти`, `Видалити предмет`

### sheet-not-found

- **en** (9): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`
- **uk** (9): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`

### sheet-play

- **en** (64): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Play`, `Build`, `Timeline`, `Dice roller`, `Normal`, `Advantage`, `Disadvantage`, `Log roll`, `Keep screen awake`, `17`, `+5`, `Roll check`, `Roll save`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Roll`, `Proficient`, `+3`, `ARMOR CLASS 17`, `INITIATIVE +1`, `SPEED 30 walk`, `MAX 12`, `Damage`, `Heal`, `Add temp HP`, `Short rest`, `Long rest`, `Not inspired`, `Roll to hit`, `1d8 +3`, `Roll damage`, `0 / 2`, ` [aria: Second Wind use 1 of 2]`, ` [aria: Second Wind use 2 of 2]`, `Actions`, `Add condition`, `Proficiencies`, `Inventory`, `Add from library`, `Add custom item`, `Equipped`, `− [aria: Decrease quantity]`, `+ [aria: Increase quantity]`, `Unequip`, `Remove item`, `Equip`
- **uk** (63): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Гра`, `Білд`, `Хроніка`, `Кидок костей`, `Звичайно`, `Перевага`, `Завада`, `Записати кидок`, `Не вимикати екран`, `17`, `+5`, `Кинути перевірку`, `Кинути рятівний кидок`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Кинути`, `Володіння`, `+3`, `КЛАС БРОНІ 17`, `ІНІЦІАТИВА +1`, `ШВИДКІСТЬ 30 walk`, `МАКСИМУМ 12`, `Шкода`, `Лікування`, `Додати тимчасові ОЗ`, `Короткий відпочинок`, `Тривалий відпочинок`, `Немає натхнення`, `Кинути атаку`, `1d8 +3`, `Кинути шкоду`, `0 / 2`, ` [aria: Second Wind, використання 1 з 2]`, ` [aria: Second Wind, використання 2 з 2]`, `Дії`, `Додати стан`, `Інвентар`, `Додати з бібліотеки`, `Додати свій предмет`, `Споряджено`, `− [aria: Зменшити кількість]`, `+ [aria: Збільшити кількість]`, `Зняти`, `Видалити предмет`, `Спорядити`

### sheet-play-after

- **en** (66): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Play`, `Build`, `Timeline`, `Dice roller`, `Normal`, `Advantage`, `Disadvantage`, `Log roll`, `Clear log`, `Keep screen awake`, `17`, `+5`, `Roll check`, `Roll save`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Roll`, `Proficient`, `+3`, `ARMOR CLASS 17`, `INITIATIVE +1`, `SPEED 30 walk`, `MAX 12`, `Damage`, `Heal`, `Add temp HP`, `Short rest`, `Long rest`, `Not inspired`, `Roll to hit`, `1d8 +3`, `Roll damage`, `0 / 2`, ` [aria: Second Wind use 1 of 2]`, ` [aria: Second Wind use 2 of 2]`, `Actions`, `Add condition`, `Deafened Remove condition`, `Remove condition`, `Proficiencies`, `Inventory`, `Add from library`, `Add custom item`, `Equipped`, `− [aria: Decrease quantity]`, `+ [aria: Increase quantity]`, `Unequip`, `Remove item`
- **uk** (65): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Гра`, `Білд`, `Хроніка`, `Кидок костей`, `Звичайно`, `Перевага`, `Завада`, `Записати кидок`, `Очистити журнал`, `Не вимикати екран`, `17`, `+5`, `Кинути перевірку`, `Кинути рятівний кидок`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Кинути`, `Володіння`, `+3`, `КЛАС БРОНІ 17`, `ІНІЦІАТИВА +1`, `ШВИДКІСТЬ 30 walk`, `МАКСИМУМ 12`, `Шкода`, `Лікування`, `Додати тимчасові ОЗ`, `Короткий відпочинок`, `Тривалий відпочинок`, `Немає натхнення`, `Кинути атаку`, `1d8 +3`, `Кинути шкоду`, `0 / 2`, ` [aria: Second Wind, використання 1 з 2]`, ` [aria: Second Wind, використання 2 з 2]`, `Дії`, `Додати стан`, `Deafened Прибрати стан`, `Прибрати стан`, `Інвентар`, `Додати з бібліотеки`, `Додати свій предмет`, `Споряджено`, `− [aria: Зменшити кількість]`, `+ [aria: Збільшити кількість]`, `Зняти`, `Видалити предмет`

### sheet-play-caster

- **en** (65): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Play`, `Build`, `Timeline`, `Dice roller`, `Normal`, `Advantage`, `Disadvantage`, `Log roll`, `Keep screen awake`, `8`, `-1`, `Roll check`, `Roll save`, `15`, `+2`, `+4`, `12`, `+3`, `10`, `0`, `Roll`, `+1`, `Proficient`, `ARMOR CLASS 12`, `INITIATIVE +2`, `SPEED 30 walk`, `MAX 8`, `Damage`, `Heal`, `Add temp HP`, `Short rest`, `Long rest`, `Not inspired`, `Roll to hit`, `1d6 -1`, `Roll damage`, `1d4 +2`, `SAVE DC 12`, `ATTACK BONUS +4`, `Roll spell attack`, ` [aria: Level 1 slot 1 of 2]`, ` [aria: Level 1 slot 2 of 2]`, `Prepare`, `Actions`, `Add condition`, `Proficiencies`, `Inventory`, `Add from library`, `Add custom item`, `Equipped`, `− [aria: Decrease quantity]`, `+ [aria: Increase quantity]`, `Unequip`, `Remove item`
- **uk** (64): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Гра`, `Білд`, `Хроніка`, `Кидок костей`, `Звичайно`, `Перевага`, `Завада`, `Записати кидок`, `Не вимикати екран`, `8`, `-1`, `Кинути перевірку`, `Кинути рятівний кидок`, `15`, `+2`, `+4`, `12`, `+3`, `10`, `0`, `Кинути`, `+1`, `Володіння`, `КЛАС БРОНІ 12`, `ІНІЦІАТИВА +2`, `ШВИДКІСТЬ 30 walk`, `МАКСИМУМ 8`, `Шкода`, `Лікування`, `Додати тимчасові ОЗ`, `Короткий відпочинок`, `Тривалий відпочинок`, `Немає натхнення`, `Кинути атаку`, `1d6 -1`, `Кинути шкоду`, `СКЛАДНІСТЬ РЯТІВНОГО КИДКА 12`, `БОНУС АТАКИ ЗАКЛИНАННЯМ +4`, `Кинути атаку заклинанням`, ` [aria: Комірка 1 рівня 1 з 2]`, ` [aria: Комірка 1 рівня 2 з 2]`, `Підготувати`, `Дії`, `Додати стан`, `Інвентар`, `Додати з бібліотеки`, `Додати свій предмет`, `Споряджено`, `− [aria: Зменшити кількість]`, `+ [aria: Збільшити кількість]`, `Зняти`, `Видалити предмет`, `Спорядити`

### sheet-play-caster-cast

- **en** (66): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Play`, `Build`, `Timeline`, `Dice roller`, `Normal`, `Advantage`, `Disadvantage`, `Log roll`, `Keep screen awake`, `8`, `-1`, `Roll check`, `Roll save`, `15`, `+2`, `+4`, `12`, `+3`, `10`, `0`, `Roll`, `+1`, `Proficient`, `ARMOR CLASS 12`, `INITIATIVE +2`, `SPEED 30 walk`, `MAX 8`, `Damage`, `Heal`, `Add temp HP`, `Short rest`, `Long rest`, `Not inspired`, `Roll to hit`, `1d6 -1`, `Roll damage`, `1d4 +2`, `SAVE DC 12`, `ATTACK BONUS +4`, `Roll spell attack`, ` [aria: Level 1 slot 1 of 2]`, ` [aria: Level 1 slot 2 of 2]`, `Unprepare`, `Prepare`, `Cast`, `Actions`, `Add condition`, `Proficiencies`, `Inventory`, `Add from library`, `Add custom item`, `Equipped`, `− [aria: Decrease quantity]`, `+ [aria: Increase quantity]`, `Unequip`
- **uk** (66): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Гра`, `Білд`, `Хроніка`, `Кидок костей`, `Звичайно`, `Перевага`, `Завада`, `Записати кидок`, `Не вимикати екран`, `8`, `-1`, `Кинути перевірку`, `Кинути рятівний кидок`, `15`, `+2`, `+4`, `12`, `+3`, `10`, `0`, `Кинути`, `+1`, `Володіння`, `КЛАС БРОНІ 12`, `ІНІЦІАТИВА +2`, `ШВИДКІСТЬ 30 walk`, `МАКСИМУМ 8`, `Шкода`, `Лікування`, `Додати тимчасові ОЗ`, `Короткий відпочинок`, `Тривалий відпочинок`, `Немає натхнення`, `Кинути атаку`, `1d6 -1`, `Кинути шкоду`, `СКЛАДНІСТЬ РЯТІВНОГО КИДКА 12`, `БОНУС АТАКИ ЗАКЛИНАННЯМ +4`, `Кинути атаку заклинанням`, ` [aria: Комірка 1 рівня 1 з 2]`, ` [aria: Комірка 1 рівня 2 з 2]`, `Скасувати підготовку`, `Підготувати`, `Накласти`, `Дії`, `Додати стан`, `Інвентар`, `Додати з бібліотеки`, `Додати свій предмет`, `Споряджено`, `− [aria: Зменшити кількість]`, `+ [aria: Збільшити кількість]`, `Зняти`, `Видалити предмет`, `Спорядити`

### sheet-play-dark

- **en** (67): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Undo level up`, `Play`, `Build`, `Timeline`, `Dice roller`, `Normal`, `Advantage`, `Disadvantage`, `Log roll`, `Keep screen awake`, `17`, `+5`, `Roll check`, `Roll save`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Roll`, `Proficient`, `+3`, `ARMOR CLASS 17`, `INITIATIVE +1`, `SPEED 30 walk`, `MAX 20`, `Damage`, `Heal`, `Add temp HP`, `Short rest`, `Long rest`, `Not inspired`, `Roll to hit`, `1d8 +3`, `Roll damage`, `0 / 2`, ` [aria: Second Wind use 1 of 2]`, ` [aria: Second Wind use 2 of 2]`, `Actions`, `Action Surge`, `Add condition`, `Deafened Remove condition`, `Remove condition`, `Proficiencies`, `Inventory`, `Add from library`, `Add custom item`, `Equipped`, `− [aria: Decrease quantity]`, `+ [aria: Increase quantity]`, `Unequip`, `Remove item`

### sheet-play-in-campaign

- **en** (68): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Shadows over Thornwall`, `Leave campaign`, `Export`, `Award`, `Play`, `Build`, `Timeline`, `Dice roller`, `Normal`, `Advantage`, `Disadvantage`, `Everyone`, `DM only`, `Private`, `Log roll`, `Keep screen awake`, `17`, `+5`, `Roll check`, `Roll save`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Roll`, `Proficient`, `+3`, `ARMOR CLASS 17`, `INITIATIVE +1`, `SPEED 30 walk`, `MAX 12`, `Damage`, `Heal`, `Add temp HP`, `Short rest`, `Long rest`, `Not inspired`, `Roll to hit`, `1d8 +3`, `Roll damage`, `0 / 2`, ` [aria: Second Wind use 1 of 2]`, ` [aria: Second Wind use 2 of 2]`, `Actions`, `Add condition`, `Proficiencies`, `Inventory`, `Add from library`, `Add custom item`, `Equipped`, `− [aria: Decrease quantity]`, `+ [aria: Increase quantity]`, `Unequip`, `Remove item`
- **uk** (67): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Shadows over Thornwall`, `Покинути кампанію`, `Експорт`, `Нарахувати`, `Гра`, `Білд`, `Хроніка`, `Кидок костей`, `Звичайно`, `Перевага`, `Завада`, `Усі`, `Лише Майстер`, `Приватно`, `Записати кидок`, `Не вимикати екран`, `17`, `+5`, `Кинути перевірку`, `Кинути рятівний кидок`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Кинути`, `Володіння`, `+3`, `КЛАС БРОНІ 17`, `ІНІЦІАТИВА +1`, `ШВИДКІСТЬ 30 walk`, `МАКСИМУМ 12`, `Шкода`, `Лікування`, `Додати тимчасові ОЗ`, `Короткий відпочинок`, `Тривалий відпочинок`, `Немає натхнення`, `Кинути атаку`, `1d8 +3`, `Кинути шкоду`, `0 / 2`, ` [aria: Second Wind, використання 1 з 2]`, ` [aria: Second Wind, використання 2 з 2]`, `Дії`, `Додати стан`, `Інвентар`, `Додати з бібліотеки`, `Додати свій предмет`, `Споряджено`, `− [aria: Зменшити кількість]`, `+ [aria: Збільшити кількість]`, `Зняти`, `Видалити предмет`

### sheet-play-l2

- **en** (68): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Undo level up`, `Play`, `Build`, `Timeline`, `Dice roller`, `Normal`, `Advantage`, `Disadvantage`, `Log roll`, `Clear log`, `Keep screen awake`, `17`, `+5`, `Roll check`, `Roll save`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Roll`, `Proficient`, `+3`, `ARMOR CLASS 17`, `INITIATIVE +1`, `SPEED 30 walk`, `MAX 20`, `Damage`, `Heal`, `Add temp HP`, `Short rest`, `Long rest`, `Not inspired`, `Roll to hit`, `1d8 +3`, `Roll damage`, `0 / 2`, ` [aria: Second Wind use 1 of 2]`, ` [aria: Second Wind use 2 of 2]`, `Actions`, `Action Surge`, `Add condition`, `Deafened Remove condition`, `Remove condition`, `Proficiencies`, `Inventory`, `Add from library`, `Add custom item`, `Equipped`, `− [aria: Decrease quantity]`, `+ [aria: Increase quantity]`, `Unequip`, `Remove item`
- **uk** (67): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Скасувати підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Кидок костей`, `Звичайно`, `Перевага`, `Завада`, `Записати кидок`, `Очистити журнал`, `Не вимикати екран`, `17`, `+5`, `Кинути перевірку`, `Кинути рятівний кидок`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Кинути`, `Володіння`, `+3`, `КЛАС БРОНІ 17`, `ІНІЦІАТИВА +1`, `ШВИДКІСТЬ 30 walk`, `МАКСИМУМ 20`, `Шкода`, `Лікування`, `Додати тимчасові ОЗ`, `Короткий відпочинок`, `Тривалий відпочинок`, `Немає натхнення`, `Кинути атаку`, `1d8 +3`, `Кинути шкоду`, `0 / 2`, ` [aria: Second Wind, використання 1 з 2]`, ` [aria: Second Wind, використання 2 з 2]`, `Дії`, `Action Surge`, `Додати стан`, `Deafened Прибрати стан`, `Прибрати стан`, `Інвентар`, `Додати з бібліотеки`, `Додати свій предмет`, `Споряджено`, `− [aria: Зменшити кількість]`, `+ [aria: Збільшити кількість]`, `Зняти`, `Видалити предмет`

### sheet-play-l3

- **uk** (66): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Скасувати підвищення рівня`, `Гра`, `Білд`, `Хроніка`, `Кидок костей`, `Звичайно`, `Перевага`, `Завада`, `Записати кидок`, `Не вимикати екран`, `17`, `+5`, `Кинути перевірку`, `Кинути рятівний кидок`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Кинути`, `Володіння`, `+3`, `КЛАС БРОНІ 17`, `ІНІЦІАТИВА +1`, `ШВИДКІСТЬ 30 walk`, `МАКСИМУМ 28`, `Шкода`, `Лікування`, `Додати тимчасові ОЗ`, `Короткий відпочинок`, `Тривалий відпочинок`, `Немає натхнення`, `Кинути атаку`, `1d8 +3`, `Кинути шкоду`, `0 / 2`, ` [aria: Second Wind, використання 1 з 2]`, ` [aria: Second Wind, використання 2 з 2]`, `Дії`, `Action Surge`, `Додати стан`, `Deafened Прибрати стан`, `Прибрати стан`, `Інвентар`, `Додати з бібліотеки`, `Додати свій предмет`, `Споряджено`, `− [aria: Зменшити кількість]`, `+ [aria: Збільшити кількість]`, `Зняти`, `Видалити предмет`

### sheet-play-roll

- **en** (65): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Play`, `Build`, `Timeline`, `Dice roller`, `Normal`, `Advantage`, `Disadvantage`, `Log roll`, `Clear log`, `Keep screen awake`, `17`, `+5`, `Roll check`, `Roll save`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Roll`, `Proficient`, `+3`, `ARMOR CLASS 17`, `INITIATIVE +1`, `SPEED 30 walk`, `MAX 12`, `Damage`, `Heal`, `Add temp HP`, `Short rest`, `Long rest`, `Not inspired`, `Roll to hit`, `1d8 +3`, `Roll damage`, `0 / 2`, ` [aria: Second Wind use 1 of 2]`, ` [aria: Second Wind use 2 of 2]`, `Actions`, `Add condition`, `Proficiencies`, `Inventory`, `Add from library`, `Add custom item`, `Equipped`, `− [aria: Decrease quantity]`, `+ [aria: Increase quantity]`, `Unequip`, `Remove item`, `Equip`
- **uk** (64): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Гра`, `Білд`, `Хроніка`, `Кидок костей`, `Звичайно`, `Перевага`, `Завада`, `Записати кидок`, `Очистити журнал`, `Не вимикати екран`, `17`, `+5`, `Кинути перевірку`, `Кинути рятівний кидок`, `13`, `+1`, `15`, `+4`, `10`, `0`, `12`, `8`, `-1`, `Кинути`, `Володіння`, `+3`, `КЛАС БРОНІ 17`, `ІНІЦІАТИВА +1`, `ШВИДКІСТЬ 30 walk`, `МАКСИМУМ 12`, `Шкода`, `Лікування`, `Додати тимчасові ОЗ`, `Короткий відпочинок`, `Тривалий відпочинок`, `Немає натхнення`, `Кинути атаку`, `1d8 +3`, `Кинути шкоду`, `0 / 2`, ` [aria: Second Wind, використання 1 з 2]`, ` [aria: Second Wind, використання 2 з 2]`, `Дії`, `Додати стан`, `Інвентар`, `Додати з бібліотеки`, `Додати свій предмет`, `Споряджено`, `− [aria: Зменшити кількість]`, `+ [aria: Збільшити кількість]`, `Зняти`, `Видалити предмет`, `Спорядити`

### sheet-timeline

- **en** (22): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Export`, `Award`, `Play`, `Build`, `Timeline`, `Identity`, `Decisions`, `Leveling`, `Combat`, `Items`, `Other`, `Revert`, `+`
- **uk** (22): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Експорт`, `Нарахувати`, `Гра`, `Білд`, `Хроніка`, `Особистість`, `Рішення`, `Рівні`, `Бій`, `Предмети`, `Інше`, `Скасувати`, `+`

### wizard-caster-s09-spells

- **en** (63): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Spells`, `Equipment`, `Review`, ` [aria: Clear search]`, `Acid Splash`, `Show description`, `Chill Touch`, `Dancing Lights`, `Elementalism`, `Fire Bolt`, `Light`, `Mage Hand`, `Mending`, `Message`, `Minor Illusion`, `Poison Spray`, `Prestidigitation`, `Ray of Frost`, `Shocking Grasp`, `True Strike`, `Alarm`, `Burning Hands`, `Charm Person`, `Chromatic Orb`, `Color Spray`, `Comprehend Languages`, `Detect Magic`, `Disguise Self`, `Expeditious Retreat`, `False Life`, `Feather Fall`, `Find Familiar`, `Floating Disk`, `Fog Cloud`, `Grease`, `Hideous Laughter`, `Ice Knife`, `Identify`, `Illusory Script`, `Jump`, `Longstrider`, `Mage Armor`, `Magic Missile`, `Protection from Evil and Good`, `Ray of Sickness`, `Shield`, `Silent Image`, `Sleep`, `Thunderwave`, `Unseen Servant`, `Continue`, `Back`, `Next`
- **uk** (62): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Заклинання`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Acid Splash`, `Показати опис`, `Chill Touch`, `Dancing Lights`, `Elementalism`, `Fire Bolt`, `Light`, `Mage Hand`, `Mending`, `Message`, `Minor Illusion`, `Poison Spray`, `Prestidigitation`, `Ray of Frost`, `Shocking Grasp`, `True Strike`, `Alarm`, `Burning Hands`, `Charm Person`, `Chromatic Orb`, `Color Spray`, `Comprehend Languages`, `Detect Magic`, `Disguise Self`, `Expeditious Retreat`, `False Life`, `Feather Fall`, `Find Familiar`, `Floating Disk`, `Fog Cloud`, `Grease`, `Hideous Laughter`, `Ice Knife`, `Identify`, `Illusory Script`, `Jump`, `Longstrider`, `Mage Armor`, `Magic Missile`, `Protection from Evil and Good`, `Ray of Sickness`, `Shield`, `Silent Image`, `Sleep`, `Thunderwave`, `Unseen Servant`, `Далі`, `Назад`

### wizard-caster-s09-spells-filled

- **en** (63): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Spells`, `Equipment`, `Review`, ` [aria: Clear search]`, `Acid Splash`, `Show description`, `Chill Touch`, `Dancing Lights`, `Elementalism`, `Fire Bolt`, `Light`, `Mage Hand`, `Mending`, `Message`, `Minor Illusion`, `Poison Spray`, `Prestidigitation`, `Ray of Frost`, `Shocking Grasp`, `True Strike`, `Alarm`, `Burning Hands`, `Charm Person`, `Chromatic Orb`, `Color Spray`, `Comprehend Languages`, `Detect Magic`, `Disguise Self`, `Expeditious Retreat`, `False Life`, `Feather Fall`, `Find Familiar`, `Floating Disk`, `Fog Cloud`, `Grease`, `Hideous Laughter`, `Ice Knife`, `Identify`, `Illusory Script`, `Jump`, `Longstrider`, `Mage Armor`, `Magic Missile`, `Protection from Evil and Good`, `Ray of Sickness`, `Shield`, `Silent Image`, `Sleep`, `Thunderwave`, `Unseen Servant`, `Continue`, `Back`, `Next`
- **uk** (62): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Заклинання`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Acid Splash`, `Показати опис`, `Chill Touch`, `Dancing Lights`, `Elementalism`, `Fire Bolt`, `Light`, `Mage Hand`, `Mending`, `Message`, `Minor Illusion`, `Poison Spray`, `Prestidigitation`, `Ray of Frost`, `Shocking Grasp`, `True Strike`, `Alarm`, `Burning Hands`, `Charm Person`, `Chromatic Orb`, `Color Spray`, `Comprehend Languages`, `Detect Magic`, `Disguise Self`, `Expeditious Retreat`, `False Life`, `Feather Fall`, `Find Familiar`, `Floating Disk`, `Fog Cloud`, `Grease`, `Hideous Laughter`, `Ice Knife`, `Identify`, `Illusory Script`, `Jump`, `Longstrider`, `Mage Armor`, `Magic Missile`, `Protection from Evil and Good`, `Ray of Sickness`, `Shield`, `Silent Image`, `Sleep`, `Thunderwave`, `Unseen Servant`, `Далі`, `Назад`

### wizard-caster-s11-review

- **en** (15): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Spells`, `Equipment`, `Review`, `Create character`, `Back`
- **uk** (15): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Заклинання`, `Спорядження`, `Огляд`, `Створити персонажа`, `Назад`

### wizard-fighter-s01-name

- **en** (18): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Species`, `Background`, `Class`, `Ability scores`, `Equipment`, `Review`, `Back`, `Next`
- **uk** (18): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Раса`, `Передісторія`, `Клас`, `Характеристики`, `Спорядження`, `Огляд`, `Назад`, `Далі`

### wizard-fighter-s01-name-empty

- **en** (13): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Review`, `Back`, `Next`
- **uk** (13): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Огляд`, `Назад`, `Далі`

### wizard-fighter-s02-species

- **en** (29): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Species`, `Background`, `Class`, `Ability scores`, `Equipment`, `Review`, ` [aria: Clear search]`, `Dragonborn`, `Show description`, `Dwarf`, `Elf`, `Gnome`, `Goliath`, `Halfling`, `Human`, `Orc`, `Tiefling`, `Back`, `Next`
- **uk** (29): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Раса`, `Передісторія`, `Клас`, `Характеристики`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Dragonborn`, `Показати опис`, `Dwarf`, `Elf`, `Gnome`, `Goliath`, `Halfling`, `Human`, `Orc`, `Tiefling`, `Назад`, `Далі`

### wizard-fighter-s02-species-expanded

- **en** (30): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Species`, `Background`, `Class`, `Ability scores`, `Equipment`, `Review`, ` [aria: Clear search]`, `Dragonborn`, `Hide description`, `Dwarf`, `Show description`, `Elf`, `Gnome`, `Goliath`, `Halfling`, `Human`, `Orc`, `Tiefling`, `Back`, `Next`
- **uk** (30): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Раса`, `Передісторія`, `Клас`, `Характеристики`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Dragonborn`, `Сховати опис`, `Dwarf`, `Показати опис`, `Elf`, `Gnome`, `Goliath`, `Halfling`, `Human`, `Orc`, `Tiefling`, `Назад`, `Далі`

### wizard-fighter-s03-background

- **en** (23): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Background`, `Class`, `Ability scores`, `Equipment`, `Review`, ` [aria: Clear search]`, `Acolyte`, `Show description`, `Criminal`, `Sage`, `Soldier`, `Back`, `Next`
- **uk** (23): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Передісторія`, `Клас`, `Характеристики`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Acolyte`, `Показати опис`, `Criminal`, `Sage`, `Soldier`, `Назад`, `Далі`

### wizard-fighter-s04-improve

- **en** (21): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Background abilities`, `Class`, `Ability scores`, `Choice`, `Equipment`, `Review`, `Strength`, `Dexterity`, `Constitution`, `Back`, `Next`
- **uk** (21): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Бонуси передісторії`, `Клас`, `Характеристики`, `Вибір`, `Спорядження`, `Огляд`, `Strength`, `Dexterity`, `Constitution`, `Назад`, `Далі`

### wizard-fighter-s05-class

- **en** (31): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Class`, `Ability scores`, `Choice`, `Equipment`, `Review`, ` [aria: Clear search]`, `Barbarian`, `Show description`, `Bard`, `Cleric`, `Druid`, `Fighter`, `Monk`, `Paladin`, `Ranger`, `Rogue`, `Sorcerer`, `Warlock`, `Wizard`, `Back`, `Next`
- **uk** (31): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Клас`, `Характеристики`, `Вибір`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Barbarian`, `Показати опис`, `Bard`, `Cleric`, `Druid`, `Fighter`, `Monk`, `Paladin`, `Ranger`, `Rogue`, `Sorcerer`, `Warlock`, `Wizard`, `Назад`, `Далі`

### wizard-fighter-s06-abilities-filled

- **en** (25): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Skills`, `Choice`, `Equipment`, `Review`, `Acrobatics`, `Animal Handling`, `Athletics`, `History`, `Insight`, `Intimidation`, `Persuasion`, `Perception`, `Survival`, `Back`, `Next`
- **uk** (25): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Навички`, `Вибір`, `Спорядження`, `Огляд`, `Acrobatics`, `Animal Handling`, `Athletics`, `History`, `Insight`, `Intimidation`, `Persuasion`, `Perception`, `Survival`, `Назад`, `Далі`

### wizard-fighter-s06-abilities-m1

- **en** (21): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Ability scores`, `Skills`, `Choice`, `Equipment`, `Review`, `Standard array`, `Point buy`, `Manual`, `Roll`, `Back`, `Next`
- **uk** (21): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Характеристики`, `Навички`, `Вибір`, `Спорядження`, `Огляд`, `Стандартний масив`, `Купівля очок`, `Вручну`, `Кидок`, `Назад`, `Далі`

### wizard-fighter-s06-abilities-m2

- **en** (21): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Ability scores`, `Skills`, `Choice`, `Equipment`, `Review`, `Standard array`, `Point buy`, `Manual`, `Roll`, `Back`, `Next`
- **uk** (21): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Характеристики`, `Навички`, `Вибір`, `Спорядження`, `Огляд`, `Стандартний масив`, `Купівля очок`, `Вручну`, `Кидок`, `Назад`, `Далі`

### wizard-fighter-s06-abilities-m3

- **en** (21): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Ability scores`, `Skills`, `Choice`, `Equipment`, `Review`, `Standard array`, `Point buy`, `Manual`, `Roll`, `Back`, `Next`
- **uk** (21): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Характеристики`, `Навички`, `Вибір`, `Спорядження`, `Огляд`, `Стандартний масив`, `Купівля очок`, `Вручну`, `Кидок`, `Назад`, `Далі`

### wizard-fighter-s06-abilities-m4

- **en** (22): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Ability scores`, `Skills`, `Choice`, `Equipment`, `Review`, `Standard array`, `Point buy`, `Manual`, `Roll`, `Roll all six`, `Back`, `Next`
- **uk** (22): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Характеристики`, `Навички`, `Вибір`, `Спорядження`, `Огляд`, `Стандартний масив`, `Купівля очок`, `Вручну`, `Кидок`, `Кинути всі шість`, `Назад`, `Далі`

### wizard-fighter-s07-choose-2-skills-for-fighter

- **en** (25): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Skills`, `Choice`, `Equipment`, `Review`, `Acrobatics`, `Animal Handling`, `Athletics`, `History`, `Insight`, `Intimidation`, `Persuasion`, `Perception`, `Survival`, `Back`, `Next`
- **uk** (25): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Навички`, `Вибір`, `Спорядження`, `Огляд`, `Acrobatics`, `Animal Handling`, `Athletics`, `History`, `Insight`, `Intimidation`, `Persuasion`, `Perception`, `Survival`, `Назад`, `Далі`

### wizard-fighter-s08-tool-proficiency-choose-one-

- **en** (21): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Choice`, `Equipment`, `Review`, ` [aria: Clear search]`, `Gaming Set, Dice`, `Show description`, `Gaming Set, Dragonchess`, `Gaming Set, Playing Cards`, `Gaming Set, Three-Dragon Ante`, `Back`, `Next`
- **uk** (21): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Вибір`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Gaming Set, Dice`, `Показати опис`, `Gaming Set, Dragonchess`, `Gaming Set, Playing Cards`, `Gaming Set, Three-Dragon Ante`, `Назад`, `Далі`

### wizard-fighter-s09-fighting-style

- **en** (21): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Choice`, `Equipment`, `Review`, ` [aria: Clear search]`, `Archery`, `Show description`, `Defense`, `Great Weapon Fighting`, `Two-Weapon Fighting`, `Back`, `Next`
- **uk** (21): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Вибір`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Archery`, `Показати опис`, `Defense`, `Great Weapon Fighting`, `Two-Weapon Fighting`, `Назад`, `Далі`

### wizard-fighter-s10-weapon-masteries

- **en** (55): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Choice`, `Equipment`, `Review`, ` [aria: Clear search]`, `Battleaxe`, `Show description`, `Blowgun`, `Club`, `Dagger`, `Dart`, `Flail`, `Glaive`, `Greataxe`, `Greatclub`, `Greatsword`, `Halberd`, `Hand Crossbow`, `Handaxe`, `Heavy Crossbow`, `Javelin`, `Lance`, `Light Crossbow`, `Light Hammer`, `Longbow`, `Longsword`, `Mace`, `Maul`, `Morningstar`, `Musket`, `Pike`, `Pistol`, `Quarterstaff`, `Rapier`, `Scimitar`, `Shortbow`, `Shortsword`, `Sickle`, `Sling`, `Spear`, `Trident`, `War Pick`, `Warhammer`, `Whip`, `Back`, `Next`
- **uk** (55): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Вибір`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Battleaxe`, `Показати опис`, `Blowgun`, `Club`, `Dagger`, `Dart`, `Flail`, `Glaive`, `Greataxe`, `Greatclub`, `Greatsword`, `Halberd`, `Hand Crossbow`, `Handaxe`, `Heavy Crossbow`, `Javelin`, `Lance`, `Light Crossbow`, `Light Hammer`, `Longbow`, `Longsword`, `Mace`, `Maul`, `Morningstar`, `Musket`, `Pike`, `Pistol`, `Quarterstaff`, `Rapier`, `Scimitar`, `Shortbow`, `Shortsword`, `Sickle`, `Sling`, `Spear`, `Trident`, `War Pick`, `Warhammer`, `Whip`, `Назад`, `Далі`

### wizard-fighter-s11-equipment

- **en** (68): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Equipment`, `Review`, ` [aria: Clear search]`, `Acid`, `Show description`, `Adamantine Armor (Breastplate)`, `Adamantine Armor (Chain Mail)`, `Adamantine Armor (Chain Shirt)`, `Adamantine Armor (Half Plate)`, `Adamantine Armor (Plate)`, `Adamantine Armor (Ring Mail)`, `Adamantine Armor (Scale Mail)`, `Adamantine Armor (Splint)`, `Airship`, `Alchemist's Fire`, `Alchemist's Supplies (50 GP)`, `Ammunition (+1)`, `Ammunition (+2)`, `Ammunition (+3)`, `Ammunition of Aberration Slaying`, `Ammunition of Beast Slaying`, `Ammunition of Celestial Slaying`, `Ammunition of Construct Slaying`, `Ammunition of Dragon Slaying`, `Ammunition of Elemental Slaying`, `Ammunition of Fey Slaying`, `Ammunition of Fiend Slaying`, `Ammunition of Giant Slaying`, `Ammunition of Humanoid Slaying`, `Ammunition of Monstrosity Slaying`, `Ammunition of Ooze Slaying`, `Ammunition of Plant Slaying`, `Ammunition of Undead Slaying`, `Amulet of Health`, `Amulet of Proof against Detection and Location`, `Amulet of the Planes`, `Animated Shield`, `Antitoxin`, `Apparatus of the Crab`, `Armor of Invulnerability`, `Armor of Resistance (Breastplate)`, `Armor of Resistance (Chain Mail)`, `Armor of Resistance (Chain Shirt)`, `Armor of Resistance (Half Plate)`, `Armor of Resistance (Hide Armor)`, `Armor of Resistance (Leather Armor)`, `Armor of Resistance (Padded)`, `Armor of Resistance (Plate)`, `Armor of Resistance (Ring Mail)`, `Armor of Resistance (Scale Mail)`, `Armor of Resistance (Splint)`, `Armor of Resistance (Studded Leather)`, `Armor of Vulnerability (Breastplate)`, `Armor of Vulnerability (Chain Mail)`, `Armor of Vulnerability (Chain Shirt)`, `Armor of Vulnerability (Half Plate Armor)`, `Armor of Vulnerability (Hide Armor)`, `Armor of Vulnerability (Leather Armor)`
- **uk** (68): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Acid`, `Показати опис`, `Adamantine Armor (Breastplate)`, `Adamantine Armor (Chain Mail)`, `Adamantine Armor (Chain Shirt)`, `Adamantine Armor (Half Plate)`, `Adamantine Armor (Plate)`, `Adamantine Armor (Ring Mail)`, `Adamantine Armor (Scale Mail)`, `Adamantine Armor (Splint)`, `Airship`, `Alchemist's Fire`, `Alchemist's Supplies (50 GP)`, `Ammunition (+1)`, `Ammunition (+2)`, `Ammunition (+3)`, `Ammunition of Aberration Slaying`, `Ammunition of Beast Slaying`, `Ammunition of Celestial Slaying`, `Ammunition of Construct Slaying`, `Ammunition of Dragon Slaying`, `Ammunition of Elemental Slaying`, `Ammunition of Fey Slaying`, `Ammunition of Fiend Slaying`, `Ammunition of Giant Slaying`, `Ammunition of Humanoid Slaying`, `Ammunition of Monstrosity Slaying`, `Ammunition of Ooze Slaying`, `Ammunition of Plant Slaying`, `Ammunition of Undead Slaying`, `Amulet of Health`, `Amulet of Proof against Detection and Location`, `Amulet of the Planes`, `Animated Shield`, `Antitoxin`, `Apparatus of the Crab`, `Armor of Invulnerability`, `Armor of Resistance (Breastplate)`, `Armor of Resistance (Chain Mail)`, `Armor of Resistance (Chain Shirt)`, `Armor of Resistance (Half Plate)`, `Armor of Resistance (Hide Armor)`, `Armor of Resistance (Leather Armor)`, `Armor of Resistance (Padded)`, `Armor of Resistance (Plate)`, `Armor of Resistance (Ring Mail)`, `Armor of Resistance (Scale Mail)`, `Armor of Resistance (Splint)`, `Armor of Resistance (Studded Leather)`, `Armor of Vulnerability (Breastplate)`, `Armor of Vulnerability (Chain Mail)`, `Armor of Vulnerability (Chain Shirt)`, `Armor of Vulnerability (Half Plate Armor)`, `Armor of Vulnerability (Hide Armor)`, `Armor of Vulnerability (Leather Armor)`

### wizard-fighter-s11-equipment-filled

- **en** (68): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Equipment`, `Review`, ` [aria: Clear search]`, `Acid`, `Show description`, `Adamantine Armor (Breastplate)`, `Adamantine Armor (Chain Mail)`, `Adamantine Armor (Chain Shirt)`, `Adamantine Armor (Half Plate)`, `Adamantine Armor (Plate)`, `Adamantine Armor (Ring Mail)`, `Adamantine Armor (Scale Mail)`, `Adamantine Armor (Splint)`, `Airship`, `Alchemist's Fire`, `Alchemist's Supplies (50 GP)`, `Ammunition (+1)`, `Ammunition (+2)`, `Ammunition (+3)`, `Ammunition of Aberration Slaying`, `Ammunition of Beast Slaying`, `Ammunition of Celestial Slaying`, `Ammunition of Construct Slaying`, `Ammunition of Dragon Slaying`, `Ammunition of Elemental Slaying`, `Ammunition of Fey Slaying`, `Ammunition of Fiend Slaying`, `Ammunition of Giant Slaying`, `Ammunition of Humanoid Slaying`, `Ammunition of Monstrosity Slaying`, `Ammunition of Ooze Slaying`, `Ammunition of Plant Slaying`, `Ammunition of Undead Slaying`, `Amulet of Health`, `Amulet of Proof against Detection and Location`, `Amulet of the Planes`, `Animated Shield`, `Antitoxin`, `Apparatus of the Crab`, `Armor of Invulnerability`, `Armor of Resistance (Breastplate)`, `Armor of Resistance (Chain Mail)`, `Armor of Resistance (Chain Shirt)`, `Armor of Resistance (Half Plate)`, `Armor of Resistance (Hide Armor)`, `Armor of Resistance (Leather Armor)`, `Armor of Resistance (Padded)`, `Armor of Resistance (Plate)`, `Armor of Resistance (Ring Mail)`, `Armor of Resistance (Scale Mail)`, `Armor of Resistance (Splint)`, `Armor of Resistance (Studded Leather)`, `Armor of Vulnerability (Breastplate)`, `Armor of Vulnerability (Chain Mail)`, `Armor of Vulnerability (Chain Shirt)`, `Armor of Vulnerability (Half Plate Armor)`, `Armor of Vulnerability (Hide Armor)`, `Armor of Vulnerability (Leather Armor)`
- **uk** (68): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Спорядження`, `Огляд`, ` [aria: Очистити пошук]`, `Acid`, `Показати опис`, `Adamantine Armor (Breastplate)`, `Adamantine Armor (Chain Mail)`, `Adamantine Armor (Chain Shirt)`, `Adamantine Armor (Half Plate)`, `Adamantine Armor (Plate)`, `Adamantine Armor (Ring Mail)`, `Adamantine Armor (Scale Mail)`, `Adamantine Armor (Splint)`, `Airship`, `Alchemist's Fire`, `Alchemist's Supplies (50 GP)`, `Ammunition (+1)`, `Ammunition (+2)`, `Ammunition (+3)`, `Ammunition of Aberration Slaying`, `Ammunition of Beast Slaying`, `Ammunition of Celestial Slaying`, `Ammunition of Construct Slaying`, `Ammunition of Dragon Slaying`, `Ammunition of Elemental Slaying`, `Ammunition of Fey Slaying`, `Ammunition of Fiend Slaying`, `Ammunition of Giant Slaying`, `Ammunition of Humanoid Slaying`, `Ammunition of Monstrosity Slaying`, `Ammunition of Ooze Slaying`, `Ammunition of Plant Slaying`, `Ammunition of Undead Slaying`, `Amulet of Health`, `Amulet of Proof against Detection and Location`, `Amulet of the Planes`, `Animated Shield`, `Antitoxin`, `Apparatus of the Crab`, `Armor of Invulnerability`, `Armor of Resistance (Breastplate)`, `Armor of Resistance (Chain Mail)`, `Armor of Resistance (Chain Shirt)`, `Armor of Resistance (Half Plate)`, `Armor of Resistance (Hide Armor)`, `Armor of Resistance (Leather Armor)`, `Armor of Resistance (Padded)`, `Armor of Resistance (Plate)`, `Armor of Resistance (Ring Mail)`, `Armor of Resistance (Scale Mail)`, `Armor of Resistance (Splint)`, `Armor of Resistance (Studded Leather)`, `Armor of Vulnerability (Breastplate)`, `Armor of Vulnerability (Chain Mail)`, `Armor of Vulnerability (Chain Shirt)`, `Armor of Vulnerability (Half Plate Armor)`, `Armor of Vulnerability (Hide Armor)`, `Armor of Vulnerability (Leather Armor)`

### wizard-fighter-s12-review

- **en** (14): `Log out`, ` [aria: Toggle theme]`, `Home`, `Characters`, `Campaigns`, `Library`, `Packs`, `Settings`, `About`, `Name`, `Equipment`, `Review`, `Create character`, `Back`
- **uk** (14): `Вийти`, ` [aria: Перемкнути тему]`, `Головна`, `Персонажі`, `Кампанії`, `Бібліотека`, `Пакети`, `Налаштування`, `Про застосунок`, `Ім'я`, `Спорядження`, `Огляд`, `Створити персонажа`, `Назад`

