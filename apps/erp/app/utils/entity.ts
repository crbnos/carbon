import { path } from "~/utils/path";

/**
 * The one table mapping a record to the page that shows it, keyed by catalog entity
 * name. Callers arrive with either an entity name (notifications, workflow runs) or
 * only an id (the audit log), so both questions resolve through here — two tables
 * would drift, and the one that drifts is always the one you are not looking at.
 *
 * An entity with no single page of its own is simply absent, and that is a `null`.
 *
 * Not to be confused with `getItemDetailPath` in `path.ts`: that answers a different
 * question — which of the five item routes an item's *type* belongs to.
 */
const RECORD_ROUTES: Record<string, (id: string) => string> = {
  changeNotice: path.to.changeNotice,
  customer: path.to.customer,
  employee: path.to.employeeAccount,
  gauge: path.to.gauge,
  inventoryCount: path.to.inventoryCount,
  item: path.to.part,
  job: path.to.job,
  location: path.to.location,
  maintenanceDispatch: path.to.maintenanceDispatch,
  nonConformance: path.to.issue,
  purchaseInvoice: path.to.purchaseInvoice,
  purchaseOrder: path.to.purchaseOrder,
  quote: path.to.quote,
  receipt: path.to.receipt,
  salesInvoice: path.to.salesInvoice,
  salesOrder: path.to.salesOrder,
  shipment: path.to.shipment,
  supplier: path.to.supplier,
  supplierQuote: path.to.supplierQuote,
  workCenter: path.to.workCenter
};

/** The `id('prefix')` a table's SQL default mints, mapped to its entity name. */
const ENTITY_BY_ID_PREFIX: Record<string, string> = {
  co: "changeNotice",
  cust: "customer",
  emp: "employee",
  g: "gauge",
  ic: "inventoryCount",
  item: "item",
  job: "job",
  main: "maintenanceDispatch",
  nc: "nonConformance",
  pi: "purchaseInvoice",
  po: "purchaseOrder",
  quote: "quote",
  rec: "receipt",
  sh: "shipment",
  si: "salesInvoice",
  so: "salesOrder",
  sq: "supplierQuote",
  sup: "supplier",
  wc: "workCenter"
};

/** The page for a record named by its catalog entity. */
export function getRecordPath(
  entity: string | null | undefined,
  id: string
): string | null {
  const route =
    entity === null || entity === undefined ? undefined : RECORD_ROUTES[entity];
  return route ? route(id) : null;
}

/** The page for a record known only by its id, read off the id's own prefix. */
export function getEntityPath(entityId: string): string | null {
  const prefix = entityId.split("_")[0];
  if (!prefix || prefix === entityId) return null;
  return getRecordPath(ENTITY_BY_ID_PREFIX[prefix], entityId);
}
