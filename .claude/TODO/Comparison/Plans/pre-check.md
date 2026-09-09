# `next-pre-check` — plan

**Items:** C78 (functional) · touches C81/`CROSS-1` (signed-out) · `CROSS-4` (attribute naming)
**Cutover verdict: build in full. This is the least risky of the four Tier 1 widgets, not the
most — the premise that made it look risky is false.**
**Owns:**

- `packages/embed-sdk/src/components/pre-check.ts` (new)
- `packages/embed-sdk/demo-pre-check.html` (new)
- `packages/embed-sdk/src/index.ts` (register)
- `packages/embed-sdk/src/i18n/locales/{en,es,pt-BR}/events.ts` (new `preCheck` namespace)
- `packages/embed-sdk/src/i18n/locales/{en,es,pt-BR}/core.ts` (three new `errors.*`)
- `packages/embed-sdk/src/shared/base-widget.ts` (one `WIRE_CODE_KEYS` entry)
- `packages/types/src/pre-check.ts` (new) + `packages/types/src/index.ts`
- `src/services/preCheckService.ts` (new)
- `src/app/api/embed/pre-check/route.ts` (new: GET + POST + OPTIONS)
- `src/app/api/embed/pre-check/qr/route.ts` (new: GET + OPTIONS)
- `src/lib/qr/encode.ts` (new: pure QR encoder → SVG)
- tests: `preCheckService.test.ts`, `preCheckService.save.test.ts`, both `route.test.ts`,
  `encode.test.ts`, `components/pre-check.test.ts`

---

## Feasibility verdict — build in full

**The brief for this item (and C78 itself) rests on a false premise, and correcting it is the
single most important finding in this plan.** C78 says the flow is "inferred from endpoint
names"; the task brief adds that `/Api/EventsApi/...` "is MP's own server-side widget API… not
in the `mp-Widgets` repo and not available to us", so "every endpoint must be reimplemented
over the MP REST API."

The legacy server is in the repo, in full, with the stored procedure it calls:

| Legacy endpoint | Source | Lines |
|---|---|---|
| `GET /Api/EventsApi/GetMyEvents` | `PortalComponents/Controllers/Api/EventsApiController.cs` | 191-203 |
| `GET /Api/EventsApi/GetQRCode` | same file | 205-222 |
| `POST /Api/EventsApi/SavePreCheck` | same file | 224-243 |
| the read query | `DatabaseScripts/StoredProcedures/api_MPPW_GetPreCheckEvents.sql` | whole file |
| the write translation | `PortalComponents/Translators/EventParticipantTranslator.cs` | `ToEventParticipants`, 71-152 |
| the write | `PortalComponents/DataManagers/EventsManager.cs` | `CreateUpdateEventParticipants`, 109-167 |
| participant creation | `PortalComponents/DataManagers/ContactManager.cs` | `CreateParticipant`, 39-58 |
| the DTO | `PortalComponents/Models/EventPreCheck.cs` | whole file |

Nothing here is inferred. Four consequences, each of which removes a risk the roadmap
attributed to this item:

1. **`GetMyEvents` is not a reimplementation.** It is one call to `api_MPPW_GetPreCheckEvents`
   — an `api_MPPW_*` proc that ships in the *same* `DatabaseScripts/001-Changes.sql`
   registration block (lines 72-77) and the *same* `61 - API Role.sql` grant list (line 109)
   as eight procs **this repo already calls in production**: `api_MPPW_GetMyPledges`,
   `api_MPPW_GetContactInfo`, `api_MPPW_GetEventById`, `api_MPPW_GetEvents`,
   `api_MPPW_SearchEvents`, `api_MPPW_SearchGroups`, `api_MPPW_GetInvoice`,
   `api_MPPW_GetProduct`. Its parameter shape is identical to the one `myPledgesService.ts`
   already uses (`@DomainId` is injected by MP's `/procs` endpoint; the caller passes the
   rest). This is a *smaller* server task than `next-event-finder` was.
2. **`SavePreCheck` is plain table CRUD.** `Event_Participants` create + update, which is
   exactly `MPHelper.createTableRecords` / `updateTableRecords`. No proc, no invoice, no
   payment. `MPHelper`'s write params already carry `$userId`, which is the `onBehalfOfUserId`
   legacy passes so MP audits the write to the caller rather than to the API service user.
3. **The QR payload is a plain string and we have it.** `EventsApiController.cs:216`:

   ```csharp
   qrGenerator.CreateQrCode($"pre|{eventDate.ToShortDateString()}|{currentUserHouseholdId}",
                            QRCodeGenerator.ECCLevel.Q);
   ```

   No MP secret, no token, no server round-trip. It is `pre|`, a short date, and the household
   id. **The hard blocker C78 feared does not exist.** (One byte-level caveat and one consumer
   caveat survive — see *The QR ruling*.)
4. **The flow C78 caveated is confirmed exactly as the brief states it**, from
   `mpp-pre-check.js` (158 lines). No behaviour needs observing in a browser.

**The one thing that is not settled**, and the only gate on Phase 1: whether
`api_MPPW_GetPreCheckEvents` is installed and API-granted on a given customer domain. That is a
five-minute check (`MPHelper.getProcedures("PreCheck")` → `/procs?$search=`), it is the same
dependency the eight procs above already impose on every event and giving widget we ship, and
**if it fails there is a cheap fallback** — five plain REST reads and a cross product in
TypeScript (Phase 5). So even the gate does not threaten the item.

### What this means for the roadmap entry

`ROADMAP-missing-widgets.md` ranks C78 third of four on the strength of "no host-page
workaround exists" plus the QR unknown. The **severity** ranking stands; the **risk** ranking
does not. With the legacy server in hand this is a two-route, one-service, one-component widget
with a fully specified data model. Re-rank it as the first Tier 1 item to pick up if the goal is
a fast confidence win, and correct C78's "Caveat on confidence" section in the same commit.

---

## What legacy does

Read off `PortalComponents/ClientApp/Components/mpp-pre-check.js`.

1. **`eventDate` from the page's own query string** (`:14-17`).
   `new URLSearchParameters(window.location.search).get("eventDate")`, defaulting to
   `new Date()`, then **`.toISOString()`** — the classic MP day-shift, sent to a server that
   casts it back to a domain-zone date. A visitor west of UTC in the evening asks for tomorrow.
   See *Date/time handling*.
2. **Signed-in only** (`:62-73`). `UserService.GetCurrentUser()` resolves → the message
   `You are logged in as {name}`; rejects → `SetMessage("warning", "You need to log in", false)`
   and **no login control at all**. This is the C81 class in its purest form: the widget's
   entire function is unreachable and it offers nothing to fix that.
