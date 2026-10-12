// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { selectQuoteLines } from "./quote-summary-selection";

const price = (quoteLineId: string, quantity: number, net: number) => ({
  quoteLineId,
  quantity,
  netUnitPrice: net,
  convertedNetUnitPrice: net,
  leadTime: 0,
  shippingCost: 0,
  convertedShippingCost: 0,
  discountPercent: 0,
  unitPrice: net,
  convertedUnitPrice: net
});
const line = (id: string, quantity: number[]) => ({
  id,
  quantity,
  additionalCharges: {},
  taxPercent: 0
});
const select = (
  lines: ReturnType<typeof line>[],
  prices: ReturnType<typeof price>[],
  picks: Record<string, number> = {}
) =>
  selectQuoteLines({
    lines: lines as never,
    prices: prices as never,
    salesOrderLines: [],
    exchangeRate: 1,
    picks
  });

describe("selectQuoteLines", () => {
  const prices = [price("a", 1, 73), price("a", 10, 60), price("b", 1, 20)];

  it("takes each line's first priced break by default", () => {
    const selected = select([line("a", [1, 10]), line("b", [1])], prices);
    expect(selected.a?.convertedNetUnitPrice).toBe(73);
    expect(selected.b?.convertedNetUnitPrice).toBe(20);
  });

  it("drops a deleted line, even one the user had picked a break for", () => {
    const selected = select([line("b", [1])], prices, { a: 10 });
    expect(Object.keys(selected)).toEqual(["b"]);
  });

  it("keeps a pick, and deselects on 0 or a break that no longer exists", () => {
    const lines = [line("a", [1, 10])];
    expect(select(lines, prices, { a: 10 }).a?.quantity).toBe(10);
    expect(select(lines, prices, { a: 0 }).a?.quantity).toBe(0);
    expect(select(lines, prices, { a: 25 }).a?.quantity).toBe(0);
  });
});
