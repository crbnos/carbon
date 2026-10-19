// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Creating a service order inside the caller's transaction: the order, its
// Service project (the work tree) and the project's default states. Shared by
// the ERP's New Service Order and by `post-receipt`, which creates one Depot
// Repair order per serial a repair receipt brings in.
// Spec: .ai/specs/implemented/2026-10-08-field-service.md (Lifecycle, Depot Repair).

import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { type Kysely, sql, type Transaction } from "kysely";
import { ServerFnError } from "../errors";

type ServiceOrderType = Database["public"]["Enums"]["serviceOrderType"];
type ServiceOrderPriority =
  Database["public"]["Enums"]["projectElementPriority"];
type Json = Database["public"]["Tables"]["serviceOrder"]["Insert"]["problem"];

/**
 * Inserts a service order's Service project and its default states: Draft,
 * as its order is (so its parts are not MRP demand until the order is
 * planned), By Coverage, named "<order id> — <serial> — <customer>" ("<order id> —
 * <serial>" for a refurbishment, which has no customer), identified by the
 * order's readable id, under the coverage
 * contract's project when the order names one. Returns the project's id.
 */
export async function insertServiceProject(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    serviceOrder: {
      serviceOrderId: string;
      serial: string;
      customerName: string | null;
      customerId: string | null;
      locationId: string;
      contractProjectId: string | null;
    };
  }
): Promise<string> {
  const { companyId, userId, serviceOrder } = args;
  const project = await trx
    .insertInto("project")
    .values({
      // The order's id makes the name unique: a project's name is unique in
      // its company, and one unit gets many orders over its life.
      name: [
        serviceOrder.serviceOrderId,
        serviceOrder.serial,
        serviceOrder.customerName
      ]
        .filter(Boolean)
        .join(" — "),
      identifier: serviceOrder.serviceOrderId,
      projectType: "Service",
      status: "Draft",
      costTreatment: "By Coverage",
      customerId: serviceOrder.customerId,
      locationId: serviceOrder.locationId,
      parentProjectId: serviceOrder.contractProjectId,
      priority: "None",
      active: true,
      companyId,
      createdBy: userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  // States are company-wide (Settings → Projects): nothing to seed here.
  return project.id;
}

export type InsertServiceOrderArgs = {
  companyId: string;
  userId: string;
  type: ServiceOrderType;
  /** The subject serial, and its readable id for the project's name. */
  trackedEntityId: string;
  serial: string;
  itemId: string;
  /** Null for a Refurbishment: a stock serial has no customer. */
  customerAssetId: string | null;
  customerId: string | null;
  customerName: string | null;
  customerLocationId: string | null;
  customerContactId?: string | null;
  /** The company location that does the work. */
  locationId: string;
  customerContractId: string | null;
  /** The coverage contract's project, the parent of the order's project. */
  contractProjectId: string | null;
  serviceTemplateId?: string | null;
  priority?: ServiceOrderPriority;
  problem?: Json;
  /** A Depot Repair order: the RMA line its unit came back on. */
  salesReturnOrderLineId?: string | null;
};

/**
 * Creates a Draft service order in the caller's transaction:
 * 1. Reads the next `serviceOrder` id.
 * 2. Inserts the order's Service project and its default states
 *    (`insertServiceProject`). The project comes first because
 *    `serviceOrder.projectId` is NOT NULL.
 * 3. Inserts the order.
 *
 * The caller checks the asset and the contract. A forced error anywhere rolls
 * all of it back with the caller's transaction.
 */
export async function insertServiceOrder(
  trx: Transaction<DB>,
  args: InsertServiceOrderArgs
): Promise<{ id: string; serviceOrderId: string; projectId: string }> {
  const { companyId, userId } = args;

  const sequence = await sql<{ serviceOrderId: string | null }>`
    SELECT get_next_sequence('serviceOrder', ${companyId}) AS "serviceOrderId"
  `.execute(trx);
  const serviceOrderId = sequence.rows[0]?.serviceOrderId;
  if (!serviceOrderId) {
    throw new Error("The service order sequence is missing");
  }

  const projectId = await insertServiceProject(trx, {
    companyId,
    userId,
    serviceOrder: {
      serviceOrderId,
      serial: args.serial,
      customerName: args.customerName,
      customerId: args.customerId,
      locationId: args.locationId,
      contractProjectId: args.contractProjectId
    }
  });

  const order = await trx
    .insertInto("serviceOrder")
    .values({
      serviceOrderId,
      type: args.type,
      status: "Draft",
      trackedEntityId: args.trackedEntityId,
      itemId: args.itemId,
      customerAssetId: args.customerAssetId,
      customerId: args.customerId,
      customerLocationId: args.customerLocationId,
      customerContactId: args.customerContactId ?? null,
      locationId: args.locationId,
      customerContractId: args.customerContractId,
      projectId,
      serviceTemplateId: args.serviceTemplateId ?? null,
      priority: args.priority ?? "None",
      problem: args.problem ?? null,
      salesReturnOrderLineId: args.salesReturnOrderLineId ?? null,
      companyId,
      createdBy: userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return { id: order.id, serviceOrderId, projectId };
}

/**
 * The customer assets of serials, keyed by serial. A unit shipped before
 * Carbon, or before the asset backfill, has none: it is created here with
 * source `Manual`, so a repair can still be worked (plan decision B3). An
 * existing asset is returned as it is. Three statements for any number of
 * serials.
 */
export async function ensureCustomerAssets(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    trackedEntityIds: string[];
    customerId: string;
    customerLocationId: string | null;
  }
): Promise<Map<string, string>> {
  const { companyId } = args;
  const assetBySerial = new Map<string, string>();
  if (args.trackedEntityIds.length === 0) return assetBySerial;

  const existing = await trx
    .selectFrom("customerAsset")
    .select(["id", "trackedEntityId"])
    .where("trackedEntityId", "in", args.trackedEntityIds)
    .where("companyId", "=", companyId)
    .execute();
  for (const asset of existing) {
    assetBySerial.set(asset.trackedEntityId, asset.id);
  }

  const missing = args.trackedEntityIds.filter((id) => !assetBySerial.has(id));
  if (missing.length === 0) return assetBySerial;

  const entities = await trx
    .selectFrom("trackedEntity")
    .select(["id", "itemId"])
    .where("id", "in", missing)
    .where("companyId", "=", companyId)
    .execute();
  const itemBySerial = new Map(entities.map((e) => [e.id, e.itemId]));
  const unitless = missing.filter((id) => !itemBySerial.get(id));
  if (unitless.length > 0) {
    throw new Error("The serial has no item, so it cannot be a customer asset");
  }

  const inserted = await trx
    .insertInto("customerAsset")
    .values(
      missing.map((trackedEntityId) => ({
        trackedEntityId,
        itemId: itemBySerial.get(trackedEntityId)!,
        customerId: args.customerId,
        customerLocationId: args.customerLocationId,
        source: "Manual",
        companyId,
        createdBy: args.userId
      }))
    )
    .returning(["id", "trackedEntityId"])
    .execute();
  for (const asset of inserted) {
    assetBySerial.set(asset.trackedEntityId, asset.id);
  }
  return assetBySerial;
}

/**
 * Refuses to ship or pick a serial under refurbishment: one with an open
 * Refurbishment order (any status but Completed, Closed or Cancelled). The
 * selection RPCs and routes already skip an On Hold serial; this is the
 * server's own guard (plan decision C6), keyed on the order so no other On
 * Hold flow (returns, inspections) changes. One query for any number of ids.
 */
export async function assertNoOpenRefurbishment(
  db: Kysely<DB> | Transaction<DB>,
  args: { companyId: string; trackedEntityIds: readonly (string | null)[] }
): Promise<void> {
  const ids = [
    ...new Set(args.trackedEntityIds.filter((id): id is string => !!id))
  ];
  if (ids.length === 0) return;
  const open = await db
    .selectFrom("serviceOrder")
    .innerJoin("trackedEntity", (join) =>
      join
        .onRef("trackedEntity.id", "=", "serviceOrder.trackedEntityId")
        .onRef("trackedEntity.companyId", "=", "serviceOrder.companyId")
    )
    .select([
      "serviceOrder.serviceOrderId",
      "trackedEntity.id as trackedEntityId",
      "trackedEntity.readableId"
    ])
    .where("serviceOrder.companyId", "=", args.companyId)
    .where("serviceOrder.trackedEntityId", "in", ids)
    .where("serviceOrder.type", "=", "Refurbishment")
    .where("serviceOrder.status", "not in", [
      "Completed",
      "Closed",
      "Cancelled"
    ])
    .orderBy("trackedEntity.readableId")
    .executeTakeFirst();
  if (open) {
    throw new ServerFnError(
      `Serial ${open.readableId ?? open.trackedEntityId} is under refurbishment on ${open.serviceOrderId}. Complete the order first.`,
      422
    );
  }
}
