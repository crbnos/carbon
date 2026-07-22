import {
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  getBillableQuantity,
  getRemainingQuantityToInvoice,
  type ShortCloseInvoicingLine,
} from "./short-close.ts";

const line = (
  overrides: Partial<ShortCloseInvoicingLine>
): ShortCloseInvoicingLine => ({
  purchaseQuantity: 9,
  quantityReceived: 0,
  quantityInvoiced: 0,
  receivedComplete: false,
  ...overrides,
});

Deno.test("open line bills the ordered quantity", () => {
  const l = line({ quantityReceived: 2 });
  assertEquals(getBillableQuantity(l), 9);
  assertEquals(getRemainingQuantityToInvoice(l), 9);
});

Deno.test("fully received line bills the ordered quantity", () => {
  const l = line({ quantityReceived: 9, receivedComplete: true });
  assertEquals(getBillableQuantity(l), 9);
  assertEquals(getRemainingQuantityToInvoice(l), 9);
});

Deno.test("short-closed line bills only the received quantity", () => {
  // Ordered 9, received 2, then Stop Receiving.
  const l = line({ quantityReceived: 2, receivedComplete: true });
  assertEquals(getBillableQuantity(l), 2);
  assertEquals(getRemainingQuantityToInvoice(l), 2);
});

Deno.test("short-closed line already invoiced for receipts has nothing left", () => {
  const l = line({
    quantityReceived: 2,
    quantityInvoiced: 2,
    receivedComplete: true,
  });
  assertEquals(getRemainingQuantityToInvoice(l), 0);
});

Deno.test("short-closed with nothing received has nothing to invoice", () => {
  const l = line({ receivedComplete: true });
  assertEquals(getBillableQuantity(l), 0);
  assertEquals(getRemainingQuantityToInvoice(l), 0);
});

Deno.test("partial invoice against an open line leaves the remainder", () => {
  const l = line({ quantityReceived: 2, quantityInvoiced: 4 });
  assertEquals(getRemainingQuantityToInvoice(l), 5);
});

Deno.test("over-invoiced short-closed line clamps to zero", () => {
  const l = line({
    quantityReceived: 2,
    quantityInvoiced: 5,
    receivedComplete: true,
  });
  assertEquals(getRemainingQuantityToInvoice(l), 0);
});

Deno.test("over-received line is not short-closed", () => {
  // Received more than ordered (over-receipt) then flagged complete: the
  // received < ordered guard keeps the billable quantity at the order.
  const l = line({ quantityReceived: 11, receivedComplete: true });
  assertEquals(getBillableQuantity(l), 9);
});

Deno.test("null quantities behave as zero", () => {
  const l = line({
    purchaseQuantity: null,
    quantityReceived: null,
    quantityInvoiced: null,
    receivedComplete: true,
  });
  assertEquals(getBillableQuantity(l), 0);
  assertEquals(getRemainingQuantityToInvoice(l), 0);
});
