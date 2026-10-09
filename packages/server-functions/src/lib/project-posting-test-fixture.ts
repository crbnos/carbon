// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A scratch company for the project posting regressions: accounts and
// account defaults, an open accounting period, the Project, ProjectElement and
// Employee dimensions, a labor category, and one Released Expense project with
// its states and one chargeable element. Deleted by `cleanup()`.

import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { Insertable } from "kysely";
import { sql } from "kysely";
import { connectLocalTestDatabase } from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";

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
    ["ppv", "Purchase price variance", "Expense"]
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
      .values({ id: companyId, accountingEnabled: true })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({ accountingEnabled: true })
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
          projectId,
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

  const ctx = ServerFnContext.system({ db, companyId, userId: USER });

  return {
    db,
    ctx,
    prefix,
    account,
    state,
    dimension,
    companyId,
    groupId,
    projectId,
    elementId,
    laborCategoryId,
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
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("journal")
          .set({ status: "Draft" })
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
