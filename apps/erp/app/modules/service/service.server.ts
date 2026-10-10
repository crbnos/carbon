// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Transactional writes of field service: creating an order with its work
// tree, registering a unit sold before Carbon, rolling an order's status up
// from its visits, and cancelling an order.
// Spec: .ai/specs/implemented/2026-10-08-field-service.md (Lifecycle, Customer assets)

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import {
  loadRefurbishmentCompletion,
  planRefurbishmentCompletion,
  RefurbishmentCompletionError,
  type RefurbishmentCompletionPlan
} from "@carbon/server-functions/complete-service-order";
import { insertServiceOrder } from "@carbon/server-functions/lib/service-orders";
import { datetime, openChargeIds, round } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  BUILD_FROM_PART_MAX_DEPTH,
  defaultProjectStates
} from "../projects/projects.models";
import {
  insertElementsFromPart,
  postTimesheetEntries
} from "../projects/projects.server";
import { createTimesheetCorrection } from "../projects/projects.service";
import type {
  coverageOverrideValidator,
  customerAssetValidator,
  ServiceOrderStatus,
  ServiceVisitStatus,
  serviceChargeReversalValidator,
  serviceExpenseValidator,
  serviceOrderValidator,
  serviceTemplateValidator,
  serviceVisitValidator
} from "./service.models";
import {
  buildExpenseReversal,
  canMoveVisit,
  canReverseCharge,
  rollUpOrderStatus,
  serviceTemplateIdentifier
} from "./service.models";

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
 * `serviceOrder` id, checks the subject, creates the order's Service project
 * (the work tree), inserts the order, and, when asked, builds the tree from a
 * service template, the unit's build history or the item's bill of
 * materials. Returns the order's id.
 *
 * A Field Visit's subject is an In Service customer asset; the customer's
 * only Active contract is proposed when none was chosen. A Refurbishment's
 * subject is a serial in stock (Available or On Hold) with no open order; it
 * has no customer, site or contract, and its serial goes On Hold until the
 * order completes or is cancelled.
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
    if (args.type === "Refurbishment") {
      const serial = await trx
        .selectFrom("trackedEntity as te")
        .innerJoin("item as i", (join) =>
          join.onRef("i.id", "=", "te.itemId").on("i.companyId", "=", companyId)
        )
        .select([
          "te.id",
          "te.readableId",
          "te.status",
          "te.itemId",
          "i.itemTrackingType"
        ])
        .where("te.id", "=", args.trackedEntityId ?? "")
        .where("te.companyId", "=", companyId)
        .forUpdate("te")
        .executeTakeFirst();
      if (!serial?.itemId) {
        throw new ServiceOrderError("The serial was not found");
      }
      const serialName = serial.readableId ?? serial.id;
      if (serial.itemTrackingType !== "Serial") {
        throw new ServiceOrderError(
          "A refurbishment needs a serial-tracked item"
        );
      }
      if (serial.status !== "Available" && serial.status !== "On Hold") {
        throw new ServiceOrderError(
          `A refurbishment needs a serial in stock. Serial ${serialName} is ${serial.status}.`
        );
      }
      const open = await trx
        .selectFrom("serviceOrder")
        .select("serviceOrderId")
        .where("trackedEntityId", "=", serial.id)
        .where("companyId", "=", companyId)
        .where("status", "not in", ["Closed", "Cancelled"])
        .executeTakeFirst();
      if (open) {
        throw new ServiceOrderError(
          `Serial ${serialName} already has an open service order, ${open.serviceOrderId}`
        );
      }

      const order = await insertServiceOrder(trx, {
        companyId,
        userId,
        type: "Refurbishment",
        trackedEntityId: serial.id,
        serial: serialName,
        itemId: serial.itemId,
        customerAssetId: null,
        customerId: null,
        customerName: null,
        customerLocationId: null,
        locationId: args.locationId,
        customerContractId: null,
        contractProjectId: null,
        serviceTemplateId:
          args.startFrom === "Template"
            ? (args.serviceTemplateId ?? null)
            : null,
        priority: args.priority ?? "None",
        problem: args.problem ?? null
      });
      // On Hold keeps the serial out of picking and shipping while the work
      // runs (complete-service-order sets it Available again).
      await trx
        .updateTable("trackedEntity")
        .set({ status: "On Hold", updatedBy: userId })
        .where("id", "=", serial.id)
        .where("companyId", "=", companyId)
        .execute();

      await buildServiceOrderTree(client, trx, {
        companyId,
        userId,
        projectId: order.projectId,
        startFrom: args.startFrom,
        serviceTemplateId: args.serviceTemplateId,
        trackedEntityId: serial.id,
        itemId: serial.itemId
      });
      return { id: order.id, serviceOrderId: order.serviceOrderId };
    }

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
      .where("ca.id", "=", args.customerAssetId ?? "")
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

    const order = await insertServiceOrder(trx, {
      companyId,
      userId,
      type: args.type,
      trackedEntityId: asset.trackedEntityId,
      serial: asset.serial ?? "",
      itemId: asset.itemId,
      customerAssetId: asset.id,
      customerId: asset.customerId,
      customerName: asset.customerName,
      customerLocationId: asset.customerLocationId,
      customerContactId: args.customerContactId ?? null,
      locationId: args.locationId,
      customerContractId: contract?.id ?? null,
      contractProjectId: contract?.projectId ?? null,
      serviceTemplateId:
        args.startFrom === "Template" ? (args.serviceTemplateId ?? null) : null,
      priority: args.priority ?? "None",
      problem: args.problem ?? null
    });
    const { projectId, serviceOrderId } = order;

    await buildServiceOrderTree(client, trx, {
      companyId,
      userId,
      projectId,
      startFrom: args.startFrom,
      serviceTemplateId: args.serviceTemplateId,
      trackedEntityId: asset.trackedEntityId,
      itemId: asset.itemId
    });

    return { id: order.id, serviceOrderId };
  });
}

