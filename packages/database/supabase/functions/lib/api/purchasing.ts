import { Kysely } from "npm:kysely@0.27.6";
import { DB } from "../database.ts";

export async function getSupplier(
  db: Kysely<DB>,
  supplierId: string
) {
  return await db
    .selectFrom("supplier")
    .selectAll()
    .where("id", "=", supplierId)
    .executeTakeFirst();
}

export async function getSupplierPayment(
  db: Kysely<DB>,
  supplierId: string
) {
  return await db
    .selectFrom("supplierPayment")
    .selectAll()
    .where("supplierId", "=", supplierId)
    .executeTakeFirst();
}

export async function getSupplierShipping(
  db: Kysely<DB>,
  supplierId: string
) {
  return await db
    .selectFrom("supplierShipping")
    .selectAll()
    .where("supplierId", "=", supplierId)
    .executeTakeFirst();
}

export async function insertSupplierInteraction(
  db: Kysely<DB>,
  companyId: string
) {
  return await db
    .insertInto("supplierInteraction")
    .values({ companyId })
    .returning(["id"])
    .executeTakeFirst();
}

export async function deletePurchaseOrder(
  db: Kysely<DB>,
  purchaseOrderId: string
) {
  return await db
    .deleteFrom("purchaseOrder")
    .where("id", "=", purchaseOrderId)
    .execute();
}

export async function deletePurchaseOrderLine(
  db: Kysely<DB>,
  purchaseOrderLineId: string
) {
  return await db
    .deleteFrom("purchaseOrderLine")
    .where("id", "=", purchaseOrderLineId)
    .execute();
}