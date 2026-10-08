// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Database, getCompanyTimeZone, type Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  contains,
  inOrder,
  many,
  maybeSingle,
  neq,
  rpcValue,
  single,
  type Tables
} from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import { datetime, round, settleQuantity } from "@carbon/utils";
import { nanoid } from "nanoid";
import { z } from "zod";
import { assertCompanyRecords } from "../company-records";
import {
  defineServerFn,
  type ServerFn,
  type ServerFnResult
} from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import type { ServerFnContext } from "../server-fn-context";

const logger = getLogger("server-functions", "create");

// Resolves a fallback location when a caller omits locationId, so creating a
// blank shipment degrades gracefully instead of failing payload validation.
// Prefers the creating user's assigned employeeJob location, then the company's
// earliest-created location. Only safe where locationId does not scope which
// source-document lines are shipped (i.e. shipmentDefault).
async function getFallbackLocationId(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string
): Promise<string | null> {
  const employeeJob = await maybeSingle(
    db,
    "employeeJob",
    { id: userId, companyId },
    { columns: ["locationId"] }
  );
  if (employeeJob.data?.locationId) return employeeJob.data.locationId;

  const location = await maybeSingle(
    db,
    "location",
    { companyId },
    { columns: ["id"], orderBy: ["createdAt"], limit: 1 }
  );
  return location.data?.id ?? null;
}

export const createInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("nonConformanceTasks"),
    id: z.string()
  }),
  z.object({
    type: z.literal("purchaseOrderFromJob"),
    jobId: z.string(),
    purchaseOrdersBySupplierId: z.record(z.string(), z.string())
  }),
  z.object({
    type: z.literal("receiptDefault"),
    locationId: z.string()
  }),
  z.object({
    type: z.literal("receiptFromPurchaseOrder"),
    locationId: z.string().optional(),
    purchaseOrderId: z.string(),
    receiptId: z.string().optional()
  }),
  z.object({
    type: z.literal("receiptFromInboundTransfer"),
    warehouseTransferId: z.string(),
    receiptId: z.string().optional()
  }),
  z.object({
    type: z.literal("receiptFromSalesReturnOrder"),
    salesReturnOrderId: z.string(),
    receiptId: z.string().optional(),
    locationId: z.string().optional()
  }),
  z.object({
    type: z.literal("receiptFromWarehouseTransfer"),
    warehouseTransferId: z.string(),
    receiptId: z.string().optional()
  }),
  z.object({
    type: z.literal("receiptLineSplit"),
    quantity: z.number(),
    locationId: z.string(),
    receiptId: z.string(),
    receiptLineId: z.string()
  }),
  z.object({
    type: z.literal("shipmentDefault"),
    locationId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromPurchaseOrder"),
    locationId: z.string(),
    purchaseOrderId: z.string(),
    shipmentId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromWarehouseTransfer"),
    warehouseTransferId: z.string(),
    shipmentId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromPurchaseReturnOrder"),
    purchaseReturnOrderId: z.string(),
    shipmentId: z.string().optional(),
    locationId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromSalesReturnOrder"),
    salesReturnOrderId: z.string(),
    shipmentId: z.string().optional(),
    locationId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromSalesOrder"),
    locationId: z.string(),
    salesOrderId: z.string(),
    shipmentId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentFromSalesOrderLine"),
    locationId: z.string(),
    salesOrderLineId: z.string(),
    shipmentId: z.string().optional()
  }),
  z.object({
    type: z.literal("shipmentLineSplit"),
    quantity: z.number(),
    locationId: z.string(),
    shipmentId: z.string(),
    shipmentLineId: z.string()
  }),
  z.object({
    type: z.literal("shipmentFromRentalAgreement"),
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string().optional()
  }),
  z.object({
    type: z.literal("receiptFromRentalAgreement"),
    rentalAgreementId: z.string(),
    rentalAgreementLineId: z.string().optional()
  }),
  z.object({
    type: z.literal("journalEntry")
  })
]);
export type CreateInput = z.input<typeof createInput>;
type CreateResults = {
  nonConformanceTasks: { success: true };
  purchaseOrderFromJob: {
    success: true;
    purchaseOrderIdsBySupplierId: Record<string, string>;
  };
};
export type CreateResultFor<T extends CreateInput["type"]> =
  T extends keyof CreateResults ? CreateResults[T] : { id: string };
export type CreateResult = CreateResultFor<CreateInput["type"]>;

type Create = {
  <I extends CreateInput>(
    ctx: ServerFnContext,
    input: I
  ): Promise<ServerFnResult<CreateResultFor<I["type"]>>>;
} & ServerFn<typeof createInput, CreateResult>;

