# add-to-calendar — comparison test log

- **New**: `next-add-to-calendar` — http://localhost:5173/demo-add-to-calendar.html
  (page ships `<next-add-to-calendar event-id="1">`; reconfigured in-browser onto the
  test fixtures by replacing the element wholesale, per CONFIG-MAP §2 — the demo page
  itself was not edited)
- **Old**: **none.** One of only two genuinely new-only elements (CONFIG-MAP §3.1);
  `add-to-calendar-button` was removed from this repo on 2026-09-08 and
  `packages/embed-sdk/src/shared/calendar-links.ts` replaced it with in-house builders.
  Reference for correctness is therefore the provider URL templates, RFC 5545, and MP's
  raw values via client credentials.
- **Tested**: 2026-09-08 by subagent `events` (block C01–C09)
- **Auth state(s) tested**: signed out (the widget and its endpoint are public by
  design); the endpoint was also called with a decoded token to confirm `sub: "public"`
- **Scripts**: `…/scratchpad/events/13-atc.mjs`, `14-leak.mjs`, plus the MP helper `mp.mjs`

## What I tested

1. **Baseline render** on the demo page's own `event-id="1"`.
2. **A purpose-built escaping fixture** — an event whose title contains an **ampersand**
   and a **comma** and whose description contains an ampersand, a **comma**, a
   **semicolon**, a **newline** and an **HTML tag**:
   - `Event_Title`: `ZZTEST-Fall Fest & BBQ, Vol. 1`
   - `Description`: `Bring a dish & a friend, please.\nSecond line; with a semicolon, a comma & an <b>ampersand</b>.`
   - `Location_ID 1` → `Main Campus`, address `180 Dunbarton Dr, Florence, SC 29501-1991`
   - `Event_Start_Date 2026-10-17T17:30:00`, `Event_End_Date 2026-10-17T20:00:00` (MP wall clock)
3. **Every provider**, by stubbing `window.open` to capture the URL and
   `URL.createObjectURL` + `HTMLAnchorElement.prototype.click` to capture the `.ics`
   blob text without triggering a download — then **decoding each query string and
   checking every value**, not merely asserting a link exists.
4. **The timezone contract.** Resolved MP's domain zone (`Eastern Standard Time` →
   `America/New_York`, confirmed in the API payload's `Time_Zone` field) and checked the
   emitted instants by hand against EDT (UTC−4) on 2026-10-17.
5. **RFC 5545 conformance** of the generated `.ics`: line endings, escaping, folding,
   `DTSTART`/`DTEND`, absence of a `TZID` (and therefore of a required `VTIMEZONE`).
6. **Menu a11y** — trigger `aria-haspopup`/`aria-expanded`, menu `role`/`aria-label`,
   option roles, initial focus, arrow-key roving, Escape, outside-click.
7. **Provider narrowing** via the `providers` attribute.
8. **Non-public event exposure**, by requesting `Visibility_Level_ID = 2` events from
   the endpoint with an anonymous public token and comparing against the sibling
   `/api/embed/event-details/:id`.
9. **Responsive** at 390×844.

## Results

### Data and API

| # | Check | MP raw value | Endpoint returned | Verdict |
|---|---|---|---|---|
| 1 | Element upgrades, renders | — | trigger `Add to Calendar` with a chevron | **pass** |
| 2 | `Event_Title` | `ZZTEST-Fall Fest & BBQ, Vol. 1` | identical | **pass** |
| 3 | `Description` | contains `&`, `,`, `;`, `\n`, `<b>` | identical, verbatim | **pass** |
| 4 | `Event_Start_Date` / `_End_Date` | `2026-10-17T17:30:00` / `T20:00:00` | passed through as wall clock, no `Z` bolted on | **pass** |
| 5 | Location resolution | `Location_ID 1` → `Main Campus` → `Address_ID 1` | `Location_Name: "Main Campus"`, `Address_Line_1: "180 Dunbarton Dr"`, `City: "Florence"`, `State: "SC"`, `Postal_Code: "29501-1991"` | **pass** — `[State/Region]` bracketing works |
| 6 | Domain timezone shipped with the payload | `Eastern Standard Time` | `Time_Zone: "America/New_York"` | **pass** — client never has to guess |
| 7 | Non-public event (`Visibility_Level_ID = 2`) | should be refused | **`200`** with title, description and times for ids 759 and 758 | **FAIL → C06** |
| 8 | Same id via `/api/embed/event-details/759` | 404 | `404 {"error":"Event not found"}` | the correct behaviour, for contrast |

### Generated URLs — every value decoded and checked