3. **QR first** (`:65-67`). `GetQRCode(eventDate)` → `{ imageBytes }` →
   `<img id="qrCode" width="250" height="250" src="data:image/jpg;base64, …">`. Note the
   literal space after the comma in the data URI, and that the bytes are a PNG
   (`PngByteQRCode`) labelled `image/jpg`. Both harmless, both accidental.
4. **`DrawForm()`** (`:87-132`). `GetMyEvents(eventDate)` → a flat array, one row per
   (household member × check-in event × group participation). Grouped in the UI by a
   `contactId` **change-detection** (`:98`) that assumes the server ordered by contact — it
   does (`ORDER BY C.Participant_Record`), but any reorder silently duplicates the name header.
5. **One checkbox per row**, `checked` when `isRegistered` (`:110-112`), and the name encodes
   the whole composite key (`:109`):

   ```js
   name = `check_${contactId}|${participantId}|${eventId}|${eventParticipantId}|${groupId}|${groupParticipantId}`
   ```

   Label = `hh:mm AM` (hardcoded `toLocaleString("en-US", …)` — legacy's own i18n never reaches
   it), then the event title, then `- {groupName}`, then `({roleName})`.
6. **Submit** (`:75-84`). `new FormData(form)` → `POST SavePreCheck?eventDate=` → success
   message + `DrawForm()` again. **`FormData` only carries checked boxes**, which is the whole
   protocol: the presence of a key means "attending", its absence means "not".
7. **No attributes.** `excludeFromConfigurator:!0`; the only `getAttribute` in the bundle is
   the universal `customCss`.

### The write, precisely (`EventParticipantTranslator.ToEventParticipants`)

For each submitted key, split on `_` then `|`, and:

- `Participation_Status_ID = 2` (Registered) always.
- `participantId == 0` → create a `Participants` row first (`ContactManager.CreateParticipant`,
  `:39-58`: `Contact_ID`, `Participant_Type_ID` from the `defaultParticipantType` config
  setting, `Participant_Start_Date` = domain now, `Notes = "Created by Web Widget"`).
- `eventParticipantId != 0` → it is an **update**; else a **create**.
- `groupId` / `groupParticipantId` written when non-zero.
- **Cancellations are derived, not submitted** (`:135-151`): re-read the same day's rows, and
  any row with an existing `Event_Participant_ID` that is *not* in the submitted set gets
  `Participation_Status_ID = 5` (Cancelled). **Rows are never deleted.** That answers the
  brief's "delete the row, or set a status" question definitively: **set a status.**

### Three legacy defects to fix rather than port

- **It will cancel an `Attended` record.** The cancellation set is computed with no regard for
  the current status, so a parent who opens the page after their child has been scanned in and
  unticks a box overwrites `3 Attended` with `5 Cancelled` — destroying attendance history.
  Guard on it (*Authorisation design*, rule 6). This is the one that must be fixed.
- **`Group_Participants.End_Date` is ignored.** The proc's `LEFT OUTER JOIN Group_Participants`
  has no `End_Date IS NULL OR End_Date > @EventDate` clause, so a child who left the 3rd Grade
  group last year still appears in it.
- **`Events.Cancelled` is ignored.** The proc filters on `[Allow_Check-in] = 1` and the date
  only, so a cancelled service still offers check-in.

The first is mandatory. The other two need a proc edit or the Phase 5 REST path; do them there
and record them as deliberate non-parity improvements.

---

## The MP data model

All of the following is confirmed against the live MP instance (`mpi.ministryplatform.com`)
with `mp_lookup` / `mp_query`, read-only.

### The read — `api_MPPW_GetPreCheckEvents(@DomainId, @HouseholdID, @EventDate)`

Two steps. First, the day's check-in events:

```sql
SELECT Event_ID, Event_Title, Event_Start_Date,
       CAST(CASE WHEN Search_Results = 3 THEN 1 ELSE 0 END AS bit),   -- aliased "Prohibit_Guests"
       Congregation_ID_Table.Time_Zone
FROM [Events]
INNER JOIN Congregations ON …
WHERE Domain_ID = @DomainId
  AND [Allow_Check-in] = 1
  AND CAST(Event_Start_Date AS date) = CAST(@EventDate AS date)
```

Then a **cross join** of the caller's household against those events, left-joined to group and
event participation:

```
Contacts C  (C.Domain_ID = @DomainId AND C.Household_ID = @HouseholdID)
  CROSS JOIN  @TodaysEvents E
  LEFT JOIN   Group_Participants GP ON GP.Participant_ID = C.Participant_Record
                                    AND GP.Group_ID IN (SELECT Group_ID FROM Event_Groups WHERE Event_ID = E.Event_ID)
  LEFT JOIN   Group_Roles GR        ON GR.Group_Role_ID = GP.Group_Role_ID
  LEFT JOIN   Groups G              ON G.Group_ID = GP.Group_ID
  LEFT JOIN   Event_Participants EP ON EP.Event_ID = E.Event_ID
                                    AND EP.Participant_ID = C.Participant_Record
WHERE (E.Prohibit_Guests = 0 OR GP.Group_Participant_ID IS NOT NULL OR EP.Event_Participant_ID IS NOT NULL)
ORDER BY C.Participant_Record, E.Event_Start_Date
```

Result columns → the widget's row shape (mapping per `EventsManager.cs:87-105`):

| Proc column | Type | Widget field | Notes |
|---|---|---|---|
| `Contact_ID` | int | `contactId` | grouping key |
| `Participant_Record` | int, **nullable** | `participantId` | `Contacts.Participant_Record`; null → create a Participant on save |
| `Display_Name` | nvarchar | `participantName` | `"Kehayias, Chris"` form |
| `Event_ID` | int | `eventId` | |
| `Event_Title` | nvarchar(75) | `eventName` | |
| `Event_Start_Date` | datetime | `eventStart` | **converted domain-zone → congregation-zone** by `dbo.dp_Convert_DateTime`; a wall-clock string with no zone marker |
| `Prohibit_Guests` | bit | *(not surfaced)* | **not** `Events.Prohibit_Guests` — it is `Search_Results = 3` |
| `Group_ID` / `Group_Name` | int / nvarchar, nullable | `groupId` / `groupName` | |
| `Group_Participant_ID` | int, nullable | `groupParticipantId` | |
| `Role_Title` | nvarchar(50), nullable | `roleName` | |
| `Event_Participant_ID` | int, nullable | `eventParticipantId` | |
| `Participation_Status_ID` | int, nullable | → `isRegistered = (id === 2)` | `EventsManager.cs:102` |

**Do not copy legacy's `(int)result[...].ToObject<long>()` on the nullable columns** — it
throws or yields `0` on null, which is why legacy's composite key is full of zeroes. Coerce to
`number | null` explicitly.

