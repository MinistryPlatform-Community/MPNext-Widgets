# `next-my-contribution-statement` + `next-statement-preferences` — plan

**Items:** C38 (ux — the split) · C34 (ux) · C62 (functional) · C30 (functional, shared) ·
C35 (ux, shared)
**Cutover verdict: C30 blocks cutover; C38 is the migration trap and should ship with it.**
**Owns:** `packages/embed-sdk/src/components/my-contribution-statement.ts`,
`packages/embed-sdk/src/components/statement-preferences.ts`,
`packages/embed-sdk/demo-my-contribution-statement.html`,
`src/app/api/embed/statement-preferences/route.ts`

**Two widgets, one plan** — C38 is precisely about the fact that they are two widgets where
legacy had one, so they cannot be planned apart.

## What the feedback says

Legacy `mpp-my-contribution-statement` does three jobs in one shadow root: the year picker
plus Save as PDF, the **Go Paperless** toggle, and a **link across to My Giving**. We ship the
first as `next-my-contribution-statement`, the second as a separate element
`next-statement-preferences`, and the third not at all.

- **C38** — nothing is broken *if the host page is updated*. The risk is entirely in the
  migration: the instruction changes from "paste one tag" to "paste two tags", and a church
  that swaps one-for-one ends up with donors who can download statements but **can no longer
  turn paperless on or off**, with no error and nothing hinting a control went missing. That
  invisibility is the failure mode.
- **C34** — "Save as PDF" calls `window.open(statement.Download_Url, "_blank", "noopener")`.
  A new tab, not a download, under a button labelled *Save as PDF*. Legacy fires a real
  download with the statement's own filename (`ZZTEST-Statement-2025.pdf`).
- **C62** — no `my-giving-widget-target-url` equivalent. Legacy's single option pointed the
  statement at the page hosting My Giving; ours accepts **no attributes at all**.
- **C30 / C35** — signed-out error panel on both widgets; zero headings on both.

## Where the new widgets are already better — protect these

- **We read `Statement_Method_ID` correctly and legacy does not.** With the same donor row set
  to each value in turn:

  | `Statement_Method_ID` | ours | legacy |
  |---|---|---|
  | 1 Postal Mail | unchecked ✓ | **checked ✗** |
  | 2 Email/Online | checked ✓ | checked ✓ |
  | 4 No Statement Needed | unchecked ✓ | **checked ✗** |

  Legacy renders the box checked unconditionally, so a donor on Postal Mail is shown
  "Go Paperless" as already on. **This is the reason C38 is `ux` and not `functional`, and it
  is a real improvement — do not lose it while re-uniting the widgets.**
- Writes agree exactly with legacy (`Statement_Method_ID` 1 / 2), and ours round-trips
  correctly (flip → `200 PUT` → reload → still flipped → MP agrees).
- The file the widget opens **is** the right one: `Download_Url` is byte-identical to what
  legacy requests, `200 application/pdf`, containing the expected content. C34 is delivery, not
  content.

## Phase 1 — C30 and C34

**C30** per `CROSS-1`. Both widgets: `my-contribution-statement.ts:38-66` / `:129-141` and
`statement-preferences.ts:32-60` / `:135-147`. Legacy's wording is *"Please login to view your
contribution statements."*

**C34 is a one-line fix.** Replace the `window.open` (`:96-107`) with an anchor click carrying
the filename: create `<a href={Download_Url} download={File_Name} rel="noopener">`, click it,
remove it. Same one-gesture behaviour as legacy, no popup, **and the file gets the statement's
real name instead of a GUID**. Keep the `statementDownloaded` event emit.

Why it is worth doing rather than renaming the button: `window.open` from a click usually
survives a popup blocker but not always — Safari on iOS and the Facebook and Instagram
webviews a church link gets opened in either block it or open a tab that cannot render a PDF,
and the donor gets a blank screen with no error and no fallback. Even where it works, a donor
pressing "Save as PDF" during tax season expects a file.

