# 44. Partly-public widgets still hand-roll their sign-in panel

**Depends on:** nothing.
**Risk:** low; this is consolidation. These widgets can drift from the legacy/dual behaviour
that `renderSignInRequired()` gets right: no button in `legacy`, a passive `loginRequired`,
no Try Again.
**Size:** S–M, one widget at a time.

Filed 2026-10-11 from the comparison-remediation epic's open follow-ups (optional).

## Where

`packages/embed-sdk/src/components/`: `custom-form.ts`, `opportunity-details.ts`,
`event-details.ts`, `plan-your-visit.ts`, `pledge-campaign.ts`. Each is public until an action
needs a signed-in user, and each renders its own sign-in prompt.

## Do

Move each onto `this.isNeedsAuth()` + `this.renderSignInRequired()` (`shared/base-widget.ts`;
snippet in `.claude/references/widget-building-blocks.md` §1.1). Leave each widget's public
paths untouched. Do not bind `[data-action="login"]` yourself.

## Done when

None of the five renders its own sign-in markup, their tests cover both `legacy` and `dual`,
and `e2e/widget/auth-only-widgets-signed-out.spec.ts` still passes.
