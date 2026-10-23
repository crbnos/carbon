// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The receipt of a Return for Service or Return for Warranty line on an RMA.
// The unit stays the customer's: no stock ledger, no cost layer, no journal,
// and its serial stays Consumed. Each received line gets one Open service job
// at the receiving location (the depot), and its customer asset goes At Depot.
// Spec: .ai/specs/2026-10-22-service-jobs-and-returns.md (The RMA, item 4).

import { InvalidInputError } from "@carbon/api/errors";
import type { Database } from "@carbon/database";
import type { KyselyDatabase as DB } from "@carbon/database/client";
import * as sequence from "@carbon/database/sequence";
import { datetime } from "@carbon/utils";
import type { Transaction } from "kysely";

type ReturnLineType = Database["public"]["Enums"]["returnType"];

/** A line of one of these types is serviced, not restocked. */
export function isServiceReturnType(returnType: ReturnLineType): boolean {
  return (
    returnType === "Return for Service" || returnType === "Return for Warranty"
  );
}

/** A received Service or Warranty line, as the receipt posts it. */
export type ServiceReturnUnit = {
  salesReturnOrderLineId: string;
  returnType: ReturnLineType;
  itemId: string;
  /** The serial received on the line, else null. */
  trackedEntityId: string | null;
  /** The asset the RMA line names, else null. */
  customerAssetId: string | null;
  problem: string | null;
  /** The receiving location: the depot that does the work. */
  locationId: string;
};

/**
 * Creates the service jobs of an RMA receipt, in the posting transaction:
 * 1. Skips a line that already has a live (not Cancelled) job.
 * 2. Finds or creates the customer asset of each received serial, and sets
 *    every unit's asset At Depot.
 * 3. Inserts one Open Depot job per line: Billable for Return for Service,
 *    Warranty for Return for Warranty, with the RMA's customer, site and
 *    contact, and the line's item, serial, asset and problem.
 * 4. Writes a `Return Receipt` activity per serial with `At Depot` and the
 *    job's id, and the serial as its output.
 */
