import type {
  Kysely,
  Transaction,
} from "https://esm.sh/v135/kysely@0.26.3/dist/cjs/kysely.d.ts";
import { DB } from "../database.ts";

export async function getSupplier(
  db: Kysely<DB> | Transaction<DB>,
  supplierId: string
) {
  return await db
    .selectFrom("supplier")
    .selectAll()
    .where("id", "=", supplierId)
    .executeTakeFirst();
}

export async function getSupplierPayment(
  db: Kysely<DB> | Transaction<DB>,
  supplierId: string
) {
  return await db
    .selectFrom("supplierPayment")
    .selectAll()
    .where("supplierId", "=", supplierId)
    .executeTakeFirst();
}

export async function getSupplierShipping(
  db: Kysely<DB> | Transaction<DB>,
  supplierId: string
) {
  return await db
    .selectFrom("supplierShipping")
    .selectAll()
    .where("supplierId", "=", supplierId)
    .executeTakeFirst();
}

export async function insertSupplierInteraction(
  db: Kysely<DB> | Transaction<DB>,
  companyId: string
) {
  return await db
    .insertInto("supplierInteraction")
    .values({ companyId })
    .returning(["id"])
    .executeTakeFirst();
}

export async function deletePurchaseOrder(
  db: Kysely<DB> | Transaction<DB>,
  purchaseOrderId: string
) {
  return await db
    .deleteFrom("purchaseOrder")
    .where("id", "=", purchaseOrderId)
    .execute();
}

export async function deletePurchaseOrderLine(
  db: Kysely<DB> | Transaction<DB>,
  purchaseOrderLineId: string
) {
  return await db
    .deleteFrom("purchaseOrderLine")
    .where("id", "=", purchaseOrderLineId)
    .execute();
}
