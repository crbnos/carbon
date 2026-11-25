// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The project Materials page (`get_project_materials`): one row per plan line
// and one Unplanned row per element and item with issues, PO lines or jobs no
// plan line links. Spec `.ai/specs/2026-11-25-project-materials-page.md`.

import type { Database } from "@carbon/database";
import { sql } from "kysely";
import { expect, it } from "vitest";
import {
  issueMaterial,
  postReceipt as postReceiptBody
} from "../../app/modules/inventory/inventory.service";
import {
  getProjectMaterials,
  postProjectIssue
} from "../../app/modules/projects/projects.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import { localAnonClient } from "./fixtures/local-supabase";
import { projectPostingFixture } from "./fixtures/project-posting";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;
type MethodType = Database["public"]["Enums"]["methodType"];

const anon = hasLocalDatabase ? localAnonClient() : null;

async function materials(f: Fixture) {
  const result = await getProjectMaterials(f.db, {
    companyId: f.companyId,
    projectId: f.projectId
  });
  return result.rows;
}

/** The fields a row's tests assert, without the display joins. */
function summary(row: Awaited<ReturnType<typeof materials>>[number]) {
  return {
    rowKind: row.rowKind,
    projectElementId: row.projectElementId,
    itemId: row.itemId,
    methodType: row.methodType,
    quantityRequired: row.quantityRequired,
    quantityOrdered: row.quantityOrdered,
    quantityReceived: row.quantityReceived,
    quantityIssued: row.quantityIssued,
    quantityRemaining: row.quantityRemaining,
    issueStatus: row.issueStatus,
    supplies: row.supplies
  };
}

