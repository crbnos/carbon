// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A scratch company for the project posting regressions: accounts and
// account defaults, an open accounting period, the Project, ProjectElement and
// Employee dimensions, a labor category, and one Released Expense project with
// its states and one chargeable element. Deleted by `cleanup()`. Ported from
// `packages/server-functions/src/lib/project-posting-test-fixture.ts`.

import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { Insertable } from "kysely";
import { sql } from "kysely";
import { systemServiceOf } from "./handles";
import { connectLocalTestDatabase } from "./local-database";

export const PROJECT_TEST_USER = "system";

// Every NOT NULL account column on `accountDefault`. The ones a test reads are
// overridden with their own account; the rest point at one filler account.
const ACCOUNT_DEFAULT_COLUMNS = [
  "salesAccount",
  "salesDiscountAccount",
  "costOfGoodsSoldAccount",
  "purchaseVarianceAccount",
  "inventoryAdjustmentVarianceAccount",
  "materialVarianceAccount",
  "laborAndMachineVarianceAccount",
  "indirectCostAccount",
  "maintenanceAccount",
  "assetDepreciationExpenseAccount",
  "serviceChargeAccount",
  "interestAccount",
  "supplierPaymentDiscountAccount",
  "customerPaymentDiscountAccount",
  "roundingAccount",
  "assetAquisitionCostAccount",
  "assetAquisitionCostOnDisposalAccount",
  "accumulatedDepreciationAccount",
  "accumulatedDepreciationOnDisposalAccount",
  "workInProgressAccount",
  "receivablesAccount",
  "bankCashAccount",
  "bankLocalCurrencyAccount",
  "bankForeignCurrencyAccount",
  "prepaymentAccount",
  "payablesAccount",
  "salesTaxPayableAccount",
  "purchaseTaxPayableAccount",
  "reverseChargeSalesTaxPayableAccount",
  "retainedEarningsAccount",
  "goodsReceivedNotInvoicedAccount",
  "overheadVarianceAccount",
  "lotSizeVarianceAccount",
  "subcontractingVarianceAccount",
  "currencyTranslationAccount",
  "customerWriteOffAccount",
  "supplierWriteOffAccount",
  "realizedExchangeGainAccount",
  "realizedExchangeLossAccount",
  "supplierPrepaymentAccount",
  "rawMaterialsAccount",
  "finishedGoodsAccount",
  "assetGainOnDisposalAccount",
  "assetLossOnDisposalAccount"
];

type AccountClass = Database["public"]["Enums"]["glAccountClass"];

