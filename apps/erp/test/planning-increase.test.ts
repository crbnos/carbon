// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { chartedOrderQuantity } from "../app/modules/production/ui/Planning/planning-increase";

const increase = (
  periodId: string,
  status = "Open",
  suggestedQuantity = 2530
) => ({ type: "Increase", status, periodId, suggestedQuantity });

describe("chartedOrderQuantity", () => {
  it("charts an order at its open Increase", () => {
    expect(
      chartedOrderQuantity({
        quantity: 250,
        loadedQuantity: 250,
        increase: increase("w1")
      })
    ).toBe(2530);
  });

  it("charts the order as is with no Increase, or a dismissed one", () => {
    expect(
      chartedOrderQuantity({ quantity: 250, loadedQuantity: 250, increase: null })
    ).toBe(250);
    expect(
      chartedOrderQuantity({
        quantity: 250,
        loadedQuantity: 250,
        increase: increase("w1", "Dismissed")
      })
    ).toBe(250);
  });

  it("charts the planner's edit over the Increase", () => {
    expect(
      chartedOrderQuantity({
        quantity: 1000,
        loadedQuantity: 250,
        increase: increase("w1")
      })
    ).toBe(1000);
  });
});
