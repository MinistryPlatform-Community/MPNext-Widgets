# 42. Overpayment on the response path: refuse, or record and flag? (C43, vendor integration)

**Depends on:** a real payment vendor being wired in (`next-pay` is a sandbox stand-in).
**Risk:** with a real vendor the money has already moved by the time the response is
recorded, so refusing to record it loses the payment from MP.
**Size:** a decision, then a small change.

Filed 2026-10-11 from the comparison-remediation epic. C43 itself is resolved; this is its
follow-up.

## What

`checkout/payment-token` refuses an over-balance amount (`422 invalid_request`) before any
processor sees it. That stays. But if the balance moves between token and response (a second
tab paid first), `PaymentService.createPaymentFromResponse` (`src/services/paymentService.ts`,
via `exceedsBalance`) also refuses, returns `error`, and only logs
`NOT recorded — reconcile manually`. That is right for the sandbox and wrong once a vendor has
charged the card.

## Do

As part of the vendor integration, decide: record the payment and flag the overpayment for
staff, or keep refusing and rely on the vendor to void. Do not weaken the single-use `jti` or
the `Transaction_Code` idempotency claim (CLAUDE.md, Services, "Payments").

## Done when

The decision is made and implemented, with a route test that changes the balance between
token and response.