**The `Prohibit_Guests` naming trap.** `Events` really has a `Prohibit_Guests` boolean, and the
proc's alias of the same name is *not* it. It is `Search_Results = 3` =
`Checkin_Search_Results_Types` "Allow Expected Only (Show Expected Only)". Semantics: for such
an event, show a household member **only** if they are already a group participant of one of
the event's groups, or already have an `Event_Participant`. For types 1 and 2 show every
household member (they may check in as a guest). Confirmed:

| `Checkin_Search_Results_Type_ID` | `Search_Result_Type` |
|---|---|
| 1 | Allow Guests (Show Everyone) |
| 2 | Allow Expected Only (Show Everyone) |
| 3 | Allow Expected Only (Show Expected Only) |

If Phase 5 reimplements the read, this clause must come with it. It is the reason the widget
does not offer a toddler the High School class.

### The write — `Event_Participants`

Confirmed columns (`mp_lookup`), and the exact set legacy writes (`EventsManager.cs:113-150`) —
no more:

| Column | Create | Update | Value |
|---|---|---|---|
| `Event_Participant_ID` | — | **yes** (the key) | server-derived |
| `Event_ID` | yes | yes when non-zero | server-derived |
| `Participant_ID` | yes | yes when non-zero | server-derived |
| `Participation_Status_ID` | yes | yes | `2` Registered / `5` Cancelled |
| `Group_ID` | when known | when known | server-derived |
| `Group_Participant_ID` | when known | when known | server-derived |
| `Notes` | only when set | only when set | legacy leaves it null for pre-check |

`Participation_Statuses` on the live instance:

| ID | Status |
|---|---|
| 1 | 01 Interested |
| 2 | 02 Registered |
| 3 | 03 Attended |
| 4 | 04 Confirmed |
| 5 | 05 Cancelled |
| 20 | 20 Abandoned |
| 21 | 21 Awaiting Payment |

So: **`2` on check, `5` on uncheck.** Never a delete. Matching
`PortalComponents/Models/EventParticipant.cs:21-30` exactly.

`Event_Participants` also carries `Time_In`, `Time_Confirmed`, `Time_Out`, `Room_ID`,
`RSVP_Status_ID` and `Check-in_Station`. **Write none of them.** `Time_In` is the check-in
station's to set; writing it from a widget would make a pre-check look like an attendance.

### Live-instance fixtures (use these; they exist)

- **Household 5 is a purpose-built check-in fixture**: contacts 9/11/12/13/14 —
  `Check-me-in, Daddy` (head, participant 4), `Mommy` (head, 5), `FemaleChild` (6),
  `BabyBoy` (7), `BabyBoy2` (8).
- Check-in events exist: `Events` 70-77 (`Sunday Religious Education Classes`, 09:00) and
  103-109 (`Tuesday Religious Education Classes`, 19:00), all `[Allow_Check-in] = 1`,
  `Search_Results = 3`, congregation zone `Eastern Standard Time`. **All are 2025 dates** — so
  the demo must point `event-date` at one of them, which is the strongest single argument for
  the attribute existing at all (*Attribute surface*).
- Those events' `Event_Groups` are the graded groups (`Sunday - Grade 01`…`Grade 05`,
  `Middle School (Grades 6-8)`, `High School (Grades 9-12)`; `Tuesday - Grade K`…).
- **A two-row edge case is already in the data**: participant 6 is in `Group_Participants` for
  both group 43 (`3rd Grade`, `Group Member`) and 39 (`Pre-K`, `Guitar Player`). If both groups
  are ever `Event_Groups` of one event, the proc emits **two rows for the same (contact,
  event)** sharing one `eventParticipantId` and differing in `groupParticipantId`. Legacy
  handles this by accident and badly. Handle it deliberately: rule 7.
- **`Event_Participants` is empty for household 5**, so `isRegistered` is false everywhere and
  the un-check path has no natural fixture. Phase 3's tests must construct one in memory rather
  than expecting live data.
- `Allow_QR_Check_In = false` / `Allow_Fastpass = true` on these events — relevant to the QR
  ruling below.

---

## The QR ruling

**Build it, own the encoder, and ship it off by default.**

### What is encoded — settled

`pre|{eventDate.ToShortDateString()}|{householdId}`, ECC level Q
(`EventsApiController.cs:216`). Plain text. Nothing signed, nothing secret, no server state. So
a QR we generate is byte-identical to MP's given the same date and household — subject to one
caveat:

**`.ToShortDateString()` is culture-dependent.** On MP's own widget servers that is en-US
`M/d/yyyy` with no leading zeros (`5/18/2025`), and that is what to emit. **Derive it by
splitting the `YYYY-MM-DD` string and stripping leading zeros — never
`Date.prototype.toLocaleDateString`**, which follows the *Node process* locale and would
silently emit `18/05/2025` under a different `LANG`. Pin the format and unit-test it
(`"2025-05-18" → "5/18/2025"`, `"2025-11-05" → "11/5/2025"`).

### Who consumes it — not settled, and this is the honest limit

The scanner is MP's Check-In Suite, which is not in this repo and not reachable from here. Two
things are worth stating precisely:

- It is **not** MP's `Events.Allow_QR_Check_In` / `Events.QR_Redirect_Url` feature. Those
  columns exist on `Events` today and are a *URL redirect* mechanism — a newer, different
  design — and on the sample domain's own check-in events they are `false`, with
  `Allow_Fastpass = true` instead. So the `pre|…` payload belongs to an older barcode path and
  may or may not still be honoured by a current station.
- **We cannot verify a scan without a physical station.** That is the residual risk, and it is
  a *verification* risk on one feature, not a feasibility risk on the widget.

### Therefore

**Ship the pre-check submission unconditionally, and the QR behind `show-qr` defaulting to
`false`.** The submission carries most of the value on its own: it writes real
`Event_Participants` rows at status Registered, which is what puts a family in the station's
*expected* list and is what actually shortens the Sunday queue. The QR is a convenience on top
of a mechanism that works without it. A church that has confirmed its station scans `pre|…`
turns it on with one attribute; every other church gets a working widget instead of a dead QR
image that support has to explain.

### The encoder — server-side, no dependency

Per `CLAUDE.md`'s standing rule and the `add-to-calendar-button` precedent
(`shared/calendar-links.ts`), **no new npm or CDN dependency.** Put it server-side, in
`src/lib/qr/encode.ts`:

- Byte mode, ECC level Q, versions 1-10, mask evaluation per ISO/IEC 18004. A `pre|…` payload
  is ~14-16 bytes so version 1-2 covers it; the range is headroom.
- Pure function
  `encodeQrSvg(text: string, opts?: { moduleSize?: number; margin?: number }): string` → an
  `<svg>` string. ~350 lines, no I/O, no DOM.
- **Server-side rather than in the SDK** for three reasons: the SDK bundle stays unchanged
  (this repo content-hashes it and ships it to every church site), the shape matches legacy's
  "the server returns the image", and it is trivially unit-testable against the reference
  vectors in the spec.
