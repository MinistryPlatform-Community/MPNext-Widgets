# C55. `next-subscriptions` has no "Do not send me bulk email messages" control; the global opt-out only exists inside `next-profile`

**Widget:** `next-subscriptions` (old: My Subscriptions — `/widgets/subscriptions.aspx`, tag `mpp-subscriptions`)
**Severity:** functional
**Confidence:** confirmed — both widgets driven signed in, all form controls enumerated from the shadow roots, MP field verified via the API
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-subscriptions` renders the publication checkbox list **and**, below it, a
separate checkbox that is not a publication:

```
<input type="checkbox" id="BulkEmailOptOut" name="bulkemailoptout" value="false">
  Do not send me bulk email messages
<input type="submit" id="updateButton" value="Update Subscriptions">
```

It writes `Contacts.Bulk_Email_Opt_Out`, and it is submitted by the same
**Update Subscriptions** button as the publication checkboxes, so one visit to
one widget lets a member both pick their publications and switch off bulk email
entirely. The full visible control set on the legacy widget, signed in, is:
`#congregationId` (Campus), `#searchText` (keyword), one checkbox per
publication plus a Show/Hide Description toggle each, `#BulkEmailOptOut`, and
`#updateButton`.

## New behaviour

`next-subscriptions` renders exactly three controls: one checkbox per
`Available_Online` publication. Nothing else — no campus filter (that is C61),
no keyword box below six publications, no bulk-email opt-out, and no submit
button (it saves per-toggle, which is an improvement — see the test log).

The capability is not gone from the SDK, it has moved: `next-profile` carries a
`bulk-email-opt-out` checkbox ("Do not send me bulk email messages") in its
Contact Information section, wired to the same `Contacts.Bulk_Email_Opt_Out`
field. So a member can still set it — but only by loading a *different* widget,
which the host page may not have embedded, and which is a full profile-editing
form rather than an email-preferences control.

Verified against MP: `Contacts.Bulk_Email_Opt_Out` for the test contact
(`Contact_ID = 98`) is `false`, is readable and writable through
`next-profile`'s `PUT /api/embed/profile`, and is never referenced by
`src/services/subscriptionService.ts` or `src/app/api/embed/subscriptions/route.ts`
(the service reads `dp_Publications` and reads/writes `dp_Contact_Publications`
only).

## Why it matters

"Stop emailing me" is the control a church is obliged to make easy, and the
natural place a member looks for it is the page that manages their email
subscriptions. A church that embeds `next-subscriptions` on a "Manage your email
preferences" page — the obvious like-for-like replacement for
`subscriptions.aspx` — ships a page where the member can unsubscribe from each
publication one at a time but cannot switch off bulk email at all. Sending them
to a profile-editing widget for it is worse than the legacy single-page flow, and
if the host site has not embedded `next-profile` the control is simply
unreachable. This compounds C72 (`mpp-unsubscribe`, the one-click unsubscribe
widget, also has no counterpart): between the two, the new catalogue has no
first-class "opt me out" surface.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/subscriptions-old-authed.png` — legacy signed in: Campus select, keyword box, three publications with description toggles, **"Do not send me bulk email messages"**, **"Update Subscriptions"**
  - `.claude/playwright/widget/screenshots/subscriptions-new-authed.png` — new signed in: three checkboxes, nothing else
  - `.claude/playwright/widget/screenshots/profile-new-authed.png` — where the opt-out actually lives now
- Control enumeration, legacy `mpp-subscriptions` shadow root, signed in
  (visible controls only): `select#congregationId`, `input#searchText`,
  `input#3`/`#2`/`#4` (`name="publications"`),
  `input#BulkEmailOptOut` (`name="bulkemailoptout"`), `input#updateButton`
  (`value="Update Subscriptions"`).
- Control enumeration, `next-subscriptions` shadow root, signed in:
  three `input[type=checkbox]`, no `select`, no `button`, no submit.
- MP verification (client credentials):
  `GET /tables/Contacts?$select=Contact_ID,Bulk_Email_Opt_Out&$filter=Contact_ID=98`
  → `"Bulk_Email_Opt_Out": false`. `next-profile`'s own form control
  `name="bulk-email-opt-out"` reads `false` to match.
  `grep -n "Bulk_Email_Opt_Out" src/services/subscriptionService.ts` → no hits;
  `src/services/profileService.ts:42` selects it.

## Where to fix

