# CONFIG-MAP — legacy widget configuration vs `next-*` configuration

**Produced:** 2026-09-08 by the config-cartographer subagent (block C60–C79).
**Method:** pure HTTP + source reading. **No browser was used.** Nothing in this file
is a behavioural observation; everything is either a fetched byte or a line of source.

Read this before comparing any widget pair. It tells you *what configuration to set on
the new widget so the comparison is like-for-like*, and it lists the parity gaps that
are already conclusive without a browser.

---

## 0. Confidence and method, up front

| Claim class | How it was measured | Confidence |
|---|---|---|
| Old-page markup + attributes | `curl` of each `.aspx`, regex over the returned HTML | **measured, complete** |
| Legacy tag catalogue + script map | the `ut=[…]` loader table inside `https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js` | **measured, complete** |
| Legacy attribute surface per widget | `observedAttributes` getter, brace-matched out of each `/widgets/dist/<W>.js` **and** cross-checked against the `WidgetDetails.configurationItems` metadata in `WidgetConfigurator.js` (which bundles all 29 configurable widgets) | **complete (from `observedAttributes`)** except where noted |
| Legacy per-attribute meaning | `configurationItems[].description` from `WidgetConfigurator.js` | **measured** (verbatim vendor copy) |
| New attribute surface | `static get observedAttributes()` + `getAttribute(...)`/`hasAttribute(...)` in `packages/embed-sdk/src/components/*.ts` | **complete, authoritative** |
| Legacy user-visible copy | **not measurable statically** — see §6 | n/a |
| Anything about rendering, data, or flows | **not attempted** | n/a |

Two nuances that matter when you read the tables:

1. **`observedAttributes` is the superset, not `configurationItems`.** The configurator's
   metadata is incomplete for three attributes that the code definitely reads:
   `mpp-checkout/receipttemplateid`, `mpp-opportunity-details/showfulladdress`,
   `mpp-opportunity-details/responseemailtemplate`. All three appear in
   `observedAttributes` *and* in a `getAttribute("…")` call. Conversely
   `configurationItems` lists five attributes absent from `observedAttributes`
   (`mpp-group-finder/meetsonline`, `/meetingtimes`, `mpp-opportunity-finder/eventid`,
   `mpp-my-mission-trips/showdonors`, `/showteamprogress`) — those are read at search
   time rather than observed for change, so they are real. The union is the surface.
2. **How a legacy attribute works.** Legacy widgets render a search form whose field
   `id`s equal the attribute names (e.g. `<select id="congregationId">`,
   `<input id="cityPostalCode">`). A base-class routine copies element attributes onto
   those fields, so `congregationid="3"` **pre-sets and locks a visible filter**. That is
   why "missing attribute" on a new widget sometimes means "the filter control itself is
   missing" — flagged per row below.

---

## 1. The old sample site is one shell page, 21 times

Every page under `https://mpi.ministryplatform.com/widgets/` is byte-identical except
**one line**. Verified by diffing all 21 fetched pages against each other: the only
difference is the widget element inside the second `.container`.

The shell is:

- `<link href=".../_DomainData/mpi.ministryplatform.com/skins/default/simple-grid.min.css">`
- `<script id="MPWidgets" src="https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js"></script>` — **no `defer`, no `type=module`, in `<head>`**
- `<mpp-locale-selector></mpp-locale-selector>` (top-left, every page)
- a plain `<select onchange="window.location.href=this.value">` site nav (not a widget)
- `<h1>Sample Widgets</h1>`
- `<mpp-user-login></mpp-user-login>` (top-right, every page)
- `<hr>` → the page's one widget → `<hr>`
- footer: `Sample Widgets` / `Powered-by MinistryPlatform!`

**There is not one inline `<script>` on any of the 21 pages.** No widget is configured or
post-processed by page JS; every option is a markup attribute. `<title>` is
`Sample Widgets` everywhere. So "the page's own visible copy around the widget" is the
same everywhere and shapes no expectations — all copy you see is the widget's own, served
from MP (§6).

`/widgets/AboutMe` and `/widgets/WidgetConfigurator` are **not** SPAs and not special:
they are the same server-rendered shell (extensionless routes), carrying
`<mpp-about-me>` and `<mpp-widget-configurator>` respectively. `mpp-widget-configurator`
is MP's own attribute-authoring tool (it is `excludeFromConfigurator:!0` in the loader
table, i.e. it does not offer to configure itself); its bundle is what §3's metadata was
extracted from, and it has no `next-*` counterpart by design.

---

## 2. Per-page map, with the exact new-widget setup to match it

Every old URL is prefixed `https://mpi.ministryplatform.com`. Every new demo URL is
prefixed `http://localhost:5173`.

> **Setting attributes from Playwright — read this first.** `MPNextWidget`'s constructor
> captures `api-host` (`packages/embed-sdk/src/shared/base-widget.ts:17-21`), so a
> `setAttribute("api-host", …)` **after** the element exists is too late. The demo pages
> already document this (`demo-custom-form.html:132`). To reconfigure a demo widget,
> either (a) `setAttribute` for the *filter* attributes only — those are in
> `observedAttributes` and are re-read — or (b) replace the element wholesale:
> `box.innerHTML = '<next-x a="1" api-host="http://localhost:3000"></next-x>'`.
> Option (b) is what the demo pages themselves do. **Do not edit the demo pages.**

### 2.1 Home / RSS — `/widgets`

```html
<mpp-rss-reader publicationName="prayer"></mpp-rss-reader>
```

**No new counterpart.** `next-*` has no RSS/publication-feed element. Filed as **C71**.
Nothing to load; there is no demo page to open.

### 2.2 Event Finder — `/widgets/event_finder.aspx`

```html
<mpp-event-finder target="./event_details.aspx/"></mpp-event-finder>
```

Only `target` is set — every filter is left at its default, so the old page shows the
**unfiltered** event list with all filter controls interactive.

**Match with:** `/demo-event-finder.html`, which is already
`<next-event-finder target-url="/demo-event-details.html" api-host="…">` — i.e. already
like-for-like. No override needed for the baseline pass.

