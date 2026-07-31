import { path } from "~/utils/path";

/** Maps an entity id's prefix (text before the first `_`) to a route path. */
export function getEntityPath(entityId: string): string | null {
  const prefix = entityId.split("_")[0];
  if (!prefix || prefix === entityId) return null;

  const map: Record<string, (id: string) => string> = {
    pi: path.to.purchaseInvoice,
    si: path.to.salesInvoice,
    po: path.to.purchaseOrder,
    so: path.to.salesOrder,
    cust: path.to.customer,
    sup: path.to.supplier,
    item: path.to.part,
    job: path.to.job,
    quote: path.to.quote,
    emp: path.to.employeeAccount,
    nc: path.to.issue,
    co: path.to.changeNotice,
    sh: path.to.shipment,
    rec: path.to.receipt,
    ic: path.to.inventoryCount,
    g: path.to.gauge,
    sq: path.to.supplierQuote,
    wc: path.to.workCenter,
    main: path.to.maintenanceDispatch
  };
  const pathFn = map[prefix];
  return pathFn ? pathFn(entityId) : null;
}
