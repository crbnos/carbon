// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The purchasing database tests' fixture. Needs the local stack (`crbn up`);
// each test is skipped without one.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { it } from "vitest";
import { connectLocalTestDatabase, hasLocalDatabase } from "./local-database";
import { localServiceRoleClient } from "./local-supabase";

export const client = hasLocalDatabase ? localServiceRoleClient() : null;
export const test = (name: string, fn: () => Promise<void>) =>
  it.skipIf(!client)(name, fn, 60_000);

export type Setup = {
  status?: "Draft" | "Needs Approval" | "To Receive" | "Completed";
  /** The company's approval rule for purchase orders, from 0. */
  approver?: string | null;
  pendingRequest?: boolean;
  createdFromPlanning?: boolean;
  skipApprovalForPlanningPurchaseOrders?: boolean;
};

// Two companies. The first has a supplier, a part and one purchase order for
// 5 × 8 = 40, optionally needing approval with a pending request by "system".
export async function fixture(setup: Setup = {}) {
  const db = await connectLocalTestDatabase();
  const p = `pgtest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const companyId = `${p}-company`;
  const otherCompanyId = `${p}-other`;
  const groupId = `${p}-group`;
  // Its own group: companies of one group trade with each other, and their
  // intercompany suppliers refuse the cleanup's delete.
  const otherGroupId = `${p}-other-group`;
  const ids = {
    supplier: `${p}-supplier`,
    interaction: `${p}-interaction`,
    item: `${p}-item`,
    order: `${p}-po`,
    request: `${p}-request`
  };

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await sql`
      INSERT INTO "companyGroup" (id, name, "createdBy") VALUES
        (${groupId}, ${p}, 'system'),
        (${otherGroupId}, ${`${p}-other`}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "company" (id, name, "companyGroupId", "baseCurrencyCode") VALUES
        (${companyId}, ${p}, ${groupId}, 'USD'),
        (${otherCompanyId}, ${`${p}-other`}, ${otherGroupId}, 'USD')
    `.execute(trx);
    await sql`
      UPDATE "companySettings"
      SET "skipApprovalForPlanningPurchaseOrders" = ${setup.skipApprovalForPlanningPurchaseOrders ?? true}
      WHERE id = ${companyId}
    `.execute(trx);
    await sql`
      INSERT INTO "supplier" (id, name, "readableId", "companyId", "createdBy")
      VALUES (${ids.supplier}, 'One', 'S1', ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
      VALUES ('EA', 'Each', ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "item" (id, "readableId", name, type, "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy")
      VALUES (${ids.item}, 'P-1', 'Part', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA',
        ${companyId}, 'system')
    `.execute(trx);
    await sql`
      INSERT INTO "supplierInteraction" (id, "companyId", "supplierId")
      VALUES (${ids.interaction}, ${companyId}, ${ids.supplier})
    `.execute(trx);
    await sql`
      INSERT INTO "purchaseOrder" (id, "purchaseOrderId", "supplierId", "supplierInteractionId",
        status, "createdFromPlanning", "currencyCode", "exchangeRate", "companyId", "createdBy")
      VALUES (${ids.order}, 'PO-T', ${ids.supplier}, ${ids.interaction},
        ${setup.status ?? "Draft"}, ${setup.createdFromPlanning ?? false}, 'USD', 1,
        ${companyId}, 'system')
    `.execute(trx);
    // The order's interceptor makes these; the fixture runs with it off.
    await sql`
      INSERT INTO "purchaseOrderDelivery" (id, "companyId") VALUES (${ids.order}, ${companyId})
    `.execute(trx);
    await sql`
      INSERT INTO "purchaseOrderPayment" (id, "companyId") VALUES (${ids.order}, ${companyId})
    `.execute(trx);
    await sql`
      INSERT INTO "purchaseOrderLine" ("purchaseOrderId", "purchaseOrderLineType", "itemId",
        "purchaseQuantity", "supplierUnitPrice", "exchangeRate", "conversionFactor",
        "companyId", "createdBy")
      VALUES (${ids.order}, 'Part', ${ids.item}, 5, 8, 1, 1, ${companyId}, 'system')
    `.execute(trx);
    if (setup.approver !== undefined) {
      await sql`
        INSERT INTO "approvalRule" ("documentType", "defaultApproverId", "lowerBoundAmount",
          "companyId", "createdBy")
        VALUES ('purchaseOrder', ${setup.approver}, 0, ${companyId}, 'system')
      `.execute(trx);
    }
    if (setup.pendingRequest) {
      await sql`
        INSERT INTO "approvalRequest" (id, "documentType", "documentId", amount, "requestedBy",
          "companyId", "createdBy")
        VALUES (${ids.request}, 'purchaseOrder', ${ids.order}, 40, 'system', ${companyId}, 'system')
      `.execute(trx);
    }
  });

  const contextAs = (userId: string, company = companyId, pg = db) =>
    createServiceContext({
      actor: { type: "system", onBehalfOf: userId },
      company: {
        id: company,
        groupId: company === companyId ? groupId : otherGroupId
      },
      caller: client!,
      system: () => client!,
      pg: () => pg,
      kv: () => {
        throw new Error("No operation here reads the cache");
      }
    });

  return {
    db,
    companyId,
    groupId,
    otherCompanyId,
    ids,
    contextAs,
    order: () =>
      db
        .selectFrom("purchaseOrder")
        .select(["status"])
        .where("id", "=", ids.order)
        .executeTakeFirst(),
    requests: () =>
      db
        .selectFrom("approvalRequest")
        .select(["id", "status", "amount"])
        .where("documentId", "=", ids.order)
        .orderBy("requestedAt")
        .execute(),
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .deleteFrom("company")
          .where("id", "in", [companyId, otherCompanyId])
          .execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "in", [groupId, otherGroupId])
          .execute();
        for (const id of [companyId, otherCompanyId]) {
          await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${id}`)}`.execute(
            trx
          );
          await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${id}`)}`.execute(
            trx
          );
        }
      });
      await db.destroy();
    }
  };
}

export type PurchasingFixture = Awaited<ReturnType<typeof fixture>>;
