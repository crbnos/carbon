import { describe, expect, it } from "vitest";
import type { AccountingProvider } from "../providers";
// Importing the barrels runs their module-scope SyncFactory.register calls —
// the same side effect every runtime consumer gets via @carbon/ee/accounting.
import { qboSyncerRegistry } from "../providers/quickbooks-online";
import { QboBillSyncer } from "../providers/quickbooks-online/entities/bill";
import { QboCustomerSyncer } from "../providers/quickbooks-online/entities/customer";
import { QboSalesInvoiceSyncer } from "../providers/quickbooks-online/entities/invoice";
import { QboItemSyncer } from "../providers/quickbooks-online/entities/item";
import { QboJournalEntrySyncer } from "../providers/quickbooks-online/entities/journal-entry";
import { QboPaymentSyncer } from "../providers/quickbooks-online/entities/payment";
import { QboPurchaseOrderSyncer } from "../providers/quickbooks-online/entities/purchase-order";
import { QboVendorSyncer } from "../providers/quickbooks-online/entities/vendor";
import { rilletSyncerRegistry } from "../providers/rillet";
import { RilletBillSyncer } from "../providers/rillet/entities/bill";
import { RilletCustomerSyncer } from "../providers/rillet/entities/customer";
import { RilletSalesInvoiceSyncer } from "../providers/rillet/entities/invoice";
import { RilletItemSyncer } from "../providers/rillet/entities/item";
import { RilletJournalEntrySyncer } from "../providers/rillet/entities/journal-entry";
import { RilletPaymentSyncer } from "../providers/rillet/entities/payment";
import { RilletVendorSyncer } from "../providers/rillet/entities/vendor";
import { xeroSyncerRegistry } from "../providers/xero";
import { BillSyncer } from "../providers/xero/entities/bill";
import { ContactSyncer } from "../providers/xero/entities/contact";
import { InventoryAdjustmentSyncer } from "../providers/xero/entities/inventory-adjustment";
import { SalesInvoiceSyncer } from "../providers/xero/entities/invoice";
import { ItemSyncer } from "../providers/xero/entities/item";
import { JournalEntrySyncer } from "../providers/xero/entities/journal-entry";
import { XeroPaymentSyncer } from "../providers/xero/entities/payment";
import { PurchaseOrderSyncer } from "../providers/xero/entities/purchase-order";
import { SalesOrderSyncer } from "../providers/xero/entities/sales-order";
import { ProviderID } from "./models";
import { SyncFactory } from "./sync";
import type { AccountingEntityType, SyncContext } from "./types";

function makeContext(
  entityType: AccountingEntityType,
  providerId: string = ProviderID.XERO
): SyncContext {
  return {
    database: {} as unknown as SyncContext["database"],
    companyId: "test-company",
    provider: { id: providerId } as unknown as AccountingProvider,
    config: {
      enabled: true,
      direction: "two-way",
      owner: "carbon"
    },
    entityType
  };
}

/**
 * The exact set of syncers the pre-registry switch resolved (plus the
 * Phase B journalEntry case). Any change here is a behavior change for
 * the Xero integration.
 */
const EXPECTED_XERO_SYNCERS: Record<string, string> = {
  customer: "ContactSyncer",
  vendor: "ContactSyncer",
  item: "ItemSyncer",
  bill: "BillSyncer",
  invoice: "SalesInvoiceSyncer",
  purchaseOrder: "PurchaseOrderSyncer",
  salesOrder: "SalesOrderSyncer",
  inventoryAdjustment: "InventoryAdjustmentSyncer",
  journalEntry: "JournalEntrySyncer"
};

