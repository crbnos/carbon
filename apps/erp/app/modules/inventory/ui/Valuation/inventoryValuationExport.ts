import { csvIdentifier } from "../../../accounting/ui/Reports/exportReport";
import type { InventoryValuationRow } from "../../types";

export type InventoryValuationGroupRow = {
  kind: "group";
  id: string;
  label: string;
  item?: Pick<
    InventoryValuationRow,
    "itemId" | "readableIdWithRevision" | "name" | "thumbnailPath" | "type"
  >;
  quantityOnHand: number;
  quantityOnHold: number;
  quantityRejected: number;
  totalValue: number;
  pctOfTotal: number;
};

export type InventoryValuationDetailRow = {
  kind: "detail";
  rowId: string;
  groupId: string;
  groupLabel: string;
  pctOfTotal: number;
} & InventoryValuationRow;

export type InventoryValuationReportRow =
  | InventoryValuationGroupRow
  | InventoryValuationDetailRow;

export type InventoryValuationReportModel = {
  grandTotal: number;
  groups: InventoryValuationGroupRow[];
  childrenByGroup: Record<string, InventoryValuationRow[]>;
  rows: InventoryValuationReportRow[];
};

type InventoryValuationReportArgs = {
  rows: InventoryValuationRow[];
  groupBy: "location" | "item";
  totalLabel: string;
};

export function buildInventoryValuationReportModel({
  rows,
  groupBy,
  totalLabel
}: InventoryValuationReportArgs): InventoryValuationReportModel {
  const grandTotal = rows.reduce((acc, row) => acc + Number(row.totalValue), 0);
  const byGroup = new Map<
    string,
    { label: string; children: InventoryValuationRow[] }
  >();

  for (const row of rows) {
    const key = groupBy === "location" ? row.locationId : row.itemId;
    const label =
      groupBy === "location"
        ? row.locationName
        : `${row.readableIdWithRevision} · ${row.name}`;
    const group = byGroup.get(key) ?? { label, children: [] };
    group.children.push(row);
    byGroup.set(key, group);
  }

  const sorted = [...byGroup.entries()].sort(([, a], [, b]) =>
    a.label.localeCompare(b.label)
  );
  const groups = sorted.map(([id, { label, children }]) => ({
    kind: "group" as const,
    id,
    label,
    item:
      groupBy === "item" && children[0]
        ? {
            itemId: children[0].itemId,
            readableIdWithRevision: children[0].readableIdWithRevision,
            name: children[0].name,
            thumbnailPath: children[0].thumbnailPath,
            type: children[0].type
          }
        : undefined,
    quantityOnHand: children.reduce(
      (sum, child) => sum + Number(child.quantityOnHand),
      0
    ),
    quantityOnHold: children.reduce(
      (sum, child) => sum + Number(child.quantityOnHold),
      0
    ),
    quantityRejected: children.reduce(
      (sum, child) => sum + Number(child.quantityRejected),
      0
    ),
    totalValue: children.reduce(
      (sum, child) => sum + Number(child.totalValue),
      0
    ),
    pctOfTotal:
      grandTotal === 0
        ? 0
        : children.reduce((sum, child) => sum + Number(child.totalValue), 0) /
          grandTotal
  }));

  const childrenByGroup: Record<string, InventoryValuationRow[]> = {};
  const reportRows: InventoryValuationReportRow[] = [];
  for (const [id, { children }] of sorted) {
    childrenByGroup[id] = children;
    const group = groups.find((candidate) => candidate.id === id);
    if (!group) continue;
    reportRows.push(group);
    for (const row of children) {
      reportRows.push({
        kind: "detail",
        rowId: `${row.locationId}:${row.itemId}`,
        groupId: id,
        groupLabel: group.label,
        pctOfTotal: grandTotal === 0 ? 0 : Number(row.totalValue) / grandTotal,
        ...row
      });
    }
  }

  if (groups.length > 0) {
    reportRows.push({
      kind: "group",
      id: "grand-total",
      label: totalLabel,
      quantityOnHand: groups.reduce(
        (sum, group) => sum + group.quantityOnHand,
        0
      ),
      quantityOnHold: groups.reduce(
        (sum, group) => sum + group.quantityOnHold,
        0
      ),
      quantityRejected: groups.reduce(
        (sum, group) => sum + group.quantityRejected,
        0
      ),
      totalValue: grandTotal,
      pctOfTotal: grandTotal === 0 ? 0 : 1
    });
  }

  return { grandTotal, groups, childrenByGroup, rows: reportRows };
}

