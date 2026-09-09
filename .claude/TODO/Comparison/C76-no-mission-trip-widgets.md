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