- `packages/embed-sdk/src/components/subscriptions.ts` — the render (three
  checkboxes, no other controls) and `toggleSubscription()`
- `src/app/api/embed/subscriptions/route.ts` — `GET` would need to return the
  contact's current `Bulk_Email_Opt_Out`, `PUT` to accept it
- `src/services/subscriptionService.ts:54-101` — `getSubscriptions()` /
  the update method, which today touch only `dp_Publications` and
  `dp_Contact_Publications`
- `packages/types/src/` — the `SubscriptionItem` / response schema
- `packages/embed-sdk/src/components/profile.ts` — the existing implementation to
  mirror (and to keep in sync)

## Suggested fix

Add the opt-out to `next-subscriptions` as a distinct row below the publication
list, visually separated and clearly global — legacy's flat placement invites
misreading it as another publication. Have `GET /api/embed/subscriptions` return
`{ subscriptions, bulkEmailOptOut }` and give the toggle its own `PUT` (or extend
the existing one with an optional field), following the same
save-on-change-with-toast behaviour the publication checkboxes already have, so
there is still no submit button.

Two decisions to make deliberately rather than by accident:

- **Copy.** Legacy's "Do not send me bulk email messages" is a double negative
  next to a checkbox. Consider "Send me bulk email messages" checked-by-default,
  or keep legacy's wording for migration familiarity — but pick one and use the
  same string in `next-profile`, which currently has its own.
- **Two widgets, one field.** Once both widgets write `Bulk_Email_Opt_Out`, a
  page carrying both will show stale state in one after the other saves. Either
  re-read on the `subscriptionsUpdated` / profile-saved events, or have both
  read through one shared accessor.

Marking **functional**: nothing breaks, but a control the legacy widget offered
in this widget is not offered here.

## Resolution — 2026-10-11

**Fixed** (W6, `ws/w6-people`).

- **Server.** `GET /api/embed/subscriptions` now answers `{ subscriptions, bulkEmailOptOut }`.
  `PUT` takes an optional `bulkEmailOptOut` beside the (now optional) `subscribedIds` — at
  least one is required (`SubscriptionUpdateSchema` refine) — and echoes the saved flag.
  `SubscriptionService` gained `getBulkEmailOptOut(contactId)` and
  `setBulkEmailOptOutForContact(contactId, optOut)`; the write is one private
  `writeBulkEmailOptOut` that the anonymous `next-unsubscribe` path now shares, so both send
  `Contact_ID` plus the one column and nothing else.
- **Widget.** A distinct "All church email" section *below* the publication list, separated by
  a rule, so it cannot read as another publication. Saved per toggle with the same optimistic
  flip, success message and revert-on-failure as a publication; still no submit button. Not
  drawn at all if the server omits the flag (never guessed).
- **Decision 1 — copy:** the plan's preference, not legacy's double negative. One string,
  `subscriptions.sendBulkEmail` = "Send me general church emails" (es / pt-BR translated),
  **checked = receives email**, inverted onto `Bulk_Email_Opt_Out` in code. `next-profile` now
  uses the identical key with the same inversion (`#bulk-email-opt-in`), and its old
  `profile.bulkEmailOptOut` ("Do not send me bulk email messages") was removed from all three
  catalogues. `myHousehold.bulkEmailOptOut` (the per-member household form) is untouched.
- **Decision 2 — two widgets, one field:** event-driven, not a shared accessor (which would
  have meant a new `shared/**` module, W0-owned). `next-subscriptions` emits `bulkEmailChanged
  { bulkEmailOptOut }`; `next-profile` follows it **in place** (no re-render, so an unsaved
  edit elsewhere on the form survives) and updates its loaded value. `next-subscriptions`
  follows `profileSaved`'s `Bulk_Email_Opt_Out`. Both listen on `document` and unsubscribe in
  `disconnectedCallback`. Inside the user-menu modal only one tab exists at a time, so this
  matters for host pages that carry both widgets.

**Verified live** (contact 98, with teardown): read `false` → wrote `true` → read `true` →
restored `false` → read `false`.

Tests: `subscriptions.test.ts` (toggle state, PUT body `{ bulkEmailOptOut: true }`, turning it
back on, revert on failure, absent flag draws nothing, follows `profileSaved`, per-publication
save unchanged), `profile.test.ts` (shared wording and inversion; follows `bulkEmailChanged`
without losing typed input), service and schema cases.
