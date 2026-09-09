# C49. `next-checkout`'s "Make Changes" link is a bare static URL; legacy resolves the event and invoice ids into it

**Widget:** `next-checkout` (old: `/widgets/Checkout`)
**Severity:** functional
**Confidence:** confirmed — both links read from the DOM for the same invoice
**Found:** 2026-09-08, comparison run

## Old behaviour

Legacy `mpp-checkout` is configured with
`backtoeventtargeturl="https://mpi.ministryplatform.com/widgets/event_details.aspx/"`
and renders a "Back to Event Details" anchor with the identifiers appended from the
invoice it just loaded:

    Back to Event Details -> https://mpi.ministryplatform.com/widgets/event_details.aspx/?id=16&invoiceid=f53eb6ff-786c-488a-b018-ad07eb3a06d8

`id=16` is the `Event_ID` and `invoiceid` the `Invoice_GUID`. Clicking it returns the
registrant to the event registration they are paying for, with their in-progress
invoice still attached, so they can change quantities or options and come back.

## New behaviour

`next-checkout` renders the configured `back-to-event-url` verbatim, with nothing
appended:

    <a class="nw-co-changes" href="/demo-event-finder.html">Make Changes</a>

The registrant lands on whatever generic page the host configured — on the demo, the
event *finder*, i.e. a list of all events — with no event context and no invoice
context. There is no code path that appends either identifier: the string
`back-to-event-url` appears twice in `checkout.ts`, both times as a plain
`getAttribute` interpolated straight into `href`.

The data is available. `api_MPPW_GetInvoice`'s detail rows carry `Event_ID` (and
`Program_ID` and `Event_Participant_ID`), and `CheckoutLineItem` already maps
`eventParticipantId`; `Event_ID` is dropped during mapping. The invoice GUID is
`this.guid` on the widget. `next-event-details` on the receiving end already accepts
both — it has `event-id` / `id-parameter-name` and `invoice-id` /
`invoice-id-parameter-name` attributes — so the destination is built for this and only
the sender is missing.

## Why it matters

"Make Changes" is the escape hatch on a payment screen: the registrant sees a total
they did not expect and wants to fix the registration before paying. Legacy takes them
to the right event with their invoice intact; ours drops them at a list and loses the
invoice, so the only way back is to re-register or to give up. It is also the one place
this flow hands off to another widget in the new SDK, and the hand-off contract
(`invoice-id` on `next-event-details`) is implemented on the receiving side and unused.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/checkout-new-invoice1-line-items.png`
  (new — "Make Changes", `href="/demo-event-finder.html"`),
  `.claude/playwright/widget/screenshots/checkout-old-invoice1-line-items.png`
  (old — "Back to Event Details" with the ids)
- Old, anchor read from `mpp-checkout`'s shadow root for invoice GUID
  `f53eb6ff-786c-488a-b018-ad07eb3a06d8`:
  `Back to Event Details -> https://mpi.ministryplatform.com/widgets/event_details.aspx/?id=16&invoiceid=f53eb6ff-786c-488a-b018-ad07eb3a06d8`
- New, same invoice: `.nw-co-changes` href is `/demo-event-finder.html` — no query
  string at all.
- MP verification: `GET /procs/api_MPPW_GetInvoice?@InvoiceGuid=f53eb6ff-…` returns
  detail rows carrying `"Event_ID": 16`, matching the id legacy put in the link. Our
  `CheckoutLineItem` mapping (`src/services/invoiceService.ts`, the `lineItems` map)
  keeps `eventParticipantId` and discards `Event_ID`.

## Where to fix

`packages/embed-sdk/src/components/checkout.ts:471-476` (the `back-to-event-url`
anchor inside `renderPaySection`). The dropped field is in the `CheckoutLineItem`
mapping in `src/services/invoiceService.ts`; the type is
`CheckoutLineItem` in `packages/types`.

## Suggested fix

Carry `eventId` through the contract and append both identifiers, matching what
`next-event-details` already reads:

1. add `eventId: number | null` to `CheckoutLineItem` (or to the invoice header, since
   in practice one invoice is one event) and populate it in `invoiceService` from the
   proc row that already returns it;
2. in `renderPaySection`, build the href with `URL`/`URLSearchParams` rather than
   string interpolation — `?id=<eventId>&invoiceid=<guid>`, using the destination
   widget's configured parameter names where they differ from the defaults — and fall
   back to the bare `back-to-event-url` when no `eventId` is present (a non-event
   invoice).

Also worth aligning the label: legacy says "Back to Event Details", ours says "Make
Changes". Ours is arguably the clearer call to action, so this is a note rather than a
request — but pick one deliberately, since C67 records that new widget copy is
hardcoded and cannot be overridden by the church.
