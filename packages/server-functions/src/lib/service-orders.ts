// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Creating a service order inside the caller's transaction: the order, its
// Service project (the work tree) and the project's default states. Shared by
// the ERP's New Service Order and by `post-receipt`, which creates one Depot
// Repair order per serial a repair receipt brings in.
// Spec: .ai/specs/2026-10-08-field-service.md (Lifecycle, Depot Repair).

import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import { defaultProjectStates } from "@carbon/utils";
import { sql, type Transaction } from "kysely";

type ServiceOrderType = Database["public"]["Enums"]["serviceOrderType"];
type ServiceOrderPriority =
  Database["public"]["Enums"]["projectElementPriority"];
type Json = Database["public"]["Tables"]["serviceOrder"]["Insert"]["problem"];

/**
 * Inserts a service order's Service project and its default states: Released,
 * By Coverage, named "<order id> — <serial> — <customer>", identified by the
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
      customerName: string;
      customerId: string;
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
      name: `${serviceOrder.serviceOrderId} — ${serviceOrder.serial} — ${serviceOrder.customerName}`,
      identifier: serviceOrder.serviceOrderId,
      projectType: "Service",
      status: "Released",
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

  await trx
    .insertInto("projectState")
    .values(
      defaultProjectStates.map((state) => ({
        projectId: project.id,
        companyId,
        name: state.name,
        group: state.group,
        color: state.color,
        sortOrder: state.sortOrder,
        isDefault: state.isDefault,
        createdBy: userId
      }))
    )
    .execute();

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
  customerAssetId: string;
  customerId: string;
  customerName: string;
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
 * The customer asset of a serial. A unit shipped before Carbon, or before the
 * asset backfill, has none: it is created here with source `Manual`, so a
 * repair can still be worked (plan decision B3). An existing asset is
 * returned as it is.
 */
export async function ensureCustomerAsset(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    trackedEntityId: string;
    customerId: string;
    customerLocationId: string | null;
  }
): Promise<string> {
  const { companyId } = args;
  const existing = await trx
    .selectFrom("customerAsset")
    .select("id")
    .where("trackedEntityId", "=", args.trackedEntityId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (existing) return existing.id;

  const entity = await trx
    .selectFrom("trackedEntity")
    .select("itemId")
    .where("id", "=", args.trackedEntityId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!entity?.itemId) {
    throw new Error("The serial has no item, so it cannot be a customer asset");
  }

  const inserted = await trx
    .insertInto("customerAsset")
    .values({
      trackedEntityId: args.trackedEntityId,
      itemId: entity.itemId,
      customerId: args.customerId,
      customerLocationId: args.customerLocationId,
      source: "Manual",
      companyId,
      createdBy: args.userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}
