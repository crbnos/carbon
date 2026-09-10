import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/**
 * Product areas for backup surfaces.
 *
 * One vocabulary, two consumers: the "what's in a backup" popover
 * (`api+/settings.backup-summary.ts` + `BackupContentsInfo`) and the
 * pre-restore disclosure screen. The disclosure groups findings by area rather
 * than by table, because "Production" means something to the person deciding
 * and `jobOperationDependency` does not.
 *
 * Areas are stable KEYS; copy lives in `AREA_LABELS` as `msg` descriptors
 * resolved client-side with `t(...)` — the summary API returns keys and
 * counts only, so no English crosses the wire.
 */

export type BackupArea =
  | "sales"
  | "purchasing"
  | "items"
  | "production"
  | "inventory"
  | "accounting"
  | "quality"
  | "people"
  | "other";

export type Scope = "company" | "group";

/**
 * `scope` is the column rows are counted by: "company" (companyId, the
 * default) or "group" (companyGroupId — the shared chart of accounts /
 * currencies / dimensions).
 */
export type Entity = [label: MessageDescriptor, table: string, scope?: Scope];

export const AREA_LABELS: Record<BackupArea, MessageDescriptor> = {
  sales: msg`Sales`,
  purchasing: msg`Purchasing`,
  items: msg`Items`,
  production: msg`Production`,
  inventory: msg`Inventory`,
  accounting: msg`Accounting`,
  quality: msg`Quality`,
  people: msg`People`,
  other: msg`Other`
};

/** The label for an area key; unknown keys read as "Other". */
export function areaLabel(area: string): MessageDescriptor {
  return AREA_LABELS[area as BackupArea] ?? AREA_LABELS.other;
}

/**
 * Recognizable entities a backup carries, grouped for the popover. Not
 * exhaustive — the export covers every scoped table, these are the meaningful
 * headline counts.
 */
export const BACKUP_SUMMARY_GROUPS: {
  area: BackupArea;
  entities: Entity[];
}[] = [
  {
    area: "sales",
    entities: [
      [msg`Customers`, "customer"],
      [msg`Quotes`, "quote"],
      [msg`Sales orders`, "salesOrder"],
      [msg`Sales invoices`, "salesInvoice"],
      [msg`Shipments`, "shipment"]
    ]
  },
  {
    area: "purchasing",
    entities: [
      [msg`Suppliers`, "supplier"],
      [msg`Purchase orders`, "purchaseOrder"],
      [msg`Purchase invoices`, "purchaseInvoice"],
      [msg`Receipts`, "receipt"]
    ]
  },
  {
    area: "items",
    entities: [
      [msg`Parts`, "part"],
      [msg`Materials`, "material"],
      [msg`Tools`, "tool"]
    ]
  },
  {
    area: "production",
    entities: [
      [msg`Jobs`, "job"],
      [msg`Work centers`, "workCenter"],
      [msg`Processes`, "process"]
    ]
  },
  {
    area: "accounting",
    entities: [
      [msg`Accounts`, "account", "group"],
      [msg`Currencies`, "currency", "group"],
      [msg`Dimensions`, "dimension", "group"],
      [msg`Journal lines`, "journalLine"],
      [msg`Item ledger`, "itemLedger"],
      [msg`Cost ledger`, "costLedger"]
    ]
  },
  {
    area: "quality",
    entities: [
      [msg`Non-conformances`, "nonConformance"],
      [msg`Gauges`, "gauge"]
    ]
  },
  { area: "people", entities: [[msg`Employees`, "employee"]] }
];

/** Every table named by the groups above, plus the child tables a compatibility
 *  finding is likely to name. Deliberately NOT exhaustive over the ~400 scoped
 *  tables — see `tableArea`. */
const TABLE_AREAS: Record<string, BackupArea> = {
  ...Object.fromEntries(
    BACKUP_SUMMARY_GROUPS.flatMap((g) =>
      g.entities.map(([, table]) => [table, g.area])
    )
  ),

  quoteLine: "sales",
  salesOrderLine: "sales",
  salesInvoiceLine: "sales",
  shipmentLine: "sales",
  customerContact: "sales",
  customerLocation: "sales",
  opportunity: "sales",

  purchaseOrderLine: "purchasing",
  purchaseInvoiceLine: "purchasing",
  receiptLine: "purchasing",
  supplierContact: "purchasing",
  supplierLocation: "purchasing",
  supplierPart: "purchasing",

  item: "items",
  itemReplenishment: "items",
  itemPlanning: "items",
  itemCost: "items",
  itemUnitSalePrice: "items",
  makeMethod: "items",
  methodMaterial: "items",
  methodOperation: "items",
  consumable: "items",
  service: "items",
  pickMethod: "items",

  jobOperation: "production",
  jobOperationDependency: "production",
  jobMakeMethod: "production",
  jobMaterial: "production",
  productionEvent: "production",
  productionQuantity: "production",
  rework: "production",
  workCenterProcess: "production",

  // Inventory — its own area, not in the popover's headline list.
  // `itemLedger` is deliberately absent: the popover already files it under
  // Accounting, and one name in two places is worse than an imperfect name.
  location: "inventory",
  shelf: "inventory",
  trackedEntity: "inventory",
  kanban: "inventory",
  warehouseTransfer: "inventory",

  accountDefault: "accounting",
  journal: "accounting",
  supplierLedger: "accounting",
  fixedAsset: "accounting",
  period: "accounting",
  paymentTerm: "accounting",

  nonConformanceJobOperation: "quality",
  inspection: "quality",
  qualityDocument: "quality",

  employeeJob: "people",
  ability: "people"
};

/**
 * The product area a table belongs to, for user-facing copy.
 *
 * Returns `"other"` for anything unmapped — the honest answer rather than a
 * failure: hand-mapping all ~400 tenant-scoped tables would be stale within a
 * release, and a finding in "Other" still shows its exact table name in the
 * details expander. Widen the map when a real finding lands there often enough
 * to matter.
 */
export function tableArea(table: string): BackupArea {
  return TABLE_AREAS[table] ?? "other";
}
