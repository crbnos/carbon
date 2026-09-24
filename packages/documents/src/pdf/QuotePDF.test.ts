import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
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
