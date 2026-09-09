# Widget Comparison Run — Shared Brief (read this first)

Date: 2026-09-08. Every subagent on this run reads this file before doing anything.

## Mission

Comparatively test the **legacy MinistryPlatform widgets** (`https://mpi.ministryplatform.com/widgets/*`)
against the **new Web Component widgets in this repo** (`packages/embed-sdk`, demoed at
`http://localhost:5173/demo-*.html`). Both point at the **same MP instance**
(`mpi.ministryplatform.com`), so data is apples-to-apples: the same event, group, or
pledge must appear in both.

Report every difference. File one TODO item per discovery. Log what you tested.

## The two systems

**Old (legacy).** Server-rendered ASP.NET pages that load `MPWidgets.js`, which then
fetches `/widgets/dist/<Widget>.js` per `mpp-*` tag it finds on the page and calls
`customElements.define`. Widgets render into **Shadow DOM** — Playwright's default
selectors pierce open shadow roots, but `document.querySelector` in
`page.evaluate` does **not**; use `page.locator()` or walk `.shadowRoot` explicitly.
Login is `<mpp-user-login>`, which stores `mpp-widgets_AuthToken` in `localStorage`.

Old site page map (from `https://mpi.ministryplatform.com/widgets`):

| Page | URL |
|---|---|
| Home / RSS | `/widgets` |
| Event Finder | `/widgets/event_finder.aspx` |
| Group Finder | `/widgets/group_finder.aspx` |
| Make a Pledge | `/widgets/pledge_campaign.aspx` |
| Give Online | `/widgets/giving.aspx` |
| Prayer And Feedback | `/widgets/prayer_feedback_form.aspx` |
| Mission Trip Finder | `/widgets/mission_trip_finder.aspx` |
| My Contribution Statement | `/widgets/my_contribution_statement.aspx` |
| My Groups | `/widgets/my_groups.aspx` |
| My Household | `/widgets/my_household.aspx` |
| My Invoices | `/widgets/my_invoices.aspx` |
| My Mission Trips | `/widgets/my_mission_trips.aspx` |
| My Pledges | `/widgets/my_pledges.aspx` |
| My Giving | `/widgets/my_giving.aspx` |
| My Subscriptions | `/widgets/subscriptions.aspx` |
| Online Directory | `/widgets/online_directory.aspx` |
| Opportunity Finder | `/widgets/opportunity_finder.aspx` |
| Plan Your Visit | `/widgets/plan_your_visit.aspx` |
| Subscribe to Publication | `/widgets/subscribe_to_publication.aspx` |
| About Me | `/widgets/AboutMe` |
| Widget Configurator | `/widgets/WidgetConfigurator` |

All prefixed `https://mpi.ministryplatform.com`. Some pages set widget attributes in
markup — **read the page source** (`curl` it, or `page.content()`) to learn which
attributes the old widget was configured with, and mirror those onto the new widget
so you are comparing like for like.

**New.** `packages/embed-sdk/demo-*.html`, served by Vite at `http://localhost:5173/`
(index at `/index.html`). The API is Next.js at `http://localhost:3000`. Both are
already running for this session — do **not** start or restart them, and do not
run `pnpm build`; if a server looks down, say so in your report rather than
restarting it (other agents are sharing it).

Widget source: `packages/embed-sdk/src/components/<name>.ts`. Read the source when a
behaviour looks wrong — it is often faster than guessing, and it tells you the
attribute names the demo page could have set.

## Widget pair mapping

> **Corrected 2026-09-08 — the table below has four errors.** `CONFIG-MAP.md` is
> authoritative; it was measured from the MPWidgets.js loader table and each legacy
> bundle's `observedAttributes`, whereas this table was written from the sample site's
> navigation dropdown alone. The corrections:
>
> 1. `/widgets/giving.aspx` is **not** a payment widget — it is an `mpp-smart-link` out
>    to Realm. The real legacy payment pages are `/widgets/Checkout` and `/widgets/pay`,
>    which the sample site does not link to. So `next-checkout` / `next-pay` **do** have
>    legacy counterparts.
> 2. `next-custom-form` pairs with **`mpp-custom-form`** (`formguid`), not with the
>    Prayer & Feedback page. `mpp-prayer-feedback-form` is a separate legacy widget with
>    no counterpart at all.
> 3. `next-event-details`, `next-group-details`, `next-opportunity-details` and
>    `next-statement-preferences` are **not** "new only" — each has a legacy counterpart
>    (`/widgets/event_details.aspx`, `/widgets/group_details.aspx`,
>    `/widgets/opportunity_details.aspx`, and the paperless toggle inside
>    `mpp-my-contribution-statement` respectively).
> 4. `mpp-mission-trip-finder` queries **Pledge Campaigns**, not Opportunities — it is
>    not a differently-scoped opportunity finder.
>
> Net: MPWidgets.js knows **36** `mpp-*` tags against this repo's **25** `next-*`
> elements; **11** legacy widgets have no counterpart, and only **2** `next-*` elements
> are genuinely new-only.

