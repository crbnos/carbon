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
  payment: "payment"
};

export function getEntityTypeFromTable(
  table: string
): AccountingEntityType | null {
  return TABLE_TO_ENTITY_MAP[table] ?? null;
}