describe("SyncFactory", () => {
  it("resolves every supported Xero entity type to the same class as the old switch", () => {
    for (const [entityType, expectedClassName] of Object.entries(
      EXPECTED_XERO_SYNCERS
    )) {
      const syncer = SyncFactory.getSyncer(
        makeContext(entityType as AccountingEntityType)
      );
      expect(syncer.constructor.name).toBe(expectedClassName);
    }
  });

  it("constructs instances of the exact registered classes", () => {
    expect(SyncFactory.getSyncer(makeContext("customer"))).toBeInstanceOf(
      ContactSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("vendor"))).toBeInstanceOf(
      ContactSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("item"))).toBeInstanceOf(
      ItemSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("bill"))).toBeInstanceOf(
      BillSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("invoice"))).toBeInstanceOf(
      SalesInvoiceSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("purchaseOrder"))).toBeInstanceOf(
      PurchaseOrderSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("salesOrder"))).toBeInstanceOf(
      SalesOrderSyncer
    );
    expect(
      SyncFactory.getSyncer(makeContext("inventoryAdjustment"))
    ).toBeInstanceOf(InventoryAdjustmentSyncer);
    expect(SyncFactory.getSyncer(makeContext("journalEntry"))).toBeInstanceOf(
      JournalEntrySyncer
    );
  });

  it("registers exactly the expected Xero entity types", () => {
    expect(xeroSyncerRegistry).toEqual({
      customer: ContactSyncer,
      vendor: ContactSyncer,
      item: ItemSyncer,
      bill: BillSyncer,
      invoice: SalesInvoiceSyncer,
      purchaseOrder: PurchaseOrderSyncer,
      salesOrder: SalesOrderSyncer,
      inventoryAdjustment: InventoryAdjustmentSyncer,
      journalEntry: JournalEntrySyncer,
      // Phase 3: pull-only Xero payment sync-back (ACCREC → AR, ACCPAY → AP)
      payment: XeroPaymentSyncer
    });
  });

  it("resolves the Xero payment syncer (Phase 3)", () => {
    expect(SyncFactory.getSyncer(makeContext("payment"))).toBeInstanceOf(
      XeroPaymentSyncer
    );
  });

  it("throws the descriptive error for an unregistered entity type", () => {
    expect(() => SyncFactory.getSyncer(makeContext("employee"))).toThrow(
      /^No Syncer implementation found for entity type: employee$/
    );
  });

  it("throws the descriptive error for an unknown provider", () => {
    expect(() =>
      SyncFactory.getSyncer(makeContext("customer", "sage"))
    ).toThrow(/^No Syncer registry found for provider: sage$/);
  });

  it("resolves both providers side by side (customer → ContactSyncer for Xero, QboCustomerSyncer for QBO)", () => {
    expect(SyncFactory.getSyncer(makeContext("customer"))).toBeInstanceOf(
      ContactSyncer
    );
    expect(
      SyncFactory.getSyncer(makeContext("customer", ProviderID.QUICKBOOKS))
    ).toBeInstanceOf(QboCustomerSyncer);
  });

  it("registers exactly the expected QuickBooks Online entity types", () => {
    expect(qboSyncerRegistry).toEqual({
      customer: QboCustomerSyncer,
      vendor: QboVendorSyncer,
      item: QboItemSyncer,
      bill: QboBillSyncer,
      invoice: QboSalesInvoiceSyncer,
      purchaseOrder: QboPurchaseOrderSyncer,
      journalEntry: QboJournalEntrySyncer,
      payment: QboPaymentSyncer
    });
  });

  it("constructs instances of the exact registered QBO classes", () => {
    const qbo = ProviderID.QUICKBOOKS;
    expect(SyncFactory.getSyncer(makeContext("vendor", qbo))).toBeInstanceOf(
      QboVendorSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("item", qbo))).toBeInstanceOf(
      QboItemSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("bill", qbo))).toBeInstanceOf(
      QboBillSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("invoice", qbo))).toBeInstanceOf(
      QboSalesInvoiceSyncer
    );
    expect(
      SyncFactory.getSyncer(makeContext("purchaseOrder", qbo))
    ).toBeInstanceOf(QboPurchaseOrderSyncer);
    expect(
      SyncFactory.getSyncer(makeContext("journalEntry", qbo))
    ).toBeInstanceOf(QboJournalEntrySyncer);
  });

  it("registers exactly the expected Rillet entity types", () => {
    expect(Object.keys(rilletSyncerRegistry).sort()).toEqual(
      [
        "bill",
        "customer",
        "invoice",
        "item",
        "journalEntry",
        "payment",
        "vendor"
      ].sort()
    );
  });

  it("constructs instances of the exact registered Rillet classes", () => {
    const rillet = ProviderID.RILLET;
    expect(
      SyncFactory.getSyncer(makeContext("customer", rillet))
    ).toBeInstanceOf(RilletCustomerSyncer);
    expect(SyncFactory.getSyncer(makeContext("vendor", rillet))).toBeInstanceOf(
      RilletVendorSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("item", rillet))).toBeInstanceOf(
      RilletItemSyncer
    );
    expect(SyncFactory.getSyncer(makeContext("bill", rillet))).toBeInstanceOf(
      RilletBillSyncer
    );
    expect(
      SyncFactory.getSyncer(makeContext("invoice", rillet))
    ).toBeInstanceOf(RilletSalesInvoiceSyncer);
    expect(
      SyncFactory.getSyncer(makeContext("journalEntry", rillet))
    ).toBeInstanceOf(RilletJournalEntrySyncer);
    expect(
      SyncFactory.getSyncer(makeContext("payment", rillet))
    ).toBeInstanceOf(RilletPaymentSyncer);
  });

  it("throws for entity types Rillet does not implement (no PO endpoint)", () => {
    expect(() =>
      SyncFactory.getSyncer(makeContext("purchaseOrder", ProviderID.RILLET))
    ).toThrow(/No Syncer implementation found/);
    expect(() =>
      SyncFactory.getSyncer(
        makeContext("inventoryAdjustment", ProviderID.RILLET)
      )
    ).toThrow(/No Syncer implementation found/);
  });

  it("merges when registering the same provider twice", () => {
    SyncFactory.register(ProviderID.XERO, {});
    expect(SyncFactory.getSyncer(makeContext("customer"))).toBeInstanceOf(
      ContactSyncer
    );
  });
});