/**
 * Builds a new order's work tree from a service template, the unit's build
 * history (its serial) or the item's bill of materials. Nothing for Empty.
 */
async function buildServiceOrderTree(
  client: SupabaseClient<Database>,
  trx: KyselyTx,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    startFrom: z.infer<typeof serviceOrderValidator>["startFrom"];
    serviceTemplateId?: string;
    trackedEntityId: string;
    itemId: string;
  }
): Promise<void> {
  const source =
    args.startFrom === "Template" && args.serviceTemplateId
      ? { templateProjectId: args.serviceTemplateId }
      : args.startFrom === "Serial"
        ? { trackedEntityId: args.trackedEntityId }
        : args.startFrom === "Item"
          ? { itemId: args.itemId }
          : null;
  if (!source) return;
  await insertElementsFromPart(client, trx, {
    companyId: args.companyId,
    projectId: args.projectId,
    parentId: null,
    source,
    depth:
      "templateProjectId" in source
        ? BUILD_FROM_PART_MAX_DEPTH
        : SERVICE_BUILD_DEPTH,
    // A unit's tracked components are what a service replaces, bought or
    // made; a bill of materials lists every bought screw, so it keeps only
    // the made lines.
    includeBought: "trackedEntityId" in source,
    // A template's plan lines come with its nodes, so the estimate has
    // prices.
    includePlanLines: true,
    userId: args.userId
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

/**
 * Creates a service template in one transaction: a Draft Service project
 * marked as a template (By Coverage, as every Service project), with the
 * default states, and its identifier set from its id
 * (`serviceTemplateIdentifier`). Returns its id.
 */
export async function createServiceTemplate(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof serviceTemplateValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ id: string }> {
  const { companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .insertInto("project")
      .values({
        name: args.name,
        projectType: "Service",
        isTemplate: true,
        status: "Draft",
        costTreatment: "By Coverage",
        priority: "None",
        active: true,
        companyId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .updateTable("project")
      .set({ identifier: serviceTemplateIdentifier(project.id) })
      .where("id", "=", project.id)
      .where("companyId", "=", companyId)
      .execute();

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

    return { id: project.id };
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
      .select(["id", "type", "status", "projectId"])
      .where("id", "=", args.serviceOrderId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new ServiceOrderError("The service order was not found");

    // A refurbishment completes only through `completeServiceOrder`, which
    // moves its cost into the serial; a visit's Work complete? leaves it
    // open. Once completed, its cost is in the serial, so it never reopens.
    const isRefurbishment = order.type === "Refurbishment";
    if (
      isRefurbishment &&
      args.status === "Completed" &&
      order.status !== "Completed"
    ) {
      throw new ServiceOrderError(
        "Complete a refurbishment from its order, so its cost moves to the serial"
      );
    }
    if (
      isRefurbishment &&
      order.status === "Completed" &&
      args.status !== undefined &&
      args.status !== "Completed" &&
      args.status !== "Closed"
    ) {
      throw new ServiceOrderError(
        "A completed refurbishment cannot be reopened: its cost is already in the serial"
      );
    }

    const visits = await trx
      .selectFrom("serviceVisit")
      .select("status")
      .where("serviceOrderId", "=", order.id)
      .where("companyId", "=", args.companyId)
      .execute();

    const status = rollUpOrderStatus(
      {
        status: args.status ?? order.status,
        workComplete: isRefurbishment ? false : args.workComplete
      },
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
 * Completes an order through `complete-service-order`: a Field Visit or Depot
 * Repair order is stamped Completed; a Refurbishment also moves its WIP into
 * the serial's cost and releases the serial. Returns the refusal or failure
 * message, or null, and the completion's warnings (no sale price to cap at).
 */
export async function completeServiceOrder(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; serviceOrderId: string; userId: string }
): Promise<{ error: string | null; warnings: string[] }> {
  const result = await serverFns
    .system({ db, companyId: args.companyId, userId: args.userId })
    .invoke("complete-service-order", {
      serviceOrderId: args.serviceOrderId
    });
  if (result.error) {
    logger.error("Failed to complete a service order", {
      companyId: args.companyId,
      serviceOrderId: args.serviceOrderId,
      error: result.error
    });
    return {
      error: result.error.message || "Failed to complete the service order",
      warnings: []
    };
  }
  return { error: null, warnings: result.data.warnings };
}

export type RefurbishmentCompletionPreview = {
  costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
  /** Capitalize into the serial (or the average), or material variance. */
  treatment: RefurbishmentCompletionPlan["treatment"];
  abnormalRework: boolean;
  wipTotal: number;
  /** The serial's unit cost (FIFO, LIFO), else the item's unit cost. */
  currentUnitCost: number;
  /** The unit cost after completion: the serial's, the new average, or
   *  unchanged under material variance. */
  newUnitCost: number;
  cap: number | null;
  writeDown: number;
  warnings: string[];
};

/**
 * What completing a Refurbishment would do, written nowhere: the same reads
 * as `complete-service-order` (`loadRefurbishmentCompletion`, without row
 * locks) and the same planner. Returns the planner's refusal as `error`.
 */
export async function previewRefurbishmentCompletion(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; serviceOrderId: string }
): Promise<
  | { preview: RefurbishmentCompletionPreview; error: null }
  | { preview: null; error: string }
> {
  const order = await db
    .selectFrom("serviceOrder")
    .select([
      "id",
      "serviceOrderId",
      "type",
      "status",
      "projectId",
      "trackedEntityId",
      "itemId",
      "expectedSellingPrice",
      "abnormalRework"
    ])
    .where("id", "=", args.serviceOrderId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!order)
    return { preview: null, error: "The service order was not found" };
  if (order.type !== "Refurbishment") {
    return { preview: null, error: "Only a refurbishment has a cost preview" };
  }

  try {
    const context = await loadRefurbishmentCompletion(db, {
      companyId: args.companyId,
      order: {
        ...order,
        expectedSellingPrice:
          order.expectedSellingPrice === null
            ? null
            : Number(order.expectedSellingPrice)
      },
      lock: false
    });
    const plan = planRefurbishmentCompletion(context.input);
    const { input } = context;
    const currentUnitCost =
      plan.currentSerialUnitCost ?? round(input.currentUnitCost);
    return {
      preview: {
        costingMethod: input.costingMethod,
        treatment: plan.treatment,
        abnormalRework: input.abnormalRework,
        wipTotal: input.wipTotal,
        currentUnitCost,
        newUnitCost:
          plan.newSerialUnitCost ?? plan.averageUnitCost ?? currentUnitCost,
        cap: input.cap,
        writeDown: plan.writeDown,
        warnings: [...context.warnings, ...plan.warnings]
      },
      error: null
    };
  } catch (err) {
    if (err instanceof RefurbishmentCompletionError) {
      return { preview: null, error: err.message };
    }
    logger.error("Failed to preview a refurbishment completion", {
      companyId: args.companyId,
      serviceOrderId: args.serviceOrderId,
      error: err
    });
    return {
      preview: null,
      error:
        err instanceof Error ? err.message : "Failed to preview the completion"
    };
  }
}

/**
 * Cancels an order with no charge that stands: the order goes to Cancelled,
 * its open visits to Cancelled and its project to Closed. An order is refused
 * while one of its ledger rows is not reversed (`openChargeIds`); an order
 * whose every charge is reversed (a timesheet correction, a part return, an
 * expense reversal) can be cancelled. A cancelled Refurbishment releases its
 * serial: On Hold goes back to Available.
 */
export async function cancelServiceOrder(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; serviceOrderId: string; userId: string }
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("serviceOrder")
      .select(["id", "type", "status", "projectId", "trackedEntityId"])
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

    const ledger = await trx
      .selectFrom("projectLedger")
      .select(["id", "reversalOfId"])
      .where("projectId", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .execute();
    const open = openChargeIds(ledger).length;
    if (open > 0) {
      throw new ServiceOrderError(
        `${
          open === 1
            ? "This service order has 1 charge that is not reversed."
            : `This service order has ${open} charges that are not reversed.`
        } Reverse every charge before you cancel the order, or complete the order and write off its billable items.`
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
    // A refurbishment held its serial out of stock; it goes back.
    if (order.type === "Refurbishment") {
      await trx
        .updateTable("trackedEntity")
        .set({ status: "Available", updatedBy: args.userId })
        .where("id", "=", order.trackedEntityId)
        .where("companyId", "=", args.companyId)
        .where("status", "=", "On Hold")
        .execute();
    }
  });
}

/**
 * Changes an open order's coverage contract and keeps its Service project's
 * parent in step: the parent is the new contract's project, or none. A Contract
 * charge that stands (`openChargeIds` over the order's Contract rows) has
 * already posted to the old contract project's account, so the change is
 * refused until the charge is reclassed to another coverage. The contract must
 * be one of the order's customer's contracts; a Refurbishment has none.
 */
export async function updateServiceOrderCoverageContract(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    serviceOrderId: string;
    customerContractId: string | null;
  }
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("serviceOrder")
      .select([
        "id",
        "type",
        "status",
        "projectId",
        "customerId",
        "customerContractId"
      ])
      .where("id", "=", args.serviceOrderId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new ServiceOrderError("The service order was not found");
    if (order.status === "Closed" || order.status === "Cancelled") {
      throw new ServiceOrderError(
        "A closed or cancelled service order cannot change"
      );
    }
    if (order.type === "Refurbishment") {
      throw new ServiceOrderError("A refurbishment has no coverage contract");
    }
    if ((order.customerContractId ?? null) === args.customerContractId) return;

    let contractProjectId: string | null = null;
    if (args.customerContractId) {
      const contract = await trx
        .selectFrom("customerContract")
        .select(["id", "projectId"])
        .where("id", "=", args.customerContractId)
        .where("companyId", "=", args.companyId)
        .where("customerId", "=", order.customerId ?? "")
        .executeTakeFirst();
      if (!contract) {
        throw new ServiceOrderError(
          "The coverage contract is not one of this customer's contracts"
        );
      }
      contractProjectId = contract.projectId;
    }

    const contractCharges = await trx
      .selectFrom("projectLedger")
      .select(["id", "reversalOfId"])
      .where("projectId", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .where("coverage", "=", "Contract")
      .execute();
    const open = openChargeIds(contractCharges).length;
    if (open > 0) {
      throw new ServiceOrderError(
        `${
          open === 1
            ? "1 charge of this order is covered by the contract and has posted to its account."
            : `${open} charges of this order are covered by the contract and have posted to its account.`
        } Override the coverage of each Contract charge to Billable or Warranty first, then change the contract.`
      );
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("serviceOrder")
      .set({
        customerContractId: args.customerContractId,
        updatedBy: args.userId,
        updatedAt: now
      })
      .where("id", "=", order.id)
      .where("companyId", "=", args.companyId)
      .execute();
    await trx
      .updateTable("project")
      .set({
        parentProjectId: contractProjectId,
        updatedBy: args.userId,
        updatedAt: now
      })
      .where("id", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .execute();
  });
}

// --- Charges -------------------------------------------------------------------

const logger = getLogger("erp", "service");

/**
 * The order's project, and that its work tree holds the node. A charge on a
 * node of another order is refused.
 */
export async function requireServiceOrderNode(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    serviceOrderId: string;
    projectElementId?: string | null;
  }
): Promise<{ projectId: string; status: ServiceOrderStatus }> {
  const order = await db
    .selectFrom("serviceOrder")
    .select(["projectId", "status"])
    .where("id", "=", args.serviceOrderId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!order) throw new ServiceOrderError("The service order was not found");
  if (order.status === "Closed" || order.status === "Cancelled") {
    throw new ServiceOrderError(
      `A ${order.status.toLowerCase()} service order takes no charges`
    );
  }
  if (args.projectElementId) {
    const node = await db
      .selectFrom("projectElement")
      .select("id")
      .where("id", "=", args.projectElementId)
      .where("projectId", "=", order.projectId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (!node) {
      throw new ServiceOrderError("The node is not part of this service order");
    }
  }
  return order;
}

/**
 * That the visit is on the order, belongs to the technician and is not done.
 * A technician without `update: "service"` charges and edits only their own
 * open visit; the Kysely writes do not pass through RLS, so the route checks.
 */
export async function requireOwnServiceVisit(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    serviceOrderId: string;
    serviceVisitId: string | null;
    userId: string;
  }
): Promise<void> {
  if (!args.serviceVisitId) {
    throw new ServiceOrderError("You can charge only your own visits");
  }
  const visit = await db
    .selectFrom("serviceVisit")
    .select(["technicianId", "status"])
    .where("id", "=", args.serviceVisitId)
    .where("serviceOrderId", "=", args.serviceOrderId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!visit) throw new ServiceOrderError("The visit was not found");
  if (visit.technicianId !== args.userId) {
    throw new ServiceOrderError("This visit belongs to another technician");
  }
  if (visit.status === "Completed" || visit.status === "Cancelled") {
    throw new ServiceOrderError(
      `A ${visit.status.toLowerCase()} visit takes no changes`
    );
  }
}

/**
 * Logs time on a service order's node as a Draft timesheet entry, with the
 * visit when there is one. Service time posts from Draft: the caller posts it
 * with `postTimesheetEntries` right after. Returns the entry's id.
 */
export async function logServiceTime(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    projectId: string;
    projectElementId: string | null;
    serviceVisitId: string | null;
    laborCategoryId: string;
    entryDate: string;
    hours: number;
    note: string | null;
  }
): Promise<string> {
  const row = await db
    .insertInto("timesheetEntry")
    .values({
      companyId: args.companyId,
      employeeId: args.userId,
      entryDate: args.entryDate,
      projectId: args.projectId,
      projectElementId: args.projectElementId,
      serviceVisitId: args.serviceVisitId,
      laborCategoryId: args.laborCategoryId,
      hours: args.hours,
      note: args.note,
      status: "Draft",
      createdBy: args.userId,
      createdAt: datetime.timestamp()
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Adds an expense to a service order's node and posts it through
 * `post-project-expense`. Returns an error message, or null. The entry stays
 * when the posting fails, so the message says it did not post.
 */
export async function addServiceExpense(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof serviceExpenseValidator> & {
    companyId: string;
    userId: string;
    projectId: string;
  }
): Promise<string | null> {
  const entry = await db
    .insertInto("projectExpenseEntry")
    .values({
      companyId: args.companyId,
      projectId: args.projectId,
      projectElementId: args.projectElementId ?? null,
      serviceVisitId: args.serviceVisitId ?? null,
      employeeId: args.userId,
      entryDate: args.entryDate,
      description: args.description,
      amount: args.amount,
      createdBy: args.userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const posting = await serverFns
    .system({ db, companyId: args.companyId, userId: args.userId })
    .invoke("post-project-expense", { projectExpenseEntryId: entry.id });
  if (posting.error) {
    logger.error("Failed to post a service expense", {
      companyId: args.companyId,
      projectExpenseEntryId: entry.id,
      error: posting.error
    });
    return `The expense is saved but did not post: ${
      posting.error.message || "the posting failed"
    }`;
  }
  return null;
}

/**
 * Moves one charge to another coverage through `reclass-project-coverage`.
 * Returns an error message, or null.
 */
export async function reclassServiceCharge(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof coverageOverrideValidator> & {
    companyId: string;
    userId: string;
    projectLedgerId: string;
  }
): Promise<string | null> {
  const posting = await serverFns
    .system({ db, companyId: args.companyId, userId: args.userId })
    .invoke("reclass-project-coverage", {
      projectLedgerId: args.projectLedgerId,
      coverage: args.coverage,
      reason: args.reason
    });
  if (posting.error) {
    logger.error("Failed to reclass a service charge", {
      companyId: args.companyId,
      projectLedgerId: args.projectLedgerId,
      error: posting.error
    });
    return posting.error.message || "Failed to change the coverage";
  }
  return null;
}

/**
 * Reverses one posted time or expense charge of a service order, with a
 * reason:
 * - time: a timesheet correction to 0 hours (`createTimesheetCorrection`),
 *   posted at once by `post-timesheet`;
 * - an expense: a `projectExpenseEntry` with `reversalOfId`, posted by
 *   `post-project-expense`.
 * Both post at the original's coverage and reverse its billable item. When
 * `onlyVisitId` is set (a technician without `update: "service"`), the charge
 * must belong to that visit. A reversal that exists but did not post is
 * posted again, not written twice. Throws `ServiceOrderError` on a refusal;
 * returns a posting error message, or null.
 */
export async function reverseServiceCharge(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof serviceChargeReversalValidator> & {
    companyId: string;
    userId: string;
    projectId: string;
    onlyVisitId: string | null;
  }
): Promise<string | null> {
  const charge = await db
    .selectFrom("projectLedger")
    .select(["id", "documentType", "documentId", "reversalOfId"])
    .where("id", "=", args.projectLedgerId)
    .where("projectId", "=", args.projectId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!charge) {
    throw new ServiceOrderError("The charge is not on this service order");
  }
  const reversedBy = await db
    .selectFrom("projectLedger")
    .select("id")
    .where("reversalOfId", "=", charge.id)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (
    !canReverseCharge(charge, new Set(reversedBy ? [charge.id] : [])) ||
    !charge.documentId
  ) {
    throw new ServiceOrderError(
      charge.reversalOfId || reversedBy
        ? "This charge is already reversed"
        : "Only time and expenses are reversed here. Return a part with Issue Part."
    );
  }
  const documentId = charge.documentId;
  const requireVisit = (serviceVisitId: string | null) => {
    if (args.onlyVisitId && serviceVisitId !== args.onlyVisitId) {
      throw new ServiceOrderError(
        "You can reverse only the charges of your own visit"
      );
    }
  };

  if (charge.documentType === "Timesheet") {
    const entry = await db
      .selectFrom("timesheetEntry")
      .select(["id", "serviceVisitId"])
      .where("id", "=", documentId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (!entry) throw new ServiceOrderError("The time entry was not found");
    requireVisit(entry.serviceVisitId);

    // A reversal left unposted by a failed posting is posted again.
    const pending = await db
      .selectFrom("timesheetEntry")
      .select("id")
      .where("reversalOfId", "=", entry.id)
      .where("companyId", "=", args.companyId)
      .where("status", "!=", "Posted")
      .executeTakeFirst();
    let reversalId = pending?.id ?? null;
    if (!reversalId) {
      try {
        const correction = await createTimesheetCorrection(db, {
          companyId: args.companyId,
          userId: args.userId,
          timesheetEntryId: entry.id,
          hours: 0,
          correctionReason: args.reason
        });
        reversalId = correction.reversalId;
      } catch (err) {
        throw new ServiceOrderError(
          err instanceof Error ? err.message : "Failed to reverse the time"
        );
      }
    }
    const postingError = await postTimesheetEntries({
      timesheetEntryIds: [reversalId],
      companyId: args.companyId,
      userId: args.userId
    });
    return postingError
      ? `The reversal is saved but did not post: ${postingError}`
      : null;
  }

  const reversalId = await db.transaction().execute(async (trx) => {
    // Row lock: two reversals of one expense must not both write.
    const original = await trx
      .selectFrom("projectExpenseEntry")
      .selectAll()
      .where("id", "=", documentId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!original) throw new ServiceOrderError("The expense was not found");
    requireVisit(original.serviceVisitId);
    if (original.reversalOfId) {
      throw new ServiceOrderError("This charge is already reversed");
    }

    // A reversal left unposted by a failed posting is posted again.
    const existing = await trx
      .selectFrom("projectExpenseEntry")
      .select(["id", "journalId"])
      .where("reversalOfId", "=", original.id)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (existing) {
      const posted = await trx
        .selectFrom("projectLedger")
        .select("id")
        .where("documentType", "=", "Project Expense")
        .where("documentId", "=", existing.id)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (existing.journalId || posted) {
        throw new ServiceOrderError("This charge is already reversed");
      }
      return existing.id;
    }

    const row = await trx
      .insertInto("projectExpenseEntry")
      .values(
        buildExpenseReversal(original, {
          reason: args.reason,
          userId: args.userId
        })
      )
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  });

  const posting = await serverFns
    .system({ db, companyId: args.companyId, userId: args.userId })
    .invoke("post-project-expense", { projectExpenseEntryId: reversalId });
  if (posting.error) {
    logger.error("Failed to post a service expense reversal", {
      companyId: args.companyId,
      projectExpenseEntryId: reversalId,
      error: posting.error
    });
    return `The reversal is saved but did not post: ${
      posting.error.message || "the posting failed"
    }`;
  }
  return null;
}

// --- Visits ----------------------------------------------------------------------

/**
 * Schedules a visit, or moves a scheduled visit's technician and window, in
 * one transaction with the order's status roll-up. A closed or cancelled
 * order takes no visit; only a Scheduled visit can be moved.
 */
export async function scheduleServiceVisit(
  db: Kysely<KyselyDatabase>,
  args: z.infer<typeof serviceVisitValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<{ id: string }> {
  const { companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("serviceOrder")
      .select(["id", "status"])
      .where("id", "=", args.serviceOrderId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new ServiceOrderError("The service order was not found");
    if (order.status === "Closed" || order.status === "Cancelled") {
      throw new ServiceOrderError(
        `A ${order.status.toLowerCase()} service order takes no visits`
      );
    }

    const now = datetime.timestamp();
    let id: string;
    if (args.id) {
      const visit = await trx
        .updateTable("serviceVisit")
        .set({
          technicianId: args.technicianId,
          plannedStart: args.plannedStart ?? null,
          plannedEnd: args.plannedEnd ?? null,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", args.id)
        .where("serviceOrderId", "=", order.id)
        .where("companyId", "=", companyId)
        .where("status", "=", "Scheduled")
        .returning("id")
        .executeTakeFirst();
      if (!visit) {
        throw new ServiceOrderError("Only a scheduled visit can be moved");
      }
      id = visit.id;
    } else {
      const visit = await trx
        .insertInto("serviceVisit")
        .values({
          serviceOrderId: order.id,
          technicianId: args.technicianId,
          plannedStart: args.plannedStart ?? null,
          plannedEnd: args.plannedEnd ?? null,
          companyId,
          createdBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      id = visit.id;
    }

    await syncServiceOrderStatus(trx, {
      companyId,
      serviceOrderId: order.id,
      userId
    });
    return { id };
  });
}

/**
 * Moves a visit to its next status and stamps when it happened: travel
 * started, arrived, completed. A completing visit answers **Work complete?**:
 * yes completes the order, no leaves it In Progress. Then the order's status
 * rolls up, in the same transaction. `technicianId`, when given, limits the
 * change to that technician's own visit.
 */
export async function setServiceVisitStatus(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    serviceOrderId: string;
    serviceVisitId: string;
    status: ServiceVisitStatus;
    workComplete: boolean;
    technicianId?: string;
  }
): Promise<void> {
  const { companyId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const visit = await trx
      .selectFrom("serviceVisit")
      .select(["id", "status", "technicianId"])
      .where("id", "=", args.serviceVisitId)
      .where("serviceOrderId", "=", args.serviceOrderId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!visit) throw new ServiceOrderError("The visit was not found");
    if (args.technicianId && visit.technicianId !== args.technicianId) {
      throw new ServiceOrderError("This visit belongs to another technician");
    }
    if (!canMoveVisit(visit.status, args.status)) {
      throw new ServiceOrderError(
        `A ${visit.status.toLowerCase()} visit cannot move to ${args.status.toLowerCase()}`
      );
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("serviceVisit")
      .set({
        status: args.status,
        ...(args.status === "Traveling" ? { travelStartedAt: now } : {}),
        ...(args.status === "On Site" ? { arrivedAt: now } : {}),
        ...(args.status === "Completed" ? { completedAt: now } : {}),
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", visit.id)
      .where("companyId", "=", companyId)
      .execute();

    await syncServiceOrderStatus(trx, {
      companyId,
      serviceOrderId: args.serviceOrderId,
      userId,
      workComplete: args.status === "Completed" && args.workComplete
    });
  });
}