export type InventoryValuationExportLabels = {
  asOfDate: string;
  groupBy: string;
  locationFilter: string;
  rowType: string;
  group: string;
  locationId: string;
  location: string;
  itemId: string;
  item: string;
  itemName: string;
  itemType: string;
  costingMethod: string;
  qtyOnHand: string;
  qtyOnHold: string;
  qtyRejected: string;
  unitOfMeasure: string;
  unitCost: string;
  totalValue: string;
  pctOfTotal: string;
  allLocations: string;
  groupRow: string;
  detailRow: string;
  grandTotalRow: string;
  locationGroupBy: string;
  itemGroupBy: string;
};

const defaultLabels: InventoryValuationExportLabels = {
  asOfDate: "As Of Date",
  groupBy: "Group By",
  locationFilter: "Location Filter",
  rowType: "Row Type",
  group: "Group",
  locationId: "Location ID",
  location: "Location",
  itemId: "Item ID",
  item: "Item",
  itemName: "Item Name",
  itemType: "Item Type",
  costingMethod: "Costing Method",
  qtyOnHand: "Qty On Hand",
  qtyOnHold: "Qty On Hold",
  qtyRejected: "Qty Rejected",
  unitOfMeasure: "Unit of Measure",
  unitCost: "Unit Cost",
  totalValue: "Total Value",
  pctOfTotal: "% of Total",
  allLocations: "All Locations",
  groupRow: "Group",
  detailRow: "Detail",
  grandTotalRow: "Grand Total",
  locationGroupBy: "location",
  itemGroupBy: "item"
};

type InventoryValuationExportArgs = Omit<
  InventoryValuationReportArgs,
  "totalLabel"
> & {
  asOfDate: string;
  locationId: string | null;
  locationName: string | null;
  totalLabel?: string;
  labels?: Partial<InventoryValuationExportLabels>;
};

export function buildInventoryValuationExportRows({
  rows,
  asOfDate,
  groupBy,
  locationId,
  locationName,
  totalLabel = "Total",
  labels: labelOverrides
}: InventoryValuationExportArgs): Record<string, unknown>[] {
  const labels = { ...defaultLabels, ...labelOverrides };
  const model = buildInventoryValuationReportModel({
    rows,
    groupBy,
    totalLabel
  });
  const groupByLabel =
    groupBy === "location" ? labels.locationGroupBy : labels.itemGroupBy;

  return model.rows.map((row) => {
    const isGroup = row.kind === "group";
    const isGrandTotal = isGroup && row.id === "grand-total";
    const item = isGroup ? row.item : row;
    const isLocationGroup = isGroup && groupBy === "location" && !isGrandTotal;
    const isItemGroup = isGroup && groupBy === "item" && !isGrandTotal;

    return {
      [labels.asOfDate]: asOfDate,
      [labels.groupBy]: groupByLabel,
      [labels.locationFilter]: locationId
        ? (locationName ?? locationId)
        : labels.allLocations,
      [labels.rowType]: isGrandTotal
        ? labels.grandTotalRow
        : isGroup
          ? labels.groupRow
          : labels.detailRow,
      [labels.group]: isGroup ? row.label : row.groupLabel,
      [labels.locationId]: isLocationGroup
        ? csvIdentifier(row.id)
        : row.kind === "detail"
          ? csvIdentifier(row.locationId)
          : "",
      [labels.location]: isLocationGroup
        ? row.label
        : row.kind === "detail"
          ? row.locationName
          : "",
      [labels.itemId]: isItemGroup
        ? csvIdentifier(row.id)
        : item
          ? csvIdentifier(item.itemId)
          : "",
      [labels.item]: item ? csvIdentifier(item.readableIdWithRevision) : "",
      [labels.itemName]: item?.name ?? "",
      [labels.itemType]: item?.type ?? "",
      [labels.costingMethod]: row.kind === "detail" ? row.costingMethod : "",
      [labels.qtyOnHand]: row.quantityOnHand,
      [labels.qtyOnHold]: row.quantityOnHold,
      [labels.qtyRejected]: row.quantityRejected,
      [labels.unitOfMeasure]:
        row.kind === "detail" ? row.unitOfMeasureCode : "",
      [labels.unitCost]: row.kind === "detail" ? row.unitCost : "",
      [labels.totalValue]: row.totalValue,
      [labels.pctOfTotal]: row.pctOfTotal
    };
  });
}
