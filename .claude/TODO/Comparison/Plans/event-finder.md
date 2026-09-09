# `next-event-finder` — plan

**Items:** C05 (functional, shared) · C04 (functional) · C09 (cosmetic)
**Cutover verdict: C05 blocks cutover. It is the entry point of the whole events flow.**
**Owns:** `packages/embed-sdk/src/components/event-finder.ts`

## What the feedback says

Like the group finder, the **data is exact and the shell is not**. Old and new returned the
same 34 events in the same order with the same ids (set difference empty in both directions),
and every filter matches, each cross-checked against `api_MPPW_SearchEvents`: keyword
"Worship" 37/37, `congregationId=2` 0/0, `monthId=11` 10/10 with identical ids,
`ministryId=5` 0/0, `signUpTypeId=1` 1/1, Featured 0/0.

- **C05** — the card is `div role="link" tabindex="0"` with a click-only listener. Measured:
  nine consecutive tab stops are cards; with a card focused, **Enter navigates nowhere** (URL
  asserted unchanged). `See Details →` is a `<span>`, the card exposes no `href`. So a
  keyboard or screen-reader user can tab through all 34 results and open none of them, and the
  search → detail → register flow is closed to them at step one.
- **C04** — the Advanced panel has four controls where legacy has five. **Featured** is
  missing as a *control*: the capability exists only as markup an integrator sets once
  (`featured="true"` → `isFeatured=true`, verified at parity), so the visitor can never toggle
  it, and a page that hardcodes it locks the finder to featured events with no way back.
- **C09** — card dates omit the year. The default result set runs **Sep 12 2026 → Jan 3 2027**,
  so the last four of thirty-four cards are in a different year and the card gives the reader
  nothing to tell them apart.

## Where the new widget is already better — protect these

- Filter and result parity is exact against the proc. Do not disturb the query.
- The four advanced selects are correctly labelled and the keyword box carries
  `aria-label="Search events"` — **the card is the only a11y gap in this widget**.
- Both sides handle the same 34 events identically; there is no data work in this plan at all.

## Phase 1 — C05, the card

Per `CROSS-3` §1. `buildDetailUrl(e.id)` (`:163-176`) is already computed synchronously, so
the card body wraps in `<a class="nw-ef-card-link" href="${url}">`, `:focus-visible` styling
moves to the anchor, and `role`/`tabindex` are dropped from the wrapper (`:348`). Keep the
click listener (`:207-214`) only to `emit("eventSelected", …)`.

Where no `target-url` is configured, the current `role="article"` div is correct — leave it.

Note the contrast the item draws: `next-full-calendar`'s cards use a real
`<button class="nw-fc-card-learn-more">` and Enter works. **The pattern exists in our own
SDK; the finder is the outlier.** Same `cardLink()` primitive serves this, group-finder (C10)
and opportunity-finder (C22).

## Phase 2 — C04, the Featured control

The filter plumbing is correct and proven; only the control is missing. Add a **Featured**
checkbox to the Advanced grid alongside the four selects, seed it in `seedFromAttributes()`
from the existing `featured` attribute, read it in `readFormState()` into a `featured` state
field, and have `buildQuery()` prefer that state over the raw attribute — the same
seed-then-mutate pattern the other four filters already use, so **the attribute keeps working
as a default rather than a lock**.

That last clause is the fix's whole point. Today `featured="true"` is a one-way door.

Why it matters: "show me the featured events" is the one filter a church actually promotes,
and it is how the Featured flag on the event record is meant to pay off. The badge is
**already rendered on our cards** (`:338`), so a visitor can see that some events are featured
and has no way to narrow to them. That inconsistency is more annoying than not having the flag
at all.

**While in there, consider promoting Congregation back to the visible row.** Legacy keeps
Campus on the always-visible first row; we hide it behind "Advanced Search". Same control, one
click further away, on the filter a multi-campus church cares most about.

## Phase 3 — C09, the year

`formatDateRange()` (`:379-405`) uses `{ weekday: "short", month: "short", day: "numeric" }`
with no `year` (`:383`).

**Recommendation: include the year when it differs from the current year**, which keeps the
common case short and the ambiguous case unambiguous. Compute
`const thisYear = new Date().getFullYear()` and add `year: "numeric"` when either endpoint's
year differs (and in the cross-year range branch at `:402-404`). Always-on is a one-line
change if the extra width is acceptable and matches legacy exactly — either is defensible; the
current state is not.

This is the **only user-visible formatting regression found in this pair**, and the finder is
also the outlier *inside our own stack*: `next-full-calendar`'s modal prints
`Tue, Sep 1, 2026, 9:00 AM – …` and `next-event-details` prints
`Saturday, September 12, 2026, …`. Fold the consistency sweep into `CROSS-5`'s locale pass so
every `next-*` date agrees.

The item's own copy table (`Campus`/`Congregation`, `Key Word`, `Show Advanced`,
`Search Events`, `All Events`/`Both`, the empty state, the standing footer) is deliberately
folded into **C67** and belongs to `CROSS-5`. One row is worth arguing on merit there: legacy's
empty state (*"0 Events found. Please try again with different search criteria."*) tells the
visitor what to do; ours (*"No events found."*) does not — same call as the group finder's.

## Do better than parity

- **The finder is unpaginated and shows ~4 months in one scroll.** That is why C09 bites: a
  year boundary falls inside a normal result list roughly a third of the year. Rather than only
  fixing the date string, consider a **month or year separator row** in the list. It answers
  "when is the next Saturday service" far better than repeating the year on 34 cards, and
  neither system does it.
- **Featured deserves more than a checkbox.** Once the control exists, a "Featured" chip or a
  pinned featured row at the top of the results is a better use of a flag the church has
  deliberately set — and the badge markup already exists.
- **Both sides show only the sign-up type as a filter, never as card information.** A visitor
  cannot tell a registration-required event from a drop-in without opening it.

## Acceptance

- Enter and Ctrl-click open an event from the result list; every card exposes an `href`.
- A visitor can tick Featured, search, and untick it again, on a page that also sets
  `featured="true"`.
- A card dated January 2027 in a list starting September 2026 shows its year.
- All six filter parity checks still return identical ids (regression guard).

## Depends on / unblocks

C05 follows `CROSS-3`. C09's consistency half follows `CROSS-5`. C04 is independent. This
widget feeds `event-details.md`, which feeds `checkout-pay.md` — it is the front door of the
flow with the most breaking items behind it, so its card fix is worth taking early.
