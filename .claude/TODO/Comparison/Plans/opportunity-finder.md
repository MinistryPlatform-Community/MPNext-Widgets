# `next-opportunity-finder` — plan

**Items:** C20 (functional) · C22 (functional, shared) · C25 (functional)
**Cutover verdict: C22 blocks cutover; C25 puts wrong information on a public page.**
**Owns:** `packages/embed-sdk/src/components/opportunity-finder.ts`,
`src/services/opportunityFinderService.ts`

## What the feedback says

Attribute and result-set parity is **exact on every filter** — the Frequency filter correctly
separates One Time from Ongoing, and the same opportunities come back in the same order on
both systems. Three things around that are wrong.

- **C22** — the card is `div role="link" tabindex="0"` with a click-only listener and no
  anchor (`card.querySelector("a")` → `null`). Enter does nothing; Space does nothing. Legacy's
  card is *un-focusable* but its footer holds a real `<a href="./Opportunities/?id=5">`, so
  legacy works by keyboard and ours does not. **There is no second path to the detail page**,
  so this is a dead end rather than a degradation.
- **C20** — the **Attributes filter renders nothing at all**, because
  `getAttributeTypes()` filters on `ISNULL(Attributes.Available_Online, 1) = 1` and the MP
  `Attributes` table **has no `Available_Online` column**. MP answers
  `500 Invalid column name`, a bare `catch { return []; }` turns it into an empty list, and the
  component only renders the field when the list is non-empty. Legacy shows 19 attributes in
  two buckets (*Occupation*, *Spiritual Gifts*).
- **C25** — a one-time opportunity renders as `Main Congregation · Fridays` and its actual
  date appears nowhere. Legacy renders `Fri, Dec 31, 2027 12:00 AM`.

## Where the new widget is already better — protect these

- Filter and result parity is exact, verified against `api_MPPW_SearchOpportunities`.
- The `attribute-ids` **attribute** works correctly and forwards to `@AttributeIDs`, so a site
  owner can already hardcode a filter — only the visitor-facing control is missing.
- Tab order through the rest of the widget is sane.

## Phase 1 — C22, the card

Per `CROSS-3` §1. Render the CTA as a real anchor whose `href` is `buildDetailUrl(o.id)`
(`:377-389`) and let the card's click handler stay as a mouse convenience (`:227-236`); that
fixes keyboard, screen-reader naming, middle-click and copy-link in one change and drops the
need for `role="link"`/`tabindex` on the wrapper.

**Volunteer recruitment is exactly the surface a church is most likely to be asked about for
accessibility**, and this is unusual on the run in being *worse than legacy* rather than merely
different. The file's own comment says it was built on the `next-event-finder` model, which is
why C05, C10 and C22 are the same bug — one `cardLink()` primitive, three widgets.

## Phase 2 — C25, wrong information on a public page

`formatMeetingDay()` pluralises any `MeetingDay` that is not the literal `"Ongoing"`
(`return \`${meetingDay}s\``), and `formatMeetingTime()` deliberately returns `""` for a
midnight time — *"Skip midnight (no real time component on the opportunity)"* — which is
precisely the case for a date-only opportunity. Both halves of the date are therefore
discarded, and every non-ongoing opportunity in the catalogue is mislabelled the same way.

A volunteer reads "Fridays" and expects a recurring slot; the opportunity is a single Friday
**two years out**. That is not a formatting nit, it is a false statement on a public page.

**Fix: decide recurring-vs-dated from the data, not from the day string.** The service already
carries `meetingTime` (falling back to `StartDate`), so:

- `meetingDay === "Ongoing"` → `"Ongoing"`
- else if the parsed value is a real calendar date → render it with `Intl.DateTimeFormat`
  (`weekday: "short", month: "short", day: "numeric", year: "numeric"`), appending the time
  only when it is not midnight
- only pluralise the weekday when there is genuinely no date

Route the `Intl` call through the domain time zone per
`.claude/references/ministryplatform.datetimehandling.md`, and through the resolved locale once
`CROSS-5` lands.

**Dead code to remove while in `renderCard`:** the proc returns `RibbonText`, never `Featured`,
so the "Featured" badge branch is unreachable. Legacy does not render a ribbon either, so that
half is parity — but delete the dead branch rather than leaving it to look like a feature.

## Phase 3 — C20, the Attributes filter

Three separate things went wrong here and all three are worth fixing.

### 1. The query

Drop the `Available_Online` filter from `Attributes` — the column does not exist.

### 2. Do not simply un-filter, or the control gets worse than missing

An unfiltered query returns **19 rows across five attribute types**: 2 (*Occupation*),
3 (*Spiritual Gifts*), 4 (*Group Tags*), 5 (*Persona*), 1 (*Allergies & Special Needs*).
Legacy returns **only types 2 and 3**. Shipping the unfiltered set would put "Allergies &
Special Needs" and "Persona (Synthetic)" in a public volunteer filter — new, wrong, and in one
case a privacy-adjacent category.

The likely original intent is a filter on **`Attribute_Types.Available_Online`** —
`Attribute_Type_ID_Table.Available_Online = 1` via `_TABLE` traversal (see
`.claude/references/ministryplatform.query-syntax.md`). **Verify that column exists on
`Attribute_Types` before using it.** If it does not, restrict to the type ids legacy returns
and record why.

### 3. The bare `catch` is the actual defect

`catch { return []; }` hid a 500 for the entire life of the widget: no console error, no empty
dropdown, nothing in the network tab except a 200 config response with an empty array. Anyone
comparing the two finders would conclude the new one "has fewer filters".

**Make it log.** And treat this as a class: a swallowed catch that degrades a feature to
invisibility is the same failure shape as C40's swallowed payment error and C11's unread
attributes. A convention worth stating in `CLAUDE.md` alongside `CROSS-4`'s: *a catch that
returns an empty result must log at `error` with the underlying message.*

### Why it is worth the effort

A church that recruits volunteers by skill or spiritual gift loses the only control that does
that — and loses it *invisibly*.

## Do better than parity

- **The date fix (C25) is an opportunity to say more than legacy.** Legacy prints
  `Fri, Dec 31, 2027 12:00 AM` — including a meaningless midnight. Print the date without the
  fake time, and consider a relative hint (`in 3 weeks`) for near-term one-time opportunities.
  Both systems currently bury the most decision-relevant fact on the card.
- **The Attributes filter is the church's own vocabulary.** Once C20's type filter is settled,
  grouping options by `groupName` the way legacy does (*Occupation* / *Spiritual Gifts*) makes
  a 19-item list usable. An `<optgroup>` costs nothing.
- **`RibbonText` is returned and unused** on both sides — it carried `"1 hour"` in the fixture,
  which is exactly the kind of commitment-size information a volunteer wants before clicking.
  Neither system shows it. Cheap card win.

## Acceptance

- Enter and Ctrl-click open an opportunity from the result list; every card exposes an `href`.
- A one-time opportunity renders its date, not a pluralised weekday.
- The Attributes control renders, with the same option set legacy shows and no others.
- `getAttributeTypes()` logs on failure instead of returning `[]` silently.
- Every existing filter still returns identical result sets (regression guard).

## Depends on / unblocks

C22 follows `CROSS-3`. C25's locale half follows `CROSS-5` but should not wait for it — the
wrong-information bug is fixable today. C20 is independent, but **answer the
`Attribute_Types.Available_Online` question before writing the query.**
