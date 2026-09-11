# Mission trips — plan

**Closes:** `C76-no-mission-trip-widgets.md`
**Legacy tags:** `mpp-mission-trip-finder`, `mpp-mission-trip`, `mpp-my-mission-trips`
**New elements:** `next-mission-trip-finder`, `next-my-mission-trips` — **two, not three**
**Tier:** 2, item 6 in `ROADMAP-missing-widgets.md`
**Written:** 2026-09-11, from the legacy server at `S:\MP\mp-Widgets` and the live MP schema

> ## The headline: C76 is a two-widget item, not a three-widget one
>
> `api_MPPW_GetPledgeCampaign` takes an `@IsMissionTrip bit` parameter and **never
> references it in the body** — it appears once, on line 20, in the parameter list, and
> nowhere else in the 84-line procedure. `mpp-mission-trip` and `mpp-pledge-campaign` call
> that same procedure and receive byte-identical data.
>
> The two client components match too: both build the custom form through
> `CustomFormBuilder`, both load household members into an "Apply as" / "Make a Pledge as"
> picker through `HouseholdApiService`, both call `HasPledged` on picker change, both send a
> confirmation email from a template id attribute (`applicantemailtemplate` /
> `pledgeemailtemplate`), and both read the campaign id from the query string when the
> attribute is blank. `mpp-mission-trip` declares `missiontripcampaignid` in
> `observedAttributes` and **never reads it** — `loadAttributes()` reads only
> `pledgecampaignid` and `applicantemailtemplate`.
>
> `next-pledge-campaign` (1078 lines) already implements every one of those behaviours,
> including the household picker (`#pc-apply-as`) and the `id-parameter-name` query-string
> fallback. **Decision recorded 2026-09-11: reuse it.** No `next-mission-trip` element is
> built. What it needs instead is four fields the service currently drops — see Phase 1.
>
> C76's "three embeds" framing was correct about the legacy tag count and wrong about the
> work. This is the second time on this roadmap that reading the legacy server changed a
> Tier estimate; C78 was the first.

## Decisions recorded 2026-09-11

Four questions were put to the owner before this plan was written. The answers are binding
and the rationale is captured where each one lands:

| # | Question | Decision |
|---|---|---|
| 1 | Team roster access | **Trip leaders only**, server-enforced, honouring the unlisted flags |
| 2 | Trip details | **Reuse `next-pledge-campaign`** plus the registration-window / full-trip fields |
| 3 | Household scope | **Head-of-household parity** with legacy |
| 4 | Donor list detail | **Legacy parity** — name, amount, note, and contact details gated on the unlisted flags |

Decisions 1 and 3 interact, and the interaction is easy to get wrong — see
"The authorization model" below. It is the single most important section in this file.

## What legacy does

### Three tags, one domain, four stored procedures

| Tag | Server | Procedure |
|---|---|---|
| `mpp-mission-trip-finder` | `MissionTripApiController.GetMissionTrips` | `api_MPPW_SearchMissionTrips` |
| `mpp-mission-trip` | `MissionTripApiController.GetMissionTrip` → `PledgeCampaignManager.GetPledgeCampaign` | `api_MPPW_GetPledgeCampaign` (already used by `next-pledge-campaign`) |
| `mpp-my-mission-trips` | `MyMissionTrips` / `MyMissionTripDonors` / `MyMissionTripTeamProgress` | `api_MPPW_GetMyMissionTrips`, `api_MPPW_GetMyMissionTripDonors`, `api_MPPW_GetMyMissionTripTeamProgress` |

The application write is `MissionTripApiController.SavePledge`: create a donor record if the
contact has none, optionally create and attach an address, insert a `Pledges` row, attach a
`Form_Responses` row carrying the `Pledge_ID`, then send the applicant confirmation email.
`PledgeCampaignService.SavePledge` does the same thing, and `next-pledge-campaign`'s
`savePledge` already implements it (`resolveContactId`, `resolveDonorId`,
`sendConfirmationEmail`).

