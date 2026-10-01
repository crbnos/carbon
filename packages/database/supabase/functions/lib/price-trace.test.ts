// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { quoteToOrderPriceTrace } from "./price-trace.ts";

const quoteTrace = [
  { step: "Base Price", source: "Cost + Markup", amount: 100 },
  {
    step: "Markup",
    source: "Rule: Aerospace",
    amount: 110,
    adjustment: 10,
    ruleId: "pr1",
  },
  { step: "Final Price", source: "Resolved", amount: 110 },
];

Deno.test("a quote break with no trace gives the order line none", () => {
  assertEquals(quoteToOrderPriceTrace(null, 110, 110, 0), null);
  assertEquals(quoteToOrderPriceTrace([], 110, 110, 0), null);
});

Deno.test("an undiscounted break keeps its steps and ends at the price", () => {
  assertEquals(quoteToOrderPriceTrace(quoteTrace, 110, 110, 0), [
    quoteTrace[0],
    quoteTrace[1],
    { step: "Final Price", source: "Quote", amount: 110 },
  ]);
});

Deno.test("the quote line discount is a step down to the net price", () => {
  assertEquals(quoteToOrderPriceTrace(quoteTrace, 110, 99, 0.1), [
    quoteTrace[0],
    quoteTrace[1],
    {
      step: "Discount",
      source: "Quote Discount (10%)",
      amount: 99,
      adjustment: -11,
    },
    { step: "Final Price", source: "Quote", amount: 99 },
  ]);
});
