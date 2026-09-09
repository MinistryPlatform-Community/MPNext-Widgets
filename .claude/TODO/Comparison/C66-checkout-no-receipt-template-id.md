# C66. `next-checkout` has no `receipt-template-id` — nothing in this repo can name a payment receipt template

**Widget:** `next-checkout` (old: Invoice Details & Payment, `/widgets/Checkout`)
**Severity:** functional
**Confidence:** confirmed — static source read on both sides; the *effect* on the emitted receipt still wants a runtime check (see below)
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

The legacy checkout page — `https://mpi.ministryplatform.com/widgets/Checkout`, also
served at `/widgets/checkout/`, which is where `mpp-my-invoices` sends people — carries:

```html
<mpp-checkout
  paymentprocessortargeturl="https://mpi.ministryplatform.com/widgets/pay?authenticated={{isAuthenticated}}"
  backtoeventtargeturl="https://mpi.ministryplatform.com/widgets/event_details.aspx/"
  receipttemplateid="2695"></mpp-checkout>
```

`observedAttributes` in `/widgets/dist/Checkout.js` is exactly those three:

```
["paymentprocessortargeturl","backtoeventtargeturl","receipttemplateid"]
```

and all three appear in `getAttribute(...)` calls in that bundle. `receipttemplateid`
names the `dp_Communication_Templates` record used for the payment receipt the payer
receives. (It is one of the three attributes the configurator's `configurationItems`
metadata does **not** document — only the two URLs are described there — so
`observedAttributes` plus the call sites are the evidence, not the vendor docs.)

Note this page is **not** `/widgets/giving.aspx`. That page is a `mpp-smart-link` to
Realm and is not a payment widget at all; see CONFIG-MAP.md section 2.5.

## New behaviour

`next-checkout` declares five attributes
(`packages/embed-sdk/src/components/checkout.ts:67`+):

```
["api-host","back-to-event-url","invoice-id","invoice-id-parameter-name","payment-processor-url"]
```

The two URLs carried across, renamed. There is no receipt attribute — and no receipt
concept anywhere: a case-insensitive grep for `receipt` across `src/` and
`packages/embed-sdk/src/` returns **zero** matches. Not in `next-checkout`, not in
`next-checkout-complete`, not in `next-pay`, not in `src/services/checkoutService.ts` or
`paymentService.ts`, not in any `src/app/api/embed/` route.

## Why it matters

A paid registration that sends no receipt, or sends a domain-default receipt where the
church configured a specific one, is a support call per transaction — and for event
registrations the receipt is often the thing carrying the "what to bring / where to go"
copy, not just the amount. Because the value cannot be supplied at all, a church cannot
work around it from the host page either. Whether the new flow sends *some* receipt via a
gateway or MP default, or none, is the open question below; the configurability gap is
certain regardless.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets/Checkout`
- Old surface: `observedAttributes` + the `getAttribute("receipttemplateid")` call in
  `https://mpi.ministryplatform.com/widgets/dist/Checkout.js`
- New surface: `packages/embed-sdk/src/components/checkout.ts:67`+
- Absence: `grep -rni receipt src/ packages/embed-sdk/src/` → no matches
- No screenshot: static-only item by design
- Parity table: `.claude/playwright/widget/CONFIG-MAP.md` section 4.10

## Open question for the payments sibling (C40–C49)

**Please attach to this item rather than filing a second one.** Complete a small paid
transaction on both stacks with a published test card and record whether a receipt email
arrives, from which template, and with what merge fields. Three outcomes:

- legacy sends template 2695, new sends nothing → this item's severity is **breaking**
- legacy sends 2695, new sends a domain/gateway default → **functional**, as filed
- neither sends anything and 2695 is vestigial → downgrade to **cosmetic** and say so here

## Where to fix

- `packages/embed-sdk/src/components/checkout.ts` — `observedAttributes` (~:67) and the
  payment-submit payload
- `src/app/api/embed/checkout/` and/or `src/app/api/embed/payment/` — accept the template id
- `src/services/checkoutService.ts` / `src/services/paymentService.ts` — send the receipt

## Suggested fix

Add `receipt-template-id`, thread it to whichever route finalises the payment, and send
the template the way `src/services/planYourVisitService.ts` already does it — that
service is the in-repo precedent for "read a `dp_Communications` template, substitute
`[merge_token]`s, send", including the note that MP's REST layer has no send-from-template
call. Do not invent a second mechanism. I am not sure whether the receipt belongs to
`next-checkout` (which hands off to the processor) or to `next-checkout-complete` (which
sees the completed token); the runtime check above should settle that, since it will show
where legacy sends from.

---

## Runtime confirmation (added 2026-09-08 by the payments agent)

CONFIG-MAP section 7 item 6 asked whether the legacy flow actually sends a receipt email
that ours does not. **Partially answered; the decisive half is blocked.**

**Confirmed — the legacy page really is configured with a receipt template.** Fetched
2026-09-08: `https://mpi.ministryplatform.com/widgets/Checkout` (and
`/widgets/checkout/`, byte-identical) carries
`<mpp-checkout paymentprocessortargeturl="…/widgets/pay?authenticated={{isAuthenticated}}"
backtoeventtargeturl="…/widgets/event_details.aspx/" receipttemplateid="2695">`. So the
option is live on the sample site, not vestigial markup.

**Confirmed — nothing in this repo has any receipt concept.**
`grep -rniE "receipt" src/ packages/embed-sdk/src/ packages/types/src/` returns four
hits, all of them `Receipted` / `Receipt_Number` columns on the **Donations** MP model
(`src/lib/providers/ministry-platform/models/Donations*.ts`). There is no receipt send,
no template id, and no `dp_Communications` read anywhere in the checkout or payment
path.

**Blocked — whether legacy actually sends the email.** Proving it needs a completed
payment on `mpi.ministryplatform.com/widgets/pay`, which is out of bounds for this run:
MP's gateway configuration for this domain could not be read (`dp_Configuration_Settings`
is restricted for our API user), so we cannot establish that no real processor is
reached. The legacy pay form was enumerated but never submitted. Also worth noting:
`GET /tables/dp_Communications?$filter=Communication_ID = 2695` returns `[]` for our
client-credentials user — either the id lives in a different table on this instance or
the row is not readable to us — so the template could not be inspected either.

**One thing the run does settle about severity.** Our side currently records no payment
at all (**C40**: `paymentService` selects a non-existent `Invoices.Amount_Paid`, so every
`createPaymentFromResponse` fails silently). Until C40 is fixed there is no completed
payment for a receipt to be sent *from*, so C66 cannot be tested end to end on our side
either, and it should be sequenced after C40.

**Where the receipt belongs, on the evidence available.** The suggested fix above was
unsure between `next-checkout` and `next-checkout-complete`. The response token — the
only artefact that proves a transaction succeeded and carries the payor's name, email and
address — is consumed by `POST /api/embed/checkout/payment-response`, which both widgets
call, and by `POST /api/embed/payment/notify`, which a real vendor calls server-to-server
with no browser involved. The receipt therefore belongs on the **server**, in
`PaymentService.createPaymentFromResponse`, right after the `Payments` row is created —
that is the one place all three entry paths converge, and the only one that still works
when the payer closes the tab before the redirect completes. The template id would then
have to reach the server: either as `receipt-template-id` on `next-checkout` threaded
into `PaymentRequestToken` (so it survives the gateway round trip, as legacy does by
putting it on `mpp-checkout`), or as server configuration if a per-embed override is not
actually wanted.