**`Pledges.Trip_Leader` is read-only in the entire legacy stack.** Four references, all
reads (`MissionTripManager:216`, `PledgeCampaignManager:320`, and the two DTOs). Nothing in
the application flow writes it — a participant becomes a trip leader only when staff tick
the box in the Platform. Keep that: no widget writes `Trip_Leader`.

### The data model, confirmed live

Mission trips are `Pledge_Campaigns` with `Pledge_Campaign_Type_ID = 2`
(*"Mission Project/Trip"*, one of 7 types; 2 is the default in
`api_MPPW_SearchMissionTrips`). Participants are `Pledges` rows against that campaign.
Fundraising is `Donation_Distributions` joined on `Pledge_ID`. `Pledges.Trip_Leader` is a
required `bit`.

### Copy — MP already translated it, and we should take it

`DatabaseScripts/ApplicationLabels/` carries 51 labels across the three tags
(`mpp-mission-trip.json` 30, `mpp-mission-trip-finder.json` 12,
`mpp-my-mission-trips.json` 9), and **every one has a Spanish and a Portuguese value**.
That is a direct, MP-authored source for two of our three locales — a materially different
position from `next-contact-attributes`, where the same directory has nothing but nulls.

Import it as a starting point, not as gospel: MP's Portuguese is European-leaning in places
and our catalogue is `pt-BR`, and MP's strings are not written against our
`common.*` / `fields.*` reuse rules. Treat it as a translation memory that removes the blank
page, then reconcile against the existing catalogue before adding a key.

## Legacy defects — do not port these

### D1 — the team-progress endpoint leaks the whole roster to any participant

`api_MPPW_GetMyMissionTripTeamProgress` builds a `UserCampaigns` CTE of campaigns the caller
(or their household) has a pledge on, then returns **every pledge on those campaigns** —
each teammate's `Email_Address`, `Mobile_Phone`, `Total_Pledge`, `Campaign_Goal` and
`SubTotalAmount`. There is no `Trip_Leader` predicate anywhere in the procedure.

Both gates are client-side:

- `mpp-my-mission-trips.js:120` — `_displayTeamProgress` is read from the host page's
  `showteamprogress` attribute, i.e. from markup a church author controls and an attacker
  ignores.
- `mpp-my-mission-trips.js:216` —
  `teamProgress.filter((x) => x.pledgeCampaignId === … && tripLeader === true)` filters an
  array the browser already has in full.

So any signed-in participant on a trip can call
`GET /api/MissionTrip/MyMissionTripTeamProgress?missionTripCampaignType=2` and read the
contact details and fundraising position of everyone else on the trip. On a youth mission
trip that is a roster of minors' mobile numbers.

This is the "authorisation rule decided up front rather than an attribute that hides a
section client-side" that C76 and the ROADMAP both called for, and it is now confirmed as a
live defect rather than a hypothetical.

**Fix:** decision 1 — the server checks `Trip_Leader` and answers `403 not_trip_leader`
otherwise. See "The authorization model".

### D2 — team progress ignores the unlisted flags that the donors procedure honours

`api_MPPW_GetMyMissionTripDonors` is careful: `IIF(Home_Address_Unlisted = 0 AND …)`,
`IIF(C.Mobile_Phone_Unlisted = 0 AND …)`, `IIF(C.Email_Unlisted = 0 AND …)`, and it collapses
`D.Anonymous = 1` donors to *"Anonymous Donor"* by making the `Contacts` join conditional.

`api_MPPW_GetMyMissionTripTeamProgress`, written later, selects `C.Email_Address` and
`C.Mobile_Phone` raw. The same contact whose mobile is suppressed in the donor list is
exposed in the roster. Two procedures, two different answers about the same person's privacy
flag, in the same widget.

**Fix:** apply the donors procedure's flag handling to the roster. Decision 1 says leaders
only *and* honour the flags — a leader is not staff.

### D3 — the finder's `showfulltrips="false"` branch is inverted

```sql
IF (@ShowFullTrips = 0)
  AND (PC.Maximum_Registrants IS NULL OR PC.Maximum_Registrants = 0
       OR Pledge_Counts.Current_Registrants >= PC.Maximum_Registrants)
```