| New element | Old counterpart | Notes |
|---|---|---|
| `next-event-finder` | Event Finder | |
| `next-group-finder` | Group Finder | |
| `next-opportunity-finder` | Opportunity Finder + Mission Trip Finder | old has two finders over the same table |
| `next-pledge-campaign` | Make a Pledge | |
| `next-my-giving` | My Giving | |
| `next-my-contribution-statement` | My Contribution Statement | |
| `next-my-groups` | My Groups | |
| `next-my-household` | My Household | |
| `next-my-invoices` | My Invoices | |
| `next-my-pledges` | My Pledges | |
| `next-subscriptions` | My Subscriptions + Subscribe to Publication | |
| `next-online-directory` | Online Directory | |
| `next-plan-your-visit` | Plan Your Visit | |
| `next-profile` | About Me | |
| `next-custom-form` | Prayer And Feedback | old page is a custom form instance |
| `next-checkout` / `next-pay` / `next-checkout-complete` | Give Online | old `giving.aspx` covers the whole payment flow |
| `next-full-calendar` | — | new only; compare data against Event Finder / MP |
| `next-add-to-calendar` | — | new only |
| `next-event-details` | — | new only (old finder had inline detail) |
| `next-group-details` | — | new only |
| `next-opportunity-details` | — | new only |
| `next-statement-preferences` | — | new only |
| `next-user-menu` | `mpp-user-login` | login/logout affordance |

New-only widgets still get a full standalone pass: does it render, is the data right
against MP, do the flows work, is it accessible?

## Credentials and MP access

- Front-end login for **both** sites: `PLAYWRIGHT_MP_USERNAME` / `PLAYWRIGHT_MP_PASSWORD`
  in `.env.local` (non-admin MP OAuth user, MFA disabled). Read them with
  `node -e` / `sed`, never paste them into a file you create, and never write a token
  or password into a test log, TODO item, or screenshot filename.
- Server-side MP access for **setup and verification** is allowed and encouraged:
  client credentials are in `.env.local` (`MINISTRY_PLATFORM_CLIENT_ID` /
  `_SECRET`, base `https://mpi.ministryplatform.com/ministryplatformapi`). Use it to
  create the fixture data a flow needs (a test event, a test pledge campaign, a
  publication, a form) and to verify that a widget's write actually landed.
  `src/lib/providers/ministry-platform` (`MPHelper`) is the wrapper; a throwaway
  `tsx` script under your scratchpad is the easiest driver. MP query syntax:
  `.claude/references/ministryplatform.query-syntax.md`.
- **Datetimes**: MP stores wall-clock in the domain time zone, not UTC. Before
  calling a date bug, read `.claude/references/ministryplatform.datetimehandling.md`
  — an off-by-hours difference may be the *old* widget being wrong.
- **Clean up** fixture data you created (or record in your test log exactly what was
  left behind and why). Prefix anything you create with `ZZTEST-` so it is findable.

### Payments

Payment flows are **in scope** for this run. Use published gateway test card numbers
only (`4111 1111 1111 1111`, `4242 4242 4242 4242`, exp in the future, any CVV). You
have no real card data and must not seek any. If the gateway rejects test cards in a
way that indicates it is in **live** mode, or if a submit looks like it would move
real money, **stop, screenshot, and log it as untested** — do not retry with anything
else. Any transaction you do complete: record the amount, the gateway response, and
the MP record id in your test log, and use the smallest amount the form allows.

## How to test

Use Playwright from a **standalone Node script**, not the Playwright MCP browser tools
— several agents run in parallel and the MCP server is a single shared browser.

```js
// C:\Users\ckeha\AppData\Local\Temp\...\scratchpad\<yourname>.mjs   (or .claude/playwright/widget/scripts/)
import { chromium } from "playwright";
import { config } from "dotenv";
config({ path: "S:/MP/MPNext-Components/.env.local", quiet: true });

const SHOTS = "S:/MP/MPNext-Components/.claude/playwright/widget/screenshots";
const browser = await chromium.launch();           // add { headless: false } only if you must watch
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("console", m => console.log("console>", m.type(), m.text()));
page.on("pageerror", e => console.log("pageerror>", e.message));
page.on("requestfailed", r => console.log("reqfail>", r.url(), r.failure()?.errorText));
await page.goto("http://localhost:5173/demo-event-finder.html", { waitUntil: "networkidle" });
await page.screenshot({ path: `${SHOTS}/event-finder-new-initial.png`, fullPage: true });
await browser.close();
```

