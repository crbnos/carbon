// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { expect } from "vitest";
import { postReceipt as postReceiptBody } from "../../app/modules/inventory/inventory.service";
import {
  createProjectPurchaseOrderLine,
  createPurchaseOrderLineFromMaterial
} from "../../app/modules/projects/projects.server";
import { NEW_PURCHASE_ORDER } from "../../app/modules/projects/projects.models";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";
import { localServiceRoleClient } from "./fixtures/local-supabase";
import {
  PROJECT_TEST_USER as USER,
  projectPostingFixture
} from "./fixtures/project-posting";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;

/** The operations read with the caller's client: the local PostgREST. */
function callerService(f: Fixture) {
  const client = localServiceRoleClient();
  if (!client) throw new Error("This test needs the local stack");
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: client as never,
    system: () => client as never,
    pg: () => f.db,
    kv: () => {
      throw new Error("The operation takes no kv");
    }
  });
}

async function addEachUnit(f: Fixture) {
  await f.db
    .insertInto("unitOfMeasure")
    .values({
      code: "EA",
      name: "Each",
      companyId: f.companyId,
      createdBy: USER
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

async function addLine(
  f: Fixture,
  supplierId: string,
  line: Partial<Parameters<typeof createProjectPurchaseOrderLine>[1]>
) {
  return createProjectPurchaseOrderLine(callerService(f), {
    lineType: "Item",
    projectId: f.projectId,
    projectElementId: f.elementId,
    supplierId,
    purchaseOrderId: NEW_PURCHASE_ORDER,
    ...line
  } as Parameters<typeof createProjectPurchaseOrderLine>[1]);
}

/** The fixture has no sequences; a new purchase order takes its number here. */
async function addPurchaseOrderSequence(f: Fixture) {
  await f.db
    .insertInto("sequence")
    .values({
      table: "purchaseOrder",
      name: "Purchase Order",
      prefix: "PO",
      next: 0,
      size: 6,
      step: 1,
      companyId: f.companyId
    })
    .execute();
}

async function addAsset(f: Fixture) {
  const machinery = f.account("machinery");
  const assetClass = await f.db
    .insertInto("fixedAssetClass")
    .values({
      name: `${f.companyId} machinery`,
      assetAccountId: machinery,
      accumulatedDepreciationAccountId: machinery,
      depreciationExpenseAccountId: f.account("misc"),
      writeOffAccountId: f.account("misc"),
      writeDownAccountId: f.account("misc"),
      lossOnDisposalAccountId: f.account("misc"),
      gainOnDisposalAccountId: f.account("misc"),
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return f.db
    .insertInto("fixedAsset")
    .values({
      fixedAssetId: `${f.companyId}-FA`,
      name: "CNC machining center",
      fixedAssetClassId: assetClass.id,
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
}

databaseTest(
  "a task's G/L Account line is charged to the task at the typed price",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const { supplierId } = await f.addPurchaseOrder("seed", {
        locationId,
        lines: []
      });
      await addPurchaseOrderSequence(f);
      const result = await addLine(f, supplierId, {
        lineType: "G/L Account",
        accountId: f.account("indirect"),
        description: "Test lab fees",
        quantity: 2,
        unitPrice: 150
      });
      expect(result.error).toBeNull();

      const line = await f.db
        .selectFrom("purchaseOrderLine")
        .select([
          "purchaseOrderLineType",
          "accountId",
          "purchaseQuantity",
          "supplierUnitPrice",
          "projectId",
          "projectElementId"
        ])
        .where("id", "=", result.data!.purchaseOrderLineId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(line).toMatchObject({
        purchaseOrderLineType: "G/L Account",
        accountId: f.account("indirect"),
        projectId: f.projectId,
        projectElementId: f.elementId
      });
      expect(Number(line.purchaseQuantity)).toBe(2);
      expect(Number(line.supplierUnitPrice)).toBe(150);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a task's item line takes the item's type and is charged to the task",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const { supplierId } = await f.addPurchaseOrder("seed", {
        locationId,
        lines: []
      });
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      await addPurchaseOrderSequence(f);
      await addEachUnit(f);
      const result = await addLine(f, supplierId, {
        lineType: "Item",
        itemId: part.itemId,
        quantity: 3,
        unitPrice: 42
      });
      expect(result.error).toBeNull();

      const line = await f.db
        .selectFrom("purchaseOrderLine")
        .select([
          "purchaseOrderLineType",
          "itemId",
          "purchaseQuantity",
          "supplierUnitPrice",
          "projectElementId"
        ])
        .where("id", "=", result.data!.purchaseOrderLineId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(line).toMatchObject({
        purchaseOrderLineType: "Part",
        itemId: part.itemId,
        projectElementId: f.elementId
      });
      expect(Number(line.purchaseQuantity)).toBe(3);
      expect(Number(line.supplierUnitPrice)).toBe(42);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a task's Fixed Asset line builds the asset and charges the project nothing",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const { supplierId } = await f.addPurchaseOrder("seed", {
        locationId,
        lines: []
      });
      const asset = await addAsset(f);
      await addPurchaseOrderSequence(f);

      const result = await addLine(f, supplierId, {
        lineType: "Fixed Asset",
        assetId: asset.id,
        unitPrice: 1000
      });
      expect(result.error).toBeNull();
      const purchaseOrderId = result.data!.purchaseOrderId;

      const line = await f.db
        .selectFrom("purchaseOrderLine")
        .select(["assetId", "purchaseQuantity", "projectElementId"])
        .where("id", "=", result.data!.purchaseOrderLineId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(line.assetId).toBe(asset.id);
      expect(Number(line.purchaseQuantity)).toBe(1);
      expect(line.projectElementId).toBe(f.elementId);

      const receiptId = `${f.prefix}-receipt`;
      await f.db
        .insertInto("receipt")
        .values({
          id: receiptId,
          receiptId: `${f.prefix}-R`,
          sourceDocument: "Purchase Order",
          sourceDocumentId: purchaseOrderId,
          supplierId,
          locationId,
          status: "Draft",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await f.db
        .insertInto("receiptFixedAssetLine")
        .values({
          receiptId,
          purchaseOrderLineId: result.data!.purchaseOrderLineId,
          received: true,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      const posted = await invokePosting(
        handlesOf(f.ctx),
        "post-receipt",
        { type: "post", receiptId },
        postReceiptBody
      );
      expect(posted.error).toBeNull();

      const debits = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", receiptId)
        .where("amount", ">", 0)
        .execute();
      expect(debits.map((line) => line.accountId)).toContain(
        f.account("machinery")
      );
      expect(debits.map((line) => line.accountId)).not.toContain(
        f.account("project-expense")
      );

      const built = await f.db
        .selectFrom("fixedAsset")
        .select("acquisitionCost")
        .where("id", "=", asset.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(built.acquisitionCost)).toBe(1000);

      const projectRows = await f.db
        .selectFrom("projectLedger")
        .select("id")
        .where("projectId", "=", f.projectId)
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Purchase Receipt")
        .execute();
      expect(projectRows).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

for (const line of [
  {
    lineType: "G/L Account" as const,
    accountId: "any",
    description: "Test lab fees",
    quantity: 1
  },
  { lineType: "Fixed Asset" as const, assetId: "any" },
  { lineType: "Item" as const, itemId: "any", quantity: 1 }
]) {
  databaseTest(`a ${line.lineType} line needs a unit price`, async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const result = await addLine(f, "any", line);
      expect(result.error?.message).toMatch(/Unit price is required/);
    } finally {
      await f.cleanup();
    }
  });
}

databaseTest(
  "Create PO Line takes the item's unit cost when the supplier has no part",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const { supplierId } = await f.addPurchaseOrder("seed", {
        locationId,
        lines: []
      });
      const part = await f.addItem("part", { itemTrackingType: "Inventory" });
      await addPurchaseOrderSequence(f);
      await addEachUnit(f);
      await f.db
        .updateTable("itemCost")
        .set({ unitCost: 12 })
        .where("itemId", "=", part.itemId)
        .where("companyId", "=", f.companyId)
        .execute();
      const material = await f.db
        .insertInto("projectElementMaterial")
        .values({
          projectId: f.projectId,
          projectElementId: f.elementId,
          itemId: part.itemId,
          quantity: 2,
          methodType: "Purchase to Order",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const result = await createPurchaseOrderLineFromMaterial(
        callerService(f),
        {
          projectId: f.projectId,
          projectElementId: f.elementId,
          materialId: material.id,
          supplierId,
          quantity: 2,
          purchaseOrderId: NEW_PURCHASE_ORDER
        }
      );
      expect(result.error).toBeNull();

      const line = await f.db
        .selectFrom("purchaseOrderLine")
        .select("supplierUnitPrice")
        .where("id", "=", result.data!.purchaseOrderLineId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(line.supplierUnitPrice)).toBe(12);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a refused line leaves no empty purchase order behind",
  async () => {
    const f = await projectPostingFixture({ costTreatment: "Expense" });
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const { supplierId } = await f.addPurchaseOrder("seed", {
        locationId,
        lines: []
      });
      const before = await f.db
        .selectFrom("purchaseOrder")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();

      const result = await addLine(f, supplierId, {
        lineType: "Fixed Asset",
        assetId: "no-such-asset",
        unitPrice: 1000
      });
      expect(result.error?.message).toBe("The fixed asset does not exist");

      const after = await f.db
        .selectFrom("purchaseOrder")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(after.length).toBe(before.length);
    } finally {
      await f.cleanup();
    }
  }
);

for (const finalAssetElement of [false, true]) {
  databaseTest(
    `a Fixed Asset line cannot name the asset ${finalAssetElement ? "an element" : "the project"} builds`,
    async () => {
      const f = await projectPostingFixture({ costTreatment: "Capitalize" });
      try {
        const { locationId } = await f.addStockedItem("filler", {
          quantity: 1,
          unitCost: 1
        });
        const { supplierId } = await f.addPurchaseOrder("seed", {
          locationId,
          lines: []
        });
        const asset = await f.addCapitalAsset({
          status: "Under Construction",
          finalAssetElement
        });
        await addPurchaseOrderSequence(f);

        const result = await addLine(f, supplierId, {
          lineType: "Fixed Asset",
          assetId: asset.fixedAssetId,
          unitPrice: 1000
        });

        expect(result.data).toBeNull();
        expect(result.error?.message).toMatch(/project builds this asset/);
      } finally {
        await f.cleanup();
      }
    }
  );
}