- Return **SVG markup in JSON**, not base64 PNG and not an image response. `<img src>` cannot
  carry a `Bearer` header, so an image response forces a blob URL and its revoke lifecycle; and
  we generate the markup ourselves, so injecting it into the shadow root is not an
  untrusted-HTML question. Crisp at any size, ~1KB.

---

## The authorisation design

This is the most important part of the plan. The legacy protocol hands the client a composite
key and takes it back on submit, and **the legacy server parses it and writes it without a
single check** (`EventParticipantTranslator.cs:76-127`: `int.Parse` on six client-supplied
fields, straight into `Event_Participants`). A signed-in MP user could pre-check *any* contact
into *any* event, or cancel a stranger's registration, by editing a checkbox name. **Do not
port the protocol. Port the feature.**

### The rule

**The client never sends an id. The client sends a selection over a set the server computed.**

1. **Identity comes only from the JWT.** `requireWidgetAuth(req, { widget: "pre-check" })` →
   `claims.sub` (an MP `User_GUID`). Reject `claims.sub === "public"` with `auth_required`.
   Resolve with `HouseholdService.resolveUser(guid)` — the established path:
   `dp_Users.User_GUID` → `Contact_ID` → `Contacts.Household_ID`. No `householdId`, `contactId`
   or `participantId` is ever read from the request. If `householdId` is null →
   `household_not_found`.
2. **The GET emits a `rowKey` per row**, computed server-side, in a fixed order:
   `${contactId}|${participantId ?? 0}|${eventId}|${eventParticipantId ?? 0}|${groupId ?? 0}|${groupParticipantId ?? 0}`
   — the legacy composite, kept **only** as a stable row identity so the widget has something
   to put in a checkbox `value`. It is not trusted on the way back.
3. **The POST body is `{ eventDate, selected: string[] }`.** Nothing else. Not a `FormData` of
   encoded ids.
4. **The POST re-derives the whole legal set** by calling the *same* service read with the
   *same* `(householdId, eventDate)`, and builds `Map<rowKey, PreCheckRow>`. Every submitted
   string must be a key of that map. Any that is not → **`403 invalid_pre_check_selection`**,
   and **nothing is written** — fail the whole request, do not filter silently. A mismatch
   means either an attack or a stale page, and both want a visible outcome.
   *Whole-key matching is the point*: a caller who keeps their own `contactId` and swaps in
   another event's `eventId` produces a key that is not in the map.
5. **Every id written comes from the map's row, never from the parsed string.** After step 4 the
   client's contribution is reduced to a set of booleans. State that invariant in a comment and
   assert it in a test.
6. **The cancellation set is derived, never submitted** — rows in the map with a non-null
   `eventParticipantId` that no submitted key selected. **And unlike legacy, skip any whose
   current `Participation_Status_ID` is `3 Attended` or `4 Confirmed`.** A station has already
   acted on those; a parent unticking a box must not erase attendance. Report them back as
   `locked` so the widget renders them checked and disabled rather than appearing to lose the
   user's change.
7. **Deduplicate by `eventParticipantId` before writing.** The two-groups case (participant 6,
   above) yields two rows sharing one `eventParticipantId`. Write **one** record per distinct
   `(eventId, participantId)`; if the selected rows for a pair disagree on group, take the first
   in the server's order. Never emit two updates for one `Event_Participant_ID` in one batch.
8. **Participant creation is server-side and household-scoped.** A row with
   `participantId === null` needs a `Participants` row (legacy `CreateParticipant`). Create it
   for the *map row's* `contactId` only — which is by construction a member of the caller's
   household. `Participant_Type_ID` from `ConfigSettingsService` (confirm a
   `defaultParticipantType` equivalent exists; if not, resolve `Participant_Types` by name once
   and hold the id as a named constant rather than a bare literal).
   `Participant_Start_Date` via `DomainTimezoneService.toMpSqlDatetime(new Date())`.
9. **Audit the write to the caller.** Pass `$userId` (the resolved `dp_Users.User_ID`) to
   `createTableRecords` / `updateTableRecords`, mirroring legacy's `onBehalfOfUserId`. Without
   it MP records the API service user and the church's audit trail says nobody did it.
10. **Rate-limit the write per user**, not per IP — a household shares an IP with itself:
    ``checkRateLimit(`precheck:${claims.sub}`, 20)`` → `rate_limited`.
11. **Reject a date outside a sane window** — more than 1 day in the past or more than 90 days
    ahead → `pre_check_closed`. Cheap, and it removes "walk the calendar backwards writing
    Cancelled over a year of attendance" as a shape.

### Why not seal the row key

`crypto.seal` (`src/lib/embed/crypto.ts`) would make the key unguessable, and it is
**unnecessary**: the server re-derives the authoritative set on every POST, so an unguessable
key adds nothing a membership test does not already give — and it adds a key-rotation failure
mode to a page a parent may leave open for an hour. Stated here so nobody adds it later
thinking it was overlooked.

### What a signed-in attacker can and cannot do

| Can | Cannot |
|---|---|
| Pre-check and un-check their **own household** members for any check-in event on a chosen date — which is the feature | Touch any contact outside their household: the map is built from `Household_ID` |
| See their household's group memberships and roles for that day | Enumerate events beyond MP's own `Search_Results` visibility rule |
| Replay a stale page and get a clean `invalid_pre_check_selection` | Erase an `Attended` / `Confirmed` record (rule 6) |
| Mint a QR for their own household | Mint a QR for another household — the id comes from the session |
| — | Delete an `Event_Participants` row at all (status only) |
| — | Write `Time_In`, `Room_ID` or `Check-in_Station` |
| — | Create a `Participants` row for a contact outside their household (rule 8) |
| — | Exceed 20 saves per minute (rule 10) |

---

## Attribute surface

Legacy takes none and reads the *host page's* query string. That is a poor fit for a widget
embedded on a church's own site — the church controls the page, not the query string, and
`?eventDate=` collides with whatever else the CMS puts there. Kebab-case per `CROSS-4`.

| Attribute | Legacy behaviour | Required? | Meaning |
|---|---|---|---|
| `event-date` | none; read from `window.location.search` `?eventDate=`, then ISO-stringified | no — defaults to **today in the MP domain zone, resolved server-side** | `YYYY-MM-DD` wall-clock date. Rejected by the route unless it matches `/^\d{4}-\d{2}-\d{2}$/` |
| `read-query-string` | implicit, always on | no — default `false` | Opt in to the legacy `?eventDate=` fallback, for a church porting a page that already links with that parameter. Off by default: silently obeying an arbitrary URL parameter is a surprise on a shared page |
| `allow-date-picker` | none | no — default `false` | Render a date input so a visitor can move between days without a new URL. Not a legacy feature; the honest replacement for the query string |
| `show-qr` | QR always rendered | no — **default `false`** | Render the check-in QR. Off by default per *The QR ruling* |
| `api-host` | n/a | no | Standard across the SDK |
| `customcss` | universal legacy option | — | **Not ported.** `CROSS-5` owns theming |

