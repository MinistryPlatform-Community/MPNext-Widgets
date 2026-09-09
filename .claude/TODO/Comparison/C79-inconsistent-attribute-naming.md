# C79. Four `next-*` widgets use flat lowercase attribute names while the other twenty-one use kebab-case

**Widget:** `next-my-giving`, `next-my-groups`, `next-my-household`, `next-my-pledges`
**Severity:** cosmetic
**Confidence:** confirmed — every `observedAttributes` list in the SDK was read; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

Not a legacy defect — legacy is internally consistent. **Every** `mpp-*` attribute is flat
lowercase (`hidesoftcredits`, `showsuggestagroupbutton`, `paymentprocessortargeturl`,
`citypostalcode`), with a handful of camelCase spellings the bundles read case-sensitively
(`invoiceStatusId`, `verificationemailtemplateId`, `userNotificationemailtemplateid`) —
untidy, but one convention with a few warts.

## New behaviour

The new SDK is kebab-case almost everywhere — `congregation-id`, `target-url`,
`show-suggest-a-group-button`, `hide-address`, `verification-email-template-id`,
`payment-processor-url`, `back-to-event-url`, `response-email-template` — across 21 of the
25 elements.

Four kept the legacy spelling verbatim:

| Element | Source | Attributes |
|---|---|---|
| `next-my-giving` | `packages/embed-sdk/src/components/my-giving.ts:47` | `hidesoftcredits` |
| `next-my-groups` | `packages/embed-sdk/src/components/my-groups.ts:36` | `hidegrouplife` |
| `next-my-household` | `packages/embed-sdk/src/components/my-household.ts:117` | `hideaddhouseholdmember` |
| `next-my-pledges` | `packages/embed-sdk/src/components/my-pledges.ts:34` | `hidecancelbuttonpledge`, `cancelpledgeemailtemplate` |

The clearest evidence that this is drift rather than design is inside one widget family:
`next-online-directory` renames the same class of option to `hide-address` /
`hide-email` / `hide-birthday-icon` / `hide-family-link`, while `next-my-groups` keeps
`hidegrouplife`. Both are "hide a section" booleans; they disagree on spelling.

These four are, incidentally, the only pairs on this run with **complete** attribute parity
(CONFIG-MAP.md section 4.11) — which is presumably why they were transcribed rather than
translated.

## Why it matters

Cosmetic, and deliberately filed as such — nothing breaks, and no customer markup carries
over regardless, because the element names changed (`mpp-my-giving` → `next-my-giving`).
The cost is on the people writing embed snippets: with 25 elements and no single rule, every
attribute becomes something to look up rather than something to predict, and the natural
guess (`hide-soft-credits`, matching the other 21 elements) fails **silently** — an unknown
attribute on a custom element throws nothing, logs nothing, and simply leaves the default in
place. That failure mode is the whole argument for fixing it.

It also matters that it is fixed *now* rather than later: the moment a customer ships a
snippet using `hidesoftcredits`, changing it costs a deprecation window instead of an edit.

## Evidence

- New surfaces: `static get observedAttributes()` read from all 25 components under
  `packages/embed-sdk/src/components/`; the four outliers at the line numbers tabled above
- The inconsistency within one family: `online-directory.ts:70` (`hide-address`, …) versus
  `my-groups.ts:36` (`hidegrouplife`)
- Legacy convention: flat lowercase across all 36 `/widgets/dist/*.js` bundles
- No screenshot: static-only item by design
- Full parity tables: `.claude/playwright/widget/CONFIG-MAP.md` section 4, especially 4.11

## Where to fix

- `packages/embed-sdk/src/components/my-giving.ts:47`
- `packages/embed-sdk/src/components/my-groups.ts:36`
- `packages/embed-sdk/src/components/my-household.ts:117`
- `packages/embed-sdk/src/components/my-pledges.ts:34`
- the four matching `packages/embed-sdk/demo-*.html` pages, if any set these (none do today
  — all four demos set only `api-host`)

## Suggested fix

Rename to `hide-soft-credits`, `hide-group-life`, `hide-add-household-member`,
`hide-cancel-button-pledge`, `cancel-pledge-email-template`, and **accept the old spelling
as an alias** in each `observedAttributes` for one release rather than breaking anything
already deployed — read the kebab name first, fall back to the legacy one, and
`console.warn` once on the fallback so a host that is using it finds out. Cheap, and it
removes the silent-failure mode in both directions.

Then write the rule down. `CLAUDE.md`'s Code Conventions section already states the
kebab-case file convention and its one documented exception (`src/services/*Service.ts`);
adding "widget attributes are kebab-case" there is what stops the next widget drifting.
Worth a guard test too, in the spirit of `src/lib/no-template-concat.test.ts`: assert that
every string in every component's `observedAttributes` matches
`/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` and contains a hyphen when it is more than one word. That
turns a convention into something the suite enforces instead of something a reviewer has to
remember.