Expected instants: 17:30 EDT = **2026-10-17T21:30:00Z**; 20:00 EDT = **2026-10-18T00:00:00Z**.

| Provider | URL / value | Verdict |
|---|---|---|
| **Google** | `https://calendar.google.com/calendar/render` · `action=TEMPLATE` · `text="ZZTEST-Fall Fest & BBQ, Vol. 1"` · `dates="20261017T213000Z/20261018T000000Z"` · `details="Bring a dish & a friend, please.\nSecond line; with a semicolon, a comma & an ampersand."` · `location="Main Campus, 180 Dunbarton Dr, Florence, SC, 29501-1991"` | **pass** — title, both instants, description and location all correct; `&` and `,` percent-encoded by `URLSearchParams`; `<b>` stripped |
| **Outlook.com** | `https://outlook.live.com/calendar/0/action/compose` · `path=/calendar/action/compose` · `rru=addevent` · `subject=…` · `startdt="2026-10-17T21:30:00Z"` · `enddt="2026-10-18T00:00:00Z"` · `body=…` · `location=…` | **pass** — extended ISO form, `path` present alongside `rru` (without it the route 404s) |
| **Microsoft 365** | `https://outlook.office.com/calendar/0/action/compose` · identical query | **pass** |
| **Yahoo** | `https://calendar.yahoo.com/` · `v=60` · `title=…` · `st="20261017T213000Z"` · `et="20261018T000000Z"` · `desc=…` · `in_loc=…` | **pass** |
| **Apple Calendar** | `.ics` download (identical bytes to `Other (.ics file)`) | **pass** |
| **Other (.ics file)** | see below | **pass** |

### The `.ics`, byte for byte

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//MPNext//Add to Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:next-event-761@mpnext.church
DTSTAMP:20260909T021627Z
DTSTART:20261017T213000Z
DTEND:20261018T000000Z
SUMMARY:ZZTEST-Fall Fest & BBQ\, Vol. 1
DESCRIPTION:Bring a dish & a friend\, please.\nSecond line\; with a semicol
 on\, a comma & an ampersand.