Date resolution order, highest first: `event-date` → `?eventDate=` (only when
`read-query-string="true"`) → the server's domain-zone today.

**C39 compliance.** `observedAttributes = ["event-date", "read-query-string",
"allow-date-picker", "show-qr"]`, and `attributeChangedCallback` guards on
`oldValue !== newValue` **only** — never `oldValue !== null`. Re-render through a
`reconfigure()` that is a no-op before first render, per `CROSS-4`'s proposed convention, with
a `hasRendered` flag set at the end of `connectedCallback`. Setting `event-date` from script on
a mounted widget must reload it; that is a test.

---

## Server

### `src/services/preCheckService.ts`

Singleton, `getInstance()`, wraps `MPHelper`. Never called from anywhere but the two routes.

```ts
export interface PreCheckRow {
  rowKey: string;              // canonical composite; identity only, never trusted inbound
  contactId: number;
  participantId: number | null;
  participantName: string;
  eventId: number;
  eventName: string;
  eventStart: string;          // MP wall-clock, congregation zone, no zone marker
  groupId: number | null;
  groupName: string | null;
  groupParticipantId: number | null;
  roleName: string | null;
  eventParticipantId: number | null;
  participationStatusId: number | null;
  isRegistered: boolean;       // participationStatusId === 2
  isLocked: boolean;           // participationStatusId === 3 || 4
}

export class PreCheckService {
  static getInstance(): Promise<PreCheckService>;

  /** Domain-zone "today" as YYYY-MM-DD. Never the browser's idea of today. */
  resolveDefaultEventDate(): Promise<string>;

  /** Cheap probe so the route can answer `precheck_unavailable` rather than a 500. */
  isAvailable(): Promise<boolean>;                       // MPHelper.getProcedures("PreCheck")

  /** The read. `eventDate` is YYYY-MM-DD, wall clock. */
  getPreCheckRows(householdId: number, eventDate: string): Promise<PreCheckRow[]>;

  /** The write. `selected` is validated against a fresh read *inside* this method. */
  savePreCheck(args: {
    householdId: number;
    userId: number;             // dp_Users.User_ID, for $userId auditing
    eventDate: string;
    selected: string[];
  }): Promise<{ registered: number; cancelled: number; locked: string[] }>;

  /** `pre|M/d/yyyy|householdId` — the exact legacy payload. */
  buildQrPayload(householdId: number, eventDate: string): string;
}
```

`getPreCheckRows` = one
`executeProcedure("api_MPPW_GetPreCheckEvents", { "@HouseholdID": householdId, "@EventDate": eventDate })`
plus a null-safe map. `savePreCheck` implements authorisation rules 4-9 in that order and
returns counts, not records.

### `GET /api/embed/pre-check`

- Query: `?eventDate=YYYY-MM-DD` (optional).
- Auth: `requireWidgetAuth(req, { widget: "pre-check" })`; `claims.sub === "public"` → 401
  `auth_required`.
- 200 body:

  ```jsonc
  {
    "eventDate": "2025-05-18",
    "timeZone": "America/New_York",   // IANA, from getMpTimezone(); the widget formats with it
    "householdId": 5,                  // echo only; the widget never sends it back
    "members": [                       // grouped server-side — no client-side change detection
      { "contactId": 12, "participantName": "Check-me-in, FemaleChild",
        "rows": [ /* PreCheckRow minus contactId / participantName */ ] }
    ]
  }
  ```

  Grouping server-side kills legacy's `contactId` change-detection bug (`:98`) outright.
- Errors: `auth_required` (401) · `invalid_request` (400, bad date) · `household_not_found`
  (404) · `precheck_unavailable` (503) · `internal_error` (500).

### `POST /api/embed/pre-check`

- Body: `{ eventDate: string, selected: string[] }`, Zod-validated
  (`PreCheckSaveRequestSchema` in `packages/types`). `selected` capped at 500 entries.
- Auth as above, plus ``checkRateLimit(`precheck:${claims.sub}`, 20)``.
- 200 body: `{ registered: number, cancelled: number, locked: string[] }`.
- MP tables written: **`Event_Participants`** (create + update) and, only when a household
  member has no `Participant_Record`, **`Participants`** (create). Exact column sets in *The
  write* above. Nothing else is written, ever.
- Errors: `auth_required` (401) · `validation_failed` (400) · `invalid_request` (400) ·
  `household_not_found` (404) · `invalid_pre_check_selection` (403) · `pre_check_closed` (409)
  · `rate_limited` (429) · `precheck_unavailable` (503) · `save_failed` (500).

### `GET /api/embed/pre-check/qr`

- Query: `?eventDate=YYYY-MM-DD` (optional).
- Auth as above. 200 body: `{ svg: string, eventDate: string }`.
- Household id comes from the session, so **the QR cannot be minted for another household**.
- Errors: `auth_required` · `invalid_request` · `household_not_found` · `internal_error`.

### Which MP credential

**Client-credentials `MPHelper`, not the user's own MP token.** `getMpUserAccessToken(claims)`
is used by exactly three routes in the tree (`invoices`, `invoices/[invoiceId]`,
`profile/change-password`) — cases where MP's own row-level security must apply. Here it must
*not*: the widget legitimately writes `Event_Participants` for other contacts (a parent's
children), which a congregant's own MP token may not permit, and legacy ran the same way (its
`ApiClient` is the API-client identity plus `userId:` for audit). Authorisation is ours to
enforce and the design above is where it is enforced; `$userId` supplies the audit trail.

### Complete list of error codes this widget introduces

Three new catalogue entries (`errors.*`, all three locales) and one `WIRE_CODE_KEYS` alias:

| Wire code | Catalogue | Status |
|---|---|---|
| `precheck_unavailable` | **new** `errors.precheck_unavailable` | 503 |
| `invalid_pre_check_selection` | **new** `errors.invalid_pre_check_selection` | 403 |
| `pre_check_closed` | **new** `errors.pre_check_closed` | 409 |
| `save_failed` | **new alias** in `WIRE_CODE_KEYS` → existing `errors.saveFailed` | 500 |
| `auth_required` | existing (`WIRE_CODE_KEYS` → `errors.authRequired`) | 401 |
| `household_not_found` | existing `errors.household_not_found` | 404 |
| `validation_failed` | existing `errors.validation_failed` | 400 |
| `invalid_request` | existing (`WIRE_CODE_KEYS` → `errors.invalidRequest`) | 400 |
| `rate_limited` | existing (`WIRE_CODE_KEYS` → `errors.rateLimited`) | 429 |
| `internal_error` | existing (`WIRE_CODE_KEYS` → `errors.generic`) | 500 |

