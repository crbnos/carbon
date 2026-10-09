// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Transactional writes of field service: creating an order with its work
// tree, registering a unit sold before Carbon, rolling an order's status up
// from its visits, and cancelling an order.
// Spec: .ai/specs/2026-10-08-field-service.md (Lifecycle, Customer assets)

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import type { z } from "zod";
import { BUILD_FROM_PART_MAX_DEPTH } from "../projects/projects.models";
import {
  createServiceProject,
  insertElementsFromPart
} from "../projects/projects.server";
import type {
  customerAssetValidator,
  ServiceOrderStatus,
  serviceOrderValidator
} from "./service.models";
import { rollUpOrderStatus } from "./service.models";

type ProjectStatus = Database["public"]["Enums"]["projectStatus"];

/** A refusal the route shows the user as it is. */
export class ServiceOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceOrderError";
  }
}

/** The levels a build from the serial or the bill of materials walks. */
const SERVICE_BUILD_DEPTH = 2;

/**
 * Creates a Draft service order in one transaction: reads the next
 * `serviceOrder` id, checks the subject is an In Service customer asset,
 * proposes the customer's only Active contract when none was chosen,
 * creates the order's Service project (the work tree), inserts the order,
 * and, when asked, builds the tree from a service template, the unit's
 * build history or the item's bill of materials. Returns the order's id.
 */