*(Recorded so nobody mistakes it for something we introduced: the statement URL is an
unauthenticated MP file GUID on **both** systems — an anonymous request returns
`200 application/pdf`. That is MP's design.)*

## Phase 2 — C38, close the migration trap

Two options; **take the second if it is cheap, and it should be.**

**Option A — document the pair.** Leave the split (it is a defensible decomposition), add
`<next-statement-preferences>` to `demo-my-contribution-statement.html` so the demo shows the
legacy page's full surface, and put the pair in the customer snippet in `vite.config.ts`.

**Option B (recommended) — have `next-my-contribution-statement` render the preferences control
itself**, behind an opt-out attribute (`hide-statement-preferences`), **reusing
`statement-preferences.ts` rather than duplicating it**. Then a one-for-one tag swap keeps
working, the separate element still exists for churches that want it on its own page, and
nothing is invisible.

Option B needs one route change: the `PUT /api/embed/statement-preferences` is scoped to
`widget: ["statement-preferences", "user-menu"]` and would need `"my-contribution-statement"`
adding.

Do Option A regardless — the demo and the snippet should show the full surface either way.

### The three-value field both systems get wrong

`Donors.Statement_Method_ID` has **three** meanings — `1` Postal Mail, `2` Email/Online,
`4` No Statement Needed — and both systems model it as a boolean. A donor sitting on
`4 = No Statement Needed` who touches the toggle is **silently moved to `1 = Postal Mail`**
(ours does this; so does legacy). Neither widget can express "no statement", and neither warns.

**Fix it while re-uniting the widgets:** a three-way radio (Postal Mail / Email · Online /
No statement). That is better than both systems, it removes a silent data rewrite, and it is
the natural moment to do it since the control is being touched anyway.

## Phase 3 — C62 and C35

**C62.** The statement is a per-year summary; My Giving is the per-donation detail. On the
legacy stack one attribute stitched them together, so a member who wants to know which gift
made up a line has one click. On ours the two pages exist with nothing joining them, and the
host site cannot place the link *inside* the widget's Shadow DOM.

Add a `my-giving-url` attribute (kebab-case house style — **do not copy the legacy spelling**),
render it as a link in the statement header or footer, hidden when absent so nothing changes
for hosts that do not set it. `next-event-details` already uses this pattern for
`opportunity-finder-url`.

**Cross-link the pair while in here.** If Option B is taken, `next-statement-preferences` on
its own page should equally be able to point back at the statement.

**C35.** Both widgets emit zero headings — `<div class="title">`, `<div class="company-name">`.
Swap the tags, keep the classes, add `font: inherit; margin: 0`. Give the
`statement-preferences` checkbox (`opacity: 0; width: 0`) a `:focus-visible` outline on its
paired `.slider`; it currently takes focus with nothing to draw around. See `CROSS-3` §3.

## Do better than parity

- **"Save as PDF" during tax season is the whole job.** Once C34 lands, the obvious next step
  is downloading *all* available years in one action — legacy makes you pick a year, download,
  come back, pick another. Two statements is the common case and neither system handles it.
- **The three-way statement method is the honest model.** Boolean "Go Paperless" is a lie the
  moment a donor has opted out entirely.
- **State what paperless actually means.** Ours reads the value correctly, which is already
  ahead — saying *"Your statements will be emailed to chris@example.com"* rather than a bare
  toggle makes the correctness visible to the donor.

## Acceptance

- Anonymous load of both widgets renders a sign-in prompt.
- "Save as PDF" downloads a file named after the statement; no tab opens.
- A one-for-one tag swap from `mpp-my-contribution-statement` retains the paperless control
  (Option B), or the demo and snippet document the pair (Option A).
- A donor on `Statement_Method_ID = 4` is not silently moved to `1`.
- `my-giving-url` renders a link; absent, nothing renders.
- Both widgets emit a heading outline.
- `Statement_Method_ID` reads correctly for all three values (regression guard — this is our
  advantage over legacy).

## Depends on / unblocks

C30 → `CROSS-1`. C35 → `CROSS-3`. Everything else independent. Option B is the only item that
touches a route.
