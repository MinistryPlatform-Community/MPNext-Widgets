# my-invoices — comparison test log

- **New**: `next-my-invoices` — http://localhost:5173/demo-my-invoices.html
- **Old**: My Invoices — https://mpi.ministryplatform.com/widgets/my_invoices.aspx
- **Tested**: 2026-09-08 by subagent PAYMENTS
- **Auth state(s) tested**: signed out (anonymous) and signed in as PLAYWRIGHT_MP_USERNAME, on both systems
- **Script**: `…/scratchpad/p1-invoices.mjs`, `p2-old-inv.mjs`, `p3-old-free.mjs`, `p10-anon-misc.mjs`, `pay-inv-detail.mjs`, `pay-search.mjs`, `pay-leak.mjs`, `pay-mp.mjs` / `pay-mpw.mjs` (MP client-credentials drivers)

## Like-for-like setup

Legacy markup on the sample page is
`<mpp-my-invoices targeturl="https://mpi.ministryplatform.com/widgets/checkout/" hidefreeeventscheckbox="false">`.
`next-my-invoices` accepts **no attributes at all** (already filed as C60), so there is
nothing to mirror onto the new side — the comparison is the shipped configuration of each
against the same MP contact (Contact_ID 98, `dp_Users.User_GUID`
`03a109d5-…`) at the same moment.

The account had **no invoices** at the start of the run, so I created four `ZZTEST-`
fixtures to have anything to compare. Full manifest and cleanup status at the bottom.

## What I tested

1. **Renders at all**, both systems, both auth states.
2. **Data parity** — which invoices each system lists, and the field values on rows
   present in both, cross-checked against `GET /tables/Invoices` and
   `GET /tables/Invoice_Detail` by client credentials.
3. **The zero-total / free-event population** — legacy's "Show Free Events" checkbox off
   (default) and on.
4. **Every legacy filter control**, enumerated from the shadow root, including the
   "Show Advanced" reveal: Campus, Key Word, Month, Invoice Status, Show Free Events.
5. **Search behaviour, old vs new**, on four queries (`Bible`, `Summer`,
   `Paid in Full`, `10.05`) — specifically the CONFIG-MAP section 7.7 question of whether
   our client-side filter misses matches legacy finds server-side. A second line item
   (product "Bible Study") was added to one invoice so its `Product_Summary` became
   "… + 1 more", deliberately hiding the second product name from our filter.
6. **How many API calls our search makes** (client-side vs server-side).
7. **Sort order** and pagination.
8. **The detail view** (new only — legacy has none): line-item table, unit price
   derivation, notes.
9. **The pay-this-invoice affordance** on both, including where it points and whether it
   works.
10. **Cross-contact leak** — the highest-severity thing this widget could do wrong.
    Authenticated as Contact 98, requested the list, an invoice belonging to Contact 2
    by id, and one by GUID through the checkout route.
11. **Anonymous rendering** on both systems (the check CONFIG-MAP section 7 item 3 asked
    for).