export async function createServiceOrder(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof serviceOrderValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ id: string; serviceOrderId: string }> {
  const { companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const asset = await trx
      .selectFrom("customerAsset as ca")
      .innerJoin("trackedEntity as te", (join) =>
        join
          .onRef("te.id", "=", "ca.trackedEntityId")
          .on("te.companyId", "=", companyId)
      )
      .innerJoin("customer as c", "c.id", "ca.customerId")
      .select([
        "ca.id",
        "ca.status",
        "ca.itemId",
        "ca.trackedEntityId",
        "ca.customerId",
        "ca.customerLocationId",
        "te.readableId as serial",
        "c.name as customerName"
      ])
      .where("ca.id", "=", args.customerAssetId)
      .where("ca.companyId", "=", companyId)
      .executeTakeFirst();
    if (!asset) throw new ServiceOrderError("The customer asset was not found");
    if (asset.status !== "In Service") {
      throw new ServiceOrderError(
        `A field visit needs a unit in service. This unit is ${asset.status}.`
      );
    }

    const contracts = await trx
      .selectFrom("customerContract")
      .select(["id", "projectId", "status"])
      .where("companyId", "=", companyId)
      .where("customerId", "=", asset.customerId)
      .where((eb) =>
        args.customerContractId
          ? eb("id", "=", args.customerContractId)
          : eb("status", "=", "Active")
      )
      .execute();
    let contract: { id: string; projectId: string | null } | null = null;
    if (args.customerContractId) {
      contract = contracts[0] ?? null;
      if (!contract) {
        throw new ServiceOrderError(
          "The coverage contract is not one of this customer's contracts"
        );
      }
    } else if (contracts.length === 1) {
      contract = contracts[0]!;
    }

    const sequence = await sql<{ serviceOrderId: string }>`
      SELECT get_next_sequence('serviceOrder', ${companyId}) AS "serviceOrderId"
    `.execute(trx);
    const serviceOrderId = sequence.rows[0]?.serviceOrderId;
    if (!serviceOrderId) {
      throw new ServiceOrderError("The service order sequence is missing");
    }

    const projectId = await createServiceProject(trx, {
      companyId,
      userId,
      serviceOrder: {
        serviceOrderId,
        serial: asset.serial ?? "",
        customerName: asset.customerName,
        customerId: asset.customerId,
        locationId: args.locationId,
        contractProjectId: contract?.projectId ?? null
      }
    });

    const order = await trx
      .insertInto("serviceOrder")
      .values({
        serviceOrderId,
        type: args.type,
        status: "Draft",
        trackedEntityId: asset.trackedEntityId,
        itemId: asset.itemId,
        customerAssetId: asset.id,
        customerId: asset.customerId,
        customerLocationId: asset.customerLocationId,
        customerContactId: args.customerContactId ?? null,
        locationId: args.locationId,
        customerContractId: contract?.id ?? null,
        projectId,
        serviceTemplateId:
          args.startFrom === "Template"
            ? (args.serviceTemplateId ?? null)
            : null,
        priority: args.priority ?? "None",
        problem: args.problem ?? null,
        companyId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const source =
      args.startFrom === "Template" && args.serviceTemplateId
        ? { templateProjectId: args.serviceTemplateId }
        : args.startFrom === "Serial"
          ? { trackedEntityId: asset.trackedEntityId }
          : args.startFrom === "Item"
            ? { itemId: asset.itemId }
            : null;
    if (source) {
      await insertElementsFromPart(client, trx, {
        companyId,
        projectId,
        parentId: null,
        source,
        depth:
          "templateProjectId" in source
            ? BUILD_FROM_PART_MAX_DEPTH
            : SERVICE_BUILD_DEPTH,
        // A unit's tracked components are what a service replaces, bought or
        // made; a bill of materials lists every bought screw, so it keeps
        // only the made lines.
        includeBought: "trackedEntityId" in source,
        userId
      });
    }

    return { id: order.id, serviceOrderId };
  });
}

/**
 * Registers a unit sold before Carbon, in one transaction: a `trackedEntity`
 * for the typed serial (Consumed, quantity 1, sourced from the item) and the
 * customer asset (source Manual). A serial Carbon already tracks for the
 * item is refused: it becomes an asset when it ships.
 */
export async function registerCustomerAsset(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof customerAssetValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ id: string }> {
  const { companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const item = await trx
      .selectFrom("item")
      .select(["id", "itemTrackingType"])
      .where("id", "=", args.itemId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!item) throw new ServiceOrderError("The item was not found");
    if (item.itemTrackingType !== "Serial") {
      throw new ServiceOrderError("Only a serialized item can be an asset");
    }

    const existing = await trx
      .selectFrom("trackedEntity")
      .select("id")
      .where("companyId", "=", companyId)
      .where("itemId", "=", args.itemId)
      .where("readableId", "=", args.serialNumber)
      .executeTakeFirst();
    if (existing) {
      throw new ServiceOrderError(
        `Serial ${args.serialNumber} already exists for this item`
      );
    }

    const entity = await trx
      .insertInto("trackedEntity")
      .values({
        itemId: args.itemId,
        readableId: args.serialNumber,
        quantity: 1,
        status: "Consumed",
        sourceDocument: "Item",
        sourceDocumentId: args.itemId,
        companyId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return trx
      .insertInto("customerAsset")
      .values({
        trackedEntityId: entity.id,
        itemId: args.itemId,
        customerId: args.customerId,
        customerLocationId: args.customerLocationId ?? null,
        shippedDate: args.shippedDate ?? null,
        laborWarrantyEndDate: args.laborWarrantyEndDate ?? null,
        partsWarrantyEndDate: args.partsWarrantyEndDate ?? null,
        notes: args.notes ?? null,
        source: "Manual",
        companyId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  });
}

/** The project status an order's status gives its work tree. */
export function projectStatusOfOrder(
  status: ServiceOrderStatus
): ProjectStatus {
  switch (status) {
    case "On Hold":
      return "On Hold";
    case "Completed":
      return "Technically Complete";
    case "Closed":
    case "Cancelled":
      return "Closed";
    default:
      return "Released";
  }
}

/**
 * Rolls an order's status up from its visits (`rollUpOrderStatus`) and
 * saves it, then sets its project's status to match. `status` starts the
 * roll-up from a status the user chose (Put on hold, Complete, Close; a
 * Resume passes Draft so the visits decide again); `workComplete` is the
 * **Work complete?** answer of a completing visit. Call it after every visit
 * change and every order status change. Runs in `trx` when given.
 */
export async function syncServiceOrderStatus(
  db: Kysely<KyselyDatabase> | KyselyTx,
  args: {
    companyId: string;
    serviceOrderId: string;
    userId: string;
    status?: ServiceOrderStatus;
    workComplete?: boolean;
  }
): Promise<ServiceOrderStatus> {
  const run = async (trx: KyselyTx) => {
    const order = await trx
      .selectFrom("serviceOrder")
      .select(["id", "status", "projectId"])
      .where("id", "=", args.serviceOrderId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new ServiceOrderError("The service order was not found");

    const visits = await trx
      .selectFrom("serviceVisit")
      .select("status")
      .where("serviceOrderId", "=", order.id)
      .where("companyId", "=", args.companyId)
      .execute();

    const status = rollUpOrderStatus(
      { status: args.status ?? order.status, workComplete: args.workComplete },
      visits
    );
    const now = datetime.timestamp();
    await trx
      .updateTable("serviceOrder")
      .set({
        status,
        ...(status === "Completed" && order.status !== "Completed"
          ? { completedAt: now, completedBy: args.userId }
          : {}),
        ...(status !== "Completed" &&
        status !== "Closed" &&
        order.status === "Completed"
          ? { completedAt: null, completedBy: null }
          : {}),
        updatedBy: args.userId,
        updatedAt: now
      })
      .where("id", "=", order.id)
      .where("companyId", "=", args.companyId)
      .execute();
    await trx
      .updateTable("project")
      .set({
        status: projectStatusOfOrder(status),
        updatedBy: args.userId,
        updatedAt: now
      })
      .where("id", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .execute();
    return status;
  };

  return db.isTransaction
    ? run(db as KyselyTx)
    : (db as Kysely<KyselyDatabase>).transaction().execute(run);
}

/**
 * Cancels an order with no posted charge: the order goes to Cancelled, its
 * open visits to Cancelled and its project to Closed. An order whose project
 * has a ledger row is refused; reverse the charges first.
 */
export async function cancelServiceOrder(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; serviceOrderId: string; userId: string }
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("serviceOrder")
      .select(["id", "status", "projectId"])
      .where("id", "=", args.serviceOrderId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new ServiceOrderError("The service order was not found");
    if (order.status === "Closed" || order.status === "Cancelled") {
      throw new ServiceOrderError(
        `A ${order.status.toLowerCase()} service order cannot be cancelled`
      );
    }

    const posted = await trx
      .selectFrom("projectLedger")
      .select("id")
      .where("projectId", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .limit(1)
      .executeTakeFirst();
    if (posted) {
      throw new ServiceOrderError(
        "This service order has posted charges. Reverse them before you cancel it."
      );
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("serviceVisit")
      .set({ status: "Cancelled", updatedBy: args.userId, updatedAt: now })
      .where("serviceOrderId", "=", order.id)
      .where("companyId", "=", args.companyId)
      .where("status", "in", ["Scheduled", "Traveling", "On Site"])
      .execute();
    await syncServiceOrderStatus(trx, {
      companyId: args.companyId,
      serviceOrderId: order.id,
      userId: args.userId,
      status: "Cancelled"
    });
  });
}
