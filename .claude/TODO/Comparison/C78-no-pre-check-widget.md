# C78. Legacy `mpp-pre-check` has no counterpart — no self-service event pre-check or check-in QR code

**Widget:** none (old: `mpp-pre-check`, "Pre Check" — no sample page, `excludeFromConfigurator`)
**Severity:** functional
**Confidence:** confirmed — loader table entry plus the endpoint set and template ids inside the bundle. The *precise* end-user flow is inferred from those endpoints, not observed — see the caveat below. No browser used.
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

MPWidgets.js knows the tag, and marks it as not user-configurable:

```js
{tag:"mpp-pre-check", script:"/dist/PreCheck.js", name:"Pre Check", excludeFromConfigurator:!0}
```

`observedAttributes` is absent and the only attribute `PreCheck.js` reads is the universal
`customCss` — consistent with `excludeFromConfigurator:!0`: it takes no configuration, so
there was nothing for MP's configurator tool to offer.

What it does is legible from the endpoints it calls, three of which appear in no other
bundle:

```
/Api/EventsApi/GetMyEvents?eventDate=
/Api/EventsApi/SavePreCheck?eventDate=
/Api/EventsApi/GetQRCode?eventDate=
```

and from its own template ids: `preCheckForm`, `formElements`, **`qrCode`**,
`resultMessageContainer`, `resultMessageText`.

Read together: a signed-in household member lists their events for a date, submits a
pre-check for who is attending, and receives a **QR code** to present at the campus. It is
the "skip the check-in queue" surface — the family does the data entry at home on Saturday
and scans in on Sunday.

The sample site does not place this tag; it was found in the loader table. To compare it
you must place the tag yourself — see CONFIG-MAP.md section 5.

## New behaviour

No pre-check element exists in the 25-element `next-*` roster. Nothing in the SDK produces
a QR code, and no route under `src/app/api/embed/` (27 directories) corresponds to
`SavePreCheck`, `GetMyEvents` or `GetQRCode`. `next-event-details` handles registration for
a single event; that is a different act from checking a household in for a service on a
given date.

## Caveat on confidence

The tag, its absence of configuration, and the three endpoints are **measured**. The
sentence describing the end-user flow is my reading of those endpoint names and DOM ids,
not a behaviour I watched — no browser was used on this pass. Before this item is sized,
someone should place the tag (CONFIG-MAP.md section 5) and confirm what it actually renders
and who it is for. I am filing it despite that because the *parity* claim needs none of it:
a legacy widget, three legacy endpoints and a QR-code surface exist, and nothing in this
repo answers them. The flow description is the part to verify.

## Why it matters

Children's check-in is one of the highest-traffic Sunday operations a church runs, and
pre-check is the thing that keeps the queue short. A church using it today has no new-stack
equivalent and must keep MPWidgets.js on that page — with the dual-login cost that implies
(legacy `mpp-user-login` writing `mpp-widgets_AuthToken` alongside the new `sid`/JWT
ladder on the same site). Because the widget takes no attributes, it is also one of the
easier things to have overlooked when the catalogue was ported: there was no configuration
surface to notice missing.

Filed at `functional` rather than `ux` — unlike C77, there is no host-page workaround; a
church cannot hand-author a QR code bound to MP's check-in.

## Evidence

- Loader table `ut=[…]` in `https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js`
  (offset ~684 900) — the `mpp-pre-check` entry quoted above, including
  `excludeFromConfigurator:!0`
- Old surface and purpose: endpoint strings and template ids extracted from
  `https://mpi.ministryplatform.com/widgets/dist/PreCheck.js`; `getAttribute` in that bundle
  returns only `customCss`
- No sample page: the tag appears on none of the 21 fetched pages, and it has no
  `WidgetDetails` record in `/widgets/dist/WidgetConfigurator.js`
- New: 25-element roster has no pre-check element; `ls src/app/api/embed/` has no
  pre-check, my-events or QR route; no QR generation anywhere in `packages/embed-sdk/src`
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` sections 3, 5

## Where to fix

- new `packages/embed-sdk/src/components/pre-check.ts` (+ demo page)
- new `src/app/api/embed/pre-check/` routes covering the `GetMyEvents` / `SavePreCheck` /
  `GetQRCode` equivalents
- new `src/services/preCheckService.ts`

## Suggested fix

Confirm the flow first (see the caveat), then treat it as a roadmap item — it is a distinct
product surface, not a missing attribute.

Two notes for whoever picks it up. **The QR code must not pull in a library**: the repo's
standing rule is no new CDN dependencies and no new npm deps where the platform can do the
job, and the `add-to-calendar-button` removal (documented in `CLAUDE.md`) is the precedent
for replacing a library with a small local builder. A QR encoder is a few hundred lines of
pure function, or the code can be rendered server-side and returned as an image from the
route — which is what MP appears to do, given `GetQRCode` returns from the API rather than
being generated client-side. **And the authorisation rule needs deciding up front**: the
widget acts on a whole household on a date, so it reads and writes other people's
attendance records. `src/services/householdService.ts` already establishes how this repo
scopes a caller to their own household; follow it rather than trusting an id from the
client.
