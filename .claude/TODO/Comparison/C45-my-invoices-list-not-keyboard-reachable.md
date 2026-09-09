# C45. `next-my-invoices` rows are non-focusable `div`s, so the invoice list — and the whole route to payment — is unreachable by keyboard

**Widget:** `next-my-invoices` (old: `/widgets/my_invoices.aspx`)
**Severity:** functional
**Confidence:** confirmed — enumerated every focusable node in the widget's shadow root while signed in with six invoices on screen
**Found:** 2026-09-08, comparison run

## Old behaviour

Legacy `mpp-my-invoices` builds each result as a card whose action is a genuine anchor —
`<a href="…/widgets/checkout/?id=<GUID>">Pay Balance</a>` — inside a form whose controls
are real `<select>`/`<input>` elements with associated labels ("Campus", "Key Word",
"Month", "Invoice Status", "Show Free Events") and an `<input type="submit"
value="Search Invoices">`. Every control and every payment link is in the tab order and
activates with Enter by construction.

## New behaviour

The list row is a plain `div` carrying a JS `click` listener and nothing else:

    <div class="table-row table-row--payable" data-invoice-id="3"> … </div>

Measured in the shadow root with six invoices rendered:

    rowCount: 3 (payable) / 6 total
    row attributes: [{tabindex: null, role: null, tag: "DIV"}, …]   // for every row
    focusable nodes in the entire widget: ["INPUT:"]                // the search box, only

So a keyboard or screen-reader user can reach the search field and nothing else. They
cannot open an invoice, cannot reach the detail view, and therefore cannot reach the
"Pay Now" button at all — it only exists inside the detail view. The rows are also not
announced as interactive: no `role="button"`/`role="row"`, no accessible name, and the
`Pay →` affordance inside the total cell is a `<span>`, not a link or button.

The detail view's own controls (`← Back to Invoices`, `Pay Now`) *are* real `<button>`
elements, so they are fine once reached — but there is no keyboard path to reach them.

## Why it matters

This is a money-handling surface, so its accessibility is an obligation rather than a
nicety, and the specific failure is total: the sole task the widget exists for
("see what I owe, pay it") has no keyboard route. It is also a regression against
legacy, which got this right for free by using anchors and native form controls. And
because the row is a `div` with a click handler, it is invisible to assistive
technology even before focus is considered.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-invoices-new-initial.png`,
  `.claude/playwright/widget/screenshots/my-invoices-new-detail.png`,
  `.claude/playwright/widget/screenshots/my-invoices-new-mobile.png`;
  legacy: `.claude/playwright/widget/screenshots/my-invoices-old-initial.png`,
  `.claude/playwright/widget/screenshots/my-invoices-old-advanced-search.png`
- In-page enumeration (signed in as the Playwright test user, six invoices loaded):

      { rowCount: 3,
        tabbable: [ {tabindex: null, role: null, tag: "DIV"},
                    {tabindex: null, role: null, tag: "DIV"},
                    {tabindex: null, role: null, tag: "DIV"} ],
        focusables: ["INPUT:"],
        searchBox: true }

- Legacy control inventory from `mpp-my-invoices`'s shadow root, all visible and
  labelled: `SELECT#congregationId` ("Campus"), `INPUT#keywordSearchText` ("Key Word"),
  `SELECT#monthId` ("Month"), `SELECT#invoiceStatusId` ("Invoice Status"),
  `INPUT#includeZeroInvoice` ("Show Free Events"),
  `INPUT#searchButton[type=submit][value="Search Invoices"]`.

## Where to fix

`packages/embed-sdk/src/components/my-invoices.ts:305-321` (`renderInvoiceRow`) and the
listener wiring at `:122-129` (`attachListeners`, the `[data-invoice-id]` click loop).
The `Pay →` span is at `:318`.

## Suggested fix

Make the row's action a real control rather than a listener on a `div`. The smallest
correct change is to render the row as a `<button type="button" class="table-row">`
(or wrap the payable affordance in one) so focus, Enter/Space activation and the
`button` role all come from the platform; add a `:focus-visible` outline in the
widget's stylesheet, which currently defines none for rows.

If the row stays a `div` for layout reasons, it needs `tabindex="0"`,
`role="button"`, an `aria-label` naming the invoice ("Invoice 3, September 8 2026,
$1.00, None Paid"), and an explicit `keydown` handler for Enter and Space — that is
strictly more code than using a `button`, which is the argument for the button.

If C44 is resolved by the link-out route, the payable affordance becomes an `<a href>`
and this item is largely resolved with it; the non-payable rows still need a focusable
control to open the detail view.