`i18n/error-codes.test.ts` fails until the three new ones exist in `en`, `es` and `pt-BR`.

---

## Widget

`packages/embed-sdk/src/components/pre-check.ts`,
`customElements.define("next-pre-check", …)`, registered in
`packages/embed-sdk/src/index.ts`. Extends `MPNextWidget`.

```ts
connectedCallback() {
  this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
  void this.initLocale().then(() => {
    this.render();
    this.hasRendered = true;
    this.load();
  });
}

disconnectedCallback() {
  super.disconnectedCallback();   // mandatory — locale listener + MutationObserver
  // ... own cleanup
}
```

### States

| State | Render |
|---|---|
| `loading` | Heading + `preCheck.loading`, and a muted skeleton of the real list per `CROSS-1` Phase 2 |
| `needs-auth` | The shared sign-in panel via `requestLogin("pre-check")`, **mode-aware**: in `dual`/`hardened` a real Sign In button; in `legacy` instructional copy and **no button**. Set only when the response is `401` and the token's `sub` is `public` — never inferred from a message string. Legacy rendered a dead `You need to log in` here; this is the single biggest improvement in the widget |
| `list` | Optional date control (`allow-date-picker`), optional QR panel (`show-qr`), then one section per household member with a checkbox per row: time, event title, `- group`, `(role)`. Locked rows checked + `disabled` + `preCheck.attendedLocked`. Submit button |
| `saving` | Submit disabled, `common.saving` |
| `saved` | `preCheck.savedCount` (plural) then reload the list. Never leave the old checkbox state on screen — the server is the truth |
| `no-events` | `preCheck.emptyNoEvents`, naming the date. **Not an error** — a Tuesday has no Sunday classes and that is normal |
| `no-household` | `errors.household_not_found` |
| `error` | `this.errorText(payload)` + `common.retry`. `retry` **only** for 5xx and network faults, per `CROSS-1` |

Events emitted (`this.emit`): `preCheckLoaded`, `preCheckSaved`, `preCheckError`.

### i18n — `events.preCheck` in `locales/{en,es,pt-BR}/events.ts`

`en` defines the shape; `es` and `pt-BR` `satisfies Messages`. Reuse before adding:
`common.submit`, `common.saving`, `common.retry`, `common.signIn`, `fields.date`,
`errors.household_not_found`.

```ts
preCheck: {
  title: "Pre Check-In",
  intro: "Check your family in before you arrive.",
  loading: "Loading your family's events…",
  emptyNoEvents: "There are no check-in events on {date}.",
  signedOutPrompt: "Sign in to check your family in.",
  dateLabel: "Date",
  selectAll: "Select all",
  clearAll: "Clear all",
  attendedLocked: "Already checked in",
  qrTitle: "Your check-in code",
  qrHelp: "Show this code at the check-in station.",
  qrUnavailable: "The check-in code is not available right now.",
  savedCount: {
    one: "{count} person is checked in for {date}.",
    other: "{count} people are checked in for {date}.",
  },
  cancelledNote: "Anyone you unchecked has been removed.",
}
```

**Plural coverage.** `savedCount` needs `one`/`other` for `en`, and **`one`/`other`/`many` for
both `es` and `pt-BR`** — both report `many` (whole millions) from `Intl.PluralRules`, and a
two-branch plural fails `catalogue-parity.test.ts` for them. `count` can never reach a million
here, but the parity test does not know that and should not have to.

**Row labels are composed structurally, not from one interpolated key.** Build the row from
`fmt` (the time), the event title, the group name and the role, each in its own element — do
**not** add `rowLabel: "{time} {event} - {group} ({role})"`. Punctuation and ordering differ
across the three locales, and MP-authored titles and group names are **not translatable**
anyway (say so in the migration notes, per `CLAUDE.md`).

**Zero hardcoded English.** `BUDGET` in `no-english-literals.test.ts` is empty and stays empty:
this widget lands at 0 on its first commit, with no budget entry.
`MPNextEmbed.enablePseudoLocale()` must show no plain-ASCII string anywhere in the widget.

