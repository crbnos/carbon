// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import ServiceJobEstimatePDF from "./ServiceJobEstimatePDF";

describe("ServiceJobEstimatePDF", () => {
  it("renders the lines and the total", async () => {
    const buffer = await renderToBuffer(
      createElement(ServiceJobEstimatePDF, {
        company: { name: "Acme", baseCurrencyCode: "USD" },
        estimate: {
          serviceJobId: "SJ000001",
          date: "10/23/2026",
          customerName: "Orbital Logistics",
          siteName: "Hangar 2",
          siteAddress: "1 Launch Way, Cape Town",
          itemName: "SAT-1000 Satellite bus",
          serial: "SN-0042",
          laborWarranty: "10/9/2027",
          partsWarranty: null,
          lines: [
            {
              description: "Bench Repair",
              quantity: "2",
              unitPrice: "$95.00",
              amount: "$190.00"
            },
            {
              description: "Reaction wheel",
              quantity: "1",
              unitPrice: "$120.00",
              amount: "$120.00"
            }
          ],
          total: "$310.00"
        }
      } as never) as never
    );
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders an estimate with no unit and no lines", async () => {
    const buffer = await renderToBuffer(
      createElement(ServiceJobEstimatePDF, {
        company: { name: "Acme", baseCurrencyCode: "USD" },
        estimate: {
          serviceJobId: "SJ000002",
          date: "10/23/2026",
          customerName: "Orbital Logistics",
          siteName: null,
          siteAddress: null,
          itemName: null,
          serial: null,
          laborWarranty: null,
          partsWarranty: null,
          lines: [],
          total: "$0.00"
        }
      } as never) as never
    );
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
