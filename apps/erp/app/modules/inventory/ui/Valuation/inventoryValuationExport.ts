import { csvIdentifier } from "../../../accounting/ui/Reports/exportReport";
import type { InventoryValuationRow } from "../../types";

type InventoryValuationExportArgs = {
  rows: InventoryValuationRow[];
  asOfDate: string;
  groupBy: "location" | "item";
  locationId: string | null;
  locationName: string | null;
};

export function buildInventoryValuationExportRows({
  rows,
  asOfDate,
  groupBy,
  locationId,
  locationName
}: InventoryValuationExportArgs): Record<string, unknown>[] {
  return rows.map((row) => ({
    "As Of Date": asOfDate,
    "Group By": groupBy,
    "Location Filter": locationId
      ? (locationName ?? locationId)
      : "All Locations",
    "Location ID": csvIdentifier(row.locationId),
    Location: row.locationName,
    "Item ID": csvIdentifier(row.itemId),
    Item: csvIdentifier(row.readableIdWithRevision),
    "Item Name": row.name,
    "Item Type": row.type,
    "Costing Method": row.costingMethod,
    "Qty On Hand": row.quantityOnHand,
    "Qty On Hold": row.quantityOnHold,
    "Qty Rejected": row.quantityRejected,
    "Unit of Measure": row.unitOfMeasureCode,
    "Unit Cost": row.unitCost,
    "Total Value": row.totalValue
  }));
}
