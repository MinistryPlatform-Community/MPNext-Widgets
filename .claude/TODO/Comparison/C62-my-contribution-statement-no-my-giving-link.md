# C62. `next-my-contribution-statement` has no `my-giving-widget-target-url` — the link across to My Giving is gone

**Widget:** `next-my-contribution-statement` (old: My Contribution Statement, `/widgets/my_contribution_statement.aspx`)
**Severity:** functional
**Confidence:** confirmed — static source read on both sides; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

`mpp-my-contribution-statement` has exactly one option, and the sample page sets it:

```html
<mpp-my-contribution-statement mygivingwidgettargeturl="./RsvpEvents">
</mpp-my-contribution-statement>
```

`observedAttributes` in `/widgets/dist/MyContributionStatement.js` is
`["mygivingwidgettargeturl"]`, and the same string appears in a `getAttribute(...)` call
in that bundle, so it is genuinely read. It points the widget at the page hosting the My
Giving widget, so a member reading a statement can navigate to the transaction-level
detail behind it.

(The sample value is itself broken — `./RsvpEvents` hosts `<mpp-rsvp-events>`, a tag
MPWidgets.js does not know, so that page renders nothing. That is a sample-site
misconfiguration, not a widget defect, and is not part of this item.)

## New behaviour

`next-my-contribution-statement` accepts no attributes at all — no `observedAttributes`,
no `getAttribute` in `packages/embed-sdk/src/components/my-contribution-statement.ts`
(395 lines). There is no way to tell it where My Giving lives, and no such link in its
markup.

## Why it matters

The statement is a per-year summary; My Giving is the per-donation detail. On the legacy
stack those two widgets are stitched together by this attribute, so a member who wants to
know which gift made up a line on their statement has one click. On the new stack the two
pages exist (`next-my-contribution-statement`, `next-my-giving`) with nothing joining
them, and the host site has to hand-author the link — which it cannot place *inside* the
widget's Shadow DOM, so it lands somewhere less useful. Small feature, but it is the only
option the legacy widget had, so parity for this pair is currently zero.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets/my_contribution_statement.aspx`
- Old surface: `observedAttributes` and the `getAttribute("mygivingwidgettargeturl")` call
  in `https://mpi.ministryplatform.com/widgets/dist/MyContributionStatement.js`
- New surface: `packages/embed-sdk/src/components/my-contribution-statement.ts` — grep for
  `Attribute` returns nothing
- No screenshot: static-only item by design
- Parity table: `.claude/playwright/widget/CONFIG-MAP.md` section 4.14

## Where to fix

`packages/embed-sdk/src/components/my-contribution-statement.ts` — add
`observedAttributes` with `my-giving-url` and render the link.

## Suggested fix

Add a `my-giving-url` attribute (the kebab-case house style; do not copy the legacy
spelling) and render it as a link in the statement header or footer, hidden when the
attribute is absent so nothing changes for hosts that do not set it. Same pattern
`next-event-details` already uses for `opportunity-finder-url`.

While in this file, note the related structural difference recorded in
CONFIG-MAP.md section 2.8: the legacy widget also carries the "go paperless" toggle
(`/Api/ContributionsApi/SetStatementMethod?goPaperless=`), which this repo split out into
`next-statement-preferences`. That split is not filed as a defect, but it means the two
new elements should probably cross-link for the same reason this one should.
