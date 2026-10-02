// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renderToBuffer } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import QuotePDF from "./QuotePDF";

const line = {
  id: "line-1",
  quoteId: "quote-1",
  itemId: "item-1",
  itemReadableId: "SAT-1000",
  description: "Satellite bus",
  status: "Complete",
  quantity: [1],
  taxPercent: 0,
  thumbnailPath: "_templates/aerospace_satellite/SAT-1000.svg"
};

function render(thumbnails: Record<string, string | null>) {
  return renderToBuffer(
    createElement(QuotePDF, {
      company: { name: "Acme", baseCurrencyCode: "USD" },
      locale: "en-US",
      exchangeRate: 1,
      quote: { id: "quote-1", quoteId: "Q000001", currencyCode: "USD" },
      quoteLines: [line],
      quoteLinePrices: [],
      quoteCustomerDetails: {},
      paymentTerms: [],
      shippingMethods: [],
      terms: {},
      thumbnails
    } as never) as never
  );
}

describe("QuotePDF thumbnails", () => {
  // The route records a line whose thumbnail could not be downloaded as
  // `null`; an <Image> with a null src crashes react-pdf's layout with
  // "Cannot read properties of undefined (reading 'width')".
  it("renders when a line's thumbnail failed to load", async () => {
    const pdf = await render({ "line-1": null });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("QuotePDF No Quote lines", () => {
  // QuotePDF renders a <Template> whose children are one Fragment per block,
  // each wrapping the block element — every block receives the same `data`.
  function blockData(props: Record<string, unknown>) {
    type Data = {
      quoteLines: { id: string }[];
      quoteLinePrices: { quoteLineId: string }[];
      maxLeadTime: number;
      totals: { subtotal: number };
    };
    const template = (QuotePDF as (p: never) => ReactElement)(props as never);
    const fragments = (template.props as { children: ReactElement[] }).children;
    const data = fragments
      .map(
        (f) =>
          (f.props as { children?: ReactElement | null }).children?.props as
            | { data?: Data }
            | undefined
      )
      .find((p) => p?.data)?.data;
    if (!data) throw new Error("No block received data");
    return data;
  }

  it("leaves a No Quote line, its prices and its lead time off the document", () => {
    const data = blockData({
      company: { name: "Acme", baseCurrencyCode: "USD" },
      locale: "en-US",
      exchangeRate: 1,
      quote: { id: "quote-1", quoteId: "Q000001", currencyCode: "USD" },
      quoteLines: [
        line,
        {
          ...line,
          id: "line-2",
          itemReadableId: "SAT-2000",
          status: "No Quote",
          noQuoteReason: "nqr_1"
        }
      ],
      quoteLinePrices: [
        {
          quoteLineId: "line-1",
          quantity: 1,
          leadTime: 5,
          convertedNetExtendedPrice: 100
        },
        {
          quoteLineId: "line-2",
          quantity: 1,
          leadTime: 30,
          convertedNetExtendedPrice: 900
        }
      ],
      quoteCustomerDetails: {},
      paymentTerms: [],
      shippingMethods: [],
      terms: {},
      thumbnails: {}
    });

    expect(data.quoteLines.map((l) => l.id)).toEqual(["line-1"]);
    expect(data.quoteLinePrices.map((p) => p.quoteLineId)).toEqual(["line-1"]);
    expect(data.maxLeadTime).toBe(5);
    expect(data.totals.subtotal).toBe(100);
  });
});