`>=` is the definition of *full*. Asking to hide full trips returns uncapped trips **plus
exactly the full ones**, and hides every trip that has space — the precise opposite of the
attribute's documented meaning (*"If true, full mission trips can display on the finder"*).

**Fix:** `Current_Registrants < Maximum_Registrants` for capped campaigns. We do the
filtering in our own service rather than by shipping a corrected procedure, so no church has
to re-run a database script to get correct behaviour.

### D4 — the donors endpoint has no campaign scope

`MyMissionTripDonors` takes only `missionTripCampaignType`. It returns the donors of **every
mission trip the caller has ever pledged to** within the date-window-free query, and the
client groups client-side. Two trips means two donor lists concatenated over the wire. Our
route takes an explicit `campaignId`.

It also, unlike `api_MPPW_GetMyMissionTrips` and the team-progress procedure, applies **no
pledge-status or end-date window at all** — a trip from four years ago still returns its
donor list with addresses. Our service applies the same window the other two use.

### D6 — `api_MPPW_GetPledgeCampaign` aliases `Registration_Start` / `Registration_End` twice

Found during the build, and it bears directly on Phase 1. The procedure's single `SELECT`
emits each of those two column names **twice**:

```sql
-- lines 42-43, from the campaign
dbo.dp_Convert_DateTime(Pledge_Campaigns.Registration_Start, …) AS Registration_Start,
dbo.dp_Convert_DateTime(Pledge_Campaigns.Registration_End,   …) AS Registration_End,
-- lines 55-56, from the linked event
CASE WHEN ECNG.Time_Zone IS NULL THEN NULL
     ELSE dbo.dp_Convert_DateTime(Event_ID_Table.Registration_Start, …) END AS Registration_Start,
CASE WHEN ECNG.Time_Zone IS NULL THEN NULL
     ELSE dbo.dp_Convert_DateTime(Event_ID_Table.Registration_End,   …) END AS Registration_End,
```

Two different source columns — the *campaign's* registration window and the *event's* — under
one name. Which one reaches the service depends on how MP's API serialises a result set with
duplicate column names, which is last-wins in a dictionary. Worse, the event copy is wrapped
in a `CASE` that yields `NULL` whenever the event's congregation has no time zone set.

**Not fixed, deliberately.** Correcting it means shipping a changed stored procedure that
every church would have to install, for a field whose two sources are normally identical on
a mission trip. The mapping takes the value as delivered and documents the caveat inline.

The failure mode is benign by construction: a `null` registration bound is treated as "no
bound", so the widget falls open to *allowing* applications rather than wrongly refusing
them. A church that sets a registration window on the campaign and finds it not enforced
should set the same window on the linked event. Say so in the customer notes.

### D5 — small things, listed so they are not re-derived

- `MissionTripApiController`'s constructor assigns `_missionTripService` twice; the second
  assignment is dead.
- `GetMissionTrips` is `[HttpPost]` with `[FromForm]` — a form-encoded search. Ours is a GET
  with query parameters, cacheable and linkable, like `next-opportunity-finder`.
- `MissionTripManager.MyMissionTripDonors` defaults `Anonymous` to `true` when the column is
  missing. Fail-closed and correct; keep the intent.
- `GetFrequencyData` is a hard-coded list of six installment frequencies. Ours already exists
  as `PLEDGE_FREQUENCIES` in `pledgeCampaignService.ts`; do not add a second copy.
- The finder filters congregation on the **Program's** congregation (`PR.Congregation_ID`),
  not `Pledge_Campaigns.Congregation_ID`, which also exists. Keep legacy's behaviour — a
  campaign's own congregation is frequently null while its program's is set — but say so in a
  comment, because it reads like a bug.

## The authorization model

Decisions 1 and 3 pull in opposite directions and the seam between them is where a bug will
live. Written out once, explicitly, so it can be implemented and tested as one rule.

### The visible-contacts set

Legacy computes this identically in all three procedures:

