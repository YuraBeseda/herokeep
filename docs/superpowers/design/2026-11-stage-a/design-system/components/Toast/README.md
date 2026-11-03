# Toast

A small parchment slip that drops in at the bottom-right (above the action strap) for a few seconds: roll results, saves and syncs, and errors with a Retry action; errors stay until dismissed.

## Anatomy

`hk-toast` (360px, padding 10px 12px, `radius-leaf`, `shadow-tooltip` + a warm drop): a 20px glyph (`accent-strong`; `success-strong` on `hk-toast--success`; `danger-strong` on `hk-toast--error`, whose body is `danger-soft`), `hk-toast__body` with the message (15px) and `hk-toast__sub` (italic `text-2` detail such as the dice breakdown), then an optional dismiss `IconButton` or a parchment action button. Stack newest at the bottom, at most three.

## States

Info (auto-dismiss after 4s, pauses on hover), success (3s), error (`role="alert"`, persistent, with Retry). Reduced motion: fade only.

## Accessibility

`role="status"` for info and success, `role="alert"` for errors; never the only place a roll result lives (the roll log drawer keeps it). Ink 11.6:1; `danger-strong` on `danger-soft` 5.6:1.

## Tokens

`leaf-glow`, `leaf`, `text-1`, `text-2`, `accent-strong`, `success-strong`, `danger-soft`, `danger-border`, `danger-strong`, `shadow-tooltip`, `radius-leaf`, `duration-base`.
