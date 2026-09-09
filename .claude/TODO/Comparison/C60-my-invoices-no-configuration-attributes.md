# C60. `next-my-invoices` accepts no configuration attributes at all — six legacy options and four filter controls have no equivalent

**Widget:** `next-my-invoices` (old: My Invoices, `/widgets/my_invoices.aspx`)
**Severity:** functional
**Confidence:** confirmed — static source read on both sides; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

`mpp-my-invoices` supports six options. From its own
`observedAttributes` getter in `https://mpi.ministryplatform.com/widgets/dist/MyInvoices.js`:

```
["target","targeturl","congregationid","monthid","invoiceStatusId","keyword","hidefreeeventscheckbox"]
```

and from the `WidgetDetails.configurationItems` metadata in `WidgetConfigurator.js`,
verbatim vendor descriptions:

| Attribute | Vendor description |
|---|---|
| `targeturl` (required) | "URL that takes the authenticated User to the Invoice Details & Payment Widget so they can pay an outstanding invoice." |
| `congregationid` | "Filters the results by a Congregation ID." |
| `keyword` | "Filters the result using keywords. Key Word search looks for a match in the Invoice Title, Status, or Product Name." |
| `monthid` | "Filters by a Month." |
| `invoiceStatusId` | "Filters by Invoice Status." |
| `HideFreeEventsCheckbox` | "Determines whether or not the Free Events checkbox is visible to the end users." |

These are not attributes in isolation. The legacy widget renders a search form whose
field ids match the attribute names — `<select id="congregationId">`,
`<select id="monthId">`, `<select id="invoiceStatusId">`, `<input name="keyword">` — and a
base-class routine copies the element's attributes onto those fields. So each attribute
**pre-sets and locks a visible filter control**, and the controls exist whether or not the
attribute is set. The sample page sets two of them:
`<mpp-my-invoices targeturl="https://mpi.ministryplatform.com/widgets/checkout/" hidefreeeventscheckbox="false">`.

## New behaviour

`next-my-invoices` has **no** `static get observedAttributes()` and **not one**
`getAttribute(...)` or `hasAttribute(...)` call in
`packages/embed-sdk/src/components/my-invoices.ts` (837 lines). It is unconfigurable.

The UI is also thinner: the only filter is a single free-text box
(`#invoice-search`, placeholder "Search invoices...", `my-invoices.ts:285`) which filters
the **already-fetched array client-side** (`getFilteredInvoices()`,
`my-invoices.ts:422-433`). There is no congregation dropdown, no month dropdown, no
invoice-status dropdown, and no free-events checkbox to hide.

`targeturl` is the one legacy option with a defensible replacement: the new widget pays
in-widget via a "Pay Now" button (`my-invoices.ts:403`) rather than handing off to a
separate checkout page, so no target URL is needed. The other five have no substitute.

## Why it matters

A church that today embeds `<mpp-my-invoices congregationid="3" invoiceStatusId="2">` on a
campus-specific page gets a scoped list. On the new widget the same page shows **every
invoice for the contact across every congregation and status**, with no markup that can
narrow it — the copy-paste replacement is not a replacement. The
`hidefreeeventscheckbox` option is the smaller half of the same problem: MP shipped a
switch for it because some churches do not want free-event invoices in the list at all.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets/my_invoices.aspx`
- Old surface: `observedAttributes` getter brace-matched out of
  `https://mpi.ministryplatform.com/widgets/dist/MyInvoices.js`; descriptions from the
  `WidgetDetails` record in `/widgets/dist/WidgetConfigurator.js`
- New surface: `packages/embed-sdk/src/components/my-invoices.ts` — grep for
  `observedAttributes` and `getAttribute` returns nothing
- No screenshot: this item is static-only by design (no browser was used)
- Parity table: `.claude/playwright/widget/CONFIG-MAP.md` section 4.12

## Where to fix

- `packages/embed-sdk/src/components/my-invoices.ts` — add `observedAttributes`, the four
  filter controls, and the free-events checkbox
- `src/app/api/embed/invoices/route.ts` — accept `congregationId`, `monthId`,
  `invoiceStatusId`, `keyword`, and a free-events flag as query params
- `src/services/invoiceService.ts` — push the filters into the MP `$filter`