**There is no legacy label seed for this widget, and that is the one place it costs more than
its siblings.** `S:\MP\mp-Widgets\DatabaseScripts\ApplicationLabels\` carries 38 files including
`mpp-event-details.json`, `mpp-event-finder.json` and `mpp-event-registration.json` — and **no
`mpp-pre-check.json`**, exactly consistent with `excludeFromConfigurator:!0`. (Legacy's own
`new I18N("mpp-pre-check")` at `mpp-pre-check.js:23` therefore resolved against nothing, which
is why every string in the widget is a hardcoded English literal in the source.) So:

- **The `es` and `pt-BR` copy is ours to write from scratch** — there is no MP-authored
  translation to lift, unlike the other three Tier 1 widgets. Budget a real translation pass;
  do not machine-translate and ship.
- **Reuse before inventing.** `events.ts` already exists in all three locales with
  `eventFinder` / `eventDetails` / `fullCalendar` / `addToCalendar`, and `core.ts` carries
  `common.*` / `fields.*` / `errors.*`. The list above is deliberately short for that reason:
  the submit control, the retry, the sign-in prompt and the date label all come from existing
  keys, so `preCheck` adds only copy that is genuinely specific to pre-check.
- Run `pnpm i18n:check` and `pnpm i18n:sync` at the end of Phase 2 so the new namespace enters
  the staleness baselines in `packages/embed-sdk/i18n-sources/` with the translation, not a
  release later.

### `packages/embed-sdk/demo-pre-check.html`

Copy `demo-my-household.html`'s shape: the `next-user-menu` auth header, the widget in a hidden
container revealed on token detection, the event log, the Widget Code block, the
`__UNIVERSAL_SETUP__` card. **Point it at a real fixture date** — the sample domain's check-in
events are 2025 dates, so the demo tag is
`<next-pre-check event-date="2025-05-18" show-qr="true">`, with a commented `<next-pre-check>`
showing the attribute-free production form. Without the attribute the demo shows an empty state
on every day of the year, which is exactly how a reviewer concludes the widget is broken.

---

## Date/time handling

Per `.claude/references/ministryplatform.datetimehandling.md`. This widget is the item's second
sharpest edge after authorisation, and legacy gets it wrong.

**Legacy's bug, stated plainly.** `mpp-pre-check.js:16-17` does
`new Date(queryDate).toISOString()`. `?eventDate=2025-05-18` becomes
`2025-05-18T04:00:00.000Z` for a browser in `America/New_York` — and for a browser in
`Pacific/Honolulu` at 9pm Saturday, "today" becomes Sunday. The server then
`CAST(@EventDate AS date)`s it back. The day the visitor gets is a function of their own
timezone and the hour they opened the page.

**The rules here.**

1. **The wire type for a date is `YYYY-MM-DD` and nothing else.** No `T`, no `Z`, no offset.
   The route validates `/^\d{4}-\d{2}-\d{2}$/` and rejects anything else with
   `invalid_request`. A wall-clock date is a string; making it a `Date` is what breaks it.
2. **"Today" is resolved on the server, in the domain zone**, by `resolveDefaultEventDate()`
   formatting `new Date()` through
   `Intl.DateTimeFormat("en-CA", { timeZone: await getMpTimezone() })` (which yields
   `YYYY-MM-DD`). Never `new Date().toISOString().slice(0, 10)`, and never the browser's date.
   This is a straight fix of the legacy defect and it is free.
3. **The proc parameter is the raw string.** `@EventDate` is `datetime` and the proc
   `CAST(… AS date)`s both sides, so `"2025-05-18"` is exactly right. If a future change needs
   an explicit SQL datetime, route it through
   `DomainTimezoneService.toMpSqlDatetime("2025-05-18")` → `"2025-05-18 00:00:00"` — **not**
   through `new Date(...)`.
4. **`Participant_Start_Date` on a created `Participants` row** goes through
   `toMpSqlDatetime(new Date())` — the documented "save at current moment" recipe.
5. **Display is client-side with an explicit IANA zone.** `Event_Start_Date` comes back as a
   wall-clock string already converted by the proc to the **congregation's** zone. The route
   includes `timeZone` from `getMpTimezone()` in the payload and the widget formats with
   `Intl.DateTimeFormat(this.locale, { timeZone, hour: "numeric", minute: "2-digit" })`.
   Legacy hardcoded `toLocaleString("en-US", …)` (`:117`) — a Spanish visitor got `9:00 AM`
   where `9:00` is correct.
   *Note the asymmetry and do not "fix" it*: `i18n/formatters.ts` takes no `timeZone` **by
   design** (`CLAUDE.md`), so the zone is threaded explicitly here, the way
   `fullCalendarService` already does. Do not add a zone parameter to `formatters.ts`.
6. **The QR's short date is derived by string surgery**, per *The QR ruling* — split
   `YYYY-MM-DD`, strip leading zeros, join with `/`. No `Date`, no `toLocaleDateString`.
7. **Any MP `$filter` on a date stays one template literal.** No `+` between template literals
   — `src/lib/no-template-concat.test.ts` fails the run, and the production minifier would
   silently drop text from the filter (`.claude/references/nextjs.build-hazards.md`).

---

## Tests

New Vitest files (jsdom, colocated):

| File | Asserts |
|---|---|
| `src/services/preCheckService.test.ts` | proc called with `{ "@HouseholdID", "@EventDate" }` and a raw `YYYY-MM-DD`; nullable columns map to `null` not `0`; `isRegistered` iff status 2; `isLocked` iff status 3 or 4; `rowKey` canonical and stable; `resolveDefaultEventDate()` returns domain-zone today for a mocked zone (fails if it uses the process zone); `buildQrPayload` → `pre\|5/18/2025\|5` and `pre\|11/5/2025\|5` |
| `src/services/preCheckService.save.test.ts` | **the authorisation suite.** A `rowKey` for a contact outside the household → throws, zero MP writes; a key with a swapped `eventId` → throws; ids written come from the derived row (mutate the inbound string's ids and assert the write is unchanged); cancellation set derived correctly; an `Attended`/`Confirmed` row is never cancelled and is reported in `locked`; two rows sharing an `eventParticipantId` produce one update; `participantId === null` creates exactly one `Participants` row for that contact; `$userId` present on every write |
| `src/app/api/embed/pre-check/route.test.ts` | GET: `public` sub → 401 `auth_required`; bad date → 400 `invalid_request`; no household → 404 `household_not_found`; happy path groups by member and includes `timeZone`. POST: schema rejection → `validation_failed`; bad selection → 403 `invalid_pre_check_selection` **with no MP write**; over the rate limit → 429; out-of-window date → 409 `pre_check_closed`; every body is `{ error, message }` with a snake_case code |
| `src/app/api/embed/pre-check/qr/route.test.ts` | household id comes from claims and cannot be overridden by a query param; payload matches the legacy format byte for byte; `public` sub → 401 |
| `src/lib/qr/encode.test.ts` | ISO/IEC 18004 reference vectors for byte mode at ECC Q; deterministic output for a fixed input; version selection at the length boundaries; valid single-root SVG |
| `packages/embed-sdk/src/components/pre-check.test.ts` | `initLocale()` awaited before the first `render()`; `disconnectedCallback` calls `super`; `attributeChangedCallback` reloads when `event-date` is set on a mounted widget with `oldValue === null` (**C39**); 401 renders the sign-in panel and **no** `[data-action="retry"]`, with a button in `dual` and none in `legacy`; empty rows renders `emptyNoEvents` not an error; locked rows render checked+disabled; the POST body contains only `{ eventDate, selected }` — **no ids** |

**Existing guard tests that will fail while this work is incomplete** — that is the point of
them, so expect it:

- `packages/embed-sdk/src/i18n/no-english-literals.test.ts` — any inline English in
  `pre-check.ts` fails immediately; `BUDGET` is empty and must stay empty (do **not** add an
  entry to quiet it).
- `packages/embed-sdk/src/i18n/catalogue-parity.test.ts` — the `preCheck` namespace must exist
  in all three locales with identical keys, message kinds and `{placeholders}`, and
  `savedCount` must carry `many` in `es` and `pt-BR`.
- `packages/embed-sdk/src/i18n/error-codes.test.ts` — fails until the three new `errors.*`
  entries exist in all three locales, and fails if a route answers with English prose.
- `src/lib/no-template-concat.test.ts` — fails on any `+` between template literals in the new
  service or routes.
- `packages/embed-sdk/src/i18n/widget-locale.test.ts` — covers the base-class contract this
  widget must honour (`initLocale`, `super.disconnectedCallback()`, `errorText`).
- If `CROSS-4`'s proposed `observedAttributes` naming guard has landed, all four attribute names
  must satisfy it.

Playwright: extend `CROSS-1`'s proposed `auth-only-widgets-signed-out.spec.ts` with
`demo-pre-check.html` rather than writing a new spec. A write-path E2E needs a seeded fixture
and can wait.

---

## Open questions

1. **Is `api_MPPW_GetPreCheckEvents` installed and API-granted on the target domain?** The only
   question that gates Phase 1. It is registered by `DatabaseScripts/001-Changes.sql:72-77` and
   granted by `61 - API Role.sql:109`, in the same block as eight procs this repo already
   calls, but the live instance's proc registry is not readable through the MCP tools
   (`dp_API_Procedures` is not exposed; MP's `Procedures` table is documented processes, not SQL
   objects). **Answer it with `MPHelper.getProcedures("PreCheck")` in Phase 0** — a throwaway
   script, five minutes. If absent → Phase 5.
2. **Does a current MP check-in station still scan `pre|M/d/yyyy|householdId`?** Not answerable
   from this repo, and possibly not from any repo — the payload predates
   `Events.Allow_QR_Check_In` / `QR_Redirect_Url`, which is a different mechanism. **My
   proposal: proceed as designed** — `show-qr` defaults to `false`, so the widget is correct
   either way and the answer becomes a documentation line rather than a code change. **This is
   the one item I would like a ruling on**: a tested scan at a real station upgrades `show-qr`
   to default-on and closes C78 completely; without one, ship it off and say so in the migration
   notes.
3. **What is the `defaultParticipantType` equivalent here?** Legacy reads it from a config
   setting (`ContactManager.cs:42`). Confirm `ConfigSettingsService` exposes it; if not, resolve
   `Participant_Types` by name once and hold the id as a named constant with a comment, not a
   bare literal.
4. **Should `Search_Results` type 1 ("Allow Guests") really list every household member for
   every event?** That is what the proc does, and on a large multi-service Sunday it means a
   long list. Legacy shipped it; ship it, and revisit only if a pilot church complains. Related:
   the proc ignores `Events.Cancelled` and `Group_Participants.End_Date` (*Three legacy
   defects*), which needs either a proc edit — a change to a file MP ships, so a
   customer-support question and not only a code one — or Phase 5.
5. **Does anything else in MP consume a pre-check?** The write is an ordinary
   `Event_Participants` row at status Registered, so the station's "expected" list picks it up
   by construction. Legacy ships nothing else that reacts to it — `DatabaseScripts/100-Webhooks.sql`
   and `101-Processes.sql` contain no `Event_Participants` reference, and neither
   `099-StoredProcMetaData.sql` nor `102-WID-2462.sql` mentions pre-check — so there is no
   hidden legacy side effect to reproduce. But **a church's own** Process or Webhook on
   `Event_Participants` would fire 30 times on a Saturday night from one household's submit.
   Worth a line in the migration notes; not worth blocking on.
6. **Is a single-day view the right product?** A parent doing Saturday-night data entry for a
   family with two services and a midweek class hits the widget three times with three
   different dates. A week view is a strictly better product and the same proc called seven
   times — but it is scope beyond parity. **Ship the day; note the week.**

---

## Sequenced phases

Ordered so the confident parts land first and the one unverifiable feature lands last, behind an
off-by-default attribute.

**Phase 0 — the feasibility gate (no committed code).** Run
`MPHelper.getProcedures("PreCheck")` against the dev domain and call the proc once for household
5 with `2025-05-18`. Record the actual row shape. Half a day. If the proc is missing, jump to
Phase 5 and come back. *Nothing after this point is speculative.*

**Phase 1 — types + service read + `GET /api/embed/pre-check`.**
`packages/types/src/pre-check.ts`, `preCheckService.ts` (`resolveDefaultEventDate`,
`isAvailable`, `getPreCheckRows`, `buildQrPayload`), the GET route,
`preCheckService.test.ts` and the GET half of `route.test.ts`. No writes, no widget.
Independently committable and independently reviewable — this is where the date handling gets
settled.

**Phase 2 — the widget, read-only, fully localised.** `pre-check.ts` with `loading`,
`needs-auth` (via `requestLogin`, mode-aware per `CROSS-1`), `list`, `no-events`, `error`; the
`preCheck` namespace in all three locales; the three new `errors.*`; `demo-pre-check.html`;
registration in `index.ts`; the component test. **At the end of this phase the widget is
demoable and every i18n guard test is green.** Render **no submit control at all** until Phase
3 — nothing on screen should imply a write that does not happen.

**Phase 3 — the write.** `savePreCheck` with authorisation rules 4-9, the POST route, rate
limiting, the window check, the submit control, `saving` / `saved` states, and both save test
files. **This is the phase to review hardest**; the authorisation suite is the deliverable, not
the feature. Reviewer's checklist: no id in the POST body; no `int.Parse`-equivalent of a client
string reaching an MP write; no delete; no `Attended` overwrite; `$userId` on every write.

**Phase 4 — the QR.** `src/lib/qr/encode.ts` + its reference-vector test, the `qr` route, the
`show-qr` attribute and the QR panel, `encode.test.ts` and the QR route test. Off by default, so
this phase cannot regress the widget.

**Phase 5 — REST fallback (only if Phase 0 failed, or to fix the proc's defects).** Replace
`getPreCheckRows`'s single proc call with five plain reads and a cross product in TypeScript,
behind the same method signature so nothing above it changes:

1. `Contacts` where `Household_ID = @h AND Contact_Status_ID <> 3` → contact ids, participant
   ids, display names.
2. `Events` where
   `[Allow_Check-in] = 1 AND Cancelled = 0 AND Event_Start_Date >= '<date>' AND Event_Start_Date < '<date+1>'`,
   selecting `Search_Results` and `Congregation_ID_TABLE.Time_Zone`.
3. `Event_Groups` for those `Event_ID`s → the group set per event.
4. `Group_Participants` for those participant ids, traversed out to `Group_ID_TABLE.Group_Name`
   and `Group_Role_ID_TABLE.Role_Title`, **filtered on
   `End_Date IS NULL OR End_Date > '<date>'`**.
5. `Event_Participants` for those participant ids and event ids.

Then cross-join in TypeScript and apply the `Search_Results = 3` visibility rule. All five are
plain `getTableRecords` calls with `_TABLE` traversal
(`.claude/references/ministryplatform.query-syntax.md`); no subquery is needed because step 3 is
materialised. **This path is not much more code than the proc call, it removes the customer-side
DB-install dependency, and it is the only place the two proc defects can be fixed without
shipping SQL** — so build it even if Phase 0 passes, if there is appetite. Same tests, same
route, same widget.

---

## Depends on / unblocks

**Depends on** `CROSS-1` for the shared `renderSignInRequired()` helper — this widget should be
its first *new-build* consumer rather than a twelfth bespoke copy, and if `CROSS-1` has not
landed, build the panel here in the shape `CROSS-1` specifies so the later extraction is a move,
not a rewrite. Wants `CROSS-4`'s `reconfigure()` convention and its attribute-naming guard test.
Independent of everything else.

**Unblocks** the C78 line in the customer migration notes, which currently has to read *"Event
pre-check has no replacement"* (`ROADMAP-missing-widgets.md`). **And it retires the dual-stack
requirement on the highest-traffic page a church runs** — the one Sunday-morning surface where
keeping MPWidgets.js means running two login models side by side in front of a queue of parents.

**Corrects** two documents in the same commit as Phase 1: C78's "Caveat on confidence" section
(the flow is confirmed and the legacy server source exists in `S:\MP\mp-Widgets`) and the
roadmap's risk framing of C78.
