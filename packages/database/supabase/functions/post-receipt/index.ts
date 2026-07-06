import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";
import {
  credit,
  debit,
  journalReference,
  TrackedEntityAttributes,
} from "../lib/utils.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import {
  resolveSamplingPlan,
  type SamplingStandard,
} from "../shared/sampling-engine.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
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
    const { type, receiptId, userId, companyId } =
      payloadValidator.parse(payload);

    console.log({
      function: "post-receipt",
      type,
      receiptId,
      userId,
      companyId,
    });

    const client = await requirePermissions(req, companyId, userId, { update: "inventory" });

    const [companyRecord, accountingSettings] = await Promise.all([
      client
        .from("company")
        .select("companyGroupId")
        .eq("id", companyId)
        .single(),
      client
        .from("companySettings")
        .select("accountingEnabled")
        .eq("id", companyId)
        .single(),
    ]);
    if (companyRecord.error) throw new Error("Failed to fetch company");
    const companyGroupId = companyRecord.data.companyGroupId;
    const accountingEnabled = accountingSettings.data?.accountingEnabled ?? false;

    const [receipt, receiptLines, receiptLineTracking, dimensions] =
      await Promise.all([
        client.from("receipt").select("*").eq("id", receiptId).single(),
        client.from("receiptLine").select("*").eq("receiptId", receiptId),
        client
          .from("trackedEntity")
          .select("*")
          .eq("attributes->> Receipt", receiptId),
        client
          .from("dimension")
          .select("id, entityType")
          .eq("companyGroupId", companyGroupId)
          .eq("active", true)
          .in("entityType", ["SupplierType", "ItemPostingGroup", "Location", "Process", "FixedAssetClass"]),
      ]);

    if (receipt.error) throw new Error("Failed to fetch receipt");
    if (receiptLines.error) throw new Error("Failed to fetch receipt lines");
    if (dimensions.error) {
      console.error("Failed to fetch dimensions", dimensions.error);
    }

    const dimensionMap = new Map<string, string>();
    for (const dim of dimensions.data ?? []) {
      if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
    }

    const itemIds = receiptLines.data.reduce<string[]>((acc, receiptLine) => {
      if (receiptLine.itemId && !acc.includes(receiptLine.itemId)) {
        acc.push(receiptLine.itemId);
      }
      return acc;
    }, []);
    const [items, itemCosts, companySettings, itemSamplingPlans] =
      await Promise.all([
        client
          .from("item")
          .select("id, itemTrackingType, requiresInspection")
          .in("id", itemIds)
          .eq("companyId", companyId),
        client
          .from("itemCost")
          .select("itemId, itemPostingGroupId")
          .in("itemId", itemIds),
        client
          .from("companySettings")
          .select("samplingStandard")
          .eq("id", companyId)
          .single(),
        (client as any)
          .from("itemSamplingPlan")
          .select(
            "itemId, type, sampleSize, percentage, aql, inspectionLevel, severity"
          )
          .in("itemId", itemIds)
          .eq("companyId", companyId),
      ]);
    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (itemCosts.error) {
      throw new Error("Failed to fetch item costs");
    }

    const samplingStandard: SamplingStandard =
      (companySettings.data as any)?.samplingStandard ?? "ANSI_Z1_4";
    const samplingPlansByItemId = new Map<string, any>(
      ((itemSamplingPlans.data as any[]) ?? []).map((p) => [p.itemId, p])
    );
    
    if (type === "void") {
      if (receipt.data?.status !== "Posted") {
        throw new Error("Can only void posted receipts");
      }

      if (receipt.data.invoiced) {
        throw new Error(
          "Cannot void a receipt created by a purchase invoice. Void the invoice instead."
        );
      }

      if (receipt.data.sourceDocument !== "Purchase Order") {
        throw new Error(
          `Void is only supported for receipts with source document "Purchase Order"`
        );
      }

      if (!receipt.data.sourceDocumentId) {
        throw new Error("Receipt has no sourceDocumentId");
      }

      const [originalItemLedger, originalJournalLines, purchaseOrderLinesVoid] =
        await Promise.all([
          client
            .from("itemLedger")
            .select("*")
            .eq("documentId", receiptId)
            .eq("documentType", "Purchase Receipt")
            .eq("companyId", companyId),
          client
            .from("journalLine")
            .select("*")
            .eq("documentId", receiptId)
            .eq("documentType", "Receipt")
            .eq("companyId", companyId),
          client
            .from("purchaseOrderLine")
            .select("*")
            .eq("purchaseOrderId", receipt.data.sourceDocumentId),
        ]);

      if (originalItemLedger.error)
        throw new Error("Failed to fetch item ledger entries");
      if (originalJournalLines.error)
        throw new Error("Failed to fetch journal lines");
      if (purchaseOrderLinesVoid.error)
        throw new Error("Failed to fetch purchase order lines");

      const reversingItemLedger: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
        originalItemLedger.data.map((entry) => ({
          postingDate: today,
          itemId: entry.itemId,
          quantity: -entry.quantity,
          locationId: entry.locationId,
          storageUnitId: entry.storageUnitId,
          trackedEntityId: entry.trackedEntityId,
          entryType:
            entry.entryType === "Positive Adjmt."
              ? "Negative Adjmt."
              : entry.entryType === "Negative Adjmt."
              ? "Positive Adjmt."
              : entry.entryType,
          documentType: entry.documentType,
          documentId: entry.documentId,
          externalDocumentId: entry.externalDocumentId,
          createdBy: userId,
          companyId,
        }));

      const reversingJournalLines: Omit<
        Database["public"]["Tables"]["journalLine"]["Insert"],
        "journalId"
      >[] = accountingEnabled
        ? originalJournalLines.data.map((entry) => ({
            accountId: entry.accountId,
            accrual: entry.accrual,
            description: `VOID: ${entry.description}`,
            amount: -entry.amount,
            quantity: -entry.quantity,
            documentType: entry.documentType,
            documentId: entry.documentId,
            externalDocumentId: entry.externalDocumentId,
            documentLineReference: entry.documentLineReference,
            journalLineReference: entry.journalLineReference,
            companyId,
          }))
        : [];

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

      const purchaseOrderLineUpdatesVoid = purchaseOrderLinesVoid.data.reduce<
        Record<
          string,
          Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
        >
      >((acc, purchaseOrderLine) => {
        const receiptLinesForPoLine =
          receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
        if (
          receiptLinesForPoLine &&
          receiptLinesForPoLine.length > 0 &&
          purchaseOrderLine.purchaseQuantity &&
          purchaseOrderLine.purchaseQuantity > 0
        ) {
          const receivedQuantityInPurchaseUnit =
            receiptLinesForPoLine.reduce((sum, receiptLine) => {
              const safe =
                isNaN(receiptLine.receivedQuantity) ||
                receiptLine.receivedQuantity == null
                  ? 0
                  : receiptLine.receivedQuantity;
              return sum + safe;
            }, 0) / (receiptLinesForPoLine[0].conversionFactor ?? 1);

          const newQuantityReceived = Math.max(
            0,
            (purchaseOrderLine.quantityReceived ?? 0) -
              receivedQuantityInPurchaseUnit
          );

          const receivedComplete =
            newQuantityReceived >= purchaseOrderLine.purchaseQuantity;

          acc[purchaseOrderLine.id] = {
            quantityReceived: newQuantityReceived,
            receivedComplete,
          };
        }
        return acc;
      }, {});

      // Reverse FA PO line received status on void
      const faPoLinesForVoid = purchaseOrderLinesVoid.data.filter(
        (pol) =>
          pol.purchaseOrderLineType === "Fixed Asset" &&
          pol.assetId &&
          pol.receivedComplete
      );

      for (const faPoLine of faPoLinesForVoid) {
        const hasReceiptEntries = originalJournalLines.data.some(
          (jl) =>
            jl.documentLineReference ===
            journalReference.to.receipt(faPoLine.id)
        );

        if (hasReceiptEntries) {
          purchaseOrderLineUpdatesVoid[faPoLine.id] = {
            quantityReceived: 0,
            receivedComplete: false,
          };

          const receiptCost = originalJournalLines.data
            .filter(
              (jl) =>
                jl.documentLineReference ===
                  journalReference.to.receipt(faPoLine.id) &&
                (jl.amount ?? 0) > 0
            )
            .reduce((sum, jl) => sum + Math.abs(jl.amount ?? 0), 0);

          const assetRecord = await client
            .from("fixedAsset")
            .select("id, acquisitionCost, status")
            .eq("id", faPoLine.assetId!)
            .single();

          if (!assetRecord.error && assetRecord.data) {
            const newAcquisitionCost = Math.max(
              0,
              Number(assetRecord.data.acquisitionCost) - receiptCost
            );
            const faUpdate: Record<string, any> = {
              acquisitionCost: newAcquisitionCost,
              updatedBy: userId,
            };
            if (
              newAcquisitionCost === 0 &&
              assetRecord.data.status === "Active"
            ) {
              faUpdate.status = "Draft";
              faUpdate.acquisitionDate = null;
              faUpdate.depreciationStartDate = null;
            }
            await client
              .from("fixedAsset")
              .update(faUpdate)
              .eq("id", faPoLine.assetId!);
          }
        }
      }

      const projectedPurchaseOrderLines = purchaseOrderLinesVoid.data.map(
        (line) => {
          const update = purchaseOrderLineUpdatesVoid[line.id];
          if (update && update.quantityReceived !== undefined) {
            return {
              ...line,
              quantityReceived: update.quantityReceived,
            };
          }
          return line;
        }
      );

      const areAllLinesInvoicedProjected = projectedPurchaseOrderLines.every(
        (line) => {
          if (line.purchaseOrderLineType === "Comment") return true;
          const target = line.purchaseQuantity ?? 0;
          if (target <= 0) return true;
          return (line.quantityInvoiced ?? 0) >= target;
        }
      );

      const areAllLinesReceivedProjected = projectedPurchaseOrderLines.every(
        (line) => {
          if (
            line.purchaseOrderLineType === "Comment" ||
            line.purchaseOrderLineType === "G/L Account"
          )
            return true;
          const target = line.purchaseQuantity ?? 0;
          if (target <= 0) return true;
          return (line.quantityReceived ?? 0) >= target;
        }
      );

      let purchaseOrderStatusVoid: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
        "To Receive and Invoice";
      if (areAllLinesInvoicedProjected && areAllLinesReceivedProjected) {
        purchaseOrderStatusVoid = "Completed";
      } else if (areAllLinesInvoicedProjected) {
        purchaseOrderStatusVoid = "To Receive";
      } else if (areAllLinesReceivedProjected) {
        purchaseOrderStatusVoid = "To Invoice";
      }

      const trackedEntityUpdatesVoid =
        receiptLineTracking.data?.reduce<
          Record<
            string,
            Database["public"]["Tables"]["trackedEntity"]["Update"]
          >
        >((acc, trackedEntity) => {
          acc[trackedEntity.id] = {
            status: "Available",
            quantity: trackedEntity.quantity,
          };
          return acc;
        }, {}) ?? {};

      const accountingPeriodId = await getCurrentAccountingPeriod(
        client,
        companyId,
        db
      );

      await db.transaction().execute(async (trx) => {
        for await (const [purchaseOrderLineId, update] of Object.entries(
          purchaseOrderLineUpdatesVoid
        )) {
          await trx
            .updateTable("purchaseOrderLine")
            .set(update)
            .where("id", "=", purchaseOrderLineId)
            .execute();
        }

        await trx
          .updateTable("purchaseOrder")
          .set({ status: purchaseOrderStatusVoid })
          .where("id", "=", receipt.data.sourceDocumentId!)
          .execute();

        if (reversingJournalLines.length > 0) {
          const voidJournalEntryId = await getNextSequence(
            trx,
            "journalEntry",
            companyId
          );

          const journal = await trx
            .insertInto("journal")
            .values({
              journalEntryId: voidJournalEntryId,
              accountingPeriodId,
              description: `VOID Purchase Receipt ${receipt.data.receiptId}`,
              postingDate: today,
              companyId,
              sourceType: "Purchase Receipt",
              status: "Posted",
              postedAt: new Date().toISOString(),
              postedBy: userId,
              createdBy: userId,
            })
            .returning(["id"])
            .execute();

          const journalId = journal[0].id;
          if (!journalId) throw new Error("Failed to insert journal");

          await trx
            .insertInto("journalLine")
            .values(
              reversingJournalLines.map((journalLine) => ({
                ...journalLine,
                journalId,
              }))
            )
            .execute();
        }

        if (reversingItemLedger.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(reversingItemLedger)
            .execute();
        }

        if (Object.keys(trackedEntityUpdatesVoid).length > 0) {
          const voidActivity = await trx
            .insertInto("trackedActivity")
            .values({
              type: "Void Receipt",
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

          const voidActivityId = voidActivity[0].id;

          for await (const [id, update] of Object.entries(
            trackedEntityUpdatesVoid
          )) {
            await trx
              .updateTable("trackedEntity")
              .set(update)
              .where("id", "=", id)
              .execute();

            if (voidActivityId) {
              await trx
                .insertInto("trackedActivityInput")
                .values({
                  trackedActivityId: voidActivityId,
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

        await trx
          .updateTable("receipt")
          .set({
            status: "Voided",
            updatedAt: today,
            updatedBy: userId,
          })
          .where("id", "=", receiptId)
          .execute();
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
          const safeReceivedQuantity =
            isNaN(receiptLine.receivedQuantity) ||
            receiptLine.receivedQuantity == null
              ? 0
              : receiptLine.receivedQuantity;
          const lineCost =
            Math.abs(safeReceivedQuantity) * (receiptLine.unitPrice ?? 0);
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
        const journalLineDimensionsMeta: {
          supplierTypeId: string | null;
          itemPostingGroupId: string | null;
          locationId: string | null;
          processId: string | null;
          fixedAssetClassId: string | null;
        }[] = [];

        const isOutsideProcessing =
          purchaseOrder.data.purchaseOrderType === "Outside Processing";

        const processIdByJobOperationId = new Map<string, string>();
        if (isOutsideProcessing) {
          const jobOpIds = purchaseOrderLines.data
            .map((pol) => pol.jobOperationId)
            .filter((id): id is string => !!id);
          if (jobOpIds.length > 0) {
            const jobOps = await client
              .from("jobOperation")
              .select("id, processId")
              .in("id", jobOpIds);
            for (const op of jobOps.data ?? []) {
              if (op.processId) processIdByJobOperationId.set(op.id, op.processId);
            }
          }
        }

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

        // Build one inspection lot per receiptLine that belongs to an item
        // with requiresInspection = true. Compute the sampling plan snapshot
        // from the company's chosen standard and the item's plan (or default
        // to "Inspect All" if no plan is configured).
        const inboundInspectionInserts: Array<Record<string, any>> = [];
        for (const receiptLine of receiptLines.data ?? []) {
          const item = items.data?.find((i) => i.id === receiptLine.itemId);
          if (!item?.requiresInspection) continue;
          if (!receiptLine.itemId) continue;

          const safeReceivedQuantity =
            isNaN(receiptLine.receivedQuantity as any) ||
            receiptLine.receivedQuantity == null
              ? 0
              : receiptLine.receivedQuantity;
          if (safeReceivedQuantity <= 0) continue;

          const plan = samplingPlansByItemId.get(receiptLine.itemId) ?? {
            type: "All",
            sampleSize: null,
            percentage: null,
            aql: null,
            inspectionLevel: "II",
            severity: "Normal",
          };

          const snapshot = resolveSamplingPlan(
            plan,
            safeReceivedQuantity,
            samplingStandard
          );

          inboundInspectionInserts.push({
            receiptLineId: receiptLine.id,
            receiptId,
            itemId: receiptLine.itemId,
            itemReadableId: receiptLine.itemReadableId,
            supplierId: purchaseOrder.data.supplierId ?? null,
            lotSize: safeReceivedQuantity,
            samplingStandard,
            samplingPlanType: plan.type,
            sampleSize: snapshot.sampleSize,
            acceptanceNumber: snapshot.acceptance,
            rejectionNumber: snapshot.rejection,
            aql: plan.aql ?? null,
            inspectionLevel: plan.inspectionLevel ?? null,
            severity: plan.severity ?? null,
            codeLetter: snapshot.codeLetter,
            status: "Pending",
            companyId,
            createdBy: userId,
          });
        }

        // Tracked entities for items requiring inspection stay On Hold after
        // posting (they are released individually by the sample inspection or
        // en masse by lot disposition). Everything else flips to Available.
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

            const safeReceivedQuantity =
              // @ts-ignore - chillllllll
              isNaN(receiptLine?.receivedQuantity) ||
              receiptLine?.receivedQuantity == null
                ? 0
                : receiptLine.receivedQuantity;
            const quantity = receiptLine?.requiresSerialTracking
              ? 1
              : safeReceivedQuantity || itemTracking.quantity;

            const item = items.data?.find(
              (item) => item.id === receiptLine?.itemId
            );
            const requiresInspection = item?.requiresInspection === true;

            acc[itemTracking.id] = {
              status: requiresInspection ? "On Hold" : "Available",
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
                    const safeReceivedQuantity =
                      isNaN(receiptLine.receivedQuantity) ||
                      receiptLine.receivedQuantity == null
                        ? 0
                        : receiptLine.receivedQuantity;
                    return acc + safeReceivedQuantity;
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
                const safeReceivedQuantity =
                  isNaN(receiptLine.receivedQuantity) ||
                  receiptLine.receivedQuantity == null
                    ? 0
                    : receiptLine.receivedQuantity;
                return acc + safeReceivedQuantity;
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
                receivedDate: today,
              },
            };
          }

          return acc;
        }, {});

        // Get account defaults (once for all lines) - only needed for journal entries
        const accountDefaults = accountingEnabled
          ? await getDefaultPostingGroup(client, companyId)
          : null;
        if (accountingEnabled && (accountDefaults?.error || !accountDefaults?.data)) {
          throw new Error("Error getting account defaults");
        }

        // Detect invoice-first scenario: PO lines where qty invoiced > qty received
        const invoiceFirstQtyByPoLine = new Map<string, number>();
        const accrualUnitCostByPoLine = new Map<string, number>();

        if (accountingEnabled) {
          for (const pol of purchaseOrderLines.data) {
            const invoicedInInventoryUnit =
              (pol.quantityInvoiced ?? 0) * (pol.conversionFactor ?? 1);
            const receivedInInventoryUnit =
              (pol.quantityReceived ?? 0) * (pol.conversionFactor ?? 1);
            const invoiceFirstQty = Math.max(
              0,
              invoicedInInventoryUnit - receivedInInventoryUnit
            );
            if (invoiceFirstQty > 0) {
              invoiceFirstQtyByPoLine.set(pol.id, invoiceFirstQty);
            }
          }

          if (invoiceFirstQtyByPoLine.size > 0) {
            const accrualDocRefs = [...invoiceFirstQtyByPoLine.keys()].map(
              (id) => journalReference.to.purchaseInvoice(id)
            );

            const accrualJournalLines = await client
              .from("journalLine")
              .select("documentLineReference, amount, quantity")
              .in("documentLineReference", accrualDocRefs)
              .eq("accrual", true)
              .eq("companyId", companyId);

            if (accrualJournalLines.error) {
              throw new Error("Failed to fetch accrual journal lines");
            }

            // GR/IR debit entries have negative amounts (debit on a liability)
            const accrualCostByPoLine: Record<
              string,
              { totalCost: number; totalQty: number }
            > = {};
            for (const jl of accrualJournalLines.data ?? []) {
              if ((jl.amount ?? 0) < 0 && (jl.quantity ?? 0) > 0) {
                const [, poLineId] = (
                  jl.documentLineReference ?? ""
                ).split(":");
                if (!accrualCostByPoLine[poLineId]) {
                  accrualCostByPoLine[poLineId] = {
                    totalCost: 0,
                    totalQty: 0,
                  };
                }
                accrualCostByPoLine[poLineId].totalCost += Math.abs(
                  jl.amount ?? 0
                );
                accrualCostByPoLine[poLineId].totalQty += jl.quantity ?? 0;
              }
            }

            for (const [poLineId, info] of Object.entries(accrualCostByPoLine)) {
              if (info.totalQty > 0) {
                accrualUnitCostByPoLine.set(
                  poLineId,
                  info.totalCost / info.totalQty
                );
              }
            }
          }
        }

        for await (const receiptLine of receiptLines.data) {
          const jlStartIdx = journalLineInserts.length;

          const itemTrackingType =
            items.data.find((item) => item.id === receiptLine.itemId)
              ?.itemTrackingType ?? "Inventory";

          const receivedQuantity =
            isNaN(receiptLine.receivedQuantity) ||
            receiptLine.receivedQuantity == null
              ? 0
              : receiptLine.receivedQuantity;
          const isNegativeReceipt = receivedQuantity < 0;
          const absReceivedQuantity = Math.abs(receivedQuantity);

          if (accountingEnabled && accountDefaults?.data && absReceivedQuantity > 0) {
            const lineCost = absReceivedQuantity * receiptLine.unitPrice;

            // Add proportional shipping cost based on line value percentage
            const lineValuePercentage =
              totalLinesCost === 0 ? 0 : lineCost / totalLinesCost;
            const lineWeightedShippingCost = shippingCost * lineValuePercentage;
            const cost = lineCost + lineWeightedShippingCost;

            const journalLineReference = nanoid();

            // Find the PO line for this receipt line
            const poLine = purchaseOrderLines.data.find(
              (pol) => pol.id === receiptLine.lineId
            );

            // Determine the debit account based on item type
            let debitAccount: string;
            let debitDescription: string;

            if (itemTrackingType !== "Non-Inventory" && !isOutsideProcessing) {
              debitAccount = accountDefaults.data.inventoryAccount;
              debitDescription = "Inventory Account";
            } else if (isOutsideProcessing) {
              debitAccount = accountDefaults.data.workInProgressAccount;
              debitDescription = "WIP Account";
            } else {
              debitAccount = accountDefaults.data.indirectCostAccount;
              debitDescription = "Indirect Cost Account";
            }

            if (isNegativeReceipt) {
              journalLineInserts.push({
                accountId: accountDefaults.data.goodsReceivedNotInvoicedAccount,
                description: "Goods Received Not Invoiced",
                amount: debit("liability", cost),
                quantity: absReceivedQuantity,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
              });

              journalLineInserts.push({
                accountId: debitAccount,
                description: debitDescription,
                amount: credit("asset", cost),
                quantity: absReceivedQuantity,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
              });
            } else {
              journalLineInserts.push({
                accountId: debitAccount,
                description: debitDescription,
                amount: debit("asset", cost),
                quantity: absReceivedQuantity,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
              });

              journalLineInserts.push({
                accountId: accountDefaults.data.goodsReceivedNotInvoicedAccount,
                description: "Goods Received Not Invoiced",
                amount: credit("liability", cost),
                quantity: absReceivedQuantity,
                documentType: "Receipt",
                documentId: receipt.data?.id ?? undefined,
                externalDocumentId:
                  purchaseOrder.data?.supplierReference ?? undefined,
                documentLineReference: journalReference.to.receipt(
                  receiptLine.lineId!
                ),
                journalLineReference,
                companyId,
              });

              // Invoice-first PPV: when invoice was posted before receipt,
              // accrual entries used invoice cost for GR/IR. The standard
              // entries above credited GR/IR at PO cost. Add adjustment
              // entries so GR/IR clears at invoice cost and PPV captures
              // the difference.
              const poLineId = receiptLine.lineId;
              if (poLineId && invoiceFirstQtyByPoLine.has(poLineId)) {
                const remainingInvoiceFirstQty =
                  invoiceFirstQtyByPoLine.get(poLineId)!;
                const invoiceFirstQty = Math.min(
                  absReceivedQuantity,
                  remainingInvoiceFirstQty
                );

                if (invoiceFirstQty > 0) {
                  invoiceFirstQtyByPoLine.set(
                    poLineId,
                    remainingInvoiceFirstQty - invoiceFirstQty
                  );

                  const accrualUnitCost =
                    accrualUnitCostByPoLine.get(poLineId) ?? 0;
                  const poUnitCost = cost / absReceivedQuantity;
                  const variance =
                    invoiceFirstQty * (accrualUnitCost - poUnitCost);

                  if (Math.abs(variance) > 0.005) {
                    journalLineInserts.push({
                      accountId:
                        accountDefaults.data.goodsReceivedNotInvoicedAccount,
                      description: "GR/IR Clearing",
                      amount: credit("liability", variance),
                      quantity: invoiceFirstQty,
                      documentType: "Receipt",
                      documentId: receipt.data?.id ?? undefined,
                      externalDocumentId:
                        purchaseOrder.data?.supplierReference ?? undefined,
                      documentLineReference: journalReference.to.receipt(
                        poLineId
                      ),
                      journalLineReference,
                      companyId,
                    });

                    journalLineInserts.push({
                      accountId:
                        accountDefaults.data.purchaseVarianceAccount,
                      description: "Purchase Price Variance",
                      amount: debit("expense", variance),
                      quantity: invoiceFirstQty,
                      documentType: "Receipt",
                      documentId: receipt.data?.id ?? undefined,
                      externalDocumentId:
                        purchaseOrder.data?.supplierReference ?? undefined,
                      documentLineReference: journalReference.to.receipt(
                        poLineId
                      ),
                      journalLineReference,
                      companyId,
                    });
                  }
                }
              }
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
              storageUnitId: receiptLine.storageUnitId,
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
              storageUnitId: receiptLine.storageUnitId,
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

            const safeReceiptLineQuantity =
              isNaN(receiptLine.receivedQuantity) ||
              receiptLine.receivedQuantity == null
                ? 0
                : receiptLine.receivedQuantity;
            const absReceivedQuantity = Math.abs(safeReceiptLineQuantity);
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
                storageUnitId: receiptLine.storageUnitId,
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

          // Track dimensions for this receipt line's journal lines
          if (accountingEnabled) {
            const jlCount = journalLineInserts.length - jlStartIdx;
            const lineItemPostingGroupId =
              itemCosts.data.find(
                (cost) => cost.itemId === receiptLine.itemId
              )?.itemPostingGroupId ?? null;
            const poLine = purchaseOrderLines.data.find(
              (pol) => pol.id === receiptLine.lineId
            );
            const lineProcessId = poLine?.jobOperationId
              ? processIdByJobOperationId.get(poLine.jobOperationId) ?? null
              : null;
            for (let i = 0; i < jlCount; i++) {
              journalLineDimensionsMeta.push({
                supplierTypeId: supplier.data.supplierTypeId ?? null,
                itemPostingGroupId: lineItemPostingGroupId,
                locationId: receiptLine.locationId ?? null,
                processId: lineProcessId,
                fixedAssetClassId: null,
              });
            }
          }
        }

        // Process Fixed Asset PO lines (no receipt lines — handled directly from PO)
        const { data: receiptFaLines } = await client
          .from("receiptFixedAssetLine")
          .select("purchaseOrderLineId, serialNumber")
          .eq("receiptId", receiptId)
          .eq("received", true);
        const receivedFaPoLineIds = new Set(
          (receiptFaLines ?? []).map((r) => r.purchaseOrderLineId)
        );
        const faSerialNumbers = new Map(
          (receiptFaLines ?? []).map((r) => [r.purchaseOrderLineId, r.serialNumber])
        );

        const faPurchaseOrderLines = purchaseOrderLines.data.filter(
          (pol) =>
            pol.purchaseOrderLineType === "Fixed Asset" &&
            pol.assetId &&
            !pol.receivedComplete &&
            pol.purchaseQuantity &&
            pol.purchaseQuantity > 0 &&
            receivedFaPoLineIds.has(pol.id)
        );

        for (const faPoLine of faPurchaseOrderLines) {
          if (accountingEnabled && accountDefaults?.data) {
            const quantity = faPoLine.purchaseQuantity ?? 1;
            const unitPrice = faPoLine.unitPrice ?? 0;
            const cost = quantity * unitPrice;

            const assetRecord = await client
              .from("fixedAsset")
              .select(
                "id, status, acquisitionDate, depreciationStartDate, acquisitionCost, locationId, fixedAssetClassId, fixedAssetClass:fixedAssetClassId(assetAccountId)"
              )
              .eq("id", faPoLine.assetId!)
              .single();

            if (assetRecord.error)
              throw new Error("Failed to fetch fixed asset");

            const journalLineRef = nanoid();

            journalLineInserts.push({
              accountId: (assetRecord.data.fixedAssetClass as any)
                .assetAccountId,
              description: "Fixed Asset Acquisition",
              amount: debit("asset", cost),
              quantity,
              documentType: "Receipt",
              documentId: receipt.data?.id ?? undefined,
              externalDocumentId:
                purchaseOrder.data?.supplierReference ?? undefined,
              documentLineReference: journalReference.to.receipt(faPoLine.id!),
              journalLineReference: journalLineRef,
              companyId,
            });

            journalLineInserts.push({
              accountId: accountDefaults.data.goodsReceivedNotInvoicedAccount,
              description: "Goods Received Not Invoiced",
              amount: credit("liability", cost),
              quantity,
              documentType: "Receipt",
              documentId: receipt.data?.id ?? undefined,
              externalDocumentId:
                purchaseOrder.data?.supplierReference ?? undefined,
              documentLineReference: journalReference.to.receipt(faPoLine.id!),
              journalLineReference: journalLineRef,
              companyId,
            });

            for (let i = 0; i < 2; i++) {
              journalLineDimensionsMeta.push({
                supplierTypeId: supplier.data.supplierTypeId ?? null,
                itemPostingGroupId: null,
                locationId: faPoLine.locationId ?? receipt.data.locationId ?? assetRecord.data.locationId ?? null,
                processId: null,
                fixedAssetClassId: assetRecord.data.fixedAssetClassId ?? null,
              });
            }

            const updateData: Record<string, any> = {
              acquisitionCost:
                (Number(assetRecord.data.acquisitionCost) ?? 0) + cost,
              updatedBy: userId,
            };
            if (!assetRecord.data.acquisitionDate) {
              updateData.acquisitionDate = today;
            }
            if (!assetRecord.data.depreciationStartDate) {
              updateData.depreciationStartDate = today;
            }
            if (assetRecord.data.status === "Draft") {
              updateData.status = "Active";
            }

            const serialNumber = faSerialNumbers.get(faPoLine.id!);
            if (serialNumber) {
              updateData.serialNumber = serialNumber;
            }

            const faLineLocationId = faPoLine.locationId ?? receipt.data.locationId;
            if (faLineLocationId) {
              updateData.locationId = faLineLocationId;
            }

            await client
              .from("fixedAsset")
              .update(updateData)
              .eq("id", faPoLine.assetId!);
          }

          purchaseOrderLineUpdates[faPoLine.id!] = {
            quantityReceived: faPoLine.purchaseQuantity,
            receivedComplete: true,
            receivedDate: today,
          };
        }

        const accountingPeriodId = accountingEnabled
          ? await getCurrentAccountingPeriod(client, companyId, db)
          : null;

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
              line.purchaseOrderLineType === "Comment" ||
              line.purchaseOrderLineType === "G/L Account" ||
              line.receivedComplete
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

          if (accountingEnabled && journalLineInserts.length > 0) {
            const journalEntryId = await getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const journalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId,
                accountingPeriodId,
                description: `Purchase Receipt ${receipt.data.receiptId}`,
                postingDate: today,
                companyId,
                sourceType: "Purchase Receipt",
                status: "Posted",
                postedAt: new Date().toISOString(),
                postedBy: userId,
                createdBy: userId,
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            const journalLineResults = await trx
              .insertInto("journalLine")
              .values(
                journalLineInserts.map((line) => ({
                  ...line,
                  journalId: journalResult.id,
                }))
              )
              .returning(["id"])
              .execute();

            // Insert automatic dimensions for journal lines
            if (dimensionMap.size > 0) {
              const journalLineDimensionInserts: {
                journalLineId: string;
                dimensionId: string;
                valueId: string;
                companyId: string;
              }[] = [];

              journalLineResults.forEach((jl, index) => {
                const meta = journalLineDimensionsMeta[index];
                if (!meta) return;

                if (
                  meta.supplierTypeId &&
                  dimensionMap.has("SupplierType")
                ) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("SupplierType")!,
                    valueId: meta.supplierTypeId,
                    companyId,
                  });
                }
                if (
                  meta.itemPostingGroupId &&
                  dimensionMap.has("ItemPostingGroup")
                ) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("ItemPostingGroup")!,
                    valueId: meta.itemPostingGroupId,
                    companyId,
                  });
                }
                if (meta.locationId && dimensionMap.has("Location")) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("Location")!,
                    valueId: meta.locationId,
                    companyId,
                  });
                }
                if (meta.processId && dimensionMap.has("Process")) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("Process")!,
                    valueId: meta.processId,
                    companyId,
                  });
                }
                if (meta.fixedAssetClassId && dimensionMap.has("FixedAssetClass")) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("FixedAssetClass")!,
                    valueId: meta.fixedAssetClassId,
                    companyId,
                  });
                }
              });

              if (journalLineDimensionInserts.length > 0) {
                await trx
                  .insertInto("journalLineDimension")
                  .values(journalLineDimensionInserts)
                  .execute();
              }
            }
          }

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

          if (inboundInspectionInserts.length > 0) {
            for (const row of inboundInspectionInserts) {
              row.inboundInspectionId = await getNextSequence(
                trx,
                "inboundInspection",
                companyId
              );
            }
            await trx
              .insertInto("inboundInspection")
              .values(inboundInspectionInserts)
              .execute();
          }
        });
        break;
      }
      case "Inbound Transfer": {
        if (!receipt.data.sourceDocumentId)
          throw new Error("Receipt has no sourceDocumentId");

        const [warehouseTransfer, warehouseTransferLines] = await Promise.all([
          client
            .from("warehouseTransfer")
            .select("*")
            .eq("id", receipt.data.sourceDocumentId)
            .single(),
          client
            .from("warehouseTransferLine")
            .select("*")
            .eq("transferId", receipt.data.sourceDocumentId),
        ]);

        if (warehouseTransfer.error)
          throw new Error("Failed to fetch warehouse transfer");
        if (warehouseTransferLines.error)
          throw new Error("Failed to fetch warehouse transfer lines");

        // Get item costs for valuation
        const transferItemIds = warehouseTransferLines.data
          .map((line) => line.itemId)
          .filter(Boolean) as string[];
        const itemCosts = await client
          .from("itemCost")
          .select("itemId, itemPostingGroupId, unitCost")
          .in("itemId", transferItemIds);

        if (itemCosts.error) {
          throw new Error("Failed to fetch item costs");
        }

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        const journalLineInserts: Omit<
          Database["public"]["Tables"]["journalLine"]["Insert"],
          "journalId"
        >[] = [];
        const journalLineDimensionsMeta: {
          itemPostingGroupId: string | null;
          locationId: string | null;
          fixedAssetClassId: string | null;
        }[] = [];
        const warehouseTransferLineUpdates: Record<
          string,
          Database["public"]["Tables"]["warehouseTransferLine"]["Update"]
        > = {};

        // Get account defaults (once for all lines) - only needed for journal entries
        const accountDefaults = accountingEnabled
          ? await getDefaultPostingGroup(client, companyId)
          : null;
        if (accountingEnabled && (accountDefaults?.error || !accountDefaults?.data)) {
          throw new Error("Error getting account defaults");
        }

        // Process each receipt line
        for await (const receiptLine of receiptLines.data) {
          const jlStartIdx = journalLineInserts.length;

          const warehouseTransferLine = warehouseTransferLines.data.find(
            (line) => line.id === receiptLine.lineId
          );

          if (!warehouseTransferLine) continue;

          const receivedQuantity =
            isNaN(receiptLine.receivedQuantity) ||
            receiptLine.receivedQuantity == null
              ? 0
              : receiptLine.receivedQuantity;
          if (receivedQuantity === 0) continue;

          // Update warehouse transfer line received quantity
          const newReceivedQuantity =
            (warehouseTransferLine.receivedQuantity ?? 0) + receivedQuantity;

          warehouseTransferLineUpdates[warehouseTransferLine.id] = {
            receivedQuantity: newReceivedQuantity,
          };

          // Get item cost for this item
          const itemCost = itemCosts.data?.find(
            (cost) => cost.itemId === receiptLine.itemId
          );
          const unitCost = itemCost?.unitCost ?? 0;
          const totalValue = Math.abs(receivedQuantity) * unitCost;

          // Create item ledger entry for positive adjustment at destination
          itemLedgerInserts.push({
            postingDate: today,
            itemId: receiptLine.itemId,
            quantity: receivedQuantity,
            locationId: receiptLine.locationId,
            storageUnitId: receiptLine.storageUnitId,
            entryType: "Transfer",
            documentType: "Transfer Receipt",
            documentId: warehouseTransfer.data?.transferId,
            externalDocumentId: receipt.data?.externalDocumentId ?? undefined,
            createdBy: userId,
            companyId,
          });

          // Create journal entries for inventory movement if there's value
          if (accountingEnabled && accountDefaults?.data && totalValue > 0) {
            const journalLineReference = nanoid();

            journalLineInserts.push({
              accountId: accountDefaults.data.inventoryAccount,
              description: `Transfer Out - ${warehouseTransfer.data?.transferId}`,
              amount: credit("asset", totalValue),
              quantity: Math.abs(receivedQuantity),
              documentType: "Receipt",
              documentId: receipt.data?.id,
              externalDocumentId: warehouseTransfer.data?.transferId,
              documentLineReference: `transfer-receipt:${receiptLine.lineId}`,
              journalLineReference,
              companyId,
            });

            journalLineInserts.push({
              accountId: accountDefaults.data.inventoryAccount,
              description: `Transfer In - ${warehouseTransfer.data?.transferId}`,
              amount: debit("asset", totalValue),
              quantity: Math.abs(receivedQuantity),
              documentType: "Receipt",
              documentId: receipt.data?.id,
              externalDocumentId: warehouseTransfer.data?.transferId,
              documentLineReference: `transfer-receipt:${receiptLine.lineId}`,
              journalLineReference,
              companyId,
            });
          }

          // Track dimensions for this receipt line's journal lines
          if (accountingEnabled) {
            const jlCount = journalLineInserts.length - jlStartIdx;
            for (let i = 0; i < jlCount; i++) {
              journalLineDimensionsMeta.push({
                itemPostingGroupId: itemCost?.itemPostingGroupId ?? null,
                locationId: receiptLine.locationId ?? null,
                fixedAssetClassId: null,
              });
            }
          }
        }

        // Check if all lines are fully received
        const allLinesFullyReceived = warehouseTransferLines.data.every(
          (line) => {
            const updates = warehouseTransferLineUpdates[line.id];
            const receivedQty =
              updates?.receivedQuantity ?? line.receivedQuantity ?? 0;
            return receivedQty >= (line.quantity ?? 0);
          }
        );

        // Check if all lines are fully shipped
        const allLinesFullyShipped = warehouseTransferLines.data.every(
          (line) => {
            const shippedQty = line.shippedQuantity ?? 0;
            return shippedQty >= (line.quantity ?? 0);
          }
        );

        // Determine new warehouse transfer status
        let newStatus: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"] =
          warehouseTransfer.data.status;

        if (allLinesFullyReceived && allLinesFullyShipped) {
          newStatus = "Completed";
        } else if (allLinesFullyReceived && !allLinesFullyShipped) {
          newStatus = "To Ship";
        } else if (!allLinesFullyReceived && allLinesFullyShipped) {
          newStatus = "To Receive";
        }

        const accountingPeriodId = accountingEnabled
          ? await getCurrentAccountingPeriod(client, companyId, db)
          : null;

        await db.transaction().execute(async (trx) => {
          // Update warehouse transfer lines
          for await (const [lineId, update] of Object.entries(
            warehouseTransferLineUpdates
          )) {
            await trx
              .updateTable("warehouseTransferLine")
              .set(update)
              .where("id", "=", lineId)
              .execute();
          }

          // Update warehouse transfer status
          await trx
            .updateTable("warehouseTransfer")
            .set({
              status: newStatus,
              updatedBy: userId,
            })
            .where("id", "=", warehouseTransfer.data.id)
            .execute();

          // Create journal entries if there are any
          if (accountingEnabled && journalLineInserts.length > 0) {
            const transferJournalEntryId = await getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const transferJournalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId: transferJournalEntryId,
                accountingPeriodId,
                description: `Transfer Receipt ${receipt.data.receiptId}`,
                postingDate: today,
                companyId,
                sourceType: "Transfer Receipt",
                status: "Posted",
                postedAt: new Date().toISOString(),
                postedBy: userId,
                createdBy: userId,
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            const journalLineResults = await trx
              .insertInto("journalLine")
              .values(
                journalLineInserts.map((line) => ({
                  ...line,
                  journalId: transferJournalResult.id,
                }))
              )
              .returning(["id"])
              .execute();

            // Insert automatic dimensions for transfer journal lines
            if (dimensionMap.size > 0) {
              const journalLineDimensionInserts: {
                journalLineId: string;
                dimensionId: string;
                valueId: string;
                companyId: string;
              }[] = [];

              journalLineResults.forEach((jl, index) => {
                const meta = journalLineDimensionsMeta[index];
                if (!meta) return;

                if (
                  meta.itemPostingGroupId &&
                  dimensionMap.has("ItemPostingGroup")
                ) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("ItemPostingGroup")!,
                    valueId: meta.itemPostingGroupId,
                    companyId,
                  });
                }
                if (meta.locationId && dimensionMap.has("Location")) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("Location")!,
                    valueId: meta.locationId,
                    companyId,
                  });
                }
                if (meta.fixedAssetClassId && dimensionMap.has("FixedAssetClass")) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("FixedAssetClass")!,
                    valueId: meta.fixedAssetClassId,
                    companyId,
                  });
                }
              });

              if (journalLineDimensionInserts.length > 0) {
                await trx
                  .insertInto("journalLineDimension")
                  .values(journalLineDimensionInserts)
                  .execute();
              }
            }
          }

          // Create item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
              .execute();
          }

          // Update receipt status
          await trx
            .updateTable("receipt")
            .set({
              status: "Posted",
              postingDate: today,
              postedBy: userId,
            })
            .where("id", "=", receiptId)
            .execute();
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
    if (payload.type !== "void" && "receiptId" in payload) {
      const client = await requirePermissions(req, payload.companyId, payload.userId, { update: "inventory" });
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
