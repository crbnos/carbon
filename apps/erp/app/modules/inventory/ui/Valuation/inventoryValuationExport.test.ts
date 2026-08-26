import { describe, expect, it } from "vitest";
import {
  csvIdentifier,
  serializeCsv
} from "../../../accounting/ui/Reports/exportReport";
import {
  buildInventoryValuationExportRows,
  buildInventoryValuationReportModel
} from "./inventoryValuationExport";

describe("buildInventoryValuationReportModel", () => {
  it("derives grouped rows, all details, and a grand total", () => {
    const model = buildInventoryValuationReportModel({
      rows: [
        {
          locationId: "loc-1",
          locationName: "Main",
          itemId: "item-1",
          readableIdWithRevision: "PART-001/A",
          name: "Widget",
          thumbnailPath: "",
          type: "Part",
          costingMethod: "Standard",
          replenishmentSystem: "Make",
          quantityOnHand: 12,
          quantityOnHold: 2,
          quantityRejected: 1,
          unitOfMeasureCode: "EA",
          unitCost: 4.5,
          totalValue: 54
        }
      ],
      groupBy: "location",
      totalLabel: "Total"
    });

    expect(model.rows.map((row) => row.kind)).toEqual([
      "group",
      "detail",
      "group"
    ]);
    expect(model.rows[0]).toMatchObject({
      kind: "group",
      label: "Main",
      totalValue: 54,
      pctOfTotal: 1
    });
    expect(model.rows[1]).toMatchObject({
      kind: "detail",
      groupLabel: "Main",
      totalValue: 54,
      pctOfTotal: 1
    });
    expect(model.rows[2]).toMatchObject({
      kind: "group",
      id: "grand-total",
      label: "Total",
      totalValue: 54,
      pctOfTotal: 1
    });
  });
});

