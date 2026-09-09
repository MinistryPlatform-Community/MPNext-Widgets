# CROSS-4 — Configuration attributes: late sets are ignored, and the naming has drifted

**Items:** C39 (`attributeChangedCallback` skips the first set) · C79 (four widgets kept
flat-lowercase names)
**Severity:** functional (C39) / cosmetic (C79) · **Cutover verdict: C39 blocks cutover, C79 is Phase 2 but is cheapest now**
**Owns:** `my-giving.ts`, `my-groups.ts`, `my-pledges.ts`, `pledge-campaign.ts`, `my-household.ts`

## C39 — configuring a mounted widget from script is a no-op

Three components guard on `oldValue !== null`:

```ts
if (oldValue !== null && oldValue !== newValue) { this.loadPledges(); }
```

For an attribute that was *absent* at upgrade time — which is every attribute a host sets
after inserting the tag — the first `setAttribute` arrives with `oldValue === null`, the
branch is skipped, and nothing re-renders. Measured: setting `hidecancelbuttonpledge="false"`
on a live `next-my-pledges` changed nothing; replacing the element with a fresh one carrying
the same attribute worked. Legacy reloads unconditionally on any observed change.

**Why it matters more than it looks.** Any host that renders the tag from JavaScript in two
steps — create, insert, configure — gets a widget stuck on its defaults with no error. That
is the natural shape of a WordPress block, a Squarespace code injection, or any framework
treating attributes as reactive props. It also makes the widgets undemoable from the
console, which is the obvious thing an integrator tries first. And it interacts badly with
C31: the one attribute a migrating pledge site most needs to set is also the one that
cannot be set late.

### Course of action

1. **Drop the `oldValue !== null` half.** `if (oldValue !== newValue)` is the correct guard
   and already covers the no-op case. Three files: `my-giving.ts:63-67`,
   `my-groups.ts`, `my-pledges.ts:57-61`. `base-widget.ts` declares no
   `attributeChangedCallback` of its own, so the other 22 elements are unaffected — this is
   **not** a base-class defect and a base-class fix would be the wrong shape.
2. **What the null check was reaching for is "am I rendered yet".** If that guard is
   genuinely needed, set an explicit `this.hasRendered` flag at the end of
   `connectedCallback` and test that, rather than inferring it from `oldValue`.
3. **Fix `pledge-campaign.ts` too — it has its own version of the same bug.** Its shape is
   `if (name === "campaign-id" && this.campaign) this.init();`, so it re-inits only when a
   campaign is *already loaded*: setting `campaign-id` on a widget whose first load failed
   does nothing. Normalise it to the same guard.
4. **Add a shared `reconfigure()` convention** so the next widget does not invent a fourth
   shape. One documented pattern: observed attribute changes call `this.reconfigure()`,
   which is a no-op before first render and a re-load after.

## C79 — four widgets kept the legacy flat-lowercase attribute names

21 of 25 elements are kebab-case (`congregation-id`, `show-suggest-a-group-button`,
`payment-processor-url`). Four transcribed the legacy spelling verbatim:

| Element | Attribute(s) |
|---|---|
| `next-my-giving` | `hidesoftcredits` |
| `next-my-groups` | `hidegrouplife` |
| `next-my-household` | `hideaddhouseholdmember` |
| `next-my-pledges` | `hidecancelbuttonpledge`, `cancelpledgeemailtemplate` |

The tell that this is drift rather than design is inside one widget family:
`next-online-directory` renames the same class of option to `hide-address` / `hide-email` /
`hide-birthday-icon`, while `next-my-groups` keeps `hidegrouplife`. Both are "hide a
section" booleans and they disagree on spelling.

**Why fix a cosmetic item now.** The failure mode is silent: an unknown attribute on a
custom element throws nothing and logs nothing, so the natural guess (`hide-soft-credits`)
leaves the default quietly in place. And the moment a customer ships a snippet using
`hidesoftcredits`, changing it costs a deprecation window instead of an edit. Cost of fixing
today is minutes; cost of fixing after cutover is a support commitment.

### Course of action

1. Rename to `hide-soft-credits`, `hide-group-life`, `hide-add-household-member`,
   `hide-cancel-button-pledge`, `cancel-pledge-email-template`.
2. **Accept the old spelling as an alias for one release** — read the kebab name first, fall
   back to the legacy one, `console.warn` once on the fallback so any host using it finds
   out. Cheap, and it removes the silent-failure mode in both directions.
3. **Write the rule down** in `CLAUDE.md`'s Code Conventions, next to the existing kebab-case
   file convention and its documented `src/services/*Service.ts` exception: *widget
   attributes are kebab-case*.
4. **Add a guard test**, in the spirit of `src/lib/no-template-concat.test.ts`: assert every
   string in every component's `observedAttributes` matches
   `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` and contains a hyphen when it is more than one word.
   That turns a convention into something the suite enforces rather than something a
   reviewer has to remember.

## While in here — an unrelated but adjacent gap

Several widgets **accept attributes and silently ignore them**, which is the same
silent-failure shape from the other direction:

- `next-group-details` declares `inquiry-email-template`, `signup-email-template` and
  `leader-signup-email-template` in `observedAttributes` and never reads them (C11) — the
  attribute-parity table scored the pair as complete on that basis.
- `next-event-finder` reads `featured` but exposes no control (C04).

The fix for each lives in its widget's plan, but the **convention** belongs here: an
attribute that is declared and not honoured should `console.warn` once naming itself. That
one rule would have caught C11 during development instead of at comparison time.

## Acceptance

- Setting any observed attribute on a mounted, already-rendered widget re-renders it.
- Setting `campaign-id` on a `next-pledge-campaign` whose first load failed re-inits it.
- The `observedAttributes` naming guard test passes across all 25 components.
- Legacy attribute spellings still work and warn once.

## Depends on / unblocks

Independent. **Unblocks C31** (`my-pledges.md`), which is untestable-from-script until C39
lands.