12. **Keyboard / a11y** — every focusable node in the widget, row roles and names.
13. **Responsive** at 390x844.
14. **Date and currency formatting** against MP's stored values.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Renders signed in | card grid, 3 invoices | table, 6 invoices | pass (both render; see #3) |
| 2 | Console errors | none | none | pass |
| 3 | **Record set** | **3** rows — zero-total invoices excluded by default | **6** rows — zero-total always listed | **difference**, attached to C60 |
| 4 | "Show Free Events" on | zero-total invoice appears (`Invoice 3/4/5`) | no such toggle exists | attached to **C60** |
| 5 | Zero-total row rendering | total element omitted entirely | prints `$0.00` | cosmetic (noted in C60) |
| 6 | Amounts | `$1.00`, `$10.05` | `$1.00`, `$10.05` | **pass** — match MP exactly |
| 7 | Statuses | "None Paid", "Paid in Full" | same strings | **pass** |
| 8 | Dates | `09/08/2026` (MM/DD/YYYY) | `Sep 8, 2026` | pass (cosmetic; both correct vs MP `2026-09-08T09:00:00`) |
| 9 | Sort order | `Invoice_Date DESC` (3, 5, 9) | `Invoice_Date DESC` | **pass** |
| 10 | Invoice number visible | yes — card title is "Invoice 3" | **no** — description replaces it when a product summary exists | ux note, below |
| 11 | Description text | "Invoice of Kehayias, Chris for Summer Retreat" | "Kehayias, Chris — Summer Retreat" | pass (cosmetic) |
| 12 | Multi-line summary | full product list server-side | "… + 1 more" | pass |
| 13 | Campus filter | `SELECT#congregationId` (3 options) | absent | **C60** |
| 14 | Month filter | `SELECT#monthId` (13 options) | absent | **C60** |
| 15 | Invoice Status filter | `SELECT#invoiceStatusId` (Show All / Balance Due / Paid in Full) | absent | **C60** |
| 16 | Show Free Events | `INPUT#includeZeroInvoice` | absent | **C60** |
| 17 | Search box present | always (`#keywordSearchText` + "Search Invoices") | **only when > 3 invoices** | **C60** |
| 18 | `keyword` finds what ours misses | `Bible` → **0 results** | `Bible` → **0 results** | **not reproduced** — CONFIG-MAP 7.7 disproved, attached to C60 |
| 19 | `Summer` search | 3 results | 3 results | pass |
| 20 | Amount search (`10.05`) | no amount search exists | 1 result | **new is better** |
| 21 | Search API calls | one round trip per search | **1 total across 4 searches** (client-side) | pass — no page for a match to fall off |
| 22 | Pagination | none observed | none | pass (parity) |
| 23 | Detail view | none — links straight out to checkout | own view: Product / Description / Qty / Unit Price / Total + Notes | **new is better** |
| 24 | Unit price | n/a | derived `Line_Total / Item_Quantity`; `10.05 / 3` → `$3.35` | **pass** — no rounding error |
| 25 | Detail shows Amount Paid / Balance | n/a (its checkout does) | **no** — Total only | ux note, below |
| 26 | Pay affordance | real `<a href="…/widgets/checkout/?id=<Invoice_GUID>">Pay Balance</a>` | "Pay Now" button injecting `<mpp-checkout invoiceid="3">` | **C44 breaking** |
| 27 | Pay affordance works | yes — lands on a working "Review and Pay" | **no** — empty overlay + `pageerror: Cannot read properties of undefined (reading 'classList')` | **C44 breaking** |
| 28 | Pay hidden on paid/zero rows | yes | yes (`hasBalance` gate) | pass |
| 29 | **Cross-contact leak** | not probed | **none** — list scoped to Contact 98; Contact 2's invoice by id → **404** | **pass** |
| 30 | Anonymous render | `mppw-alert__warning` "Please login to view your invoices." + **visible working Login button** | "Unable to Load / Authentication required. Please sign in." + dead "Try Again" | **C46 functional** |
| 31 | Keyboard reachable | anchors + native form controls, all in tab order | **only the search input is focusable**; rows are `div`s with no `tabindex`/`role` | **C45 functional** |
| 32 | 390x844 | renders | renders | pass |
| 33 | Row count label | none | "6 invoices" subtitle, and it keeps showing the **unfiltered** count while a search is active | cosmetic note, below |

## Findings filed

- `C44-my-invoices-pay-now-injects-legacy-mpp-checkout.md` — breaking: "Pay Now" injects the legacy `mpp-checkout` tag with the numeric `Invoice_ID` instead of `next-checkout` with the `Invoice_GUID`; dead overlay plus a page error.
- `C45-my-invoices-list-not-keyboard-reachable.md` — functional: rows are non-focusable `div`s, so the list and the whole route to payment have no keyboard path.
- `C46-my-invoices-anonymous-shows-error-not-sign-in.md` — functional: anonymous load shows an error card with a dead "Try Again" and no sign-in affordance; legacy shows a warning and a working Login button.

Runtime evidence appended to the cartographer's `C60` (the four missing filter controls
enumerated live, the zero-total record-set difference, and the disproof of the
client-side-search suspicion in CONFIG-MAP section 7.7).

## Where the new widget is better

- **It has a detail view.** Legacy has none — it goes straight from the card to the
  checkout page. Ours shows Product / Description / Qty / Unit Price / Total plus the
  invoice Notes, and derives unit price correctly (`10.05 / 3` → `$3.35`, no rounding
  drift).
- **The search covers more fields.** Ours matches on the formatted date and the total as
  well as description, status and product summary — `10.05` found the right invoice,
  which legacy's `keyword` cannot do at all.
- **Search is instant**, with no round trip and no "Search Invoices" button to press;
  legacy re-queries the server on every search.
- **Contact scoping is enforced server-side and correctly.**
  `GET /api/embed/invoices/1` for another contact's invoice returns 404, and the list
  filters on `Purchaser_Contact_ID` in the MP query rather than in the client.
- **A row count is shown** ("6 invoices"); legacy shows none.
- **Currency and status are rendered as badges** with distinct paid / pending / cancelled
  treatments, where legacy prints plain subtitle text.

## Observed but NOT filed (C40–C49 block exhausted)

- **The invoice number disappears from the list.** `getInvoiceDescription` returns
  `Product_Summary` when present and falls back to `Invoice #<id>` only when it is not,
  so a member cannot cite an invoice number when they call the church. Legacy's card
  title is always "Invoice 3". `my-invoices.ts:329-332`.
- **The detail view omits Amount Paid and Balance Due**, showing only Total. On a
  partially-paid invoice the member cannot see what is outstanding without clicking
  through to checkout. Legacy's checkout shows Total Cost / Amount Paid / Remaining
  Balance.
