// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { describe, expect, it } from "vitest";
import { getLineDescription, getLineSupplierPartId } from "./purchase-order";

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

  it("falls back to the supplier part number when the line has no item", () => {
    expect(
      getLineDescription(
        line({ itemReadableId: null, supplierPartId: "SUP-778" })
      )
    ).toBe("SUP-778");
  });
});

describe("getLineSupplierPartId", () => {
  it("prefers the line's supplier part number over the supplier part record's", () => {
    expect(
      getLineSupplierPartId(
        line({
          supplierPartId: "SUP-778",
          supplierPartIdFromSupplier: "SUP-001"
        })
      )
    ).toBe("SUP-778");
  });

  it("uses the supplier part record when the line's number is blank", () => {
    for (const supplierPartId of ["", "  ", null]) {
      expect(
        getLineSupplierPartId(
          line({ supplierPartId, supplierPartIdFromSupplier: "SUP-001" })
        )
      ).toBe("SUP-001");
    }
  });

  // The item id already prints on the line, so repeating it adds nothing.
  it("returns null when there is no number or it repeats the item id", () => {
    expect(getLineSupplierPartId(line({ supplierPartId: "  " }))).toBeNull();
    expect(
      getLineSupplierPartId(
        line({ itemReadableId: "P000123.B", supplierPartId: "P000123.B" })
      )
    ).toBeNull();
  });

  it("trims the number before it returns or compares it", () => {
    expect(getLineSupplierPartId(line({ supplierPartId: "  SUP-778  " }))).toBe(
      "SUP-778"
    );
    expect(
      getLineSupplierPartId(
        line({ itemReadableId: "P000123.B", supplierPartId: " P000123.B " })
      )
    ).toBeNull();
  });

  // A Service line's PDF row prints its description, not its item id.
  it("compares with the identifier the caller says the line shows", () => {
    const service = line({
      purchaseOrderLineType: "Service",
      itemReadableId: "Anodizing",
      description: "Black anodize, Type II",
      supplierPartId: "Anodizing"
    });
    expect(getLineSupplierPartId(service, service.description)).toBe(
      "Anodizing"
    );
    expect(getLineSupplierPartId(service, " Anodizing ")).toBeNull();
  });
});
