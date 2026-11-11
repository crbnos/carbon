// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { searchableTypes } from "./search.server";

const viewOf = (...pages: string[]) =>
  Object.fromEntries(
    pages.map((page) => [
      page,
      { view: ["company-1"], create: [], update: [], delete: [] }
    ])
  );

it("gives a Sales Quotes viewer the Sales types and no other", () => {
  expect(searchableTypes(viewOf("sales.quotes"), "company-1")).toEqual([
    "customer",
    "quote",
    "salesRfq",
    "salesOrder"
  ]);
});

it("gives a Purchase Orders viewer the Purchasing types and no Sales type", () => {
  expect(
    searchableTypes(viewOf("purchasing.purchaseOrders"), "company-1")
  ).toEqual(["supplier", "purchaseOrder", "supplierQuote"]);
});

it("searches nothing without a page that owns a searched table", () => {
  expect(searchableTypes({}, "company-1")).toEqual([]);
  expect(searchableTypes(null, "company-1")).toEqual([]);
});

it("searches items on View of any item page", () => {
  expect(searchableTypes(viewOf("parts.tools"), "company-1")).toEqual(["item"]);
});

it("reads the page in the caller's company only", () => {
  expect(searchableTypes(viewOf("sales.quotes"), "company-2")).toEqual([]);
});

it("narrows to the type filter only when that type is allowed", () => {
  const quotes = viewOf("sales.quotes");
  expect(searchableTypes(quotes, "company-1", "quote")).toEqual(["quote"]);
  expect(searchableTypes(quotes, "company-1", "purchaseOrder")).toEqual([]);
  expect(searchableTypes(quotes, "company-1", "all")).toEqual([
    "customer",
    "quote",
    "salesRfq",
    "salesOrder"
  ]);
});
