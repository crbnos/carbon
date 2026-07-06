import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { Database, Json } from "../lib/types.ts";
import { TrackedEntityAttributes, credit, debit, journalReference } from "../lib/utils.ts";
import { calculateCOGS } from "../shared/calculate-cogs.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["post", "void"]),
  shipmentId: z.string(),
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
    const { type, shipmentId, userId, companyId } =
      payloadValidator.parse(payload);

    console.log({
      function: "post-shipment",
      type,
      shipmentId,
      userId,
      companyId,
    });

    const client = await requirePermissions(req, companyId, userId, { update: "inventory" });

    const [shipment, shipmentLines, shipmentLineTracking] = await Promise.all([
      client.from("shipment").select("*").eq("id", shipmentId).single(),
      client
        .from("shipmentLine")
        .select("*, fulfillment(*)")
        .eq("shipmentId", shipmentId),
      client
        .from("trackedEntity")
        .select("*")
        .eq("attributes->> Shipment", shipmentId),
    ]);

    if (shipment.error) throw new Error("Failed to fetch shipment");
    if (shipmentLines.error) throw new Error("Failed to fetch shipment lines");

    const itemIds = shipmentLines.data.reduce<string[]>((acc, shipmentLine) => {
      if (shipmentLine.itemId && !acc.includes(shipmentLine.itemId)) {
        acc.push(shipmentLine.itemId);
      }
      return acc;
    }, []);

    const jobIds = shipmentLines.data.reduce<string[]>((acc, shipmentLine) => {
      if (
        shipmentLine.fulfillment?.jobId &&
        !acc.includes(shipmentLine.fulfillment?.jobId)
      ) {
        acc.push(shipmentLine.fulfillment?.jobId);
      }
      return acc;
    }, []);

    const [items, itemCosts, jobs] = await Promise.all([
      client
        .from("item")
        .select("id, itemTrackingType")
        .in("id", itemIds)
        .eq("companyId", companyId),
      client
        .from("itemCost")
        .select("itemId, itemPostingGroupId")
        .in("itemId", itemIds),
      client
        .from("job")
        .select("id, quantity, quantityComplete, quantityShipped, status")
        .in("id", jobIds),
    ]);
    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (itemCosts.error) {
      throw new Error("Failed to fetch item costs");
    }
    if (jobs.error) {
      throw new Error("Failed to fetch jobs");
    }

    const splitEntityIds: string[] = [];

    switch (type) {
      case "post": {
        switch (shipment.data?.sourceDocument) {
          case "Sales Order": {
            if (!shipment.data.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [salesOrder, salesOrderLines, salesOrderDelivery] =
              await Promise.all([
                client
                  .from("salesOrder")
                  .select("*")
                  .eq("id", shipment.data.sourceDocumentId)
                  .single(),
                client
                  .from("salesOrderLine")
                  .select("*")
                  .eq("salesOrderId", shipment.data.sourceDocumentId),
                client
                  .from("salesOrderShipment")
                  .select("shippingCost")
                  .eq("id", shipment.data.sourceDocumentId)
                  .single(),
              ]);
            if (salesOrder.error)
              throw new Error("Failed to fetch purchase order");
            if (salesOrderLines.error)
              throw new Error("Failed to fetch sales order lines");
            if (salesOrderDelivery.error)
              throw new Error("Failed to fetch sales order delivery");

            const customer = await client
              .from("customer")
              .select("*")
              .eq("id", salesOrder.data.customerId)
              .eq("companyId", companyId)
              .single();
            if (customer.error) throw new Error("Failed to fetch customer");

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

            const accountDefaults = accountingEnabled
              ? await getDefaultPostingGroup(client, companyId)
              : null;
            if (accountingEnabled && (accountDefaults?.error || !accountDefaults?.data)) {
              throw new Error("Error getting account defaults");
            }

            const dimensions = accountingEnabled
              ? await client
                  .from("dimension")
                  .select("id, entityType")
                  .eq("companyGroupId", companyGroupId)
                  .eq("active", true)
                  .in("entityType", [
                    "CustomerType",
                    "ItemPostingGroup",
                    "Location",
                    "CostCenter",
                    "FixedAssetClass",
                  ])
              : null;

            const dimensionMap = new Map<string, string>();
            if (dimensions?.data) {
              for (const dim of dimensions.data) {
                if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
              }
            }

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];

            const journalLineInserts: Omit<
              Database["public"]["Tables"]["journalLine"]["Insert"],
              "journalId"
            >[] = [];

            const journalLineDimensionsMeta: {
              customerTypeId: string | null;
              itemPostingGroupId: string | null;
              locationId: string | null;
              costCenterId: string | null;
              fixedAssetClassId: string | null;
            }[] = [];

            const jobUpdates: Record<
              string,
              Database["public"]["Tables"]["job"]["Update"]
            > = {};

            const serialNumbersConsumed: string[] = [];

            const locationId = shipment.data.locationId;
            for await (const shipmentLine of shipmentLines.data) {
              const salesOrderLine = salesOrderLines.data.find(
                (sol) => sol.id === shipmentLine.lineId
              );

              if (
                shipmentLine.fulfillment?.type === "Job" &&
                shipmentLine.fulfillment?.jobId
              ) {
                // Update quantity shipped on job, accumulating totals from multiple shipments
                const jobId = shipmentLine.fulfillment.jobId;
                const currentJob = jobs.data.find((j) => j.id === jobId);

                // Log job and shipment line data to debug NaN issues
                console.log("Processing job update:", {
                  jobId,
                  currentJob: currentJob
                    ? {
                        id: currentJob.id,
                        quantity: currentJob.quantity,
                        quantityShipped: currentJob.quantityShipped,
                        quantityComplete: currentJob.quantityComplete,
                        status: currentJob.status,
                      }
                    : null,
                  shipmentLine: {
                    id: shipmentLine.id,
                    shippedQuantity: shipmentLine.shippedQuantity,
                    shippedQuantityType: typeof shipmentLine.shippedQuantity,
                  },
                });

                const currentQuantityShipped = currentJob?.quantityShipped ?? 0;

                // Ensure shippedQuantity is a valid number to prevent "100NaN" errors
                const shippedQuantity =
                  typeof shipmentLine.shippedQuantity === "number" &&
                  !isNaN(shipmentLine.shippedQuantity)
                    ? shipmentLine.shippedQuantity
                    : 0;

                console.log("Calculated values:", {
                  currentQuantityShipped,
                  shippedQuantity,
                  newTotal: currentQuantityShipped + shippedQuantity,
                  jobQuantity: currentJob?.quantity,
                });

                // If we've already updated this job in this transaction, use that as the base
                // instead of the current DB value to avoid double counting
                if (jobUpdates[jobId]) {
                  const newQuantityShipped =
                    (jobUpdates[jobId]?.quantityShipped ?? 0) + shippedQuantity;
                  const newQuantityComplete =
                    currentJob?.status === "Completed"
                      ? currentJob?.quantityComplete
                      : Math.max(
                          currentJob?.quantityComplete ?? 0,
                          shippedQuantity
                        );
                  const newStatus =
                    currentQuantityShipped + shippedQuantity >=
                    (currentJob?.quantity ?? 0)
                      ? "Completed"
                      : currentJob?.status;

                  console.log("Updating existing job update:", {
                    jobId,
                    previousUpdate: jobUpdates[jobId],
                    newUpdate: {
                      status: newStatus,
                      quantityComplete: newQuantityComplete,
                      quantityShipped: newQuantityShipped,
                    },
                  });

                  jobUpdates[jobId] = {
                    status: newStatus,
                    quantityComplete: newQuantityComplete,
                    quantityShipped: newQuantityShipped,
                  };
                } else {
                  const newQuantityShipped =
                    currentQuantityShipped + shippedQuantity;
                  const newQuantityComplete =
                    currentJob?.status === "Completed"
                      ? currentJob?.quantityComplete
                      : Math.max(
                          currentJob?.quantityComplete ?? 0,
                          shippedQuantity
                        );
                  const newStatus =
                    currentQuantityShipped + shippedQuantity >=
                    (currentJob?.quantity ?? 0)
                      ? "Completed"
                      : currentJob?.status;

                  console.log("Creating new job update:", {
                    jobId,
                    update: {
                      status: newStatus,
                      quantityComplete: newQuantityComplete,
                      quantityShipped: newQuantityShipped,
                    },
                  });

                  jobUpdates[jobId] = {
                    status: newStatus,
                    quantityComplete: newQuantityComplete,
                    quantityShipped: newQuantityShipped,
                  };
                }
              }

              const itemTrackingType =
                items.data.find((item) => item.id === shipmentLine.itemId)
                  ?.itemTrackingType ?? "Inventory";

              // Default shippedQuantity to 0 if not defined or NaN
              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;

              if (itemTrackingType === "Inventory") {
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: -shippedQuantity,
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Negative Adjmt.",
                  documentType: "Sales Shipment",
                  documentId: shipment.data?.id ?? undefined,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId,
                });
              }

              if (shipmentLine.requiresBatchTracking) {
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: -shippedQuantity,
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Negative Adjmt.",
                  documentType: "Sales Shipment",
                  documentId: shipment.data?.id ?? undefined,
                  trackedEntityId: shipmentLineTracking.data?.find(
                    (tracking) =>
                      (
                        tracking.attributes as
                          | TrackedEntityAttributes
                          | undefined
                      )?.["Shipment Line"] === shipmentLine.id
                  )?.id,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId,
                });
              }

              if (shipmentLine.requiresSerialTracking) {
                const lineTracking = shipmentLineTracking.data?.filter(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Shipment Line"] === shipmentLine.id
                );

                lineTracking?.forEach((tracking) => {
                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLine.itemId,
                    quantity: -1,
                    locationId: shipmentLine.locationId ?? locationId,
                    storageUnitId: shipmentLine.storageUnitId,
                    entryType: "Negative Adjmt.",
                    documentType: "Sales Shipment",
                    documentId: shipment.data?.id ?? undefined,
                    trackedEntityId: tracking.id,
                    externalDocumentId: undefined,
                    createdBy: userId,
                    companyId,
                  });

                  if (tracking.id) {
                    serialNumbersConsumed.push(tracking.id);
                  }
                });
              }

              // COGS journal entries for this shipment line
              if (
                accountingEnabled &&
                accountDefaults?.data &&
                shipmentLine.itemId &&
                shippedQuantity > 0 &&
                itemTrackingType !== "Non-Inventory"
              ) {
                const itemPostingGroupId =
                  itemCosts.data.find(
                    (cost) => cost.itemId === shipmentLine.itemId
                  )?.itemPostingGroupId ?? null;

                const salesOrderLine = salesOrderLines.data.find(
                  (sol) => sol.id === shipmentLine.lineId
                );

                const journalLineReference = nanoid();

                journalLineInserts.push({
                  accountId: accountDefaults.data.costOfGoodsSoldAccount,
                  description: "Cost of Goods Sold",
                  amount: 0,
                  quantity: shippedQuantity,
                  documentType: "Sales Shipment",
                  documentId: shipment.data?.id,
                  externalDocumentId: salesOrder.data?.customerReference ?? undefined,
                  documentLineReference: journalReference.to.shipment(shipmentLine.id),
                  journalLineReference,
                  companyId,
                });

                journalLineInserts.push({
                  accountId: accountDefaults.data.inventoryAccount,
                  description: "Inventory Account",
                  amount: 0,
                  quantity: shippedQuantity,
                  documentType: "Sales Shipment",
                  documentId: shipment.data?.id,
                  externalDocumentId: salesOrder.data?.customerReference ?? undefined,
                  documentLineReference: journalReference.to.shipment(shipmentLine.id),
                  journalLineReference,
                  companyId,
                });

                for (let i = 0; i < 2; i++) {
                  journalLineDimensionsMeta.push({
                    customerTypeId: customer.data.customerTypeId ?? null,
                    itemPostingGroupId,
                    locationId: shipmentLine.locationId ?? locationId ?? null,
                    costCenterId: salesOrderLine?.costCenterId ?? null,
                    fixedAssetClassId: null,
                  });
                }
              }
            }

            const shipmentLinesBySalesOrderLineId = shipmentLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["shipmentLine"]["Row"][]
              >
            >((acc, shipmentLine) => {
              if (shipmentLine.lineId) {
                acc[shipmentLine.lineId] = [
                  ...(acc[shipmentLine.lineId] ?? []),
                  shipmentLine,
                ];
              }
              return acc;
            }, {});

            const salesOrderLineUpdates = salesOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["salesOrderLine"]["Update"]
              >
            >((acc, salesOrderLine) => {
              const shipmentLines =
                shipmentLinesBySalesOrderLineId[salesOrderLine.id];
              if (
                shipmentLines &&
                shipmentLines.length > 0 &&
                salesOrderLine.saleQuantity &&
                salesOrderLine.saleQuantity > 0
              ) {
                const shippedQuantity = shipmentLines.reduce(
                  (acc, shipmentLine) => {
                    const safeShippedQuantity =
                      isNaN(shipmentLine.shippedQuantity) ||
                      shipmentLine.shippedQuantity == null
                        ? 0
                        : shipmentLine.shippedQuantity;
                    return acc + safeShippedQuantity;
                  },
                  0
                );

                const newQuantitySent =
                  (salesOrderLine.quantitySent ?? 0) + shippedQuantity;

                const sentComplete =
                  salesOrderLine.sentComplete ||
                  newQuantitySent >= salesOrderLine.saleQuantity;

                const updates: Record<
                  string,
                  Database["public"]["Tables"]["salesOrderLine"]["Update"]
                > = {
                  ...acc,
                  [salesOrderLine.id]: {
                    quantitySent: newQuantitySent,
                    sentComplete,
                  },
                };

                if (sentComplete && !salesOrderLine.sentDate) {
                  updates[salesOrderLine.id].sentDate = today;
                }

                return updates;
              }

              return acc;
            }, {});

            // Process Fixed Asset SO lines (no shipment lines — handled directly from SO)
            const { data: shipmentFaLines } = await client
              .from("shipmentFixedAssetLine")
              .select("salesOrderLineId, serialNumber")
              .eq("shipmentId", shipmentId)
              .eq("shipped", true);
            const shippedFaSoLineIds = new Set(
              (shipmentFaLines ?? []).map((r) => r.salesOrderLineId)
            );

            const faSalesOrderLines = salesOrderLines.data.filter(
              (sol) =>
                sol.salesOrderLineType === "Fixed Asset" &&
                sol.assetId &&
                !sol.sentComplete &&
                sol.saleQuantity &&
                sol.saleQuantity > 0 &&
                shippedFaSoLineIds.has(sol.id)
            );

            for (const faSoLine of faSalesOrderLines) {
              if (accountingEnabled && accountDefaults?.data) {
                const assetRecord = await client
                  .from("fixedAsset")
                  .select(
                    "id, status, acquisitionCost, accumulatedDepreciation, locationId, fixedAssetClassId, fixedAssetClass:fixedAssetClassId(assetAccountId, accumulatedDepreciationAccountId, writeOffAccountId)"
                  )
                  .eq("id", faSoLine.assetId!)
                  .single();

                if (assetRecord.error)
                  throw new Error("Failed to fetch fixed asset for disposal");

                const assetClass = assetRecord.data.fixedAssetClass as any;
                const acquisitionCost =
                  Number(assetRecord.data.acquisitionCost) ?? 0;
                const accumulatedDepreciation =
                  Number(assetRecord.data.accumulatedDepreciation) ?? 0;
                const nbv = acquisitionCost - accumulatedDepreciation;

                if (accumulatedDepreciation > 0) {
                  const jlRef = nanoid();
                  journalLineInserts.push({
                    accountId: assetClass.accumulatedDepreciationAccountId,
                    description: "Clear accumulated depreciation",
                    amount: debit("asset", accumulatedDepreciation),
                    quantity: 1,
                    documentType: "Sales Shipment",
                    documentId: shipment.data?.id,
                    externalDocumentId:
                      salesOrder.data?.customerReference ?? undefined,
                    documentLineReference: journalReference.to.shipment(
                      faSoLine.id
                    ),
                    journalLineReference: jlRef,
                    companyId,
                  });

                  journalLineDimensionsMeta.push({
                    customerTypeId: customer.data.customerTypeId ?? null,
                    itemPostingGroupId: null,
                    locationId: locationId ?? assetRecord.data.locationId ?? null,
                    costCenterId: faSoLine.costCenterId ?? null,
                    fixedAssetClassId: assetRecord.data.fixedAssetClassId ?? null,
                  });
                }

                if (nbv > 0) {
                  const nbvJlRef = nanoid();
                  journalLineInserts.push({
                    accountId: assetClass.writeOffAccountId,
                    description: "Write-off remaining book value",
                    amount: debit("expense", nbv),
                    quantity: 1,
                    documentType: "Sales Shipment",
                    documentId: shipment.data?.id,
                    externalDocumentId:
                      salesOrder.data?.customerReference ?? undefined,
                    documentLineReference: journalReference.to.shipment(
                      faSoLine.id
                    ),
                    journalLineReference: nbvJlRef,
                    companyId,
                  });

                  journalLineDimensionsMeta.push({
                    customerTypeId: customer.data.customerTypeId ?? null,
                    itemPostingGroupId: null,
                    locationId: locationId ?? assetRecord.data.locationId ?? null,
                    costCenterId: faSoLine.costCenterId ?? null,
                    fixedAssetClassId: assetRecord.data.fixedAssetClassId ?? null,
                  });
                }

                const removeJlRef = nanoid();
                journalLineInserts.push({
                  accountId: assetClass.assetAccountId,
                  description: "Remove asset at cost",
                  amount: credit("asset", acquisitionCost),
                  quantity: 1,
                  documentType: "Sales Shipment",
                  documentId: shipment.data?.id,
                  externalDocumentId:
                    salesOrder.data?.customerReference ?? undefined,
                  documentLineReference: journalReference.to.shipment(
                    faSoLine.id
                  ),
                  journalLineReference: removeJlRef,
                  companyId,
                });

                journalLineDimensionsMeta.push({
                  customerTypeId: customer.data.customerTypeId ?? null,
                  itemPostingGroupId: null,
                  locationId: locationId ?? assetRecord.data.locationId ?? null,
                  costCenterId: faSoLine.costCenterId ?? null,
                  fixedAssetClassId: assetRecord.data.fixedAssetClassId ?? null,
                });

                await client
                  .from("fixedAsset")
                  .update({
                    status: "Disposed",
                    disposalDate: today,
                    disposalMethod: "Sale",
                    updatedBy: userId,
                  })
                  .eq("id", faSoLine.assetId!);

                await client.from("fixedAssetDisposal").insert({
                  fixedAssetId: faSoLine.assetId!,
                  disposalMethod: "Sale",
                  disposalDate: today,
                  saleProceeds: 0,
                  netBookValueAtDisposal: nbv,
                  gainLoss: -nbv,
                  companyId,
                  createdBy: userId,
                });
              }

              salesOrderLineUpdates[faSoLine.id] = {
                quantitySent: faSoLine.saleQuantity,
                sentComplete: true,
                sentDate: today,
              };
            }

            const trackedEntitySplits: Record<
              string,
              {
                originalEntityId: string;
                originalQuantity: number;
                shippedQuantity: number;
                remainingQuantity: number;
                readableId: string | null;
                attributes: TrackedEntityAttributes;
                sourceDocument: string;
                sourceDocumentId: string;
                sourceDocumentReadableId: string | null;
                companyId: string;
                itemId: string | null;
                expirationDate: string | null;
              }
            > = {};

            const trackedEntityUpdates =
              shipmentLineTracking.data?.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["trackedEntity"]["Update"]
                >
              >((acc, trackedEntity) => {
                const shipmentLine = shipmentLines.data?.find(
                  (shipmentLine) =>
                    shipmentLine.id ===
                    (trackedEntity.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                );

                if (
                  shipmentLine?.shippedQuantity !== undefined &&
                  trackedEntity.quantity !== undefined &&
                  shipmentLine.shippedQuantity < trackedEntity.quantity
                ) {
                  // Need to split the batch
                  trackedEntitySplits[trackedEntity.id] = {
                    originalEntityId: trackedEntity.id,
                    originalQuantity: trackedEntity.quantity,
                    shippedQuantity: shipmentLine.shippedQuantity,
                    remainingQuantity:
                      trackedEntity.quantity - shipmentLine.shippedQuantity,
                    readableId: trackedEntity.readableId,
                    attributes:
                      trackedEntity.attributes as TrackedEntityAttributes,
                    sourceDocument: trackedEntity.sourceDocument,
                    sourceDocumentId: trackedEntity.sourceDocumentId,
                    sourceDocumentReadableId:
                      trackedEntity.sourceDocumentReadableId,
                    companyId: trackedEntity.companyId,
                    itemId: trackedEntity.itemId ?? null,
                    expirationDate: trackedEntity.expirationDate ?? null,
                  };
                }

                acc[trackedEntity.id] = {
                  status: "Consumed",
                  quantity:
                    shipmentLine?.shippedQuantity ?? trackedEntity.quantity,
                };

                return acc;
              }, {}) ?? {};

            // Resolve accounting period BEFORE opening the Kysely transaction.
            // getCurrentAccountingPeriod uses the Supabase REST client; calling
            // it mid-transaction parks the pg connection in idle-in-transaction
            // (ClientRead) while the REST hop runs, and any hang there leaves
            // an orphan that exhausts the pool (size 1) for every subsequent
            // post-shipment invocation.
            const accountingPeriodId = await getCurrentAccountingPeriod(
              client,
              companyId,
              db
            );

            await db.transaction().execute(async (trx) => {
              for await (const [salesOrderLineId, update] of Object.entries(
                salesOrderLineUpdates
              )) {
                await trx
                  .updateTable("salesOrderLine")
                  .set(update)
                  .where("id", "=", salesOrderLineId)
                  .execute();
              }

              const salesOrderLines = await trx
                .selectFrom("salesOrderLine")
                .select([
                  "id",
                  "salesOrderLineType",
                  "invoicedComplete",
                  "sentComplete",
                ])
                .where("salesOrderId", "=", salesOrder.data.id)
                .execute();

              const areAllLinesInvoiced = salesOrderLines.every(
                (line) =>
                  line.salesOrderLineType === "Comment" || line.invoicedComplete
              );

              const areAllLinesShipped = salesOrderLines.every(
                (line) =>
                  line.salesOrderLineType === "Comment" || line.sentComplete
              );

              let status: Database["public"]["Tables"]["salesOrder"]["Row"]["status"] =
                "To Ship and Invoice";
              if (areAllLinesInvoiced && areAllLinesShipped) {
                status = "Completed";
              } else if (areAllLinesShipped) {
                status = "To Invoice";
              } else if (areAllLinesInvoiced) {
                status = "To Ship";
              }

              await trx
                .updateTable("salesOrder")
                .set({
                  status,
                })
                .where("id", "=", salesOrder.data.id)
                .execute();

              await trx
                .updateTable("shipment")
                .set({
                  status: "Posted",
                  postingDate: today,
                  postedBy: userId,
                })
                .where("id", "=", shipmentId)
                .execute();

              if (Object.keys(trackedEntityUpdates).length > 0) {
                const trackedActivity = await trx
                  .insertInto("trackedActivity")
                  .values({
                    type: "Shipment",
                    sourceDocument: "Shipment",
                    sourceDocumentId: shipmentId,
                    sourceDocumentReadableId: shipment.data.shipmentId,
                    attributes: {
                      Shipment: shipmentId,
                      "Sales Order": salesOrder.data.id,
                    },
                    companyId,
                    createdBy: userId,
                    createdAt: today,
                  })
                  .returning(["id"])
                  .execute();

                const trackedActivityId = trackedActivity[0].id;

                // Handle batch splits first
                for await (const splitInfo of Object.values(
                  trackedEntitySplits
                )) {
                  // Create a split activity
                  const splitActivity = await trx
                    .insertInto("trackedActivity")
                    .values({
                      type: "Split",
                      sourceDocument: "Shipment",
                      sourceDocumentId: shipmentId,
                      sourceDocumentReadableId: shipment.data.shipmentId,
                      attributes: {
                        "Original Quantity": splitInfo.originalQuantity,
                        "Shipped Quantity": splitInfo.shippedQuantity,
                        "Remaining Quantity": splitInfo.remainingQuantity,
                      },
                      companyId: splitInfo.companyId,
                      createdBy: userId,
                      createdAt: today,
                    })
                    .returning(["id"])
                    .execute();

                  const splitActivityId = splitActivity[0].id!;

                  // Record the original entity as input to the split
                  await trx
                    .insertInto("trackedActivityInput")
                    .values({
                      trackedActivityId: splitActivityId,
                      trackedEntityId: splitInfo.originalEntityId,
                      quantity: splitInfo.originalQuantity,
                      companyId: splitInfo.companyId,
                      createdBy: userId,
                      createdAt: today,
                    })
                    .execute();

                  // Create a new tracked entity for the remaining quantity
                  const newTrackedEntity = await trx
                    .insertInto("trackedEntity")
                    .values({
                      readableId: splitInfo.readableId,
                      quantity: splitInfo.remainingQuantity,
                      status: "Available",
                      sourceDocument: splitInfo.sourceDocument,
                      sourceDocumentId: splitInfo.sourceDocumentId,
                      sourceDocumentReadableId:
                        splitInfo.sourceDocumentReadableId,
                      attributes: splitInfo.attributes as unknown as Json,
                      itemId: splitInfo.itemId,
                      expirationDate: splitInfo.expirationDate,
                      companyId: splitInfo.companyId,
                      createdBy: userId,
                      createdAt: today,
                    })
                    .returning(["id"])
                    .execute();

                  const newTrackedEntityId = newTrackedEntity[0].id!;
                  splitEntityIds.push(newTrackedEntityId);

                  // Update the original entity's attributes to include the split entity ID
                  const originalEntity = await trx
                    .selectFrom("trackedEntity")
                    .select(["attributes"])
                    .where("id", "=", splitInfo.originalEntityId)
                    .executeTakeFirst();

                  if (originalEntity) {
                    const updatedAttributes = {
                      ...((originalEntity.attributes as TrackedEntityAttributes) ||
                        {}),
                      "Split Entity ID": newTrackedEntityId,
                    };

                    // Remove Shipment and Shipment Line attributes from the new entity
                    const updatedAttributesObj = {
                      ...((originalEntity.attributes as TrackedEntityAttributes) ||
                        {}),
                    };

                    // Delete shipment-related attributes
                    delete updatedAttributesObj["Shipment"];
                    delete updatedAttributesObj["Shipment Line"];
                    delete updatedAttributesObj["Shipment Line Index"];

                    // Add the split entity reference
                    updatedAttributesObj["Split Entity ID"] =
                      newTrackedEntityId;

                    // Update the original entity with the reference to the new split entity
                    await trx
                      .updateTable("trackedEntity")
                      .set({
                        attributes: updatedAttributes,
                      })
                      .where("id", "=", splitInfo.originalEntityId)
                      .execute();
                  }

                  // Record the new entity as output from the split
                  await trx
                    .insertInto("trackedActivityOutput")
                    .values({
                      trackedActivityId: splitActivityId,
                      trackedEntityId: newTrackedEntityId,
                      quantity: splitInfo.remainingQuantity,
                      companyId: splitInfo.companyId,
                      createdBy: userId,
                      createdAt: today,
                    })
                    .execute();

                  // Record the shipped portion as output (will be consumed by shipment)
                  await trx
                    .insertInto("trackedActivityOutput")
                    .values({
                      trackedActivityId: splitActivityId,
                      trackedEntityId: splitInfo.originalEntityId,
                      quantity: splitInfo.shippedQuantity,
                      companyId: splitInfo.companyId,
                      createdBy: userId,
                      createdAt: today,
                    })
                    .execute();

                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLines.data.find(
                      (sl) =>
                        sl.id ===
                        (splitInfo.attributes as TrackedEntityAttributes)?.[
                          "Shipment Line"
                        ]
                    )?.itemId!,
                    quantity: -splitInfo.originalQuantity,
                    locationId: locationId,
                    storageUnitId: shipmentLines.data.find(
                      (sl) =>
                        sl.id ===
                        (splitInfo.attributes as TrackedEntityAttributes)?.[
                          "Shipment Line"
                        ]
                    )?.storageUnitId,
                    entryType: "Negative Adjmt.",
                    documentType: "Batch Split",
                    documentId: splitActivityId,
                    trackedEntityId: splitInfo.originalEntityId,
                    createdBy: userId,
                    companyId,
                  });

                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLines.data.find(
                      (sl) =>
                        sl.id ===
                        (splitInfo.attributes as TrackedEntityAttributes)?.[
                          "Shipment Line"
                        ]
                    )?.itemId!,
                    quantity: splitInfo.shippedQuantity,
                    locationId: locationId,
                    storageUnitId: shipmentLines.data.find(
                      (sl) =>
                        sl.id ===
                        (splitInfo.attributes as TrackedEntityAttributes)?.[
                          "Shipment Line"
                        ]
                    )?.storageUnitId,
                    entryType: "Positive Adjmt.",
                    documentType: "Batch Split",
                    documentId: splitActivityId,
                    trackedEntityId: splitInfo.originalEntityId,
                    createdBy: userId,
                    companyId,
                  });

                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLines.data.find(
                      (sl) =>
                        sl.id ===
                        (splitInfo.attributes as TrackedEntityAttributes)?.[
                          "Shipment Line"
                        ]
                    )?.itemId!,
                    quantity: splitInfo.remainingQuantity,
                    locationId: locationId,
                    storageUnitId: shipmentLines.data.find(
                      (sl) =>
                        sl.id ===
                        (splitInfo.attributes as TrackedEntityAttributes)?.[
                          "Shipment Line"
                        ]
                    )?.storageUnitId,
                    entryType: "Positive Adjmt.",
                    documentType: "Batch Split",
                    documentId: splitActivityId,
                    trackedEntityId: newTrackedEntityId,
                    createdBy: userId,
                    companyId,
                  });
                }

                // Now handle the shipment consumption
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
                      .insertInto("trackedActivityInput")
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

              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .returning(["id"])
                  .execute();
              }

              if (Object.keys(jobUpdates).length > 0) {
                console.log("Final job updates to be applied:", jobUpdates);
                for await (const [jobId, update] of Object.entries(
                  jobUpdates
                )) {
                  console.log(`Updating job ${jobId} with:`, update);
                  await trx
                    .updateTable("job")
                    .set(update)
                    .where("id", "=", jobId)
                    .execute();
                }
              }

              // Calculate COGS and create journal entries
              if (accountingEnabled && journalLineInserts.length > 0) {
                const itemShipmentQuantities = new Map<
                  string,
                  { totalQuantity: number; lineIndices: number[] }
                >();

                for (let i = 0; i < journalLineInserts.length; i += 2) {
                  const jl = journalLineInserts[i];
                  const ref = jl.documentLineReference;
                  const shipmentLine = shipmentLines.data.find(
                    (sl) => ref === journalReference.to.shipment(sl.id)
                  );
                  if (!shipmentLine?.itemId) continue;

                  const existing = itemShipmentQuantities.get(shipmentLine.itemId);
                  if (existing) {
                    existing.totalQuantity += jl.quantity ?? 0;
                    existing.lineIndices.push(i);
                  } else {
                    itemShipmentQuantities.set(shipmentLine.itemId, {
                      totalQuantity: jl.quantity ?? 0,
                      lineIndices: [i],
                    });
                  }
                }

                for (const [itemId, info] of itemShipmentQuantities) {
                  const cogsResult = await calculateCOGS(trx, {
                    itemId,
                    quantity: info.totalQuantity,
                    companyId,
                  });

                  let costAssigned = 0;
                  for (let idx = 0; idx < info.lineIndices.length; idx++) {
                    const jlIdx = info.lineIndices[idx];
                    const lineQty = journalLineInserts[jlIdx].quantity ?? 0;
                    const lineCost =
                      idx === info.lineIndices.length - 1
                        ? cogsResult.totalCost - costAssigned
                        : (lineQty / info.totalQuantity) * cogsResult.totalCost;

                    costAssigned += lineCost;
                    journalLineInserts[jlIdx].amount = debit("expense", lineCost);
                    journalLineInserts[jlIdx + 1].amount = credit("asset", lineCost);
                  }

                  await trx
                    .insertInto("costLedger")
                    .values({
                      itemLedgerType: "Sale",
                      costLedgerType: "Direct Cost",
                      adjustment: false,
                      documentType: "Sales Shipment",
                      documentId: shipment.data?.id ?? "",
                      itemId,
                      quantity: -info.totalQuantity,
                      cost: -cogsResult.totalCost,
                      remainingQuantity: 0,
                      companyId,
                    })
                    .execute();
                }

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
                    description: `Sales Shipment ${shipment.data.shipmentId}`,
                    postingDate: today,
                    companyId,
                    sourceType: "Sales Shipment",
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

                    if (meta.customerTypeId && dimensionMap.has("CustomerType")) {
                      journalLineDimensionInserts.push({
                        journalLineId: jl.id,
                        dimensionId: dimensionMap.get("CustomerType")!,
                        valueId: meta.customerTypeId,
                        companyId,
                      });
                    }
                    if (meta.itemPostingGroupId && dimensionMap.has("ItemPostingGroup")) {
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
                    if (meta.costCenterId && dimensionMap.has("CostCenter")) {
                      journalLineDimensionInserts.push({
                        journalLineId: jl.id,
                        dimensionId: dimensionMap.get("CostCenter")!,
                        valueId: meta.costCenterId,
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
            });
            break;
          }
          case "Purchase Order": {
            if (!shipment.data.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [purchaseOrder, purchaseOrderLines] = await Promise.all([
              client
                .from("purchaseOrder")
                .select("*")
                .eq("id", shipment.data.sourceDocumentId)
                .single(),
              client
                .from("purchaseOrderLine")
                .select("*")
                .eq("purchaseOrderId", shipment.data.sourceDocumentId),
            ]);
            if (purchaseOrder.error)
              throw new Error("Failed to fetch purchase order");
            if (purchaseOrderLines.error)
              throw new Error("Failed to fetch purchase order lines");

            const supplier = await client
              .from("supplier")
              .select("*")
              .eq("id", purchaseOrder.data.supplierId)
              .eq("companyId", companyId)
              .single();
            if (supplier.error) throw new Error("Failed to fetch supplier");

            const jobOperationsUpdates: Record<
              string,
              Database["public"]["Tables"]["jobOperation"]["Update"]
            > = {};

            for await (const shipmentLine of shipmentLines.data) {
              const purchaseOrderLine = purchaseOrderLines.data.find(
                (pol) => pol.id === shipmentLine.lineId
              );

              if (
                purchaseOrderLine?.jobId &&
                purchaseOrderLine.jobOperationId
              ) {
                // Update quantity shipped on job, accumulating totals from multiple shipments
                const jobOperationId = purchaseOrderLine.jobOperationId;

                jobOperationsUpdates[jobOperationId] = {
                  status: "In Progress",
                };
                continue;
              }
            }

            const shipmentLinesByPurchaseOrderLineId =
              shipmentLines.data.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["shipmentLine"]["Row"][]
                >
              >((acc, shipmentLine) => {
                if (shipmentLine.lineId) {
                  acc[shipmentLine.lineId] = [
                    ...(acc[shipmentLine.lineId] ?? []),
                    shipmentLine,
                  ];
                }
                return acc;
              }, {});

            const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
              >
            >((acc, purchaseOrderLine) => {
              const shipmentLines =
                shipmentLinesByPurchaseOrderLineId[purchaseOrderLine.id];
              if (
                shipmentLines &&
                shipmentLines.length > 0 &&
                purchaseOrderLine.purchaseQuantity &&
                purchaseOrderLine.purchaseQuantity > 0
              ) {
                const shippedQuantity = shipmentLines.reduce(
                  (acc, shipmentLine) => {
                    const safeShippedQuantity =
                      isNaN(shipmentLine.shippedQuantity) ||
                      shipmentLine.shippedQuantity == null
                        ? 0
                        : shipmentLine.shippedQuantity;
                    return acc + safeShippedQuantity;
                  },
                  0
                );

                const newQuantityShipped =
                  (purchaseOrderLine.quantityShipped ?? 0) + shippedQuantity;

                const updates: Record<
                  string,
                  Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
                > = {
                  ...acc,
                  [purchaseOrderLine.id]: {
                    quantityShipped: newQuantityShipped,
                  },
                };

                return updates;
              }

              return acc;
            }, {});

            const trackedEntitySplits: Record<
              string,
              {
                originalEntityId: string;
                originalQuantity: number;
                shippedQuantity: number;
                remainingQuantity: number;
                readableId: string | null;
                attributes: TrackedEntityAttributes;
                sourceDocument: string;
                sourceDocumentId: string;
                sourceDocumentReadableId: string | null;
                companyId: string;
                itemId: string | null;
                expirationDate: string | null;
              }
            > = {};

            const trackedEntityUpdates =
              shipmentLineTracking.data?.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["trackedEntity"]["Update"]
                >
              >((acc, trackedEntity) => {
                const shipmentLine = shipmentLines.data?.find(
                  (shipmentLine) =>
                    shipmentLine.id ===
                    (trackedEntity.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                );

                if (
                  shipmentLine?.shippedQuantity !== undefined &&
                  trackedEntity.quantity !== undefined &&
                  shipmentLine.shippedQuantity < trackedEntity.quantity
                ) {
                  // Need to split the batch
                  trackedEntitySplits[trackedEntity.id] = {
                    originalEntityId: trackedEntity.id,
                    originalQuantity: trackedEntity.quantity,
                    shippedQuantity: shipmentLine.shippedQuantity,
                    remainingQuantity:
                      trackedEntity.quantity - shipmentLine.shippedQuantity,
                    readableId: trackedEntity.readableId,
                    attributes:
                      trackedEntity.attributes as TrackedEntityAttributes,
                    sourceDocument: trackedEntity.sourceDocument,
                    sourceDocumentId: trackedEntity.sourceDocumentId,
                    sourceDocumentReadableId:
                      trackedEntity.sourceDocumentReadableId,
                    companyId: trackedEntity.companyId,
                    itemId: trackedEntity.itemId ?? null,
                    expirationDate: trackedEntity.expirationDate ?? null,
                  };
                }

                acc[trackedEntity.id] = {
                  quantity:
                    shipmentLine?.shippedQuantity ?? trackedEntity.quantity,
                };

                return acc;
              }, {}) ?? {};

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

              await trx
                .updateTable("shipment")
                .set({
                  status: "Posted",
                  postingDate: today,
                  postedBy: userId,
                })
                .where("id", "=", shipmentId)
                .execute();

              if (Object.keys(trackedEntityUpdates).length > 0) {
                const trackedActivity = await trx
                  .insertInto("trackedActivity")
                  .values({
                    type: "Shipment",
                    sourceDocument: "Shipment",
                    sourceDocumentId: shipmentId,
                    sourceDocumentReadableId: shipment.data.shipmentId,
                    attributes: {
                      Shipment: shipmentId,
                      "Purchase Order": purchaseOrder.data.id,
                    },
                    companyId,
                    createdBy: userId,
                    createdAt: today,
                  })
                  .returning(["id"])
                  .execute();

                const trackedActivityId = trackedActivity[0].id;

                // Handle batch splits first
                for await (const splitInfo of Object.values(
                  trackedEntitySplits
                )) {
                  // Create a split activity
                  const splitActivity = await trx
                    .insertInto("trackedActivity")
                    .values({
                      type: "Split",
                      sourceDocument: "Shipment",
                      sourceDocumentId: shipmentId,
                      sourceDocumentReadableId: shipment.data.shipmentId,
                      attributes: {
                        "Original Quantity": splitInfo.originalQuantity,
                        "Shipped Quantity": splitInfo.shippedQuantity,
                        "Remaining Quantity": splitInfo.remainingQuantity,
                      },
                      companyId: splitInfo.companyId,
                      createdBy: userId,
                      createdAt: today,
                    })
                    .returning(["id"])
                    .execute();

                  const splitActivityId = splitActivity[0].id!;

                  // Record the original entity as input to the split
                  await trx
                    .insertInto("trackedActivityInput")
                    .values({
                      trackedActivityId: splitActivityId,
                      trackedEntityId: splitInfo.originalEntityId,
                      quantity: splitInfo.originalQuantity,
                      companyId: splitInfo.companyId,
                      createdBy: userId,
                      createdAt: today,
                    })
                    .execute();

                  // Create a new tracked entity for the remaining quantity
                  const newTrackedEntity = await trx
                    .insertInto("trackedEntity")
                    .values({
                      readableId: splitInfo.readableId,
                      quantity: splitInfo.remainingQuantity,
                      status: "Available",
                      sourceDocument: splitInfo.sourceDocument,
                      sourceDocumentId: splitInfo.sourceDocumentId,
                      sourceDocumentReadableId:
                        splitInfo.sourceDocumentReadableId,
                      attributes: splitInfo.attributes as unknown as Json,
                      itemId: splitInfo.itemId,
                      expirationDate: splitInfo.expirationDate,
                      companyId: splitInfo.companyId,
                      createdBy: userId,
                      createdAt: today,
                    })
                    .returning(["id"])
                    .execute();

                  const newTrackedEntityId = newTrackedEntity[0].id!;
                  splitEntityIds.push(newTrackedEntityId);

                  // Update the original entity's attributes to include the split entity ID
                  const originalEntity = await trx
                    .selectFrom("trackedEntity")
                    .select(["attributes"])
                    .where("id", "=", splitInfo.originalEntityId)
                    .executeTakeFirst();

                  if (originalEntity) {
                    const updatedAttributes = {
                      ...((originalEntity.attributes as TrackedEntityAttributes) ||
                        {}),
                      "Split Entity ID": newTrackedEntityId,
                    };

                    // Remove Shipment and Shipment Line attributes from the new entity
                    const updatedAttributesObj = {
                      ...((originalEntity.attributes as TrackedEntityAttributes) ||
                        {}),
                    };

                    // Delete shipment-related attributes
                    delete updatedAttributesObj["Shipment"];
                    delete updatedAttributesObj["Shipment Line"];
                    delete updatedAttributesObj["Shipment Line Index"];

                    // Add the split entity reference
                    updatedAttributesObj["Split Entity ID"] =
                      newTrackedEntityId;

                    // Update the original entity with the reference to the new split entity
                    await trx
                      .updateTable("trackedEntity")
                      .set({
                        attributes: updatedAttributes,
                      })
                      .where("id", "=", splitInfo.originalEntityId)
                      .execute();
                  }

                  // Record the new entity as output from the split
                  await trx
                    .insertInto("trackedActivityOutput")
                    .values({
                      trackedActivityId: splitActivityId,
                      trackedEntityId: newTrackedEntityId,
                      quantity: splitInfo.remainingQuantity,
                      companyId: splitInfo.companyId,
                      createdBy: userId,
                      createdAt: today,
                    })
                    .execute();

                  // Record the shipped portion as output (will be consumed by shipment)
                  await trx
                    .insertInto("trackedActivityOutput")
                    .values({
                      trackedActivityId: splitActivityId,
                      trackedEntityId: splitInfo.originalEntityId,
                      quantity: splitInfo.shippedQuantity,
                      companyId: splitInfo.companyId,
                      createdBy: userId,
                      createdAt: today,
                    })
                    .execute();
                }

                // Now handle the shipment consumption
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
                      .insertInto("trackedActivityInput")
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

              if (Object.keys(jobOperationsUpdates).length > 0) {
                console.log(
                  "Final job updates to be applied:",
                  jobOperationsUpdates
                );
                for await (const [jobOperationId, update] of Object.entries(
                  jobOperationsUpdates
                )) {
                  console.log(
                    `Updating job operation ${jobOperationId} with:`,
                    update
                  );
                  await trx
                    .updateTable("jobOperation")
                    .set(update)
                    .where("id", "=", jobOperationId)
                    .execute();
                }
              }
            });
            break;
          }
          case "Outbound Transfer": {
            if (!shipment.data.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [warehouseTransfer, warehouseTransferLines] =
              await Promise.all([
                client
                  .from("warehouseTransfer")
                  .select("*")
                  .eq("id", shipment.data.sourceDocumentId)
                  .single(),
                client
                  .from("warehouseTransferLine")
                  .select("*")
                  .eq("transferId", shipment.data.sourceDocumentId),
              ]);

            if (warehouseTransfer.error)
              throw new Error("Failed to fetch warehouse transfer");
            if (warehouseTransferLines.error)
              throw new Error("Failed to fetch warehouse transfer lines");

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];
            const warehouseTransferLineUpdates: Record<
              string,
              Database["public"]["Tables"]["warehouseTransferLine"]["Update"]
            > = {};

            // Process each shipment line
            for await (const shipmentLine of shipmentLines.data) {
              const warehouseTransferLine = warehouseTransferLines.data.find(
                (line) => line.id === shipmentLine.lineId
              );

              if (!warehouseTransferLine) continue;

              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;

              // Update warehouse transfer line shipped quantity
              const newShippedQuantity =
                (warehouseTransferLine.shippedQuantity ?? 0) + shippedQuantity;

              warehouseTransferLineUpdates[warehouseTransferLine.id] = {
                shippedQuantity: newShippedQuantity,
              };

              // Create item ledger entry for negative adjustment at source
              if (shippedQuantity !== 0) {
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: -shippedQuantity, // Negative for outbound transfer
                  locationId: shipmentLine.locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Transfer",
                  documentType: "Transfer Shipment",
                  documentId: warehouseTransfer.data?.transferId,
                  externalDocumentId:
                    shipment.data?.externalDocumentId ?? undefined,
                  createdBy: userId,
                  companyId,
                });
              }
            }

            // Check if all lines are fully shipped
            const allLinesFullyShipped = warehouseTransferLines.data.every(
              (line) => {
                const updates = warehouseTransferLineUpdates[line.id];
                const shippedQty =
                  updates?.shippedQuantity ?? line.shippedQuantity ?? 0;
                return shippedQty >= (line.quantity ?? 0);
              }
            );

            // Check if all lines are fully received
            const allLinesFullyReceived = warehouseTransferLines.data.every(
              (line) => {
                const receivedQty = line.receivedQuantity ?? 0;
                return receivedQty >= (line.quantity ?? 0);
              }
            );

            // Determine new warehouse transfer status
            let newStatus: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"] =
              warehouseTransfer.data.status;

            if (allLinesFullyShipped && allLinesFullyReceived) {
              newStatus = "Completed";
            } else if (allLinesFullyShipped && !allLinesFullyReceived) {
              newStatus = "To Receive";
            } else if (!allLinesFullyShipped && allLinesFullyReceived) {
              newStatus = "To Ship";
            }

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
                  transferDate: today,
                  updatedBy: userId,
                })
                .where("id", "=", warehouseTransfer.data.id)
                .execute();

              // Create item ledger entries
              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .returning(["id"])
                  .execute();
              }

              // Update shipment status
              await trx
                .updateTable("shipment")
                .set({
                  status: "Posted",
                  postedBy: userId,
                })
                .where("id", "=", shipmentId)
                .execute();
            });

            break;
          }

          default: {
            throw new Error(
              `Invalid source document type: ${shipment.data.sourceDocument}`
            );
          }
        }
        break;
      }
      case "void": {
        switch (shipment.data?.sourceDocument) {
          case "Sales Order": {
            if (!shipment.data.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [
              salesOrder,
              salesOrderLines,
              originalJournalLines,
              accountingSettings,
            ] = await Promise.all([
              client
                .from("salesOrder")
                .select("*")
                .eq("id", shipment.data.sourceDocumentId)
                .single(),
              client
                .from("salesOrderLine")
                .select("*")
                .eq("salesOrderId", shipment.data.sourceDocumentId),
              client
                .from("journalLine")
                .select("*")
                .eq("documentId", shipmentId)
                .eq("documentType", "Sales Shipment")
                .eq("companyId", companyId),
              client
                .from("companySettings")
                .select("accountingEnabled")
                .eq("id", companyId)
                .single(),
            ]);
            if (salesOrder.error)
              throw new Error("Failed to fetch sales order");
            if (salesOrderLines.error)
              throw new Error("Failed to fetch sales order lines");
            if (originalJournalLines.error)
              throw new Error("Failed to fetch journal lines");

            const accountingEnabled =
              accountingSettings.data?.accountingEnabled ?? false;

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

            const customer = await client
              .from("customer")
              .select("*")
              .eq("id", salesOrder.data.customerId)
              .eq("companyId", companyId)
              .single();
            if (customer.error) throw new Error("Failed to fetch customer");

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];

            const jobUpdates: Record<
              string,
              Database["public"]["Tables"]["job"]["Update"]
            > = {};

            const locationId = shipment.data.locationId;
            for await (const shipmentLine of shipmentLines.data) {
              if (
                shipmentLine.fulfillment?.type === "Job" &&
                shipmentLine.fulfillment?.jobId
              ) {
                // Reverse job quantities for void shipment
                const jobId = shipmentLine.fulfillment.jobId;
                const currentJob = jobs.data.find((j) => j.id === jobId);

                console.log("Processing job void:", {
                  jobId,
                  currentJob: currentJob
                    ? {
                        id: currentJob.id,
                        quantity: currentJob.quantity,
                        quantityShipped: currentJob.quantityShipped,
                        quantityComplete: currentJob.quantityComplete,
                        status: currentJob.status,
                      }
                    : null,
                  shipmentLine: {
                    id: shipmentLine.id,
                    shippedQuantity: shipmentLine.shippedQuantity,
                    shippedQuantityType: typeof shipmentLine.shippedQuantity,
                  },
                });

                const currentQuantityShipped = currentJob?.quantityShipped ?? 0;

                // Ensure shippedQuantity is a valid number
                const shippedQuantity =
                  typeof shipmentLine.shippedQuantity === "number" &&
                  !isNaN(shipmentLine.shippedQuantity)
                    ? shipmentLine.shippedQuantity
                    : 0;

                console.log("Calculated values for void:", {
                  currentQuantityShipped,
                  shippedQuantity,
                  newTotal: currentQuantityShipped - shippedQuantity,
                  jobQuantity: currentJob?.quantity,
                });

                // Reduce shipped quantity (reverse of posting)
                const newQuantityShipped = Math.max(
                  0,
                  currentQuantityShipped - shippedQuantity
                );
                const newQuantityComplete = Math.max(
                  currentJob?.quantityComplete ?? 0,
                  shippedQuantity
                );

                // Update status based on new quantities
                let newStatus = currentJob?.status;
                if (
                  currentJob?.status === "Completed" &&
                  newQuantityShipped < (currentJob?.quantity ?? 0)
                ) {
                  newStatus = "In Progress";
                }

                jobUpdates[jobId] = {
                  status: newStatus,
                  quantityComplete: newQuantityComplete,
                  quantityShipped: newQuantityShipped,
                };
              }

              const itemTrackingType =
                items.data.find((item) => item.id === shipmentLine.itemId)
                  ?.itemTrackingType ?? "Inventory";

              // Default shippedQuantity to 0 if not defined or NaN
              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;

              if (itemTrackingType === "Inventory") {
                // Create positive adjustment to restore inventory
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: shippedQuantity, // Positive to restore inventory
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Positive Adjmt.",
                  documentType: "Sales Shipment",
                  documentId: shipment.data?.id ?? undefined,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId,
                });
              }

              if (shipmentLine.requiresBatchTracking) {
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: shippedQuantity, // Positive to restore inventory
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Positive Adjmt.",
                  documentType: "Sales Shipment",
                  documentId: shipment.data?.id ?? undefined,
                  trackedEntityId: shipmentLineTracking.data?.find(
                    (tracking) =>
                      (
                        tracking.attributes as
                          | TrackedEntityAttributes
                          | undefined
                      )?.["Shipment Line"] === shipmentLine.id
                  )?.id,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId,
                });
              }

              if (shipmentLine.requiresSerialTracking) {
                const lineTracking = shipmentLineTracking.data?.filter(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Shipment Line"] === shipmentLine.id
                );

                lineTracking?.forEach((tracking) => {
                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLine.itemId,
                    quantity: 1, // Positive to restore inventory
                    locationId: shipmentLine.locationId ?? locationId,
                    storageUnitId: shipmentLine.storageUnitId,
                    entryType: "Positive Adjmt.",
                    documentType: "Sales Shipment",
                    documentId: shipment.data?.id ?? undefined,
                    trackedEntityId: tracking.id,
                    externalDocumentId: undefined,
                    createdBy: userId,
                    companyId,
                  });
                });
              }
            }

            const shipmentLinesBySalesOrderLineId = shipmentLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["shipmentLine"]["Row"][]
              >
            >((acc, shipmentLine) => {
              if (shipmentLine.lineId) {
                acc[shipmentLine.lineId] = [
                  ...(acc[shipmentLine.lineId] ?? []),
                  shipmentLine,
                ];
              }
              return acc;
            }, {});

            // Reverse sales order line updates
            const salesOrderLineUpdates = salesOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["salesOrderLine"]["Update"]
              >
            >((acc, salesOrderLine) => {
              const shipmentLines =
                shipmentLinesBySalesOrderLineId[salesOrderLine.id];
              if (
                shipmentLines &&
                shipmentLines.length > 0 &&
                salesOrderLine.saleQuantity &&
                salesOrderLine.saleQuantity > 0
              ) {
                const shippedQuantity = shipmentLines.reduce(
                  (acc, shipmentLine) => {
                    const safeShippedQuantity =
                      isNaN(shipmentLine.shippedQuantity) ||
                      shipmentLine.shippedQuantity == null
                        ? 0
                        : shipmentLine.shippedQuantity;
                    return acc + safeShippedQuantity;
                  },
                  0
                );

                // Reduce shipped quantity (reverse of posting)
                const newQuantitySent = Math.max(
                  0,
                  (salesOrderLine.quantitySent ?? 0) - shippedQuantity
                );

                const sentComplete =
                  newQuantitySent >= salesOrderLine.saleQuantity;

                const updates: Record<
                  string,
                  Database["public"]["Tables"]["salesOrderLine"]["Update"]
                > = {
                  ...acc,
                  [salesOrderLine.id]: {
                    quantitySent: newQuantitySent,
                    sentComplete,
                  },
                };

                // Clear sent date if no longer complete
                if (!sentComplete && salesOrderLine.sentDate) {
                  updates[salesOrderLine.id].sentDate = null;
                }

                return updates;
              }

              return acc;
            }, {});

            // Reverse FA SO line disposals on void
            const faSoLinesForVoid = salesOrderLines.data.filter(
              (sol) =>
                sol.salesOrderLineType === "Fixed Asset" &&
                sol.assetId &&
                sol.sentComplete
            );

            for (const faSoLine of faSoLinesForVoid) {
              const hasShipmentEntries = originalJournalLines.data.some(
                (jl) =>
                  jl.documentLineReference ===
                  journalReference.to.shipment(faSoLine.id)
              );

              if (hasShipmentEntries) {
                salesOrderLineUpdates[faSoLine.id] = {
                  quantitySent: 0,
                  sentComplete: false,
                  sentDate: null,
                };

                await client
                  .from("fixedAsset")
                  .update({
                    status: "Active",
                    disposalDate: null,
                    disposalMethod: null,
                    updatedBy: userId,
                  })
                  .eq("id", faSoLine.assetId!);

                await client
                  .from("fixedAssetDisposal")
                  .delete()
                  .eq("fixedAssetId", faSoLine.assetId!)
                  .eq("companyId", companyId);
              }
            }

            // Restore tracked entities to available status
            const trackedEntityUpdates =
              shipmentLineTracking.data?.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["trackedEntity"]["Update"]
                >
              >((acc, trackedEntity) => {
                const shipmentLine = shipmentLines.data?.find(
                  (shipmentLine) =>
                    shipmentLine.id ===
                    (trackedEntity.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                );

                // Restore original quantity and set to available
                acc[trackedEntity.id] = {
                  status: "Available",
                  quantity: trackedEntity.quantity, // Restore original quantity
                };

                return acc;
              }, {}) ?? {};

            const accountingPeriodId =
              accountingEnabled && reversingJournalLines.length > 0
                ? await getCurrentAccountingPeriod(client, companyId, db)
                : null;

            await db.transaction().execute(async (trx) => {
              // Update sales order lines to reverse shipped quantities
              for await (const [salesOrderLineId, update] of Object.entries(
                salesOrderLineUpdates
              )) {
                await trx
                  .updateTable("salesOrderLine")
                  .set(update)
                  .where("id", "=", salesOrderLineId)
                  .execute();
              }

              const salesOrderLines = await trx
                .selectFrom("salesOrderLine")
                .select([
                  "id",
                  "salesOrderLineType",
                  "invoicedComplete",
                  "sentComplete",
                ])
                .where("salesOrderId", "=", salesOrder.data.id)
                .execute();

              const areAllLinesInvoiced = salesOrderLines.every(
                (line) =>
                  line.salesOrderLineType === "Comment" || line.invoicedComplete
              );

              const areAllLinesShipped = salesOrderLines.every(
                (line) =>
                  line.salesOrderLineType === "Comment" || line.sentComplete
              );

              let status: Database["public"]["Tables"]["salesOrder"]["Row"]["status"] =
                "To Ship and Invoice";
              if (areAllLinesInvoiced && areAllLinesShipped) {
                status = "Completed";
              } else if (areAllLinesShipped) {
                status = "To Invoice";
              } else if (areAllLinesInvoiced) {
                status = "To Ship";
              }

              await trx
                .updateTable("salesOrder")
                .set({
                  status,
                })
                .where("id", "=", salesOrder.data.id)
                .execute();

              // Update shipment status to Voided
              await trx
                .updateTable("shipment")
                .set({
                  status: "Voided",
                  updatedAt: today,
                  updatedBy: userId,
                })
                .where("id", "=", shipmentId)
                .execute();

              // Restore tracked entities to available status
              if (Object.keys(trackedEntityUpdates).length > 0) {
                const voidActivity = await trx
                  .insertInto("trackedActivity")
                  .values({
                    type: "Void Shipment",
                    sourceDocument: "Shipment",
                    sourceDocumentId: shipmentId,
                    sourceDocumentReadableId: shipment.data.shipmentId,
                    attributes: {
                      Shipment: shipmentId,
                      "Sales Order": salesOrder.data.id,
                    },
                    companyId,
                    createdBy: userId,
                    createdAt: today,
                  })
                  .returning(["id"])
                  .execute();

                const voidActivityId = voidActivity[0].id;

                // Restore tracked entities
                for await (const [id, update] of Object.entries(
                  trackedEntityUpdates
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

              // Create reversing item ledger entries
              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .returning(["id"])
                  .execute();
              }

              // Update jobs to reverse shipped quantities
              if (Object.keys(jobUpdates).length > 0) {
                console.log(
                  "Final job void updates to be applied:",
                  jobUpdates
                );
                for await (const [jobId, update] of Object.entries(
                  jobUpdates
                )) {
                  console.log(`Voiding job ${jobId} with:`, update);
                  await trx
                    .updateTable("job")
                    .set(update)
                    .where("id", "=", jobId)
                    .execute();
                }
              }

              // Create reversing journal entries
              if (
                accountingEnabled &&
                reversingJournalLines.length > 0 &&
                accountingPeriodId
              ) {
                const voidJournalEntryId = await getNextSequence(
                  trx,
                  "journalEntry",
                  companyId
                );

                const voidJournalResult = await trx
                  .insertInto("journal")
                  .values({
                    journalEntryId: voidJournalEntryId,
                    accountingPeriodId,
                    description: `VOID: Sales Shipment ${shipment.data.shipmentId}`,
                    postingDate: today,
                    companyId,
                    sourceType: "Sales Shipment",
                    status: "Posted",
                    postedAt: new Date().toISOString(),
                    postedBy: userId,
                    createdBy: userId,
                  })
                  .returning(["id"])
                  .executeTakeFirstOrThrow();

                await trx
                  .insertInto("journalLine")
                  .values(
                    reversingJournalLines.map((line) => ({
                      ...line,
                      journalId: voidJournalResult.id,
                    }))
                  )
                  .execute();
              }
            });
            break;
          }
          case "Purchase Order": {
            if (!shipment.data.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [purchaseOrder, purchaseOrderLines] = await Promise.all([
              client
                .from("purchaseOrder")
                .select("*")
                .eq("id", shipment.data.sourceDocumentId)
                .single(),
              client
                .from("purchaseOrderLine")
                .select("*")
                .eq("purchaseOrderId", shipment.data.sourceDocumentId),
            ]);
            if (purchaseOrder.error)
              throw new Error("Failed to fetch purchase order");
            if (purchaseOrderLines.error)
              throw new Error("Failed to fetch purchase order lines");

            const supplier = await client
              .from("supplier")
              .select("*")
              .eq("id", purchaseOrder.data.supplierId)
              .eq("companyId", companyId)
              .single();
            if (supplier.error) throw new Error("Failed to fetch supplier");

            const jobOperationsUpdates: Record<
              string,
              Database["public"]["Tables"]["jobOperation"]["Update"]
            > = {};

            for await (const shipmentLine of shipmentLines.data) {
              const purchaseOrderLine = purchaseOrderLines.data.find(
                (pol) => pol.id === shipmentLine.lineId
              );

              if (
                purchaseOrderLine?.jobId &&
                purchaseOrderLine.jobOperationId
              ) {
                // Reset job operation status when voiding
                const jobOperationId = purchaseOrderLine.jobOperationId;

                jobOperationsUpdates[jobOperationId] = {
                  status: "Ready",
                };
                continue;
              }
            }

            const shipmentLinesByPurchaseOrderLineId =
              shipmentLines.data.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["shipmentLine"]["Row"][]
                >
              >((acc, shipmentLine) => {
                if (shipmentLine.lineId) {
                  acc[shipmentLine.lineId] = [
                    ...(acc[shipmentLine.lineId] ?? []),
                    shipmentLine,
                  ];
                }
                return acc;
              }, {});

            // Reverse purchase order line updates
            const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
              Record<
                string,
                Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
              >
            >((acc, purchaseOrderLine) => {
              const shipmentLines =
                shipmentLinesByPurchaseOrderLineId[purchaseOrderLine.id];
              if (
                shipmentLines &&
                shipmentLines.length > 0 &&
                purchaseOrderLine.purchaseQuantity &&
                purchaseOrderLine.purchaseQuantity > 0
              ) {
                const shippedQuantity = shipmentLines.reduce(
                  (acc, shipmentLine) => {
                    const safeShippedQuantity =
                      isNaN(shipmentLine.shippedQuantity) ||
                      shipmentLine.shippedQuantity == null
                        ? 0
                        : shipmentLine.shippedQuantity;
                    return acc + safeShippedQuantity;
                  },
                  0
                );

                // Reduce shipped quantity (reverse of posting)
                const newQuantityShipped = Math.max(
                  0,
                  (purchaseOrderLine.quantityShipped ?? 0) - shippedQuantity
                );

                const updates: Record<
                  string,
                  Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
                > = {
                  ...acc,
                  [purchaseOrderLine.id]: {
                    quantityShipped: newQuantityShipped,
                  },
                };

                return updates;
              }

              return acc;
            }, {});

            // Restore tracked entities to available status
            const trackedEntityUpdates =
              shipmentLineTracking.data?.reduce<
                Record<
                  string,
                  Database["public"]["Tables"]["trackedEntity"]["Update"]
                >
              >((acc, trackedEntity) => {
                // Restore original quantity and set to available
                acc[trackedEntity.id] = {
                  status: "Available",
                  quantity: trackedEntity.quantity,
                };

                return acc;
              }, {}) ?? {};

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];
            const locationId = shipment.data.locationId;

            // Create reversing item ledger entries for purchase order void
            for await (const shipmentLine of shipmentLines.data) {
              const itemTrackingType =
                items.data.find((item) => item.id === shipmentLine.itemId)
                  ?.itemTrackingType ?? "Inventory";

              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;

              if (itemTrackingType === "Inventory" && shippedQuantity !== 0) {
                // Create negative adjustment to remove inventory that was added during posting
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: -shippedQuantity, // Negative to remove inventory
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Negative Adjmt.",
                  documentType: "Purchase Receipt",
                  documentId: shipment.data?.id ?? undefined,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId,
                });
              }

              if (shipmentLine.requiresBatchTracking) {
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: -shippedQuantity, // Negative to remove inventory
                  locationId: shipmentLine.locationId ?? locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Negative Adjmt.",
                  documentType: "Purchase Receipt",
                  documentId: shipment.data?.id ?? undefined,
                  trackedEntityId: shipmentLineTracking.data?.find(
                    (tracking) =>
                      (
                        tracking.attributes as
                          | TrackedEntityAttributes
                          | undefined
                      )?.["Shipment Line"] === shipmentLine.id
                  )?.id,
                  externalDocumentId: undefined,
                  createdBy: userId,
                  companyId,
                });
              }

              if (shipmentLine.requiresSerialTracking) {
                const lineTracking = shipmentLineTracking.data?.filter(
                  (tracking) =>
                    (
                      tracking.attributes as TrackedEntityAttributes | undefined
                    )?.["Shipment Line"] === shipmentLine.id
                );

                lineTracking?.forEach((tracking) => {
                  itemLedgerInserts.push({
                    postingDate: today,
                    itemId: shipmentLine.itemId,
                    quantity: -1, // Negative to remove inventory
                    locationId: shipmentLine.locationId ?? locationId,
                    storageUnitId: shipmentLine.storageUnitId,
                    entryType: "Negative Adjmt.",
                    documentType: "Purchase Receipt",
                    documentId: shipment.data?.id ?? undefined,
                    trackedEntityId: tracking.id,
                    externalDocumentId: undefined,
                    createdBy: userId,
                    companyId,
                  });
                });
              }
            }

            await db.transaction().execute(async (trx) => {
              // Update purchase order lines to reverse shipped quantities
              for await (const [purchaseOrderLineId, update] of Object.entries(
                purchaseOrderLineUpdates
              )) {
                await trx
                  .updateTable("purchaseOrderLine")
                  .set(update)
                  .where("id", "=", purchaseOrderLineId)
                  .execute();
              }

              // Create reversing item ledger entries
              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .returning(["id"])
                  .execute();
              }

              // Update shipment status to Voided
              await trx
                .updateTable("shipment")
                .set({
                  status: "Voided",
                  updatedAt: today,
                  updatedBy: userId,
                })
                .where("id", "=", shipmentId)
                .execute();

              // Restore tracked entities
              if (Object.keys(trackedEntityUpdates).length > 0) {
                const voidActivity = await trx
                  .insertInto("trackedActivity")
                  .values({
                    type: "Void Shipment",
                    sourceDocument: "Shipment",
                    sourceDocumentId: shipmentId,
                    sourceDocumentReadableId: shipment.data.shipmentId,
                    attributes: {
                      Shipment: shipmentId,
                      "Purchase Order": purchaseOrder.data.id,
                    },
                    companyId,
                    createdBy: userId,
                    createdAt: today,
                  })
                  .returning(["id"])
                  .execute();

                const voidActivityId = voidActivity[0].id;

                // Restore tracked entities
                for await (const [id, update] of Object.entries(
                  trackedEntityUpdates
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

              // Update job operations to reset status
              if (Object.keys(jobOperationsUpdates).length > 0) {
                console.log(
                  "Final job operation void updates to be applied:",
                  jobOperationsUpdates
                );
                for await (const [jobOperationId, update] of Object.entries(
                  jobOperationsUpdates
                )) {
                  console.log(
                    `Voiding job operation ${jobOperationId} with:`,
                    update
                  );
                  await trx
                    .updateTable("jobOperation")
                    .set(update)
                    .where("id", "=", jobOperationId)
                    .execute();
                }
              }
            });
            break;
          }
          case "Outbound Transfer": {
            if (!shipment.data.sourceDocumentId)
              throw new Error("Shipment has no sourceDocumentId");

            const [warehouseTransfer, warehouseTransferLines] =
              await Promise.all([
                client
                  .from("warehouseTransfer")
                  .select("*")
                  .eq("id", shipment.data.sourceDocumentId)
                  .single(),
                client
                  .from("warehouseTransferLine")
                  .select("*")
                  .eq("transferId", shipment.data.sourceDocumentId),
              ]);

            if (warehouseTransfer.error)
              throw new Error("Failed to fetch warehouse transfer");
            if (warehouseTransferLines.error)
              throw new Error("Failed to fetch warehouse transfer lines");

            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];
            const warehouseTransferLineUpdates: Record<
              string,
              Database["public"]["Tables"]["warehouseTransferLine"]["Update"]
            > = {};

            // Process each shipment line
            for await (const shipmentLine of shipmentLines.data) {
              const warehouseTransferLine = warehouseTransferLines.data.find(
                (line) => line.id === shipmentLine.lineId
              );

              if (!warehouseTransferLine) continue;

              const shippedQuantity =
                isNaN(shipmentLine.shippedQuantity) ||
                shipmentLine.shippedQuantity == null
                  ? 0
                  : shipmentLine.shippedQuantity;

              // Reverse warehouse transfer line shipped quantity
              const newShippedQuantity = Math.max(
                0,
                (warehouseTransferLine.shippedQuantity ?? 0) - shippedQuantity
              );

              warehouseTransferLineUpdates[warehouseTransferLine.id] = {
                shippedQuantity: newShippedQuantity,
              };

              // Create item ledger entry to restore inventory at source
              if (shippedQuantity !== 0) {
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: shipmentLine.itemId,
                  quantity: shippedQuantity, // Positive to restore inventory
                  locationId: shipmentLine.locationId,
                  storageUnitId: shipmentLine.storageUnitId,
                  entryType: "Transfer",
                  documentType: "Transfer Shipment",
                  documentId: warehouseTransfer.data?.transferId,
                  externalDocumentId:
                    shipment.data?.externalDocumentId ?? undefined,
                  createdBy: userId,
                  companyId,
                });
              }
            }

            // Check if all lines are fully shipped after void
            const allLinesFullyShipped = warehouseTransferLines.data.every(
              (line) => {
                const updates = warehouseTransferLineUpdates[line.id];
                const shippedQty =
                  updates?.shippedQuantity ?? line.shippedQuantity ?? 0;
                return shippedQty >= (line.quantity ?? 0);
              }
            );

            // Check if all lines are fully received
            const allLinesFullyReceived = warehouseTransferLines.data.every(
              (line) => {
                const receivedQty = line.receivedQuantity ?? 0;
                return receivedQty >= (line.quantity ?? 0);
              }
            );

            // Determine new warehouse transfer status
            let newStatus: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"] =
              warehouseTransfer.data.status;

            if (allLinesFullyShipped && allLinesFullyReceived) {
              newStatus = "Completed";
            } else if (allLinesFullyShipped && !allLinesFullyReceived) {
              newStatus = "To Receive";
            } else if (!allLinesFullyShipped && allLinesFullyReceived) {
              newStatus = "To Ship";
            } else {
              newStatus = "Draft";
            }

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

              // Create reversing item ledger entries
              if (itemLedgerInserts.length > 0) {
                await trx
                  .insertInto("itemLedger")
                  .values(itemLedgerInserts)
                  .returning(["id"])
                  .execute();
              }

              // Update shipment status to Voided
              await trx
                .updateTable("shipment")
                .set({
                  status: "Voided",
                  updatedAt: today,
                  updatedBy: userId,
                })
                .where("id", "=", shipmentId)
                .execute();
            });

            break;
          }

          default: {
            throw new Error(
              `Invalid source document type: ${shipment.data.sourceDocument}`
            );
          }
        }
        break;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        splitEntityIds,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(err);
    if ("shipmentId" in payload) {
      const client = await requirePermissions(req, payload.companyId, payload.userId, { update: "inventory" });
      await client
        .from("shipment")
        .update({ status: "Draft" })
        .eq("id", payload.shipmentId);
    }
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
