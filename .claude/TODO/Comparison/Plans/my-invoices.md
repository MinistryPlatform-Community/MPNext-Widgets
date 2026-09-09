# `next-my-invoices` — plan

**Items:** C44 (breaking) · C45 (functional, shared) · C46 (functional, shared) ·
C60 (functional)
**Cutover verdict: blocks pilot cutover. The one action the widget offers does not work.**
**Owns:** `packages/embed-sdk/src/components/my-invoices.ts`,
`src/app/api/embed/invoices/route.ts`, `src/services/invoiceService.ts`

## What the feedback says

**C44 — "Pay Now" is a dead end, two ways at once.** `showCheckout()` appends a full-page
overlay containing:

```html
<mpp-checkout invoiceid="3"></mpp-checkout>
```

That is (a) the **legacy MP tag**, which on a customer site loading only
`/embed-sdk/next-embed.js` is an unknown element that never upgrades, renders nothing and
reports no error; and (b) given the **numeric `Invoice_ID`** where both `mpp-checkout` and
`next-checkout` key on the **`Invoice_GUID`** — as legacy's own "Pay Balance" anchor proves.
On a demo page (where MPWidgets.js *is* present) the tag is injected long after MP's
`DOMContentLoaded` scan, so it still never registers, and the page throws
`Cannot read properties of undefined (reading 'classList')`. Observed: overlay present,
containing only its own "← Back to Invoice" button.

The repo already ships the widget that would do this correctly, and `Invoice_GUID` is already
on every row of the list response (`InvoiceListItem.Invoice_GUID`).

**C45 — no keyboard path to payment at all.** Rows are plain `div`s with a click listener:
`tabindex: null, role: null` on all six. The only focusable node in the entire widget is the
search box. "Pay Now" exists **only inside the detail view**, which cannot be reached. This is
a money-handling surface, so its accessibility is an obligation, and the failure is total.

**C46 — anonymous shows "Unable to Load" with a dead Try Again.** `grep -c requestLogin` on
this file returns 0.

**C60 — no configuration attributes at all.** No `observedAttributes`, not one
`getAttribute` call in 837 lines. Legacy supports six options that also **pre-set visible
filter controls**: `congregationid`, `monthid`, `invoiceStatusId`, `keyword`,
`hidefreeeventscheckbox`, `targeturl`.

## Where the new widget is already better — protect these

The comparison run tested two suspicions about this widget and **disproved both**. Do not
"fix" either.

- **Our client-side keyword filter is not worse than legacy's server-side one — it is a
  superset.** Searching `Bible` returned 0 on both sides; `Summer` returned the same invoices
  on both; `10.05` matched on ours (we filter on total and formatted date too) and legacy has
  no amount search at all. `GET /api/embed/invoices` was called once across four searches, and
  the route fetches every invoice with no `top` and no paging, so there is no page for a match
  to fall off. **Do not treat "move keyword server-side" as a correctness fix.** It becomes
  one only if the route ever starts paginating.
- Per-toggle behaviour and the detail view's own controls (`← Back to Invoices`, `Pay Now`)
  are real `<button>`s and are fine once reached.

## Phase 1 — make paying an invoice work

### C44 — pick a shape deliberately; do not patch the tag name

Two viable routes. **Recommendation: link out now, offer inline later.**

**Route A — link out (recommended, and closest to legacy).** Add the `target-url` attribute
C60 asks for and render the affordance as a real
`<a href="{target-url}?id={Invoice_GUID}">`.

- Fixes **C45 for free** — an anchor is focusable and Enter-activatable.
- Matches legacy exactly, so a migrating church's mental model is unchanged.
- Avoids the whole `mpp-*`-tag-injection trap.
- Smallest change, and it works today.

**Route B — in-widget overlay (closest to current intent).** Render
`<next-checkout invoice-id="<Invoice_GUID>" api-host="…" payment-processor-url="…">` into the
overlay. `next-checkout`'s `invoice-id` already takes the GUID and short-circuits URL parsing
(`checkout.ts:96-108`). The overlay must also pass through the host's `api-host`, which
`showCheckout` does not currently do.

