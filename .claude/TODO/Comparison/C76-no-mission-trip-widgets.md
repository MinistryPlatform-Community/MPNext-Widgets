# C76. The whole mission-trip domain has no counterpart — three legacy widgets (`mpp-mission-trip-finder`, `mpp-mission-trip`, `mpp-my-mission-trips`) and their fundraising surface are absent

**Widget:** none (old: Mission Trip Finder `/widgets/mission_trip_finder.aspx`, Mission Trip Details `/widgets/mission_trip.aspx`, My Mission Trips `/widgets/my_mission_trips.aspx`)
**Severity:** functional
**Confidence:** confirmed — three loader-table entries, three bundle attribute surfaces, none matched by any `next-*` element; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

Three of the sample site's twenty-one pages are mission trips, and the loader table lists
all three tags:

```js
{tag:"mpp-mission-trip",        script:"/dist/MissionTrip.js",       name:"Mission Trip"},
{tag:"mpp-mission-trip-finder", script:"/dist/MissionTripFinder.js", name:"Mission Trip Finder"},
{tag:"mpp-my-mission-trips",    script:"/dist/MyMissionTrips.js",    name:"My Mission Trips"},
```

**Finder** — `/widgets/mission_trip_finder.aspx`:
`<mpp-mission-trip-finder target="./mission_trip.aspx/">`.
`observedAttributes`: `["target","targeturl","programid","congregationid","ministryid",
"keyword","showfulltrips","missiontripcampaigntypeid"]`. Configurator descriptions:
`missiontripcampaigntypeid` (**required**) "Filters by a Campaign Type ID";
`showfulltrips` "Defaults to true… If true, full mission trips can display on the finder";
`keyword` searches "the Campaign Name, Campaign Description… and/or Ministry Name".

**Details** — `/widgets/mission_trip.aspx`:
`<mpp-mission-trip applicantemailtemplate="609">`.
`observedAttributes`: `["pledgecampaignid","missiontripcampaignid","applicantemailtemplate"]`.
`pledgecampaignid` is **required**; `applicantemailtemplate` is the "Confirmation email
sent after an individual has successfully submitted an application."

**Mine** — `/widgets/my_mission_trips.aspx`:
`<mpp-my-mission-trips missiontripcampaigntypeid="2">`.
`observedAttributes`: `["missiontripcampaigntypeid"]`, plus two documented options read at
render time: `showdonors` "Choose whether or not to show donor information on this mission
trip" and `showteamprogress` "Choose whether or not to show trip participant fundraising
information to trip leaders."

So the domain is a complete flow: find a trip → apply (with a confirmation email) → track
your own fundraising, your donors, and — if you lead the trip — your team's progress.

## New behaviour

None of it exists. There is no mission-trip element in the 25-element `next-*` roster, no
mission-trip route under `src/app/api/embed/` (27 directories), and no mission-trip service
in `src/services/` (34 files).

**The BRIEF's pair table is wrong here and a sibling should not act on it.** It maps
`next-opportunity-finder` to "Opportunity Finder + Mission Trip Finder", noting "old has
two finders over the same table". The source says otherwise: `mpp-opportunity-finder`
filters Opportunities (`genderid`, `minimumage`, `frequency`, `attributeids`), while
`mpp-mission-trip-finder` filters **Pledge Campaigns** by `missiontripcampaigntypeid` with
`showfulltrips`. Different table, disjoint attribute surfaces, and `next-opportunity-finder`
has neither of the mission-trip attributes. Comparing them would produce a false parity
result.

The nearest new elements are `next-pledge-campaign` (make a pledge to one campaign) and
`next-my-pledges` (see my pledges) — the *giving* half of a trip, with none of the trip:
no finder, no application, no per-participant fundraising page, no donor list, no leader
view of team progress.

## Why it matters

Short-term missions is a mainstream program for the churches MP serves, and unlike the
other gaps on this pass it is not one missing control — it is a whole product area, three
embeds, and a flow that carries money and an application. A church running trips cannot
cut over at all; it must keep MPWidgets.js on those pages indefinitely, which means running
both stacks and both login models side by side (legacy `mpp-user-login` writing
`mpp-widgets_AuthToken`, versus the new `sid`/JWT ladder) on the same site. That
dual-stack cost is the real severity here, not the individual widgets.

## Why it is one item, not three

Filed as a single item deliberately, against the BRIEF's one-file-per-discovery rule: the
discovery is "the mission-trip domain was not ported", and the three tags are not
independently useful — a finder with nothing to link to, or a fundraising tracker with no
application flow, is not a shippable half. If the domain is picked up, it will be scoped
and built as one piece of work. If it is split later, C76 is the parent.

## Evidence

