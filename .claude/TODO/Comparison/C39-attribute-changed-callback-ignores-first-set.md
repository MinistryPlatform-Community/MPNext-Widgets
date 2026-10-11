# C39. Setting a configuration attribute from script after upgrade is silently ignored — `attributeChangedCallback` skips the first change

**Widget:** `next-my-pledges`, `next-my-giving` (old: My Pledges, My Giving)
**Severity:** functional
**Confidence:** confirmed — set `hidecancelbuttonpledge="false"` on a live `next-my-pledges` and observed no re-render, then got the expected render by replacing the element instead.
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-my-pledges` (and its siblings) reload unconditionally on any observed attribute
change — no comparison against the old value:

```js
{ key: "attributeChangedCallback", value: function () {
    this._$resultsContainer && (this.loadAttributes(), this.GetMyPledges())
} }
```

So a host page or CMS that stamps attributes onto the tag after it is in the document
gets the reconfigured widget.

## New behaviour

Both widgets guard on `oldValue !== null`:

```ts
// my-pledges.ts:57-61  (identical shape in my-giving.ts:63-67)
attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null) {
  if (oldValue !== null && oldValue !== newValue) {
    this.loadPledges();
  }
}
```

For an attribute that was *absent* at upgrade time, the first `setAttribute` arrives with
`oldValue === null`, so the branch is skipped and nothing re-renders. Measured:

1. `demo-my-pledges.html` loads `<next-my-pledges>` with no config → 2 Active pledges, 0
   cancel controls (expected, per `C31`).
2. `el.setAttribute("hidecancelbuttonpledge", "false")` +
   `el.setAttribute("cancelpledgeemailtemplate", "65")`, wait 2.5 s → still **0** cancel
   controls. The getter would return the right value; `render()` is simply never called
   again.
3. Removing the element and appending a fresh `next-my-pledges` carrying the same two
   attributes → cancel controls appear and the whole cancel flow works.

`next-my-giving` carries the same guard for `hidesoftcredits`, so it has the same
behaviour by construction (not separately exercised — the observable effect there is
smaller, since the soft-credit toggle only appears when the data contains a soft credit).

## Why it matters

Two concrete ways a customer hits this. First, any host that renders the tag from
JavaScript in two steps — create, insert, then configure — which is what a WordPress
block, a Squarespace code injection, or any framework that treats attributes as reactive
props will naturally do; the widget then runs on its defaults forever with no error.
Second, it makes the widgets untestable and undemoable from the console: reconfiguring a
mounted widget is the obvious thing to try, and it looks like the attribute does not
exist. Legacy reconfigures happily, so this is a regression, and it interacts badly with
`C31` — the one attribute a migrating site most needs to set is also the one that cannot
be set late.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-pledges-new-default-nocancel.png`
  (after the two `setAttribute` calls — unchanged) and
  `my-pledges-new-cancel-enabled.png` (after element replacement, same MP data)
- Console output from the run:
  `DEFAULT cancel buttons visible: 0` → `after setAttribute only, cancel buttons: 0` →
  (element replaced) → cancel confirm/flow proceeds
- Legacy source: `curl https://mpi.ministryplatform.com/widgets/dist/MyPledges.js`,
  search `attributeChangedCallback`
- Script: `.claude/playwright/widget/scripts/giving/pledges-deep.mjs`

## Where to fix

- `packages/embed-sdk/src/components/my-pledges.ts:57-61`
- `packages/embed-sdk/src/components/my-giving.ts:63-67`

Worth a grep for the same guard across `packages/embed-sdk/src/components/` before
fixing — `next-pledge-campaign` uses a different shape
(`if (oldValue === newValue) return; if (name === "campaign-id" && this.campaign) this.init();`)
which has its own version of the problem: it re-inits only when a campaign is already
loaded, so setting `campaign-id` on a widget that failed its first load does nothing.

## Suggested fix

Drop the `oldValue !== null` half of the condition — `if (oldValue !== newValue)` is the
correct guard and already covers the no-op case. Guarding instead on "am I connected and
rendered yet" is the thing the null check was presumably reaching for; if that is needed,
use an explicit `this.hasRendered` flag set at the end of `connectedCallback` rather than
inferring it from `oldValue`. Do the same normalisation in
`pledge-campaign.ts` so `campaign-id` re-inits regardless of prior load state.

## Scope note (main thread, 2026-09-08)

The `oldValue !== null` guard is not unique to the giving widgets. Repo-wide it appears in
exactly three components:

```
my-giving.ts   my-groups.ts   my-pledges.ts
```

`base-widget.ts` declares no `attributeChangedCallback` of its own, so the other 22
elements are unaffected and this is not a base-class defect. `my-groups.ts` is outside the
filing agent's territory and was not covered by its testing — fix all three together, and
note that a fix to the shared base class would be the wrong shape here.

## Resolution — 2026-10-11 (W4: opportunity-details, custom-form, plan-your-visit, opportunity-finder)

W4's slice is **fixed** on W0's `painted` / `reconfigure()` / `reload()` (branch
`ws/w4-serving-forms`). Each widget sets `this.painted = true` after its first render
and implements `reload()`. None of them guards on `oldValue !== null` or on whether an
entity has loaded.

- **`next-opportunity-details`** (was `opportunity-id && this.opportunity`): every
  observed attribute change after first paint reloads, so a widget whose first load had
  no id can now be pointed at one. The exception is `response-email-template`, which is
  read at submit time and no longer baked into a hidden input at render.
- **`next-custom-form`** (was `&& !this.loading`, which dropped a `form-id` set mid-load):
  `form-id`, `form-guid` and `id-parameter-name` call `reconfigure()`. `checkout-url` and
  `api-host` are read when used.
- **`next-plan-your-visit`** (no callback at all):
  - `collect-address`, `verify-param-name` and `google-maps-api-key` reload.
  - The template ids, `return-url` and the two milestone ids need no reload, so changing
    them never wipes what a visitor typed. Milestones are now read from the attributes
    at submit time instead of render-time hidden inputs.
- **`next-opportunity-finder`** (W4-owned, not in the epic list, but the same bug:
  `opportunities.length || !loading` dropped a change made during the first search):
  `reload()` re-seeds the filters from the attributes and searches again.
- Tests, all under `packages/embed-sdk/src/components/`, each in a "reconfigure (C39)"
  block:
  - `plan-your-visit.test.ts`: a late `collect-address` shows the address block; late
    milestone ids reach the payload; a submit-time attribute change keeps typed values.
  - `custom-form.test.ts`: `form-id` set after a no-form first load; `form-id` set
    mid-load.
  - `opportunity-finder.test.ts`: a late `keyword` searches again.
- Known limit, left as is: overlapping loads are not sequence-guarded, so a reload fired
  mid-load paints whichever response lands last. Attribute changes are rare; a
  `loadSeq` guard is the fix if it ever matters.
