# C74. Legacy `mpp-smart-link` has no counterpart — no way to link out with the signed-in user merged into the URL (this is what `/widgets/giving.aspx` actually is)

**Widget:** none (old: Give Online, `/widgets/giving.aspx`)
**Severity:** functional
**Confidence:** confirmed — the sample page's own markup plus the bundle's attribute surface; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

The BRIEF's "Give Online" page is not a payment widget. It is this:

```html
<mpp-smart-link
  href="https://testing.realm.dev/givechurch/give/default?authenticated={{isAuthenticated}}&user={{userDisplayName}}&email={{userEmail}}&userLocale={{userLocale}}"
  target="_blank" linkclasses="giving-button">Click Here to Give</mpp-smart-link>
```

`observedAttributes` in `/widgets/dist/SmartLink.js` is
`["href","target","linktext","linkclasses"]`, all four read via `getAttribute(...)`, plus
the universal `customCss`. The link text can come from the attribute or from the element's
own child text ("Click Here to Give" above).

What makes it "smart" is the merge tokens: `{{isAuthenticated}}`, `{{userDisplayName}}`,
`{{userEmail}}`, `{{userLocale}}` are substituted from the current MP session before the
link is followed. (`SmartLink.js` also references `mpp-user-service`, the loader's internal
session helper, which is where those values come from.) So a church hands a third-party
system — a giving vendor, a registration platform, a ticketing site — the visitor's
identity without that system needing an MP integration, and `linkclasses` lets the church's
own stylesheet style the anchor.

`mpp-smart-frame` is the same idea in an iframe and is filed separately as **C75**.

## New behaviour

No such element exists in the 25-element `next-*` roster, and nothing else in the SDK
exposes the signed-in user's display name, email or locale for interpolation into a
host-authored URL. `next-user-menu` accepts `email` / `first-name` / `last-name` /
`image-url` as **inputs** it renders; it does not publish them for another element to
consume.

**Correct the pair table before comparing anything here.** The BRIEF maps
`next-checkout` / `next-pay` / `next-checkout-complete` to this page; there is nothing on
this page to compare them against. The real legacy payment surface is `/widgets/Checkout`
(`mpp-checkout`), `/widgets/pay` (`mpp-pay`) and `mpp-checkout-complete` — see
CONFIG-MAP.md section 2.5, which lists the markup for each.

## Why it matters

Two distinct losses. The narrow one: a church whose giving runs on Realm or another
external processor — which is exactly what MP's own sample site demonstrates on its
"Give Online" page — has no new-stack element for that hand-off, and hand-writing the
anchor cannot fill the gap because the host page has no access to the session values the
tokens supply. The broader one: `mpp-smart-link` is the catalogue's general-purpose escape
hatch, the answer to "MP has no widget for X, but our vendor does". Removing it removes the
answer.

Note also that this page is where `{{userLocale}}` appears, which is part of the evidence
for **C73**: legacy locale is not cosmetic, it is plumbed out to third parties.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets/giving.aspx` — quoted in full
  above; note it is the only sample page whose widget carries child text
- Loader table entry: `{tag:"mpp-smart-link", script:"/dist/SmartLink.js", name:"Smart Link"}`
  in `https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js`
- Old surface: `observedAttributes` `["href","target","linktext","linkclasses"]` and the
  matching `getAttribute` calls in `/widgets/dist/SmartLink.js`; the same bundle references
  `mpp-user-service`
- New: `grep -rho 'customElements\.define(\s*"next-[a-z-]*' packages/embed-sdk/src` → 25
  elements, none for links or frames; `next-user-menu`'s attribute list
  (`packages/embed-sdk/src/components/user-menu.ts:86`+) shows the identity fields are
  inputs, not outputs
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` sections 2.5, 3

## Where to fix

- new `packages/embed-sdk/src/components/smart-link.ts` (+ demo page)
- `packages/embed-sdk/src/shared/auth-session.ts` — expose the resolved user fields for
  substitution (`/api/embed/auth/me` already reports the signed-in user for a v2 token)

## Suggested fix

Small element, but there is one decision that must not be got wrong, so treat it as the
whole design:

**Do not substitute unescaped session values into a host-authored URL.** Each merge token's
replacement must be `encodeURIComponent`'d, and the resulting `href` scheme should be
restricted to `https:` (and `mailto:`/`tel:` if wanted) — a `javascript:` href with an
interpolated display name is script injection driven by MP profile data, and the widget
would be handing it a same-origin execution context. Also consider whether emitting the
signed-in user's email into an arbitrary third-party URL should require the host to opt in
per field rather than being implied by using the element at all; legacy does not gate it,
but legacy predates the hardened auth model this repo is built on
(`WIDGET-AUTH-MIGRATION-PLAN.md`), whose whole premise is that user credentials and PII do
not leave the server session casually. I would raise that with whoever owns the auth design
before implementing — it may be a deliberate reason this element was not ported.

Beyond that: read `href`, `target`, `link-text`, `link-classes`; fall back to child text
when `link-text` is absent; resolve tokens from `AuthSession`; render one anchor.
