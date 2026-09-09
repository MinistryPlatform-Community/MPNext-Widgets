# `next-subscriptions` — plan

**Items:** C55 (functional) · C61 (functional) · C53 (ux, shared)
**Cutover verdict: C53 blocks cutover; C55 has a compliance edge and should ship with it.**
**Owns:** `packages/embed-sdk/src/components/subscriptions.ts`,
`src/services/subscriptionService.ts`, `src/app/api/embed/subscriptions/route.ts`,
`packages/types`

## What the feedback says

`next-subscriptions` renders **exactly three controls**: one checkbox per `Available_Online`
publication. Legacy renders a campus filter, a keyword box, one checkbox per publication with
a Show/Hide Description toggle each, a **bulk-email opt-out**, and an Update button.

- **C55** — the *"Do not send me bulk email messages"* control is gone. It has not been
  deleted from the SDK — it moved to `next-profile`, wired to the same
  `Contacts.Bulk_Email_Opt_Out` field. So a member can still set it, **but only by loading a
  different widget**, which the host page may not have embedded, and which is a full
  profile-editing form rather than an email-preferences control.
- **C61** — no `congregation-id`. Legacy's `mpp-subscriptions` has **exactly one** supported
  option and this is it. The gap goes all the way down: the route reads no query params, and
  `SubscriptionService.getSubscriptions(contactId)` filters only on
  `Available_Online = 1 OR Available_Online IS NULL` — while **the doc comment two lines above
  it says "Get all available publications for given congregations"**. The intent was there;
  the parameter never was.
- **C53** — signed out, the widget heads its panel **"Unable to Load"**, which of the three
  widgets in C53 is the copy that reads most like an outage.

## Where the new widget is already better — protect this

**Ours saves per-toggle; legacy requires an Update Subscriptions button.** That is a genuine
improvement — unsubscribing should not require a second deliberate action — and it is why the
widget has no submit control. Any fix for C55 must preserve it: the opt-out gets its own
save-on-change with a toast, **not** a resurrected Update button.

## Phase 1 — C53, signed-out

Per `CROSS-1`. `loadSubscriptions()` (`:37-52`) sets `this.error` from any failure and the
render heads it "Unable to Load". Legacy's wording is *"Please login to view your
subscriptions."*

## Phase 2 — C55, the opt-out

### Why this is more than a moved control

"Stop emailing me" is the control a church is obliged to make easy, and the natural place a
member looks for it is the page that manages their email subscriptions. A church that embeds
`next-subscriptions` on a "Manage your email preferences" page — the obvious like-for-like
replacement for `subscriptions.aspx` — ships a page where a member can unsubscribe from each
publication one at a time but **cannot switch off bulk email at all**.

And it compounds with the roadmap: **C72 (`mpp-unsubscribe`, one-click unsubscribe) also has
no counterpart**, and the route refuses anonymous callers outright. Between the two, the new
catalogue has **no first-class "opt me out" surface** — see `ROADMAP-missing-widgets.md`, where
C72 is ranked first for exactly this reason.

### The fix

Add the opt-out as a **distinct row below the publication list, visually separated and clearly
global**. Legacy's flat placement invites misreading it as another publication; do not copy
that.

- `GET /api/embed/subscriptions` returns `{ subscriptions, bulkEmailOptOut }`.
- The toggle gets its own `PUT` (or an optional field on the existing one), with the same
  save-on-change-plus-toast behaviour the checkboxes already have.
- `subscriptionService.ts` reads and writes `Contacts.Bulk_Email_Opt_Out`; today it touches
  only `dp_Publications` and `dp_Contact_Publications`.

### Two decisions to make deliberately rather than by accident

**1. The copy.** *"Do not send me bulk email messages"* is a double negative next to a
checkbox — ticking a box to make something *not* happen. Prefer **"Send me general church
emails"**, checked by default, with the negation handled in code. Whatever is chosen, **use
the identical string in `next-profile`**, which currently has its own.

**2. Two widgets, one field.** Once both write `Bulk_Email_Opt_Out`, a page carrying both shows
stale state in one after the other saves. Either re-read on the `subscriptionsUpdated` /
profile-saved events, or — better — **have both read through one shared accessor**. See
`profile.md` Phase 3; this is a coordinated change across two files.

## Phase 3 — C61, congregation scoping

A multi-campus church puts this widget on each campus page and scopes it, so a Downtown
attender is not offered the North Campus newsletter. On ours every campus page shows the union
of every `Available_Online` publication in the domain, and **every subscribe is a real write
to `dp_Contact_Publications`** — so wrong choices are not cosmetic.

Add `congregation-id` to a new `observedAttributes`, pass it as `?congregationId=`, validate it
in the route, and thread it into the `dp_Publications` filter. **Keep the existing
`Available_Online` clause — congregation should narrow it, not replace it.**

**Check MP's schema before writing the filter.** `dp_Publications` may relate to congregations
through a join table rather than a column, in which case the filter needs `_TABLE` traversal
(see `.claude/references/ministryplatform.query-syntax.md`). Confirm how `mpp-subscriptions`
builds its own query rather than copying a guess.

*(Note for anyone re-measuring: legacy's sample page sets `target="./Subscriptions/"`, which is
dead — `target` is not in `observedAttributes` and never reaches a `getAttribute`. The sample
site does not demo the one option that exists. Read the bundle, not the page.)*

## What we should not port

Legacy's **keyword box** sits above three publications and its **campus filter** is a visitor
control. With a handful of publications, both are noise. `congregation-id` as an *attribute*
(pre-scoping by the embedding page) is the useful half; a visitor-facing campus dropdown is not.
Ship the attribute, skip the control, and record that as a deliberate non-port.

Legacy's **Show/Hide Description toggle per publication** is worth reconsidering rather than
copying: just show the description. A one-line description under a checkbox is what makes the
choice meaningful, and hiding it behind a toggle is a solution to a problem three publications
do not have.

## Do better than parity

- **A preferences page should say what each subscription actually is and how often it
  arrives.** `dp_Publications` carries descriptions; showing them by default (see above) turns
  a list of checkboxes into an informed choice.
- **Unsubscribing should be graceful, not silent.** Per-toggle save is already better than
  legacy; a brief *"You'll stop receiving the Weekly Update"* confirmation closes the loop.
- **This widget is the natural landing page for C72's one-click unsubscribe.** Legacy's
  `mpp-unsubscribe` takes a single attribute — `mysubscriptionswidgettargeturl` — pointing at
  exactly this page. When C72 is built, this widget is where it sends people, so an
  `unsubscribed=1` entry state that confirms what just happened and offers full preferences is
  worth designing now.

## Acceptance

- Anonymous load renders a sign-in prompt, not "Unable to Load".
- A member can turn bulk email off from this widget, with no submit button, and the change
  round-trips to `Contacts.Bulk_Email_Opt_Out`.
- The same string is used here and in `next-profile`, and a page carrying both does not show
  stale state after either saves.
- `congregation-id="3"` narrows the publication list server-side.
- Per-toggle saving is unchanged (regression guard — this is our advantage over legacy).

## Depends on / unblocks

C53 → `CROSS-1`. C55 coordinates with `profile.md` Phase 3 and is a prerequisite conversation
for C72 in `ROADMAP-missing-widgets.md`. C61 needs the `dp_Publications` schema question
answered first.