/** Creates receipts, shipments, NCR tasks, purchase orders and journal entries, per `type`. */
const create = defineServerFn({
  name: "create",
  input: createInput,
  permissions: {
    by: "type",
    rules: {
      nonConformanceTasks: { update: "quality" },
      purchaseOrderFromJob: { create: ["purchasing", "production"] },
      receiptDefault: { create: "inventory" },
      receiptFromPurchaseOrder: { create: "inventory" },
      receiptFromInboundTransfer: { create: "inventory" },
      receiptFromSalesReturnOrder: { create: "inventory" },
      receiptFromWarehouseTransfer: { create: "inventory" },
      receiptLineSplit: { create: "inventory" },
      shipmentDefault: { create: "inventory" },
      shipmentFromPurchaseOrder: { create: "inventory" },
      shipmentFromWarehouseTransfer: { create: "inventory" },
      shipmentFromPurchaseReturnOrder: { create: "inventory" },
      shipmentFromSalesOrder: { create: "inventory" },
      shipmentFromSalesReturnOrder: { create: "inventory" },
      shipmentFromSalesOrderLine: { create: "inventory" },
      shipmentLineSplit: { create: "inventory" },
      shipmentFromRentalAgreement: { create: "inventory" },
      receiptFromRentalAgreement: { create: "inventory" },
      journalEntry: { create: "accounting" }
    }
  },
  async run(ctx, input): Promise<CreateResult> {
    const { db, companyId, userId } = ctx;
    const payload = { ...input, companyId, userId };
    const { type } = payload;

    // Every receipt/shipment type writes the body's locationId onto the new
    // document (and its lines); the FK alone accepts another company's location.
    await assertCompanyRecords(
      db,
      "location",
      ["locationId" in payload ? payload.locationId : undefined],
      companyId,
      "Location"
    );

    switch (payload.type) {
      case "nonConformanceTasks": {
        const { id } = payload;

        logger.info({ type, id });

        const [nonConformance, actionTasks, approvalTasks, existingReviewers] =
          await inOrder([
            () => maybeSingle(db, "nonConformance", { id, companyId }),
            () =>
              many(db, "nonConformanceActionTask", {
                nonConformanceId: id,
                companyId
              }),
            () =>
              many(db, "nonConformanceApprovalTask", {
                nonConformanceId: id,
                companyId
              }),
            () =>
              many(db, "nonConformanceReviewer", {
                nonConformanceId: id,
                companyId
              })
          ]);

        if (nonConformance.error) throw new Error(nonConformance.error.message);
        if (!nonConformance.data)
          throw new NotFoundError("Non-conformance not found");

        const workflow = nonConformance.data?.nonConformanceWorkflowId
          ? await maybeSingle(db, "nonConformanceWorkflow", {
              id: nonConformance.data?.nonConformanceWorkflowId,
              companyId
            })
          : null;

        if (workflow?.error) throw new Error(workflow.error.message);

        const currentActionTasks =
          actionTasks.data?.reduce<Record<string, string>>((acc, d) => {
            if (d.actionTypeId && !acc[d.actionTypeId]) {
              acc[d.actionTypeId] = d.id;
            }
            return acc;
          }, {}) ?? {};

        const currentApprovalTasks =
          approvalTasks.data?.reduce<Record<string, string>>((acc, d) => {
            if (d.approvalType && !acc[d.approvalType]) {
              acc[d.approvalType] = d.id;
            }
            return acc;
          }, {}) ?? {};

        const actionTasksToDelete: string[] = [];
        const approvalTasksToDelete: string[] = [];
        const reviewersToDelete: string[] = [];

        Object.keys(currentActionTasks).forEach((actionTypeId) => {
          if (
            !(nonConformance.data?.requiredActionIds ?? []).some(
              (d) => d === actionTypeId
            )
          ) {
            actionTasksToDelete.push(currentActionTasks[actionTypeId]!);
          }
        });

        Object.keys(currentApprovalTasks).forEach((approvalType) => {
          if (
            !(nonConformance.data?.approvalRequirements ?? []).some(
              (d) => d === approvalType
            )
          ) {
            approvalTasksToDelete.push(currentApprovalTasks[approvalType]!);
          }
        });

        const actionTaskInserts: Database["public"]["Tables"]["nonConformanceActionTask"]["Insert"][] =
          [];
        const approvalTaskInserts: Database["public"]["Tables"]["nonConformanceApprovalTask"]["Insert"][] =
          [];

        const reviewerInserts: Database["public"]["Tables"]["nonConformanceReviewer"]["Insert"][] =
          [];

        nonConformance.data?.requiredActionIds?.forEach(
          (actionTypeId, index) => {
            if (!currentActionTasks[actionTypeId]) {
              actionTaskInserts.push({
                nonConformanceId: id,
                actionTypeId,
                sortOrder: index + 1,
                companyId,
                createdBy: userId
              });
            }
          }
        );

        nonConformance.data?.approvalRequirements?.forEach((approvalType) => {
          if (!currentApprovalTasks[approvalType]) {
            approvalTaskInserts.push({
              nonConformanceId: id,
              approvalType,
              companyId,
              createdBy: userId
            });
          }
        });

        // Check if MRB approval is required
        const hasMRBApproval =
          Array.isArray(nonConformance.data?.approvalRequirements) &&
          nonConformance.data?.approvalRequirements.includes("MRB");

        const hasExistingMRBTask =
          Object.keys(currentApprovalTasks).includes("MRB");
        const hasExistingReviewers = (existingReviewers.data?.length ?? 0) > 0;

        // If MRB is no longer required but we have existing reviewers, delete them
        if (!hasMRBApproval && hasExistingReviewers) {
          existingReviewers.data?.forEach((reviewer) => {
            reviewersToDelete.push(reviewer.id);
          });
        }
        // Only add reviewers if MRB is required and either:
        // 1. MRB task is newly added (not in currentApprovalTasks)
        // 2. There are no existing reviewers
        else if (
          hasMRBApproval &&
          (!hasExistingMRBTask || !hasExistingReviewers)
        ) {
          reviewerInserts.push({
            nonConformanceId: id,
            title: "Engineering",
            companyId,
            createdBy: userId
          });

          reviewerInserts.push({
            nonConformanceId: id,
            title: "Quality",
            companyId,
            createdBy: userId
          });
        }

        await db.transaction().execute(async (trx) => {
          if (
            typeof nonConformance.data?.content === "object" &&
            // @ts-ignore -- content is json
            Object.keys(nonConformance.data?.content ?? {}).length === 0
          ) {
            const contentFromWorkflow =
              (workflow?.data?.content as { content?: unknown[] } | null)
                ?.content ?? [];
            const insertedContent = {
              type: "doc",
              content: contentFromWorkflow
            };

            if (nonConformance.data?.description) {
              insertedContent.content.unshift({
                type: "paragraph",
                content: [
                  { type: "text", text: nonConformance.data?.description }
                ]
              });
            }

            logger.debug({
              description: nonConformance.data?.description,
              insertedContent
            });

            if (insertedContent.content.length > 0) {
              await trx
                .updateTable("nonConformance")
                .set({
                  content: JSON.stringify(insertedContent)
                })
                .where("id", "=", id)
                .where("companyId", "=", companyId)
                .execute();
            }
          }

          if (actionTaskInserts.length > 0) {
            await trx
              .insertInto("nonConformanceActionTask")
              .values(actionTaskInserts)
              .execute();
          }
          if (approvalTaskInserts.length > 0) {
            await trx
              .insertInto("nonConformanceApprovalTask")
              .values(approvalTaskInserts)
              .execute();
          }

          if (actionTasksToDelete.length > 0) {
            await trx
              .deleteFrom("nonConformanceActionTask")
              .where("id", "in", actionTasksToDelete)
              .where("companyId", "=", companyId)
              .execute();
          }
          if (approvalTasksToDelete.length > 0) {
            await trx
              .deleteFrom("nonConformanceApprovalTask")
              .where("id", "in", approvalTasksToDelete)
              .where("companyId", "=", companyId)
              .execute();
          }

          if (reviewerInserts.length > 0) {
            await trx
              .insertInto("nonConformanceReviewer")
              .values(reviewerInserts)
              .execute();
          }

          if (reviewersToDelete.length > 0) {
            await trx
              .deleteFrom("nonConformanceReviewer")
              .where("id", "in", reviewersToDelete)
              .where("companyId", "=", companyId)
              .execute();
          }
        });
        return { success: true };
      }

      case "purchaseOrderFromJob": {
        const { jobId, purchaseOrdersBySupplierId } = payload;
        // The PO each supplier's lines landed on (created or chosen), so a caller
        // releasing several jobs can put them on one PO per supplier.
        const purchaseOrderIdsBySupplierId: Record<string, string> = {};

        logger.info({ type, jobId, companyId, userId });
        const [job, jobOperations] = await inOrder([
          () => maybeSingle(db, "job", { id: jobId, companyId }),
          () =>
            many<
              "jobOperation",
              Tables["jobOperation"]["Row"] & {
                jobMakeMethod: Pick<
                  Tables["jobMakeMethod"]["Row"],
                  "itemId"
                > | null;
              }
            >(
              db,
              "jobOperation",
              { jobId, companyId },
              {
                embed: {
                  jobMakeMethod: {
                    table: "jobMakeMethod",
                    via: "jobMakeMethodId",
                    columns: ["itemId"]
                  }
                }
              }
            )
        ]);

        if (job.error) throw new Error(job.error.message);
        if (!job.data) throw new NotFoundError("Job not found");
        if (jobOperations.error) throw new Error(jobOperations.error.message);

        // Caller-chosen existing POs must belong to this company — lines are
        // appended to them by id below.
        await assertCompanyRecords(
          db,
          "purchaseOrder",
          Object.values(
            purchaseOrdersBySupplierId as Record<string, string>
          ).filter((poId) => poId && poId !== "new"),
          companyId,
          "Purchase order"
        );

        const outsideOperations = jobOperations.data?.filter(
          (d) => d.operationType === "Outside Processing"
        );

        if (outsideOperations.length > 0) {
          const supplierProcessIds = new Set(
            outsideOperations
              .map((d) => d.operationSupplierProcessId)
              .filter(Boolean)
          );
          const outsideProcessIds = new Set(
            outsideOperations.map((d) => d.processId).filter(Boolean)
          );
          const [
            supplierProcesses,
            supplierProcessesByProcess,
            existingPurchaseOrderLines
          ] = await inOrder([
            () =>
              supplierProcessIds.size > 0
                ? many(db, "supplierProcess", {
                    id: Array.from(supplierProcessIds) as string[],
                    companyId
                  })
                : Promise.resolve({ data: [], error: null }),
            () =>
              outsideProcessIds.size > 0
                ? many(db, "supplierProcess", {
                    processId: Array.from(outsideProcessIds),
                    companyId
                  })
                : Promise.resolve({ data: [], error: null }),
            () =>
              many(db, "purchaseOrderLine", {
                jobId,
                companyId,
                jobOperationId: outsideOperations.map((d) => d.id)
              })
          ]);

          if (supplierProcesses.error)
            throw new Error(supplierProcesses.error.message);
          if (supplierProcessesByProcess.error)
            throw new Error(supplierProcessesByProcess.error.message);

          // Resolve an operation's supplier process: its own, or — when it has none
          // — the sole supplier configured for its process (a process with exactly
          // one supplier is unambiguous). Mirrors the release modal's resolution so
          // an operation the modal counted as "has a supplier" actually gets a PO.
          const allSupplierProcesses = [
            ...(supplierProcesses.data ?? []),
            ...(supplierProcessesByProcess.data ?? [])
          ];
          const supplierProcessById = new Map(
            allSupplierProcesses.map((sp) => [sp.id, sp])
          );
          const supplierProcessesByProcessId = new Map<
            string,
            typeof allSupplierProcesses
          >();
          for (const sp of supplierProcessesByProcess.data ?? []) {
            const list = supplierProcessesByProcessId.get(sp.processId) ?? [];
            list.push(sp);
            supplierProcessesByProcessId.set(sp.processId, list);
          }
          const resolveSupplierProcess = (oo: {
            operationSupplierProcessId: string | null;
            processId: string | null;
          }) => {
            if (oo.operationSupplierProcessId) {
              return supplierProcessById.get(oo.operationSupplierProcessId);
            }
            const candidates = oo.processId
              ? (supplierProcessesByProcessId.get(oo.processId) ?? [])
              : [];
            return candidates.length === 1 ? candidates[0] : undefined;
          };

          const outsideOperationsBySupplierId = outsideOperations.reduce<
            Record<
              string,
              (Database["public"]["Tables"]["jobOperation"]["Row"] & {
                jobMakeMethod: { itemId: string } | null;
              })[]
            >
          >((acc, oo) => {
            const supplierProcess = resolveSupplierProcess(oo);
            if (
              existingPurchaseOrderLines.data?.find(
                (d) => d.jobOperationId === oo.id
              )
            ) {
              return acc;
            }
            if (!supplierProcess) return acc;
            if (!acc[supplierProcess.supplierId]) {
              acc[supplierProcess.supplierId] = [];
            }
            acc[supplierProcess.supplierId]!.push(oo);
            return acc;
          }, {});

          const supplierIds = new Set(
            Object.keys(outsideOperationsBySupplierId)
          );
          const itemIds = new Set(
            outsideOperations
              .map((d) => d.jobMakeMethod?.itemId)
              .filter(Boolean)
          );

          const [suppliers, supplierPayments, supplierShipping, items] =
            await inOrder([
              () =>
                many(db, "supplier", {
                  id: Array.from(supplierIds),
                  companyId
                }),
              () =>
                many(db, "supplierPayment", {
                  supplierId: Array.from(supplierIds),
                  companyId
                }),
              () =>
                many(db, "supplierShipping", {
                  supplierId: Array.from(supplierIds),
                  companyId
                }),
              () =>
                many(db, "item", {
                  id: Array.from(itemIds) as string[],
                  companyId
                })
            ]);

          if (suppliers.error) throw new Error(suppliers.error.message);
          if (supplierPayments.error)
            throw new Error(supplierPayments.error.message);
          if (supplierShipping.error)
            throw new Error(supplierShipping.error.message);

          // A supplier with no configured currency means "the company's own
          // base currency" (rate 1 by definition) -- never a hardcoded USD,
          // which is only correct for USD-base companies.
          const companyRecord = await single(
            db,
            "company",
            { id: companyId },
            { columns: ["baseCurrencyCode"] }
          );
          if (companyRecord.error) {
            throw new Error(companyRecord.error.message);
          }
          const baseCurrencyCode = companyRecord.data.baseCurrencyCode;

          const currencyCodes = new Set(
            suppliers.data?.map((d) => d.currencyCode ?? baseCurrencyCode)
          );

          // get_exchange_rate raises on a missing rate -- a resolver error
          // must fail the operation rather than default the rate.
          const exchangeRates = await Promise.all(
            Array.from(currencyCodes).map(async (currencyCode) => {
              const exchangeRate = await rpcValue(db, "get_exchange_rate", {
                p_company_id: companyId,
                p_currency_code: currencyCode
              });
              if (exchangeRate.error) {
                throw new Error(exchangeRate.error.message);
              }
              return {
                currencyCode,
                exchangeRate: Number(exchangeRate.data)
              };
            })
          );

          await db.transaction().execute(async (trx) => {
            for await (const supplier of Object.keys(
              outsideOperationsBySupplierId
            )) {
              const outsideOperations = outsideOperationsBySupplierId[supplier];

              const payment = supplierPayments.data?.find(
                (d) => d.supplierId === supplier
              );
              const shipping = supplierShipping.data?.find(
                (d) => d.supplierId === supplier
              );

              const supplierCurrencyCode =
                suppliers.data?.find((d) => d.id === supplier)?.currencyCode ??
                baseCurrencyCode;
              const exchangeRate = exchangeRates.find(
                (d) => d.currencyCode === supplierCurrencyCode
              )?.exchangeRate;
              if (exchangeRate === undefined) {
                throw new Error(
                  `No exchange rate resolved for currency ${supplierCurrencyCode}`
                );
              }

              let purchaseOrderId =
                purchaseOrdersBySupplierId[supplier] === "new"
                  ? undefined
                  : purchaseOrdersBySupplierId[supplier];

              if (!purchaseOrderId) {
                const supplierInteraction = await trx
                  .insertInto("supplierInteraction")
                  .values({
                    companyId,
                    supplierId: supplier
                  })
                  .returning(["id"])
                  .execute();

                const supplierInteractionId = supplierInteraction?.[0]?.id;
                const nextSequence = await getNextSequence(
                  trx,
                  "purchaseOrder",
                  companyId
                );

                if (!nextSequence)
                  throw new Error("Failed to get next sequence");
                if (!supplierInteractionId)
                  throw new Error("Failed to create supplier interaction");

                const order = await trx
                  .insertInto("purchaseOrder")
                  .values({
                    purchaseOrderId: nextSequence,
                    status: "Draft",
                    supplierId: supplier,
                    jobId: jobId,
                    jobReadableId: job.data?.jobId,
                    companyId: companyId,
                    createdBy: userId,
                    purchaseOrderType: "Outside Processing",
                    supplierInteractionId: supplierInteractionId,
                    currencyCode: supplierCurrencyCode,
                    exchangeRate,
                    exchangeRateUpdatedAt: datetime.timestamp()
                  })
                  .returning(["id"])
                  .execute();

                if (!order?.[0]?.id)
                  throw new Error("Failed to create purchase order");

                purchaseOrderId = order[0].id;

                // Create purchase order delivery and payment
                const locationId = job.data?.locationId ?? null; // Default location
                const shippingMethodId = shipping?.shippingMethodId;
                const shippingTermId = shipping?.shippingTermId;

                const paymentTermId = payment?.paymentTermId;
                const invoiceSupplierId = payment?.invoiceSupplierId;
                const invoiceSupplierContactId =
                  payment?.invoiceSupplierContactId;
                const invoiceSupplierLocationId =
                  payment?.invoiceSupplierLocationId;

                await Promise.all([
                  trx
                    .insertInto("purchaseOrderDelivery")
                    .values({
                      id: purchaseOrderId,
                      locationId,
                      shippingMethodId,
                      shippingTermId,
                      companyId
                    })
                    .execute(),
                  trx
                    .insertInto("purchaseOrderPayment")
                    .values({
                      id: purchaseOrderId,
                      invoiceSupplierId,
                      invoiceSupplierContactId,
                      invoiceSupplierLocationId,
                      paymentTermId,
                      companyId
                    })
                    .execute()
                ]);
              }

              purchaseOrderIdsBySupplierId[supplier] = purchaseOrderId;

              const purchaseOrderLineInserts: Database["public"]["Tables"]["purchaseOrderLine"]["Insert"][] =
                [];

              // Create purchase order lines for each process
              for await (const operation of outsideOperations!) {
                // Get the item associated with the operation
                const item = items.data?.find(
                  (d) => d.id === operation.jobMakeMethod?.itemId
                );
                const supplierProcess = resolveSupplierProcess(operation);

                if (item && supplierProcess) {
                  const totalCostWithUnitPrice =
                    (operation.operationUnitCost ?? 0) *
                    (operation.operationQuantity ?? 0);
                  const totalCostWithMinimumCost =
                    (operation.operationMinimumCost ?? 0) >
                    totalCostWithUnitPrice
                      ? (operation.operationMinimumCost ?? 0)
                      : totalCostWithUnitPrice;

                  // Create purchase order line
                  purchaseOrderLineInserts.push({
                    purchaseOrderId,
                    purchaseOrderLineType: item.type,
                    itemId: item.id,
                    description: item.name || item.description,
                    purchaseQuantity: operation.operationQuantity || 1,
                    purchaseUnitOfMeasureCode: item.unitOfMeasureCode,
                    inventoryUnitOfMeasureCode: item.unitOfMeasureCode,
                    conversionFactor: 1,
                    supplierUnitPrice:
                      operation.operationQuantity &&
                      operation.operationQuantity > 0
                        ? totalCostWithMinimumCost / operation.operationQuantity
                        : totalCostWithMinimumCost,
                    locationId: job.data?.locationId,
                    jobId: job.data?.id,
                    jobOperationId: operation.id,
                    companyId,
                    createdBy: userId,
                    exchangeRate
                  });
                }
              }

              // Insert all purchase order lines
              if (purchaseOrderLineInserts.length > 0) {
                await trx
                  .insertInto("purchaseOrderLine")
                  .values(purchaseOrderLineInserts)
                  .execute();
              }
            }
          });
        }

        return { success: true, purchaseOrderIdsBySupplierId };
      }
      case "receiptDefault": {
        const { locationId } = payload;
        let createdDocumentId;
        logger.info({ type, locationId, companyId, userId });
        const id = await db.transaction().execute(async (trx) => {
          createdDocumentId = await getNextSequence(trx, "receipt", companyId);
          const newReceipt = await trx
            .insertInto("receipt")
            .values({
              receiptId: createdDocumentId,
              companyId: companyId,
              locationId: locationId,
              createdBy: userId
            })
            .returning(["id", "receiptId"])
            .execute();

          createdDocumentId = newReceipt?.[0]?.id;
          if (!createdDocumentId) throw new Error("Failed to create receipt");
          return createdDocumentId;
        });

        return { id };
      }
      case "receiptFromPurchaseOrder": {
        const {
          purchaseOrderId,
          receiptId: existingReceiptId,
          locationId: userLocationId
        } = payload;

        logger.info({
          type,
          companyId,
          purchaseOrderId,
          existingReceiptId,
          userLocationId,
          userId
        });

        const [purchaseOrder, purchaseOrderLines, fixedAssetPoLines, receipt] =
          await inOrder([
            () =>
              single(db, "purchaseOrders", { companyId, id: purchaseOrderId }),
            () =>
              many(db, "purchaseOrderLine", {
                companyId,
                purchaseOrderId,
                purchaseOrderLineType: [
                  "Part",
                  "Material",
                  "Tool",
                  "Fixture",
                  "Consumable"
                ]
              }),
            () =>
              many(
                db,
                "purchaseOrderLine",
                {
                  companyId,
                  purchaseOrderId,
                  purchaseOrderLineType: "Fixed Asset"
                },
                {
                  columns: [
                    "id",
                    "purchaseOrderLineType",
                    "assetId",
                    "purchaseQuantity",
                    "quantityReceived",
                    "receivedComplete"
                  ]
                }
              ),
            () =>
              maybeSingle(db, "receipt", { companyId, id: existingReceiptId! })
          ]);

        if (!purchaseOrder.data)
          throw new NotFoundError("Purchase order not found");
        if (purchaseOrderLines.error)
          throw new Error(purchaseOrderLines.error.message);

        let locationId = purchaseOrder.data.locationId;
        if (
          purchaseOrderLines.data.some(
            (d) =>
              d.locationId !== locationId && d.locationId === userLocationId
          )
        ) {
          locationId = userLocationId ?? null;
        }

        const items = await many(
          db,
          "item",
          {
            companyId,
            id: purchaseOrderLines.data
              .filter((d) => d.locationId === locationId)
              .map((d) => d.itemId) as string[]
          },
          { columns: ["id", "itemTrackingType"] }
        );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        // Map (itemId, locationId) -> defaultStorageUnitId. Receipt lines
        // fall back to the pickMethod-configured storage unit for their
        // destination location when the purchase order line doesn't pin
        // one explicitly. Scoped by locationId because a single item can
        // be stocked across multiple locations with different defaults
        // per location (that's why pickMethod exists).
        const receiptItemIds = purchaseOrderLines.data
          .filter((d): d is typeof d & { itemId: string } => !!d.itemId)
          .map((d) => d.itemId);
        const pickMethods = await many(
          db,
          "pickMethod",
          { companyId, itemId: receiptItemIds },
          { columns: ["itemId", "locationId", "defaultStorageUnitId"] }
        );
        const pickMethodKey = (itemId: string, loc: string | null) =>
          `${itemId}::${loc ?? ""}`;
        const defaultStorageUnitByItemLocation = new Map<string, string>();
        for (const row of pickMethods.data ?? []) {
          if (row.defaultStorageUnitId) {
            defaultStorageUnitByItemLocation.set(
              pickMethodKey(row.itemId, row.locationId),
              row.defaultStorageUnitId
            );
          }
        }

        // A supplied id that is not this company's receipt is a 404, not a
        // silent create-new.
        if (existingReceiptId && !receipt.data)
          throw new NotFoundError("Receipt not found");
        const hasReceipt = !!receipt.data?.id;
        const isOutsideOperation =
          purchaseOrder.data.purchaseOrderType === "Outside Processing";

        const previouslyReceivedQuantitiesByLine = (
          purchaseOrderLines.data ?? []
        ).reduce<Record<string, number>>((acc, d) => {
          if (d.id) acc[d.id] = d.quantityReceived ?? 0;
          return acc;
        }, {});

        const receiptLineItems = purchaseOrderLines.data.reduce<
          ReceiptLineItem[]
        >((acc, d) => {
          if (
            !d.itemId ||
            !d.purchaseQuantity ||
            d.receivedComplete ||
            d.purchaseOrderLineType === "Service" ||
            d.purchaseOrderLineType === "G/L Account"
          ) {
            return acc;
          }

          const unitPrice = d.unitPrice ?? 0;
          const outstandingQuantity =
            d.purchaseQuantity -
            (previouslyReceivedQuantitiesByLine[d.id!] ?? 0);

          const shippingAndTaxUnitCost =
            ((d.taxAmount ?? 0) + (d.shippingCost ?? 0)) /
            (d.purchaseQuantity * (d.conversionFactor ?? 1));

          acc.push({
            lineId: d.id,
            companyId: companyId,
            itemId: d.itemId,
            orderQuantity: d.purchaseQuantity * (d.conversionFactor ?? 1),
            outstandingQuantity:
              outstandingQuantity * (d.conversionFactor ?? 1),
            receivedQuantity: outstandingQuantity * (d.conversionFactor ?? 1),
            conversionFactor: d.conversionFactor ?? 1,
            requiresSerialTracking:
              serializedItems.has(d.itemId) && !isOutsideOperation,
            requiresBatchTracking:
              batchItems.has(d.itemId) && !isOutsideOperation,
            unitPrice:
              unitPrice / (d.conversionFactor ?? 1) + shippingAndTaxUnitCost,
            unitOfMeasure: d.inventoryUnitOfMeasureCode ?? "EA",
            locationId: d.locationId ?? null,
            storageUnitId:
              d.storageUnitId ??
              defaultStorageUnitByItemLocation.get(
                pickMethodKey(d.itemId!, d.locationId ?? null)
              ) ??
              null,
            createdBy: userId ?? ""
          });

          return acc;
        }, []);

        const hasUnreceivedFaLines = (fixedAssetPoLines.data ?? []).some(
          (d) => d.assetId && d.purchaseQuantity && !d.receivedComplete
        );
        if (receiptLineItems.length === 0 && !hasUnreceivedFaLines) {
          throw new Error("No valid receipt line items found");
        }

        let receiptId = hasReceipt ? receipt.data?.id! : "";
        let receiptIdReadable = hasReceipt ? receipt.data?.receiptId! : "";

        await db.transaction().execute(async (trx) => {
          if (hasReceipt) {
            // update existing receipt
            await trx
              .updateTable("receipt")
              .set({
                sourceDocument: "Purchase Order",
                sourceDocumentId: purchaseOrder.data.id,
                sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
                locationId: locationId,
                updatedBy: userId
              })
              .where("id", "=", receiptId)
              .returning(["id", "receiptId"])
              .where("companyId", "=", companyId)
              .execute();
            // delete existing receipt lines
            await trx
              .deleteFrom("receiptLine")
              .where("receiptId", "=", receiptId)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            receiptIdReadable = await getNextSequence(
              trx,
              "receipt",
              companyId
            );
            const newReceipt = await trx
              .insertInto("receipt")
              .values({
                receiptId: receiptIdReadable,
                sourceDocument: "Purchase Order",
                sourceDocumentId: purchaseOrder.data.id,
                sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
                supplierId: purchaseOrder.data.supplierId,
                supplierInteractionId: purchaseOrder.data.supplierInteractionId,
                companyId: companyId,
                locationId: locationId,
                createdBy: userId
              })
              .returning(["id", "receiptId"])
              .execute();

            receiptId = newReceipt?.[0]?.id!;
            receiptIdReadable = newReceipt?.[0]?.receiptId!;
          }

          if (receiptLineItems.length > 0) {
            await trx
              .insertInto("receiptLine")
              .values(
                receiptLineItems.map((line) => ({
                  ...line,
                  receiptId: receiptId,
                  locationId
                }))
              )
              .execute();
          }

          const unreceivedFaLines = (fixedAssetPoLines.data ?? []).filter(
            (d) => d.assetId && d.purchaseQuantity && !d.receivedComplete
          );
          if (unreceivedFaLines.length > 0) {
            await trx
              .deleteFrom("receiptFixedAssetLine")
              .where("receiptId", "=", receiptId)
              .where("companyId", "=", companyId)
              .execute();
            await trx
              .insertInto("receiptFixedAssetLine")
              .values(
                unreceivedFaLines.map((line) => ({
                  receiptId: receiptId,
                  purchaseOrderLineId: line.id,
                  received: true,
                  companyId,
                  createdBy: userId
                }))
              )
              .execute();
          }
        });

        return { id: receiptId };
      }
      case "receiptFromInboundTransfer": {
        const { warehouseTransferId, receiptId: existingReceiptId } = payload;

        logger.info({
          type,
          companyId,
          warehouseTransferId,
          existingReceiptId,
          userId
        });

        const [warehouseTransfer, warehouseTransferLines, receipt] =
          await inOrder([
            () =>
              single(db, "warehouseTransfer", {
                companyId,
                id: warehouseTransferId
              }),
            () =>
              many(db, "warehouseTransferLine", {
                companyId,
                transferId: warehouseTransferId
              }),
            () =>
              maybeSingle(db, "receipt", { companyId, id: existingReceiptId! })
          ]);

        if (!warehouseTransfer.data)
          throw new NotFoundError("Warehouse transfer not found");
        if (warehouseTransferLines.error)
          throw new Error(warehouseTransferLines.error.message);

        const locationId = warehouseTransfer.data.toLocationId;

        const items = await many(
          db,
          "item",
          {
            companyId,
            id: warehouseTransferLines.data
              .map((d) => d.itemId)
              .filter(Boolean) as string[]
          },
          { columns: ["id", "itemTrackingType"] }
        );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        // A supplied id that is not this company's receipt is a 404, not a
        // silent create-new.
        if (existingReceiptId && !receipt.data)
          throw new NotFoundError("Receipt not found");
        const hasReceipt = !!receipt.data?.id;

        const previouslyReceivedQuantitiesByLine = (
          warehouseTransferLines.data ?? []
        ).reduce<Record<string, number>>((acc, d) => {
          if (d.id) acc[d.id] = d.receivedQuantity ?? 0;
          return acc;
        }, {});

        const receiptLineItems = warehouseTransferLines.data.reduce<
          ReceiptLineItem[]
        >((acc, d) => {
          if (!d.itemId || !d.quantity) return acc;

          const serialTracking = serializedItems.has(d.itemId);
          const batchTracking = batchItems.has(d.itemId);
          // For unshipped lines, we want all lines where shippedQuantity < quantity
          const quantityToReceive = Math.max(
            0,
            (d.shippedQuantity ?? 0) -
              (previouslyReceivedQuantitiesByLine[d.id] ?? 0)
          );

          if (quantityToReceive === 0) return acc;

          acc.push({
            lineId: d.id,
            itemId: d.itemId,
            locationId: d.toLocationId ?? locationId,
            storageUnitId: d.toStorageUnitId,
            requiresSerialTracking: serialTracking,
            requiresBatchTracking: batchTracking,
            receivedQuantity: quantityToReceive,
            outstandingQuantity: quantityToReceive,
            unitPrice: 0, // Transfers don't have a unit price
            conversionFactor: 1,
            unitOfMeasure: d.unitOfMeasureCode ?? "EA",
            companyId,
            createdBy: userId,
            orderQuantity: d.quantity ?? 0
          });

          return acc;
        }, []);

        if (receiptLineItems.length === 0) {
          throw new Error("No lines to receive");
        }

        const result = await db.transaction().execute(async (trx) => {
          const receiptId = await getNextSequence(trx, "receipt", companyId);

          let id: string;
          if (hasReceipt) {
            id = receipt.data!.id;
            await trx
              .updateTable("receipt")
              .set({
                sourceDocument: "Inbound Transfer",
                sourceDocumentId: warehouseTransferId,
                sourceDocumentReadableId: warehouseTransfer.data.transferId,
                locationId,
                updatedBy: userId
              })
              .where("id", "=", id)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            const insertReceipt = await trx
              .insertInto("receipt")
              .values({
                receiptId,
                sourceDocument: "Inbound Transfer",
                sourceDocumentId: warehouseTransferId,
                sourceDocumentReadableId: warehouseTransfer.data.transferId,
                locationId,
                status: "Draft",
                companyId,
                createdBy: userId
              })
              .returning(["id"])
              .execute();

            id = insertReceipt[0]?.id ?? "";
          }

          await trx
            .deleteFrom("receiptLine")
            .where("receiptId", "=", id)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .insertInto("receiptLine")
            .values(
              receiptLineItems.map((lineItem) => ({
                ...lineItem,
                receiptId: id
              }))
            )
            .execute();

          return { id };
        });

        return result;
      }
      case "receiptFromSalesReturnOrder": {
        const {
          salesReturnOrderId,
          receiptId: existingReceiptId,
          locationId: userLocationId
        } = payload;

        logger.info({
          function: "create",
          type,
          companyId,
          salesReturnOrderId,
          existingReceiptId,
          userId
        });

        const [salesReturnOrder, salesReturnOrderLines, receipt] =
          await inOrder([
            () =>
              single(db, "salesReturnOrder", {
                id: salesReturnOrderId,
                companyId
              }),
            () =>
              many(db, "salesReturnOrderLine", {
                salesReturnOrderId,
                companyId
              }),
            () =>
              maybeSingle(db, "receipt", { companyId, id: existingReceiptId! })
          ]);

        if (!salesReturnOrder.data)
          throw new NotFoundError("Sales return order not found");
        if (salesReturnOrder.data.status !== "To Receive")
          throw new Error(
            `Cannot receive against a return order in ${salesReturnOrder.data.status} status`
          );
        if (salesReturnOrderLines.error)
          throw new Error(salesReturnOrderLines.error.message);

        const locationId =
          userLocationId ?? salesReturnOrder.data.locationId ?? null;
        if (!locationId)
          throw new Error(
            "The return order has no receiving location — set one before creating a receipt"
          );

        const returnItemIds = salesReturnOrderLines.data
          .map((d) => d.itemId)
          .filter(Boolean) as string[];
        const items = await many(
          db,
          "item",
          { companyId, id: returnItemIds },
          { columns: ["id", "itemTrackingType"] }
        );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        const pickMethods = await many(
          db,
          "pickMethod",
          { companyId, itemId: returnItemIds },
          { columns: ["itemId", "locationId", "defaultStorageUnitId"] }
        );
        const defaultStorageUnitByItem = new Map<string, string>();
        for (const row of pickMethods.data ?? []) {
          if (row.defaultStorageUnitId && row.locationId === locationId) {
            defaultStorageUnitByItem.set(row.itemId, row.defaultStorageUnitId);
          }
        }

        // A supplied id that is not this company's receipt is a 404, not a
        // silent create-new.
        if (existingReceiptId && !receipt.data)
          throw new NotFoundError("Receipt not found");
        const hasReceipt = !!receipt.data?.id;
        // Re-targeting deletes and rebuilds the lines — only a Draft may be
        // rebuilt; a Posted document's lines are referenced by ledger rows.
        if (hasReceipt && receipt.data!.status !== "Draft")
          throw new Error(`Cannot re-source a ${receipt.data!.status} receipt`);

        const receiptLineItems = salesReturnOrderLines.data.reduce<
          ReceiptLineItem[]
        >((acc, d) => {
          if (!d.itemId || !d.quantity || d.closedComplete) return acc;

          const outstanding = Math.max(
            0,
            (d.quantity ?? 0) - (d.quantityReceived ?? 0)
          );
          if (outstanding === 0) return acc;

          acc.push({
            lineId: d.id,
            itemId: d.itemId,
            locationId,
            storageUnitId: defaultStorageUnitByItem.get(d.itemId) ?? null,
            requiresSerialTracking: serializedItems.has(d.itemId),
            requiresBatchTracking: batchItems.has(d.itemId),
            receivedQuantity: outstanding,
            outstandingQuantity: outstanding,
            // Cost is resolved at posting (original outbound cost / current /
            // zero-value reason) — never the line's credit-basis unitPrice.
            unitPrice: 0,
            conversionFactor: 1,
            unitOfMeasure: d.unitOfMeasureCode ?? "EA",
            companyId,
            createdBy: userId,
            orderQuantity: d.quantity ?? 0
          });

          return acc;
        }, []);

        if (receiptLineItems.length === 0) {
          throw new Error("No lines to receive");
        }

        const result = await db.transaction().execute(async (trx) => {
          const receiptId = await getNextSequence(trx, "receipt", companyId);

          let id: string;
          if (hasReceipt) {
            id = receipt.data!.id;
            await trx
              .updateTable("receipt")
              .set({
                sourceDocument: "Sales Return Order",
                sourceDocumentId: salesReturnOrderId,
                sourceDocumentReadableId:
                  salesReturnOrder.data.salesReturnOrderId,
                locationId,
                updatedBy: userId
              })
              .where("id", "=", id)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            const insertReceipt = await trx
              .insertInto("receipt")
              .values({
                receiptId,
                sourceDocument: "Sales Return Order",
                sourceDocumentId: salesReturnOrderId,
                sourceDocumentReadableId:
                  salesReturnOrder.data.salesReturnOrderId,
                locationId,
                status: "Draft",
                companyId,
                createdBy: userId
              })
              .returning(["id"])
              .execute();

            id = insertReceipt[0]?.id ?? "";
          }

          await trx
            .deleteFrom("receiptLine")
            .where("receiptId", "=", id)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .insertInto("receiptLine")
            .values(
              receiptLineItems.map((lineItem) => ({
                ...lineItem,
                receiptId: id
              }))
            )
            .execute();

          return { id };
        });

        return result;
      }
      case "receiptFromWarehouseTransfer": {
        const { warehouseTransferId, receiptId: existingReceiptId } = payload;

        logger.info({
          type,
          companyId,
          warehouseTransferId,
          existingReceiptId,
          userId
        });

        const [warehouseTransfer, warehouseTransferLines, receipt] =
          await inOrder([
            () =>
              single(db, "warehouseTransfer", {
                companyId,
                id: warehouseTransferId
              }),
            () =>
              many(db, "warehouseTransferLine", {
                companyId,
                transferId: warehouseTransferId
              }),
            () =>
              maybeSingle(db, "receipt", { companyId, id: existingReceiptId! })
          ]);

        if (!warehouseTransfer.data)
          throw new NotFoundError("Warehouse transfer not found");
        if (warehouseTransferLines.error)
          throw new Error(warehouseTransferLines.error.message);

        const locationId = warehouseTransfer.data.toLocationId;

        const items = await many(
          db,
          "item",
          {
            companyId,
            id: warehouseTransferLines.data
              .map((d) => d.itemId)
              .filter(Boolean) as string[]
          },
          { columns: ["id", "itemTrackingType"] }
        );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        // A supplied id that is not this company's receipt is a 404, not a
        // silent create-new.
        if (existingReceiptId && !receipt.data)
          throw new NotFoundError("Receipt not found");
        const hasReceipt = !!receipt.data?.id;

        const previouslyReceivedQuantitiesByLine = (
          warehouseTransferLines.data ?? []
        ).reduce<Record<string, number>>((acc, d) => {
          if (d.id) acc[d.id] = d.receivedQuantity ?? 0;
          return acc;
        }, {});

        const receiptLineItems = warehouseTransferLines.data.reduce<
          ReceiptLineItem[]
        >((acc, d) => {
          if (!d.itemId || !d.quantity) return acc;

          const serialTracking = serializedItems.has(d.itemId);
          const batchTracking = batchItems.has(d.itemId);
          const quantityToReceive = Math.max(
            0,
            (d.shippedQuantity ?? 0) -
              (previouslyReceivedQuantitiesByLine[d.id] ?? 0)
          );

          if (quantityToReceive === 0) return acc;

          acc.push({
            lineId: d.id,
            itemId: d.itemId,
            locationId: d.toLocationId ?? locationId,
            storageUnitId: d.toStorageUnitId,
            requiresSerialTracking: serialTracking,
            requiresBatchTracking: batchTracking,
            receivedQuantity: quantityToReceive,
            outstandingQuantity: quantityToReceive,
            unitPrice: 0, // Transfers don't have a unit price
            conversionFactor: 1,
            unitOfMeasure: d.unitOfMeasureCode ?? "EA",
            companyId,
            createdBy: userId,
            orderQuantity: d.quantity ?? 0
          });

          return acc;
        }, []);

        if (receiptLineItems.length === 0) {
          throw new Error("No lines to receive");
        }

        const result = await db.transaction().execute(async (trx) => {
          const receiptId = await getNextSequence(trx, "receipt", companyId);

          let id: string;
          if (hasReceipt) {
            id = receipt.data!.id;
            await trx
              .updateTable("receipt")
              .set({
                sourceDocument: "Inbound Transfer",
                sourceDocumentId: warehouseTransferId,
                sourceDocumentReadableId: warehouseTransfer.data.transferId,
                locationId,
                updatedBy: userId
              })
              .where("id", "=", id)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            const insertReceipt = await trx
              .insertInto("receipt")
              .values({
                receiptId,
                sourceDocument: "Inbound Transfer",
                sourceDocumentId: warehouseTransferId,
                sourceDocumentReadableId: warehouseTransfer.data.transferId,
                locationId,
                status: "Draft",
                companyId,
                createdBy: userId
              })
              .returning(["id"])
              .execute();

            id = insertReceipt[0]?.id ?? "";
          }

          await trx
            .insertInto("receiptLine")
            .values(
              receiptLineItems.map((d) => ({
                receiptId: id,
                lineId: d.lineId,
                itemId: d.itemId,
                locationId: d.locationId,
                storageUnitId: d.storageUnitId,
                requiresSerialTracking: d.requiresSerialTracking,
                requiresBatchTracking: d.requiresBatchTracking,
                receivedQuantity: d.receivedQuantity,
                outstandingQuantity: d.outstandingQuantity,
                unitPrice: d.unitPrice,
                conversionFactor: d.conversionFactor,
                unitOfMeasure: d.unitOfMeasure,
                orderQuantity: d.orderQuantity,
                companyId,
                createdBy: userId
              }))
            )
            .execute();

          return { id };
        });

        return result;
      }
      case "receiptLineSplit": {
        const { receiptId, receiptLineId, quantity, locationId } = payload;

        logger.info({
          type,
          locationId,
          receiptId,
          receiptLineId,
          quantity,
          userId
        });

        const [receiptLine, trackedEntities] = await inOrder([
          () => single(db, "receiptLine", { companyId, id: receiptLineId }),
          () =>
            many(db, "trackedEntity", {
              companyId,
              attributes: contains({ "Receipt Line": receiptLineId })
            })
        ]);

        logger.debug({ trackedEntities });

        if (!receiptLine.data)
          throw new NotFoundError("Receipt line not found");

        await db.transaction().execute(async (trx) => {
          const { id: _id, ...data } = receiptLine.data;

          if (
            receiptLine.data.requiresSerialTracking &&
            trackedEntities.data?.length
          ) {
            // TODO: update the Receipt Line and Index attributes to point to the new line
            await trx
              .deleteFrom("trackedEntity")
              .where("id", "in", trackedEntities.data?.map((d) => d.id) ?? [])
              .where("companyId", "=", companyId)
              .execute();
          }

          const newReceiptLineRows = await trx
            .insertInto("receiptLine")
            .values({
              ...data,
              orderQuantity: quantity,
              outstandingQuantity: quantity,
              receivedQuantity: quantity,
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          const newReceiptLineId = newReceiptLineRows[0]?.id;

          await trx
            .updateTable("receiptLine")
            .set({
              orderQuantity: receiptLine.data.orderQuantity - quantity,
              outstandingQuantity:
                receiptLine.data.outstandingQuantity - quantity,
              receivedQuantity: receiptLine.data.receivedQuantity - quantity,
              updatedBy: userId
            })
            .where("id", "=", receiptLineId)
            .where("companyId", "=", companyId)
            .execute();

          // Carry batch tracking onto the new line: clone each existing
          // trackedEntity (batch number + expirationDate + attributes) and
          // shrink the original entity's quantity by the split amount.
          if (
            !receiptLine.data.requiresSerialTracking &&
            newReceiptLineId &&
            trackedEntities.data?.length
          ) {
            for (const entity of trackedEntities.data) {
              const attrs = (entity.attributes ?? {}) as Record<
                string,
                unknown
              >;
              const { "Receipt Line Index": _ignored, ...rest } = attrs;
              const newAttributes = {
                ...rest,
                "Receipt Line": newReceiptLineId
              };

              await trx
                .insertInto("trackedEntity")
                .values({
                  id: nanoid(),
                  quantity: round(quantity),
                  status: entity.status,
                  sourceDocument: entity.sourceDocument,
                  sourceDocumentId: entity.sourceDocumentId,
                  sourceDocumentReadableId: entity.sourceDocumentReadableId,
                  readableId: entity.readableId,
                  attributes: newAttributes,
                  companyId: entity.companyId,
                  createdBy: userId,
                  itemId: entity.itemId,
                  expirationDate: entity.expirationDate
                })
                .execute();

              await trx
                .updateTable("trackedEntity")
                // A parent drained to zero by the split is Consumed, not a
                // zero-quantity Available husk; a Scrapped parent stays so.
                // The Math.max clamp is kept deliberately: a receipt-line
                // split over the parent's quantity has always clamped here
                // rather than refused, and that is not this change to make.
                .set(
                  settleQuantity({
                    quantity: Math.max(0, (entity.quantity ?? 0) - quantity),
                    status: entity.status
                  })
                )
                .where("id", "=", entity.id)
                .where("companyId", "=", companyId)
                .execute();
            }
          }
        });

        return { id: receiptLineId };
      }
      case "shipmentDefault": {
        let createdDocumentId;
        const { locationId } = payload;
        logger.info({ type, companyId, locationId, userId });
        const effectiveLocationId =
          locationId ?? (await getFallbackLocationId(db, companyId, userId));

        const id = await db.transaction().execute(async (trx) => {
          createdDocumentId = await getNextSequence(trx, "shipment", companyId);

          const newShipment = await trx
            .insertInto("shipment")
            .values({
              shipmentId: createdDocumentId,
              companyId: companyId,
              locationId: effectiveLocationId,
              createdBy: userId
            })
            .returning(["id", "shipmentId"])
            .execute();

          createdDocumentId = newShipment?.[0]?.id;
          if (!createdDocumentId) throw new Error("Failed to create shipment");
          return createdDocumentId;
        });

        return { id };
      }
      case "shipmentFromWarehouseTransfer": {
        const { warehouseTransferId, shipmentId: existingShipmentId } = payload;

        logger.info({
          type,
          companyId,
          warehouseTransferId,
          existingShipmentId,
          userId
        });

        const [warehouseTransfer, warehouseTransferLines, shipment] =
          await inOrder([
            () =>
              single(db, "warehouseTransfer", {
                companyId,
                id: warehouseTransferId
              }),
            () =>
              many(db, "warehouseTransferLine", {
                companyId,
                transferId: warehouseTransferId
              }),
            () =>
              maybeSingle(db, "shipment", {
                companyId,
                id: existingShipmentId!
              })
          ]);

        if (!warehouseTransfer.data)
          throw new NotFoundError("Warehouse transfer not found");
        if (warehouseTransferLines.error)
          throw new Error(warehouseTransferLines.error.message);

        const locationId = warehouseTransfer.data.toLocationId;

        const items = await many(
          db,
          "item",
          {
            companyId,
            id: warehouseTransferLines.data
              .map((d) => d.itemId)
              .filter(Boolean) as string[]
          },
          { columns: ["id", "itemTrackingType"] }
        );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        // A supplied id that is not this company's shipment is a 404, not a
        // silent create-new.
        if (existingShipmentId && !shipment.data)
          throw new NotFoundError("Shipment not found");
        const hasShipment = !!shipment.data?.id;

        const previouslyShippedQuantitiesByLine = (
          warehouseTransferLines.data ?? []
        ).reduce<Record<string, number>>((acc, d) => {
          if (d.id) acc[d.id] = d.shippedQuantity ?? 0;
          return acc;
        }, {});

        const shipmentLineItems = warehouseTransferLines.data.reduce<
          ShipmentLineItem[]
        >((acc, d) => {
          if (!d.itemId || !d.quantity) return acc;

          const serialTracking = serializedItems.has(d.itemId);
          const batchTracking = batchItems.has(d.itemId);
          // For unshipped lines, we want all lines where shippedQuantity < quantity
          const quantityToShip = Math.max(
            0,
            (d.quantity ?? 0) - (previouslyShippedQuantitiesByLine[d.id] ?? 0)
          );

          if (quantityToShip === 0) return acc;

          acc.push({
            lineId: d.id,
            itemId: d.itemId,
            locationId: d.fromLocationId ?? locationId,
            storageUnitId: d.fromStorageUnitId,
            requiresSerialTracking: serialTracking,
            requiresBatchTracking: batchTracking,
            shippedQuantity: quantityToShip,
            outstandingQuantity: quantityToShip,
            unitPrice: 0, // Transfers don't have a unit price
            unitOfMeasure: d.unitOfMeasureCode ?? "EA",
            companyId,
            createdBy: userId,
            orderQuantity: d.quantity ?? 0
          });

          return acc;
        }, []);

        if (shipmentLineItems.length === 0) {
          throw new Error("No lines to ship");
        }

        const result = await db.transaction().execute(async (trx) => {
          const shipmentId = await getNextSequence(trx, "shipment", companyId);

          let id: string;
          if (hasShipment) {
            id = shipment.data!.id;
            await trx
              .updateTable("shipment")
              .set({
                sourceDocument: "Outbound Transfer",
                sourceDocumentId: warehouseTransferId,
                sourceDocumentReadableId: warehouseTransfer.data.transferId,
                locationId,
                updatedBy: userId
              })
              .where("id", "=", id)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            const insertShipment = await trx
              .insertInto("shipment")
              .values({
                shipmentId,
                sourceDocument: "Outbound Transfer",
                sourceDocumentId: warehouseTransferId,
                sourceDocumentReadableId: warehouseTransfer.data.transferId,
                locationId,
                status: "Draft",
                companyId,
                createdBy: userId
              })
              .returning(["id"])
              .execute();

            id = insertShipment[0]?.id ?? "";
          }

          await trx
            .deleteFrom("shipmentLine")
            .where("shipmentId", "=", id)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .insertInto("shipmentLine")
            .values(
              shipmentLineItems.map((lineItem) => ({
                ...lineItem,
                shipmentId: id
              }))
            )
            .execute();

          return { id };
        });

        return result;
      }
      case "shipmentFromSalesReturnOrder": {
        // Return-to-customer shipment: ships back RECEIVED quantity on lines
        // dispositioned "Return to Customer", minus what earlier posted
        // shipments of this source already sent back.
        const {
          salesReturnOrderId,
          shipmentId: existingShipmentId,
          locationId: userLocationId
        } = payload;

        logger.info({
          function: "create",
          type,
          companyId,
          salesReturnOrderId,
          existingShipmentId,
          userId
        });

        const [salesReturnOrder, salesReturnOrderLines, shipment] =
          await inOrder([
            () =>
              single(db, "salesReturnOrder", {
                id: salesReturnOrderId,
                companyId
              }),
            () =>
              many(db, "salesReturnOrderLine", {
                salesReturnOrderId,
                companyId
              }),
            () =>
              maybeSingle(db, "shipment", {
                companyId,
                id: existingShipmentId!
              })
          ]);

        if (!salesReturnOrder.data)
          throw new NotFoundError("Sales return order not found");
        if (salesReturnOrderLines.error)
          throw new Error(salesReturnOrderLines.error.message);
        // Goods can only go back out once they came in: the return must be
        // confirmed (To Receive) or already Completed — never Draft/Cancelled.
        if (!["To Receive", "Completed"].includes(salesReturnOrder.data.status))
          throw new Error(
            `Cannot create a shipment for a ${salesReturnOrder.data.status} return order`
          );

        const locationId =
          userLocationId ?? salesReturnOrder.data.locationId ?? null;
        if (!locationId) throw new Error("The return order has no location");

        const returnLines = salesReturnOrderLines.data.filter(
          (d) => d.disposition === "Return to Customer"
        );
        if (returnLines.length === 0)
          throw new Error('No lines are dispositioned "Return to Customer"');

        // Quantity already shipped back by earlier posted shipments
        const priorShipments = await many(
          db,
          "shipment",
          {
            sourceDocumentId: salesReturnOrderId,
            sourceDocument: "Sales Return Order",
            status: "Posted",
            companyId
          },
          { columns: ["id"] }
        );
        const priorShipmentIds = (priorShipments.data ?? []).map((d) => d.id);
        const shippedBackByLine = new Map<string, number>();
        if (priorShipmentIds.length > 0) {
          const priorLines = await many(
            db,
            "shipmentLine",
            { companyId, shipmentId: priorShipmentIds },
            { columns: ["lineId", "shippedQuantity"] }
          );
          for (const line of priorLines.data ?? []) {
            if (!line.lineId) continue;
            shippedBackByLine.set(
              line.lineId,
              (shippedBackByLine.get(line.lineId) ?? 0) +
                (line.shippedQuantity ?? 0)
            );
          }
        }

        const returnItemIds = returnLines
          .map((d) => d.itemId)
          .filter(Boolean) as string[];
        const items = await many(
          db,
          "item",
          { companyId, id: returnItemIds },
          { columns: ["id", "itemTrackingType"] }
        );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        // A supplied id that is not this company's shipment is a 404, not a
        // silent create-new.
        if (existingShipmentId && !shipment.data)
          throw new NotFoundError("Shipment not found");
        const hasShipment = !!shipment.data?.id;
        if (hasShipment && shipment.data!.status !== "Draft")
          throw new Error(
            `Cannot re-source a ${shipment.data!.status} shipment`
          );

        const shipmentLineItems = returnLines.reduce<ShipmentLineItem[]>(
          (acc, d) => {
            if (!d.itemId) return acc;
            const outstanding = Math.max(
              0,
              (d.quantityReceived ?? 0) - (shippedBackByLine.get(d.id) ?? 0)
            );
            if (outstanding === 0) return acc;

            acc.push({
              lineId: d.id,
              itemId: d.itemId,
              locationId,
              requiresSerialTracking: serializedItems.has(d.itemId),
              requiresBatchTracking: batchItems.has(d.itemId),
              shippedQuantity: outstanding,
              outstandingQuantity: outstanding,
              orderQuantity: d.quantityReceived ?? 0,
              // No revenue on a rejected-claim return
              unitPrice: 0,
              unitOfMeasure: d.unitOfMeasureCode ?? "EA",
              companyId,
              createdBy: userId
            });
            return acc;
          },
          []
        );

        if (shipmentLineItems.length === 0) {
          throw new Error("No quantity remains to ship back");
        }

        const result = await db.transaction().execute(async (trx) => {
          const shipmentId = await getNextSequence(trx, "shipment", companyId);

          let id: string;
          if (hasShipment) {
            id = shipment.data!.id;
            await trx
              .updateTable("shipment")
              .set({
                sourceDocument: "Sales Return Order",
                sourceDocumentId: salesReturnOrderId,
                sourceDocumentReadableId:
                  salesReturnOrder.data.salesReturnOrderId,
                customerId: salesReturnOrder.data.customerId,
                locationId,
                updatedBy: userId
              })
              .where("id", "=", id)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            const insertShipment = await trx
              .insertInto("shipment")
              .values({
                shipmentId,
                sourceDocument: "Sales Return Order",
                sourceDocumentId: salesReturnOrderId,
                sourceDocumentReadableId:
                  salesReturnOrder.data.salesReturnOrderId,
                customerId: salesReturnOrder.data.customerId,
                locationId,
                status: "Draft",
                companyId,
                createdBy: userId
              })
              .returning(["id"])
              .execute();

            id = insertShipment[0]?.id ?? "";
          }

          await trx
            .deleteFrom("shipmentLine")
            .where("shipmentId", "=", id)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .insertInto("shipmentLine")
            .values(
              shipmentLineItems.map((lineItem) => ({
                ...lineItem,
                shipmentId: id
              }))
            )
            .execute();

          return { id };
        });

        return result;
      }
      case "shipmentFromPurchaseReturnOrder": {
        // Supplier return shipment: open (not short-closed) return lines,
        // quantity minus already shipped. Quantities are inventory units.
        const {
          purchaseReturnOrderId,
          shipmentId: existingShipmentId,
          locationId: userLocationId
        } = payload;

        logger.info({
          function: "create",
          type,
          companyId,
          purchaseReturnOrderId,
          existingShipmentId,
          userId
        });

        const [purchaseReturnOrder, purchaseReturnOrderLines, shipment] =
          await inOrder([
            () =>
              single(db, "purchaseReturnOrder", {
                id: purchaseReturnOrderId,
                companyId
              }),
            () =>
              many(db, "purchaseReturnOrderLine", {
                purchaseReturnOrderId,
                companyId
              }),
            () =>
              maybeSingle(db, "shipment", {
                companyId,
                id: existingShipmentId!
              })
          ]);

        if (!purchaseReturnOrder.data)
          throw new NotFoundError("Purchase return order not found");
        if (purchaseReturnOrder.data.status !== "To Ship")
          throw new Error(
            `Cannot ship against a return order in ${purchaseReturnOrder.data.status} status`
          );
        if (purchaseReturnOrderLines.error)
          throw new Error(purchaseReturnOrderLines.error.message);

        const locationId =
          userLocationId ?? purchaseReturnOrder.data.locationId ?? null;
        if (!locationId) throw new Error("The return order has no location");

        const returnItemIds = purchaseReturnOrderLines.data
          .map((d) => d.itemId)
          .filter(Boolean) as string[];
        const items = await many(
          db,
          "item",
          { companyId, id: returnItemIds },
          { columns: ["id", "itemTrackingType"] }
        );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        // A supplied id that is not this company's shipment is a 404, not a
        // silent create-new.
        if (existingShipmentId && !shipment.data)
          throw new NotFoundError("Shipment not found");
        const hasShipment = !!shipment.data?.id;
        if (hasShipment && shipment.data!.status !== "Draft")
          throw new Error(
            `Cannot re-source a ${shipment.data!.status} shipment`
          );

        const shipmentLineItems = purchaseReturnOrderLines.data.reduce<
          ShipmentLineItem[]
        >((acc, d) => {
          if (!d.itemId || d.closedComplete) return acc;
          const outstanding = Math.max(
            0,
            (d.quantity ?? 0) - (d.quantityShipped ?? 0)
          );
          if (outstanding === 0) return acc;

          acc.push({
            lineId: d.id,
            itemId: d.itemId,
            locationId,
            requiresSerialTracking: serializedItems.has(d.itemId),
            requiresBatchTracking: batchItems.has(d.itemId),
            shippedQuantity: outstanding,
            outstandingQuantity: outstanding,
            orderQuantity: d.quantity ?? 0,
            unitPrice: d.unitPrice ?? 0,
            unitOfMeasure: d.unitOfMeasureCode ?? "EA",
            companyId,
            createdBy: userId
          });
          return acc;
        }, []);

        if (shipmentLineItems.length === 0) {
          throw new Error("No lines to ship");
        }

        // Carry the batches/serials picked on each return line onto the
        // shipment's tracked entities, so the shipment already knows what to
        // send back (post-shipment reads entities via attributes ->> Shipment).
        const returnLineIds = purchaseReturnOrderLines.data.map((l) => l.id);
        const lineTrackedEntities = await many<
          "purchaseReturnOrderLineTrackedEntity",
          Pick<
            Tables["purchaseReturnOrderLineTrackedEntity"]["Row"],
            "purchaseReturnOrderLineId"
          > & {
            trackedEntity: Pick<
              Tables["trackedEntity"]["Row"],
              "id" | "attributes"
            > | null;
          }
        >(
          db,
          "purchaseReturnOrderLineTrackedEntity",
          { purchaseReturnOrderLineId: returnLineIds, companyId },
          {
            columns: ["purchaseReturnOrderLineId"],
            embed: {
              trackedEntity: {
                table: "trackedEntity",
                via: "trackedEntityId",
                columns: ["id", "attributes"]
              }
            }
          }
        );
        if (lineTrackedEntities.error)
          throw new Error(lineTrackedEntities.error.message);

        const entitiesByReturnLine = new Map<
          string,
          { id: string; attributes: Record<string, unknown> | null }[]
        >();
        for (const row of lineTrackedEntities.data ?? []) {
          const entity = row.trackedEntity;
          if (!entity) continue;
          const list =
            entitiesByReturnLine.get(row.purchaseReturnOrderLineId) ?? [];
          list.push({
            id: entity.id,
            attributes: entity.attributes as Record<string, unknown> | null
          });
          entitiesByReturnLine.set(row.purchaseReturnOrderLineId, list);
        }

        // Re-source path: clear the shipment tag off any entity previously
        // stamped for this shipment before re-stamping the current selection.
        const staleEntities = hasShipment
          ? await many(
              db,
              "trackedEntity",
              {
                companyId,
                attributes: contains({ Shipment: shipment.data!.id })
              },
              { columns: ["id", "attributes"] }
            )
          : { data: [], error: null };
        if (staleEntities.error) throw new Error(staleEntities.error.message);

        const result = await db.transaction().execute(async (trx) => {
          const shipmentId = await getNextSequence(trx, "shipment", companyId);

          let id: string;
          if (hasShipment) {
            id = shipment.data!.id;
            await trx
              .updateTable("shipment")
              .set({
                sourceDocument: "Purchase Return Order",
                sourceDocumentId: purchaseReturnOrderId,
                sourceDocumentReadableId:
                  purchaseReturnOrder.data.purchaseReturnOrderId,
                supplierId: purchaseReturnOrder.data.supplierId,
                locationId,
                updatedBy: userId
              })
              .where("id", "=", id)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            const insertShipment = await trx
              .insertInto("shipment")
              .values({
                shipmentId,
                sourceDocument: "Purchase Return Order",
                sourceDocumentId: purchaseReturnOrderId,
                sourceDocumentReadableId:
                  purchaseReturnOrder.data.purchaseReturnOrderId,
                supplierId: purchaseReturnOrder.data.supplierId,
                locationId,
                status: "Draft",
                companyId,
                createdBy: userId
              })
              .returning(["id"])
              .execute();

            id = insertShipment[0]?.id ?? "";
          }

          await trx
            .deleteFrom("shipmentLine")
            .where("shipmentId", "=", id)
            .where("companyId", "=", companyId)
            .execute();

          const insertedLines = await trx
            .insertInto("shipmentLine")
            .values(
              shipmentLineItems.map((lineItem) => ({
                ...lineItem,
                shipmentId: id
              }))
            )
            .returning(["id", "lineId"])
            .execute();

          // Strip the shipment tag off entities left over from a prior source.
          for (const entity of staleEntities.data ?? []) {
            const attrs = {
              ...((entity.attributes as Record<string, unknown> | null) ?? {})
            };
            delete attrs.Shipment;
            delete attrs["Shipment Line"];
            delete attrs["Shipment Line Index"];
            await trx
              .updateTable("trackedEntity")
              .set({ attributes: attrs as Json })
              .where("id", "=", entity.id)
              .where("companyId", "=", companyId)
              .execute();
          }

          // Stamp each return line's picked entities onto its shipment line, so
          // the batch/serial flows through to posting. post-shipment splits a
          // batch when the shipped quantity is less than the entity's quantity.
          for (const shipmentLine of insertedLines) {
            const entities = shipmentLine.lineId
              ? entitiesByReturnLine.get(shipmentLine.lineId)
              : undefined;
            for (const entity of entities ?? []) {
              const attrs = {
                ...(entity.attributes ?? {}),
                Shipment: id,
                "Shipment Line": shipmentLine.id
              };
              await trx
                .updateTable("trackedEntity")
                .set({ attributes: attrs as Json })
                .where("id", "=", entity.id)
                .where("companyId", "=", companyId)
                .execute();
            }
          }

          return { id };
        });

        return result;
      }
      case "shipmentFromPurchaseOrder": {
        const {
          purchaseOrderId,
          shipmentId: existingShipmentId,
          locationId
        } = payload;

        logger.info({
          type,
          companyId,
          locationId,
          purchaseOrderId,
          existingShipmentId,
          userId
        });

        const [
          purchaseOrder,
          purchaseOrderLines,
          purchaseOrderDelivery,
          shipment
        ] = await inOrder([
          () => single(db, "purchaseOrder", { companyId, id: purchaseOrderId }),
          () =>
            many(db, "purchaseOrderLine", {
              companyId,
              purchaseOrderId,
              purchaseOrderLineType: [
                "Part",
                "Material",
                "Tool",
                "Fixture",
                "Consumable"
              ],
              locationId
            }),
          () =>
            maybeSingle(db, "purchaseOrderDelivery", {
              companyId,
              id: purchaseOrderId
            }),
          () =>
            maybeSingle(db, "shipment", { companyId, id: existingShipmentId! })
        ]);

        if (!purchaseOrder.data)
          throw new NotFoundError("Purchase order not found");
        if (purchaseOrderLines.error)
          throw new Error(purchaseOrderLines.error.message);

        const items = await many(
          db,
          "item",
          {
            companyId,
            id: purchaseOrderLines.data.map((d) => d.itemId) as string[]
          },
          { columns: ["id", "itemTrackingType"] }
        );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        // A supplied id that is not this company's shipment is a 404, not a
        // silent create-new.
        if (existingShipmentId && !shipment.data)
          throw new NotFoundError("Shipment not found");
        const hasShipment = !!shipment.data?.id;
        const isOutsideOperation =
          purchaseOrder.data.purchaseOrderType === "Outside Processing";

        const previouslyShippedQuantitiesByLine = (
          purchaseOrderLines.data ?? []
        ).reduce<Record<string, number>>((acc, d) => {
          if (d.id) acc[d.id] = d.quantityShipped ?? 0;
          return acc;
        }, {});

        let shipmentId = hasShipment ? shipment.data?.id! : "";
        let shipmentIdReadable = hasShipment ? shipment.data?.shipmentId! : "";

        await db.transaction().execute(async (trx) => {
          if (hasShipment) {
            // update existing shipment
            await trx
              .updateTable("shipment")
              .set({
                sourceDocument: "Purchase Order",
                sourceDocumentId: purchaseOrder.data.id,
                sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
                supplierId: purchaseOrder.data.supplierId,
                supplierInteractionId: purchaseOrder.data.supplierInteractionId,
                shippingMethodId: purchaseOrderDelivery.data?.shippingMethodId,
                locationId: locationId,
                updatedBy: userId
              })
              .where("id", "=", shipmentId)
              .returning(["id", "shipmentId"])
              .where("companyId", "=", companyId)
              .execute();
            // delete existing shipment lines
            await trx
              .deleteFrom("shipmentLine")
              .where("shipmentId", "=", shipmentId)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            shipmentIdReadable = await getNextSequence(
              trx,
              "shipment",
              companyId
            );

            const newShipment = await trx
              .insertInto("shipment")
              .values({
                shipmentId: shipmentIdReadable,
                sourceDocument: "Purchase Order",
                sourceDocumentId: purchaseOrder.data.id,
                sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
                externalDocumentId: purchaseOrder.data.supplierReference,
                supplierId: purchaseOrder.data.supplierId,
                supplierInteractionId: purchaseOrder.data.supplierInteractionId,
                shippingMethodId: purchaseOrderDelivery.data?.shippingMethodId,
                companyId: companyId,
                locationId: locationId,
                createdBy: userId
              })
              .returning(["id", "shipmentId"])
              .execute();

            shipmentId = newShipment?.[0]?.id!;
            shipmentIdReadable = newShipment?.[0]?.shipmentId!;
          }

          // Process each sales order line
          for await (const purchaseOrderLine of purchaseOrderLines.data) {
            if (
              !purchaseOrderLine.itemId ||
              !purchaseOrderLine.purchaseQuantity ||
              purchaseOrderLine.purchaseOrderLineType === "Service" ||
              purchaseOrderLine.purchaseOrderLineType === "G/L Account"
            ) {
              continue;
            }

            const isSerial = serializedItems.has(purchaseOrderLine.itemId);
            const isBatch = batchItems.has(purchaseOrderLine.itemId);

            const outstandingQuantity =
              (purchaseOrderLine.purchaseQuantity ?? 0) -
              (previouslyShippedQuantitiesByLine[purchaseOrderLine.id] ?? 0);

            const shippingAndTaxUnitCost =
              ((purchaseOrderLine.shippingCost ?? 0) /
                (purchaseOrderLine.purchaseQuantity ?? 0) +
                (purchaseOrderLine.unitPrice ?? 0)) *
              (1 + (purchaseOrderLine.taxPercent ?? 0));

            await trx
              .insertInto("shipmentLine")
              .values({
                shipmentId: shipmentId,
                lineId: purchaseOrderLine.id,
                companyId: companyId,
                itemId: purchaseOrderLine.itemId,
                orderQuantity: purchaseOrderLine.purchaseQuantity,
                outstandingQuantity: outstandingQuantity,
                shippedQuantity: outstandingQuantity ?? 0,
                requiresSerialTracking: isSerial && !isOutsideOperation,
                requiresBatchTracking: isBatch && !isOutsideOperation,
                unitPrice: shippingAndTaxUnitCost,
                unitOfMeasure:
                  purchaseOrderLine.purchaseUnitOfMeasureCode ?? "EA",
                locationId: purchaseOrderLine.locationId,
                storageUnitId: purchaseOrderLine.storageUnitId,
                createdBy: userId ?? ""
              })
              .execute();
          }
        });

        return { id: shipmentId };
      }
      case "shipmentFromSalesOrder": {
        const {
          salesOrderId,
          shipmentId: existingShipmentId,
          locationId
        } = payload;

        logger.info({
          type,
          companyId,
          locationId,
          salesOrderId,
          existingShipmentId,
          userId
        });

        const [
          salesOrder,
          salesOrderLines,
          fixedAssetSoLines,
          salesOrderShipment,
          shipment,
          jobs
        ] = await inOrder([
          () => single(db, "salesOrder", { id: salesOrderId, companyId }),
          () =>
            many(db, "salesOrderLine", {
              companyId,
              salesOrderId,
              salesOrderLineType: [
                "Part",
                "Material",
                "Tool",
                "Fixture",
                "Consumable"
              ],
              locationId
            }),
          () =>
            many(
              db,
              "salesOrderLine",
              { companyId, salesOrderId, salesOrderLineType: "Fixed Asset" },
              {
                columns: [
                  "id",
                  "salesOrderLineType",
                  "assetId",
                  "saleQuantity",
                  "quantitySent",
                  "sentComplete"
                ]
              }
            ),
          () =>
            maybeSingle(db, "salesOrderShipment", {
              companyId,
              id: salesOrderId
            }),
          () =>
            maybeSingle(db, "shipment", { companyId, id: existingShipmentId! }),
          () =>
            many(db, "job", {
              companyId,
              salesOrderId,
              status: neq("Cancelled")
            })
        ]);

        if (!salesOrder.data) throw new NotFoundError("Sales order not found");
        if (salesOrderLines.error)
          throw new Error(salesOrderLines.error.message);

        const items = await many(
          db,
          "item",
          {
            companyId,
            id: salesOrderLines.data.map((d) => d.itemId) as string[]
          },
          { columns: ["id", "itemTrackingType"] }
        );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        // A supplied id that is not this company's shipment is a 404, not a
        // silent create-new.
        if (existingShipmentId && !shipment.data)
          throw new NotFoundError("Shipment not found");
        const hasShipment = !!shipment.data?.id;

        // Group jobs by sales order line ID
        const jobsBySalesOrderLine = (jobs.data || []).reduce<
          Record<string, Database["public"]["Tables"]["job"]["Row"][]>
        >((acc, job) => {
          if (job.salesOrderLineId) {
            if (!acc[job.salesOrderLineId]) {
              acc[job.salesOrderLineId] = [];
            }
            acc[job.salesOrderLineId]!.push(job);
          }
          return acc;
        }, {});

        const previouslyShippedQuantitiesByLine = (
          salesOrderLines.data ?? []
        ).reduce<Record<string, number>>((acc, d) => {
          if (d.id) acc[d.id] = d.quantitySent ?? 0;
          return acc;
        }, {});

        let shipmentId = hasShipment ? shipment.data?.id! : "";
        let shipmentIdReadable = hasShipment ? shipment.data?.shipmentId! : "";

        await db.transaction().execute(async (trx) => {
          if (hasShipment) {
            // update existing shipment
            await trx
              .updateTable("shipment")
              .set({
                sourceDocument: "Sales Order",
                sourceDocumentId: salesOrder.data.id,
                sourceDocumentReadableId: salesOrder.data.salesOrderId,
                customerId: salesOrder.data.customerId,
                shippingMethodId: salesOrderShipment.data?.shippingMethodId,
                opportunityId: salesOrder.data.opportunityId,
                locationId: locationId,
                updatedBy: userId
              })
              .where("id", "=", shipmentId)
              .returning(["id", "shipmentId"])
              .where("companyId", "=", companyId)
              .execute();
            // delete existing shipment lines
            await trx
              .deleteFrom("shipmentLine")
              .where("shipmentId", "=", shipmentId)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            shipmentIdReadable = await getNextSequence(
              trx,
              "shipment",
              companyId
            );

            const newShipment = await trx
              .insertInto("shipment")
              .values({
                shipmentId: shipmentIdReadable,
                sourceDocument: "Sales Order",
                sourceDocumentId: salesOrder.data.id,
                sourceDocumentReadableId: salesOrder.data.salesOrderId,
                externalDocumentId: salesOrder.data.customerReference,
                shippingMethodId: salesOrderShipment.data?.shippingMethodId,
                customerId: salesOrder.data.customerId,
                opportunityId: salesOrder.data.opportunityId,
                companyId: companyId,
                locationId: locationId,
                createdBy: userId
              })
              .returning(["id", "shipmentId"])
              .execute();

            shipmentId = newShipment?.[0]?.id!;
            shipmentIdReadable = newShipment?.[0]?.shipmentId!;
          }

          const shipmentLineItems: ShipmentLineItem[] = [];

          // Process each sales order line
          for await (const salesOrderLine of salesOrderLines.data) {
            if (
              !salesOrderLine.itemId ||
              !salesOrderLine.saleQuantity ||
              salesOrderLine.salesOrderLineType === "Service"
            ) {
              continue;
            }

            const isSerial = serializedItems.has(salesOrderLine.itemId);
            const isBatch = batchItems.has(salesOrderLine.itemId);

            if (salesOrderLine.methodType === "Make to Order") {
              for await (const job of jobsBySalesOrderLine[salesOrderLine.id] ??
                []) {
                if (!salesOrderLine.itemId) return;

                const quantityToShip = Math.max(
                  0,
                  (job.quantityComplete ?? 0) - (job.quantityShipped ?? 0)
                );

                if (!isSerial || (isSerial && quantityToShip > 0)) {
                  const fulfillment = await trx
                    .insertInto("fulfillment")
                    .values({
                      salesOrderLineId: salesOrderLine.id,
                      type: "Job",
                      jobId: job.id,
                      quantity: quantityToShip,
                      companyId: companyId,
                      createdBy: userId
                    })
                    .returning(["id"])
                    .execute();

                  const fulfillmentId = fulfillment?.[0]?.id;

                  const shippingAndTaxUnitCost =
                    (salesOrderLine.shippingCost / quantityToShip +
                      (salesOrderLine.unitPrice ?? 0)) *
                    (1 + salesOrderLine.taxPercent);

                  const shipmentLine = await trx
                    .insertInto("shipmentLine")
                    .values({
                      shipmentId: shipmentId,
                      lineId: salesOrderLine.id,
                      companyId: companyId,
                      fulfillmentId,
                      itemId: salesOrderLine.itemId,
                      orderQuantity: salesOrderLine.saleQuantity,
                      outstandingQuantity:
                        salesOrderLine.quantityToSend ??
                        salesOrderLine.saleQuantity,
                      shippedQuantity: quantityToShip,
                      requiresSerialTracking: isSerial,
                      requiresBatchTracking: isBatch,
                      unitPrice: shippingAndTaxUnitCost,
                      unitOfMeasure: salesOrderLine.unitOfMeasureCode ?? "EA",
                      createdBy: userId ?? ""
                    })
                    .returning(["id"])
                    .execute();

                  const shipmentLineId = shipmentLine?.[0]?.id;

                  if (!shipmentLineId)
                    throw new NotFoundError("Shipment line not found");

                  if (isSerial || isBatch) {
                    const jobMakeMethod = await trx
                      .selectFrom("jobMakeMethod")
                      .select(["id"])
                      .where("jobId", "=", job.id)
                      .where("parentMaterialId", "is", null)
                      .executeTakeFirst();

                    if (jobMakeMethod?.id) {
                      const trackedEntities = await many(
                        trx,
                        "trackedEntity",
                        {
                          companyId,
                          attributes: contains({
                            "Job Make Method": jobMakeMethod.id
                          })
                        },
                        { orderBy: ["createdAt", "readableId", "id"] }
                      );

                      let index = 0;
                      for await (const trackedEntity of trackedEntities?.data ??
                        []) {
                        await trx
                          .updateTable("trackedEntity")
                          .set({
                            attributes: {
                              ...(trackedEntity.attributes as Record<
                                string,
                                unknown
                              >),
                              Shipment: shipmentId,
                              "Shipment Line": shipmentLineId,
                              "Shipment Line Index": index
                            }
                          })
                          .where("id", "=", trackedEntity.id)
                          .where("companyId", "=", companyId)
                          .execute();
                        index++;
                      }
                    }
                  }
                }
              }
            } else {
              const outstandingQuantity =
                (salesOrderLine.saleQuantity ?? 0) -
                (previouslyShippedQuantitiesByLine[salesOrderLine.id] ?? 0);

              const shippingAndTaxUnitCost =
                (salesOrderLine.shippingCost /
                  (salesOrderLine.saleQuantity ?? 0) +
                  (salesOrderLine.unitPrice ?? 0)) *
                (1 + salesOrderLine.taxPercent);

              await trx
                .insertInto("shipmentLine")
                .values({
                  shipmentId: shipmentId,
                  lineId: salesOrderLine.id,
                  companyId: companyId,
                  itemId: salesOrderLine.itemId,
                  orderQuantity: salesOrderLine.saleQuantity,
                  outstandingQuantity: outstandingQuantity,
                  shippedQuantity: outstandingQuantity ?? 0,
                  requiresSerialTracking: isSerial,
                  requiresBatchTracking: isBatch,
                  unitPrice: shippingAndTaxUnitCost,
                  unitOfMeasure: salesOrderLine.unitOfMeasureCode ?? "EA",
                  locationId: salesOrderLine.locationId,
                  storageUnitId: salesOrderLine.storageUnitId,
                  createdBy: userId ?? ""
                })
                .execute();
            }
          }

          if (shipmentLineItems.length > 0) {
            // Insert all shipment lines
            await trx
              .insertInto("shipmentLine")
              .values(
                shipmentLineItems.map((line) => ({
                  ...line,
                  shipmentId: shipmentId,
                  locationId
                }))
              )
              .execute();
          }

          const unshippedFaLines = (fixedAssetSoLines.data ?? []).filter(
            (d) => d.assetId && d.saleQuantity && !d.sentComplete
          );
          if (unshippedFaLines.length > 0) {
            await trx
              .deleteFrom("shipmentFixedAssetLine")
              .where("shipmentId", "=", shipmentId)
              .where("companyId", "=", companyId)
              .execute();
            await trx
              .insertInto("shipmentFixedAssetLine")
              .values(
                unshippedFaLines.map((line) => ({
                  shipmentId: shipmentId,
                  salesOrderLineId: line.id,
                  shipped: true,
                  companyId,
                  createdBy: userId
                }))
              )
              .execute();
          }
        });

        return { id: shipmentId };
      }
      case "shipmentFromSalesOrderLine": {
        const {
          salesOrderLineId,
          shipmentId: existingShipmentId,
          locationId
        } = payload;

        logger.info({
          type,
          companyId,
          locationId,
          salesOrderLineId,
          existingShipmentId,
          userId
        });

        const salesOrderLine = await single(db, "salesOrderLine", {
          companyId,
          id: salesOrderLineId,
          locationId
        });

        if (!salesOrderLine.data || !salesOrderLine.data.itemId)
          throw new NotFoundError("Sales order line not found");
        // Services are never shipped
        if (salesOrderLine.data.salesOrderLineType === "Service")
          throw new Error("Service lines cannot be shipped");
        const salesOrderId = salesOrderLine.data.salesOrderId;

        const [salesOrder, salesOrderShipment, shipment, jobs] = await inOrder([
          () => single(db, "salesOrder", { companyId, id: salesOrderId }),
          () =>
            maybeSingle(db, "salesOrderShipment", {
              companyId,
              id: salesOrderId
            }),
          () =>
            maybeSingle(db, "shipment", { companyId, id: existingShipmentId! }),
          () =>
            many(db, "job", {
              companyId,
              salesOrderLineId,
              status: neq("Cancelled")
            })
        ]);

        if (!salesOrder.data) throw new NotFoundError("Sales order not found");

        const item = await single(
          db,
          "item",
          { companyId, id: salesOrderLine.data.itemId },
          { columns: ["id", "itemTrackingType"] }
        );

        if (!item.data) throw new NotFoundError("Item not found");

        const isSerial = item.data.itemTrackingType === "Serial";
        const isBatch = item.data.itemTrackingType === "Batch";

        // A supplied id that is not this company's shipment is a 404, not a
        // silent create-new.
        if (existingShipmentId && !shipment.data)
          throw new NotFoundError("Shipment not found");
        const hasShipment = !!shipment.data?.id;
        if (hasShipment && shipment.data!.status !== "Draft")
          throw new Error(
            `Cannot re-source a ${shipment.data!.status} shipment`
          );
        const previouslyShippedQuantity = salesOrderLine.data.quantitySent ?? 0;

        let shipmentId = hasShipment ? shipment.data?.id! : "";
        let shipmentIdReadable = hasShipment ? shipment.data?.shipmentId! : "";

        await db.transaction().execute(async (trx) => {
          if (hasShipment) {
            // update existing shipment
            await trx
              .updateTable("shipment")
              .set({
                sourceDocument: "Sales Order",
                sourceDocumentId: salesOrder.data.id,
                sourceDocumentReadableId: salesOrder.data.salesOrderId,
                locationId: locationId,
                updatedBy: userId
              })
              .where("id", "=", shipmentId)
              .returning(["id", "shipmentId"])
              .where("companyId", "=", companyId)
              .execute();
            // delete existing shipment lines
            await trx
              .deleteFrom("shipmentLine")
              .where("shipmentId", "=", shipmentId)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            shipmentIdReadable = await getNextSequence(
              trx,
              "shipment",
              companyId
            );

            const newShipment = await trx
              .insertInto("shipment")
              .values({
                shipmentId: shipmentIdReadable,
                sourceDocument: "Sales Order",
                sourceDocumentId: salesOrder.data.id,
                sourceDocumentReadableId: salesOrder.data.salesOrderId,
                externalDocumentId: salesOrder.data.customerReference,
                shippingMethodId: salesOrderShipment.data?.shippingMethodId,
                customerId: salesOrder.data.customerId,
                opportunityId: salesOrder.data.opportunityId,
                companyId: companyId,
                locationId: locationId,
                createdBy: userId
              })
              .returning(["id", "shipmentId"])
              .execute();

            shipmentId = newShipment?.[0]?.id!;
            shipmentIdReadable = newShipment?.[0]?.shipmentId!;
          }

          if (salesOrderLine.data.methodType === "Make to Order") {
            for await (const job of jobs.data ?? []) {
              if (!salesOrderLine.data.itemId) return;
              const quantityToShip = Math.max(
                0,
                (job.quantityComplete ?? 0) - (job.quantityShipped ?? 0)
              );

              if (!isSerial || (isSerial && quantityToShip > 0)) {
                const fulfillment = await trx
                  .insertInto("fulfillment")
                  .values({
                    salesOrderLineId: salesOrderLineId,
                    type: "Job",
                    jobId: job.id,
                    quantity: quantityToShip,
                    companyId: companyId,
                    createdBy: userId
                  })
                  .returning(["id"])
                  .execute();

                const fulfillmentId = fulfillment?.[0]?.id;

                const shippingAndTaxUnitCost =
                  (salesOrderLine.data.shippingCost / quantityToShip +
                    (salesOrderLine.data.unitPrice ?? 0)) *
                  (1 + salesOrderLine.data.taxPercent);

                const shipmentLine = await trx
                  .insertInto("shipmentLine")
                  .values({
                    shipmentId: shipmentId,
                    lineId: salesOrderLineId,
                    companyId: companyId,
                    fulfillmentId,
                    itemId: salesOrderLine.data.itemId,
                    orderQuantity: job.productionQuantity ?? 0,
                    outstandingQuantity: Math.max(
                      0,
                      job.productionQuantity ?? 0
                    ),
                    shippedQuantity: quantityToShip,
                    requiresSerialTracking: isSerial,
                    requiresBatchTracking: isBatch,
                    unitPrice: shippingAndTaxUnitCost,
                    unitOfMeasure:
                      salesOrderLine.data.unitOfMeasureCode ?? "EA",
                    createdBy: userId ?? ""
                  })
                  .returning(["id"])
                  .execute();

                const shipmentLineId = shipmentLine?.[0]?.id;

                if (!shipmentLineId)
                  throw new NotFoundError("Shipment line not found");

                if (isSerial || isBatch) {
                  const jobMakeMethod = await trx
                    .selectFrom("jobMakeMethod")
                    .select(["id"])
                    .where("jobId", "=", job.id)
                    .where("parentMaterialId", "is", null)
                    .executeTakeFirst();

                  if (jobMakeMethod?.id) {
                    const trackedEntities = await many(
                      trx,
                      "trackedEntity",
                      {
                        companyId,
                        attributes: contains({
                          "Job Make Method": jobMakeMethod.id
                        })
                      },
                      { orderBy: ["createdAt", "readableId", "id"] }
                    );

                    let index = 0;
                    for await (const trackedEntity of trackedEntities?.data ??
                      []) {
                      await trx
                        .updateTable("trackedEntity")
                        .set({
                          attributes: {
                            ...(trackedEntity.attributes as Record<
                              string,
                              unknown
                            >),
                            Shipment: shipmentId,
                            "Shipment Line": shipmentLineId,
                            "Shipment Line Index": index
                          }
                        })
                        .where("id", "=", trackedEntity.id)
                        .where("companyId", "=", companyId)
                        .execute();
                      index++;
                    }
                  }
                }
              }
            }
          } else {
            const outstandingQuantity = Math.max(
              0,
              (salesOrderLine.data.saleQuantity ?? 0) -
                previouslyShippedQuantity
            );

            const shippingAndTaxUnitCost =
              (salesOrderLine.data.shippingCost /
                (salesOrderLine.data.saleQuantity ?? 0) +
                (salesOrderLine.data.unitPrice ?? 0)) *
              (1 + salesOrderLine.data.taxPercent);

            await trx
              .insertInto("shipmentLine")
              .values({
                shipmentId: shipmentId,
                lineId: salesOrderLineId,
                companyId: companyId,
                itemId: salesOrderLine.data.itemId!,
                orderQuantity: salesOrderLine.data.saleQuantity ?? 0,
                outstandingQuantity: outstandingQuantity,
                shippedQuantity: outstandingQuantity,
                requiresSerialTracking: isSerial,
                requiresBatchTracking: isBatch,
                unitPrice: shippingAndTaxUnitCost,
                unitOfMeasure: salesOrderLine.data.unitOfMeasureCode ?? "EA",
                locationId: salesOrderLine.data.locationId!,
                storageUnitId: salesOrderLine.data.storageUnitId!,
                createdBy: userId ?? ""
              })
              .execute();
          }
        });

        return { id: shipmentId };
      }
      case "shipmentLineSplit": {
        const { shipmentId, shipmentLineId, quantity, locationId } = payload;

        logger.info({
          type,
          locationId,
          shipmentId,
          shipmentLineId,
          quantity,
          userId
        });

        const [shipmentLine] = await inOrder([
          () => single(db, "shipmentLine", { companyId, id: shipmentLineId })
        ]);

        if (!shipmentLine.data)
          throw new NotFoundError("Shipment line not found");

        await db.transaction().execute(async (trx) => {
          const { id: _id, ...data } = shipmentLine.data;

          await trx
            .insertInto("shipmentLine")
            .values({
              ...data,
              orderQuantity: quantity,
              outstandingQuantity: quantity,
              shippedQuantity: quantity,
              createdBy: userId
            })
            .execute();

          await trx
            .updateTable("shipmentLine")
            .set({
              orderQuantity: shipmentLine.data.orderQuantity - quantity,
              outstandingQuantity:
                shipmentLine.data.outstandingQuantity - quantity,
              shippedQuantity: shipmentLine.data.shippedQuantity - quantity,
              updatedBy: userId
            })
            .where("id", "=", shipmentLineId)
            .where("companyId", "=", companyId)
            .execute();
        });

        return { id: shipmentLineId };
      }
      case "shipmentFromRentalAgreement": {
        // A rental delivery: one Draft shipment per agreement holds the
        // Pending units. A per-unit shortcut adds (or ticks) its unit on it.
        const { rentalAgreementId, rentalAgreementLineId } = payload;

        logger.info({
          function: "create",
          type,
          companyId,
          rentalAgreementId,
          rentalAgreementLineId,
          userId
        });

        return db.transaction().execute(async (trx) => {
          const agreement = await trx
            .selectFrom("rentalAgreement")
            .select([
              "id",
              "rentalAgreementId",
              "status",
              "customerId",
              "locationId"
            ])
            .where("id", "=", rentalAgreementId)
            .where("companyId", "=", companyId)
            .forUpdate()
            .executeTakeFirst();
          if (!agreement) throw new NotFoundError("Rental agreement not found");
          if (agreement.status !== "Active") {
            throw new InvalidInputError(
              `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are delivered from an Active agreement`
            );
          }

          const draft = await trx
            .selectFrom("shipment")
            .select("id")
            .where("sourceDocument", "=", "Rental Agreement")
            .where("sourceDocumentId", "=", agreement.id)
            .where("status", "=", "Draft")
            .where("companyId", "=", companyId)
            .forUpdate()
            .executeTakeFirst();

          const onOpenShipments = await trx
            .selectFrom("shipmentFixedAssetLine as sfl")
            .innerJoin("shipment as s", (join) =>
              join
                .onRef("s.id", "=", "sfl.shipmentId")
                .onRef("s.companyId", "=", "sfl.companyId")
            )
            .select([
              "sfl.id",
              "sfl.shipmentId",
              "sfl.rentalAgreementLineId",
              "sfl.shipped"
            ])
            .where("s.sourceDocument", "=", "Rental Agreement")
            .where("s.sourceDocumentId", "=", agreement.id)
            .where("s.status", "in", ["Draft", "Pending"])
            .where("sfl.companyId", "=", companyId)
            .execute();

          let candidatesQuery = trx
            .selectFrom("rentalAgreementLine")
            .select(["id", "status"])
            .where("rentalAgreementId", "=", agreement.id)
            .where("companyId", "=", companyId)
            .where("status", "=", "Pending");
          if (rentalAgreementLineId) {
            candidatesQuery = candidatesQuery.where(
              "id",
              "=",
              rentalAgreementLineId
            );
          }
          const candidates = await candidatesQuery.orderBy("id").execute();
          if (rentalAgreementLineId && candidates.length === 0) {
            throw new InvalidInputError("Only a Pending unit can be delivered");
          }

          if (draft) {
            if (!rentalAgreementLineId) return { id: draft.id };
            const onDocument = onOpenShipments.find(
              (row) => row.rentalAgreementLineId === rentalAgreementLineId
            );
            if (onDocument && onDocument.shipmentId !== draft.id) {
              throw new InvalidInputError(
                "The unit is already on an open shipment"
              );
            }
            if (onDocument) {
              if (!onDocument.shipped) {
                await trx
                  .updateTable("shipmentFixedAssetLine")
                  .set({ shipped: true, updatedBy: userId })
                  .where("id", "=", onDocument.id)
                  .where("companyId", "=", companyId)
                  .execute();
              }
              return { id: draft.id };
            }
            await trx
              .insertInto("shipmentFixedAssetLine")
              .values({
                shipmentId: draft.id,
                rentalAgreementLineId,
                shipped: true,
                companyId,
                createdBy: userId
              })
              .execute();
            return { id: draft.id };
          }

          const onOpenDocument = new Set(
            onOpenShipments.map((row) => row.rentalAgreementLineId)
          );
          const units = candidates.filter(
            (line) => !onOpenDocument.has(line.id)
          );
          if (units.length === 0) {
            throw new InvalidInputError("No units to deliver");
          }

          const header = await trx
            .insertInto("shipment")
            .values({
              shipmentId: await getNextSequence(trx, "shipment", companyId),
              sourceDocument: "Rental Agreement",
              sourceDocumentId: agreement.id,
              sourceDocumentReadableId: agreement.rentalAgreementId,
              customerId: agreement.customerId,
              locationId: agreement.locationId,
              status: "Draft",
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("shipmentFixedAssetLine")
            .values(
              units.map((line) => ({
                shipmentId: header.id,
                rentalAgreementLineId: line.id,
                shipped: true,
                companyId,
                createdBy: userId
              }))
            )
            .execute();
          return { id: header.id };
        });
      }
      case "receiptFromRentalAgreement": {
        // A rental return: one Draft receipt per agreement holds the units
        // that can come back — On Rent ticked, Pending unticked (spec Q8). A
        // per-unit shortcut adds (or ticks) its unit on it.
        const { rentalAgreementId, rentalAgreementLineId } = payload;

        logger.info({
          function: "create",
          type,
          companyId,
          rentalAgreementId,
          rentalAgreementLineId,
          userId
        });

        return db.transaction().execute(async (trx) => {
          const agreement = await trx
            .selectFrom("rentalAgreement")
            .select([
              "id",
              "rentalAgreementId",
              "status",
              "customerId",
              "locationId"
            ])
            .where("id", "=", rentalAgreementId)
            .where("companyId", "=", companyId)
            .forUpdate()
            .executeTakeFirst();
          if (!agreement) throw new NotFoundError("Rental agreement not found");
          if (agreement.status !== "Active") {
            throw new InvalidInputError(
              `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are returned from an Active agreement`
            );
          }

          const draft = await trx
            .selectFrom("receipt")
            .select("id")
            .where("sourceDocument", "=", "Rental Agreement")
            .where("sourceDocumentId", "=", agreement.id)
            .where("status", "=", "Draft")
            .where("companyId", "=", companyId)
            .forUpdate()
            .executeTakeFirst();

          // Only another open RECEIPT keeps a unit off this one: a Pending
          // unit may sit on an open shipment too, and the first to post wins.
          const onOpenReceipts = await trx
            .selectFrom("receiptFixedAssetLine as rfl")
            .innerJoin("receipt as r", (join) =>
              join
                .onRef("r.id", "=", "rfl.receiptId")
                .onRef("r.companyId", "=", "rfl.companyId")
            )
            .select([
              "rfl.id",
              "rfl.receiptId",
              "rfl.rentalAgreementLineId",
              "rfl.received"
            ])
            .where("r.sourceDocument", "=", "Rental Agreement")
            .where("r.sourceDocumentId", "=", agreement.id)
            .where("r.status", "in", ["Draft", "Pending"])
            .where("rfl.companyId", "=", companyId)
            .execute();

          let candidatesQuery = trx
            .selectFrom("rentalAgreementLine")
            .select(["id", "status"])
            .where("rentalAgreementId", "=", agreement.id)
            .where("companyId", "=", companyId)
            .where("status", "in", ["Pending", "On Rent"]);
          if (rentalAgreementLineId) {
            candidatesQuery = candidatesQuery.where(
              "id",
              "=",
              rentalAgreementLineId
            );
          }
          const candidates = await candidatesQuery.orderBy("id").execute();
          if (rentalAgreementLineId && candidates.length === 0) {
            throw new InvalidInputError(
              "Only a Pending or On Rent unit can be returned"
            );
          }

          if (draft) {
            if (!rentalAgreementLineId) return { id: draft.id };
            const onDocument = onOpenReceipts.find(
              (row) => row.rentalAgreementLineId === rentalAgreementLineId
            );
            if (onDocument && onDocument.receiptId !== draft.id) {
              throw new InvalidInputError(
                "The unit is already on an open receipt"
              );
            }
            if (onDocument) {
              if (!onDocument.received) {
                await trx
                  .updateTable("receiptFixedAssetLine")
                  .set({ received: true, updatedBy: userId })
                  .where("id", "=", onDocument.id)
                  .where("companyId", "=", companyId)
                  .execute();
              }
              return { id: draft.id };
            }
            await trx
              .insertInto("receiptFixedAssetLine")
              .values({
                receiptId: draft.id,
                rentalAgreementLineId,
                received: true,
                companyId,
                createdBy: userId
              })
              .execute();
            return { id: draft.id };
          }

          const onOpenDocument = new Set(
            onOpenReceipts.map((row) => row.rentalAgreementLineId)
          );
          const units = candidates.filter(
            (line) => !onOpenDocument.has(line.id)
          );
          if (units.length === 0) {
            throw new InvalidInputError("No units to return");
          }

          const header = await trx
            .insertInto("receipt")
            .values({
              receiptId: await getNextSequence(trx, "receipt", companyId),
              sourceDocument: "Rental Agreement",
              sourceDocumentId: agreement.id,
              sourceDocumentReadableId: agreement.rentalAgreementId,
              locationId: agreement.locationId,
              status: "Draft",
              companyId,
              createdBy: userId
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("receiptFixedAssetLine")
            .values(
              units.map((line) => ({
                receiptId: header.id,
                rentalAgreementLineId: line.id,
                // The shortcut names its unit, so it comes back ticked; a
                // whole-agreement receipt ticks only what is out on rent.
                received: rentalAgreementLineId
                  ? true
                  : line.status === "On Rent",
                companyId,
                createdBy: userId
              }))
            )
            .execute();
          return { id: header.id };
        });
      }
      case "journalEntry": {
        let createdDocumentId;
        const id = await db.transaction().execute(async (trx) => {
          const journalEntryId = await getNextSequence(
            trx,
            "journalEntry",
            companyId
          );

          const newJournalEntry = await trx
            .insertInto("journal")
            .values({
              journalEntryId,
              postingDate: datetime
                .today(await getCompanyTimeZone(trx, companyId))
                .toString(),
              companyId,
              sourceType: "Manual",
              status: "Draft",
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          createdDocumentId = newJournalEntry?.[0]?.id;
          if (!createdDocumentId)
            throw new Error("Failed to create journal entry");
          return createdDocumentId;
        });

        return { id };
      }
      default:
        throw new InvalidInputError("Invalid document type");
    }
  }
}) as Create;

export type ReceiptLineItem = Omit<
  Database["public"]["Tables"]["receiptLine"]["Insert"],
  "id" | "receiptId" | "updatedBy" | "createdAt" | "updatedAt"
>;

export type ShipmentLineItem = Omit<
  Database["public"]["Tables"]["shipmentLine"]["Insert"],
  "id" | "shipmentId" | "updatedBy" | "createdAt" | "updatedAt"
>;

export default create;