## Suggested fix

Mirror the shape `next-event-finder` already uses: declare
`congregation-id`, `month-id`, `invoice-status-id`, `keyword`,
`hide-free-events-checkbox` in `observedAttributes`, seed the corresponding controls from
them on first render, and send them to the route as query params so the filtering happens
in MP rather than over a partial page of rows. Note that the existing free-text box
filtering client-side is a separate (probably worse) behaviour — see the runtime check in
CONFIG-MAP.md section 7.7 before deciding whether `keyword` should reuse it or replace it.
Whether `targeturl` needs an equivalent is a product call: the in-widget Pay Now flow may
be strictly better.

---

## Runtime confirmation (added 2026-09-08 by the payments agent)

Two things CONFIG-MAP left open were driven in the browser, signed in as the Playwright
test user with six invoices on the account. Both matter for the fix above.

**1. The four legacy filter controls exist and work; ours has none of them.** Read from
`mpp-my-invoices`'s shadow root on `/widgets/my_invoices.aspx`, all visible and labelled:
`SELECT#congregationId` ("Campus": Any Campus / Friends & Internet Campus / Main
Congregation), `INPUT#keywordSearchText` ("Key Word"), `SELECT#monthId` ("Month": All
Months + the twelve), `SELECT#invoiceStatusId` ("Invoice Status": `0=Show All`,
`1=Balance Due`, `2=Paid in Full`), `INPUT#includeZeroInvoice` ("Show Free Events"), and
`INPUT#searchButton[type=submit][value="Search Invoices"]` — plus a "Show Advanced" /
"Hide Advanced" toggle that reveals Month, Invoice Status and Show Free Events.
`next-my-invoices` renders one text input and only when there are more than three
invoices (`my-invoices.ts:281-287`), so with three or fewer even that disappears.
Screenshots: `my-invoices-old-advanced-search.png`, `my-invoices-new-initial.png`.

**2. The default record set genuinely differs, because of `hidefreeeventscheckbox`.**
Legacy excludes zero-total invoices unless "Show Free Events" is ticked; ours always
lists them. Same MP contact, same moment: legacy showed **3** invoices (ids 3, 5, 9),
ours showed **6** — the extra three all `Invoice_Total` 0. Ticking "Show Free Events" and
re-searching made legacy show `["Invoice 3","Invoice 4","Invoice 5"]`, i.e. the zero-total
invoice 4 appeared. Note the second-order detail: legacy omits the total element entirely
on a free invoice, where ours prints "$0.00". Screenshots:
`my-invoices-old-show-free-events-on.png`, `my-invoices-new-initial.png`.
So this is not only a missing attribute — the widget shows a different set of records out
of the box than the legacy widget it replaces.

**3. CONFIG-MAP section 7.7 — client-side vs server-side `keyword` — NOT reproduced.**
The suspicion was that our client-side filter would miss matches legacy's server-side
`keyword` finds. It does not, on this data. A second line item (product "Bible Study")
was added to invoice 5 so its `Product_Summary` became "… + 1 more", hiding the second
product name from our filter. Searching `Bible`: **legacy returned 0 results, ours
returned 0 results** — legacy's `keyword` did not match that product name either.
Searching `Summer` returned the same invoices on both. Ours actually matches a superset:
`10.05` matched invoice 5 on ours (it filters on the total and the formatted date as well)
and legacy has no amount search at all. Our filter is also purely client-side —
`GET /api/embed/invoices` was called exactly once across four searches — but since the
route fetches every invoice for the contact with no `top` and no paging, there is no page
for a match to fall off. **Conclusion: do not treat "keyword must move server-side" as a
correctness fix.** It becomes one only if `/api/embed/invoices` ever starts paginating.
Screenshots: `my-invoices-new-search-bible-misses.png` (filename is from the original
hypothesis; the captured result is 0 on both sides),
`my-invoices-old-search-bible-finds.png` (likewise 0 results — kept as the legacy
counterpart evidence).

Separately filed from the same session, and not duplicates of this item: **C44** (the
in-widget Pay Now flow that replaced `targeturl` is itself non-functional), **C45**
(rows are not keyboard reachable), **C46** (anonymous state shows an error, not a
sign-in prompt).
