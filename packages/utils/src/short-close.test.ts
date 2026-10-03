// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  getBillableQuantity,
  getRemainingQuantityToInvoice,
  type ShortCloseInvoicingLine
} from "./short-close";

const line = (
  overrides: Partial<ShortCloseInvoicingLine>
): ShortCloseInvoicingLine => ({
  purchaseQuantity: 9,
  quantityReceived: 0,
  quantityInvoiced: 0,
  receivedComplete: false,
  ...overrides
});

it("open line bills the ordered quantity", () => {
  const l = line({ quantityReceived: 2 });
  expect(getBillableQuantity(l)).toEqual(9);
  expect(getRemainingQuantityToInvoice(l)).toEqual(9);
});

it("fully received line bills the ordered quantity", () => {
  const l = line({ quantityReceived: 9, receivedComplete: true });
  expect(getBillableQuantity(l)).toEqual(9);
  expect(getRemainingQuantityToInvoice(l)).toEqual(9);
});

it("short-closed line bills only the received quantity", () => {
  // Ordered 9, received 2, then Stop Receiving.
  const l = line({ quantityReceived: 2, receivedComplete: true });
  expect(getBillableQuantity(l)).toEqual(2);
  expect(getRemainingQuantityToInvoice(l)).toEqual(2);
});

it("short-closed line already invoiced for receipts has nothing left", () => {
  const l = line({
    quantityReceived: 2,
    quantityInvoiced: 2,
    receivedComplete: true
  });
  expect(getRemainingQuantityToInvoice(l)).toEqual(0);
});

it("short-closed with nothing received has nothing to invoice", () => {
  const l = line({ receivedComplete: true });
  expect(getBillableQuantity(l)).toEqual(0);
  expect(getRemainingQuantityToInvoice(l)).toEqual(0);
});

it("partial invoice against an open line leaves the remainder", () => {
  const l = line({ quantityReceived: 2, quantityInvoiced: 4 });
  expect(getRemainingQuantityToInvoice(l)).toEqual(5);
});

it("over-invoiced short-closed line clamps to zero", () => {
  const l = line({
    quantityReceived: 2,
    quantityInvoiced: 5,
    receivedComplete: true
  });
  expect(getRemainingQuantityToInvoice(l)).toEqual(0);
});

it("over-received line is not short-closed", () => {
  // Received more than ordered (over-receipt) then flagged complete: the
  // received < ordered guard keeps the billable quantity at the order.
  const l = line({ quantityReceived: 11, receivedComplete: true });
  expect(getBillableQuantity(l)).toEqual(9);
});

it("null quantities behave as zero", () => {
  const l = line({
    purchaseQuantity: null,
    quantityReceived: null,
    quantityInvoiced: null,
    receivedComplete: true
  });
  expect(getBillableQuantity(l)).toEqual(0);
  expect(getRemainingQuantityToInvoice(l)).toEqual(0);
});
