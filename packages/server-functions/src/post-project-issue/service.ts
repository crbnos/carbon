// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A part issued to a node of a service order: its billable item, the
// component it installs in the customer asset, the component it replaces, and
// the `Service` genealogy activity. A return undoes all of them.
// Spec: .ai/specs/2026-10-08-field-service.md (Components, Parts).

import type { KyselyDatabase as DB } from "@carbon/database/client";
import { datetime, round, type ServiceCoverage } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { sql, type Transaction } from "kysely";
import {
  buildBillableItem,
  ProjectChargeError,
  reverseBillableItem,
  type ServicePostingContext
} from "../lib/project-posting";

/**
 * The attribute that ties a `Service` activity to the issue that wrote it:
 * the issue's item ledger id, which a coverage reclass does not change.
 */
const ISSUE_ATTRIBUTE = "Project Issue";

/** An open issue a return reverses: its ledger row and coverage. */
export type ServiceIssue = {
  id: string;
  /** The issue's itemLedger row. */
  documentId: string;
  coverage: ServiceCoverage | null;
  coverageReason: string | null;
};

/**
 * The issue a service return reverses: the named one, else the latest open
 * issue of the same item (and serial or batch) to the same node. An issue is
 * open while no ledger row reverses it. A return takes the whole issue.
 */
export async function findServiceIssueToReturn(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    projectId: string;
    projectElementId: string | null;
    itemId: string;
    trackedEntityId: string | null;
    quantity: number;
    returnOfProjectLedgerId: string | null;
  }
): Promise<ServiceIssue> {
  const { rows } = await sql<{
    id: string;
    documentId: string;
    quantity: number;
    coverage: ServiceCoverage | null;
    coverageReason: string | null;
  }>`
    SELECT pl."id", pl."documentId", pl."quantity", pl."coverage", pl."coverageReason"
    FROM "projectLedger" pl
    JOIN "itemLedger" il ON il."id" = pl."documentId" AND il."companyId" = pl."companyId"
    WHERE pl."companyId" = ${args.companyId}
      AND pl."projectId" = ${args.projectId}
      AND pl."projectElementId" IS NOT DISTINCT FROM ${args.projectElementId}
      AND pl."itemId" = ${args.itemId}
      AND pl."documentType" = 'Project Issue'
      AND pl."reversalOfId" IS NULL
      AND pl."quantity" > 0
      AND il."trackedEntityId" IS NOT DISTINCT FROM ${args.trackedEntityId}
      AND (${args.returnOfProjectLedgerId}::text IS NULL OR pl."id" = ${args.returnOfProjectLedgerId})
      AND NOT EXISTS (
        SELECT 1 FROM "projectLedger" r
        WHERE r."reversalOfId" = pl."id" AND r."companyId" = pl."companyId"
      )
    ORDER BY pl."createdAt" DESC, pl."id" DESC
  `.execute(trx);

  const issue = rows.find(
    (row) => round(Number(row.quantity)) === round(args.quantity)
  );
  if (!issue) {
    throw new ProjectChargeError(
      rows.length === 0
        ? "No open issue of this part to this node matches the return"
        : "Return the whole quantity of one issue"
    );
  }
  return {
    id: issue.id,
    documentId: issue.documentId,
    coverage: issue.coverage,
    coverageReason: issue.coverageReason
  };
}

/**
 * The billable item of an issue, and on a customer unit (a Field Visit or
 * Depot Repair order with an asset) the install: one component row for the
 * issued part, the removal of the node's installed component, and a
 * `Service` activity from the issued serial or batch to the asset's serial.
 */
