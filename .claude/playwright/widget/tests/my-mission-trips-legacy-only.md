# mission-trip widgets (legacy only) — runtime record for C76

- **New**: none. All three legacy mission-trip widgets have no `next-*` counterpart.
- **Old**: `mpp-my-mission-trips` — https://mpi.ministryplatform.com/widgets/my_mission_trips.aspx
  · `mpp-mission-trip-finder` — https://mpi.ministryplatform.com/widgets/mission_trip_finder.aspx
  · `mpp-mission-trip` — https://mpi.ministryplatform.com/widgets/mission_trip.aspx
- **Tested**: 2026-09-08 by subagent *serving & visit* (block C20–C29)
- **Auth state(s) tested**: signed in as `PLAYWRIGHT_MP_USERNAME` (all three; `assertAuthenticated` passed before each)
- **Script**: scratchpad `mt.mjs`

## Why there is no finding in this file

**No item was filed.** The coordinator's original framing — that
`mpp-mission-trip-finder` is a differently-scoped opportunity finder that
`next-opportunity-finder` might be configured to reproduce — does not hold: it queries
**Pledge Campaigns** filtered by `missiontripcampaigntypeid` via
`/Api/MissionTripApi/GetMissionTrips`, a different table and a different API surface
from `mpp-opportunity-finder`'s `/Api/OpportunitiesApi/GetOpportunities`.
`next-opportunity-finder` has neither `missiontripcampaigntypeid` nor `showfulltrips`
and could not be pointed at that data.

The whole domain is already filed as **`C76-no-mission-trip-widgets.md`** by the
config-cartographer (block C60–C79) from source analysis. This file adds the runtime
detail that item was filed without, per the coordinator's correction. Nothing here
contradicts C76.

## What each widget actually does, driven in a browser

### `mpp-my-mission-trips` — `/widgets/my_mission_trips.aspx`

Sample page markup: `<mpp-my-mission-trips missiontripcampaigntypeid="2">`.

Signed in, it renders exactly: **"No mission trips found."** followed by the
permanently-present (hidden) string *"Please login to view your mission trips"* and a
hidden `#loginButton`. Its only control when signed in is that login button, which is
not displayed.

There is **no mission-trip data in this MP instance** (see below), so this is the
widget's genuine empty state rather than a failure. From its bundle, the capability it
provides is a signed-in dashboard over
`/Api/MissionTripApi/MyMissionTrips`, `…/MyMissionTripDonors` and
`…/MyMissionTripTeamProgress` — i.e. *my trips*, *who has donated to my trip*, and
*how the team's fundraising is tracking* — gated by the two configurator-only
attributes `showdonors` and `showteamprogress`. Nothing in this repo reads any of
those endpoints or their equivalents.

### `mpp-mission-trip-finder` — `/widgets/mission_trip_finder.aspx`

Sample page markup: `<mpp-mission-trip-finder target="./mission_trip.aspx/">`.

Renders a search form and a result area:

| Control | Id / name | Notes |
|---|---|---|
| Campus | `#congregationId` | `- All Records -`, Friends & Internet Campus, Main Congregation |
| Key Word | `#keywordSearchText` (`name=keyword`) | free text |
| Show Advanced | `#advancedSearchLink` | reveals Ministry |
| Ministry | `#ministryId` | `- All Records -` + the 8 ministries |
| Search Trips | `#searchButton` | submit |

Result area: **"0 Mission Trips found. Please try again with different search
criteria."** Note the empty-state copy and the campus placeholder
(`- All Records -`) differ from the opportunity finder's (`Any Campus`), which is
further evidence these are two separate widgets rather than one widget configured two
ways.

### `mpp-mission-trip` — `/widgets/mission_trip.aspx`

Sample page markup: `<mpp-mission-trip applicantemailtemplate="609">`.

The page passes no trip id, so the widget shows *"Sorry, we cannot find that mission
trip. Please contact your church administrator so they can check the mission trip
settings."* (and threw once inside `MissionTrip.js`). It still renders its
**"Apply to this Mission Trip"** form beneath that message, which is the useful part
of the record:

```
hidden: PledgeCampaignId (0) | ApplicantEmailTemplateId (609) | ContactId (98) | TotalPledge (0)
#applyAs   select — Blank Form, Kehayias Chris, Kehayias Sarah, Kehayias Aiden, Kehayias Jillian
FirstName* | LastName* | Email* (email) | MobilePhoneNumber (tel)
AddressId (hidden) | AddressLine1 | AddressLine2 | City | StateRegion | PostalCode | Country (select)
#createPledge  submit "Apply"
```

The address block came **pre-filled from the signed-in user's household**
(`2720 Bradfordt Drive / West Melbourne / FL / 32904-7322`, Country `US`), which is
behaviour worth noting: it is the same "Apply as… + prefilled household" pattern that
`next-opportunity-details` has for responses and that `next-custom-form` lacks
(**C26**). The hidden `TotalPledge` and the `createPledge` submit id confirm that
applying to a mission trip creates a **Pledge** against a Pledge Campaign — which is
why this domain sits closer to `next-pledge-campaign` than to
`next-opportunity-finder`.

## Data limitation

This MP instance has no mission-trip records: both the finder and the "my trips" view
return zero rows, and `mission_trip.aspx` has no trip to load. So the description
above is **structural** — controls, endpoints, copy and form shape, all observed —
rather than a data-parity comparison. Setup that would unblock a full pass: a
Pledge Campaign of the mission-trip campaign type (`missiontripcampaigntypeid = 2`)
with at least one team member and one pledge.

## Findings filed

None. Runtime detail attached to the existing **`C76-no-mission-trip-widgets.md`**;
see "Why there is no finding in this file" above.

## Screenshots

- `my-mission-trips-old-authed.png` / `my-mission-trips-old-mobile.png`
- `mission-trip-finder-old-authed.png` / `mission-trip-finder-old-mobile.png`
- `mission-trip-old-authed.png` / `mission-trip-old-mobile.png` — the "Apply to this Mission Trip" form with the household-prefilled address.
