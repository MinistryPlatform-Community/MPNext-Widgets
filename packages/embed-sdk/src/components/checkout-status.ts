/**
 * One payment-response → screen-state mapper, shared by `next-checkout` and
 * `next-checkout-complete` (C41).
 *
 * The endpoints used to answer two booleans (`success`, `paymentReceived`),
 * and each widget invented its own branch over them: `next-checkout` showed a
 * declined card — and an infrastructure fault — as the amber "your payment is
 * being processed". They now answer one `status` discriminant, and this file is
 * the only place that turns it into a tone and copy, so the two widgets cannot
 * diverge again.
 *
 * Checkout-local rather than in `shared/`: only the payment widgets read it.
 * It registers no element.
 */

import type { MessageKey } from "../i18n";

/** Mirrors `PaymentOutcomeStatus` in `@mpnext/types` (the SDK takes no runtime dep on it). */
export type PaymentStatus = "received" | "pending" | "declined" | "error";

/** Visual treatment: green, amber, coral. `declined` and `error` share coral. */
export type PaymentTone = "success" | "pending" | "failed";

export interface PaymentOutcomeView {
  status: PaymentStatus;
  tone: PaymentTone;
  /** `next-checkout`'s banner sentence. */
  bannerKey: MessageKey;
  /** `next-checkout-complete`'s card title. */
  titleKey: MessageKey;
  /** `next-checkout-complete`'s card sentence. */
  messageKey: MessageKey;
  /**
   * Whether the payer should be offered the Pay form again. True only for a
   * decline (nothing was charged; try another card). An `error` arrives
   * *after* the processor reported success, so the card may well have been
   * charged — offering the form again invites a double charge, and the copy
   * sends the payer to the church instead.
   */
  canRetryPayment: boolean;
}

const VIEWS: Record<PaymentStatus, Omit<PaymentOutcomeView, "status">> = {
  received: {
    tone: "success",
    bannerKey: "checkout.paymentReceived",
    titleKey: "checkoutComplete.titleSuccess",
    messageKey: "checkoutComplete.received",
    canRetryPayment: false,
  },
  pending: {
    tone: "pending",
    bannerKey: "checkout.paymentPending",
    titleKey: "checkoutComplete.titlePending",
    messageKey: "checkoutComplete.processing",
    canRetryPayment: false,
  },
  declined: {
    tone: "failed",
    bannerKey: "checkout.paymentDeclined",
    titleKey: "checkoutComplete.titleDeclined",
    messageKey: "checkoutComplete.declined",
    canRetryPayment: true,
  },
  error: {
    tone: "failed",
    bannerKey: "checkout.paymentError",
    titleKey: "checkoutComplete.titleFailed",
    messageKey: "checkoutComplete.error",
    canRetryPayment: false,
  },
};

/**
 * Read the `status` out of a payment-response body. Anything unrecognised —
 * an older server, a malformed body — is `error`, never `pending`: telling a
 * payer their money is on its way when we do not know is the exact defect.
 */
export function paymentStatusOf(payload: unknown): PaymentStatus {
  const status =
    typeof payload === "object" && payload !== null
      ? (payload as { status?: unknown }).status
      : undefined;
  return typeof status === "string" && status in VIEWS
    ? (status as PaymentStatus)
    : "error";
}

/** The full view for a payment-response body. */
export function paymentOutcomeView(payload: unknown): PaymentOutcomeView {
  const status = paymentStatusOf(payload);
  return { status, ...VIEWS[status] };
}
