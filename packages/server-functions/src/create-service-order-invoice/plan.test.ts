// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  planServiceInvoiceLines,
  type ServiceInvoiceElement,
  type ServiceInvoiceItem
} from "./plan";

const element = (
  id: string,
  name: string,
  sortOrder: number,
  extra: Partial<ServiceInvoiceElement> = {}
): ServiceInvoiceElement => ({
  id,
  parentId: null,
  name,
  sortOrder,
  sequence: sortOrder,
  fixedPrice: null,
  ...extra
});

const item = (
  id: string,
  projectElementId: string | null,
  quantity: number,
  unitPrice: number
): ServiceInvoiceItem => ({
  id,
  projectElementId,
  itemId: null,
  description: id,
  quantity,
  unitPrice,
  amount: quantity * unitPrice,
  unitOfMeasureCode: "EA"
});

describe("planServiceInvoiceLines", () => {
  it("gives two top-level nodes with 2 items each 2 comments and 4 lines in tree order", () => {
    const lines = planServiceInvoiceLines({
      // Out of order on purpose: sortOrder decides.
      elements: [
        element("pump", "Pump", 2),
        element("motor", "Motor", 1),
        element("bearing", "Bearing", 1, { parentId: "motor" })
      ],
      items: [
        item("pump-labor", "pump", 2, 95),
        item("pump-seal", "pump", 1, 40),
        item("bearing-part", "bearing", 1, 120),
        item("motor-labor", "motor", 1, 95)
      ],
      invoiceDetail: "Itemized"
    });
    expect(
      lines.map((line) => [
        line.invoiceLineType,
        line.description,
        line.quantity,
        line.unitPrice,
        line.billableItemIds
      ])
    ).toEqual([
      ["Comment", "Motor", 0, 0, []],
      ["Service", "motor-labor", 1, 95, ["motor-labor"]],
      ["Service", "bearing-part", 1, 120, ["bearing-part"]],
      ["Comment", "Pump", 0, 0, []],
      ["Service", "pump-labor", 2, 95, ["pump-labor"]],
      ["Service", "pump-seal", 1, 40, ["pump-seal"]]
    ]);
  });

  it("gives a 900.00 fixed-price node one 900.00 line and its items at 0", () => {
    const lines = planServiceInvoiceLines({
      elements: [
        element("overhaul", "Overhaul", 1, { fixedPrice: 900 }),
        element("rotor", "Rotor", 1, { parentId: "overhaul" })
      ],
      items: [
        item("labor", "overhaul", 4, 95),
        item("rotor-part", "rotor", 1, 600)
      ],
      invoiceDetail: "Itemized"
    });
    expect(
      lines.map((line) => [
        line.invoiceLineType,
        line.description,
        line.unitPrice,
        line.billableItemIds
      ])
    ).toEqual([
      ["Comment", "Overhaul", 0, []],
      ["Service", "Overhaul", 900, []],
      ["Service", "labor (Included in fixed price)", 0, ["labor"]],
      ["Service", "rotor-part (Included in fixed price)", 0, ["rotor-part"]]
    ]);
  });

  it("gives By Node one line per top-level node with its subtree total", () => {
    const lines = planServiceInvoiceLines({
      elements: [
        element("motor", "Motor", 1),
        element("bearing", "Bearing", 1, { parentId: "motor" }),
        element("pump", "Pump", 2, { fixedPrice: 250 }),
        element("idle", "Idle", 3)
      ],
      items: [
        item("motor-labor", "motor", 2, 95),
        item("bearing-part", "bearing", 1, 120),
        item("pump-seal", "pump", 1, 40),
        item("loose", null, 1, 15)
      ],
      invoiceDetail: "By Node"
    });
    expect(
      lines.map((line) => [
        line.invoiceLineType,
        line.description,
        line.quantity,
        line.unitPrice,
        line.billableItemIds
      ])
    ).toEqual([
      ["Service", "Motor", 1, 310, ["motor-labor", "bearing-part"]],
      ["Service", "Pump", 1, 250, ["pump-seal"]],
      ["Service", "Other charges", 1, 15, ["loose"]]
    ]);
  });
});
