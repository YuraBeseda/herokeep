# hk-stepper

Element selector `hk-stepper`. The linear wizard frame: an `<ol>` of step buttons (no
`role="tablist"` — deliberately a plain ordered-list nav, not the ARIA tabs pattern), a
default-projected body for the active step's content, and a named footer slot the wizard
owns for its back/next buttons.

## Usage

```html
<hk-stepper [steps]="steps()" [activeId]="activeId()" (stepSelected)="goTo($event)">
  @switch (activeId()) { @case ('species') {
  <app-species-step />
  } @case ('review') {
  <app-review-step />
  } }

  <div hk-stepper-footer>
    <button hk-button variant="ghost" (click)="back()">{{ t('actions.back') }}</button>
    <button hk-button [disabled]="!canAdvance()" (click)="next()">{{ t('actions.next') }}</button>
  </div>
</hk-stepper>
```

```ts
readonly steps = signal<HkStepperStep[]>([
  { id: 'name', labelKey: 'wizard.steps.name', state: 'done' },
  { id: 'species', labelKey: 'wizard.steps.species', state: 'current' },
  { id: 'review', labelKey: 'wizard.steps.review', state: 'todo' },
]);
readonly activeId = signal('species');
```

## Inputs / Outputs

| I/O            | Type               | Notes                                                                         |
| -------------- | ------------------ | ----------------------------------------------------------------------------- |
| `steps`        | `HkStepperStep[]`  | Required. `{ id, labelKey, state }`; `labelKey` is a full Transloco key.      |
| `activeId`     | `string`           | Required. The wizard's current step id — the stepper never derives it itself. |
| `stepSelected` | `output<string>()` | Emits a step `id` when a clickable step button is pressed.                    |

No model — `activeId` is one-way; the wizard updates it in response to `stepSelected`
(or its own back/next logic) and passes the new value back down.

## Content projection

- Default slot: the active step's body. The stepper renders whatever the consumer
  projects — it has no per-step template switching of its own.
- `[hk-stepper-footer]`: back/next (or any) buttons, owned entirely by the wizard.

## Click-gating and ARIA

- `state: 'done' | 'current' | 'blocked'` steps are clickable; `'todo'` renders `[disabled]`
  and never emits `stepSelected`, even if a caller invokes the click handler directly.
  `'blocked'` means "has a decision, but it's currently invalid" (not "unreachable") — it's
  clickable specifically so the consumer can let the user revisit and fix it.
- The button whose `id` equals `activeId` gets `aria-current="step"`; no other step does.

## Do / Don't

Do keep `state` and `activeId` in sync yourself (the wizard's job) — the stepper doesn't
infer "current" from `activeId`, it only uses `activeId` for `aria-current` and reads
`state` for click-gating and styling. Don't expect the stepper to render step bodies by
`id` — that switching lives in the consumer's projected content.
