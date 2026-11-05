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
  fixedPrice: null,
  laborBillRate: 95
};

const hours = (value: number, billable = true): ServiceInvoiceTime => ({
  hours: value,
  billable
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
  it("bills Time and Materials: one labor line, then parts, then charges, all Service lines", () => {
    const lines = planServiceJobInvoiceLines({
      job: timeAndMaterials,
      time: [hours(1), hours(0.5)],
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
    expect(lines.map((line) => line.invoiceLineType)).toEqual([
      "Service",
      "Service",
      "Service"
    ]);
    expect(shape(lines)).toEqual([
      [null, "Labor", 1.5, 95, "EA"],
      ["fuse", "Fuse", 1, 120, "EA"],
      ["trip", "Trip fee", 1, 50, "EA"]
    ]);
  });

  it("bills every billable hour on one labor line with no item at the job's bill rate", () => {
    const lines = planServiceJobInvoiceLines({
      job: timeAndMaterials,
      time: [hours(2), hours(1)],
      items: []
    });
    expect(shape(lines)).toEqual([[null, "Labor", 3, 95, "EA"]]);
    expect(lines[0]!.quantity * lines[0]!.unitPrice).toBe(285);
  });

  it("leaves out non-billable time, parts and charges", () => {
    const lines = planServiceJobInvoiceLines({
      job: timeAndMaterials,
      time: [hours(1.5), hours(4, false)],
      items: [part(), part({ itemId: "screw", billable: false })]
    });
    expect(shape(lines)).toEqual([
      [null, "Labor", 1.5, 95, "EA"],
      ["fuse", "Fuse", 1, 120, "EA"]
    ]);
  });

  it("leaves out a part returned in full", () => {
    const lines = planServiceJobInvoiceLines({
      job: timeAndMaterials,
      time: [hours(1)],
      items: [part({ quantity: 0 })]
    });
    expect(shape(lines)).toEqual([[null, "Labor", 1, 95, "EA"]]);
  });

  it("refuses billable hours on a job with no bill rate", () => {
    expect(() =>
      planServiceJobInvoiceLines({
        job: { ...timeAndMaterials, laborBillRate: null },
        time: [hours(1)],
        items: []
      })
    ).toThrow("Set the job's bill rate first.");
  });

  it("bills parts with no bill rate when no hours are billable", () => {
    const lines = planServiceJobInvoiceLines({
      job: { ...timeAndMaterials, laborBillRate: null },
      time: [hours(2, false)],
      items: [part()]
    });
    expect(shape(lines)).toEqual([["fuse", "Fuse", 1, 120, "EA"]]);
  });

  it("refuses a job with nothing billable", () => {
    expect(() =>
      planServiceJobInvoiceLines({
        job: timeAndMaterials,
        time: [hours(2, false)],
        items: []
      })
    ).toThrow("has no billable time, part or charge to invoice");
  });

  it("bills a Fixed Price job as one Service line with no item", () => {
    const lines = planServiceJobInvoiceLines({
      job: {
        ...timeAndMaterials,
        billingMethod: "Fixed Price",
        fixedPrice: 450
      },
      // Time and parts are in the price.
      time: [hours(3)],
      items: [part()]
    });
    expect(
      lines.map((line) => [line.invoiceLineType, ...shape([line])[0]!])
    ).toEqual([["Service", null, "Fixed price service", 1, 450, "EA"]]);
  });

  it("refuses a Fixed Price job with no price", () => {
    expect(() =>
      planServiceJobInvoiceLines({
        job: {
          ...timeAndMaterials,
          billingMethod: "Fixed Price",
          fixedPrice: null
        },
        time: [],
        items: []
      })
    ).toThrow("Set the job's fixed price first.");
  });
});
