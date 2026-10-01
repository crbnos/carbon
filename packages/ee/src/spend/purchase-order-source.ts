// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The Carbon state a spend platform needs to mirror a purchase order.
 *
 * Provider-neutral: every field here is a fact about Carbon's schema, and two of
 * them are load-bearing in a way that is easy to get wrong when writing a second
 * adapter —
 *
 * - **the line price is `supplierUnitPrice` (document currency), never the
 *   generated `unitPrice`** (company base). The pushed document is labelled with
 *   the order's own `currencyCode`, so base amounts under a foreign-currency
 *   label mis-state every non-base order.
 * - **`currencyCode` falls back to the company's base currency.** It is NULL on
 *   an order raised in the company's own currency, and platforms require a
 *   currency on create.
 *
 * Both were found by a live push failing, not by a type error.
 */

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  emptySpendVendorParty,
  loadSpendVendorParties,
  type SpendVendorParty
} from "./parties";

type PurchaseOrderStatus = Database["public"]["Enums"]["purchaseOrderStatus"];

export type SpendPurchaseOrderLine = {
  id: string;
  description: string | null;
  quantity: number | null;
  /** Document currency — see the header. */
  unitPrice: number | null;
};

export type SpendPurchaseOrderSource = {
  id: string;
  readableId: string;
  status: PurchaseOrderStatus;
  /**
   * Read for `BaseEntitySyncer`'s unchanged-since-last-sync bailout. Without it
   * the comparison is against `undefined` and every event re-pushes.
   */
  updatedAt: string | null;
  currencyCode: string | null;
  supplier: SpendVendorParty;
  lines: SpendPurchaseOrderLine[];
};

export async function loadPurchaseOrderPushSource(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  ids: string[]
): Promise<Map<string, SpendPurchaseOrderSource>> {
  const result = new Map<string, SpendPurchaseOrderSource>();
  if (ids.length === 0) return result;

  const orders = await db
    .selectFrom("purchaseOrder")
    .select([
      "id",
      "purchaseOrderId",
      "status",
      "supplierId",
      "currencyCode",
      "updatedAt"
    ])
    .where("companyId", "=", companyId)
    .where("id", "in", ids)
    .execute();

  if (orders.length === 0) return result;

  const company = await db
    .selectFrom("company")
    .select("baseCurrencyCode")
    .where("id", "=", companyId)
    .executeTakeFirst();
  const baseCurrency = company?.baseCurrencyCode ?? null;

  const lines = await db
    .selectFrom("purchaseOrderLine")
    .select([
      "id",
      "purchaseOrderId",
      "description",
      "purchaseQuantity",
      "supplierUnitPrice"
    ])
    .where("companyId", "=", companyId)
    .where(
      "purchaseOrderId",
      "in",
      orders.map((order) => order.id)
    )
    // A Comment line is annotation, not something to buy.
    .where("purchaseOrderLineType", "!=", "Comment")
    .orderBy("sortOrder", "asc")
    .execute();

  const linesByOrder = new Map<string, SpendPurchaseOrderLine[]>();
  for (const line of lines) {
    const list = linesByOrder.get(line.purchaseOrderId) ?? [];
    list.push({
      id: line.id,
      description: line.description,
      quantity: line.purchaseQuantity,
      unitPrice: line.supplierUnitPrice
    });
    linesByOrder.set(line.purchaseOrderId, list);
  }

  const partiesById = await loadSpendVendorParties(
    db,
    companyId,
    orders.map((order) => order.supplierId)
  );

  for (const order of orders) {
    result.set(order.id, {
      id: order.id,
      readableId: order.purchaseOrderId,
      status: order.status,
      updatedAt: order.updatedAt,
      currencyCode: order.currencyCode ?? baseCurrency,
      supplier:
        partiesById.get(order.supplierId) ??
        emptySpendVendorParty(order.supplierId, null),
      lines: linesByOrder.get(order.id) ?? []
    });
  }

  return result;
}
