// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The payment request lifecycle. Pure, so the ERP's forms and the Ramp sync
// read the same table. Spec: .ai/specs/2026-11-23-supplier-payment-requests.md

export const paymentRequestStatusTypes = [
  "Planned",
  "Ready",
  "Sent",
  "Paid",
  "Cancelled"
] as const;
export type PaymentRequestStatus = (typeof paymentRequestStatusTypes)[number];

/** The statuses each status may move to. The service is the only writer. */
export const paymentRequestTransitions: Record<
  PaymentRequestStatus,
  readonly PaymentRequestStatus[]
> = {
  Planned: ["Ready", "Cancelled", "Paid"],
  Ready: ["Planned", "Sent", "Cancelled", "Paid"],
  Sent: ["Paid", "Cancelled"],
  Paid: [],
  // A Ramp payment can still arrive for a request Carbon sent before it was
  // cancelled: Carbon must record the cash that left the bank.
  Cancelled: ["Paid"]
};

export function canTransitionPaymentRequest(
  from: PaymentRequestStatus,
  to: PaymentRequestStatus
) {
  return paymentRequestTransitions[from].includes(to);
}

/** The statuses whose amount still counts against the document's allowance. */
export const OPEN_PAYMENT_REQUEST_STATUSES = [
  "Planned",
  "Ready",
  "Sent"
] as const satisfies readonly PaymentRequestStatus[];

/** Amount, due date and target are editable only before Carbon sends. */
export const EDITABLE_PAYMENT_REQUEST_STATUSES = [
  "Planned",
  "Ready"
] as const satisfies readonly PaymentRequestStatus[];