async function addPlanLine(
  f: Fixture,
  args: {
    itemId: string;
    quantity: number;
    methodType: MethodType;
    purchaseOrderLineId?: string;
    jobId?: string;
  }
) {
  const row = await f.db
    .insertInto("projectElementMaterial")
    .values({
      projectId: f.projectId,
      projectElementId: f.elementId,
      itemId: args.itemId,
      quantity: args.quantity,
      methodType: args.methodType,
      purchaseOrderLineId: args.purchaseOrderLineId ?? null,
      jobId: args.jobId ?? null,
      companyId: f.companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** A charged PO of one line for a new item, at the location of a stocked
 *  filler item. */
async function chargedPurchaseOrder(
  f: Fixture,
  key: string,
  quantity: number
) {
  const { locationId } = await f.addStockedItem(`${key}-filler`, {
    quantity: 1,
    unitCost: 1
  });
  const { itemId } = await f.addItem(key, { itemTrackingType: "Inventory" });
  const po = await f.addPurchaseOrder(key, {
    locationId,
    lines: [{ itemId, quantity, unitPrice: 10, charged: true }]
  });
  return { locationId, itemId, ...po, lineId: po.lineIds[0]! };
}

/** Receives `quantity` of the PO's line through a posted receipt. */
async function receive(
  f: Fixture,
  po: Awaited<ReturnType<typeof chargedPurchaseOrder>>,
  quantity: number
) {
  const receipt = await f.addReceipt(`${po.purchaseOrderId}-${quantity}`, {
    locationId: po.locationId,
    purchaseOrderId: po.purchaseOrderId,
    supplierId: po.supplierId,
    lines: [
      { lineId: po.lineId, itemId: po.itemId, quantity, unitPrice: 10 }
    ]
  });
  const posted = await invokePosting(
    handlesOf(f.ctx),
    "post-receipt",
    { receiptId: receipt.receiptId },
    postReceiptBody
  );
  expect(posted.error).toBeNull();
}

async function purchaseOrderStatus(f: Fixture, purchaseOrderId: string) {
  const row = await f.db
    .selectFrom("purchaseOrder")
    .select("status")
    .where("id", "=", purchaseOrderId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return row.status;
}

async function jobStatus(f: Fixture, jobId: string) {
  const row = await f.db
    .selectFrom("job")
    .select("status")
    .where("id", "=", jobId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return row.status;
}

const projectIssue = (
  f: Fixture,
  args: {
    itemId: string;
    locationId: string;
    quantity: number;
    direction: "Issue" | "Return";
  }
) =>
  invokePosting(
    handlesOf(f.ctx),
    "post-project-issue",
    { projectId: f.projectId, projectElementId: f.elementId, ...args },
    postProjectIssue
  );

/** A Contract project with project stock that charges at receipt, and
 *  `charged` units of a new item received into its stock. */
async function chargedStock(f: Fixture, charged: number) {
  await f.enableProjectStock();
  await f.db
    .updateTable("project")
    .set({ chargeAtReceipt: true })
    .where("id", "=", f.projectId)
    .where("companyId", "=", f.companyId)
    .execute();
  const po = await chargedPurchaseOrder(f, "charged", charged);
  await receive(f, po, charged);
  return po;
}

/** The quantities of the project's Project Issue ledger rows, in order. */
async function projectIssueQuantities(f: Fixture) {
  const rows = await f.db
    .selectFrom("projectLedger")
    .select("quantity")
    .where("projectId", "=", f.projectId)
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "Project Issue")
    .orderBy("createdAt")
    .orderBy("quantity", "desc")
    .execute();
  return rows.map((row) => Number(row.quantity));
}

databaseTest(
  "a Purchase to Order line shows its PO line's ordered and received quantity, and stock received to the project is not issued",
  async () => {
    const f = await projectPostingFixture();
    try {
      await f.enableProjectStock();
      const po = await chargedPurchaseOrder(f, "bracket", 10);
      const planId = await addPlanLine(f, {
        itemId: po.itemId,
        quantity: 10,
        methodType: "Purchase to Order",
        purchaseOrderLineId: po.lineId
      });
      await receive(f, po, 4);

      const rows = await materials(f);
      expect(rows.map(summary)).toEqual([
        {
          rowKind: "Plan",
          projectElementId: f.elementId,
          itemId: po.itemId,
          methodType: "Purchase to Order",
          quantityRequired: 10,
          quantityOrdered: 10,
          quantityReceived: 4,
          quantityIssued: 0,
          quantityRemaining: 10,
          issueStatus: "Not issued",
          supplies: [
            {
              type: "Purchase Order",
              documentId: po.purchaseOrderId,
              readableId: `${f.prefix}-PO-bracket`,
              lineId: po.lineId,
              status: await purchaseOrderStatus(f, po.purchaseOrderId)
            }
          ]
        }
      ]);
      expect(rows[0]!.projectElementMaterialId).toEqual(planId);
      expect(rows[0]!.projectOnHand).toEqual(4);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a PO line the project consumes at receipt counts its received quantity as issued",
  async () => {
    const f = await projectPostingFixture();
    try {
      const po = await chargedPurchaseOrder(f, "panel", 10);
      await addPlanLine(f, {
        itemId: po.itemId,
        quantity: 10,
        methodType: "Purchase to Order",
        purchaseOrderLineId: po.lineId
      });
      await receive(f, po, 10);

      const rows = await materials(f);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        rowKind: "Plan",
        quantityOrdered: 10,
        quantityReceived: 10,
        quantityIssued: 10,
        quantityRemaining: 0,
        issueStatus: "Issued"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Make to Order line counts the completed units of its consume-to-project job as received and issued",
  async () => {
    const f = await projectPostingFixture();
    try {
      const { locationId, itemId } = await f.addStockedItem("rivet", {
        quantity: 10,
        unitCost: 1
      });
      const job = await f.addConsumeToProjectJob("assy", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 1,
        jobQuantity: 5
      });
      await addPlanLine(f, {
        itemId: job.finishedItemId,
        quantity: 5,
        methodType: "Make to Order",
        jobId: job.jobId
      });
      await f.db
        .updateTable("job")
        .set({ quantityComplete: 2 })
        .where("id", "=", job.jobId)
        .where("companyId", "=", f.companyId)
        .execute();

      const rows = await materials(f);
      expect(rows.map(summary)).toEqual([
        {
          rowKind: "Plan",
          projectElementId: f.elementId,
          itemId: job.finishedItemId,
          methodType: "Make to Order",
          quantityRequired: 5,
          quantityOrdered: 5,
          quantityReceived: 2,
          quantityIssued: 2,
          quantityRemaining: 3,
          issueStatus: "Partly issued",
          supplies: [
            {
              type: "Job",
              documentId: job.jobId,
              readableId: `${f.prefix}-J-assy`,
              lineId: null,
              status: await jobStatus(f, job.jobId)
            }
          ]
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Purchase to Order line that links no PO line has no supply",
  async () => {
    const f = await projectPostingFixture();
    try {
      const { itemId } = await f.addItem("bezel", {
        itemTrackingType: "Inventory"
      });
      await addPlanLine(f, {
        itemId,
        quantity: 6,
        methodType: "Purchase to Order"
      });

      const rows = await materials(f);
      expect(rows.map(summary)).toEqual([
        {
          rowKind: "Plan",
          projectElementId: f.elementId,
          itemId,
          methodType: "Purchase to Order",
          quantityRequired: 6,
          quantityOrdered: 0,
          quantityReceived: 0,
          quantityIssued: 0,
          quantityRemaining: 6,
          issueStatus: "Not issued",
          supplies: []
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a PO line of a Closed PO orders only what it received",
  async () => {
    const f = await projectPostingFixture();
    try {
      await f.enableProjectStock();
      const po = await chargedPurchaseOrder(f, "shim", 10);
      await addPlanLine(f, {
        itemId: po.itemId,
        quantity: 10,
        methodType: "Purchase to Order",
        purchaseOrderLineId: po.lineId
      });
      await receive(f, po, 3);
      await f.db
        .updateTable("purchaseOrder")
        .set({ status: "Closed" })
        .where("id", "=", po.purchaseOrderId)
        .where("companyId", "=", f.companyId)
        .execute();

      const rows = await materials(f);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        quantityOrdered: 3,
        quantityReceived: 3,
        quantityIssued: 0
      });
      expect(rows[0]!.supplies[0]!.status).toEqual("Closed");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an issue to an element with no plan line for the item is one Unplanned row with the net issued quantity",
  async () => {
    const f = await projectPostingFixture();
    try {
      const { itemId, locationId } = await f.addStockedItem("bolt", {
        quantity: 10,
        unitCost: 10
      });
      const issued = await projectIssue(f, {
        itemId,
        locationId,
        quantity: 3,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      const returned = await projectIssue(f, {
        itemId,
        locationId,
        quantity: 1,
        direction: "Return"
      });
      expect(returned.error).toBeNull();

      const rows = await materials(f);
      expect(rows.map(summary)).toEqual([
        {
          rowKind: "Unplanned",
          projectElementId: f.elementId,
          itemId,
          methodType: null,
          quantityRequired: 0,
          quantityOrdered: 0,
          quantityReceived: 0,
          quantityIssued: 2,
          quantityRemaining: null,
          issueStatus: "Unplanned",
          supplies: []
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an issue of stock charged at receipt counts the project side of the relocation pair once",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      const po = await chargedStock(f, 3);
      const issued = await projectIssue(f, {
        itemId: po.itemId,
        locationId: po.locationId,
        quantity: 3,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      // The issue wrote a relocation pair: project side +3, inventory side −3.
      expect(await projectIssueQuantities(f)).toEqual([3, -3]);

      const rows = await materials(f);
      const row = rows.find((r) => r.itemId === po.itemId);
      expect(rows.filter((r) => r.itemId === po.itemId)).toHaveLength(1);
      expect(row).toMatchObject({
        rowKind: "Unplanned",
        projectElementId: f.elementId,
        quantityOrdered: 3,
        quantityReceived: 3,
        quantityIssued: 3
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an issue of more units than were charged at receipt counts the relocated and the ordinary units",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Contract" });
    try {
      const po = await chargedStock(f, 3);
      // 2 more units in the project's stock that the receipt never charged.
      await f.addStripeStock({
        itemId: po.itemId,
        locationId: po.locationId,
        projectId: f.projectId,
        quantity: 2,
        unitCost: 10,
        postingDate: "2026-10-23"
      });
      const issued = await projectIssue(f, {
        itemId: po.itemId,
        locationId: po.locationId,
        quantity: 5,
        direction: "Issue"
      });
      expect(issued.error).toBeNull();
      // +3 and −3 of the relocation pair, then +2 ordinary.
      expect(
        (await projectIssueQuantities(f)).sort((x, y) => x - y)
      ).toEqual([-3, 2, 3]);

      const rows = await materials(f);
      expect(rows.filter((r) => r.itemId === po.itemId)).toHaveLength(1);
      expect(rows.find((r) => r.itemId === po.itemId)).toMatchObject({
        rowKind: "Unplanned",
        quantityIssued: 5
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a job of the project's element that no plan line links is an Unplanned row with the job as its supply",
  async () => {
    const f = await projectPostingFixture();
    try {
      const { locationId, itemId } = await f.addStockedItem("pin", {
        quantity: 10,
        unitCost: 1
      });
      const job = await f.addConsumeToProjectJob("frame", {
        locationId,
        materialItemId: itemId,
        quantityPerParent: 1,
        jobQuantity: 4
      });

      const rows = await materials(f);
      expect(rows.map(summary)).toEqual([
        {
          rowKind: "Unplanned",
          projectElementId: f.elementId,
          itemId: job.finishedItemId,
          methodType: null,
          quantityRequired: 0,
          quantityOrdered: 4,
          quantityReceived: 0,
          quantityIssued: 0,
          quantityRemaining: null,
          issueStatus: "Unplanned",
          supplies: [
            {
              type: "Job",
              documentId: job.jobId,
              readableId: `${f.prefix}-J-frame`,
              lineId: null,
              status: await jobStatus(f, job.jobId)
            }
          ]
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a PO line charged to the project with no element is an Unplanned row with no element",
  async () => {
    const f = await projectPostingFixture();
    try {
      const po = await chargedPurchaseOrder(f, "cable", 7);
      await f.db
        .updateTable("purchaseOrderLine")
        .set({ projectElementId: null })
        .where("id", "=", po.lineId)
        .where("companyId", "=", f.companyId)
        .execute();

      const rows = await materials(f);
      expect(rows.map(summary)).toEqual([
        {
          rowKind: "Unplanned",
          projectElementId: null,
          itemId: po.itemId,
          methodType: null,
          quantityRequired: 0,
          quantityOrdered: 7,
          quantityReceived: 0,
          quantityIssued: 0,
          quantityRemaining: null,
          issueStatus: "Unplanned",
          supplies: [
            {
              type: "Purchase Order",
              documentId: po.purchaseOrderId,
              readableId: `${f.prefix}-PO-cable`,
              lineId: po.lineId,
              status: "To Receive"
            }
          ]
        }
      ]);
      expect(rows[0]!.elementReadableId).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the components a consume-to-project job consumes make no Unplanned row",
  async () => {
    const f = await projectPostingFixture();
    try {
      const a = await f.addStockedItem("comp-a", {
        quantity: 10,
        unitCost: 2
      });
      const b = await f.addItem("comp-b", { itemTrackingType: "Inventory" });
      await f.addStripeStock({
        itemId: b.itemId,
        locationId: a.locationId,
        projectId: null,
        quantity: 10,
        unitCost: 3
      });
      const job = await f.addConsumeToProjectJob("box", {
        locationId: a.locationId,
        materialItemId: a.itemId,
        quantityPerParent: 2,
        jobQuantity: 1
      });
      await f.db
        .insertInto("jobMaterial")
        .values({
          jobId: job.jobId,
          jobMakeMethodId: job.makeMethodId,
          jobOperationId: job.operationId,
          itemId: b.itemId,
          itemType: "Part",
          methodType: "Pull from Inventory",
          description: "Material B",
          quantity: 3,
          estimatedQuantity: 3,
          defaultStorageUnit: false,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      const backflush = await invokePosting(
        handlesOf(f.ctx),
        "issue",
        { type: "jobOperation", id: job.operationId, quantity: 1 },
        issueMaterial
      );
      expect(backflush.error).toBeNull();
      // Both components charged the project.
      const charged = await f.db
        .selectFrom("projectLedger")
        .select("itemId")
        .distinct()
        .where("projectId", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .where("itemId", "in", [a.itemId, b.itemId])
        .execute();
      expect(charged.map((row) => row.itemId).sort()).toEqual(
        [a.itemId, b.itemId].sort()
      );

      const rows = await materials(f);
      expect(rows.map((row) => [row.rowKind, row.itemId])).toEqual([
        ["Unplanned", job.finishedItemId]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a call with one company's id and another company's project returns no rows",
  async () => {
    const f = await projectPostingFixture();
    const g = await projectPostingFixture();
    try {
      const { itemId } = await g.addItem("nut", {
        itemTrackingType: "Inventory"
      });
      await addPlanLine(g, {
        itemId,
        quantity: 2,
        methodType: "Pull from Inventory"
      });
      expect(await materials(g)).toHaveLength(1);

      const crossed = await sql`
        SELECT * FROM get_project_materials(${g.projectId}, ${f.companyId})
      `.execute(f.db);
      expect(crossed.rows).toEqual([]);
    } finally {
      await g.cleanup();
      await f.cleanup();
    }
  }
);

it.skipIf(!anon)(
  "an anonymous caller reads no rows through the API",
  async () => {
    const f = await projectPostingFixture();
    try {
      const { itemId } = await f.addItem("washer", {
        itemTrackingType: "Inventory"
      });
      await addPlanLine(f, {
        itemId,
        quantity: 2,
        methodType: "Pull from Inventory"
      });
      expect(await materials(f)).toHaveLength(1);

      const { data, error } = await anon!.rpc("get_project_materials", {
        project_id: f.projectId,
        company_id: f.companyId
      });
      if (error) {
        expect(data).toBeNull();
      } else {
        expect(data).toEqual([]);
      }
    } finally {
      await f.cleanup();
    }
  },
  60_000
);

databaseTest(
  "the stock columns are empty without project stock and show the project's and the location's unassigned stock with it",
  async () => {
    const f = await projectPostingFixture();
    try {
      const { itemId, locationId } = await f.addStockedItem("gasket", {
        quantity: 10,
        unitCost: 1
      });
      await addPlanLine(f, {
        itemId,
        quantity: 5,
        methodType: "Pull from Inventory"
      });
      await f.db
        .updateTable("project")
        .set({ locationId })
        .where("id", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .execute();

      const before = await materials(f);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({
        projectOnHand: null,
        unassignedOnHand: null
      });

      await f.enableProjectStock();
      await f.addStripeStock({
        itemId,
        locationId,
        projectId: f.projectId,
        quantity: 4,
        unitCost: 1
      });

      const after = await materials(f);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({
        projectOnHand: 4,
        unassignedOnHand: 10
      });
    } finally {
      await f.cleanup();
    }
  }
);