describe("buildInventoryValuationExportRows", () => {
  it("exports grouped rows, every loaded detail row, and the grand total with active filters", () => {
    const rows = buildInventoryValuationExportRows({
      rows: [
        {
          locationId: "loc-1",
          locationName: "Main",
          itemId: "item-1",
          readableIdWithRevision: "PART-001/A",
          name: "Widget",
          thumbnailPath: "",
          type: "Part",
          costingMethod: "Standard",
          replenishmentSystem: "Make",
          quantityOnHand: 12,
          quantityOnHold: 2,
          quantityRejected: 1,
          unitOfMeasureCode: "EA",
          unitCost: 4.5,
          totalValue: 54
        },
        {
          locationId: "loc-2",
          locationName: "Overflow",
          itemId: "item-2",
          readableIdWithRevision: "MAT-002",
          name: "Resin",
          thumbnailPath: "/thumb.png",
          type: "Material",
          costingMethod: "Average",
          replenishmentSystem: "Buy",
          quantityOnHand: 3,
          quantityOnHold: 0,
          quantityRejected: 0,
          unitOfMeasureCode: "KG",
          unitCost: 7,
          totalValue: 21
        }
      ],
      asOfDate: "2026-05-31",
      groupBy: "location",
      locationId: null,
      locationName: null
    });

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row["Row Type"])).toEqual([
      "Group",
      "Detail",
      "Group",
      "Detail",
      "Grand Total"
    ]);
    expect(rows[0]).toMatchObject({
      "As Of Date": "2026-05-31",
      "Group By": "location",
      "Location Filter": "All Locations",
      Group: "Main",
      "Location ID": csvIdentifier("loc-1"),
      "Qty On Hand": 12,
      "Total Value": 54,
      "% of Total": 0.72
    });
    expect(rows[1]).toMatchObject({
      "Row Type": "Detail",
      Group: "Main",
      "Item ID": csvIdentifier("item-1"),
      "Total Value": 54,
      "% of Total": 0.72
    });
    expect(rows[4]).toMatchObject({
      "Row Type": "Grand Total",
      Group: "Total",
      "Qty On Hand": 15,
      "Total Value": 75,
      "% of Total": 1
    });
  });

  it("labels a selected location filter without filtering loaded source rows", () => {
    const rows = buildInventoryValuationExportRows({
      rows: [
        {
          locationId: "loc-1",
          locationName: "Main",
          itemId: "item-1",
          readableIdWithRevision: "PART-001/A",
          name: "Widget",
          thumbnailPath: "",
          type: "Part",
          costingMethod: "Standard",
          replenishmentSystem: "Make",
          quantityOnHand: 12,
          quantityOnHold: 2,
          quantityRejected: 1,
          unitOfMeasureCode: "EA",
          unitCost: 4.5,
          totalValue: 54
        }
      ],
      asOfDate: "2026-05-31",
      groupBy: "item",
      locationId: "loc-1",
      locationName: "Main"
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      "Row Type": "Group",
      "Group By": "item",
      "Location Filter": "Main",
      Group: "PART-001/A · Widget",
      "Item ID": csvIdentifier("item-1"),
      "% of Total": 1
    });
    expect(rows[1]).toMatchObject({
      "Row Type": "Detail",
      Group: "PART-001/A · Widget",
      "Location ID": csvIdentifier("loc-1")
    });
    expect(rows[2]).toMatchObject({
      "Row Type": "Grand Total",
      Group: "Total",
      "% of Total": 1
    });
  });

  it("preserves exponent-like and date-like item identifiers as text", () => {
    const rows = buildInventoryValuationExportRows({
      rows: [
        {
          locationId: "01-02",
          locationName: "Main",
          itemId: "1E10",
          readableIdWithRevision: "01-02",
          name: "Widget",
          thumbnailPath: "",
          type: "Part",
          costingMethod: "Standard",
          replenishmentSystem: "Make",
          quantityOnHand: 12,
          quantityOnHold: 2,
          quantityRejected: 1,
          unitOfMeasureCode: "EA",
          unitCost: 4.5,
          totalValue: 54
        }
      ],
      asOfDate: "2026-05-31",
      groupBy: "item",
      locationId: null,
      locationName: null
    });

    expect(serializeCsv(rows)).toContain(",'01-02,Main,'1E10,'01-02,");
  });

  it("uses supplied localized headers and row labels", () => {
    const rows = buildInventoryValuationExportRows({
      rows: [
        {
          locationId: "loc-1",
          locationName: "Main",
          itemId: "item-1",
          readableIdWithRevision: "PART-001",
          name: "Widget",
          thumbnailPath: "",
          type: "Part",
          costingMethod: "Standard",
          replenishmentSystem: "Make",
          quantityOnHand: 1,
          quantityOnHold: 0,
          quantityRejected: 0,
          unitOfMeasureCode: "EA",
          unitCost: 2,
          totalValue: 2
        }
      ],
      asOfDate: "2026-05-31",
      groupBy: "location",
      locationId: null,
      locationName: null,
      labels: {
        asOfDate: "日期",
        rowType: "行类型",
        group: "分组",
        pctOfTotal: "占比",
        locationGroupBy: "按地点"
      }
    });

    expect(rows[0]).toHaveProperty("日期", "2026-05-31");
    expect(rows[0]).toHaveProperty("行类型", "Group");
    expect(rows[0]).toHaveProperty("分组", "Main");
    expect(rows[0]).toHaveProperty("占比", 1);
    expect(rows[0]).toHaveProperty("Group By", "按地点");

    const itemGroupRows = buildInventoryValuationExportRows({
      rows: [
        {
          locationId: "loc-1",
          locationName: "Main",
          itemId: "item-1",
          readableIdWithRevision: "PART-001",
          name: "Widget",
          thumbnailPath: "",
          type: "Part",
          costingMethod: "Standard",
          replenishmentSystem: "Make",
          quantityOnHand: 1,
          quantityOnHold: 0,
          quantityRejected: 0,
          unitOfMeasureCode: "EA",
          unitCost: 2,
          totalValue: 2
        }
      ],
      asOfDate: "2026-05-31",
      groupBy: "item",
      locationId: null,
      locationName: null,
      labels: { itemGroupBy: "按物料" }
    });

    expect(itemGroupRows[0]).toHaveProperty("Group By", "按物料");
  });
});
