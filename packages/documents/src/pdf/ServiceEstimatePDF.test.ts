// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import ServiceEstimatePDF from "./ServiceEstimatePDF";

describe("ServiceEstimatePDF", () => {
  it("renders the tree, a fixed-price node and the total", async () => {
    const buffer = await renderToBuffer(
      createElement(ServiceEstimatePDF, {
        company: { name: "Acme", baseCurrencyCode: "USD" },
        estimate: {
          serviceOrderId: "SVC000001",
          date: "10/9/2026",
          customerName: "Orbital Logistics",
          siteName: "Hangar 2",
          siteAddress: "1 Launch Way, Cape Town",
          itemName: "SAT-1000 Satellite bus",
          serial: "SN-0042",
          laborWarranty: "10/9/2027",
          partsWarranty: null,
          nodes: [
            {
              id: "engine",
              depth: 0,
              readableId: "SVC000001-1",
              name: "Engine",
              isFixedPrice: false,
              total: "$190.00",
              lines: [
                {
                  description: "Mechanic",
                  quantity: "2 HR",
                  unitPrice: "$95.00",
                  amount: "$190.00"
                }
              ]
            },
            {
              id: "cylinders",
              depth: 1,
              readableId: "SVC000001-2",
              name: "Cylinders",
              isFixedPrice: true,
              total: "$500.00",
              lines: [
                {
                  description: "Cylinders",
                  quantity: "",
                  unitPrice: "",
                  amount: "$500.00"
                }
              ]
            }
          ],
          total: "$690.00"
        }
      } as never) as never
    );
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