export async function projectPostingFixture(
  options: {
    costTreatment?: Database["public"]["Enums"]["projectCostTreatment"];
  } = {}
) {
  const db = await connectLocalTestDatabase();
  const prefix = `projtest-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const projectId = `${prefix}-project`;
  const elementId = `${prefix}-element`;
  const laborCategoryId = `${prefix}-labor`;
  const account = (name: string) => `${prefix}-${name}`;
  const state = (name: string) => `${prefix}-state-${name}`;
  const dimension = (entityType: string) => `${prefix}-dim-${entityType}`;
  const USER = PROJECT_TEST_USER;

  const accounts: [string, string, AccountClass][] = [
    ["misc", "Filler", "Expense"],
    ["project-expense", "Project expense", "Expense"],
    ["project-wip", "Project work in progress", "Asset"],
    ["labor-absorption", "Labor absorption", "Expense"],
    ["overhead-absorption", "Overhead absorption", "Expense"],
    ["wip", "Work in progress", "Asset"],
    ["inventory", "Inventory", "Asset"],
    ["indirect", "Indirect cost", "Expense"],
    ["adjustment-variance", "Inventory adjustment variance", "Expense"],
    ["grni", "Goods received not invoiced", "Liability"],
    ["payables", "Accounts payable", "Liability"],
    ["ppv", "Purchase price variance", "Expense"],
    ["cip", "Construction in progress", "Asset"],
    ["machinery", "Machinery", "Asset"]
  ];

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("currency")
      .values({
        code: "USD",
        decimalPlaces: 2,
        companyGroupId: groupId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("account")
      .values(
        accounts.map(([key, name, accountClass]) => ({
          id: account(key),
          name,
          class: accountClass,
          incomeBalance:
            accountClass === "Asset" ||
            accountClass === "Liability" ||
            accountClass === "Equity"
              ? ("Balance Sheet" as const)
              : ("Income Statement" as const),
          companyGroupId: groupId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("accountDefault")
      .values({
        companyId,
        ...Object.fromEntries(
          ACCOUNT_DEFAULT_COLUMNS.map((column) => [column, account("misc")])
        ),
        workInProgressAccount: account("wip"),
        rawMaterialsAccount: account("inventory"),
        finishedGoodsAccount: account("inventory"),
        indirectCostAccount: account("indirect"),
        inventoryAdjustmentVarianceAccount: account("adjustment-variance"),
        laborAbsorptionAccount: account("labor-absorption"),
        overheadAbsorptionAccount: account("overhead-absorption"),
        goodsReceivedNotInvoicedAccount: account("grni"),
        payablesAccount: account("payables"),
        purchaseVarianceAccount: account("ppv"),
        projectExpenseAccount: account("project-expense"),
        projectWorkInProgressAccount: account("project-wip")
      } as unknown as Insertable<KyselyDatabase["accountDefault"]>)
      .execute();
    await trx
      .insertInto("companySettings")
      // A cutover inside the test period: every journal posts Posted. A test
      // of a company before its cutover sets the date back to null.
      .values({ id: companyId, accountingCutoverDate: "2000-01-01" })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({ accountingCutoverDate: "2000-01-01" })
      )
      .execute();
    await trx
      .insertInto("accountingPeriod")
      .values({
        id: `${prefix}-period`,
        startDate: "2000-01-01",
        endDate: "2099-12-31",
        fiscalYear: 2099,
        periodNumber: 1,
        status: "Active",
        closeStatus: "Open",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("sequence")
      .values({
        table: "journalEntry",
        name: "Project journals",
        prefix: "PROJTEST-",
        companyId
      })
      .execute();
    await trx
      .insertInto("dimension")
      .values(
        (["Project", "ProjectElement", "Employee"] as const).map(
          (entityType) => ({
            id: dimension(entityType),
            name: entityType,
            entityType,
            companyGroupId: groupId,
            createdBy: USER
          })
        )
      )
      .execute();
    await trx
      .insertInto("laborCategory")
      .values({
        id: laborCategoryId,
        name: "Engineer",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("laborCategoryRate")
      .values({
        laborCategoryId,
        effectiveFrom: "2026-01-01",
        costRate: 85,
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("project")
      .values({
        id: projectId,
        name: "Test project",
        identifier: "TP",
        status: "Released",
        costTreatment: options.costTreatment ?? "Expense",
        companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("projectState")
      .values(
        (
          [
            ["todo", "Todo", "Unstarted"],
            ["doing", "In Progress", "Started"],
            ["done", "Done", "Completed"]
          ] as const
        ).map(([key, name, group], index) => ({
          id: state(key),
          name,
          group,
          color: "#000000",
          sortOrder: index,
          isDefault: true,
          companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("projectElement")
      .values({
        id: elementId,
        projectId,
        readableId: "TP-1",
        sequence: 1,
        type: "Task",
        name: "Design",
        stateId: state("todo"),
        companyId,
        createdBy: USER
      })
      .execute();
  });

  // The handles a posting runs on as the system: pass `handlesOf(f.ctx)` to
  // `invokePosting`. `service` is the same caller as a `ServiceContext`, for
  // a building block or operation called directly.
  const ctx = { db, companyId, userId: USER };
  const service = systemServiceOf(ctx, groupId);

  return {
    db,
    ctx,
    service,
    prefix,
    account,
    state,
    dimension,
    companyId,
    groupId,
    projectId,
    elementId,
    laborCategoryId,
    /** A capital asset for a Capitalize project: a CIP class (asset account
     *  `cip`) and an in-service class (`machinery`), and one asset in
     *  `status`. The asset is the project's own asset, or the fixture
     *  element's when `finalAssetElement` is set (the element becomes a final
     *  asset). An Active asset sits in the in-service class. */
    async addCapitalAsset(args: {
      status: "Under Construction" | "Active";
      finalAssetElement?: boolean;
      acquisitionCost?: number;
    }) {
      const cipClassId = `${prefix}-class-cip`;
      const classId = `${prefix}-class-machinery`;
      const fixedAssetId = `${prefix}-asset-${crypto.randomUUID().slice(0, 8)}`;
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        const accountColumns = {
          accumulatedDepreciationAccountId: account("misc"),
          depreciationExpenseAccountId: account("misc"),
          writeOffAccountId: account("misc"),
          writeDownAccountId: account("misc"),
          lossOnDisposalAccountId: account("misc"),
          gainOnDisposalAccountId: account("misc")
        };
        await trx
          .insertInto("fixedAssetClass")
          .values([
            {
              id: cipClassId,
              name: "Construction in Progress",
              isConstructionInProgress: true,
              assetAccountId: account("cip"),
              ...accountColumns,
              companyId,
              createdBy: USER
            },
            {
              id: classId,
              name: "Machinery",
              assetAccountId: account("machinery"),
              ...accountColumns,
              companyId,
              createdBy: USER
            }
          ])
          .onConflict((oc) => oc.doNothing())
          .execute();
        await trx
          .insertInto("sequence")
          .values(
            (["fixedAsset", "fixedAssetTransfer"] as const).map((table) => ({
              table,
              name: table,
              prefix: table === "fixedAsset" ? "FA" : "FAT",
              companyId
            }))
          )
          .onConflict((oc) => oc.doNothing())
          .execute();
        await trx
          .insertInto("fixedAsset")
          .values({
            id: fixedAssetId,
            fixedAssetId,
            name: "Test asset",
            fixedAssetClassId: args.status === "Active" ? classId : cipClassId,
            status: args.status,
            acquisitionCost: args.acquisitionCost ?? 0,
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("project")
          .set({
            costTreatment: "Capitalize",
            fixedAssetClassId: cipClassId,
            ...(args.finalAssetElement ? {} : { fixedAssetId })
          })
          .where("id", "=", projectId)
          .where("companyId", "=", companyId)
          .execute();
        if (args.finalAssetElement) {
          await trx
            .updateTable("projectElement")
            .set({ isFinalAsset: true, fixedAssetId })
            .where("id", "=", elementId)
            .where("companyId", "=", companyId)
            .execute();
        }
      });
      return { fixedAssetId, cipClassId, classId };
    },
    /** A location and a FIFO bought item with `quantity` units on hand in
     *  one cost layer at `unitCost`. */
    async addStockedItem(
      key: string,
      { quantity, unitCost }: { quantity: number; unitCost: number }
    ) {
      const locationId = `${prefix}-location-${key}`;
      const itemId = `${prefix}-item-${key}`;
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("location")
          .values({
            id: locationId,
            name: `Plant ${key}`,
            addressLine1: "1 Main St",
            city: "Springfield",
            postalCode: "00000",
            timezone: "America/New_York",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("item")
          .values({
            id: itemId,
            readableId: `${prefix}-${key}`,
            name: `Part ${key}`,
            type: "Part",
            itemTrackingType: "Inventory",
            replenishmentSystem: "Buy",
            companyId,
            createdBy: USER
          })
          .execute();
        // An item insert may already have created its cost row.
        await trx.deleteFrom("itemCost").where("itemId", "=", itemId).execute();
        await trx
          .insertInto("itemCost")
          .values({
            itemId,
            costingMethod: "FIFO",
            unitCost,
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("itemLedger")
          .values({
            postingDate: "2026-01-01",
            entryType: "Positive Adjmt.",
            itemId,
            locationId,
            quantity,
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("costLedger")
          .values({
            itemLedgerType: "Positive Adjmt.",
            costLedgerType: "Direct Cost",
            adjustment: false,
            itemId,
            quantity,
            cost: quantity * unitCost,
            remainingQuantity: quantity,
            postingDate: "2026-01-01",
            companyId
          })
          .execute();
      });
      return { locationId, itemId };
    },
    /** Turns on project stock for the fixture's project (Projects Phase 2a). */
    async enableProjectStock() {
      await db
        .updateTable("project")
        .set({ projectStock: true })
        .where("id", "=", projectId)
        .where("companyId", "=", companyId)
        .execute();
    },
    /** `quantity` units of an item in one stock stripe: a Positive Adjmt.
     *  item ledger row and a cost layer at `unitCost`, both with `projectId`
     *  (null = common), in `storageUnitId` (null = no bin). Returns both ids. */
    async addStripeStock(args: {
      itemId: string;
      locationId: string;
      projectId: string | null;
      quantity: number;
      unitCost: number;
      storageUnitId?: string | null;
      postingDate?: string;
    }) {
      const postingDate = args.postingDate ?? "2026-01-01";
      return db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        const ledger = await trx
          .insertInto("itemLedger")
          .values({
            postingDate,
            entryType: "Positive Adjmt.",
            itemId: args.itemId,
            locationId: args.locationId,
            storageUnitId: args.storageUnitId ?? null,
            projectId: args.projectId,
            quantity: args.quantity,
            companyId,
            createdBy: USER
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const layer = await trx
          .insertInto("costLedger")
          .values({
            itemLedgerType: "Positive Adjmt.",
            costLedgerType: "Direct Cost",
            adjustment: false,
            itemId: args.itemId,
            quantity: args.quantity,
            cost: args.quantity * args.unitCost,
            remainingQuantity: args.quantity,
            postingDate,
            projectId: args.projectId,
            companyId
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { itemLedgerId: ledger.id, costLedgerId: layer.id };
      });
    },
    /** A consume-to-project job on the fixture's project and element: one
     *  make method, one operation at a work center (labor 50.00 per hour),
     *  and one Pull from Inventory material of `materialItemId` needing
     *  `quantityPerParent` per unit for `jobQuantity` units. */
    async addConsumeToProjectJob(
      key: string,
      args: {
        locationId: string;
        materialItemId: string;
        quantityPerParent: number;
        jobQuantity: number;
        /** false: an ordinary job with no charge number. */
        consumeToProject?: boolean;
      }
    ) {
      const consumeToProject = args.consumeToProject ?? true;
      const jobId = `${prefix}-job-${key}`;
      const makeMethodId = `${prefix}-jmm-${key}`;
      const operationId = `${prefix}-op-${key}`;
      const materialId = `${prefix}-mat-${key}`;
      const workCenterId = `${prefix}-wc-${key}`;
      const finishedItemId = `${prefix}-fg-${key}`;
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("unitOfMeasure")
          .values({ code: "EA", name: "Each", companyId, createdBy: USER })
          .onConflict((oc) => oc.doNothing())
          .execute();
        await trx
          .insertInto("item")
          .values({
            id: finishedItemId,
            readableId: `${prefix}-FG-${key}`,
            name: `Assembly ${key}`,
            type: "Part",
            itemTrackingType: "Inventory",
            replenishmentSystem: "Make",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("process")
          .values({
            id: `${prefix}-process-${key}`,
            name: `Assemble ${key}`,
            defaultStandardFactor: "Hours/Piece",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("workCenter")
          .values({
            id: workCenterId,
            name: `Bench ${key}`,
            laborRate: 50,
            machineRate: 0,
            overheadRate: 0,
            locationId: args.locationId,
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("job")
          .values({
            id: jobId,
            jobId: `${prefix}-J-${key}`,
            itemId: finishedItemId,
            quantity: args.jobQuantity,
            unitOfMeasureCode: "EA",
            locationId: args.locationId,
            projectId: consumeToProject ? projectId : null,
            projectElementId: consumeToProject ? elementId : null,
            consumeToProject,
            companyId,
            createdBy: USER
          })
          .execute();
        // The job insert may already have created its make method.
        await trx
          .deleteFrom("jobMakeMethod")
          .where("jobId", "=", jobId)
          .execute();
        await trx
          .insertInto("jobMakeMethod")
          .values({
            id: makeMethodId,
            jobId,
            itemId: finishedItemId,
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("jobOperation")
          .values({
            id: operationId,
            jobId,
            jobMakeMethodId: makeMethodId,
            processId: `${prefix}-process-${key}`,
            workCenterId,
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("jobMaterial")
          .values({
            id: materialId,
            jobId,
            jobMakeMethodId: makeMethodId,
            jobOperationId: operationId,
            itemId: args.materialItemId,
            itemType: "Part",
            methodType: "Pull from Inventory",
            description: "Material",
            quantity: args.quantityPerParent,
            estimatedQuantity: args.quantityPerParent * args.jobQuantity,
            defaultStorageUnit: false,
            companyId,
            createdBy: USER
          })
          .execute();
      });
      return {
        jobId,
        makeMethodId,
        operationId,
        materialId,
        workCenterId,
        finishedItemId
      };
    },
    /** A planning group at `locationId` (Projects Phase 3) whose members are
     *  new Released Expense projects with project stock, in the given order
     *  and priority. Returns the group id and each member's project id. */
    async addPlanningGroup(args: {
      locationId: string;
      members: { key: string; identifier: string; priority?: number }[];
      excessRule?: Database["public"]["Enums"]["planningGroupExcessRule"];
    }) {
      const planningGroupId = `${prefix}-plg-${crypto.randomUUID().slice(0, 8)}`;
      const projectIds = Object.fromEntries(
        args.members.map((member) => [
          member.key,
          `${prefix}-member-${member.key}`
        ])
      );
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("planningGroup")
          .values({
            id: planningGroupId,
            name: planningGroupId,
            locationId: args.locationId,
            excessRule: args.excessRule ?? "Common Stock",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("project")
          .values(
            args.members.map((member, index) => ({
              id: projectIds[member.key]!,
              name: `Member ${member.key}`,
              identifier: member.identifier,
              status: "Released" as const,
              costTreatment: "Expense" as const,
              projectStock: true,
              planningGroupId,
              planningPriority: member.priority ?? (index + 1) * 10,
              companyId,
              createdBy: USER
            }))
          )
          .execute();
      });
      return { planningGroupId, projectIds };
    },
    /** A current Soft peg of `quantity` units of a supply for a member. */
    async addPeg(args: {
      planningGroupId: string;
      itemId: string;
      locationId: string;
      supplyType: Database["public"]["Enums"]["projectPegSupplyType"];
      supplyId: string;
      projectId: string;
      quantity: number;
      needDate: string;
    }) {
      return db
        .insertInto("projectPeg")
        .values({
          planningGroupId: args.planningGroupId,
          itemId: args.itemId,
          locationId: args.locationId,
          supplyType: args.supplyType,
          supplyId: args.supplyId,
          projectId: args.projectId,
          demandSourceType: "Project Material",
          demandSourceId: `${args.projectId}-demand`,
          quantity: args.quantity,
          needDate: args.needDate,
          state: "Soft",
          companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    },
    /** An item with no stock (`Non-Inventory` for a purchased service). */
    async addItem(
      key: string,
      {
        itemTrackingType
      }: {
        itemTrackingType: Database["public"]["Enums"]["itemTrackingType"];
      }
    ) {
      const itemId = `${prefix}-item-${key}`;
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("item")
          .values({
            id: itemId,
            readableId: `${prefix}-${key}`,
            name: `Item ${key}`,
            type: "Part",
            itemTrackingType,
            replenishmentSystem: "Buy",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx.deleteFrom("itemCost").where("itemId", "=", itemId).execute();
        await trx
          .insertInto("itemCost")
          .values({
            itemId,
            costingMethod: "FIFO",
            unitCost: 0,
            companyId,
            createdBy: USER
          })
          .execute();
      });
      return { itemId };
    },
    /** A supplier and a To Receive purchase order with one line per entry.
     *  `charged` lines carry the fixture's project and element. */
    async addPurchaseOrder(
      key: string,
      args: {
        locationId: string;
        lines: {
          itemId: string;
          quantity: number;
          unitPrice: number;
          charged?: boolean;
          /** a PO line made for a planning group (no project) */
          planningGroupId?: string;
        }[];
      }
    ) {
      const supplierId = `${prefix}-supplier-${key}`;
      const purchaseOrderId = `${prefix}-po-${key}`;
      const lineIds = args.lines.map(
        (_, index) => `${prefix}-pol-${key}-${index}`
      );
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("supplier")
          .values({ id: supplierId, name: `Supplier ${key}`, companyId })
          .execute();
        const interaction = await trx
          .insertInto("supplierInteraction")
          .values({ supplierId, companyId })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("purchaseOrder")
          .values({
            id: purchaseOrderId,
            purchaseOrderId: `${prefix}-PO-${key}`,
            status: "To Receive",
            supplierId,
            supplierInteractionId: interaction.id,
            currencyCode: "USD",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("purchaseOrderDelivery")
          .values({ id: purchaseOrderId, companyId })
          .onConflict((oc) => oc.doNothing())
          .execute();
        if (args.lines.length === 0) return;
        await trx
          .insertInto("purchaseOrderLine")
          .values(
            args.lines.map((line, index) => ({
              id: lineIds[index]!,
              purchaseOrderId,
              purchaseOrderLineType: "Part" as const,
              itemId: line.itemId,
              purchaseQuantity: line.quantity,
              supplierUnitPrice: line.unitPrice,
              locationId: args.locationId,
              projectId: line.charged ? projectId : null,
              projectElementId: line.charged ? elementId : null,
              planningGroupId: line.planningGroupId ?? null,
              companyId,
              createdBy: USER
            }))
          )
          .execute();
      });
      return { supplierId, purchaseOrderId, lineIds };
    },
    /** A Draft receipt of `quantities[i]` units of each line of `po`. */
    async addReceipt(
      key: string,
      args: {
        locationId: string;
        purchaseOrderId: string;
        supplierId: string;
        lines: {
          lineId: string;
          itemId: string;
          quantity: number;
          unitPrice: number;
        }[];
      }
    ) {
      const receiptId = `${prefix}-receipt-${key}`;
      const receiptLineIds = args.lines.map(
        (_, index) => `${prefix}-rl-${key}-${index}`
      );
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("receipt")
          .values({
            id: receiptId,
            receiptId: `${prefix}-R-${key}`,
            sourceDocument: "Purchase Order",
            sourceDocumentId: args.purchaseOrderId,
            supplierId: args.supplierId,
            locationId: args.locationId,
            status: "Draft",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("receiptLine")
          .values(
            args.lines.map((line, index) => ({
              id: receiptLineIds[index]!,
              receiptId,
              lineId: line.lineId,
              itemId: line.itemId,
              orderQuantity: line.quantity,
              receivedQuantity: line.quantity,
              unitOfMeasure: "EA",
              unitPrice: line.unitPrice,
              locationId: args.locationId,
              companyId,
              createdBy: USER
            }))
          )
          .execute();
      });
      return { receiptId, receiptLineIds };
    },
    /** A Draft purchase invoice of `supplierId` with one line per entry.
     *  `charged` lines carry the fixture's project and element. */
    async addPurchaseInvoice(
      key: string,
      args: {
        supplierId: string;
        lines: {
          invoiceLineType: Database["public"]["Enums"]["payableLineType"];
          quantity: number;
          unitPrice: number;
          accountId?: string;
          itemId?: string;
          locationId?: string;
          purchaseOrderId?: string;
          purchaseOrderLineId?: string;
          charged?: boolean;
        }[];
      }
    ) {
      const invoiceId = `${prefix}-pi-${key}`;
      const lineIds = args.lines.map(
        (_, index) => `${prefix}-pil-${key}-${index}`
      );
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        const interaction = await trx
          .insertInto("supplierInteraction")
          .values({ supplierId: args.supplierId, companyId })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("purchaseInvoice")
          .values({
            id: invoiceId,
            invoiceId: `${prefix}-PI-${key}`,
            status: "Draft",
            supplierId: args.supplierId,
            supplierInteractionId: interaction.id,
            currencyCode: "USD",
            dateIssued: "2026-10-01",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("purchaseInvoiceDelivery")
          .values({ id: invoiceId, companyId })
          .onConflict((oc) => oc.doNothing())
          .execute();
        await trx
          .insertInto("purchaseInvoiceLine")
          .values(
            args.lines.map((line, index) => ({
              id: lineIds[index]!,
              invoiceId,
              invoiceLineType: line.invoiceLineType,
              quantity: line.quantity,
              supplierUnitPrice: line.unitPrice,
              accountId: line.accountId ?? null,
              itemId: line.itemId ?? null,
              locationId: line.locationId ?? null,
              purchaseOrderId: line.purchaseOrderId ?? null,
              purchaseOrderLineId: line.purchaseOrderLineId ?? null,
              projectId: line.charged ? projectId : null,
              projectElementId: line.charged ? elementId : null,
              companyId,
              createdBy: USER
            }))
          )
          .execute();
      });
      return { invoiceId, lineIds };
    },
    /** Makes the fixture's project a Service project (By Coverage) owned by
     *  a Field Visit service order on a customer asset: a customer, a
     *  serialized item and its serial, the asset with its warranty end
     *  dates, Warranty Expense (`warranty`) and Cost of Goods Sold (`cogs`)
     *  defaults, and, with `laborPrice`, a service labor item at that price. */
    async addServiceOrder(
      key: string,
      args: {
        laborWarrantyEndDate?: string | null;
        partsWarrantyEndDate?: string | null;
        laborPrice?: number;
      } = {}
    ) {
      const customerId = `${prefix}-customer-${key}`;
      const locationId = `${prefix}-svc-location-${key}`;
      const subjectItemId = `${prefix}-subject-${key}`;
      const subjectSerialId = `${prefix}-serial-${key}`;
      const customerAssetId = `${prefix}-asset-${key}`;
      const serviceOrderId = `${prefix}-svc-${key}`;
      const laborItemId = `${prefix}-labor-item-${key}`;
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("account")
          .values(
            (
              [
                ["warranty", "Warranty expense"],
                ["cogs", "Cost of goods sold"]
              ] as const
            ).map(([name, label]) => ({
              id: account(name),
              name: label,
              class: "Expense" as const,
              incomeBalance: "Income Statement" as const,
              companyGroupId: groupId,
              createdBy: USER
            }))
          )
          .onConflict((oc) => oc.doNothing())
          .execute();
        await trx
          .updateTable("accountDefault")
          .set({
            warrantyExpenseAccount: account("warranty"),
            costOfGoodsSoldAccount: account("cogs")
          })
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .insertInto("dimension")
          .values({
            id: dimension("Customer"),
            name: "Customer",
            entityType: "Customer",
            companyGroupId: groupId,
            createdBy: USER
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
        await trx
          .insertInto("customer")
          .values({ id: customerId, name: `Customer ${key}`, companyId })
          .execute();
        await trx
          .insertInto("location")
          .values({
            id: locationId,
            name: `Service ${key}`,
            addressLine1: "1 Main St",
            city: "Springfield",
            postalCode: "00000",
            timezone: "America/New_York",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("item")
          .values({
            id: subjectItemId,
            readableId: `${prefix}-SUBJ-${key}`,
            name: `Machine ${key}`,
            type: "Part",
            itemTrackingType: "Serial",
            replenishmentSystem: "Make",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("trackedEntity")
          .values({
            id: subjectSerialId,
            readableId: `SN-${key}`,
            itemId: subjectItemId,
            quantity: 1,
            status: "Consumed",
            sourceDocument: "Item",
            sourceDocumentId: subjectItemId,
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("customerAsset")
          .values({
            id: customerAssetId,
            trackedEntityId: subjectSerialId,
            itemId: subjectItemId,
            customerId,
            laborWarrantyEndDate: args.laborWarrantyEndDate ?? null,
            partsWarrantyEndDate: args.partsWarrantyEndDate ?? null,
            source: "Manual",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .updateTable("project")
          .set({ projectType: "Service", costTreatment: "By Coverage" })
          .where("id", "=", projectId)
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .insertInto("serviceOrder")
          .values({
            id: serviceOrderId,
            serviceOrderId: `SVC-${key}`,
            type: "Field Visit",
            status: "In Progress",
            trackedEntityId: subjectSerialId,
            itemId: subjectItemId,
            customerAssetId,
            customerId,
            locationId,
            projectId,
            companyId,
            createdBy: USER
          })
          .execute();
        if (args.laborPrice !== undefined) {
          await trx
            .insertInto("item")
            .values({
              id: laborItemId,
              readableId: `${prefix}-LABOR-${key}`,
              name: "Service labor",
              type: "Service",
              itemTrackingType: "Non-Inventory",
              replenishmentSystem: "Buy",
              companyId,
              createdBy: USER
            })
            .execute();
          await trx
            .deleteFrom("itemUnitSalePrice")
            .where("itemId", "=", laborItemId)
            .execute();
          await trx
            .insertInto("itemUnitSalePrice")
            .values({
              itemId: laborItemId,
              unitSalePrice: args.laborPrice,
              currencyCode: "USD",
              companyId,
              createdBy: USER
            })
            .execute();
          await trx
            .updateTable("companySettings")
            .set({ serviceLaborItemId: laborItemId })
            .where("id", "=", companyId)
            .execute();
        }
      });
      return {
        customerId,
        locationId,
        subjectItemId,
        subjectSerialId,
        customerAssetId,
        serviceOrderId,
        laborItemId: args.laborPrice !== undefined ? laborItemId : null
      };
    },
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        // Posted and voided charges and reimbursements refuse a delete.
        for (const table of ["charge", "reimbursement"] as const) {
          await trx
            .updateTable(table)
            .set({
              status: "Draft",
              journalId: null,
              postedAt: null,
              postedBy: null,
              voidedAt: null,
              voidedBy: null
            })
            .where("companyId", "=", companyId)
            .execute();
        }
        await trx
          .updateTable("journal")
          .set({ status: "Draft" })
          .where("companyId", "=", companyId)
          .execute();
        // Capital assets: a class is ON DELETE RESTRICT from its assets.
        await trx
          .deleteFrom("fixedAssetCipCost")
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .deleteFrom("fixedAsset")
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .deleteFrom("fixedAssetClass")
          .where("companyId", "=", companyId)
          .execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}
