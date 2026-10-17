// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { getMoneyFormatter } from "../../utils/shared";
import type { TaxSummaryEntry } from "../../utils/tax-summary";

// The block's only hook; a plain function lets the test call the block
// directly and read its element tree.
vi.mock("./tw", () => ({ useTw: () => () => ({}) }));

const { SummaryBlock } = await import("./SummaryBlock");

/** Every row's text, one string per <Text>. */
function texts(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  if (node.type === "TEXT") {
    const parts = Array.isArray(props.children)
      ? props.children
      : [props.children];
    return [parts.filter((p) => p !== null && p !== undefined).join("")];
  }
  return texts(props.children);
}

function render(taxSummary: TaxSummaryEntry[], invoiceMessages: string[]) {
  const data = {
    locale: "en-US",
    currencyCode: "CAD",
    numberFormatter: getMoneyFormatter("en-US", 2),
    salesInvoice: { exchangeRate: 1, totalTax: 144 },
    salesInvoiceShipment: { shippingCost: 0 },
    salesInvoiceLines: [
      {
        quantity: 10,
        convertedUnitPrice: 120,
        discountPercent: 0,
        taxPercent: 0.12
      }
    ],
    taxSummary,
    invoiceMessages
  };
  return texts(
    SummaryBlock({ block: { options: {} } as never, data: data as never })
  );
}

describe("SalesInvoice SummaryBlock taxes", () => {
  it("prints today's single tax row for one entry", () => {
    const rows = render(
      [{ name: "HST", rate: 0.12, base: 1200, tax: 144 }],
      []
    );
    expect(rows).toContain("Taxes (CAD)");
    expect(rows).toContain("144.00");
    expect(rows.some((text) => text.includes(" on "))).toBe(false);
  });

  it("prints one row per component when there are several", () => {
    const rows = render(
      [
        { name: "GST", rate: 0.05, base: 1200, tax: 60 },
        { name: "PST", rate: 0.07, base: 1200, tax: 84 }
      ],
      ["Registered for GST."]
    );
    expect(rows).not.toContain("Taxes (CAD)");
    expect(rows).toContain("GST 5% on 1,200.00 (CAD)");
    expect(rows).toContain("PST 7% on 1,200.00 (CAD)");
    expect(rows).toContain("60.00");
    expect(rows).toContain("84.00");
    expect(rows).toContain("Registered for GST.");
  });
});
