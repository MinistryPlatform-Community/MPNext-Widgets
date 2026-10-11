# C44. `next-my-invoices` "Pay Now" injects the **legacy** `<mpp-checkout>` tag with the numeric invoice id, so paying an invoice is a dead end

**Widget:** `next-my-invoices` (old: `/widgets/my_invoices.aspx`)
**Severity:** breaking
**Confidence:** confirmed — driven signed in on the demo page; empty overlay plus a page error, and the id is the wrong key
**Found:** 2026-09-08, comparison run

## Old behaviour

Legacy `mpp-my-invoices` renders each payable invoice as a card whose footer is a real
anchor:

    <a href="https://mpi.ministryplatform.com/widgets/checkout/?id=bdfa3fe2-3489-4f2c-9ec8-7ae3a83ea954">Pay Balance</a>

That is `targeturl` (set on the sample page to `…/widgets/checkout/`) with the
invoice's **`Invoice_GUID`** as `?id=`. Clicking it lands on a fully working "Review and
Pay" screen. Verified with two payable invoices; the anchors carried the correct GUIDs.

## New behaviour

`next-my-invoices` shows a "Pay Now" button in its own detail view. Clicking it calls
`showCheckout()`, which appends a full-page overlay to `document.body` containing:

    <mpp-checkout invoiceid="3"></mpp-checkout>

Two independent faults in that one line:

1. **It is the legacy MP tag, not `next-checkout`.** On a customer site that loads only
   `/embed-sdk/next-embed.js`, `mpp-checkout` is an unknown element: it never upgrades,
   renders nothing, and reports no error. Even where MPWidgets.js *is* present — as it
   is on every demo page — the tag is injected long after MPWidgets.js's own
   `DOMContentLoaded` scan, which is exactly the trap `watchMpLoginRegistration()` in
   `user-menu.ts` exists to work around; nothing does that here.
2. **`invoiceid` is given the numeric `Invoice_ID`**, but both `mpp-checkout` and
   `next-checkout` key on the **`Invoice_GUID`** — as legacy's own "Pay Balance" link
   proves. So even if the element loaded, the invoice could not be found.

Observed on `demo-my-invoices.html` signed in: after clicking Pay Now and waiting 9
seconds the overlay is present and contains only its own "← Back to Invoice" button.
`customElements.get("mpp-checkout")` is truthy and a shadow root exists, but its text
content is the empty string, and the page throws
`Cannot read properties of undefined (reading 'classList')`. No `next-checkout` element
is created anywhere. The URL gains `?invoiceId=3`, which nothing reads.

## Why it matters

"Pay this invoice" is the only action `next-my-invoices` offers, and it does not work
anywhere: silently on a real customer site (unknown element, blank overlay), noisily on
a page that happens to carry MPWidgets.js (blank overlay plus a page error). A member
who wants to settle a registration balance reaches a dead screen with a Back button.
The repo already ships the widget that would do this correctly — `next-checkout` — and
the data needed to address it correctly, `Invoice_GUID`, is already on every row of the
list response.

## Why it matters that this is not merely C60

C60 records that `next-my-invoices` accepts no `targeturl`. This is the separate, larger
problem that the in-widget replacement for `targeturl` is itself non-functional.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-invoices-new-pay-now-dead-checkout.png`,
  `.claude/playwright/widget/screenshots/my-invoices-new-pay-now-mobile.png`,
  `.claude/playwright/widget/screenshots/my-invoices-new-detail.png`;
  legacy for contrast: `.claude/playwright/widget/screenshots/my-invoices-old-initial.png`
- In-page probe after clicking Pay Now (9 s settle, signed in as the Playwright test user):

      { portalPresent: true, portalText: "← Back to Invoice",
        mppCheckoutPresent: true, mppCheckoutDefined: true, mppCheckoutHasShadow: true,
        mppCheckoutInvoiceIdAttr: "3", mppCheckoutRenderedText: "",
        nextCheckoutPresent: false,
        url: "http://localhost:5173/demo-my-invoices.html?invoiceId=3" }

- `pageerror> Cannot read properties of undefined (reading 'classList')` fires on the
  click.
- Legacy anchors read from `mpp-my-invoices`'s shadow root:
  `Pay Balance -> https://mpi.ministryplatform.com/widgets/checkout/?id=bdfa3fe2-3489-4f2c-9ec8-7ae3a83ea954`
  and `…?id=aa77e5ad-3390-4886-ba06-c5387aec96b8` — GUIDs, not ids.
