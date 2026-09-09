# C31. `next-my-pledges` hides the Cancel Pledge button by default; legacy shows it by default

**Widget:** `next-my-pledges` (old: My Pledges)
**Severity:** functional
**Confidence:** confirmed — read the default out of both implementations and observed both rendered states in the browser against the same two MP pledges.
**Found:** 2026-09-08, comparison run

## Old behaviour

`https://mpi.ministryplatform.com/widgets/dist/MyPledges.js`, `loadAttributes`:

```js
this.hideCancelButton = this.getAttribute("hidecancelbuttonpledge") || !1
```

Attribute absent → `hideCancelButton === false` → **the Cancel Pledge control renders**
on every Active pledge. (The vendor's own configurator metadata claims
*"Determines whether the option to cancel an active Pledge is displayed (Default:
true)"*, which contradicts the shipped code; the code is what runs.)

Confirmed live: `my_pledges.aspx` (which does set `hidecancelbuttonpledge="false"`
explicitly) shows *"Active | ZZTEST-Giving-Compare | … | Cancel Pledge"* as an
`<a class="mppw-btn primary buildDetailsButton">`.

## New behaviour

`packages/embed-sdk/src/components/my-pledges.ts:37-39`:

```ts
private get hideCancelButton(): boolean {
  return (this.getAttribute("hidecancelbuttonpledge") || "true").toLowerCase() !== "false";
}
```

Attribute absent → `"true"` → `hideCancelButton === true` → **no Cancel control at all**.
`demo-my-pledges.html` sets no attributes, and the widget rendered two Active pledges
with `[data-action="request-cancel"]` count **0**. Adding
`hidecancelbuttonpledge="false"` at element-creation time makes the button appear and
the whole flow then works (cancel → `Pledge_Status_ID` 3, confirmation email queued —
see the test log).

## Why it matters

A church that pastes `<next-my-pledges></next-my-pledges>` onto its page — the shape of
the copy-paste snippet the SDK advertises — gets a read-only pledge list where the
legacy widget gave donors a self-service cancel. The capability ships, fully working,
and is switched off by a default nobody will think to override, because on the legacy
widget the same omission switched it *on*. Every migrated site silently loses the
feature and the support burden lands on the church office.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-pledges-new-default-nocancel.png`
  (no cancel control, two Active pledges) vs
  `my-pledges-new-cancel-enabled.png` (same data, attribute set) vs
  `my-pledges-old-authed.png` (legacy, cancel present)
- Legacy source: `curl https://mpi.ministryplatform.com/widgets/dist/MyPledges.js`,
  search `hidecancelbuttonpledge`
- MP verification: `Pledges` 40 and 41 (`Pledge_Campaign_ID = 6`, `Pledge_Status_ID = 1`)
  were Active in both widgets at the time of the screenshots
- Script: `.claude/playwright/widget/scripts/giving/pledges-deep.mjs`

## Where to fix

`packages/embed-sdk/src/components/my-pledges.ts:37-39`

## Suggested fix

Invert the default to match legacy: treat the attribute as hide-only-when-explicitly-true,
i.e. `return (this.getAttribute("hidecancelbuttonpledge") || "false").toLowerCase() === "true";`.
If the intent really was to make cancel opt-in (defensible — it is a destructive action),
then say so in the demo page and the customer snippet and set
`hidecancelbuttonpledge="false"` in `demo-my-pledges.html` so the flow is at least
reachable and testable; but note that legacy sites will still regress on migration.
Same call applies to whether `cancelpledgeemailtemplate` should be required when cancel
is enabled — legacy's metadata says *"If Hide Cancel Button = false, this value must be
configured"*, and ours silently cancels with no email when it is unset.
