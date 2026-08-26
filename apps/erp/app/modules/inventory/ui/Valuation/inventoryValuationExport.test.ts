import { describe, expect, it } from "vitest";
import { serializeCsv } from "../../../accounting/ui/Reports/exportReport";
import { buildInventoryValuationExportRows } from "./inventoryValuationExport";

describe("buildInventoryValuationExportRows", () => {
  it("exports every loaded valuation row with the active filters", () => {
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

    expect(rows).toEqual([
      {
        "As Of Date": "2026-05-31",
        "Group By": "location",
        "Location Filter": "All Locations",
        "Location ID": "loc-1",
        Location: "Main",
        "Item ID": "item-1",
        Item: "PART-001/A",
        "Item Name": "Widget",
        "Item Type": "Part",
        "Costing Method": "Standard",
        "Qty On Hand": 12,
        "Qty On Hold": 2,
        "Qty Rejected": 1,
        "Unit of Measure": "EA",
        "Unit Cost": 4.5,
        "Total Value": 54
      },
      {
        "As Of Date": "2026-05-31",
        "Group By": "location",
        "Location Filter": "All Locations",
        "Location ID": "loc-2",
        Location: "Overflow",
        "Item ID": "item-2",
        Item: "MAT-002",
        "Item Name": "Resin",
        "Item Type": "Material",
        "Costing Method": "Average",
        "Qty On Hand": 3,
        "Qty On Hold": 0,
        "Qty Rejected": 0,
        "Unit of Measure": "KG",
        "Unit Cost": 7,
        "Total Value": 21
      }
    ]);
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

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      "Group By": "item",
      "Location Filter": "Main",
      "Location ID": "loc-1",
      "Item ID": "item-1"
    });
  });

  it("preserves unsigned numeric-looking item identifiers as text", () => {
    const rows = buildInventoryValuationExportRows({
      rows: [
        {
          locationId: "loc-1",
          locationName: "Main",
          itemId: "00123",
          readableIdWithRevision: "0007",
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

    expect(serializeCsv(rows)).toContain(",'00123,'0007,");
  });
});
