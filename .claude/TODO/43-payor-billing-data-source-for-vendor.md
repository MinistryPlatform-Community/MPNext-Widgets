# 43. Where payor and billing data come from for the payment vendor (C48, vendor integration)

**Depends on:** choosing the real payment vendor.
**Risk:** a sparse purchaser record, or a guest paying someone else's invoice, leaves the
processor with empty billing fields.
**Size:** a decision, then medium.

Filed 2026-10-11 from the comparison-remediation epic. C48 is resolved for the sandbox; this is
its follow-up.

## What

`PaymentRequestToken` (`packages/types/src/payment-token.ts`) carries `firstName` …
`addressZip` from the invoice purchaser's MP record, all nullable, and nothing fills the gaps.
Legacy's payor-contact and billing-address blocks were deliberately not ported into
`next-pay`, which stands in for a vendor-hosted page.

## Do

Before a real processor is wired in, decide whether the vendor page collects billing details
itself (most hosted pages do) or `next-checkout` collects and passes them. The vendor flow must
also echo `receiptTemplateId` (C66) and keep the request token's single-use `jti` semantics
(C43).

## Done when

The data source is decided and implemented, and the vendor flow's receipt and single-use
behaviour are covered by tests.