LOCATION:Main Campus\, 180 Dunbarton Dr\, Florence\, SC\, 29501-1991
END:VEVENT
END:VCALENDAR
```

| # | RFC 5545 check | Observed | Verdict |
|---|---|---|---|
| 9 | `DTSTART` correct instant | `20261017T213000Z` = 17:30 EDT | **pass** |
| 10 | `DTEND` correct instant | `20261018T000000Z` = 20:00 EDT | **pass** |
| 11 | UTC form, so no `TZID` and no `VTIMEZONE` needed | neither present, none needed | **pass** |
| 12 | Comma escaped in `SUMMARY` | `BBQ\, Vol. 1` | **pass** |
| 13 | Comma escaped in `LOCATION` (the classic address bug) | `Main Campus\, 180 Dunbarton Dr\, Florence\, SC\, 29501-1991` — one value, not a five-item list | **pass** |
| 14 | Semicolon escaped | `Second line\;` | **pass** |
| 15 | Newline escaped as `\n` | `please.\nSecond line` | **pass** |
| 16 | HTML flattened | `<b>ampersand</b>` → `ampersand` | **pass** |
| 17 | Ampersand **not** entity-escaped (correct — ICS is not XML) | `&` literal | **pass** |
| 18 | 75-octet folding with CRLF + single space | `…with a semicol` ⏎ `␣on\, a comma…`; unfolds to `semicolon` | **pass** |
| 19 | CRLF throughout + trailing break | every line `\r\n`, file ends `\r\n` | **pass** |
| 20 | Stable `UID` | `next-event-761@mpnext.church` — derived from the event id, so re-adding updates rather than duplicates | **pass** |
| 21 | Filename | `zztest-fall-fest-bbq-vol-1.ics` (slugified, punctuation-safe) | **pass** |

### Menu, a11y and configuration

| # | Check | Observed | Verdict |
|---|---|---|---|
| 22 | Trigger | `aria-haspopup="true"`, `aria-expanded` flips `false`→`true` | **pass** |
| 23 | Menu | `role="menu"`, `aria-label="Add ZZTEST-Fall Fest & BBQ, Vol. 1 to calendar"` | **pass** |
| 24 | Options | six `role="menuitem"` buttons: Google Calendar, Apple Calendar, Outlook.com, Microsoft 365, Yahoo Calendar, Other (.ics file) | **pass** |
| 25 | Initial focus | first option (`google`) focused on open | **pass** |
| 26 | Keyboard open | ArrowDown / Enter / Space on the trigger all open it | **pass** |
| 27 | Arrow-key roving with wrap | `moveFocus()` wraps at both ends | **pass** |
| 28 | Escape | closes and returns focus to the trigger | **pass** |
| 29 | Outside click | closes via `composedPath()` (correct for Shadow DOM retargeting) | **pass** |
| 30 | `providers="google,apple,outlook,office365,yahoo,ics"` | all six rendered, unknown ids dropped, empty result falls back to the default set | **pass** |
| 31 | `time-zone` attribute overrides the API zone | code path read; API zone was already correct so the override was not needed | **pass** (by inspection) |
| 32 | Console errors / API failures | only `User not authenticated.` ×2 (MPWidgets.js on an anonymous page); no API failures | **pass** |
| 33 | Responsive 390×844 | trigger + menu usable | **pass** |
| 34 | No CDN dependency | zero external requests from this widget | **pass** — the library removal is complete |

## Findings filed

- `C06-add-to-calendar-serves-non-public-events.md` — `/api/embed/add-to-calendar`
  filters on `Event_ID` alone, so an anonymous public token can read any event's title,
  description, times and venue address by id, including `Visibility_Level_ID = 2`
  events. The sibling `/api/embed/event-details/:id` correctly 404s the same id.
  **functional**

**Nothing else was filed against this widget.** The URL and `.ics` generation is
correct in every value I checked, including the escaping cases hand-rolled builders
usually get wrong.

## Where the new widget is better

There is no legacy counterpart, so all of it is new — but two things are worth calling
out against the thing it *replaced*:

- **No CDN, no SRI surface, ~438 KB less over the wire.** The previous implementation
  loaded jsDelivr's `dist/atcb.min.js`, a file that never existed in the npm tarball
  (jsDelivr minified it on the fly), so the pinned hash covered CDN-generated bytes.
  `calendar-links.ts` has no external dependency at all.
- **Escaping and folding are handled properly.** `escapeIcsText` escapes backslash
  first, then `;` and `,`, then newlines; `foldIcsLine` counts **UTF-8 octets**, not
  characters, and never splits a multi-byte character across a fold. Both were exercised
  with real punctuation, not asserted from the source.
- **The MP timezone contract is respected end to end.** The API ships the domain IANA
  zone in the payload rather than the client hardcoding one; `parseMpWallClock` uses a
  regex and deliberately ignores a bogus `Z` tag; `wallClockToUtc` does a two-pass
  offset lookup so a wall clock near a DST transition resolves to the right instant.

## Not tested / blocked

- **A DST-transition event.** The two-pass offset resolution in `wallClockToUtc` is the
  code most worth a boundary test (an event at 02:30 on a spring-forward date). No such
  event exists on MPI and creating one only to read back a query string was
  disproportionate; the EDT case was verified by hand and the second-pass branch is
  covered by the existing unit tests in the package.
- **Whether each provider actually accepts the URL.** Following the links would leave
  the test environment and, for Google/Outlook/Yahoo, require signing in to third-party
  accounts we do not have. The URLs were verified against each provider's documented
  template shape and every parameter value decoded and checked, but no calendar event
  was created on a real provider.
- **`.ics` ingestion by a calendar client.** The file was parsed and checked against
  RFC 5545 by hand; it was not opened in Apple Calendar or Outlook desktop.
- **`office365` is not in the default provider set.** `DEFAULT_PROVIDERS` is
  `["google","apple","outlook","yahoo","ics"]`
  (`packages/embed-sdk/src/components/add-to-calendar.ts:99`), so the working
  Microsoft 365 builder is unreachable unless an integrator opts in via `providers`.
  Noted rather than filed — it is a defensible default, not a defect, and there is no
  legacy behaviour to regress against.
- **Downloads in a published Artifact / sandboxed context.** Out of scope here; the
  blob download works on the demo page.

## MP fixture data

`ZZTEST-Fall Fest & BBQ, Vol. 1` (`Event_ID 761`) was created for the escaping test and
**deleted** at the end of the run. Full inventory, the two rows MP would not let the API
delete, and the recreate recipe are in `event-details.md`.

## Screenshots

- `add-to-calendar-new-initial.png` — baseline render (new-only widget, so there is no
  old-side pair; the reference is MP's raw values, quoted above)
- `add-to-calendar-new-menu-open.png` — all six providers, `role="menu"`, first option focused
- `add-to-calendar-new-mobile.png` — 390×844
- `add-to-calendar-new-private-event-759.png` — **C06**: a fully working menu for a
  `Visibility_Level_ID = 2` event, rendered with an anonymous public token
