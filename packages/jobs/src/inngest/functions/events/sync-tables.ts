import type { AccountingEntityType } from "@carbon/ee/accounting";

/**
 * Map database table names to accounting entity types. Every table in
 * REQUIRED_SYNC_SUBSCRIPTIONS (@carbon/ee/accounting core/subscriptions)
 * must have an entry here — pinned by subscriptions-mapping.test.ts — or
 * its subscription is a dead letter (events dispatch, the handler drops
 * them as "no entity mapping").
 *
 * Import-light on purpose (no @carbon/auth / Inngest): the invariant test
 * imports this without booting env config.
 */
export const TABLE_TO_ENTITY_MAP: Partial<
  Record<string, AccountingEntityType>
> = {
  customer: "customer",
  supplier: "vendor",
  item: "item",
  purchaseOrder: "purchaseOrder",
  purchaseInvoice: "bill",
  salesInvoice: "invoice",
  salesOrder: "salesOrder",
  journal: "journalEntry",
  payment: "payment",
  charge: "charge"
};

/**
 * Tables that route to MORE THAN ONE entity type, resolved per ROW.
 *
 * `memo` is the only one: a customer memo is a `creditMemo`, a supplier memo a
 * `vendorCredit`, in both directions. Direction does NOT decide it — that was the
 * misclassification bug fixed in the posting policy, and the same rule applies here.
 */
export const MULTI_ENTITY_TABLES: Partial<
  Record<string, AccountingEntityType[]>
> = {
  memo: ["creditMemo", "vendorCredit"]
};

/** Every entity type a table can route to. Used by the subscriptions invariant test. */
export function getEntityTypesForTable(table: string): AccountingEntityType[] {
  const multi = MULTI_ENTITY_TABLES[table];
  if (multi) return multi;
  const single = TABLE_TO_ENTITY_MAP[table];
  return single ? [single] : [];
}

export function getEntityTypeFromTable(
  table: string,
  row?: Record<string, unknown> | null
): AccountingEntityType | null {
  if (table === "memo") {
    // Party, not direction. Without the row we cannot tell — return null so the
    // caller records "no entity mapping" rather than guessing a side.
    if (row?.customerId) return "creditMemo";
    if (row?.supplierId) return "vendorCredit";
    return null;
  }
  return TABLE_TO_ENTITY_MAP[table] ?? null;
}
