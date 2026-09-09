# C61. `next-subscriptions` cannot be scoped to a congregation — legacy `congregationid` has no equivalent client- or server-side

**Widget:** `next-subscriptions` (old: My Subscriptions, `/widgets/subscriptions.aspx`)
**Severity:** functional
**Confidence:** confirmed — static source read on both sides; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

`mpp-subscriptions` has exactly one supported option, and it is this one.
`observedAttributes` in `https://mpi.ministryplatform.com/widgets/dist/Subscriptions.js`
is `["congregationid"]`, and the configurator metadata reads, verbatim:

> **Congregation** — `congregationid` — "Filters the results by a single Congregation ID."

The sample page happens to set `target="./Subscriptions/"` instead, which is dead —
`target` is not in `observedAttributes` and never reaches a `getAttribute` call. So the
sample site does not demo the one option that exists; read the bundle, not the page.

## New behaviour

`next-subscriptions` accepts no attributes: no `observedAttributes`, no `getAttribute`
anywhere in `packages/embed-sdk/src/components/subscriptions.ts`.

The gap goes all the way down. `GET /api/embed/subscriptions`
(`src/app/api/embed/subscriptions/route.ts`) reads no query params at all, and
`SubscriptionService.getSubscriptions(contactId)` filters only on availability:

```ts
// src/services/subscriptionService.ts
table: "dp_Publications",
filter: `Available_Online = 1 OR Available_Online IS NULL`,
```

The doc comment two lines above it says "Get all available publications for **given
congregations**" — the intent was there; the parameter never was.

## Why it matters

A multi-campus church puts the subscriptions widget on each campus page and scopes it, so
a Downtown attender is not offered the North Campus newsletter. On the new widget every
campus page shows the union of every `Available_Online` publication in the domain, and
there is no attribute, query param, or service argument that can narrow it. For a church
with per-campus publication sets this is the difference between a usable page and a wall
of irrelevant checkboxes — and every subscribe is a real write to
`dp_Contact_Publications`, so wrong choices are not cosmetic.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets/subscriptions.aspx`
- Old surface: `observedAttributes` + `WidgetDetails.configurationItems` from
  `/widgets/dist/Subscriptions.js` and `/widgets/dist/WidgetConfigurator.js`
- New surface: `packages/embed-sdk/src/components/subscriptions.ts` (no attribute reads),
  `src/app/api/embed/subscriptions/route.ts` (no `searchParams`),
  `src/services/subscriptionService.ts` (filter is `Available_Online` only)
- No screenshot: static-only item by design
- Parity table: `.claude/playwright/widget/CONFIG-MAP.md` section 4.13

## Where to fix

- `packages/embed-sdk/src/components/subscriptions.ts` — add `congregation-id` to a new
  `observedAttributes` and send it
- `src/app/api/embed/subscriptions/route.ts` — read and validate the param
- `src/services/subscriptionService.ts` — thread it into the `dp_Publications` filter

## Suggested fix

Add `congregation-id`, pass it as `?congregationId=`, and extend the `dp_Publications`
filter. Check MP's schema first: `dp_Publications` may relate to congregations through a
join table rather than a column, in which case the filter needs `_TABLE` traversal (see
`.claude/references/ministryplatform.query-syntax.md`) — worth confirming how
`mpp-subscriptions` builds its own query before copying a guess. Keep the existing
`Available_Online` clause; congregation should narrow, not replace, it.
