import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import z from "npm:zod@^3.24.1";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("nonConformanceTasks"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("purchaseOrderFromJob"),
    jobId: z.string(),
    purchaseOrdersBySupplierId: z.record(z.string(), z.string()),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("receiptDefault"),
    locationId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("receiptFromPurchaseOrder"),
    locationId: z.string().optional(),
    purchaseOrderId: z.string(),
    receiptId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("receiptFromInboundTransfer"),
    warehouseTransferId: z.string(),
    receiptId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("receiptFromWarehouseTransfer"),
    warehouseTransferId: z.string(),
    receiptId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("receiptLineSplit"),
    quantity: z.number(),
    locationId: z.string(),
    receiptId: z.string(),
    receiptLineId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentDefault"),
    locationId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentFromPurchaseOrder"),
    locationId: z.string(),
    purchaseOrderId: z.string(),
    shipmentId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentFromWarehouseTransfer"),
    warehouseTransferId: z.string(),
    shipmentId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentFromSalesOrder"),
    locationId: z.string(),
    salesOrderId: z.string(),
    shipmentId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentFromSalesOrderLine"),
    locationId: z.string(),
    salesOrderLineId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentLineSplit"),
    quantity: z.number(),
    locationId: z.string(),
    shipmentId: z.string(),
    shipmentLineId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
]);
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  const { type, companyId, userId } = payloadValidator.parse(payload);
  switch (type) {
    case "nonConformanceTasks": {
      const { id } = payload;

      console.log({
        function: "create",
        type,
        id,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [
          nonConformance,
          investigationTasks,
          actionTasks,
          approvalTasks,
          existingReviewers,
        ] = await Promise.all([
          client.from("nonConformance").select("*").eq("id", id).single(),
          client
            .from("nonConformanceInvestigationTask")
            .select("*")
            .eq("nonConformanceId", id),
          client
            .from("nonConformanceActionTask")
            .select("*")
            .eq("nonConformanceId", id),
          client
            .from("nonConformanceApprovalTask")
            .select("*")
            .eq("nonConformanceId", id),
          client
            .from("nonConformanceReviewer")
            .select("*")
            .eq("nonConformanceId", id),
        ]);

        if (nonConformance.error) throw new Error(nonConformance.error.message);

        const workflow = nonConformance.data?.nonConformanceWorkflowId
          ? await client
              .from("nonConformanceWorkflow")
              .select("*")
              .eq("id", nonConformance.data?.nonConformanceWorkflowId)
              .maybeSingle()
          : null;

        if (workflow?.error) throw new Error(workflow.error.message);

        const currentInvestigationTasks =
          investigationTasks.data?.reduce<Record<string, string>>((acc, d) => {
            if (d.investigationTypeId && !acc[d.investigationTypeId]) {
              acc[d.investigationTypeId] = d.id;
            }
            return acc;
          }, {}) ?? {};

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

        const investigationTasksToDelete: string[] = [];
        const actionTasksToDelete: string[] = [];
        const approvalTasksToDelete: string[] = [];
        const reviewersToDelete: string[] = [];

        Object.keys(currentInvestigationTasks).forEach(
          (investigationTypeId) => {
            if (
              !(nonConformance.data?.investigationTypeIds ?? []).some(
                (d) => d === investigationTypeId
              )
            ) {
              investigationTasksToDelete.push(
                currentInvestigationTasks[investigationTypeId]
              );
            }
          }
        );

        Object.keys(currentActionTasks).forEach((actionTypeId) => {
          if (
            !(nonConformance.data?.requiredActionIds ?? []).some(
              (d) => d === actionTypeId
            )
          ) {
            actionTasksToDelete.push(currentActionTasks[actionTypeId]);
          }
        });

        Object.keys(currentApprovalTasks).forEach((approvalType) => {
          if (
            !(nonConformance.data?.approvalRequirements ?? []).some(
              (d) => d === approvalType
            )
          ) {
            approvalTasksToDelete.push(currentApprovalTasks[approvalType]);
          }
        });

        const investigationTaskInserts: Database["public"]["Tables"]["nonConformanceInvestigationTask"]["Insert"][] =
          [];
        const actionTaskInserts: Database["public"]["Tables"]["nonConformanceActionTask"]["Insert"][] =
          [];
        const approvalTaskInserts: Database["public"]["Tables"]["nonConformanceApprovalTask"]["Insert"][] =
          [];

        const reviewerInserts: Database["public"]["Tables"]["nonConformanceReviewer"]["Insert"][] =
          [];

        nonConformance.data?.investigationTypeIds?.forEach(
          (investigationTypeId) => {
            if (!currentInvestigationTasks[investigationTypeId]) {
              investigationTaskInserts.push({
                nonConformanceId: id,
                investigationTypeId,
                companyId,
                createdBy: userId,
              });
            }
          }
        );

        nonConformance.data?.requiredActionIds?.forEach((actionTypeId) => {
          if (!currentActionTasks[actionTypeId]) {
            actionTaskInserts.push({
              nonConformanceId: id,
              actionTypeId,
              companyId,
              createdBy: userId,
            });
          }
        });

        nonConformance.data?.approvalRequirements?.forEach((approvalType) => {
          if (!currentApprovalTasks[approvalType]) {
            approvalTaskInserts.push({
              nonConformanceId: id,
              approvalType,
              companyId,
              createdBy: userId,
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
            createdBy: userId,
          });

          reviewerInserts.push({
            nonConformanceId: id,
            title: "Quality",
            companyId,
            createdBy: userId,
          });
        }

        await db.transaction().execute(async (trx) => {
          if (
            typeof nonConformance.data?.content === "object" &&
            // @ts-ignore -- content is json
            Object.keys(nonConformance.data?.content ?? {}).length === 0
          ) {
            // @ts-ignore -- content is json
            const contentFromWorkflow = workflow?.data?.content?.content ?? [];
            const insertedContent = {
              type: "doc",
              content: contentFromWorkflow,
            };

            if (nonConformance.data?.description) {
              insertedContent.content.unshift({
                type: "paragraph",
                content: [
                  { type: "text", text: nonConformance.data?.description },
                ],
              });
            }

            console.log({
              description: nonConformance.data?.description,
              insertedContent,
            });

            if (insertedContent.content.length > 0) {
              await trx
                .updateTable("nonConformance")
                .set({
                  content: JSON.stringify(insertedContent),
                })
                .where("id", "=", id)
                .execute();
            }
          }

          if (investigationTaskInserts.length > 0) {
            await trx
              .insertInto("nonConformanceInvestigationTask")
              .values(investigationTaskInserts)
              .execute();
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

          if (investigationTasksToDelete.length > 0) {
            await trx
              .deleteFrom("nonConformanceInvestigationTask")
              .where("id", "=", investigationTasksToDelete)
              .execute();
          }
          if (actionTasksToDelete.length > 0) {
            await trx
              .deleteFrom("nonConformanceActionTask")
              .where("id", "=", actionTasksToDelete)
              .execute();
          }
          if (approvalTasksToDelete.length > 0) {
            await trx
              .deleteFrom("nonConformanceApprovalTask")
              .where("id", "=", approvalTasksToDelete)
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
              .execute();
          }
        });
      } catch (error) {
        console.error(error);
        return new Response(error.message, {
          status: 500,
          headers: corsHeaders,
        });
      }
      return new Response(
        JSON.stringify({
          success: true,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    case "purchaseOrderFromJob": {
      const { jobId, purchaseOrdersBySupplierId } = payload;

      console.log({
        function: "create",
        type,
        jobId,
        companyId,
        userId,
      });
      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [job, jobOperations] = await Promise.all([
          client.from("job").select("*").eq("id", jobId).single(),
          client
            .from("jobOperation")
            .select("*, jobMakeMethod(itemId)")
            .eq("jobId", jobId),
        ]);

        if (jobOperations.error) throw new Error(jobOperations.error.message);

        const outsideOperations = jobOperations.data?.filter(
          (d) => d.operationType === "Outside"
        );

        if (outsideOperations.length > 0) {
          const supplierProcessIds = new Set(
            outsideOperations
              .map((d) => d.operationSupplierProcessId)
              .filter(Boolean)
          );
          const [supplierProcesses, existingPurchaseOrderLines] =
            await Promise.all([
              client
                .from("supplierProcess")
                .select("*")
                .in("id", Array.from(supplierProcessIds)),
              client
                .from("purchaseOrderLine")
                .select("*")
                .eq("jobId", jobId)
                .eq(
                  "jobOperationId",
                  outsideOperations.map((d) => d.id)
                ),
            ]);

          if (supplierProcesses.error)
            throw new Error(supplierProcesses.error.message);

          const outsideOperationsBySupplierId = outsideOperations.reduce<
            Record<
              string,
              (Database["public"]["Tables"]["jobOperation"]["Row"] & {
                jobMakeMethod: { itemId: string } | null;
              })[]
            >
          >((acc, oo) => {
            const supplierProcess = supplierProcesses.data?.find(
              (d) => d.id === oo.operationSupplierProcessId
            );
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
            acc[supplierProcess.supplierId].push(oo);
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
            await Promise.all([
              client
                .from("supplier")
                .select("*")
                .in("id", Array.from(supplierIds)),
              client
                .from("supplierPayment")
                .select("*")
                .in("supplierId", Array.from(supplierIds)),
              client
                .from("supplierShipping")
                .select("*")
                .in("supplierId", Array.from(supplierIds)),
              client.from("item").select("*").in("id", Array.from(itemIds)),
            ]);

          if (suppliers.error) throw new Error(suppliers.error.message);
          if (supplierPayments.error)
            throw new Error(supplierPayments.error.message);
          if (supplierShipping.error)
            throw new Error(supplierShipping.error.message);

          const currencyCodes = new Set(
            suppliers.data
              ?.map((d) => d.currencyCode)
              .filter(Boolean) as string[]
          );

          const exchangeRates = await Promise.all(
            Array.from(currencyCodes).map(async (currencyCode) => {
              const exchangeRate = await client
                .from("currency")
                .select("*")
                .eq("code", currencyCode)
                .eq("companyId", companyId)
                .single();
              return {
                currencyCode,
                exchangeRate: exchangeRate.data?.exchangeRate ?? 1,
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

              let purchaseOrderId =
                purchaseOrdersBySupplierId[supplier] === "new"
                  ? undefined
                  : purchaseOrdersBySupplierId[supplier];

              if (!purchaseOrderId) {
                const supplierInteraction = await trx
                  .insertInto("supplierInteraction")
                  .values({
                    companyId,
                    supplierId: supplier,
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
                    currencyCode:
                      suppliers.data?.find((d) => d.id === supplier)
                        ?.currencyCode ?? "USD",
                    exchangeRate:
                      exchangeRates.find(
                        (d) =>
                          d.currencyCode ===
                          suppliers.data?.find((d) => d.id === supplier)
                            ?.currencyCode
                      )?.exchangeRate ?? 1,
                    exchangeRateUpdatedAt: new Date().toISOString(),
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
                      companyId,
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
                      companyId,
                    })
                    .execute(),
                ]);
              }

              const purchaseOrderLineInserts: Database["public"]["Tables"]["purchaseOrderLine"]["Insert"][] =
                [];

              // Create purchase order lines for each process
              for await (const operation of outsideOperations) {
                // Get the item associated with the operation
                const item = items.data?.find(
                  (d) => d.id === operation.jobMakeMethod?.itemId
                );
                const supplierProcess = supplierProcesses.data?.find(
                  (d) => d.id === operation.operationSupplierProcessId
                );

                if (item && supplierProcess) {
                  const totalCostWithUnitPrice =
                    (operation.operationUnitCost ?? 0) *
                    (operation.operationQuantity ?? 0);
                  const totalCostWithMinimumCost =
                    (operation.operationMinimumCost ?? 0) >
                    totalCostWithUnitPrice
                      ? operation.operationMinimumCost ?? 0
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
                    exchangeRate:
                      exchangeRates.find(
                        (d) =>
                          d.currencyCode ===
                          suppliers.data?.find((d) => d.id === supplier)
                            ?.currencyCode
                      )?.exchangeRate ?? 1,
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
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }
    case "receiptDefault": {
      const { locationId } = payload;
      let createdDocumentId;
      console.log({
        function: "create",
        type,
        locationId,
        companyId,
        userId,
      });
      try {
        await db.transaction().execute(async (trx) => {
          createdDocumentId = await getNextSequence(trx, "receipt", companyId);
          const newReceipt = await trx
            .insertInto("receipt")
            .values({
              receiptId: createdDocumentId,
              companyId: companyId,
              locationId: locationId,
              createdBy: userId,
            })
            .returning(["id", "receiptId"])
            .execute();

          createdDocumentId = newReceipt?.[0]?.id;
          if (!createdDocumentId) throw new Error("Failed to create receipt");
        });

        return new Response(
          JSON.stringify({
            id: createdDocumentId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "receiptFromPurchaseOrder": {
      const {
        purchaseOrderId,
        receiptId: existingReceiptId,
        locationId: userLocationId,
      } = payload;

      console.log({
        function: "create",
        type,
        companyId,
        purchaseOrderId,
        existingReceiptId,
        userLocationId,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [purchaseOrder, purchaseOrderLines, receipt] = await Promise.all([
          client
            .from("purchaseOrders")
            .select("*")
            .eq("id", purchaseOrderId)
            .single(),
          client
            .from("purchaseOrderLine")
            .select("*")
            .eq("purchaseOrderId", purchaseOrderId)
            .in("purchaseOrderLineType", [
              "Part",
              "Material",
              "Tool",
              "Fixture",
              "Consumable",
            ]),

          client
            .from("receipt")
            .select("*")
            .eq("id", existingReceiptId)
            .maybeSingle(),
        ]);

        if (!purchaseOrder.data) throw new Error("Purchase order not found");
        if (purchaseOrderLines.error)
          throw new Error(purchaseOrderLines.error.message);

        let locationId = purchaseOrder.data.locationId;
        if (
          purchaseOrderLines.data.some(
            (d) =>
              d.locationId !== locationId && d.locationId === userLocationId
          )
        ) {
          locationId = userLocationId;
        }

        const items = await client
          .from("item")
          .select("id, itemTrackingType")
          .in(
            "id",
            purchaseOrderLines.data
              .filter((d) => d.locationId === locationId)
              .map((d) => d.itemId)
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
            d.unitPrice === null ||
            d.purchaseOrderLineType === "Service" ||
            isNaN(d.unitPrice)
          ) {
            return acc;
          }

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
              d.unitPrice / (d.conversionFactor ?? 1) + shippingAndTaxUnitCost,
            unitOfMeasure: d.inventoryUnitOfMeasureCode ?? "EA",
            locationId: d.locationId,
            shelfId: d.shelfId,
            createdBy: userId ?? "",
          });

          return acc;
        }, []);

        if (receiptLineItems.length === 0) {
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
                updatedBy: userId,
              })
              .where("id", "=", receiptId)
              .returning(["id", "receiptId"])
              .execute();
            // delete existing receipt lines
            await trx
              .deleteFrom("receiptLine")
              .where("receiptId", "=", receiptId)
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
                createdBy: userId,
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
                  locationId,
                }))
              )
              .execute();
          }
        });

        return new Response(
          JSON.stringify({
            id: receiptId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "receiptFromInboundTransfer": {
      const { warehouseTransferId, receiptId: existingReceiptId } = payload;

      console.log({
        function: "create",
        type,
        companyId,
        warehouseTransferId,
        existingReceiptId,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [warehouseTransfer, warehouseTransferLines, receipt] =
          await Promise.all([
            client
              .from("warehouseTransfer")
              .select("*")
              .eq("id", warehouseTransferId)
              .single(),
            client
              .from("warehouseTransferLine")
              .select("*")
              .eq("transferId", warehouseTransferId),
            client
              .from("receipt")
              .select("*")
              .eq("id", existingReceiptId)
              .maybeSingle(),
          ]);

        if (!warehouseTransfer.data)
          throw new Error("Warehouse transfer not found");
        if (warehouseTransferLines.error)
          throw new Error(warehouseTransferLines.error.message);

        const locationId = warehouseTransfer.data.toLocationId;

        const items = await client
          .from("item")
          .select("id, itemTrackingType")
          .in(
            "id",
            warehouseTransferLines.data
              .map((d) => d.itemId)
              .filter(Boolean) as string[]
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
            shelfId: d.toShelfId,
            requiresSerialTracking: serialTracking,
            requiresBatchTracking: batchTracking,
            receivedQuantity: quantityToReceive,
            outstandingQuantity: quantityToReceive,
            unitPrice: 0, // Transfers don't have a unit price
            conversionFactor: 1,
            unitOfMeasure: d.unitOfMeasureCode ?? "EA",
            companyId,
            createdBy: userId,
            orderQuantity: d.quantity ?? 0,
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
                updatedBy: userId,
              })
              .where("id", "=", id)
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
                createdBy: userId,
              })
              .returning(["id"])
              .execute();

            id = insertReceipt[0]?.id ?? "";
          }

          await trx
            .deleteFrom("receiptLine")
            .where("receiptId", "=", id)
            .execute();

          await trx
            .insertInto("receiptLine")
            .values(
              receiptLineItems.map((lineItem) => ({
                ...lineItem,
                receiptId: id,
              }))
            )
            .execute();

          return { id };
        });

        return new Response(JSON.stringify(result, null, 2), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 201,
        });
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "receiptFromWarehouseTransfer": {
      const { warehouseTransferId, receiptId: existingReceiptId } = payload;

      console.log({
        function: "create",
        type,
        companyId,
        warehouseTransferId,
        existingReceiptId,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [warehouseTransfer, warehouseTransferLines, receipt] =
          await Promise.all([
            client
              .from("warehouseTransfer")
              .select("*")
              .eq("id", warehouseTransferId)
              .single(),
            client
              .from("warehouseTransferLine")
              .select("*")
              .eq("transferId", warehouseTransferId),
            client
              .from("receipt")
              .select("*")
              .eq("id", existingReceiptId)
              .maybeSingle(),
          ]);

        if (!warehouseTransfer.data)
          throw new Error("Warehouse transfer not found");
        if (warehouseTransferLines.error)
          throw new Error(warehouseTransferLines.error.message);

        const locationId = warehouseTransfer.data.toLocationId;

        const items = await client
          .from("item")
          .select("id, itemTrackingType")
          .in(
            "id",
            warehouseTransferLines.data
              .map((d) => d.itemId)
              .filter(Boolean) as string[]
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
            shelfId: d.toShelfId,
            requiresSerialTracking: serialTracking,
            requiresBatchTracking: batchTracking,
            receivedQuantity: quantityToReceive,
            outstandingQuantity: quantityToReceive,
            unitPrice: 0, // Transfers don't have a unit price
            conversionFactor: 1,
            unitOfMeasure: d.unitOfMeasureCode ?? "EA",
            companyId,
            createdBy: userId,
            orderQuantity: d.quantity ?? 0,
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
                updatedBy: userId,
              })
              .where("id", "=", id)
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
                createdBy: userId,
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
                shelfId: d.shelfId,
                requiresSerialTracking: d.requiresSerialTracking,
                requiresBatchTracking: d.requiresBatchTracking,
                receivedQuantity: d.receivedQuantity,
                outstandingQuantity: d.outstandingQuantity,
                unitPrice: d.unitPrice,
                conversionFactor: d.conversionFactor,
                unitOfMeasure: d.unitOfMeasure,
                orderQuantity: d.orderQuantity,
                companyId,
                createdBy: userId,
              }))
            )
            .execute();

          return { id };
        });

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "receiptLineSplit": {
      const { receiptId, receiptLineId, quantity, locationId } = payload;

      console.log({
        function: "create",
        type,
        locationId,
        receiptId,
        receiptLineId,
        quantity,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [receiptLine, trackedEntities] = await Promise.all([
          client
            .from("receiptLine")
            .select("*")
            .eq("id", receiptLineId)
            .single(),
          client
            .from("trackedEntity")
            .select("*")
            .eq("attributes->> Receipt Line", receiptLineId),
        ]);

        console.log({
          trackedEntities,
        });

        if (!receiptLine.data) throw new Error("Receipt line not found");

        await db.transaction().execute(async (trx) => {
          const { id, ...data } = receiptLine.data;

          if (
            receiptLine.data.requiresSerialTracking &&
            trackedEntities.data?.length
          ) {
            // TODO: update the Receipt Line and Index attributes to point to the new line
            await trx
              .deleteFrom("trackedEntity")
              .where("id", "in", trackedEntities.data?.map((d) => d.id) ?? [])
              .execute();
          }

          await trx
            .insertInto("receiptLine")
            .values({
              ...data,
              orderQuantity: quantity,
              outstandingQuantity: quantity,
              receivedQuantity: quantity,
              createdBy: userId,
            })
            .execute();

          await trx
            .updateTable("receiptLine")
            .set({
              orderQuantity: receiptLine.data.orderQuantity - quantity,
              outstandingQuantity:
                receiptLine.data.outstandingQuantity - quantity,
              receivedQuantity: receiptLine.data.receivedQuantity - quantity,
              updatedBy: userId,
            })
            .where("id", "=", receiptLineId)
            .execute();
        });

        return new Response(
          JSON.stringify({
            id: receiptLineId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "shipmentDefault": {
      let createdDocumentId;
      const { locationId } = payload;
      console.log({
        function: "create",
        type,
        companyId,
        locationId,
        userId,
      });
      try {
        await db.transaction().execute(async (trx) => {
          createdDocumentId = await getNextSequence(trx, "shipment", companyId);

          const newShipment = await trx
            .insertInto("shipment")
            .values({
              shipmentId: createdDocumentId,
              companyId: companyId,
              locationId: locationId,
              createdBy: userId,
            })
            .returning(["id", "shipmentId"])
            .execute();

          createdDocumentId = newShipment?.[0]?.id;
          if (!createdDocumentId) throw new Error("Failed to create shipment");
        });

        return new Response(
          JSON.stringify({
            id: createdDocumentId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "shipmentFromWarehouseTransfer": {
      const { warehouseTransferId, shipmentId: existingShipmentId } = payload;

      console.log({
        function: "create",
        type,
        companyId,
        warehouseTransferId,
        existingShipmentId,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [warehouseTransfer, warehouseTransferLines, shipment] =
          await Promise.all([
            client
              .from("warehouseTransfer")
              .select("*")
              .eq("id", warehouseTransferId)
              .single(),
            client
              .from("warehouseTransferLine")
              .select("*")
              .eq("transferId", warehouseTransferId),
            client
              .from("shipment")
              .select("*")
              .eq("id", existingShipmentId)
              .maybeSingle(),
          ]);

        if (!warehouseTransfer.data)
          throw new Error("Warehouse transfer not found");
        if (warehouseTransferLines.error)
          throw new Error(warehouseTransferLines.error.message);

        const locationId = warehouseTransfer.data.toLocationId;

        const items = await client
          .from("item")
          .select("id, itemTrackingType")
          .in(
            "id",
            warehouseTransferLines.data
              .map((d) => d.itemId)
              .filter(Boolean) as string[]
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
            shelfId: d.fromShelfId,
            requiresSerialTracking: serialTracking,
            requiresBatchTracking: batchTracking,
            shippedQuantity: quantityToShip,
            outstandingQuantity: quantityToShip,
            unitPrice: 0, // Transfers don't have a unit price
            unitOfMeasure: d.unitOfMeasureCode ?? "EA",
            companyId,
            createdBy: userId,
            orderQuantity: d.quantity ?? 0,
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
                updatedBy: userId,
              })
              .where("id", "=", id)
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
                createdBy: userId,
              })
              .returning(["id"])
              .execute();

            id = insertShipment[0]?.id ?? "";
          }

          await trx
            .deleteFrom("shipmentLine")
            .where("shipmentId", "=", id)
            .execute();

          await trx
            .insertInto("shipmentLine")
            .values(
              shipmentLineItems.map((lineItem) => ({
                ...lineItem,
                shipmentId: id,
              }))
            )
            .execute();

          return { id };
        });

        return new Response(JSON.stringify(result, null, 2), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 201,
        });
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "shipmentFromPurchaseOrder": {
      const {
        purchaseOrderId,
        shipmentId: existingShipmentId,
        locationId,
      } = payload;

      console.log({
        function: "create",
        type,
        companyId,
        locationId,
        purchaseOrderId,
        existingShipmentId,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [
          purchaseOrder,
          purchaseOrderLines,
          purchaseOrderDelivery,
          shipment,
        ] = await Promise.all([
          client
            .from("purchaseOrder")
            .select("*")
            .eq("id", purchaseOrderId)
            .single(),
          client
            .from("purchaseOrderLine")
            .select("*")
            .eq("purchaseOrderId", purchaseOrderId)
            .in("purchaseOrderLineType", [
              "Part",
              "Material",
              "Tool",
              "Fixture",
              "Consumable",
            ])
            .eq("locationId", locationId),
          client
            .from("purchaseOrderDelivery")
            .select("*")
            .eq("id", purchaseOrderId)
            .maybeSingle(),
          client
            .from("shipment")
            .select("*")
            .eq("id", existingShipmentId)
            .maybeSingle(),
        ]);

        if (!purchaseOrder.data) throw new Error("Purchase order not found");
        if (purchaseOrderLines.error)
          throw new Error(purchaseOrderLines.error.message);

        const items = await client
          .from("item")
          .select("id, itemTrackingType")
          .in(
            "id",
            purchaseOrderLines.data.map((d) => d.itemId)
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
                updatedBy: userId,
              })
              .where("id", "=", shipmentId)
              .returning(["id", "shipmentId"])
              .execute();
            // delete existing shipment lines
            await trx
              .deleteFrom("shipmentLine")
              .where("shipmentId", "=", shipmentId)
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
                createdBy: userId,
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
              purchaseOrderLine.unitPrice === null ||
              purchaseOrderLine.purchaseOrderLineType === "Service" ||
              isNaN(purchaseOrderLine.unitPrice)
            ) {
              continue;
            }

            const isSerial = serializedItems.has(purchaseOrderLine.itemId);
            const isBatch = batchItems.has(purchaseOrderLine.itemId);

            const outstandingQuantity =
              (purchaseOrderLine.purchaseQuantity ?? 0) -
                previouslyShippedQuantitiesByLine[purchaseOrderLine.id] ?? 0;

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
                shelfId: purchaseOrderLine.shelfId,
                createdBy: userId ?? "",
              })
              .execute();
          }
        });

        return new Response(
          JSON.stringify({
            id: shipmentId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "shipmentFromSalesOrder": {
      const {
        salesOrderId,
        shipmentId: existingShipmentId,
        locationId,
      } = payload;

      console.log({
        function: "create",
        type,
        companyId,
        locationId,
        salesOrderId,
        existingShipmentId,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [
          salesOrder,
          salesOrderLines,
          salesOrderShipment,
          shipment,
          jobs,
        ] = await Promise.all([
          client.from("salesOrder").select("*").eq("id", salesOrderId).single(),
          client
            .from("salesOrderLine")
            .select("*")
            .eq("salesOrderId", salesOrderId)
            .in("salesOrderLineType", [
              "Part",
              "Material",
              "Tool",
              "Fixture",
              "Consumable",
            ])
            .eq("locationId", locationId),
          client
            .from("salesOrderShipment")
            .select("*")
            .eq("id", salesOrderId)
            .maybeSingle(),
          client
            .from("shipment")
            .select("*")
            .eq("id", existingShipmentId)
            .maybeSingle(),
          client
            .from("job")
            .select("*")
            .eq("salesOrderId", salesOrderId)
            .neq("status", "Cancelled"),
        ]);

        if (!salesOrder.data) throw new Error("Sales order not found");
        if (salesOrderLines.error)
          throw new Error(salesOrderLines.error.message);

        const items = await client
          .from("item")
          .select("id, itemTrackingType")
          .in(
            "id",
            salesOrderLines.data.map((d) => d.itemId)
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

        const hasShipment = !!shipment.data?.id;

        // Group jobs by sales order line ID
        const jobsBySalesOrderLine = (jobs.data || []).reduce<
          Record<string, Database["public"]["Tables"]["job"]["Row"][]>
        >((acc, job) => {
          if (job.salesOrderLineId) {
            if (!acc[job.salesOrderLineId]) {
              acc[job.salesOrderLineId] = [];
            }
            acc[job.salesOrderLineId].push(job);
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
                updatedBy: userId,
              })
              .where("id", "=", shipmentId)
              .returning(["id", "shipmentId"])
              .execute();
            // delete existing shipment lines
            await trx
              .deleteFrom("shipmentLine")
              .where("shipmentId", "=", shipmentId)
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
                createdBy: userId,
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
              salesOrderLine.unitPrice === null ||
              salesOrderLine.salesOrderLineType === "Service" ||
              isNaN(salesOrderLine.unitPrice)
            ) {
              continue;
            }

            const isSerial = serializedItems.has(salesOrderLine.itemId);
            const isBatch = batchItems.has(salesOrderLine.itemId);

            if (salesOrderLine.methodType === "Make") {
              for await (const job of jobsBySalesOrderLine[salesOrderLine.id] ??
                []) {
                if (!salesOrderLine.itemId) return;

                const quantityAvailable = isSerial
                  ? Math.min(job.quantityComplete - job.quantityShipped, 0)
                  : job.quantity - job.quantityShipped;

                if (!isSerial || (isSerial && quantityAvailable > 0)) {
                  const fulfillment = await trx
                    .insertInto("fulfillment")
                    .values({
                      salesOrderLineId: salesOrderLine.id,
                      type: "Job",
                      jobId: job.id,
                      quantity: quantityAvailable,
                      companyId: companyId,
                      createdBy: userId,
                    })
                    .returning(["id"])
                    .execute();

                  const fulfillmentId = fulfillment?.[0]?.id;

                  const shippingAndTaxUnitCost =
                    (salesOrderLine.shippingCost / quantityAvailable +
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
                      shippedQuantity: quantityAvailable,
                      requiresSerialTracking: isSerial,
                      requiresBatchTracking: isBatch,
                      unitPrice: shippingAndTaxUnitCost,
                      unitOfMeasure: salesOrderLine.unitOfMeasureCode ?? "EA",
                      createdBy: userId ?? "",
                    })
                    .returning(["id"])
                    .execute();

                  const shipmentLineId = shipmentLine?.[0]?.id;

                  if (!shipmentLineId)
                    throw new Error("Shipment line not found");

                  if (isSerial || isBatch) {
                    const jobMakeMethod = await trx
                      .selectFrom("jobMakeMethod")
                      .select(["id"])
                      .where("jobId", "=", job.id)
                      .where("parentMaterialId", "is", null)
                      .executeTakeFirst();

                    if (jobMakeMethod?.id) {
                      const trackedEntities = await client
                        .from("trackedEntity")
                        .select("*")
                        .eq("attributes->>Job Make Method", jobMakeMethod.id)
                        .order("createdAt", { ascending: true });

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
                              "Shipment Line Index": index,
                            },
                          })
                          .where("id", "=", trackedEntity.id)
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
                  previouslyShippedQuantitiesByLine[salesOrderLine.id] ?? 0;

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
                  shelfId: salesOrderLine.shelfId,
                  createdBy: userId ?? "",
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
                  locationId,
                }))
              )
              .execute();
          }
        });

        return new Response(
          JSON.stringify({
            id: shipmentId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "shipmentFromSalesOrderLine": {
      const {
        salesOrderLineId,
        shipmentId: existingShipmentId,
        locationId,
      } = payload;

      console.log({
        function: "create",
        type,
        companyId,
        locationId,
        salesOrderLineId,
        existingShipmentId,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const salesOrderLine = await client
          .from("salesOrderLine")
          .select("*")
          .eq("id", salesOrderLineId)
          .eq("locationId", locationId)
          .single();

        if (!salesOrderLine.data || !salesOrderLine.data.itemId)
          throw new Error("Sales order line not found");
        const salesOrderId = salesOrderLine.data.salesOrderId;

        const [salesOrder, salesOrderShipment, shipment, jobs] =
          await Promise.all([
            client
              .from("salesOrder")
              .select("*")
              .eq("id", salesOrderId)
              .single(),
            client
              .from("salesOrderShipment")
              .select("*")
              .eq("id", salesOrderId)
              .maybeSingle(),
            client
              .from("shipment")
              .select("*")
              .eq("id", existingShipmentId)
              .maybeSingle(),
            client
              .from("job")
              .select("*")
              .eq("salesOrderLineId", salesOrderLineId)
              .neq("status", "Cancelled"),
          ]);

        if (!salesOrder.data) throw new Error("Sales order not found");

        const item = await client
          .from("item")
          .select("id, itemTrackingType")
          .eq("id", salesOrderLine.data.itemId)
          .single();

        if (!item.data) throw new Error("Item not found");

        const isSerial = item.data.itemTrackingType === "Serial";
        const isBatch = item.data.itemTrackingType === "Batch";

        const hasShipment = !!shipment.data?.id;
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
                updatedBy: userId,
              })
              .where("id", "=", shipmentId)
              .returning(["id", "shipmentId"])
              .execute();
            // delete existing shipment lines
            await trx
              .deleteFrom("shipmentLine")
              .where("shipmentId", "=", shipmentId)
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
                createdBy: userId,
              })
              .returning(["id", "shipmentId"])
              .execute();

            shipmentId = newShipment?.[0]?.id!;
            shipmentIdReadable = newShipment?.[0]?.shipmentId!;
          }

          if (salesOrderLine.data.methodType === "Make") {
            for await (const job of jobs.data ?? []) {
              if (!salesOrderLine.data.itemId) return;
              const quantityAvailable = isSerial
                ? Math.min(job.quantityComplete - job.quantityShipped, 0)
                : job.quantity - job.quantityReceivedToInventory;

              if (!isSerial || (isSerial && quantityAvailable > 0)) {
                const fulfillment = await trx
                  .insertInto("fulfillment")
                  .values({
                    salesOrderLineId: salesOrderLineId,
                    type: "Job",
                    jobId: job.id,
                    quantity: quantityAvailable,
                    companyId: companyId,
                    createdBy: userId,
                  })
                  .returning(["id"])
                  .execute();

                const fulfillmentId = fulfillment?.[0]?.id;

                const shippingAndTaxUnitCost =
                  (salesOrderLine.data.shippingCost / quantityAvailable +
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
                    orderQuantity: quantityAvailable,
                    outstandingQuantity: quantityAvailable,
                    shippedQuantity: quantityAvailable,
                    requiresSerialTracking: isSerial,
                    requiresBatchTracking: isBatch,
                    unitPrice: shippingAndTaxUnitCost,
                    unitOfMeasure:
                      salesOrderLine.data.unitOfMeasureCode ?? "EA",
                    createdBy: userId ?? "",
                  })
                  .returning(["id"])
                  .execute();

                const shipmentLineId = shipmentLine?.[0]?.id;

                if (!shipmentLineId) throw new Error("Shipment line not found");

                if (isSerial || isBatch) {
                  const jobMakeMethod = await trx
                    .selectFrom("jobMakeMethod")
                    .select(["id"])
                    .where("jobId", "=", job.id)
                    .where("parentMaterialId", "is", null)
                    .executeTakeFirst();

                  if (jobMakeMethod?.id) {
                    const trackedEntities = await client
                      .from("trackedEntity")
                      .select("*")
                      .eq("attributes->>Job Make Method", jobMakeMethod.id)
                      .order("createdAt", { ascending: true });

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
                            "Shipment Line Index": index,
                          },
                        })
                        .where("id", "=", trackedEntity.id)
                        .execute();
                      index++;
                    }
                  }
                }
              }
            }
          } else {
            const outstandingQuantity =
              (salesOrderLine.data.saleQuantity ?? 0) -
              previouslyShippedQuantity;

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
                outstandingQuantity: outstandingQuantity!,
                shippedQuantity: outstandingQuantity!,
                requiresSerialTracking: isSerial,
                requiresBatchTracking: isBatch,
                unitPrice: shippingAndTaxUnitCost,
                unitOfMeasure: salesOrderLine.data.unitOfMeasureCode ?? "EA",
                locationId: salesOrderLine.data.locationId!,
                shelfId: salesOrderLine.data.shelfId!,
                createdBy: userId ?? "",
              })
              .execute();
          }
        });

        return new Response(
          JSON.stringify({
            id: shipmentId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "shipmentLineSplit": {
      const { shipmentId, shipmentLineId, quantity, locationId } = payload;

      console.log({
        function: "create",
        type,
        locationId,
        shipmentId,
        shipmentLineId,
        quantity,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [shipmentLine] = await Promise.all([
          client
            .from("shipmentLine")
            .select("*")
            .eq("id", shipmentLineId)
            .single(),
        ]);

        if (!shipmentLine.data) throw new Error("Shipment line not found");

        await db.transaction().execute(async (trx) => {
          const { id, ...data } = shipmentLine.data;

          await trx
            .insertInto("shipmentLine")
            .values({
              ...data,
              orderQuantity: quantity,
              outstandingQuantity: quantity,
              shippedQuantity: quantity,
              createdBy: userId,
            })
            .execute();

          await trx
            .updateTable("shipmentLine")
            .set({
              orderQuantity: shipmentLine.data.orderQuantity - quantity,
              outstandingQuantity:
                shipmentLine.data.outstandingQuantity - quantity,
              shippedQuantity: shipmentLine.data.shippedQuantity - quantity,
              updatedBy: userId,
            })
            .where("id", "=", shipmentLineId)
            .execute();
        });

        return new Response(
          JSON.stringify({
            id: shipmentLineId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    default:
      return new Response(JSON.stringify({ error: "Invalid document type" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
  }
});

export type ReceiptLineItem = Omit<
  Database["public"]["Tables"]["receiptLine"]["Insert"],
  "id" | "receiptId" | "updatedBy" | "createdAt" | "updatedAt"
>;

export type ShipmentLineItem = Omit<
  Database["public"]["Tables"]["shipmentLine"]["Insert"],
  "id" | "shipmentId" | "updatedBy" | "createdAt" | "updatedAt"
>;