```sql
DECLARE @HouseholdId int = (SELECT Household_ID FROM Contacts WHERE User_Account = @UserId)
DECLARE @IsHeadOfHousehold bit = (… Household_Position_ID = 1 …)

C.Household_ID = @HouseholdId AND (@IsHeadOfHousehold = 1 OR C.User_Account = @UserId)
```

Read plainly: **a head of household sees every member of their household; everyone else sees
only themselves.** Decision 3 keeps this. Call the result `visibleContactIds` — one helper,
computed once, used by all three endpoints.

### The trip-leader gate, and the trap

Decision 1 says the roster requires `Trip_Leader = 1`. The naive implementation checks the
*caller's own* pledge. Combined with decision 3 that is wrong: a parent who is head of
household, managing their teenage child's trip, is exactly the person legacy's household rule
exists to serve — and the child, not the parent, is the pledge holder. A caller-only check
gives that parent a 403 on a widget that legacy showed them.

**The rule:** the roster for campaign *C* is returned when **any** pledge on *C* held by a
contact in `visibleContactIds` has `Trip_Leader = 1`.

For a participant with no household privileges this reduces to "my own pledge is the leader
pledge", which is the intent of decision 1. For a head of household it extends to the
members they already see, which is the intent of decision 3. Neither decision is weakened:
the caller can only ever borrow leadership from someone whose trips, donors and progress they
were already entitled to see.

### The three endpoints

| Endpoint | Scope | Gate |
|---|---|---|
| my trips | pledges held by `visibleContactIds`, `Pledge_Campaign_Type_ID = <type>` | signed in |
| donors for campaign *C* | donations distributed to pledges on *C* held by `visibleContactIds` | signed in **and** the caller holds a visible pledge on *C* |
| team roster for campaign *C* | **every** pledge on *C* | signed in **and** a visible pledge on *C* has `Trip_Leader = 1` → else `403 not_trip_leader` |

The donors row is worth stating because legacy leaves it implicit: the donor list is scoped
to *the visible participants' own* pledges, so it never widens to other people's donors even
though the roster does widen to other people's names.

`403` rather than an empty array: an empty roster is indistinguishable from a solo trip, and
the widget needs to know whether to render the panel or say nothing at all. The code is a
protocol signal for the widget, not something a congregant reads — `errorText` maps it to
ordinary copy.

### What a leader sees about a teammate

