// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  classifyCustomerPartRow,
  customerPartKey
} from "./customer-part-import";
import { buildItemIndex } from "./existing-item";

const itemIndex = buildItemIndex([
  { id: "part-1", readableId: "HSG-40", revision: "0", type: "Part" },
  { id: "tool-1", readableId: "HSG-40", revision: "0", type: "Tool" },
  { id: "mat-1", readableId: "BAR-6061", revision: "0", type: "Material" }
]);

const classify = (
  record: Record<string, string>,
  seenKeys = new Set<string>()
) => classifyCustomerPartRow({ record, itemIndex, seenKeys });

it("maps a part to the customer's part number, revision defaulting to blank", () => {
  expect(
    classify({
      readableId: "HSG-40",
      customerId: "cus-1",
      customerPartId: " C-88812 "
    })
  ).toEqual({
    action: "upsert",
    row: {
      customerId: "cus-1",
      itemId: "part-1",
      customerPartId: "C-88812",
      customerPartRevision: ""
    }
  });
  expect(
    classify({
      readableId: "HSG-40",
      customerId: "cus-1",
      customerPartId: "C-88812",
      customerPartRevision: "D"
    })
  ).toMatchObject({ row: { customerPartRevision: "D" } });
});

it("only maps parts", () => {
  expect(
    classify({
      readableId: "BAR-6061",
      customerId: "cus-1",
      customerPartId: "X"
    })
  ).toEqual({
    action: "error",
    reason: "Item BAR-6061 rev 0 is a Material; this import takes Part items"
  });
});

it("needs a customer and a customer part number", () => {
  expect(classify({ readableId: "HSG-40", customerPartId: "X" })).toEqual({
    action: "error",
    reason: "Missing required Customer"
  });
  expect(
    classify({ readableId: "HSG-40", customerId: "cus-1", customerPartId: " " })
  ).toEqual({
    action: "error",
    reason: "Missing required Customer Part Number"
  });
});

it("refuses a second row for the same customer and part", () => {
  expect(
    classify(
      { readableId: "HSG-40", customerId: "cus-1", customerPartId: "X" },
      new Set([customerPartKey("cus-1", "part-1")])
    )
  ).toEqual({
    action: "error",
    reason:
      "Duplicate customer part number for HSG-40 rev 0 and this customer in file"
  });
  expect(
    classify(
      { readableId: "HSG-40", customerId: "cus-2", customerPartId: "X" },
      new Set([customerPartKey("cus-1", "part-1")])
    )
  ).toMatchObject({ action: "upsert" });
});
