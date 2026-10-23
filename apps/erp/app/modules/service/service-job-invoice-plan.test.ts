// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  planServiceJobInvoiceLines,
  type ServiceInvoiceItem,
  type ServiceInvoiceJob,
  type ServiceInvoiceTime
} from "./service-job-invoice-plan";

const timeAndMaterials: ServiceInvoiceJob = {
  serviceJobId: "SJ000001",
  billingMethod: "Time and Materials",
  serviceItemId: null,
  fixedPrice: null
};

const bench = (hours: number, billable = true): ServiceInvoiceTime => ({
  laborItemId: "bench",
  laborItemName: "Bench Repair",
  hours,
  billable,
  unitSalePrice: 95,
  unitOfMeasureCode: "HR"
});

const part = (
  overrides: Partial<ServiceInvoiceItem> = {}
): ServiceInvoiceItem => ({
  lineType: "Part",
  itemId: "fuse",
  description: "Fuse",
  quantity: 1,
  unitPrice: 120,
  billable: true,
  unitOfMeasureCode: "EA",
  ...overrides
});

const shape = (lines: ReturnType<typeof planServiceJobInvoiceLines>) =>
  lines.map((line) => [
    line.itemId,
    line.description,
    line.quantity,
    line.unitPrice,
    line.unitOfMeasureCode
  ]);

describe("planServiceJobInvoiceLines", () => {
  it("bills Time and Materials: hours per labor item, then parts, then charges", () => {
    const lines = planServiceJobInvoiceLines({
      job: timeAndMaterials,
      serviceItem: null,
      time: [bench(1), bench(0.5)],
      items: [
        part({
          lineType: "Charge",
          itemId: "trip",
          description: "Trip fee",
          unitPrice: 50
        }),
        part()
      ]
    });
    expect(lines.every((line) => line.invoiceLineType === "Service")).toBe(
      true
    );
    expect(shape(lines)).toEqual([
      ["bench", "Bench Repair", 1.5, 95, "HR"],
      ["fuse", "Fuse", 1, 120, "EA"],
      ["trip", "Trip fee", 1, 50, "EA"]
    ]);
  });

  it("gives each labor item its own line at its own rate", () => {
    const lines = planServiceJobInvoiceLines({
      job: timeAndMaterials,
      serviceItem: null,
      time: [
        bench(2),
        {
          laborItemId: "field",
          laborItemName: "Field Technician",
          hours: 3,
          billable: true,
          unitSalePrice: 140,
          unitOfMeasureCode: null
        },
        bench(1)
      ],
      items: []
    });
    expect(shape(lines)).toEqual([
      ["bench", "Bench Repair", 3, 95, "HR"],
      ["field", "Field Technician", 3, 140, "EA"]
    ]);
  });

  it("leaves out non-billable time, parts and charges", () => {
    const lines = planServiceJobInvoiceLines({
      job: timeAndMaterials,
      serviceItem: null,
      time: [bench(1.5), bench(4, false)],
      items: [part(), part({ itemId: "screw", billable: false })]
    });
    expect(shape(lines)).toEqual([
      ["bench", "Bench Repair", 1.5, 95, "HR"],
      ["fuse", "Fuse", 1, 120, "EA"]
    ]);
  });

  it("leaves out a part returned in full", () => {
    const lines = planServiceJobInvoiceLines({
      job: timeAndMaterials,
      serviceItem: null,
      time: [bench(1)],
      items: [part({ quantity: 0 })]
    });
    expect(shape(lines)).toEqual([["bench", "Bench Repair", 1, 95, "HR"]]);
  });

  it("refuses billable hours on a labor item with no sale price", () => {
    expect(() =>
      planServiceJobInvoiceLines({
        job: timeAndMaterials,
        serviceItem: null,
        time: [{ ...bench(1), unitSalePrice: 0 }],
        items: []
      })
    ).toThrow("The labor item Bench Repair has no sale price per hour");
  });

  it("refuses a job with nothing billable", () => {
    expect(() =>
      planServiceJobInvoiceLines({
        job: timeAndMaterials,
        serviceItem: null,
        time: [bench(2, false)],
        items: []
      })
    ).toThrow("has no billable time, part or charge to invoice");
  });

  it("bills a Fixed Price job as one line of its service item", () => {
    const lines = planServiceJobInvoiceLines({
      job: {
        ...timeAndMaterials,
        billingMethod: "Fixed Price",
        serviceItemId: "repair",
        fixedPrice: 450
      },
      serviceItem: { name: "Depot Repair", unitOfMeasureCode: null },
      // Time and parts are in the price.
      time: [bench(3)],
      items: [part()]
    });
    expect(shape(lines)).toEqual([["repair", "Depot Repair", 1, 450, "EA"]]);
  });

  it("refuses a Fixed Price job with no service item or no price", () => {
    const fixed: ServiceInvoiceJob = {
      ...timeAndMaterials,
      billingMethod: "Fixed Price",
      serviceItemId: "repair",
      fixedPrice: 450
    };
    expect(() =>
      planServiceJobInvoiceLines({
        job: { ...fixed, serviceItemId: null },
        serviceItem: null,
        time: [],
        items: []
      })
    ).toThrow("has no service item");
    expect(() =>
      planServiceJobInvoiceLines({
        job: { ...fixed, fixedPrice: null },
        serviceItem: null,
        time: [],
        items: []
      })
    ).toThrow("has no fixed price");
  });
});
