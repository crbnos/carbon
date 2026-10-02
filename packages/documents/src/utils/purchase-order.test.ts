// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { describe, expect, it } from "vitest";
import {
  getLineDescription,
  getPurchaseOrderDisplayId
} from "./purchase-order";

type Line = Database["public"]["Views"]["purchaseOrderLines"]["Row"];
const line = (overrides: Partial<Line>) =>
  ({ purchaseOrderLineType: "Part", ...overrides }) as Line;

// `itemReadableId` is the view's `readableIdWithRevision`, so it is the only
// place the revision reaches the document.
describe("getLineDescription", () => {
  it("shows the item id on its own when there is no supplier part number", () => {
    expect(getLineDescription(line({ itemReadableId: "P000123.B" }))).toBe(
      "P000123.B"
    );
    expect(
      getLineDescription(
        line({ itemReadableId: "P000123.B", supplierPartId: "" })
      )
    ).toBe("P000123.B");
  });

  it("keeps the item id and revision next to the supplier part number", () => {
    expect(
      getLineDescription(
        line({ itemReadableId: "P000123.B", supplierPartId: "SUP-778" })
      )
    ).toBe("P000123.B (SUP-778)");
    expect(
      getLineDescription(
        line({
          itemReadableId: "P000123.B",
          supplierPartId: "",
          supplierPartIdFromSupplier: "SUP-778"
        })
      )
    ).toBe("P000123.B (SUP-778)");
  });

  it("does not repeat a supplier part number that equals the item id", () => {
    expect(
      getLineDescription(
        line({ itemReadableId: "P000123.B", supplierPartId: "P000123.B" })
      )
    ).toBe("P000123.B");
  });

  it("falls back to the supplier part number when the line has no item", () => {
    expect(
      getLineDescription(
        line({ itemReadableId: null, supplierPartId: "SUP-778" })
      )
    ).toBe("SUP-778");
  });
});

// Suffix rules live in revision.test.ts; this pins field mapping only.
describe("getPurchaseOrderDisplayId", () => {
  it("reads purchaseOrderId and revisionId off the order", () => {
    expect(
      getPurchaseOrderDisplayId({ purchaseOrderId: "PO-001042", revisionId: 0 })
    ).toBe("PO-001042");
    expect(
      getPurchaseOrderDisplayId({ purchaseOrderId: "PO-001042", revisionId: 2 })
    ).toBe("PO-001042-2");
  });

  it("returns an empty string for a missing order", () => {
    expect(getPurchaseOrderDisplayId(undefined)).toBe("");
    expect(getPurchaseOrderDisplayId(null)).toBe("");
  });
});
