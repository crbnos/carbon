// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  columnsDiffer,
  columnsForTable,
  isPresetNavigation,
  parseRememberedTableState,
  queryToRemember,
  type RememberedTableState,
  rememberedQuery,
  tableStateKey
} from "./rememberedState";

const defaults = {
  columnVisibility: { supplierId: false },
  columnOrder: ["invoiceId", "supplierId"],
  columnPinning: { left: ["invoiceId"], right: [] }
};

const remembered: RememberedTableState = {
  columnVisibility: { supplierId: true },
  columnOrder: ["supplierId", "invoiceId"],
  columnPinning: { left: ["supplierId"], right: [] },
  filters: ["status:eq:Draft"],
  sorts: ["invoiceId:desc"]
};

describe("remembered table state", () => {
  it("uses a selected view before local columns and local columns before defaults", () => {
    const view = {
      columnVisibility: { supplierId: false, datePaid: true },
      columnOrder: ["datePaid", "invoiceId"],
      columnPinning: { left: ["datePaid"], right: [] }
    };
    expect(columnsForTable(view, remembered, defaults)).toEqual(view);
    expect(columnsForTable(null, remembered, defaults)).toEqual(remembered);
    expect(columnsForTable(null, null, defaults)).toEqual(defaults);
  });

  it("uses the current table order when older storage has no explicit order", () => {
    expect(
      columnsForTable(null, { ...remembered, columnOrder: [] }, defaults)
        .columnOrder
    ).toEqual(defaults.columnOrder);
  });

  it("applies new default-hidden columns without losing an explicit user choice", () => {
    expect(
      columnsForTable(null, remembered, {
        ...defaults,
        columnVisibility: { supplierId: false, newColumn: false }
      }).columnVisibility
    ).toEqual({ supplierId: true, newColumn: false });
  });

  it("restores missing query values while keeping explicit URL filters", () => {
    expect(
      rememberedQuery(new URLSearchParams(), remembered, false)?.toString()
    ).toBe("filter=status%3Aeq%3ADraft&sort=invoiceId%3Adesc");
    expect(
      rememberedQuery(
        new URLSearchParams("filter=status%3Aeq%3APaid"),
        remembered,
        false
      )?.toString()
    ).toBe("filter=status%3Aeq%3APaid&sort=invoiceId%3Adesc");
    expect(rememberedQuery(new URLSearchParams(), remembered, true)).toBeNull();
  });

  it("keeps the remembered query when a nav link brings its own filter", () => {
    const preset = new URLSearchParams(
      "filter=inspectionStatus%3Ain%3AInspection+Failed"
    );
    expect(isPresetNavigation(preset, true)).toBe(true);
    expect(queryToRemember(preset, remembered, true)).toEqual({
      filters: ["status:eq:Draft"],
      sorts: ["invoiceId:desc"]
    });
    expect(queryToRemember(preset, null, true)).toEqual({
      filters: [],
      sorts: []
    });
  });

  it("remembers the URL query for a bare link or the user's own change", () => {
    const changed = new URLSearchParams("filter=status%3Aeq%3APaid");
    expect(isPresetNavigation(new URLSearchParams(), true)).toBe(false);
    expect(isPresetNavigation(changed, false)).toBe(false);
    expect(queryToRemember(changed, remembered, false)).toEqual({
      filters: ["status:eq:Paid"],
      sorts: []
    });
  });

  it("rejects malformed storage and treats explicit true as the visible default", () => {
    expect(parseRememberedTableState('{"filters":[42]}')).toBeNull();
    expect(parseRememberedTableState(JSON.stringify(remembered))).toEqual(
      remembered
    );
    expect(
      columnsDiffer(
        {
          ...defaults,
          columnVisibility: { supplierId: false, invoiceId: true }
        },
        defaults
      )
    ).toBe(false);
  });

  it("separates each user, company and table", () => {
    expect(tableStateKey("user-a", "company-a", "purchaseInvoice")).not.toBe(
      tableStateKey("user-a", "company-b", "purchaseInvoice")
    );
    expect(tableStateKey("user-a", "company-a", "purchaseInvoice")).not.toBe(
      tableStateKey("user-b", "company-a", "purchaseInvoice")
    );
  });
});