Name, campaign goal, total pledged, amount raised, pledge status — always. Email and mobile
**only** when `Email_Unlisted` / `Mobile_Phone_Unlisted` are 0 (D2's fix). A suppressed field
is `null`, not `"--"`; the legacy sentinel string is a display concern that leaked into the
data layer, and `null` is what the widget branches on.

## Scope and phases

### Phase 1 — `next-pledge-campaign` learns the registration window (no new element)

This is decision 2's actual cost, and it is additive: `api_MPPW_GetPledgeCampaign` **already
returns** every field needed. `pledgeCampaignService.getCampaign` simply does not map them.

| Proc column | New model field | Why a mission trip needs it |
|---|---|---|
| `Maximum_Registrants` | `maximumRegistrants` | a trip has a bus with a fixed number of seats |
| `PledgeCount` | `currentRegistrants` | already selected; currently mapped only as `numberOfPledges` |
| `Registration_Start` | `registrationStart` | applications open on a date |
| `Registration_End` | `registrationEnd` | and close on one |

Behaviour: the apply form is blocked, with distinct copy, when the campaign is full
(`maximumRegistrants > 0 && currentRegistrants >= maximumRegistrants`), before the
registration window opens, or after it closes. Today `next-pledge-campaign` gates only on
`allowOnlinePledge` and `pledgeBeyondEndDate`, so a full trip currently accepts applications
indefinitely — a real defect for capital campaigns too, not only for trips.

**No stored procedure change, no new route, no new element.** File a short note on
`pledge-campaign.md` rather than a new `C` finding, since it lands as part of this item.

### Phase 2 — `next-mission-trip-finder`

`src/services/missionTripService.ts` + `src/app/api/embed/mission-trips/route.ts` +
`packages/embed-sdk/src/components/mission-trip-finder.ts` + `demo-mission-trip-finder.html`.

Structural template is `next-opportunity-finder` (filters → cards → link out), which C76
correctly identified. The card fields come straight from `MissionTripResult`: image, campaign
name, congregation, program, ministry, event start/end, registration start/end,
`Maximum_Registrants`, `Current_Registrants`, `IsFull`, description.

Anonymous-friendly: a trip finder on a church home page must work signed out, so the route
accepts a public JWT. It reads nothing contact-scoped.

### Phase 3 — `next-my-mission-trips`

Three routes under `src/app/api/embed/mission-trips/`: `mine`, `donors`, `team`. One element
with three panels, gated by `show-donors` and `show-team-progress` attributes **for display
only** — the server gates the data, and the attributes decide whether to ask for it at all.

### Phase 4 — i18n, docs, resolutions

Import MP's 51 translated labels, reconcile against `common.*`, write the customer docs, and
close out C76 and the ROADMAP row.

## Is `next-my-mission-trips` really a separate widget from `next-my-pledges`?

Worth asking, because `api_MPPW_GetMyMissionTrips` returns the same DTO
(`PledgeSQLToMyPledgeDTO`) that `api_MPPW_GetMyPledges` does, and our `myPledgesService`
already calls the latter. The answer is yes, for three concrete reasons:

1. **Different scope rule.** `GetMyPledges` scopes by
   `Donor_ID IN (@ContactDonorId, @SpouseDonorId)` — the caller and, when their donor record
   is `Statement_Type_ID = 2` (Family), their spouse. `GetMyMissionTrips` scopes by
   household + head-of-household. Those select different people and neither is a filter over
   the other.
2. **`Show_On_My_Pledges` is deliberately not applied.** `GetMyPledges` requires
   `PC.Show_On_My_Pledges = 1`; the mission-trip procedure has that line commented out on
   purpose, so a trip campaign hidden from the pledges page still appears on the trips page.
3. **The donors and roster panels have no analogue** in `next-my-pledges` and would not
   belong there.

So: a new `missionTripService.ts`, not an extension of `myPledgesService.ts`. The CLAUDE.md
rule ("unless the domain already has one") is satisfied — mission trips own a finder, a donor
list and a roster, none of which is a pledge concern. Reuse flows the other way: the service
imports `PLEDGE_FREQUENCIES` and the pledge-status mapping from the pledge services rather
than copying them, and the details page *is* `next-pledge-campaign`.

## Stored-procedure availability

Four procedures are needed and only one (`api_MPPW_GetPledgeCampaign`) is already in use by
this repo. The other three ship in the same MinistryPlatform widget database scripts as the
seventeen `api_MPPW_*` procedures the SDK already depends on, so a domain that runs any of
the giving or event widgets almost certainly has them — but "almost certainly" is what
`next-pre-check` already solved.

Follow that precedent exactly (`README.md`, *"Before it will work"*): probe with
`MPHelper.getProcedures()` using the **full, exact** procedure name — the README records that
`getProcedures()` matches exact names, not substrings, and that a friendlier partial term
returns empty on every domain and makes the widget permanently self-report as unavailable.
On a miss, render *"Mission trips are not set up for this site yet. Please contact the
church."* and write nothing.

Fetch the procedure list **once** per service instance and cache it — three panels must not
mean three round trips — but **test membership per procedure, not once for the set.**
Measured 2026-09-11 in `S:\MP\mp-Widgets\DatabaseScripts`: all four are granted to the API
role in `61 - API Role.sql`, but they are registered in **two different scripts from two
different eras** —

| Script | Procedures |
|---|---|
| `001-Changes.sql` | `GetMyMissionTrips`, `GetMyMissionTripDonors` (alongside `GetPledgeCampaign`, `GetPreCheckEvents` and most of the set this SDK already uses) |
| `099-StoredProcMetaData.sql` | `SearchMissionTrips`, `GetMyMissionTripTeamProgress` |

The finder and the roster are the **newer pair**. A domain on an older revision of MP's
script set can genuinely have "my trips" and "donors" working while those two are absent, so
probing one name and inferring the rest would report a mostly-working domain as entirely
unavailable. Each route reports on its own procedure and the widget degrades panel by panel.

There is no runtime way to check this from outside: MP exposes no queryable registry table
for installed API procedures (`Procedures` is an unrelated table of documented church
processes), so the probe is the only answer available.

## Server

### `src/services/missionTripService.ts`

```ts
export class MissionTripService {
  static async getInstance(): Promise<MissionTripService>;

  /** api_MPPW_SearchMissionTrips, with D3's full-trip filter corrected in TS. */
  search(params: MissionTripSearchParams): Promise<MissionTripCard[]>;

  /** The household/head-of-household rule. Computed once, used by all three below. */
  private visibleContactIds(contactId: number): Promise<number[]>;

  mine(contactId: number, campaignTypeId: number): Promise<MyMissionTrip[]>;

  /** Throws NotAParticipantError if no visible pledge on the campaign. */
  donors(contactId: number, campaignId: number): Promise<MissionDonor[]>;

  /** Throws NotTripLeaderError unless a visible pledge on the campaign leads it. */
  team(contactId: number, campaignId: number): Promise<MissionTeamMember[]>;
}
```

`search` passes `@ShowFullTrips = 1` to the procedure unconditionally and applies the
capacity filter in TypeScript, which is how D3 gets fixed without shipping SQL. The
procedure already returns `IsFull`, `Maximum_Registrants` and `Current_Registrants`, so the
filter is a predicate over rows we already have.

### Routes — `src/app/api/embed/mission-trips/`

| Route | Verb | Auth | Notes |
|---|---|---|---|
| `route.ts` | GET | public JWT accepted | the finder |
| `mine/route.ts` | GET | signed in | `?campaignTypeId=2` |
| `donors/route.ts` | GET | signed in + visible pledge | `?campaignId=` |
| `team/route.ts` | GET | signed in + visible trip leader | `?campaignId=` |

One directory, four routes — the `pre-check/` precedent, where one widget owns a directory
holding more than one route. The CLAUDE.md route-directory count moves by one, not four.

### Error codes

| Code | HTTP | When |
|---|---|---|
| `not_trip_leader` | 403 | roster requested by a non-leader (D1's guard) |
| `not_a_participant` | 403 | donors requested for a campaign the caller holds no visible pledge on |
| `mission_trips_unavailable` | 503 | the procedure probe failed |
| `invalid_request` | 400 | missing or non-numeric `campaignId` / `campaignTypeId` |
| `auth_required` | 401 | the existing shared code |
| `internal_error` | 500 | the catch-all; `WIRE_CODE_KEYS` already maps it to `errors.generic` |

> **Corrected during the build.** An earlier draft listed `unauthorized` and `mp_unavailable`
> as "shared" codes. Neither exists anywhere in the repo or in any catalogue; the real
> spellings are `auth_required` and `internal_error`. Emitting an invented code ships a
> response with no sentence in three languages, degrading to "Something went wrong" for
> every visitor who hits it — the exact failure `error-codes.test.ts` exists to catch.

## Widget attribute surfaces

### `next-mission-trip-finder`

| Attribute | Legacy | Required | Notes |
|---|---|---|---|
| `campaign-type-id` | `missiontripcampaigntypeid` | **yes** | `Pledge_Campaign_Type_ID`; 2 = Mission Project/Trip |
| `target` | `target` / `targeturl` | yes | the details page URL |
| `id-parameter-name` | — | no, default `id` | **new** — must match the `next-pledge-campaign` attribute on the target page |
| `congregation-id` | `congregationid` | no | filters on the *Program's* congregation, per D5 |
| `ministry-id` | `ministryid` | no | |
| `program-id` | `programid` | no | |
| `keyword` | `keyword` | no | campaign name, description, program name, ministry name |
| `show-full-trips` | `showfulltrips` | no, default `true` | corrected per D3 |
| `max-results` | — | no, default 100 | legacy had it server-side only |

Legacy exposes both `target` and `targeturl`; ours takes `target` only. `id-parameter-name`
is the seam decision 2 creates — the finder writes `?<name>=<campaignId>` and
`next-pledge-campaign` reads it with its existing attribute of the same name. Both default to
`id`, so a church that copies the documented snippet never sets either.

### `next-my-mission-trips`

| Attribute | Legacy | Required | Notes |
|---|---|---|---|
| `campaign-type-id` | `missiontripcampaigntypeid` | **yes** | |
| `show-donors` | `showdonors` | no, default `false` | display only; the server still authorizes |
| `show-team-progress` | `showteamprogress` | no, default `false` | display only; the server still authorizes |

Both default to `false`, matching legacy's `=== "true"` string comparison, so an unset
attribute never opts a church into showing donor addresses.

## i18n

Two new namespaces in `giving.ts` (where `pledgeCampaign.*` and `myPledges.*` already live):
`missionTripFinder.*` and `myMissionTrips.*`. Details-page copy needs no namespace — it is
`pledgeCampaign.*`, already written — except the four new registration-window strings Phase 1
adds.

Seed `es` and `pt-BR` from MP's own labels, then reconcile: `common.tryAgain`,
`fields.email`, `fields.firstName`, `fields.lastName`, `fields.mobilePhone`, `fields.city`
and friends already exist and most of `mpp-mission-trip.json`'s 30 labels collide with them.
The finder's *"Campus"* for congregation is a church-configurable term and belongs behind
`MPNextEmbed.setMessages()`, not a hard-coded translation.

Pledge statuses (`Active`, `Completed`, `Discontinued`, `Pending`) are already needed by
`next-my-pledges`; check before adding a second key set.

Campaign names, descriptions, program and ministry names are **MP-authored content and are
not translated** — the documented limit.

Ratchet: no `BUDGET` entry. Both elements ship fully localised.

## Tests

### `src/services/missionTripService.test.ts`

- **`show-full-trips=false` hides full trips and keeps trips with space** — D3's regression
  test, written against the inverted legacy predicate so it fails if anyone "restores parity"
- uncapped campaigns (`Maximum_Registrants` null or 0) are never treated as full
- the visible-contacts rule: head of household gets the household; a non-head gets only
  themselves; a contact with no household row gets only themselves
- **`team()` throws `NotTripLeaderError` for a participant whose visible pledges all have
  `Trip_Leader = 0`** — D1's regression test
- **`team()` succeeds for a head of household whose *child* holds the leader pledge** — the
  decision 1 × decision 3 interaction, and the one a naive caller-only check fails
- `team()` nulls `email` when `Email_Unlisted`, `phone` when `Mobile_Phone_Unlisted` — D2
- `donors()` throws `NotAParticipantError` for a campaign the caller has no visible pledge on
- `donors()` collapses `Anonymous = 1` to the anonymous label and emits no contact fields
- `donors()` nulls address / phone / email per the three unlisted flags
- `donors()` applies the same status and date window as `mine()` — D4
- the procedure probe uses the exact full name and caches; a missing procedure yields
  `mission_trips_unavailable` and zero further MP calls

### `src/services/pledgeCampaignService.test.ts` (extended)

- `maximumRegistrants`, `currentRegistrants`, `registrationStart`, `registrationEnd` are
  mapped from the procedure row
- a full campaign, a not-yet-open window and a closed window each block the form with
  distinct states

### Component tests

- finder: cards are keyboard-activatable and are links, not click-handled divs — `C05`,
  `C10`, `C22` are the same defect filed three times and this is the fourth chance to make
  it
- finder: card dates include the year (`C09`)
- finder: full trips carry a visible "Trip is full" badge, not only a filtered-out state
- my-mission-trips: signed out renders sign-in, not an error (`C13`/`C30`/`C46`)
- my-mission-trips: `show-team-progress` unset means the panel is absent **and no request is
  made**
- my-mission-trips: a `not_trip_leader` response hides the panel silently rather than
  rendering an error — a non-leader is not in an error state
- my-mission-trips: a donor with suppressed contact fields renders the name and amount with
  no empty address block

### Existing guard tests

`catalogue-parity.test.ts`, `error-codes.test.ts`, `no-english-literals.test.ts`,
`widget-locale.test.ts`, `src/lib/no-template-concat.test.ts`.

## Security

- Every scope decision is server-side. `show-donors` and `show-team-progress` are rendering
  hints; removing them from the markup changes what is drawn, never what is authorized.
- The contact id comes from `claims.sub`. `campaignId` and `campaignTypeId` are request
  inputs and are coerced to numbers before reaching a filter — they scope a query but never
  widen the visible-contacts set.
- The roster endpoint is the one place this domain returns data about people who are not the
  caller and not in their household. It is gated twice (visible pledge on the campaign, and
  that pledge or a household member's leads it) and it suppresses flagged contact fields.
- The donor list returns donor names and, subject to flags, postal addresses. That is
  decision 4 and it is legacy parity, but it means the endpoint deserves the same care as a
  directory: no enumeration (a campaign the caller does not participate in answers 403, not
  an empty list), and no logging of the payload.
- No new npm dependency, no CDN asset, no anonymous write, no email send. The finder is the
  only anonymous surface and it is read-only over campaigns the church already publishes.

## Demo pages

`demo-mission-trip-finder.html` and `demo-my-mission-trips.html`. The finder demo needs a
`campaign-type-id` of 2 and a `target` pointing at `demo-pledge-campaign.html` — which
doubles as the proof that decision 2 works end to end, so wire it that way rather than to a
placeholder.

**The reference domain was checked, 2026-09-11, and it will not show a populated finder.**
Three `Pledge_Campaign_Type_ID = 2` campaigns exist and none survives
`api_MPPW_SearchMissionTrips`:

| Campaign | Why it is filtered out |
|---|---|
| 1 "Sample Mission Trip" | event 1 ended 2018-12-31; the proc requires `Event_End_Date > @DomainTime` |
| 3 "MyChurch Test Mission Trip" | event 10 ended 2018-12-30, same reason |
| 4 "Tanzania Mission Trip 2024" | event 18 ended 2024-04-27, **and** `Allow_Online_Pledge = 0`, **and** `Program_ID` is null while the proc `INNER JOIN`s `Programs` — excluded three times over |

So `demo-mission-trip-finder.html` must state in visible copy that the empty state is the
*correct* result here, and what a church would need for a trip to appear (a type-2 campaign
with a Program, `Allow_Online_Pledge = 1`, and an Event ending in the future).

`next-my-mission-trips` does have live data, but only for household 1: campaign 3 ends
2027-12-31 and so sits inside `GetMyMissionTrips`' `End_Date >= now - 180` window, with
pledges held by MPTrainer (`User_Account` 3) and ACST: MPAdmin (`User_Account` 1).

**The roster panel cannot be demonstrated live, and that is worth a sentence on the page.**
Campaign 4 is the only campaign on the domain with a genuine `Trip_Leader = 1` (Chris
Kehayias, `User_Account` 98, household 85) *and* several participants including a second
household-85 member — the perfect fixture for both the leader gate and the head-of-household
rule — and its `End_Date` of 2024-05-01 puts it outside the window. Nothing is being changed
on a shared reference domain to fix that; the demo page documents what a reviewer would have
to edit (push campaign 4's `End_Date` forward) to see the panel. The unit tests are
fixture-driven and cover both cases regardless.

## Migration note — this is the item that changes the customer story

The ROADMAP's closing section asks for a line in the customer migration notes for every
unported widget, and lists *"Churches running mission trips must keep MPWidgets.js on those
three pages."* **Building this deletes that line**, which was the largest remaining
dual-stack obligation in the catalogue — a church running trips no longer has to run both
login models on the same site.

Replace it with the setup instructions, and be explicit about the one behavioural change a
migrating church will notice: **the team roster is now trip-leaders-only and enforced on the
server.** A church whose participants were relying on seeing each other's fundraising totals
will see that stop. That is the intended fix for D1, but it should not be a surprise.