- Old markup, all three: `curl` of `/widgets/mission_trip_finder.aspx`,
  `/widgets/mission_trip.aspx`, `/widgets/my_mission_trips.aspx`
- Loader table `ut=[…]` in `https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js`
  (offset ~684 900) — the three entries quoted above
- Old surfaces: `observedAttributes` brace-matched out of `/widgets/dist/MissionTripFinder.js`,
  `/dist/MissionTrip.js`, `/dist/MyMissionTrips.js`; descriptions from
  `/widgets/dist/WidgetConfigurator.js`
- Not the same as the opportunity finder: `mpp-opportunity-finder`'s
  `observedAttributes` (`/dist/OpportunityFinder.js`) contains neither
  `missiontripcampaigntypeid` nor `showfulltrips`, and
  `packages/embed-sdk/src/components/opportunity-finder.ts:64`+ contains no equivalent
- New: `grep -rho 'customElements\.define(\s*"next-[a-z-]*' packages/embed-sdk/src` → 25
  elements, none mission-trip; `ls src/app/api/embed/`; `ls src/services/`
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` sections 2.7, 3, 4.5

## Where to fix

Nothing to fix — three elements, their routes and a service to build:

- `packages/embed-sdk/src/components/mission-trip-finder.ts`,
  `mission-trip-details.ts`, `my-mission-trips.ts` (+ three demo pages)
- `src/app/api/embed/mission-trips/…`
- `src/services/missionTripService.ts`

## Suggested fix

Treat this as a roadmap and scoping question, not a defect to patch — it is very likely a
deliberate scope decision, and the useful output of this item is a recorded decision rather
than code.

If it is picked up: the data model is Pledge Campaigns, so
`src/services/pledgeCampaignService.ts` and `myPledgesService.ts` are the starting point,
not the opportunity services. `next-opportunity-finder` / `next-opportunity-details` are
the right *structural* template for the finder/details pair (filters → cards → detail →
apply), and `src/services/planYourVisitService.ts` is the in-repo precedent for the
applicant confirmation email. The two options with no analogue anywhere in the new SDK are
`showdonors` and `showteamprogress` — both expose one person's fundraising data to another
(a donor list to a participant, a participant's totals to a trip leader), so they need an
authorisation rule decided up front rather than an attribute that merely hides a section
client-side.

Either way, say so explicitly in the customer migration notes: a church running trips needs
to know before cutover that these three pages stay on MPWidgets.js.

## Resolution — BUILT, 2026-09-11

The mission-trip domain ships on `feature/tier2-about-me-mission-trips` as **two** elements,
not three. Plan: `Plans/mission-trips.md`.

- `packages/embed-sdk/src/components/mission-trip-finder.ts` → `next-mission-trip-finder`
- `packages/embed-sdk/src/components/my-mission-trips.ts` → `next-my-mission-trips`
- `src/services/missionTripService.ts`; four routes under
  `src/app/api/embed/mission-trips/` (finder, `mine`, `donors`, `team`)
- `packages/types/src/mission-trips.ts`; two demo pages; complete `en` / `es` / `pt-BR`
- 46 service tests + 55 component tests

### Why two elements and not three: `@IsMissionTrip` is a dead parameter

This finding filed the domain as one item covering three tags, and that was the right call —
but the sizing assumed three widgets. It is two.

`api_MPPW_GetPledgeCampaign` declares `@IsMissionTrip bit` on line 20 of its parameter list
and **never references it in the body**. `mpp-mission-trip` and `mpp-pledge-campaign` call
that same procedure and receive byte-identical data. The two legacy clients also share the
household "apply as" picker (`HouseholdApiService`), the `CustomFormBuilder` application
form, the `HasPledged` check on picker change, and a confirmation email driven by a template
id attribute. `mpp-mission-trip` even declares `missiontripcampaignid` in
`observedAttributes` and never reads it — `loadAttributes()` reads only `pledgecampaignid`
and `applicantemailtemplate`.

`next-pledge-campaign` already implemented every one of those. It is the mission-trip details
page; the finder links to it through the `id-parameter-name` attribute both elements share.
What it needed was four fields the procedure already returned and the service simply dropped
— `Maximum_Registrants`, `PledgeCount`, `Registration_Start`, `Registration_End` — so that a
full or out-of-window campaign blocks the form. That was never trip-specific: a capital
campaign with a registrant cap had the same defect and accepted pledges indefinitely.

### The authorisation rule this finding asked for — and the leak it turned out to be

*Suggested fix* said `showdonors` and `showteamprogress` "need an authorisation rule decided
up front rather than an attribute that merely hides a section client-side". That was exactly
right, and understated.

`api_MPPW_GetMyMissionTripTeamProgress` has **no `Trip_Leader` predicate at all**. It scopes
to campaigns the caller's household has a pledge on, then returns *every* pledge on those
campaigns — each teammate's `Email_Address`, `Mobile_Phone`, `Total_Pledge`, `Campaign_Goal`
and amount raised. Both gates ran in the browser: `showteamprogress` is host-page markup
(`mpp-my-mission-trips.js:120`) and the leader test is an array filter on data the browser
already holds (`:216`). Any signed-in participant could call the endpoint directly and read
the roster — on a youth trip, a list of minors' mobile numbers.

Decided with the owner and enforced server-side: the roster requires a **visible** pledge on
the campaign with `Trip_Leader = 1`, answering `403 not_trip_leader` otherwise. "Visible",
not "the caller's own" — legacy's household rule exists precisely so a head of household can
manage a teenager's trip, and the child holds the pledge, so a caller-only check would 403
the very person the rule serves. A dedicated test covers that case.

A second privacy defect came with it: the roster procedure selects `Email_Address` and
`Mobile_Phone` raw, while the donors procedure carefully honours `Home_Address_Unlisted`,
`Mobile_Phone_Unlisted` and `Email_Unlisted` — two different answers about the same person's
privacy inside one widget. The roster now honours them too. A trip leader is not staff.

Household scope and donor-list detail were kept at legacy parity, both by explicit decision.

### Other legacy defects deliberately not ported

- **`showfulltrips="false"` was inverted.** The SQL keeps
  `Current_Registrants >= Maximum_Registrants` — the definition of *full* — so asking to hide
  full trips returned uncapped trips plus exactly the full ones, and hid every trip with
  space. Fixed in TypeScript rather than by shipping corrected SQL every church would have to
  install.
- **The donors endpoint had no campaign scope and no date window**, unlike the sibling
  procedures; it returned every donor of every trip the caller ever pledged to. Now scoped to
  one campaign and to the same window.
- **Donors were de-duplicated by `(Contact_ID, Pledge_ID)`** (`MissionTripManager.cs:141`),
  silently dropping a donor's second gift to the same participant. Every distribution row now
  survives.
- **`apiRecord["ForeignCountry"]` never matched the procedure's `Foreign_Country` alias**, so
  that field was always null in the legacy widget.
- Suppressed fields are `null`, not legacy's `"--"` / `""` sentinels — a display concern that
  had leaked into the data layer.

### Two things found during the build that outlive this item

- **`api_MPPW_GetPledgeCampaign` aliases `Registration_Start` and `Registration_End` twice**
  in one `SELECT` — once from `Pledge_Campaigns` (lines 42–43), once from the linked `Events`
  row (55–56), the latter wrapped in a `CASE` that yields `NULL` when the event's congregation
  has no time zone. Duplicate keys collapse in the JSON row, so which one arrives is not ours
  to control. Not fixed: correcting it means shipping a changed procedure to every church, and
  the two windows are normally identical on a trip. The failure mode is benign — a null bound
  reads as "no bound", so the form falls open rather than wrongly refusing. Documented in
  README.
- **MP registers the four procedures across two script eras**: `GetMyMissionTrips` and
  `GetMyMissionTripDonors` in `001-Changes.sql`, `SearchMissionTrips` and
  `GetMyMissionTripTeamProgress` in the later `099-StoredProcMetaData.sql`. A domain on an
  older revision genuinely has half of them, so availability is probed **per procedure** over
  one memoised `getProcedures()` call, and each panel degrades on its own.

### The migration note this finding asked for is now the opposite one

*"Churches running mission trips must keep MPWidgets.js on those three pages"* is deleted —
this was the largest remaining dual-stack obligation in the catalogue. It is replaced by
setup instructions plus one warning: the team roster is now trip-leaders-only and enforced on
the server, so participants used to seeing each other's totals will stop. That is the fix for
the leak above, not a regression, but it should not arrive as a surprise.

### Not reproducible on the reference domain

Neither the finder nor the roster can be demonstrated there. All three type-2 campaigns have
events that ended (2018, 2018, 2024) and the 2024 one also lacks a Program and has
`Allow_Online_Pledge = 0`; campaign 4 is the only one with a genuine `Trip_Leader` and
several household members, and its `End_Date` puts it outside the 180-day window. Household 1
does have a live trip via campaign 3. The demo pages say all of this on the page rather than
rendering an empty widget that reads as broken. The shared domain was not edited. Both
authorisation rules are covered by fixture-driven tests regardless.

### The BRIEF correction in this finding stands

`next-opportunity-finder` does **not** cover `mpp-mission-trip-finder`: one filters
Opportunities, the other filters Pledge Campaigns. Confirmed against both sources during the
build.