export async function createServiceJobsForReturn(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    today: string;
    receiptId: string;
    receiptReadableId: string;
    salesReturnOrder: Pick<
      Database["public"]["Tables"]["salesReturnOrder"]["Row"],
      "id" | "customerId" | "customerLocationId" | "customerContactId"
    >;
    units: ServiceReturnUnit[];
  }
): Promise<void> {
  const { companyId, userId, salesReturnOrder } = args;
  if (args.units.length === 0) return;

  const live = await trx
    .selectFrom("serviceJob")
    .select("salesReturnOrderLineId")
    .where(
      "salesReturnOrderLineId",
      "in",
      args.units.map((unit) => unit.salesReturnOrderLineId)
    )
    .where("status", "!=", "Cancelled")
    .where("companyId", "=", companyId)
    .execute();
  const hasJob = new Set(live.map((job) => job.salesReturnOrderLineId));
  const units = args.units.filter(
    (unit) => !hasJob.has(unit.salesReturnOrderLineId)
  );
  if (units.length === 0) return;

  const assetBySerial = await ensureCustomerAssets(trx, {
    companyId,
    userId,
    trackedEntityIds: units.flatMap((unit) =>
      unit.trackedEntityId ? [unit.trackedEntityId] : []
    ),
    customerId: salesReturnOrder.customerId,
    customerLocationId: salesReturnOrder.customerLocationId
  });
  const assetOf = (unit: ServiceReturnUnit) =>
    (unit.trackedEntityId ? assetBySerial.get(unit.trackedEntityId) : null) ??
    unit.customerAssetId;

  const assetIds = [...new Set(units.flatMap((unit) => assetOf(unit) ?? []))];
  if (assetIds.length > 0) {
    await trx
      .updateTable("customerAsset")
      .set({
        status: "At Depot",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "in", assetIds)
      .where("companyId", "=", companyId)
      .execute();
  }

  // A line that names an asset but received no serial is the asset's unit.
  const serialOfAsset = new Map<string, string>();
  const unitAssetIds = units.flatMap((unit) =>
    !unit.trackedEntityId && unit.customerAssetId ? [unit.customerAssetId] : []
  );
  if (unitAssetIds.length > 0) {
    const assets = await trx
      .selectFrom("customerAsset")
      .select(["id", "trackedEntityId"])
      .where("id", "in", unitAssetIds)
      .where("companyId", "=", companyId)
      .execute();
    for (const asset of assets) {
      serialOfAsset.set(asset.id, asset.trackedEntityId);
    }
  }

  const numbers = await sequence.getNextSequences(
    trx,
    "serviceJob",
    companyId,
    units.length
  );
  const jobs = await trx
    .insertInto("serviceJob")
    .values(
      units.map((unit, index) => {
        const customerAssetId = assetOf(unit);
        return {
          serviceJobId: numbers[index]!,
          status: "Open" as const,
          coverage:
            unit.returnType === "Return for Warranty"
              ? ("Warranty" as const)
              : ("Billable" as const),
          workSite: "Depot" as const,
          customerId: salesReturnOrder.customerId,
          customerLocationId: salesReturnOrder.customerLocationId,
          customerContactId: salesReturnOrder.customerContactId,
          customerAssetId,
          itemId: unit.itemId,
          trackedEntityId:
            unit.trackedEntityId ??
            (customerAssetId ? serialOfAsset.get(customerAssetId) : null) ??
            null,
          locationId: unit.locationId,
          salesReturnOrderLineId: unit.salesReturnOrderLineId,
          problem: unit.problem,
          companyId,
          createdBy: userId
        };
      })
    )
    .returning(["id", "salesReturnOrderLineId", "trackedEntityId"])
    .execute();

  const serialJobs = jobs.filter((job) => job.trackedEntityId);
  if (serialJobs.length === 0) return;
  const activities = await trx
    .insertInto("trackedActivity")
    .values(
      serialJobs.map((job) => ({
        type: "Return Receipt",
        sourceDocument: "Receipt",
        sourceDocumentId: args.receiptId,
        sourceDocumentReadableId: args.receiptReadableId,
        attributes: {
          "Sales Return Order": salesReturnOrder.id,
          Receipt: args.receiptId,
          Employee: userId,
          "At Depot": true,
          "Service Job": job.id
        },
        companyId,
        createdBy: userId,
        createdAt: args.today
      }))
    )
    .returning(["id", "attributes"])
    .execute();
  const serialOfJob = new Map(
    serialJobs.map((job) => [job.id, job.trackedEntityId as string])
  );
  await trx
    .insertInto("trackedActivityOutput")
    .values(
      activities.map((activity) => ({
        trackedActivityId: activity.id,
        trackedEntityId: serialOfJob.get(
          (activity.attributes as Record<string, string>)["Service Job"]!
        )!,
        quantity: 1,
        companyId,
        createdBy: userId,
        createdAt: args.today
      }))
    )
    .execute();
}

/**
 * Finds or creates one customer asset per serial (source Manual) for the
 * RMA's customer and site. Returns the asset id per serial.
 */
async function ensureCustomerAssets(
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
  if (missing.some((id) => !itemBySerial.get(id))) {
    throw new InvalidInputError(
      "The serial has no item, so it cannot be a customer asset"
    );
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
 * The void of an RMA receipt, in the void transaction: cancels the live jobs
 * of the received lines and sets their assets back In Service. Refuses when a
 * job has work on it: a status past Open, a time entry, or an issued part.
 */
export async function voidServiceJobsForReturn(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    salesReturnOrderLineIds: string[];
  }
): Promise<void> {
  const { companyId, userId } = args;
  if (args.salesReturnOrderLineIds.length === 0) return;

  const jobs = await trx
    .selectFrom("serviceJob")
    .select(["id", "serviceJobId", "status", "customerAssetId"])
    .where("salesReturnOrderLineId", "in", args.salesReturnOrderLineIds)
    .where("status", "!=", "Cancelled")
    .where("companyId", "=", companyId)
    .forUpdate()
    .execute();
  if (jobs.length === 0) return;
  const jobIds = jobs.map((job) => job.id);

  const [time, parts] = await Promise.all([
    trx
      .selectFrom("serviceJobTime")
      .select("serviceJobId")
      .where("serviceJobId", "in", jobIds)
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("serviceJobItem")
      .select("serviceJobId")
      .where("serviceJobId", "in", jobIds)
      .where("lineType", "=", "Part")
      .where("companyId", "=", companyId)
      .execute()
  ]);
  const worked = new Set([
    ...time.map((row) => row.serviceJobId),
    ...parts.map((row) => row.serviceJobId)
  ]);
  const busy = jobs.find((job) => job.status !== "Open" || worked.has(job.id));
  if (busy) {
    throw new InvalidInputError(
      `Service job ${busy.serviceJobId} has work on it. Cancel the job first.`
    );
  }

  const now = datetime.timestamp();
  await trx
    .updateTable("serviceJob")
    .set({ status: "Cancelled", updatedBy: userId, updatedAt: now })
    .where("id", "in", jobIds)
    .where("companyId", "=", companyId)
    .execute();
  const assetIds = jobs.flatMap((job) => job.customerAssetId ?? []);
  if (assetIds.length > 0) {
    await trx
      .updateTable("customerAsset")
      .set({ status: "In Service", updatedBy: userId, updatedAt: now })
      .where("id", "in", assetIds)
      .where("status", "=", "At Depot")
      .where("companyId", "=", companyId)
      .execute();
  }
}
