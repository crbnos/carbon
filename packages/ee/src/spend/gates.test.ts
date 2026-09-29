import { describe, expect, it } from "vitest";
import {
  isPushableInvoiceStatus,
  isPushablePurchaseOrderStatus,
  isSettledPurchaseOrderStatus,
  SPEND_PUSHED_INVOICE_STATUSES,
  SPEND_SETTLED_PURCHASE_ORDER_STATUSES
} from "./gates";

/**
 * These pin the eligibility facts, not the syntax of an array. Each assertion
 * below corresponds to a way the spend push has actually gone wrong or would:
 * a status quietly dropped from a set stops documents reaching the platform
 * with no error anywhere, because "not eligible" is a silent skip by design.
 */
describe("spend push eligibility", () => {
  it("pushes released purchase orders and refuses drafts", () => {
    expect(isPushablePurchaseOrderStatus("To Receive")).toBe(true);
    expect(isPushablePurchaseOrderStatus("To Invoice")).toBe(true);
    expect(isPushablePurchaseOrderStatus("To Receive and Invoice")).toBe(true);

    // A Draft is not a commitment — mirroring one would put spend authority in
    // the platform for an order nobody has approved.
    expect(isPushablePurchaseOrderStatus("Draft")).toBe(false);
  });

  it("treats settled purchase orders as pushable so they can be retired", () => {
    // Completed/Closed must stay in the PUSHABLE set: the syncer needs to reach
    // them to retire the platform's counterpart. Dropping them from the pushable
    // set would leave every settled PO open on the platform forever.
    for (const status of SPEND_SETTLED_PURCHASE_ORDER_STATUSES) {
      expect(isSettledPurchaseOrderStatus(status)).toBe(true);
      expect(isPushablePurchaseOrderStatus(status)).toBe(true);
    }
  });

  it("does not treat a released-but-unsettled order as settled", () => {
    expect(isSettledPurchaseOrderStatus("To Receive")).toBe(false);
    expect(isSettledPurchaseOrderStatus("To Invoice")).toBe(false);
  });

  it("keeps a Completed order ALIVE on the platform, and retires only a Closed one", () => {
    // The bug this pins: Completed used to be settled, so the platform's copy
    // was archived at the exact moment its bill arrived — and a bill can only be
    // matched to an order that still exists. Ramp offers no non-destructive
    // "close" (a purchase order has `archived_at` and no state field), so the
    // order surviving is the prerequisite for any match at all. Completed =
    // received AND invoiced, which is exactly when the match matters; Closed =
    // short-closed, no bill is coming. (Whether Ramp matches automatically is
    // NOT established — see `SPEND_SETTLED_PURCHASE_ORDER_STATUSES` — and the
    // writable `purchase_order_ids` link is a follow-up.)
    expect(isSettledPurchaseOrderStatus("Completed")).toBe(false);
    expect(isSettledPurchaseOrderStatus("Closed")).toBe(true);

    // Both stay pushable — Completed so its final state reaches the platform,
    // Closed so the counterpart can be retired.
    expect(isPushablePurchaseOrderStatus("Completed")).toBe(true);
    expect(isPushablePurchaseOrderStatus("Closed")).toBe(true);
  });

  it("pushes every payable status the invoice VIEW can derive", () => {
    // "Partially Paid" and "Overdue" exist ONLY in the view — the table still
    // stores "Open". Omitting either silently stops real payables from ever
    // reaching the platform.
    expect(isPushableInvoiceStatus("Open")).toBe(true);
    expect(isPushableInvoiceStatus("Partially Paid")).toBe(true);
    expect(isPushableInvoiceStatus("Overdue")).toBe(true);
    expect(SPEND_PUSHED_INVOICE_STATUSES).toHaveLength(3);
  });

  it("refuses invoices that are not payable", () => {
    // Paid is the one that matters: the view derives it from settlements while
    // the table still reads "Open", so reading the table would hand the
    // platform a bill the customer has already paid.
    expect(isPushableInvoiceStatus("Paid")).toBe(false);
    expect(isPushableInvoiceStatus("Draft")).toBe(false);
    expect(isPushableInvoiceStatus("Voided")).toBe(false);
  });
});
