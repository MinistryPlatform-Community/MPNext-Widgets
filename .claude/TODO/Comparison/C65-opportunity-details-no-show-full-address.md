# C65. `next-opportunity-details` has no `show-full-address` — the full street address always renders

**Widget:** `next-opportunity-details` (old: Opportunity Details, `/widgets/opportunity_details.aspx`)
**Severity:** functional
**Confidence:** confirmed — static source read on both sides; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

`mpp-opportunity-details`'s `observedAttributes`
(`https://mpi.ministryplatform.com/widgets/dist/OpportunityDetails.js`) is:

```
["showfulladdress","returnurl","responseemailtemplate"]
```

and all three appear in `getAttribute(...)` calls in that bundle. `showfulladdress` is a
**privacy switch**: off by default, it withholds the full street address of the serving
location and shows only the coarse form. Its sibling `mpp-group-details` documents the
same attribute in the configurator as "Show Full Group Address", which is how we know the
semantics.

Worth noting for anyone re-measuring: `showfulladdress` and `responseemailtemplate` are
**not** in `WidgetConfigurator.js`'s `configurationItems` for this widget (only
`returnurl` is documented there). The configurator metadata is incomplete for this
widget; `observedAttributes` plus the `getAttribute` call sites are the real surface.

The sample page sets only `returnurl="../Opportunities"`, i.e. it demos the widget with
the address **suppressed** — the default.

## New behaviour

`next-opportunity-details` declares five attributes
(`packages/embed-sdk/src/components/opportunity-details.ts:90`+):

```
["api-host","id-parameter-name","opportunity-id","response-email-template","return-url"]
```

`return-url` and `response-email-template` are there; `show-full-address` is not. The
address renders unconditionally (`opportunity-details.ts:513-514`):

```ts
if (!op.address) return "";
const q = encodeURIComponent(op.address);
```

The sibling `next-group-details` **does** implement it — `"show-full-address"` at
`group-details.ts:100`, forwarded as `params.set("showFullAddress", "true")` at `:166` —
so the omission here looks like an oversight rather than a decision.

## Why it matters

Serving opportunities are frequently hosted at a volunteer's home, a partner ministry's
office, or a shelter with a deliberately unpublished address. On the legacy stack the
address is hidden unless a staff member opts in per embed. On the new widget it is always
rendered, on a page that by design is reachable by an anonymous visitor from the
opportunity finder — so migrating flips a privacy default from closed to open, silently,
with no attribute to close it again. That is the kind of change a church discovers from a
complaint rather than from a release note.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets/opportunity_details.aspx`
  → `<mpp-opportunity-details returnurl="../Opportunities">`
- Old surface: `observedAttributes` + `getAttribute` list brace-matched out of
  `https://mpi.ministryplatform.com/widgets/dist/OpportunityDetails.js`
- New surface: `packages/embed-sdk/src/components/opportunity-details.ts:90`+ and
  `:513-514`
- Precedent in this repo: `packages/embed-sdk/src/components/group-details.ts:100`, `:166`
- No screenshot: static-only item by design
- Parity table: `.claude/playwright/widget/CONFIG-MAP.md` section 4.6

## Where to fix

- `packages/embed-sdk/src/components/opportunity-details.ts` — `observedAttributes` (~:90)
  and the address renderer (~:513)
- `src/app/api/embed/opportunity-details/` and `src/services/opportunityDetailsService.ts`
  — if the address should be withheld server-side rather than merely unrendered

## Suggested fix

Copy the `next-group-details` pattern exactly: add `"show-full-address"` to
`observedAttributes` and forward it as `showFullAddress=true`. **Prefer withholding the
address in the service over hiding it in the client** — a Shadow DOM widget that fetches
the full address and declines to paint it still ships it to the browser, where it is one
network-tab click away. Check what `mpp-opportunity-details` does here before deciding;
if legacy filters server-side, match that, and if it only hides client-side, this is a
chance to do better than parity.
