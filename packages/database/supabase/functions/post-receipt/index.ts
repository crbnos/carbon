import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";
import {
  credit,
  debit,
  journalReference,
  TrackedEntityAttributes,
} from "../lib/utils.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import {
  getInventoryPostingGroup,
  getPurchasingPostingGroup,
} from "../shared/get-posting-group.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  receiptId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();
  const today = format(new Date(), "yyyy-MM-dd");

  try {
    const { receiptId, userId, companyId } = payloadValidator.parse(payload);

    console.log({
      function: "post-receipt",
      receiptId,
      userId,
      companyId,
    });

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const [receipt, receiptLines, receiptLineTracking] = await Promise.all([
      client.from("receipt").select("*").eq("id", receiptId).single(),
      client.from("receiptLine").select("*").eq("receiptId", receiptId),
      client
        .from("trackedEntity")
        .select("*")
        .eq("attributes->> Receipt", receiptId),
    ]);

    if (receipt.error) throw new Error("Failed to fetch receipt");
    if (receiptLines.error) throw new Error("Failed to fetch receipt lines");

    const itemIds = receiptLines.data.reduce<string[]>((acc, receiptLine) => {
      if (receiptLine.itemId && !acc.includes(receiptLine.itemId)) {
        acc.push(receiptLine.itemId);
      }
      return acc;
    }, []);
    const [items, itemCosts] = await Promise.all([
      client
        .from("item")
        .select("id, itemTrackingType")
        .in("id", itemIds)
        .eq("companyId", companyId),
      client
        .from("itemCost")
        .select("itemId, itemPostingGroupId")
        .in("itemId", itemIds),
    ]);
    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (itemCosts.error) {
      throw new Error("Failed to fetch item costs");
    }

    switch (receipt.data?.sourceDocument) {
      case "Purchase Order": {
        if (!receipt.data.sourceDocumentId)
          throw new Error("Receipt has no sourceDocumentId");

        const [purchaseOrder, purchaseOrderLines, purchaseOrderDelivery] =
          await Promise.all([
            client
              .from("purchaseOrder")
              .select("*")
              .eq("id", receipt.data.sourceDocumentId)
              .single(),
            client
              .from("purchaseOrderLine")
              .select("*")
              .eq("purchaseOrderId", receipt.data.sourceDocumentId),
            client
              .from("purchaseOrderDelivery")
              .select("supplierShippingCost")
              .eq("id", receipt.data.sourceDocumentId)
              .single(),
          ]);
        if (purchaseOrder.error)
          throw new Error("Failed to fetch purchase order");
        if (purchaseOrderLines.error)
          throw new Error("Failed to fetch purchase order lines");
        if (purchaseOrderDelivery.error)
          throw new Error("Failed to fetch purchase order delivery");

        const shippingCost =
          (purchaseOrderDelivery.data?.supplierShippingCost ?? 0) *
          (purchaseOrder.data?.exchangeRate ?? 1);

        const totalLinesCost = receiptLines.data.reduce((acc, receiptLine) => {
          const lineCost =
            Math.abs(receiptLine.receivedQuantity ?? 0) *
            (receiptLine.unitPrice ?? 0);
          return acc + lineCost;
        }, 0);

        const supplier = await client
          .from("supplier")
          .select("*")
          .eq("id", purchaseOrder.data.supplierId)
          .eq("companyId", companyId)
          .single();
        if (supplier.error) throw new Error("Failed to fetch supplier");

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        const journalLineInserts: Omit<
          Database["public"]["Tables"]["journalLine"]["Insert"],
          "journalId"
        >[] = [];

        const isOutsideProcessing =
          purchaseOrder.data.purchaseOrderType === "Outside Processing";

        const receiptLinesByPurchaseOrderLineId = receiptLines.data.reduce<
          Record<string, Database["public"]["Tables"]["receiptLine"]["Row"][]>
        >((acc, receiptLine) => {
          if (receiptLine.lineId) {
            acc[receiptLine.lineId] = [
              ...(acc[receiptLine.lineId] ?? []),
              receiptLine,
            ];
          }
          return acc;
        }, {});

        const trackedEntityUpdates =
          receiptLineTracking.data?.reduce<
            Record<
              string,
              Database["public"]["Tables"]["trackedEntity"]["Update"]
            >
          >((acc, itemTracking) => {
            const receiptLine = receiptLines.data?.find(
              (receiptLine) =>
                receiptLine.id ===
                (itemTracking.attributes as TrackedEntityAttributes)?.[
                  "Receipt Line"
                ]?.toString()
            );

            const quantity = receiptLine?.requiresSerialTracking
              ? 1
              : receiptLine?.receivedQuantity ?? itemTracking.quantity;

            acc[itemTracking.id] = {
              status: "Available",
              quantity: quantity,
            };

            return acc;
          }, {}) ?? {};

        const jobOperationUpdates = isOutsideProcessing
          ? purchaseOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["jobOperation"]["Update"]
              >
            >((acc, purchaseOrderLine) => {
              const receiptLines =
                receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
              if (
                receiptLines &&
                receiptLines.length > 0 &&
                purchaseOrderLine.purchaseQuantity &&
                purchaseOrderLine.purchaseQuantity > 0 &&
                purchaseOrderLine.jobOperationId
              ) {
                const recivedQuantityInPurchaseUnit =
                  receiptLines.reduce((acc, receiptLine) => {
                    return acc + (receiptLine.receivedQuantity ?? 0);
                  }, 0) / (receiptLines[0].conversionFactor ?? 1);

                const receivedComplete =
                  purchaseOrderLine.receivedComplete ||
                  recivedQuantityInPurchaseUnit >=
                    (purchaseOrderLine.quantityToReceive ??
                      purchaseOrderLine.purchaseQuantity);

                return {
                  ...acc,
                  [purchaseOrderLine.jobOperationId]: {
                    status: receivedComplete ? "Done" : "In Progress",
                  },
                };
              }

              return acc;
            }, {})
          : {};

        const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
          >
        >((acc, purchaseOrderLine) => {
          const receiptLines =
            receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
          if (
            receiptLines &&
            receiptLines.length > 0 &&
            purchaseOrderLine.purchaseQuantity &&
            purchaseOrderLine.purchaseQuantity > 0
          ) {
            const recivedQuantityInPurchaseUnit =
              receiptLines.reduce((acc, receiptLine) => {
                return acc + (receiptLine.receivedQuantity ?? 0);
              }, 0) / (receiptLines[0].conversionFactor ?? 1);

            const newQuantityReceived =
              (purchaseOrderLine.quantityReceived ?? 0) +
              recivedQuantityInPurchaseUnit;

            const receivedComplete =
              purchaseOrderLine.receivedComplete ||
              recivedQuantityInPurchaseUnit >=
                (purchaseOrderLine.quantityToReceive ??
                  purchaseOrderLine.purchaseQuantity);

            return {
              ...acc,
              [purchaseOrderLine.id]: {
                quantityReceived: newQuantityReceived,
                receivedComplete,
              },
            };
          }

          return acc;
        }, {});

        const journalLines = await client
          .from("journalLine")
          .select("*")
          .in(
            "documentLineReference",
            purchaseOrderLines.data.reduce<string[]>(
              (acc, purchaseOrderLine) => {
                if (
                  (purchaseOrderLine.quantityReceived ?? 0) <
                  (purchaseOrderLine.quantityInvoiced ?? 0)
                ) {
                  acc.push(
                    journalReference.to.purchaseInvoice(purchaseOrderLine.id)
                  );
                }
                return acc;
              },
              []
            )
          );
        if (journalLines.error) {
          throw new Error("Failed to fetch journal entries to reverse");
        }

        const journalLinesByPurchaseOrderLine = journalLines.data.reduce<
          Record<string, Database["public"]["Tables"]["journalLine"]["Row"][]>
        >((acc, journalEntry) => {
          const [type, purchaseOrderLineId] = (
            journalEntry.documentLineReference ?? ""
          ).split(":");
          if (type === "purchase-invoice") {
            if (
              acc[purchaseOrderLineId] &&
              Array.isArray(acc[purchaseOrderLineId])
            ) {
              acc[purchaseOrderLineId].push(journalEntry);
            } else {
              acc[purchaseOrderLineId] = [journalEntry];
            }
          }
          return acc;
        }, {});

        // save the posting groups in memory to avoid unnecessary queries
        const inventoryPostingGroups: Record<
          string,
          Database["public"]["Tables"]["postingGroupInventory"]["Row"] | null
        > = {};

        for await (const receiptLine of receiptLines.data) {
          let postingGroupInventory:
            | Database["public"]["Tables"]["postingGroupInventory"]["Row"]
            | null = null;

          const itemTrackingType =
            items.data.find((item) => item.id === receiptLine.itemId)
              ?.itemTrackingType ?? "Inventory";

          const itemPostingGroupId =
            itemCosts.data.find((item) => item.itemId === receiptLine.itemId)
              ?.itemPostingGroupId ?? null;

          const locationId = receiptLine.locationId ?? null;
          const supplierTypeId: string | null =
            supplier.data.supplierTypeId ?? null;

          // inventory posting group
          if (`${itemPostingGroupId}-${locationId}` in inventoryPostingGroups) {
            postingGroupInventory =
              inventoryPostingGroups[`${itemPostingGroupId}-${locationId}`];
          } else {
            const inventoryPostingGroup = await getInventoryPostingGroup(
              client,
              companyId,
              {
                itemPostingGroupId,
                locationId,
              }
            );

            if (inventoryPostingGroup.error || !inventoryPostingGroup.data) {
              throw new Error("Error getting inventory posting group");
            }

            postingGroupInventory = inventoryPostingGroup.data ?? null;
            inventoryPostingGroups[`${itemPostingGroupId}-${locationId}`] =
              postingGroupInventory;
          }

          if (!postingGroupInventory) {
            throw new Error("No inventory posting group found");
          }

          // purchasing posting group
          const purchasingPostingGroups: Record<
            string,
            Database["public"]["Tables"]["postingGroupPurchasing"]["Row"] | null
          > = {};

          let postingGroupPurchasing:
            | Database["public"]["Tables"]["postingGroupPurchasing"]["Row"]
            | null = null;

          if (
            `${itemPostingGroupId}-${supplierTypeId}` in purchasingPostingGroups
          ) {
            postingGroupPurchasing =
              purchasingPostingGroups[
                `${itemPostingGroupId}-${supplierTypeId}`
              ];
          } else {
            const purchasingPostingGroup = await getPurchasingPostingGroup(
              client,
              companyId,
              {
                itemPostingGroupId,
                supplierTypeId,
              }
            );

            if (purchasingPostingGroup.error || !purchasingPostingGroup.data) {
              throw new Error("Error getting purchasing posting group");
            }

            postingGroupPurchasing = purchasingPostingGroup.data ?? null;
            purchasingPostingGroups[`${itemPostingGroupId}-${supplierTypeId}`] =
              postingGroupPurchasing;
          }

          if (!postingGroupPurchasing) {
            throw new Error("No purchasing posting group found");
          }

          // determine the journal lines that should be reversed
          const existingJournalLines = receiptLine.lineId
            ? journalLinesByPurchaseOrderLine[receiptLine.lineId] ?? []
            : [];

          let previousJournalId: number | null = null;
          let previousAccrual: boolean | null = null;
          let currentGroup = 0;

          const existingJournalLineGroups = existingJournalLines.reduce<
            Database["public"]["Tables"]["journalLine"]["Row"][][]
          >((acc, entry) => {
            const { journalId, accrual } = entry;

            if (
              journalId === previousJournalId &&
              accrual === previousAccrual
            ) {
              acc[currentGroup - 1].push(entry);
            } else {
              acc.push([entry]);
              currentGroup++;
            }

            previousJournalId = journalId;
            previousAccrual = accrual;
            return acc;
          }, []);

          const purchaseOrderLine = purchaseOrderLines.data.find(
            (line) => line.id === receiptLine.lineId
          );

          const quantityReceived =
            (purchaseOrderLine?.quantityReceived ?? 0) *
            (purchaseOrderLine?.conversionFactor ?? 1);

          const quantityInvoiced =
            (purchaseOrderLine?.quantityInvoiced ?? 0) *
            (purchaseOrderLine?.conversionFactor ?? 1);

          const quantityToReverse = Math.max(
            0,
            Math.min(
              Math.abs(receiptLine.receivedQuantity ?? 0),
              quantityInvoiced - quantityReceived
            )
          );

          const quantityAlreadyReversed =
            quantityReceived < quantityInvoiced ? quantityReceived : 0;

          if (quantityToReverse > 0) {
            let quantityCounted = 0;
            let quantityReversed = 0;
            let reversedValue = 0;

            existingJournalLineGroups.forEach((entry) => {
              if (entry[0].quantity) {
                const unitCostForEntry =
                  (entry[0].amount ?? 0) / entry[0].quantity;

                // we don't want to reverse an entry twice, so we need to keep track of what's been previously reversed

                // akin to supply
                const quantityAvailableToReverseForEntry =
                  quantityAlreadyReversed > quantityCounted
                    ? entry[0].quantity +
                      quantityCounted -
                      quantityAlreadyReversed
                    : entry[0].quantity;

                // akin to demand
                const quantityRequiredToReverse =
                  quantityToReverse - quantityReversed;

                // we can't reverse more than what's available or what's required
                const quantityToReverseForEntry = Math.max(
                  0,
                  Math.min(
                    quantityAvailableToReverseForEntry,
                    quantityRequiredToReverse
                  )
                );

                if (quantityToReverseForEntry > 0) {
                  if (
                    entry[0].accrual === false ||
                    entry[1].accrual === false
                  ) {
                    throw new Error("Cannot reverse non-accrual entries");
                  }

                  const journalLineReference = nanoid();

                  // create the reversal entries
                  journalLineInserts.push({
                    accountNumber: entry[0].accountNumber!,
                    description: entry[0].description,
                    amount:
                      entry[0].description === "Inventory Invoiced Not Received"
                        ? credit(
                            "asset",
                            quantityToReverseForEntry * unitCostForEntry
                          )
                        : debit(
                            "asset", // "Interim Inventory Accrual"
                            quantityToReverseForEntry * unitCostForEntry
                          ),
                    quantity: quantityToReverseForEntry,
                    documentType: "Invoice",
                    documentId: receipt.data?.id,
                    externalDocumentId: receipt?.data.externalDocumentId,
                    documentLineReference: journalReference.to.receipt(
                      receiptLine.lineId!
                    ),
                    journalLineReference,
                    companyId,
                  });

                  journalLineInserts.push({
                    accountNumber: entry[1].accountNumber!,
                    description: entry[1].description,
                    amount:
                      entry[1].description === "Inventory Invoiced Not Received"
                        ? credit(
                            "asset",
                            quantityToReverseForEntry * unitCostForEntry
                          )
                        : debit(
                            "asset", // "Interim Inventory Accrual"
                            quantityToReverseForEntry * unitCostForEntry
                          ),
                    quantity: quantityToReverseForEntry,
                    documentType: "Invoice",
                    documentId: receipt.data?.id,
                    externalDocumentId: receipt?.data.externalDocumentId,
                    documentLineReference: journalReference.to.receipt(
                      receiptLine.lineId!
                    ),
                    journalLineReference,
                    companyId,
                  });
                }

                quantityCounted += entry[0].quantity;
                quantityReversed += quantityToReverseForEntry;
                reversedValue += unitCostForEntry * quantityToReverseForEntry;
              }
            });

            // create the normal GL entries

            let journalLineReference = nanoid();

            if (itemTrackingType !== "Non-Inventory") {
              // debit the inventory account
              journalLineInserts.push({
                accountNumber: isOutsideProcessing
                  ? postingGroupInventory.workInProgressAccount
                  : postingGroupInventory.inventoryAccount,
                description: isOutsideProcessing
                  ? "WIP Account"
                  : "Inventory Account",
                amount: debit("asset", reversedValue),
                quantity: quantityToReverse,
                documentType: "Receipt",
                documentId: receipt.data?.id,
                externalDocumentId: receipt.data?.externalDocumentId,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
              });

              // credit the direct cost applied account
              journalLineInserts.push({
                accountNumber: postingGroupInventory.directCostAppliedAccount,
                description: "Direct Cost Applied",
                amount: credit("expense", reversedValue),
                quantity: quantityToReverse,
                documentType: "Receipt",
                documentId: receipt.data?.id,
                externalDocumentId: receipt.data?.externalDocumentId,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
              });
            } else {
              // debit the overhead account
              journalLineInserts.push({
                accountNumber: postingGroupInventory.overheadAccount,
                description: "Overhead Account",
                amount: debit("asset", reversedValue),
                quantity: quantityToReverse,
                documentType: "Receipt",
                documentId: receipt.data?.id,
                externalDocumentId: receipt.data?.externalDocumentId,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
              });

              // credit the overhead cost applied account
              journalLineInserts.push({
                accountNumber: postingGroupInventory.overheadCostAppliedAccount,
                description: "Overhead Cost Applied",
                amount: credit("expense", reversedValue),
                quantity: quantityToReverse,
                documentType: "Receipt",
                documentId: receipt.data?.id,
                externalDocumentId: receipt.data?.externalDocumentId,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
              });
            }

            journalLineReference = nanoid();

            // debit the purchase account
            journalLineInserts.push({
              accountNumber: postingGroupPurchasing.purchaseAccount,
              description: "Purchase Account",
              amount: debit("expense", reversedValue),
              quantity: quantityToReverse,
              documentType: "Receipt",
              documentId: receipt.data?.id,
              externalDocumentId: receipt.data?.externalDocumentId,
              documentLineReference: journalReference.to.receipt(
                receiptLine.lineId!
              ),
              journalLineReference,
              companyId,
            });

            // credit the accounts payable account
            journalLineInserts.push({
              accountNumber: postingGroupPurchasing.payablesAccount,
              description: "Accounts Payable",
              amount: credit("liability", reversedValue),
              quantity: quantityToReverse,
              documentType: "Receipt",
              documentId: receipt.data?.id,
              externalDocumentId: receipt.data?.externalDocumentId,
              documentLineReference: journalReference.to.receipt(
                receiptLine.lineId!
              ),
              journalLineReference,
              companyId,
            });
          }

          const receivedQuantity = receiptLine.receivedQuantity ?? 0;
          const isNegativeReceipt = receivedQuantity < 0;
          const absReceivedQuantity = Math.abs(receivedQuantity);

          if (absReceivedQuantity > quantityToReverse) {
            // create the accrual entries for received not invoiced
            const quantityToAccrue = absReceivedQuantity - quantityToReverse;

            const expectedValue =
              (absReceivedQuantity - quantityToReverse) * receiptLine.unitPrice;

            // Add proportional shipping cost to the expected value based on line value percentage
            const lineValuePercentage =
              totalLinesCost === 0 ? 0 : expectedValue / totalLinesCost;
            const lineWeightedShippingCost = shippingCost * lineValuePercentage;
            const expectedValueWithShipping =
              expectedValue + lineWeightedShippingCost;

            const journalLineReference = nanoid();

            // For negative receipts, we need to reverse the debit/credit entries
            if (isNegativeReceipt) {
              journalLineInserts.push({
                accountNumber:
                  postingGroupInventory.inventoryInterimAccrualAccount,
                description: "Interim Inventory Accrual",
                accrual: true,
                amount: credit("asset", expectedValueWithShipping),
                quantity: quantityToAccrue,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: `receipt:${receiptLine.lineId}`,
                journalLineReference,
                companyId,
              });

              journalLineInserts.push({
                accountNumber:
                  postingGroupInventory.inventoryReceivedNotInvoicedAccount,
                description: "Inventory Received Not Invoiced",
                accrual: true,
                amount: debit("liability", expectedValueWithShipping),
                quantity: quantityToAccrue,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: `receipt:${receiptLine.lineId}`,
                journalLineReference,
                companyId,
              });
            } else {
              journalLineInserts.push({
                accountNumber:
                  postingGroupInventory.inventoryInterimAccrualAccount,
                description: "Interim Inventory Accrual",
                accrual: true,
                amount: debit("asset", expectedValueWithShipping),
                quantity: quantityToAccrue,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: `receipt:${receiptLine.lineId}`,
                journalLineReference,
                companyId,
              });

              journalLineInserts.push({
                accountNumber:
                  postingGroupInventory.inventoryReceivedNotInvoicedAccount,
                description: "Inventory Received Not Invoiced",
                accrual: true,
                amount: credit("liability", expectedValueWithShipping),
                quantity: quantityToAccrue,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: `receipt:${receiptLine.lineId}`,
                journalLineReference,
                companyId,
              });
            }
          }

          if (itemTrackingType === "Inventory" && !isOutsideProcessing) {
            // For inventory entries, use the appropriate entry type based on quantity sign
            const entryType =
              receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";

            itemLedgerInserts.push({
              postingDate: today,
              itemId: receiptLine.itemId,
              quantity: receivedQuantity,
              locationId: receiptLine.locationId,
              shelfId: receiptLine.shelfId,
              entryType,
              documentType: "Purchase Receipt",
              documentId: receipt.data?.id ?? undefined,
              externalDocumentId: receipt.data?.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId,
            });
          }

          if (receiptLine.requiresBatchTracking && !isOutsideProcessing) {
            const entryType =
              receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";

            itemLedgerInserts.push({
              postingDate: today,
              itemId: receiptLine.itemId,
              quantity: receivedQuantity,
              locationId: receiptLine.locationId,
              shelfId: receiptLine.shelfId,
              entryType,
              documentType: "Purchase Receipt",
              documentId: receipt.data?.id ?? undefined,
              trackedEntityId: receiptLineTracking.data?.find(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Receipt Line"] === receiptLine.id
              )?.id,
              externalDocumentId: receipt.data?.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId,
            });
          }

          if (receiptLine.requiresSerialTracking && !isOutsideProcessing) {
            const lineTracking = receiptLineTracking.data?.filter(
              (tracking) =>
                (tracking.attributes as TrackedEntityAttributes | undefined)?.[
                  "Receipt Line"
                ] === receiptLine.id
            );

            const absReceivedQuantity = Math.abs(
              receiptLine.receivedQuantity || 0
            );
            const entryType =
              receivedQuantity < 0 ? "Negative Adjmt." : "Positive Adjmt.";
            const quantityPerEntry = receivedQuantity < 0 ? -1 : 1;

            for (let i = 0; i < absReceivedQuantity; i++) {
              const trackingWithIndex = lineTracking?.find(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Receipt Line Index"] === i
              );

              itemLedgerInserts.push({
                postingDate: today,
                itemId: receiptLine.itemId,
                quantity: quantityPerEntry,
                locationId: receiptLine.locationId,
                shelfId: receiptLine.shelfId,
                entryType,
                documentType: "Purchase Receipt",
                documentId: receipt.data?.id ?? undefined,
                trackedEntityId: trackingWithIndex?.id,
                externalDocumentId:
                  receipt.data?.externalDocumentId ?? undefined,
                createdBy: userId,
                companyId,
              });
            }
          }
        }

        const accountingPeriodId = await getCurrentAccountingPeriod(
          client,
          companyId,
          db
        );

        await db.transaction().execute(async (trx) => {
          for await (const [purchaseOrderLineId, update] of Object.entries(
            purchaseOrderLineUpdates
          )) {
            await trx
              .updateTable("purchaseOrderLine")
              .set(update)
              .where("id", "=", purchaseOrderLineId)
              .execute();
          }

          for await (const [jobOperationId, update] of Object.entries(
            jobOperationUpdates
          )) {
            await trx
              .updateTable("jobOperation")
              .set(update)
              .where("id", "=", jobOperationId)
              .execute();
          }

          const purchaseOrderLines = await trx
            .selectFrom("purchaseOrderLine")
            .select([
              "id",
              "purchaseOrderLineType",
              "invoicedComplete",
              "receivedComplete",
            ])
            .where("purchaseOrderId", "=", purchaseOrder.data.id)
            .execute();

          const areAllLinesInvoiced = purchaseOrderLines.every(
            (line) =>
              line.purchaseOrderLineType === "Comment" || line.invoicedComplete
          );

          const areAllLinesReceived = purchaseOrderLines.every(
            (line) =>
              line.purchaseOrderLineType === "Comment" || line.receivedComplete
          );

          let status: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
            "To Receive and Invoice";
          if (areAllLinesInvoiced && areAllLinesReceived) {
            status = "Completed";
          } else if (areAllLinesInvoiced) {
            status = "To Receive";
          } else if (areAllLinesReceived) {
            status = "To Invoice";
          }

          await trx
            .updateTable("purchaseOrder")
            .set({
              status,
            })
            .where("id", "=", purchaseOrder.data.id)
            .execute();

          await trx
            .updateTable("purchaseOrderDelivery")
            .set({
              deliveryDate: today,
              locationId: receipt.data.locationId,
            })
            .where("id", "=", receipt.data.sourceDocumentId)
            .execute();

          const journal = await trx
            .insertInto("journal")
            .values({
              accountingPeriodId,
              description: `Purchase Receipt ${receipt.data.receiptId}`,
              postingDate: today,
              companyId,
            })
            .returning(["id"])
            .execute();

          const journalId = journal[0].id;
          if (!journalId) throw new Error("Failed to insert journal");

          await trx
            .insertInto("journalLine")
            .values(
              journalLineInserts.map((journalLine) => ({
                ...journalLine,
                journalId,
              }))
            )
            .returning(["id"])
            .execute();

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
              .execute();
          }

          await trx
            .updateTable("receipt")
            .set({
              status: "Posted",
              postingDate: today,
              postedBy: userId,
            })
            .where("id", "=", receiptId)
            .execute();

          if (Object.keys(trackedEntityUpdates).length > 0) {
            const trackedActivity = await trx
              .insertInto("trackedActivity")
              .values({
                type: "Receive",
                sourceDocument: "Receipt",
                sourceDocumentId: receiptId,
                sourceDocumentReadableId: receipt.data.receiptId,
                attributes: {
                  "Purchase Order": receipt.data.sourceDocumentId,
                  Receipt: receiptId,
                  Employee: userId,
                },
                companyId,
                createdBy: userId,
                createdAt: today,
              })
              .returning(["id"])
              .execute();

            const trackedActivityId = trackedActivity[0].id;

            for await (const [id, update] of Object.entries(
              trackedEntityUpdates
            )) {
              await trx
                .updateTable("trackedEntity")
                .set(update)
                .where("id", "=", id)
                .execute();

              if (trackedActivityId) {
                await trx
                  .insertInto("trackedActivityOutput")
                  .values({
                    trackedActivityId,
                    trackedEntityId: id,
                    quantity: update.quantity ?? 0,
                    companyId,
                    createdBy: userId,
                    createdAt: today,
                  })
                  .execute();
              }
            }
          }
        });
        break;
      }
      default: {
        break;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(err);
    if ("receiptId" in payload) {
      const client = await getSupabaseServiceRole(
        req.headers.get("Authorization"),
        req.headers.get("carbon-key") ?? "",
        payload.companyId
      );
      await client
        .from("receipt")
        .update({ status: "Draft" })
        .eq("id", payload.receiptId);
    }
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
