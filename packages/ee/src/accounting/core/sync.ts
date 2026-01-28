import { BillSyncer } from "../providers/xero/entities/bill";
import { ContactSyncer } from "../providers/xero/entities/contact";
import { InventoryAdjustmentSyncer } from "../providers/xero/entities/inventory-adjustment";
import { SalesInvoiceSyncer } from "../providers/xero/entities/invoice";
import { ItemSyncer } from "../providers/xero/entities/item";
import { PurchaseOrderSyncer } from "../providers/xero/entities/purchase-order";
import { SalesOrderSyncer } from "../providers/xero/entities/sales-order";
import type { IEntitySyncer, SyncContext } from "./types";

export const SyncFactory = {
  /**
   * Instantiates the correct Syncer class based on the Entity Type from context.
   * @param context - The execution context (DB connection, Provider, Config, entityType)
   */
  getSyncer(context: SyncContext): IEntitySyncer {
    switch (context.entityType) {
      // Master Data
      case "vendor":
      case "customer":
        return new ContactSyncer(context);
      case "item":
        return new ItemSyncer(context);

      // Transaction Data
      case "bill":
        return new BillSyncer(context);
      case "invoice":
        return new SalesInvoiceSyncer(context);
      case "purchaseOrder":
        return new PurchaseOrderSyncer(context);

      case "inventoryAdjustment":
        return new InventoryAdjustmentSyncer(context);

      case "salesOrder":
        return new SalesOrderSyncer(context);

      // Not yet implemented
      // case "employee":
      //   Xero no longer supports the Employees API
      // case "payment":
      //   return new PaymentSyncer(context);

      default:
        throw new Error(
          `No Syncer implementation found for entity type: ${context.entityType}`
        );
    }
  }
};