export async function installServicePart(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    service: ServicePostingContext;
    projectId: string;
    projectElementId: string | null;
    projectLedgerId: string;
    itemLedgerId: string;
    itemId: string;
    itemName: string;
    trackedEntityId: string | null;
    quantity: number;
    postingDate: string;
    coverage: ServiceCoverage;
  }
): Promise<void> {
  const { companyId, userId, service } = args;

  const sales = await trx
    .selectFrom("itemUnitSalePrice")
    .select(["unitSalePrice", "partsWarrantyMonths"])
    .where("itemId", "=", args.itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  const item = buildBillableItem({
    ledgerRow: {
      id: args.projectLedgerId,
      companyId,
      projectId: args.projectId,
      projectElementId: args.projectElementId,
      costType: "Material",
      quantity: args.quantity,
      amount: 0,
      itemId: args.itemId,
      createdBy: userId
    },
    coverage: args.coverage,
    laborPrice: null,
    partPrice: sales ? Number(sales.unitSalePrice) : null,
    description: args.itemName
  });
  if (item) {
    await trx.insertInto("projectBillableItem").values(item).execute();
  }

  if (
    !service.customerAssetId ||
    (service.orderType !== "Field Visit" &&
      service.orderType !== "Depot Repair")
  ) {
    return;
  }

  const months = sales?.partsWarrantyMonths ?? null;
  await trx
    .insertInto("customerAssetComponent")
    .values({
      customerAssetId: service.customerAssetId,
      itemId: args.itemId,
      trackedEntityId: args.trackedEntityId,
      quantity: args.quantity,
      installedDate: args.postingDate,
      partsWarrantyEndDate:
        months === null
          ? null
          : parseDate(args.postingDate).add({ months }).toString(),
      serviceOrderId: service.serviceOrderId,
      projectElementId: args.projectElementId,
      projectLedgerId: args.projectLedgerId,
      companyId,
      createdBy: userId
    })
    .execute();

  // The node links an installed component: this part replaces it.
  if (service.componentId) {
    await trx
      .updateTable("customerAssetComponent")
      .set({
        removedDate: args.postingDate,
        removedByServiceOrderId: service.serviceOrderId,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", service.componentId)
      .where("companyId", "=", companyId)
      .execute();
  }

  if (args.trackedEntityId && service.assetTrackedEntityId) {
    const activity = await trx
      .insertInto("trackedActivity")
      .values({
        type: "Service",
        sourceDocument: "Service Order",
        sourceDocumentId: service.serviceOrderId,
        sourceDocumentReadableId: service.serviceOrderReadableId,
        attributes: { [ISSUE_ATTRIBUTE]: args.itemLedgerId },
        companyId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("trackedActivityInput")
      .values({
        trackedActivityId: activity.id,
        trackedEntityId: args.trackedEntityId,
        quantity: args.quantity,
        companyId,
        createdBy: userId
      })
      .execute();
    await trx
      .insertInto("trackedActivityOutput")
      .values({
        trackedActivityId: activity.id,
        trackedEntityId: service.assetTrackedEntityId,
        quantity: 1,
        companyId,
        createdBy: userId
      })
      .execute();
  }
}

/**
 * Undoes an issue's service rows for its return: reverses the billable item
 * (written off while unbilled, else a negative copy on the return's ledger
 * row), deletes the components the issue installed and its `Service`
 * activity, and puts the replaced component back when no other part from
 * this order still sits on the node.
 */
export async function uninstallServicePart(
  trx: Transaction<DB>,
  args: {
    companyId: string;
    userId: string;
    service: ServicePostingContext;
    projectElementId: string | null;
    issueLedgerId: string;
    issueItemLedgerId: string;
    returnLedgerId: string;
  }
): Promise<void> {
  const { companyId, userId, service } = args;
  const now = datetime.timestamp();

  const original = await trx
    .selectFrom("projectBillableItem")
    .selectAll()
    .where("projectLedgerId", "=", args.issueLedgerId)
    .where("reversalOfId", "is", null)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (original) {
    const reversal = reverseBillableItem(original, {
      projectLedgerId: args.returnLedgerId,
      createdBy: userId
    });
    if (reversal.update) {
      await trx
        .updateTable("projectBillableItem")
        .set({ ...reversal.update, updatedBy: userId, updatedAt: now })
        .where("id", "=", original.id)
        .where("companyId", "=", companyId)
        .execute();
    }
    if (reversal.insert) {
      await trx
        .insertInto("projectBillableItem")
        .values(reversal.insert)
        .execute();
    }
  }

  const removed = await trx
    .deleteFrom("customerAssetComponent")
    .where("projectLedgerId", "=", args.issueLedgerId)
    .where("companyId", "=", companyId)
    .returning("id")
    .execute();

  await sql`
    DELETE FROM "trackedActivity"
    WHERE "type" = 'Service'
      AND "companyId" = ${companyId}
      AND "attributes" @> ${JSON.stringify({
        [ISSUE_ATTRIBUTE]: args.issueItemLedgerId
      })}::jsonb
  `.execute(trx);

  // Put the node's replaced component back, unless another part this order
  // installed on the node still replaces it.
  if (
    removed.length === 0 ||
    !args.projectElementId ||
    !service.customerAssetId
  )
    return;
  await sql`
    UPDATE "customerAssetComponent" c
    SET "removedDate" = NULL,
        "removedByServiceOrderId" = NULL,
        "updatedBy" = ${userId},
        "updatedAt" = ${now}::timestamptz
    FROM "projectElement" e
    WHERE e."id" = ${args.projectElementId}
      AND e."companyId" = ${companyId}
      AND c."trackedEntityId" = e."trackedEntityId"
      AND c."companyId" = ${companyId}
      AND c."customerAssetId" = ${service.customerAssetId}
      AND c."removedByServiceOrderId" = ${service.serviceOrderId}
      AND c."removedDate" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "customerAssetComponent" other
        WHERE other."serviceOrderId" = ${service.serviceOrderId}
          AND other."projectElementId" = ${args.projectElementId}
          AND other."companyId" = ${companyId}
          AND other."removedDate" IS NULL
      )
  `.execute(trx);
}
