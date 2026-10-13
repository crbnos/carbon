// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Planned } from "./inputs";

const value = (given: unknown): Planned => ({
  kind: "value",
  value: given,
  source: "type"
});
const from = (table: string, column = "id"): Planned => ({
  kind: "sample",
  from: [{ table, column }],
  many: false,
  source: "column"
});

/**
 * Arguments the planner cannot work out from the tool's body, its schema or
 * the database, written down per tool. Each one replaces the planned argument
 * of that name. Keep it short: an entry here is something the published tool
 * does not say about itself.
 */
export function givenInputs(today: string): Record<string, Record<string, Planned>> {
  return {
    accounting_getAccountPeriodSeries: {
      start: value(today),
      periodEnds: value([today])
    },
    accounting_getDimensionPivotLines: { filters: value([]) },
    accounting_getConsolidatedBalances: {
      targetCurrency: from("company", "baseCurrencyCode")
    },
    accounting_getConsolidatedPeriodSeries: {
      targetCurrency: from("company", "baseCurrencyCode")
    },
    // The details come from a SQL function, so the body names no table.
    items_getConsumable: { itemId: from("consumables") },
    items_getService: { itemId: from("services") },
    items_getTool: { itemId: from("tools") },
    items_getNextRevision: { maxRevision: value("A") },
    items_findOtherOpenChangeNoticesForItem: {
      excludeChangeNoticeId: from("changeOrder")
    },
    production_getCompletionJobs: { timeZone: value("UTC") },
    sales_getQuoteLinePricesByItemId: { currentQuoteId: from("quote") },
    sales_getQuoteLinePricesByItemIds: { currentQuoteId: from("quote") }
  };
}
