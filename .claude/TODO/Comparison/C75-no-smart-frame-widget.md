# C75. Legacy `mpp-smart-frame` has no counterpart — no way to embed a third-party page with the signed-in user merged into its URL

**Widget:** none (old: `mpp-smart-frame`, "Smart Frame" — no sample page)
**Severity:** functional
**Confidence:** confirmed — MPWidgets.js loader table + bundle attribute surface; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

MPWidgets.js knows the tag:

```js
{tag:"mpp-smart-frame", script:"/dist/SmartFrame.js", name:"Smart Frame"}
```

`observedAttributes` in `/widgets/dist/SmartFrame.js` is `["frameurl","frametitle"]`, both
read via `getAttribute(...)`, plus the universal `customCss`. The bundle also references
`mpp-user-service`, the loader's internal session helper — the same dependency
`mpp-smart-link` has, which is what supplies the `{{isAuthenticated}}` /
`{{userDisplayName}}` / `{{userEmail}}` / `{{userLocale}}` merge-token values documented on
`/widgets/giving.aspx`.

So it is the iframe half of the pair `mpp-smart-link` (**C74**) forms: instead of sending
the visitor away to a vendor with their identity in the URL, embed that vendor's page
**in situ** with the same substitution, under an accessible `frametitle`.

The sample site does not place this tag, so it does not appear in the BRIEF's page map;
it was found in the loader table. To compare it you must place the tag yourself — see
CONFIG-MAP.md section 5, and note MPWidgets.js will not pick up a tag injected after its
`DOMContentLoaded` scan.

## New behaviour

No frame element exists in the 25-element `next-*` roster, and nothing in the SDK exposes
the signed-in user's fields for interpolation into a host-authored URL (see C74's evidence
on `next-user-menu`'s identity attributes being inputs, not outputs).

## Why it matters

Same argument as C74 and the same customers, one interaction step earlier: a church that
today keeps a vendor's giving form, event ticketing, or counselling intake **on its own
page** rather than bouncing the visitor away loses the ability to do so, and the fallback —
hand-writing an `<iframe>` — cannot carry the identity, because the host page has no access
to the session values. In practice that turns an in-page flow into a new-tab hand-off,
which is a measurable conversion loss on a giving page.

Filed separately from C74 rather than bundled because they are separate elements with
separate attribute surfaces and one may reasonably be ported without the other — a link is
far easier to make safe than a frame (see below).

## Evidence

- Loader table `ut=[…]` in `https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js`
  (offset ~684 900) — the `mpp-smart-frame` entry quoted above
- Old surface: `observedAttributes` `["frameurl","frametitle"]` and the matching
  `getAttribute` calls in `https://mpi.ministryplatform.com/widgets/dist/SmartFrame.js`;
  the same bundle references `mpp-user-service`
- No sample page: the tag appears on none of the 21 fetched pages
- Merge-token evidence: the `{{…}}` tokens on
  `curl https://mpi.ministryplatform.com/widgets/giving.aspx`
- New: 25-element roster has no frame element
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` sections 3, 5

## Where to fix

- new `packages/embed-sdk/src/components/smart-frame.ts` (+ demo page)
- `packages/embed-sdk/src/shared/auth-session.ts` — the same user-field exposure C74 needs

## Suggested fix

Build C74 first and share its token-substitution helper; this element is then `frame-url` +
`frame-title` around one `<iframe>`.

**The security review here is heavier than for C74 and should gate the work.** A framed
third party is a live origin inside the church's page, so at minimum: restrict `frame-url`
to `https:`, `encodeURIComponent` every substituted value, set an explicit `sandbox`
allow-list rather than inheriting full privileges, set `referrerpolicy`, and require
`frame-title` for accessibility (legacy makes it optional; a titleless iframe fails
WCAG 4.1.2). Then the harder question, which I cannot settle and would put to whoever owns
the auth design: this repo's hardened model exists so that MP tokens and user PII stay in
the encrypted server session and never reach host-page storage
(`WIDGET-AUTH-MIGRATION-PLAN.md`). Interpolating the signed-in user's email into a URL
handed to an arbitrary framed origin runs against that premise, and it is plausible that
both smart widgets were omitted on purpose. If so, this item's resolution is a documented
"won't port, and here is what to use instead" rather than an implementation.