Run it with `cd S:/MP/MPNext-Components && node <path>.mjs` (the repo has `playwright`
and `dotenv` installed; `pnpm exec tsx` is available if you want TypeScript).

**Always capture**: browser console output, page errors, failed requests, and the
network calls the widget makes (URL + status). A widget that renders an empty state
because its API call 500'd is a very different finding from one with no matching data.

Screenshot naming: `<widget>-<old|new>-<what>.png`, all lowercase-kebab, in
`.claude/playwright/widget/screenshots/`. Take one for every finding you file, and a
baseline pair (old + new, initial render) for every widget you touch.

### What to compare

1. **Does it render at all** — element upgraded, shadow root populated, no console errors.
2. **Data parity** — same query, same records? Counts, order, and the field values on a
   record present in both. Verify against MP directly when they disagree.
3. **Feature parity** — every filter, search box, sort, pagination control, view toggle,
   attribute/config option the old widget had. Missing controls are the highest-value
   findings on this run.
4. **Flows** — search → detail → action (register, inquire, submit, pay). Walk them end
   to end on both.
5. **Validation** — required fields, bad email, bad phone, empty submit. The new widgets
   must use `shared/form-validation.ts` and must not show the native `reportValidity`
   popup.
6. **Auth** — signed-out vs signed-in rendering, and that a signed-out user is prompted
   rather than shown an error or someone else's data.
7. **Responsive / a11y** — re-render at 390×844 and screenshot; tab through the widget;
   check labels, roles, focus visibility, and that dialogs trap focus.
8. **Cosmetic** — labels, wording, date/currency formats, field order, empty-state text.

## Deliverable 1 — per-widget test log

One file per widget: `.claude/playwright/widget/tests/<widget-name>.md` (e.g.
`event-finder.md`). Write it even when everything passed. Template:

```markdown
# <widget> — comparison test log

- **New**: `next-<name>` — http://localhost:5173/demo-<name>.html
- **Old**: <page name> — https://mpi.ministryplatform.com/widgets/<page>
- **Tested**: 2026-09-08 by subagent <your label>
- **Auth state(s) tested**: signed out / signed in as PLAYWRIGHT_MP_USERNAME
- **Script**: <path to the script you ran>

## What I tested
Numbered list of concrete checks — the control you clicked, the input you typed, the
assertion you made. Enough that someone can re-run it by hand.

## Results
| # | Check | Old | New | Verdict |
|---|---|---|---|---|

## Findings filed
- `C##-slug.md` — one line each.

## Where the new widget is better
Anything the new one does that the old one does not. Not filed as TODO items.

## Not tested / blocked
Why, and what setup would unblock it.

## Screenshots
Relative paths, one line each with a caption.
```

## Deliverable 2 — one TODO item per discovery

`.claude/TODO/Comparison/C<NN>-<kebab-slug>.md`, using **only the number block your
prompt reserved for you** so parallel agents do not collide. One file per discovery —
do not bundle two differences into one item.

```markdown
# C<NN>. <one-line title: what differs, in the new widget's terms>

**Widget:** `next-<name>` (old: <page>)
**Severity:** breaking | functional | ux | cosmetic
**Confidence:** confirmed | probable — <how you verified>
**Found:** 2026-09-08, comparison run

## Old behaviour
What `mpi.ministryplatform.com` does. Be specific; quote text and give counts.

## New behaviour
What this repo does.

## Why it matters
Who breaks, and how, on a customer site. One paragraph, no padding.

## Evidence
- Screenshot: `.claude/playwright/widget/screenshots/<file>.png`
- Console / network: exact error text, request URL + status
- MP verification: the query you ran and what it returned

## Where to fix
`packages/embed-sdk/src/components/<file>.ts:<line>` / `src/app/api/embed/<route>` /
`src/services/<svc>.ts` — name the actual file(s) you traced it to.

## Suggested fix
A sketch, not a patch. Say if you are unsure.
```

Severity: **breaking** = the flow cannot complete or data is wrong; **functional** = a
capability the old widget had is missing; **ux** = it works but behaves worse;
**cosmetic** = labels, formats, styling.

## Rules

- Verify before filing. A finding that turns out to be the demo page not setting an
  attribute the old page set is not a defect — check the source first.
- Never claim you tested something you could not. "Blocked" is a valid, useful result;
  a fabricated pass is not.
- Do not edit widget source, demo pages, or config. This run is **read-only on the
  repo** apart from your test logs, TODO items, screenshots, and scripts.
- Do not log secrets or token material anywhere.
- Report back concisely: findings filed (numbers + one-line titles), files written,
  anything blocked. Your report is the only part the main thread sees.