- **The subtitle count ignores the active search** — it keeps saying "6 invoices" while
  one row is displayed (`renderList` uses `this.invoices.length`, not the filtered
  length). `my-invoices.ts:280`.

## Not tested / blocked

- **A partially-paid invoice's rendering** — creating one requires a recorded payment,
  and no payment can be recorded at all (C40: `paymentService` selects a non-existent
  `Invoices.Amount_Paid`). So the "Some Paid" status badge, and whatever the detail view
  would show for a part-paid balance, were never rendered. Re-test as part of C40's
  acceptance.
- **The end-to-end "invoice → pay → invoice updated" loop** — blocked twice over: by C44
  (the affordance does not reach a checkout) and by C42 (signed-in `next-checkout` 500s).
  I verified each leg separately instead: the legacy `Pay Balance` href carries the right
  GUID, and `next-checkout` loads that GUID correctly when anonymous.
- **Whether our client-side search would miss matches under pagination** —
  `/api/embed/invoices` currently fetches every invoice for the contact with no `top`
  and no paging, so the question is moot today. It becomes live if paging is ever added;
  recorded in the C60 appendix.
- **Legacy's `congregationid` / `monthid` / `invoiceStatusId` filters driven against a
  multi-campus, multi-month data set** — the test account's invoices were all Main
  Congregation and all within four days, so the controls were enumerated and exercised
  but not proven to filter correctly. That is legacy behaviour, not ours, and does not
  change C60.

## MP records created / modified — and cleanup

Created by me, all with `ZZTEST-payments-agent` in `Notes` / `Item_Note`:

| Table | Ids | What |
|---|---|---|
| `Invoices` | **3** (GUID `bdfa3fe2-3489-4f2c-9ec8-7ae3a83ea954`) | $1.00 payable, status None Paid |
| `Invoices` | **4** (GUID `37165991-ab0b-4694-94b8-38e774001685`) | $0.00, status None Paid — the zero-total case |
| `Invoices` | **5** (GUID `aa77e5ad-3390-4886-ba06-c5387aec96b8`) | $10.05, qty 3 — the money-math case |
| `Invoices` | **9** (GUID `89a0eb49-2402-4dab-ac45-51ace42cb066`) | $5.00, status Paid in Full |
| `Invoice_Detail` | **6, 7, 8, 13, 14** | one line per invoice, plus the "Bible Study" second line on invoice 5 |
| `Invoice_Detail` | **9** | a transient extra line on invoice 3, deleted mid-run |

All ten rows were **deleted at the end of the run** and the deletion verified:
`GET /tables/Invoices?$filter=Purchaser_Contact_ID = 98` → `[]` and
`GET /tables/Invoice_Detail?$filter=Invoice_ID IN (3,4,5,9)` → `[]`.
Pre-existing invoices 1 and 2 (Contacts 2 and 1) were re-checked afterwards and are
intact.

**Nothing was written to `Payments`, `Payment_Detail`, or any `Invoice_Status_ID`** by
any payment attempt in this session — that is C40, not restraint on my part, and it was
verified: `Payments` held exactly `Payment_ID` 1 (dated 2024) and `Payment_Detail` held
ids 1-3 before the run and after it.

Note for whoever reads the numbering gap: invoices 6, 7 and 8 appeared on Contact 98
mid-run and are gone again. They were a sibling agent's event-registration fixtures, not
mine; my deletes named ids 3, 4, 5 and 9 explicitly.

## Screenshots

- `my-invoices-old-initial.png` — legacy baseline, signed in: card grid, 3 invoices, "Pay Balance" links.
- `my-invoices-new-initial.png` — new baseline, signed in: table, 6 invoices (the zero-total ones included).
- `my-invoices-old-mobile.png` / `my-invoices-new-mobile.png` — 390x844 baselines.
- `my-invoices-old-advanced-search.png` — legacy with "Show Advanced" expanded: the four filter controls ours has none of.
- `my-invoices-old-show-free-events.png` / `my-invoices-old-show-free-events-on.png` — the zero-total record-set difference, off and on.
- `my-invoices-new-detail.png` — the new detail view (no legacy equivalent).
- `my-invoices-new-pay-now-dead-checkout.png` — C44: the empty overlay after "Pay Now".
- `my-invoices-new-pay-now-mobile.png` — the same at 390x844.
- `my-invoices-old-anonymous.png` — legacy anonymous: warning alert + working Login button.
- `my-invoices-new-anonymous.png` — C46: "Unable to Load" + dead "Try Again".
- `my-invoices-new-search-bible-misses.png` / `my-invoices-old-search-bible-finds.png` — the CONFIG-MAP 7.7 search probe. **Filenames record the hypothesis, not the result**: both sides returned 0 results, so the suspicion was disproved.