- MP verification: `GET /tables/Invoices?$filter=Invoice_ID IN (3,5)` confirms
  `Invoice_GUID` `bdfa3fe2-…` for invoice 3 and `aa77e5ad-…` for invoice 5, matching
  the legacy hrefs.

## Where to fix

`packages/embed-sdk/src/components/my-invoices.ts:152-186` (`showCheckout`, the portal
markup at `:167-172`). The GUID is already carried on the list item —
`InvoiceListItem.Invoice_GUID` at `:11` — and on the detail response, so no extra fetch
is needed.

## Suggested fix

Two viable shapes; pick one deliberately rather than patching the tag name.

- **In-widget (closest to current intent):** render
  `<next-checkout invoice-id="<Invoice_GUID>" api-host="…" payment-processor-url="…">`
  into the overlay instead of `mpp-checkout`. `next-checkout`'s `invoice-id` attribute
  already takes the GUID and short-circuits URL parsing (`resolveGuid`, `checkout.ts:96-108`).
  The overlay must also pass through the host's `api-host`, which `showCheckout` does not
  currently do.
- **Link out (closest to legacy, and simpler):** add the `target-url` attribute C60
  asks for and make the affordance a real `<a href="{target-url}?id={Invoice_GUID}">`.
  This also fixes C45 for free, since an anchor is focusable and activatable by keyboard.

Either way, do not leave a code path that injects an `mpp-*` tag from inside a `next-*`
widget without the re-insert watch that `user-menu.ts` uses; and note that C42 currently
blocks the signed-in `next-checkout` path this would route into, so C42 has to land
first for the fix to be demonstrable.

## Resolution — 2026-10-11

**Fixed (epic W1, branch `ws/w1-payments`) using Route A** from `Plans/my-invoices.md`: link out.

- "Pay" (on the row) and "Pay Now" (in the detail view) are real
  `<a href="<checkout-url>?id=<Invoice_GUID>">` links. They are addressed by the **GUID**, as
  `next-checkout` (default `invoice-id-parameter-name="id"`) and legacy's own "Pay Balance"
  link expect. The href is built with `URL` / `URLSearchParams`, so a configured URL keeps
  its query string, and anything other than http(s) is refused.
- `showCheckout()`, the page overlay, its injected `<style>`, the `?invoiceId=` history
  rewrite and the `<mpp-checkout invoiceid="<numeric id>">` tag are **deleted**. **No `mpp-*`
  tag is injected anywhere in the component.** A test asserts this, both in the shadow root
  and in the document.
- `checkout-url` is the new attribute (legacy `targeturl`, see C60). **Decision:** with no
  `checkout-url`, there is **no Pay affordance**, rather than a dead one. "Pay" also no longer
  appears on a cancelled, paid or zero-total invoice. Previously the detail view offered
  "Pay Now" for anything not paid, including cancelled and free invoices.
- Clicking a Pay link emits `invoicePay` with `{ invoiceGuid }`, and the anchor navigates by
  itself.
- **Route B** (an inline `next-checkout` overlay behind `checkout-mode="inline"`) is
  deliberately left for later, as the plan recommends. It is now unblocked, because
  `checkout-pay.md` has landed (C40–C49).

**Needs a change in a file W1 does not own:** `user-menu.ts` (W6) renders
`<next-my-invoices api-host="…">` in its Invoices tab with no `checkout-url`. So inside the
user menu there is now no Pay link, where before there was a broken one. The fix is to forward a
`checkout-url` attribute from `next-user-menu` to the embedded element. The exact change is in
the W1 report.

Tests: `packages/embed-sdk/src/components/my-invoices.test.ts`.