To exercise a filter for parity, set it on **both** sides (old via a fresh page whose
markup you cannot change — so drive the old widget's *form control*, and the new
widget's *attribute*, or drive both through their form controls):

```js
// new — these are all in observedAttributes and re-read on change
const w = page.locator("next-event-finder");
await w.evaluate(el => el.setAttribute("congregation-id", "3"));
```

### 2.3 Group Finder — `/widgets/group_finder.aspx`

```html
<mpp-group-finder targeturl="./group_details.aspx/"
                  showsuggestagroupbutton="true"></mpp-group-finder>
```

**Match with:** `/demo-group-finder.html` — already
`target-url="/demo-group-details.html" show-suggest-a-group-button="true"`. Like-for-like
out of the box.

### 2.4 Make a Pledge — `/widgets/pledge_campaign.aspx`

```html
<mpp-pledge-campaign pledgecampaignid="5"
                     pledgeemailtemplate="528"
                     suggestedamounts="30,50,100"></mpp-pledge-campaign>
```

**Match with:** `/demo-pledge-campaign.html`. The demo builds the element in JS with
`campaign-id="3"` (`demo-pledge-campaign.html:211-214`) — **campaign 3, not 5**, and it
never sets `pledge-email-template`. To compare like-for-like, replace the element:

```js
await page.evaluate(() => {
  const box = document.querySelector("next-pledge-campaign").parentElement;
  box.innerHTML = '<next-pledge-campaign campaign-id="5" pledge-email-template="528"'
    + ' suggested-amounts="30,50,100" api-host="http://localhost:3000">'
    + '</next-pledge-campaign>';
});
```

### 2.5 Give Online — `/widgets/giving.aspx` — **the BRIEF's mapping is wrong here**

```html
<mpp-smart-link
  href="https://testing.realm.dev/givechurch/give/default?authenticated={{isAuthenticated}}&user={{userDisplayName}}&email={{userEmail}}&userLocale={{userLocale}}"
  target="_blank" linkclasses="giving-button">Click Here to Give</mpp-smart-link>
```

This page is **not a payment widget**. It is a link-out to Realm with four
merge tokens (`{{isAuthenticated}}`, `{{userDisplayName}}`, `{{userEmail}}`,
`{{userLocale}}`) substituted from the signed-in MP user. The BRIEF pairs
`next-checkout`/`next-pay`/`next-checkout-complete` with this page; **do not** — there is
nothing to compare. `mpp-smart-link` has no `next-*` counterpart (filed **C74**), nor
does its sibling `mpp-smart-frame` (**C75**).

The **real** legacy payment surface is on three other pages, none of which is in the
BRIEF's page map. Use these instead:

| New | Old | Old markup |
|---|---|---|
| `next-checkout` (`/demo-checkout.html`) | `/widgets/Checkout` and `/widgets/checkout/` (same page) | `<mpp-checkout paymentprocessortargeturl="https://mpi.ministryplatform.com/widgets/pay?authenticated={{isAuthenticated}}" backtoeventtargeturl="https://mpi.ministryplatform.com/widgets/event_details.aspx/" receipttemplateid="2695">` |
| `next-pay` (`/demo-pay.html`) | `/widgets/pay` | `<mpp-pay>` (no attributes) |
| `next-checkout-complete` (`/demo-checkout-complete.html`) | *no sample page exists*; the tag `mpp-checkout-complete` is in the loader table and takes no attributes | — |

Demo `next-checkout` is `payment-processor-url="/demo-pay.html"
back-to-event-url="/demo-event-finder.html" invoice-id-parameter-name="id"` — the shape
matches, but there is **no `receipt-template-id`** to set (**C66**).

### 2.6 Prayer And Feedback — `/widgets/prayer_feedback_form.aspx` — **mapping wrong here too**

```html
<mpp-prayer-feedback-form
  returnurl="https://mpi.ministryplatform.com/widgetsprayer_feedback_form.aspx/"
  programid="12" verificationemailtemplate="5125"></mpp-prayer-feedback-form>
```

(Note the old page's own `returnurl` is malformed — `…/widgetsprayer_feedback_form.aspx/`,
missing the `/` after `widgets`. That is a defect in MP's sample page, not in either
widget. Don't file it.)

This is **not** `mpp-custom-form`. MPWidgets.js knows both tags; they are different
widgets with disjoint attribute surfaces. `mpp-prayer-feedback-form` writes
`Feedback_Entries` against a Program with a configurable Feedback-Type dropdown, and has
**no `next-*` counterpart** — filed **C69**.

The true counterpart of `next-custom-form` is **`mpp-custom-form`** (`formguid`), for
which **the sample site has no page**. To compare, you must place `mpp-custom-form`
yourself (see §5 "how to drive a legacy widget with no sample page").

**Match with:** `/demo-custom-form.html` — it has a form-picker UI and rebuilds the
element as `<next-custom-form form-id|form-guid="…" api-host="…">`.

### 2.7 Mission Trip Finder — `/widgets/mission_trip_finder.aspx`

```html
<mpp-mission-trip-finder target="./mission_trip.aspx/"></mpp-mission-trip-finder>
```

Detail page `/widgets/mission_trip.aspx`:
`<mpp-mission-trip applicantemailtemplate="609">`.
`/widgets/my_mission_trips.aspx`: `<mpp-my-mission-trips missiontripcampaigntypeid="2">`.

**No new counterpart for any of the three.** The BRIEF suggests
`next-opportunity-finder` covers Mission Trip Finder ("old has two finders over the same
table") — that is **not** what the source says: `mpp-opportunity-finder` queries
Opportunities, `mpp-mission-trip-finder` queries **Pledge Campaigns** filtered by
`missiontripcampaigntypeid`, with its own `showfulltrips`. Different table, different
attribute surface, and `next-opportunity-finder` has neither attribute. Filed **C76**.

### 2.8 My Contribution Statement — `/widgets/my_contribution_statement.aspx`

```html
<mpp-my-contribution-statement
  mygivingwidgettargeturl="./RsvpEvents"></mpp-my-contribution-statement>
```

(The sample value points at `/widgets/RsvpEvents`, which actually hosts
`<mpp-rsvp-events eventDate="1/1/0001">` — a tag MPWidgets.js does **not** know, so that
target page renders nothing. Sample-site misconfiguration; not a finding.)

**Match with:** `/demo-my-contribution-statement.html` (`next-my-contribution-statement`,
**zero attributes accepted**). The `mygivingwidgettargeturl` link-out has no equivalent —
filed **C62**.

Also note: the legacy widget carries the **"go paperless" toggle**
(`/Api/ContributionsApi/SetStatementMethod?goPaperless=`, verified in
`MyContributionStatement.js`). In the new SDK that is split into a **separate element**,
`next-statement-preferences` (`/demo-statement-preferences.html`). So
`next-statement-preferences` is **not** "new only" as the BRIEF says — compare it against
the paperless control inside the legacy contribution-statement widget.

### 2.9 My Groups — `/widgets/my_groups.aspx`

```html
<mpp-my-groups hidegrouplife="false"></mpp-my-groups>
```

**Match with:** `/demo-my-groups.html`. New accepts `hidegrouplife` **with the identical
spelling** (flat lowercase, not kebab). `setAttribute("hidegrouplife","false")` is
already the default, so the demo is like-for-like as shipped.

### 2.10 My Household — `/widgets/my_household.aspx` (also `/widgets/MyHousehold`)

```html
<mpp-household hideaddhouseholdmember="false"></mpp-household>
```

**Match with:** `/demo-my-household.html`. New accepts `hideaddhouseholdmember`
verbatim. Like-for-like as shipped.

### 2.11 My Invoices — `/widgets/my_invoices.aspx`

```html
<mpp-my-invoices targeturl="https://mpi.ministryplatform.com/widgets/checkout/"
                 hidefreeeventscheckbox="false"></mpp-my-invoices>
```

**Match with:** `/demo-my-invoices.html` — `next-my-invoices` accepts **no attributes at
all** (no `observedAttributes`, no `getAttribute` anywhere in
`packages/embed-sdk/src/components/my-invoices.ts`). Six legacy options have no
equivalent, and the corresponding **filter controls** are absent too. Filed **C60**.

### 2.12 My Pledges — `/widgets/my_pledges.aspx`

```html
<mpp-my-pledges hidecancelbuttonpledge="false"></mpp-my-pledges>
```

**Match with:** `/demo-my-pledges.html`. New accepts `hidecancelbuttonpledge` and
`cancelpledgeemailtemplate` verbatim — **full parity**. Like-for-like as shipped.

### 2.13 My Giving — `/widgets/my_giving.aspx`

```html
<mpp-my-giving hidesoftcredits="false"></mpp-my-giving>
```

**Match with:** `/demo-my-giving.html`. New accepts `hidesoftcredits` verbatim — full
parity, like-for-like as shipped.

### 2.14 My Subscriptions — `/widgets/subscriptions.aspx` (also `/widgets/Subscriptions`)

```html
<mpp-subscriptions target="./Subscriptions/"></mpp-subscriptions>
```

(`target` is **not** in `mpp-subscriptions`'s `observedAttributes` — only
`congregationid` is. The sample page's `target` is dead.)

**Match with:** `/demo-subscriptions.html` — `next-subscriptions` accepts no attributes.
`congregationid` has no equivalent client-side *or* server-side (the route and service
filter only on `Available_Online`). Filed **C61**.

### 2.15 Online Directory — `/widgets/online_directory.aspx`

```html
<mpp-online-directory keyword="" hideAddress="true" hideEmail="false"
                      hideBirthdayIcon="false" hideFamilyLink="false"></mpp-online-directory>
```

**`hideAddress="true"` is the one place the sample site turns a feature off.** The demo
page sets none of these, so the map icon is **shown** on the new side and **hidden** on
the old side. Override before comparing:

```js
await page.locator("next-online-directory")
  .evaluate(el => el.setAttribute("hide-address", "true"));
```

(`hide-address` is in `observedAttributes`, so a late `setAttribute` is fine.)

### 2.16 Opportunity Finder — `/widgets/opportunity_finder.aspx` (also `/widgets/Opportunities`)

```html
<mpp-opportunity-finder target="./Opportunities/"></mpp-opportunity-finder>
```

Detail page `/widgets/opportunity_details.aspx` (not in the BRIEF map):
`<mpp-opportunity-details returnurl="../Opportunities">`.

**Match with:** `/demo-opportunity-finder.html` (`target-url="/demo-opportunity-details.html"`)
and `/demo-opportunity-details.html` (`return-url="/demo-opportunity-finder.html"`).
Like-for-like. `next-opportunity-details` is therefore **not** "new only" as the BRIEF
says.

### 2.17 Plan Your Visit — `/widgets/plan_your_visit.aspx`

```html
<mpp-plan-your-visit
  returnUrl="https://mpi.ministryplatform.com/planyourvisit/"
  verificationEmailTemplateId="122"
  userNotificationEmailTemplateId="131"
  churchNotificationEmailTemplateId="132"
  collectAddress="true"
  milestoneToAssignId="2"
  milestoneProgramId="3"></mpp-plan-your-visit>
```

**Match with:** `/demo-plan-your-visit.html`. The demo builds the element from a
localStorage config panel (`demo-plan-your-visit.html:185-192`) and defaults to
`collect-address="true"` with template ids left blank. Replace it to mirror the old page:

```js
await page.evaluate(() => {
  const el = document.querySelector("next-plan-your-visit");
  el.parentElement.innerHTML =
    '<next-plan-your-visit api-host="http://localhost:3000"'
    + ' return-url="' + location.origin + '/demo-plan-your-visit.html"'
    + ' verification-email-template-id="122"'
    + ' church-notification-email-template-id="132"'
    + ' collect-address="true" milestone-to-assign-id="2"'
    + ' milestone-program-id="3"></next-plan-your-visit>';
});
```

There is deliberately no `user-notification-email-template-id` in that snippet — the new
widget has no such attribute. Filed **C63**.

### 2.18 Subscribe to Publication — `/widgets/subscribe_to_publication.aspx`

```html
<mpp-subscribe-to-publication
  returnurl="https://mpi.ministryplatform.com/subscribetopublication/"
  verificationEmailTemplateid="157" publicationid="4"></mpp-subscribe-to-publication>
```

**No new counterpart.** The BRIEF pairs this with `next-subscriptions`; they are
different capabilities. `mpp-subscribe-to-publication` is an **anonymous, single-
publication, email-verified opt-in**; `next-subscriptions` is a signed-in checkbox list
over all `Available_Online` publications (`src/services/subscriptionService.ts:51-85`,
`src/app/api/embed/subscriptions/route.ts:29-32` returns 401 for `sub === "public"`).
Filed **C70**.

### 2.19 About Me — `/widgets/AboutMe`

```html
<mpp-about-me></mpp-about-me>
```

Not an SPA — the standard shell (§1). `mpp-about-me`'s `observedAttributes` is `[]` and
its `configurationItems` is `[]`; the only attribute it reads is `customCss`.

**Match with:** `/demo-profile.html` (`next-profile`, also zero attributes). **Attribute
parity is complete** for this pair — the only difference is `customCss` (§4.10 / **C67**).

### 2.20 Widget Configurator — `/widgets/WidgetConfigurator`

```html
<mpp-widget-configurator></mpp-widget-configurator>
```

MP's own attribute-authoring tool: it bundles all 29 configurable widgets plus a
`WidgetDetails` metadata record per widget (`{name, tag, configurationItems:[{name,
attribute, description, required, type, fkTable, listValues}]}`). **That bundle is the
source of §3 and §4.** It is tooling, not a customer-facing widget; no counterpart is
expected and none is filed.

### 2.21 Detail / secondary pages not in the BRIEF's map

Found by following the `target`/`targeturl` values above. All returned 200.

| URL | Markup |
|---|---|
| `/widgets/event_details.aspx` | `<mpp-event-details returnurl="../Events" checkouturl="https://mpi.ministryplatform.com/Checkout/" opportunityfinderwidgettargeturl="https://mpi.ministryplatform.com/Opportunities/" myhouseholdwidgettargeturl="https://mpi.ministryplatform.com/MyHousehold/" freeeventtemplateid="131" target="../EventSignup/">` |
| `/widgets/group_details.aspx` | `<mpp-group-details returnurl="../Groups" inquiryemailtemplate="665" signupemailtemplate="664" inquirefullgroups="false" leadersignupemailtemplate="664">` |
| `/widgets/opportunity_details.aspx` | `<mpp-opportunity-details returnurl="../Opportunities">` |
| `/widgets/mission_trip.aspx` | `<mpp-mission-trip applicantemailtemplate="609">` |
| `/widgets/Checkout`, `/widgets/checkout/` | `<mpp-checkout paymentprocessortargeturl="…/widgets/pay?authenticated={{isAuthenticated}}" backtoeventtargeturl="…/widgets/event_details.aspx/" receipttemplateid="2695">` |
| `/widgets/pay` | `<mpp-pay>` |
| `/widgets/Events` | `<mpp-event-finder target="./event_details.aspx/">` (alias of 2.2) |
| `/widgets/Groups` | `<mpp-group-finder targeturl="./group_details.aspx/" showsuggestagroupbutton="true">` (alias of 2.3) |
| `/widgets/MyHousehold` | `<mpp-household hideaddhouseholdmember="false">` (alias of 2.10) |
| `/widgets/Opportunities` | `<mpp-opportunity-finder target="./Opportunities/">` (alias of 2.16) |
| `/widgets/Subscriptions` | `<mpp-subscriptions target="./Subscriptions/">` (alias of 2.14) |
| `/widgets/RsvpEvents` | `<mpp-rsvp-events eventDate="1/1/0001">` — **tag unknown to MPWidgets.js; renders nothing** |
| `/widgets/EventSignup` | **404** — `mpp-event-details`'s `target="../EventSignup/"` is a dead link on the sample site |

Two dead attributes on `/widgets/event_details.aspx`: `myhouseholdwidgettargeturl` and
`freeeventtemplateid` are in neither `observedAttributes` nor any `getAttribute(…)` in
`EventDetails.js`. The sample page sets options the widget does not read. Not findings.

**Detail-page id convention differs between the systems.** Legacy appends the id as a
**trailing path segment** (`/widgets/event_details.aspx/123` — verified 200); new widgets
read a **query parameter** (`?id=123`, name overridable via `id-parameter-name`, default
`"id"` — `event-details.ts:275-296`) or an explicit `event-id` attribute. Migration note,
not a defect — but it means a customer's existing `target="…/details/"` value cannot be
carried across verbatim.

---

## 3. The complete legacy catalogue MPWidgets.js knows

**36 tags**, extracted verbatim from the `ut=[…]` table in
`https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js` (offset ~684 900). Method:
**complete** — this is the loader's own registry, not a grep.

The loader also references two non-table internal tags (`mpp-widgets`,
`mpp-user-service`); those are plumbing, not widgets.

| # | Tag | Script | Loader "name" | New counterpart |
|---|---|---|---|---|
| 1 | `mpp-about-me` | `/dist/AboutMe.js` | About Me | `next-profile` |
| 2 | `mpp-checkout` | `/dist/Checkout.js` | Checkout | `next-checkout` |
| 3 | `mpp-checkout-complete` | `/dist/CheckoutComplete.js` | Checkout Complete | `next-checkout-complete` |
| 4 | `mpp-custom-form` | `/dist/MppCustomForm.js` | Custom Form | `next-custom-form` |
| 5 | `mpp-event-details` | `/dist/EventDetails.js` | Event Details | `next-event-details` |
| 6 | `mpp-event-finder` | `/dist/EventFinder.js` | Event Finder | `next-event-finder` |
| 7 | `mpp-event-registration` | `/dist/EventRegistration.js` | Event Registration | folded into `next-event-details` |
| 8 | `mpp-group-details` | `/dist/GroupDetails.js` | Group Details | `next-group-details` |
| 9 | `mpp-group-finder` | `/dist/GroupFinder.js` | Group Finder | `next-group-finder` |
| 10 | `mpp-household` | `/dist/Household.js` | My Household | `next-my-household` |
| 11 | `mpp-locale-selector` | `/dist/LocaleSelector.js` | Locale Selector | **none — C73** |
| 12 | `mpp-mission-trip` | `/dist/MissionTrip.js` | Mission Trip | **none — C76** |
| 13 | `mpp-mission-trip-finder` | `/dist/MissionTripFinder.js` | Mission Trip Finder | **none — C76** |
| 14 | `mpp-my-contribution-statement` | `/dist/MyContributionStatement.js` | My Contribution Statement | `next-my-contribution-statement` + `next-statement-preferences` |
| 15 | `mpp-my-giving` | `/dist/MyGiving.js` | My Giving | `next-my-giving` |
| 16 | `mpp-my-groups` | `/dist/MyGroups.js` | My Groups | `next-my-groups` |
| 17 | `mpp-my-invoices` | `/dist/MyInvoices.js` | My Invoices | `next-my-invoices` |
| 18 | `mpp-my-mission-trips` | `/dist/MyMissionTrips.js` | My Mission Trips | **none — C76** |
| 19 | `mpp-my-pledges` | `/dist/MyPledges.js` | My Pledges | `next-my-pledges` |
| 20 | `mpp-online-directory` | `/dist/OnlineDirectory.js` | Online Directory | `next-online-directory` |
| 21 | `mpp-opportunity-details` | `/dist/OpportunityDetails.js` | Opportunity Details | `next-opportunity-details` |
| 22 | `mpp-opportunity-finder` | `/dist/OpportunityFinder.js` | Opportunity Finder | `next-opportunity-finder` |
| 23 | `mpp-pay` | `/dist/Pay.js` | Pay *(excluded from configurator)* | `next-pay` |
| 24 | `mpp-plan-your-visit` | `/dist/PlanYourVisit.js` | Plan Your Visit | `next-plan-your-visit` |
| 25 | `mpp-pledge-campaign` | `/dist/PledgeCampaign.js` | Pledge Campaigns | `next-pledge-campaign` |
| 26 | `mpp-prayer-feedback-form` | `/dist/PrayerFeedbackForm.js` | Prayer Feedback | **none — C69** |
| 27 | `mpp-pre-check` | `/dist/PreCheck.js` | Pre Check *(excluded from configurator)* | **none — C78** |
| 28 | `mpp-rss-reader` | `/dist/RssReader.js` | RSS Reader | **none — C71** |
| 29 | `mpp-smart-frame` | `/dist/SmartFrame.js` | Smart Frame | **none — C75** |
| 30 | `mpp-smart-link` | `/dist/SmartLink.js` | Smart Link | **none — C74** |
| 31 | `mpp-subscribe-to-publication` | `/dist/SubscribeToPublication.js` | Subscribe to Publication | **none — C70** |
| 32 | `mpp-subscriptions` | `/dist/Subscriptions.js` | Subscriptions | `next-subscriptions` |
| 33 | `mpp-unsubscribe` | `/dist/Unsubscribe.js` | Unsubscribe from Publications | **none — C72** |
| 34 | `mpp-user-label` | `/dist/UserLabels.js` | User Label | **none — C77** |
| 35 | `mpp-user-login` | `/dist/UserLogin.js` | User Login | `next-user-menu` |
| 36 | `mpp-widget-configurator` | `/dist/WidgetConfigurator.js` | Widget Configurator *(excluded from configurator)* | none (tooling — expected) |

**Counts: 36 legacy tags vs 25 `next-*` elements.** Excluding the configurator itself,
**35 customer-facing legacy widgets**; 11 of them have no counterpart at all.

### 3.1 `next-*` elements with no legacy counterpart

| New element | Nearest legacy | Note |
|---|---|---|
| `next-full-calendar` | none | genuinely new. Legacy has only the finder's list/grid; no month/week/day calendar exists in MPWidgets.js. |
| `next-add-to-calendar` | none | genuinely new (Google/Outlook/M365/Yahoo/.ics). |
| `next-statement-preferences` | *part of* `mpp-my-contribution-statement` | **not new** — the paperless toggle, extracted into its own element. |
| `next-event-details` | `mpp-event-details` | the BRIEF calls this "new only"; **it is not**. |
| `next-group-details` | `mpp-group-details` | same — **not new only**. |
| `next-opportunity-details` | `mpp-opportunity-details` | same — **not new only**. |

So only **two** `next-*` elements are truly new-only.

---

## 4. Attribute-parity tables, per pair

Old column = union of `observedAttributes` ∪ `configurationItems[].attribute` for the
legacy tag. New column = `observedAttributes` ∪ `getAttribute`/`hasAttribute` in the
component source. `api-host` / `token` are `MPNextWidget` infrastructure and are omitted
from every table; `data-*` internals are omitted from both sides.

**Every legacy option that survived was renamed** — legacy is flat lowercase, new is
kebab-case — except the four "my-" widgets in §4.11, which kept legacy spelling. Since
the element names changed too (`mpp-x` → `next-x`), no customer's existing markup carries
over regardless; `renamed` rows are therefore migration work, not defects, and none is
filed. **`missing in new` rows are the findings.**

### 4.1 `next-event-finder` ← `mpp-event-finder`

| Old | New | Status |
|---|---|---|
| `targeturl` | `target-url` | renamed |
| `target` (alias of `targeturl`) | — | **missing in new** (alias only; the sample page uses it) |
| `congregationid` | `congregation-id` | renamed |
| `programid` | `program-id` | renamed |
| `ministryid` | `ministry-id` | renamed |
| `eventtypeid` | `event-type-id` | renamed |
| `monthid` | `month-id` | renamed |
| `signuptype` | `signup-type` | renamed |
| `isfeatured` | `featured` | renamed |
| `keyword` | `keyword` | same |
| `reduceseriesto` | `reduce-series-to` | renamed |
| — | `id-parameter-name` | new only |

**Full capability parity.** The only gap is the `target` alias, and since the tag name
changed anyway, not filed.

### 4.2 `next-group-finder` ← `mpp-group-finder`

| Old | New | Status |
|---|---|---|
| `targeturl` / `target` | `target-url` | renamed (alias dropped) |
| `congregationid` | `congregation-id` | renamed |
| `ministryid` | `ministry-id` | renamed |
| `parentgroupid` | `parent-group-id` | renamed |
| `groupfocusid` | `group-focus-id` | renamed |
| `grouptypeid` | `group-type-id` | renamed |
| `lifestageid` | `life-stage-id` | renamed |
| `meetingdays` | `meeting-days` | renamed |
| `meetingtimes` | `meeting-times` | renamed |
| `meetsonline` | `meets-online` | renamed |
| `keyword` | `keyword` | same |
| `showfullgroups` | `show-full-groups` | renamed |
| `showfuturegroups` | `show-future-groups` | renamed |
| `countgroupinquiries` | `count-group-inquiries` | renamed |
| `showsuggestagroupbutton` | `show-suggest-a-group-button` | renamed |
| **`citypostalcode`** | — | **missing in new — C64** |
| — | `id-parameter-name` | new only |

`citypostalcode` is the one gap. Note the new widget *does* render the field
(`group-finder.ts:479-480`, label "City or Postal Code") and *does* send it
(`:183` → `params.set("cityPostalCode", …)`) — it simply cannot be pre-set from markup.

### 4.3 `next-group-details` ← `mpp-group-details`

| Old | New | Status |
|---|---|---|
| `returnurl` | `return-url` | renamed |
| `inquirefullgroups` | `inquire-full-groups` | renamed |
| `countgroupinquiries` | `count-group-inquiries` | renamed |
| `inquiryemailtemplate` | `inquiry-email-template` | renamed |
| `signupemailtemplate` | `signup-email-template` | renamed |
| `leadersignupemailtemplate` | `leader-signup-email-template` | renamed |
| `showfulladdress` | `show-full-address` | renamed |
| `hidecontacttab` | `hide-contact-tab` | renamed |
| `hidesignuptab` | `hide-sign-up-tab` | renamed |
| — | `group-id`, `id-parameter-name` | new only |

**Complete parity.** Nothing filed.

### 4.4 `next-event-details` ← `mpp-event-details`

| Old | New | Status |
|---|---|---|
| `returnurl` | `return-url` | renamed |
| `checkouturl` | `checkout-url` | renamed |
| `opportunityfinderwidgettargeturl` | `opportunity-finder-url` | renamed |
| *(`myhouseholdwidgettargeturl`, `freeeventtemplateid`, `target` — set by the sample page but **never read** by `EventDetails.js`)* | — | not real legacy options |
| — | `event-id`, `id-parameter-name`, `invoice-id`, `invoice-id-parameter-name` | new only |

**Complete parity.** Nothing filed.

### 4.5 `next-opportunity-finder` ← `mpp-opportunity-finder`

| Old | New | Status |
|---|---|---|
| `targeturl` / `target` | `target-url` | renamed (alias dropped) |
| `congregationid` | `congregation-id` | renamed |
| `programid` | `program-id` | renamed |
| `ministryid` | `ministry-id` | renamed |
| `genderid` | `gender-id` | renamed |
| `minimumage` | `minimum-age` | renamed |
| `frequency` | `frequency` | same |
| `keyword` | `keyword` | same |
| `eventid` | `event-id` | renamed |
| `showattributefilter` | `show-attribute-filter` | renamed |
| `attributeids` | `attribute-ids` | renamed |
| — | `id-parameter-name` | new only |

**Complete parity.** Nothing filed. (Mission Trip Finder is a *different* legacy widget —
see §2.7 / C76 — not a second finder over this table.)

### 4.6 `next-opportunity-details` ← `mpp-opportunity-details`

| Old | New | Status |
|---|---|---|
| `returnurl` | `return-url` | renamed |
| `responseemailtemplate` | `response-email-template` | renamed |
| **`showfulladdress`** | — | **missing in new — C65** |
| — | `opportunity-id`, `id-parameter-name` | new only |

### 4.7 `next-plan-your-visit` ← `mpp-plan-your-visit`

| Old | New | Status |
|---|---|---|
| `returnurl` | `return-url` | renamed |
| `verificationemailtemplateId` | `verification-email-template-id` | renamed |
| `churchnotificationemailtemplateid` | `church-notification-email-template-id` | renamed |
| `collectaddress` | `collect-address` | renamed |
| `milestonetoassignid` | `milestone-to-assign-id` | renamed |
| `milestoneprogramid` | `milestone-program-id` | renamed |
| **`userNotificationemailtemplateid`** | — | **missing in new — C63** |
| — | `verify-param-name` | new only |

Sharpest gap on the run: `src/services/planYourVisitService.ts:495-498` **already
accepts** `model.userNotificationEmailTemplate`; the widget just never sends it
(`plan-your-visit.ts:282-283` sends only the church template) and falls back to the
congregation's `Plan_A_Visit_Template`.

### 4.8 `next-pledge-campaign` ← `mpp-pledge-campaign`

| Old | New | Status |
|---|---|---|
| `pledgecampaignid` | `campaign-id` | renamed |
| `pledgeemailtemplate` | `pledge-email-template` | renamed |
| `suggestedamounts` | `suggested-amounts` | renamed |
| — | `id-parameter-name` | new only |

**Complete parity.**

### 4.9 `next-online-directory` ← `mpp-online-directory`

| Old | New | Status |
|---|---|---|
| `congregationid` | `congregation-id` | renamed |
| `keyword` | `keyword` | same |
| `hideaddress` | `hide-address` | renamed |
| `hideemail` | `hide-email` | renamed |
| `hidebirthdayicon` | `hide-birthday-icon` | renamed |
| `hidefamilylink` | `hide-family-link` | renamed |
| `householdid` | *possibly `keyword="hh <id>"`* | **runtime confirmation needed** — see §7 |

### 4.10 `next-checkout` / `next-pay` / `next-checkout-complete`

| Old (`mpp-checkout`) | New (`next-checkout`) | Status |
|---|---|---|
| `paymentprocessortargeturl` | `payment-processor-url` | renamed |
| `backtoeventtargeturl` | `back-to-event-url` | renamed |
| **`receipttemplateid`** | — | **missing in new — C66** (no occurrence of "receipt" anywhere in `src/` or `packages/embed-sdk/src/`) |
| — | `invoice-id`, `invoice-id-parameter-name` | new only |

`mpp-pay` → `next-pay`: legacy reads only `token` (+ `customCss`); new reads `token`.
**Parity.** `mpp-checkout-complete` → `next-checkout-complete`: legacy takes no
attributes; new takes `token`. **Parity (new adds one).**

### 4.11 The "my-" family — parity, and the one naming inconsistency

| Pair | Old | New | Status |
|---|---|---|---|
| `next-my-giving` ← `mpp-my-giving` | `hidesoftcredits` | `hidesoftcredits` | **same** |
| `next-my-groups` ← `mpp-my-groups` | `hidegrouplife` | `hidegrouplife` | **same** |
| `next-my-household` ← `mpp-household` | `hideaddhouseholdmember` | `hideaddhouseholdmember` | **same** |
| `next-my-pledges` ← `mpp-my-pledges` | `hidecancelbuttonpledge`, `cancelpledgeemailtemplate` | identical | **same** |

Full functional parity for all four — and the only four new widgets that kept legacy
spelling. Every other new widget is kebab-case. Filed as **C79** (consistency, cosmetic).

### 4.12 `next-my-invoices` ← `mpp-my-invoices`

| Old | New | Status |
|---|---|---|
| `targeturl` / `target` | — | **missing in new** (new pays in-widget via a "Pay Now" button — arguably by design) |
| `congregationid` | — | **missing in new — C60** |
| `monthid` | — | **missing in new — C60** |
| `invoiceStatusId` | — | **missing in new — C60** |
| `keyword` | — | **missing in new — C60** (a free-text box exists but cannot be pre-set) |
| `hidefreeeventscheckbox` / `HideFreeEventsCheckbox` | — | **missing in new — C60** (there is no free-events checkbox to hide) |

`next-my-invoices` accepts **zero** attributes.

### 4.13 `next-subscriptions` ← `mpp-subscriptions`

| Old | New | Status |
|---|---|---|
| `congregationid` | — | **missing in new — C61** |

Also `mpp-subscribe-to-publication` (`publicationid`, `returnurl`,
`verificationemailtemplateid` — all three required) has no counterpart at all: **C70**.

### 4.14 `next-my-contribution-statement` ← `mpp-my-contribution-statement`

| Old | New | Status |
|---|---|---|
| `mygivingwidgettargeturl` | — | **missing in new — C62** |

### 4.15 `next-profile` ← `mpp-about-me`

Legacy `observedAttributes` `[]`, `configurationItems` `[]`. New: no attributes.
**Complete parity.**

### 4.16 `next-custom-form` ← `mpp-custom-form`

| Old | New | Status |
|---|---|---|
| `formguid` | `form-guid` | renamed |
| — | `form-id`, `id-parameter-name`, `checkout-url` | new only |

**Complete parity, plus three.** (The Prayer & Feedback widget is separate — C69.)

### 4.17 `next-user-menu` ← `mpp-user-login`

Legacy `observedAttributes` `[]`; its only documented option is `userUrls`, typed
`innerHTML` — i.e. the menu links are authored as the element's child markup, not as an
attribute. New: `email`, `first-name`, `last-name`, `image-url`, `mp-base-url`,
`post-logout-redirect-uri`, `prefer-mp-login`, `prevent-login-widget`, `session-scope` —
all **new only**.

| Old | New | Status |
|---|---|---|
| `userUrls` (child markup) | — | **needs runtime confirmation** — see §7 |

### 4.18 Cross-cutting: `customCss`, on **every** legacy widget

`customCss` is read by all 36 legacy bundles. Verified mechanism (`MyGiving.js`,
`setStyleFiles`):

1. `GetCustomStyles()` → `/Api/ConfigurationApi/GetCustomStyles` returns the **domain's**
   configured stylesheet URLs, and each is appended as a `<link>` into the widget's shadow
   root — automatically, on every widget, with no markup.
2. Then, if `customCss` is present on the element, that URL is appended as a second
   `<link>` — per-element override.

The new SDK has **neither** channel: no `customCss`/`custom-css` attribute anywhere in
`packages/embed-sdk/src`, no `var(--…)` theming tokens in any component (0 occurrences),
no `part=`/`exportparts`, and `MPNextWidget.injectStyles()` **assigns**
`this.root.adoptedStyleSheets = [sheet]` (`base-widget.ts:113-119`), replacing rather than
appending, so nothing can be added from outside either. Filed **C68**.

`public/embed-sdk/mp-widget-overrides.css` is not a substitute — it styles *MP's* shadow
DOM widgets (the `<mpp-user-login>` the user menu injects), not the `next-*` widgets.

---

## 5. Driving a legacy widget that has no sample page

Several comparisons need a legacy tag the sample site never places
(`mpp-custom-form`, `mpp-checkout-complete`, `mpp-unsubscribe`, `mpp-user-label`,
`mpp-smart-frame`, `mpp-pre-check`). You cannot just inject the tag after load:

> **MPWidgets.js is a loader, not a bundle.** On its own `DOMContentLoaded` it scans for
> the tags it knows, fetches `/widgets/dist/<Widget>.js` only for tags it found, and
> installs its `MutationObserver` **after** an awaited CSRF round-trip in that same
> handler. A tag inserted between those two points is seen by neither, and
> `customElements.whenDefined()` never resolves for it.

So inject the tag **before** `DOMContentLoaded` — `page.addInitScript` that writes it into
the body, or `page.route` the `.aspx` and rewrite the one widget line in the shell — or
inject late and keep re-inserting until MP registers it (the pattern
`watchMpLoginRegistration()` uses in `packages/embed-sdk/src/components/user-menu.ts`:
re-insert every 300 ms, 6 s budget). Rewriting the fetched HTML is by far the simplest
here, since the shell (§1) is one predictable line.

---

## 6. User-visible strings: what is and is not statically comparable

**Legacy widget copy is not in the bundles.** Every label comes from
`GET /Api/ConfigurationApi/GetLabels?componentName=<tag>` and is interpolated as
`${this._i18n.<key>}` / `${t.<key>}` at render time. `EventFinder.js` contains exactly
**two** literal label strings (`showAdvancedSearchLabel`, `hideAdvancedSearchLabel` — and
even those are i18n keys, not text). The only hardcoded English found across the paired
bundles is `value="Login"` (MyInvoices, Subscriptions, OnlineDirectory) and
`value="Close"` (OnlineDirectory). An unauthenticated `curl` of `GetLabels` returns
`500 "Object reference not set to an instance of an object."` — it needs the CSRF/session
headers MPWidgets.js sets up, so **a browser is required to capture legacy copy.**

Three consequences for the run:

1. **All label comparison is a runtime task.** Do not file a cosmetic wording finding off
   this document; capture both sides in the browser.
2. **New widget copy is hardcoded English in the component source.** There is no
   `GetLabels` equivalent — no `labels`/i18n endpoint under `src/app/api/embed/`
   (27 route directories, none of them labels). So a customer who renamed
   "Group Finder" → "Find a Small Group" in MP, or runs a Spanish locale, loses that on
   every new widget. Filed **C67** (distinct from the CSS gap, **C68**).
3. The one string difference visible statically: legacy uses **"Login"**; the new
   online-directory prompt is **"Please sign in to view the directory."** + a **"Sign In"**
   button (`online-directory.ts:367-368`). It is also the *only* new widget with an
   explicit signed-out prompt in source — worth a sibling checking what the other
   signed-in-only widgets render when signed out (§7).

---

## 7. Needs runtime confirmation — do **not** file these off static analysis

Listed for the sibling who owns each widget. Each is a *suspicion with a specific check*,
not a finding.

1. **`next-online-directory` / `householdid`** (owner: people, C50–C59). Legacy
   `householdid` pre-sets a hidden `#householdId` field and shows a "filter by family"
   chip. The new widget has the same chip, but drives it from a **keyword convention**:
   `config.householdPrefix` (default `"hh "`) from `/api/embed/online-directory/config`,
   and `keyword` **is** a settable attribute (`online-directory.ts:184, 201-206,
   285-294`). **Check:** does `keyword="hh 5"` on a fresh `next-online-directory` produce
   the same result set as `householdid="5"` on `mpp-online-directory`? If yes, parity by a
   different route — file nothing. If no, that is a real gap.
2. **`next-user-menu` / `userUrls`** (owner: people). `mpp-user-login`'s only documented
   option is a set of menu links supplied as **child markup** (`type:"innerHTML"`).
   `next-user-menu` has nine attributes but none for custom menu items. **Check:** does
   `next-user-menu` render slotted/child content, and does the legacy menu actually show
   custom links on the sample site (which passes none)? Only a browser can answer both.
3. **Signed-out rendering of the seven auth-only widgets** (owners: giving, payments,
   people). Only `next-online-directory` has a signed-out prompt in source. **Check:**
   what do `next-my-giving`, `next-my-groups`, `next-my-household`, `next-my-invoices`,
   `next-my-pledges`, `next-subscriptions`, `next-my-contribution-statement`,
   `next-profile`, `next-statement-preferences` render at anonymous load? Legacy shows a
   `mppw-alert__warning` + a `value="Login"` button in every one of them. An error message
   or a bare empty state instead of a sign-in prompt is a finding; a prompt is parity.
4. **Every label, empty state, date and currency format.** §6 explains why.
5. **`mpp-event-registration` vs `next-event-details`' inline registration** (owner:
   events). `mpp-event-registration` is a standalone legacy tag with **no attributes** and
   no configurator metadata — it may be a sub-component MP mounts internally, or a
   placeable widget. **Check:** place it (§5) and see whether it renders standalone. If it
   does, it is a 37th legacy surface with no `next-*` peer; if it only works nested, it is
   already covered by `next-event-details`. Deliberately **not** filed.
6. **Whether the missing `receipttemplateid` (C66) actually changes anything.** Filed
   because the value cannot be supplied at all, but a payments sibling should confirm the
   old flow does send a receipt email that the new one does not, and attach that to C66.
7. **`next-my-invoices` free-text search vs legacy `keyword`** (owner: payments). Legacy
   `keyword` searches Invoice Title / Status / Product Name **server-side**; the new box
   filters the **already-fetched array** client-side (`my-invoices.ts:422-433`). **Check:**
   with more invoices than one page, does the new search miss matches the old one finds?
   That would be a distinct finding from C60.

---

## 8. Items filed from this document (block C60–C79)

All 20 are conclusive from static analysis alone: a legacy config option or an entire
legacy widget with no counterpart in this repo. Every one names the exact file to fix.

| Item | Severity | Title |
|---|---|---|
| C60 | functional | `next-my-invoices` accepts no configuration attributes; six legacy options and four filter controls have no equivalent |
| C61 | functional | `next-subscriptions` has no `congregation-id` filter (legacy `mpp-subscriptions/congregationid`) |
| C62 | functional | `next-my-contribution-statement` has no `my-giving-widget-target-url` link-out |
| C63 | functional | `next-plan-your-visit` cannot set the user-notification email template, though the service already accepts it |
| C64 | functional | `next-group-finder` cannot pre-set City/Postal Code (legacy `citypostalcode`) |
| C65 | functional | `next-opportunity-details` has no `show-full-address`; the full street address always renders |
| C66 | functional | `next-checkout` has no `receipt-template-id`; nothing in the repo sends a receipt template |
| C67 | functional | No MP-configurable labels: `GetLabels` has no equivalent, so all new widget copy is hardcoded English |
| C68 | functional | No `customCss` and no domain custom-styles channel on any `next-*` widget |
| C69 | functional | Legacy `mpp-prayer-feedback-form` has no `next-*` counterpart |
| C70 | functional | Legacy `mpp-subscribe-to-publication` (anonymous verified opt-in) has no counterpart |
| C71 | functional | Legacy `mpp-rss-reader` has no counterpart |
| C72 | functional | Legacy `mpp-unsubscribe` (one-click unsubscribe) has no counterpart |
| C73 | functional | Legacy `mpp-locale-selector` has no counterpart; the new SDK has no locale concept |
| C74 | functional | Legacy `mpp-smart-link` has no counterpart |
| C75 | functional | Legacy `mpp-smart-frame` has no counterpart |
| C76 | functional | The whole mission-trip domain (3 legacy widgets) has no counterpart |
| C77 | ux | Legacy `mpp-user-label` has no counterpart |
| C78 | functional | Legacy `mpp-pre-check` (event pre-check + check-in QR code) has no counterpart |
| C79 | cosmetic | Four new widgets use flat lowercase attribute names while the rest use kebab-case |

One item was **drafted and withdrawn**: `mpp-online-directory/householdid` having no
`household-id` on the new widget. It is not filed, because the new widget's
`keyword="hh <id>"` convention may already cover it and confirming that needs a browser.
It is §7.1 instead. That is the line this document holds to: a static-only guess filed as
a finding costs more than it saves.

### Opinion, stated as opinion

The eleven missing widgets are not equally important. **C70 (subscribe-to-publication)**
and **C72 (unsubscribe)** together mean a church cannot run publication opt-in/opt-out at
all on the new stack, and **C72 is a CAN-SPAM-adjacent obligation** — an unsubscribe link
in a sent email has nowhere to land. **C68 (no custom CSS)** and **C67 (no configurable
labels)** are the two that will surface on *every* customer rather than some, because
Shadow DOM means the host page cannot work around either. **C76 (mission trips)** is the
largest single block of missing function but is likely a deliberate scope decision — treat
it as a roadmap question, not a bug. **C78** looks minor because the widget takes no
attributes, but its endpoints (`SavePreCheck`, `GetQRCode`) say it is the
children's-check-in queue-skipping surface, so it is filed `functional`. Only **C77** is
genuinely low-value, and it is blocked on C67 anyway.