Route B is arguably the better *experience* — paying without leaving the invoice list is
genuinely nicer than legacy's page hop — but it is blocked on the whole of
`checkout-pay.md` landing, and it multiplies the surfaces that can break. Ship A, then add
B behind `checkout-mode="inline"` once checkout is trustworthy.

**Either way:** never leave a code path that injects an `mpp-*` tag from inside a `next-*`
widget without the re-insert watch `watchMpLoginRegistration()` in `user-menu.ts` uses. That
watch exists precisely because MPWidgets.js will not pick up a tag inserted after its own
`DOMContentLoaded` scan.

### C45 — rows need real controls

Per `CROSS-3` §1. Here specifically: rows open an in-widget detail view rather than
navigating, so the row becomes `<button type="button" class="table-row">` — focus, Enter/Space
and the `button` role all come from the platform — plus a `:focus-visible` outline, which the
stylesheet currently defines for no row at all. The `Pay →` affordance inside the total cell is
a `<span>`; under Route A it becomes the anchor.

### C46 — signed-out state

Per `CROSS-1`. This widget is the clearest case for it: an anonymous visitor is the *normal*
first state for an embedded "My Invoices" block, since members arrive from an emailed link.

## Phase 2 — C60, with one important correction to the item

### The filters

Add `congregation-id`, `month-id`, `invoice-status-id`, `keyword` and
`hide-free-events-checkbox` to a new `observedAttributes`, seed the corresponding controls
from them on first render, and pass them to the route as query params so MP does the
filtering. A multi-campus church embedding this on a campus page currently gets every invoice
across every congregation and status, with no markup that can narrow it.

Note the new widget renders its single text box **only when there are more than three
invoices** (`my-invoices.ts:281-287`), so with three or fewer even that disappears. Legacy
always renders its form. Reconsider that threshold while adding the filters.

### The part the item almost buries — the default record set differs

This is the finding most likely to generate a support call, and it is not really an attribute
gap:

> Same MP contact, same moment: **legacy showed 3 invoices, ours showed 6.** The extra three
> are all `Invoice_Total` 0. Legacy excludes zero-total invoices unless "Show Free Events" is
> ticked; ours always lists them. Legacy also omits the total element entirely on a free
> invoice, where ours prints `$0.00`.

So a church migrating sees the invoice count double overnight with no explanation. Decide
which default is right — I lean toward **listing free registrations by default** (they *are*
the member's registrations, and hiding them is a strange default) but **badging them as free
rather than printing `$0.00`**, and offering `hide-free-events` for churches that want
legacy's behaviour. Whatever is chosen, it belongs in the migration notes, because the
difference is visible on day one.

`$0.00` on a free registration is the same category of wrongness as C47's "Paid in full" on a
zero-total invoice — see `checkout-pay.md`. Fix them with the same vocabulary.

### `targeturl`

Under Route A this comes back as `target-url`. Under Route B it is genuinely unnecessary and
should be recorded as a deliberate non-port.

## Do better than parity

- **The invoice list is a status page, not a search page.** Legacy gave it five filter
  controls because it had no better idea; most members have between one and six invoices. Lead
  with what they owe — a "Balance due" summary at the top, payable invoices first — and keep
  the filters for the churches that need them via attributes. That is a better default than
  either system ships.
- **Free registrations deserve their own treatment**, not a `$0.00` row that looks like a
  bug.
- **Route B, later, is the real win.** Paying from the list without a page hop is the thing
  legacy could not do; it is worth building once checkout is solid.

## Acceptance

- "Pay Now" / "Pay Balance" reaches a working checkout for the correct invoice, addressed by
  `Invoice_GUID`.
- No `mpp-*` tag is injected anywhere in this component.
- Every row is reachable and activatable by keyboard; the detail view and Pay control can be
  reached with no pointer.
- Anonymous load renders a sign-in prompt.
- `congregation-id` / `invoice-status-id` narrow the list server-side.
- The free-events default is decided, implemented and written into the migration notes.

## Depends on / unblocks

**C44 Route A is independent and should be taken now.** Route B depends on the whole of
`checkout-pay.md`, and on `CROSS-2` for the signed-in path. C45 and C46 follow `CROSS-3` and
`CROSS-1`.
