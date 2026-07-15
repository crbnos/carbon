import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";
import { credit, debit, journalReference } from "../lib/utils.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import {
  allocateVarianceAcrossLayers,
  type VarianceAllocation,
} from "../shared/purchase-cost-adjustment.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import {
  getDefaultPostingGroup,
  resolveInventoryAccount,
} from "../shared/get-posting-group.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  invoiceId: z.string(),
  userId: z.string(),
  companyId: z.string(),
  skipReceiptPost: z.boolean().optional(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();
  const today = format(new Date(), "yyyy-MM-dd");

  try {
    const { type, invoiceId, userId, companyId, skipReceiptPost } =
      payloadValidator.parse(payload);

    console.log({
      function: "post-purchase-invoice",
      type,
      invoiceId,
      userId,
      skipReceiptPost,
    });
    const client = await requirePermissions(req, companyId, userId, { update: "invoicing" });

    const accountingEnabled = await client
      .from("companySettings")
      .select("accountingEnabled")
      .eq("id", companyId)
      .single()
      .then((r) => r.data?.accountingEnabled ?? false);

    if (type === "void") {
      const invoice = await client
        .from("purchaseInvoice")
        .select("*")
        .eq("id", invoiceId)
        .single();
      if (invoice.error) throw new Error("Failed to fetch purchaseInvoice");

      if (!invoice.data.postingDate) {
        throw new Error("Can only void posted purchase invoices");
      }

      if (invoice.data.status === "Voided") {
        throw new Error("Purchase invoice is already voided");
      }

      if (
        invoice.data.status === "Paid" ||
        invoice.data.status === "Partially Paid"
      ) {
        throw new Error(
          "Cannot void a purchase invoice with payments applied. Reverse the payment first."
        );
      }

      const [originalItemLedger, originalJournalLines, originalCostLedger] =
        await Promise.all([
          client
            .from("itemLedger")
            .select("*")
            .eq("documentId", invoiceId)
            .eq("companyId", companyId),
          client
            .from("journalLine")
            .select("*")
            .eq("documentId", invoiceId)
            .eq("documentType", "Invoice")
            .eq("companyId", companyId),
          client
            .from("costLedger")
            .select("*")
            .eq("documentId", invoiceId)
            // 'Purchase Receipt' + documentId=invoiceId are the legacy
            // self-heal layers this invoice may have created
            .in("documentType", ["Purchase Invoice", "Purchase Receipt"])
            .eq("companyId", companyId),
        ]);

      if (originalItemLedger.error)
        throw new Error("Failed to fetch item ledger entries");
      if (originalJournalLines.error)
        throw new Error("Failed to fetch journal lines");
      if (originalCostLedger.error)
        throw new Error("Failed to fetch cost ledger entries");

      const invoiceLinesVoid = await client
        .from("purchaseInvoiceLine")
        .select("*")
        .eq("invoiceId", invoiceId);
      if (invoiceLinesVoid.error)
        throw new Error("Failed to fetch purchase invoice lines");

      const purchaseOrderLineIdsVoid = invoiceLinesVoid.data.reduce<string[]>(
        (acc, invoiceLine) => {
          if (
            invoiceLine.purchaseOrderLineId &&
            !acc.includes(invoiceLine.purchaseOrderLineId)
          ) {
            acc.push(invoiceLine.purchaseOrderLineId);
          }
          return acc;
        },
        []
      );

      const affectedPurchaseOrderIdsVoid: string[] = [];

      if (purchaseOrderLineIdsVoid.length > 0) {
        const touchedLines = await client
          .from("purchaseOrderLine")
          .select("purchaseOrderId")
          .in("id", purchaseOrderLineIdsVoid);
        if (touchedLines.error)
          throw new Error("Failed to fetch purchase order lines");
        for (const { purchaseOrderId } of touchedLines.data) {
          if (
            purchaseOrderId &&
            !affectedPurchaseOrderIdsVoid.includes(purchaseOrderId)
          ) {
            affectedPurchaseOrderIdsVoid.push(purchaseOrderId);
          }
        }
      }

      const purchaseOrderLinesVoid =
        affectedPurchaseOrderIdsVoid.length > 0
          ? await client
              .from("purchaseOrderLine")
              .select("*")
              .in("purchaseOrderId", affectedPurchaseOrderIdsVoid)
          : { data: [] as Database["public"]["Tables"]["purchaseOrderLine"]["Row"][], error: null };

      if (purchaseOrderLinesVoid.error)
        throw new Error("Failed to fetch purchase order lines");

      const purchaseOrderLinesByIdVoid = purchaseOrderLinesVoid.data.reduce<
        Record<string, Database["public"]["Tables"]["purchaseOrderLine"]["Row"]>
      >((acc, purchaseOrderLine) => {
        acc[purchaseOrderLine.id] = purchaseOrderLine;
        return acc;
      }, {});

      const purchaseOrderLineUpdatesVoid = invoiceLinesVoid.data.reduce<
        Record<
          string,
          Database["public"]["Tables"]["purchaseOrderLine"]["Update"] & {
            purchaseOrderId: string;
          }
        >
      >((acc, invoiceLine) => {
        const purchaseOrderLine =
          purchaseOrderLinesByIdVoid[invoiceLine.purchaseOrderLineId ?? ""];
        if (
          invoiceLine.purchaseOrderLineId &&
          purchaseOrderLine &&
          invoiceLine.quantity &&
          purchaseOrderLine.purchaseQuantity &&
          purchaseOrderLine.purchaseQuantity > 0
        ) {
          const invoicedQuantityInPurchaseUnit =
            invoiceLine.quantity / (invoiceLine.conversionFactor ?? 1);

          const newQuantityInvoiced = Math.max(
            0,
            (purchaseOrderLine.quantityInvoiced ?? 0) -
              invoicedQuantityInPurchaseUnit
          );

          const invoicedComplete =
            newQuantityInvoiced >= purchaseOrderLine.purchaseQuantity;

          acc[invoiceLine.purchaseOrderLineId] = {
            quantityInvoiced: newQuantityInvoiced,
            invoicedComplete,
            purchaseOrderId: purchaseOrderLine.purchaseOrderId,
          };
        }
        return acc;
      }, {});

      const purchaseOrderStatusUpdatesVoid: Record<
        string,
        Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"]
      > = {};
      for (const purchaseOrderId of affectedPurchaseOrderIdsVoid) {
        const projectedLines = purchaseOrderLinesVoid.data
          .filter((line) => line.purchaseOrderId === purchaseOrderId)
          .map((line) => {
            const update = purchaseOrderLineUpdatesVoid[line.id];
            if (update && update.quantityInvoiced !== undefined) {
              return { ...line, quantityInvoiced: update.quantityInvoiced };
            }
            return line;
          });

        const areAllLinesInvoicedProjected = projectedLines.every((line) => {
          if (line.purchaseOrderLineType === "Comment") return true;
          const target = line.purchaseQuantity ?? 0;
          if (target <= 0) return true;
          return (line.quantityInvoiced ?? 0) >= target;
        });

        const areAllLinesReceivedProjected = projectedLines.every((line) => {
          if (line.purchaseOrderLineType === "Comment" || line.purchaseOrderLineType === "G/L Account" || line.purchaseOrderLineType === "Service") return true;
          const target = line.purchaseQuantity ?? 0;
          if (target <= 0) return true;
          return (line.quantityReceived ?? 0) >= target;
        });

        let status: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
          "To Receive and Invoice";
        if (areAllLinesInvoicedProjected && areAllLinesReceivedProjected) {
          status = "Completed";
        } else if (areAllLinesInvoicedProjected) {
          status = "To Receive";
        } else if (areAllLinesReceivedProjected) {
          status = "To Invoice";
        }

        purchaseOrderStatusUpdatesVoid[purchaseOrderId] = status;
      }

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

      // Partition invoice-created costLedger rows for reversal:
      // - adjustment children (variance bumps on receipt layers)
      // - legacy self-heal layers (documentType 'Purchase Receipt')
      // - plain rows (no-PO direct-invoice layers): negative-mirror as before
      type CostLedgerRow = Database["public"]["Tables"]["costLedger"]["Row"];
      const adjustmentChildrenVoid = originalCostLedger.data.filter(
        (entry: CostLedgerRow) =>
          entry.adjustment && entry.appliesToCostLedgerId
      );
      const selfHealLayersVoid = originalCostLedger.data.filter(
        (entry: CostLedgerRow) =>
          !entry.adjustment && entry.documentType === "Purchase Receipt"
      );
      const plainCostLedgerVoid = originalCostLedger.data.filter(
        (entry: CostLedgerRow) =>
          !adjustmentChildrenVoid.includes(entry) &&
          !selfHealLayersVoid.includes(entry)
      );

      const reversingCostLedger: Database["public"]["Tables"]["costLedger"]["Insert"][] =
        plainCostLedgerVoid.map((entry) => ({
          itemLedgerType: entry.itemLedgerType,
          costLedgerType: entry.costLedgerType,
          adjustment: entry.adjustment,
          documentType: entry.documentType,
          documentId: entry.documentId,
          externalDocumentId: entry.externalDocumentId,
          itemId: entry.itemId,
          quantity: -entry.quantity,
          nominalCost: -entry.nominalCost,
          cost: -entry.cost,
          supplierId: entry.supplierId,
          companyId,
        }));

      const accountingPeriodIdVoid = accountingEnabled
        ? await getCurrentAccountingPeriod(client, companyId, db)
        : null;

      await db.transaction().execute(async (trx) => {
        for await (const [purchaseOrderLineId, update] of Object.entries(
          purchaseOrderLineUpdatesVoid
        )) {
          const { purchaseOrderId: _purchaseOrderId, ...lineUpdate } = update;
          await trx
            .updateTable("purchaseOrderLine")
            .set(lineUpdate)
            .where("id", "=", purchaseOrderLineId)
            .execute();
        }

        for await (const [purchaseOrderId, status] of Object.entries(
          purchaseOrderStatusUpdatesVoid
        )) {
          await trx
            .updateTable("purchaseOrder")
            .set({ status })
            .where("id", "=", purchaseOrderId)
            .execute();
        }

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
              accountingPeriodId: accountingPeriodIdVoid,
              description: `VOID Purchase Invoice ${invoice.data.invoiceId}`,
              postingDate: today,
              companyId,
              sourceType: "Purchase Invoice",
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

        if (reversingCostLedger.length > 0) {
          await trx
            .insertInto("costLedger")
            .values(reversingCostLedger)
            .execute();
        }

        // Reverse variance adjustment children created by this invoice.
        // Untouched children are deleted; partially consumed ones get a
        // counter-child with the SAME remainingQuantity while the original
        // stays live — future consumption applies +bump and −bump together,
        // netting remaining units back to base cost. Already-consumed bumps
        // stay in posted COGS (no retroactive restatement).
        for (const child of adjustmentChildrenVoid) {
          if (
            Number(child.remainingQuantity ?? 0) === Number(child.quantity)
          ) {
            await trx
              .deleteFrom("costLedger")
              .where("id", "=", child.id)
              .execute();
          } else {
            await trx
              .insertInto("costLedger")
              .values({
                itemLedgerType: child.itemLedgerType,
                costLedgerType: child.costLedgerType,
                adjustment: true,
                appliesToCostLedgerId: child.appliesToCostLedgerId,
                documentType: child.documentType,
                documentId: child.documentId,
                externalDocumentId: child.externalDocumentId,
                itemId: child.itemId,
                quantity: child.quantity,
                nominalCost: -child.nominalCost,
                cost: -child.cost,
                remainingQuantity: child.remainingQuantity,
                supplierId: child.supplierId,
                companyId,
              })
              .execute();
          }
        }

        // Reverse legacy self-heal layers created by this invoice. Unconsumed
        // layers are deleted (restores the pre-invoice no-layer state);
        // partially consumed ones get a negative mirror row and stop feeding
        // consumption (remainingQuantity zeroed).
        for (const layer of selfHealLayersVoid) {
          if (
            Number(layer.remainingQuantity ?? 0) === Number(layer.quantity)
          ) {
            await trx
              .deleteFrom("costLedger")
              .where("id", "=", layer.id)
              .execute();
          } else {
            await trx
              .insertInto("costLedger")
              .values({
                itemLedgerType: layer.itemLedgerType,
                costLedgerType: layer.costLedgerType,
                adjustment: layer.adjustment,
                documentType: layer.documentType,
                documentId: layer.documentId,
                externalDocumentId: layer.externalDocumentId,
                itemId: layer.itemId,
                quantity: -layer.quantity,
                nominalCost: -layer.nominalCost,
                cost: -layer.cost,
                remainingQuantity: 0,
                supplierId: layer.supplierId,
                companyId,
              })
              .execute();
            await trx
              .updateTable("costLedger")
              .set({ remainingQuantity: 0 })
              .where("id", "=", layer.id)
              .execute();
          }
        }

        await trx
          .updateTable("purchaseInvoice")
          .set({
            status: "Voided",
            updatedAt: today,
            updatedBy: userId,
          })
          .where("id", "=", invoiceId)
          .execute();
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyRecord = await client
      .from("company")
      .select("companyGroupId")
      .eq("id", companyId)
      .single();
    if (companyRecord.error) throw new Error("Failed to fetch company");
    const companyGroupId = companyRecord.data.companyGroupId;

    const [purchaseInvoice, purchaseInvoiceLines, purchaseInvoiceDelivery, dimensions] =
      await Promise.all([
        client.from("purchaseInvoice").select("*").eq("id", invoiceId).single(),
        client
          .from("purchaseInvoiceLine")
          .select("*")
          .eq("invoiceId", invoiceId),
        client
          .from("purchaseInvoiceDelivery")
          .select("supplierShippingCost")
          .eq("id", invoiceId)
          .single(),
        client
          .from("dimension")
          .select("id, entityType")
          .eq("companyGroupId", companyGroupId)
          .eq("active", true)
          .in("entityType", [
            "SupplierType",
            "Supplier",
            "ItemPostingGroup",
            "Item",
            "Location",
            "CostCenter",
            "Process",
            "FixedAssetClass",
          ]),
      ]);

    if (purchaseInvoice.error)
      throw new Error("Failed to fetch purchaseInvoice");
    if (purchaseInvoiceLines.error)
      throw new Error("Failed to fetch receipt lines");
    if (purchaseInvoiceDelivery.error)
      throw new Error("Failed to fetch purchase invoice delivery");
    if (dimensions.error) {
      console.error("Failed to fetch dimensions", dimensions.error);
    }

    const dimensionMap = new Map<string, string>();
    for (const dim of dimensions.data ?? []) {
      if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
    }

    // supplierShippingCost is a supplier-currency amount; currency.exchangeRate
    // stores foreign-units-per-base, so supplier→base is DIVIDE (matching the
    // purchaseInvoices view and the line-level generated columns). It is then
    // folded into the per-line totals BEFORE the payment-chain exchange-rate
    // multiplier so AP is credited exactly what post-payment will debit.
    const shippingCost =
      (purchaseInvoiceDelivery.data?.supplierShippingCost ?? 0) /
      (purchaseInvoice.data?.exchangeRate || 1);

    // Pre-allocation denominator for the header shipping cost. Comment lines
    // post no journal entries, so they must not absorb a share of the
    // shipping (it would never reach the GL).
    const totalLinesCost = purchaseInvoiceLines.data.reduce(
      (acc, invoiceLine) => {
        if (invoiceLine.invoiceLineType === "Comment") return acc;
        const lineCost =
          (invoiceLine.quantity ?? 0) * (invoiceLine.unitPrice ?? 0) +
          (invoiceLine.shippingCost ?? 0) +
          (invoiceLine.taxAmount ?? 0);
        return acc + lineCost;
      },
      0
    );

    const postableLineCount = purchaseInvoiceLines.data.filter(
      (invoiceLine) => invoiceLine.invoiceLineType !== "Comment"
    ).length;

    const itemIds = purchaseInvoiceLines.data.reduce<string[]>(
      (acc, invoiceLine) => {
        if (invoiceLine.itemId && !acc.includes(invoiceLine.itemId)) {
          acc.push(invoiceLine.itemId);
        }
        return acc;
      },
      []
    );

    const [items, itemCosts, purchaseOrderLines, supplier] = await Promise.all([
      client
        .from("item")
        .select("id, itemTrackingType, replenishmentSystem")
        .in("id", itemIds)
        .eq("companyId", companyId),
      client
        .from("itemCost")
        .select("itemId, itemPostingGroupId, costingMethod")
        .in("itemId", itemIds),
      client
        .from("purchaseOrderLine")
        .select("*")
        .in(
          "id",
          purchaseInvoiceLines.data.reduce<string[]>((acc, invoiceLine) => {
            if (
              invoiceLine.purchaseOrderLineId &&
              !acc.includes(invoiceLine.purchaseOrderLineId)
            ) {
              acc.push(invoiceLine.purchaseOrderLineId);
            }
            return acc;
          }, [])
        ),
      client
        .from("supplier")
        .select("*")
        .eq("id", purchaseInvoice.data.supplierId ?? "")
        .eq("companyId", companyId)
        .single(),
    ]);
    if (items.error) throw new Error("Failed to fetch items");
    if (itemCosts.error) throw new Error("Failed to fetch item costs");
    if (purchaseOrderLines.error)
      throw new Error("Failed to fetch purchase order lines");
    if (supplier.error) throw new Error("Failed to fetch supplier");

    const purchaseOrders = await client
      .from("purchaseOrder")
      .select("*")
      .in(
        "purchaseOrderId",
        purchaseOrderLines.data.reduce<string[]>((acc, purchaseOrderLine) => {
          if (
            purchaseOrderLine.purchaseOrderId &&
            !acc.includes(purchaseOrderLine.purchaseOrderId)
          ) {
            acc.push(purchaseOrderLine.purchaseOrderId);
          }
          return acc;
        }, [])
      )
      .eq("companyId", companyId);

    if (purchaseOrders.error)
      throw new Error("Failed to fetch purchase orders");

    const costLedgerInserts: Database["public"]["Tables"]["costLedger"]["Insert"][] =
      [];

    const journalLineInserts: Omit<
      Database["public"]["Tables"]["journalLine"]["Insert"],
      "journalId"
    >[] = [];

    const journalLineDimensionsMeta: {
      supplierTypeId: string | null;
      itemPostingGroupId: string | null;
      itemId: string | null;
      locationId: string | null;
      costCenterId: string | null;
      processId: string | null;
      fixedAssetClassId: string | null;
    }[] = [];

    const processIdByJobOperationId = new Map<string, string>();
    {
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

    const receiptLineInserts: Omit<
      Database["public"]["Tables"]["receiptLine"]["Insert"],
      "receiptId"
    >[] = [];

    const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
      [];

    const purchaseInvoiceLinesByPurchaseOrderLine =
      purchaseInvoiceLines.data.reduce<
        Record<
          string,
          Database["public"]["Tables"]["purchaseInvoiceLine"]["Row"]
        >
      >((acc, invoiceLine) => {
        if (invoiceLine.purchaseOrderLineId) {
          acc[invoiceLine.purchaseOrderLineId] = invoiceLine;
        }
        return acc;
      }, {});

    const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
      Record<
        string,
        Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
      >
    >((acc, purchaseOrderLine) => {
      const invoiceLine =
        purchaseInvoiceLinesByPurchaseOrderLine[purchaseOrderLine.id];
      if (
        invoiceLine &&
        invoiceLine.quantity &&
        purchaseOrderLine.purchaseQuantity &&
        purchaseOrderLine.purchaseQuantity > 0
      ) {
        const newQuantityInvoiced =
          (purchaseOrderLine.quantityInvoiced ?? 0) + invoiceLine.quantity;

        const invoicedComplete =
          purchaseOrderLine.invoicedComplete ||
          invoiceLine.quantity >=
            (purchaseOrderLine.quantityToInvoice ??
              purchaseOrderLine.purchaseQuantity);

        return {
          ...acc,
          [purchaseOrderLine.id]: {
            quantityInvoiced: newQuantityInvoiced,
            invoicedComplete,
            purchaseOrderId: purchaseOrderLine.purchaseOrderId,
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
        purchaseOrderLines.data.reduce<string[]>((acc, purchaseOrderLine) => {
          if (
            (purchaseOrderLine.quantityReceived ?? 0) >
            (purchaseOrderLine.quantityInvoiced ?? 0)
          ) {
            acc.push(journalReference.to.receipt(purchaseOrderLine.id));
          }
          return acc;
        }, [])
      )
      .eq("companyId", companyId);
    if (journalLines.error) {
      throw new Error("Failed to fetch journal entries to reverse");
    }

    const journalLinesByPurchaseOrderLine = journalLines.data.reduce<
      Record<string, Database["public"]["Tables"]["journalLine"]["Row"][]>
    >((acc, journalEntry) => {
      const [type, purchaseOrderLineId] = (
        journalEntry.documentLineReference ?? ""
      ).split(":");
      if (type === "receipt") {
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

    // Get account defaults (once for all lines)
    const accountDefaults = accountingEnabled
      ? await getDefaultPostingGroup(client, companyId)
      : null;
    if (accountingEnabled && (accountDefaults?.error || !accountDefaults?.data)) {
      throw new Error("Error getting account defaults");
    }

    // Invoice exchange rate (defaults to 1 for base-currency invoices).
    // The payment chain (post-payment/build-payment-journal) relieves AP at
    // `applied × exchangeRate`, so posting applies the same multiplier to the
    // line totals (header shipping included, already divided to base above)
    // to keep AP credit == what payments will debit. See the FX-convention
    // spec for the planned normalization of this multiplier.
    const invoiceExchangeRate = purchaseInvoice.data?.exchangeRate ?? 1;

    for await (const invoiceLine of purchaseInvoiceLines.data) {
      const invoiceLineQuantityInInventoryUnit =
        invoiceLine.quantity * (invoiceLine.conversionFactor ?? 1);

      const totalLineCost =
        invoiceLine.quantity * (invoiceLine.unitPrice ?? 0) +
        (invoiceLine.shippingCost ?? 0) +
        (invoiceLine.taxAmount ?? 0);

      // When every line has a zero basis (e.g. a freight-only invoice), fall
      // back to equal weights so the header shipping still reaches AP.
      const lineCostPercentageOfTotalCost =
        invoiceLine.invoiceLineType === "Comment"
          ? 0
          : totalLinesCost === 0
          ? postableLineCount === 0
            ? 0
            : 1 / postableLineCount
          : totalLineCost / totalLinesCost;
      const lineWeightedShippingCost =
        shippingCost * lineCostPercentageOfTotalCost;
      // Line cost and weighted shipping are both base currency here; the
      // exchange-rate multiplier matches the payment chain's AP relief.
      const totalLineCostWithWeightedShipping =
        (totalLineCost + lineWeightedShippingCost) * invoiceExchangeRate;

      const invoiceLineUnitCostInInventoryUnit =
        totalLineCostWithWeightedShipping /
        (invoiceLine.quantity * (invoiceLine.conversionFactor ?? 1));

      let journalLineReference: string;

      switch (invoiceLine.invoiceLineType) {
        case "Part":
        case "Service":
        case "Consumable":
        case "Fixture":
        case "Material":
        case "Tool":
          {
            const item = items.data.find(
              (item) => item.id === invoiceLine.itemId
            );
            const itemTrackingType = item?.itemTrackingType ?? "Inventory";

            console.log({
              invoiceLineItemId: invoiceLine.itemId,
              foundItem: item,
              itemTrackingType,
              requiresSerialTracking: itemTrackingType === "Serial",
              requiresBatchTracking: itemTrackingType === "Batch",
            });

            // if the purchase order line is null, we receive the part, do the normal entries and do not use accrual/reversing
            if (invoiceLine.purchaseOrderLineId === null) {
              // Services are never received, so they must not materialize a
              // receipt document — only the expense + AP entries below.
              if (invoiceLine.invoiceLineType !== "Service") {
                // create the receipt line
                receiptLineInserts.push({
                  itemId: invoiceLine.itemId!,
                  lineId: invoiceLine.id,
                  orderQuantity: invoiceLineQuantityInInventoryUnit,
                  outstandingQuantity: invoiceLineQuantityInInventoryUnit,
                  receivedQuantity: invoiceLineQuantityInInventoryUnit,
                  locationId: invoiceLine.locationId,
                  storageUnitId: invoiceLine.storageUnitId,
                  unitOfMeasure: invoiceLine.inventoryUnitOfMeasureCode ?? "EA",
                  unitPrice: invoiceLine.unitPrice ?? 0,
                  requiresSerialTracking: itemTrackingType === "Serial",
                  requiresBatchTracking: itemTrackingType === "Batch",
                  createdBy: invoiceLine.createdBy,
                  companyId,
                });
              }

              // Only create item ledger entries if the receipt is being posted
              // (not when skipReceiptPost is true, as entries will be created when the receipt is posted later)
              if (itemTrackingType === "Inventory" && !skipReceiptPost) {
                // create the part ledger line
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: invoiceLine.itemId!,
                  quantity: invoiceLineQuantityInInventoryUnit,
                  locationId: invoiceLine.locationId,
                  storageUnitId: invoiceLine.storageUnitId,
                  entryType: "Positive Adjmt.",
                  documentType: "Purchase Receipt",
                  documentId: purchaseInvoice.data?.id ?? undefined,
                  externalDocumentId:
                    purchaseInvoice.data?.supplierReference ?? undefined,
                  createdBy: userId,
                  companyId,
                });
              }

              // Services are never stocked — a cost ledger layer would pollute
              // inventory valuation, so only the journal entries below apply.
              if (invoiceLine.invoiceLineType !== "Service") {
                // create the cost ledger line
                costLedgerInserts.push({
                  itemLedgerType: "Purchase",
                  costLedgerType: "Direct Cost",
                  adjustment: false,
                  documentType: "Purchase Invoice",
                  documentId: purchaseInvoice.data?.id ?? undefined,
                  externalDocumentId:
                    purchaseInvoice.data?.supplierReference ?? undefined,
                  itemId: invoiceLine.itemId,
                  quantity: invoiceLineQuantityInInventoryUnit,
                  nominalCost:
                    invoiceLine.quantity * (invoiceLine.unitPrice ?? 0),
                  cost: totalLineCostWithWeightedShipping,
                  remainingQuantity: invoiceLineQuantityInInventoryUnit,
                  supplierId: purchaseInvoice.data?.supplierId,
                  companyId,
                });
              }

              // create the GL entries for a direct invoice (no PO)
              if (accountingEnabled && accountDefaults?.data) {
                journalLineReference = nanoid();

                let debitAccount: string;
                let debitDescription: string;

                if (itemTrackingType === "Inventory" && !skipReceiptPost) {
                  const inventoryAccount = resolveInventoryAccount(
                    item?.replenishmentSystem ?? null,
                    accountDefaults.data
                  );
                  debitAccount = inventoryAccount.account;
                  debitDescription = inventoryAccount.description;
                } else if (itemTrackingType === "Non-Inventory") {
                  debitAccount = accountDefaults.data.indirectCostAccount;
                  debitDescription = "Indirect Cost Account";
                } else {
                  debitAccount = accountDefaults.data.workInProgressAccount;
                  debitDescription = "WIP Account";
                }

                journalLineInserts.push({
                  accountId: debitAccount,
                  description: debitDescription,
                  amount: debit("asset", totalLineCostWithWeightedShipping),
                  quantity: invoiceLineQuantityInInventoryUnit,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  journalLineReference,
                  companyId,
                });

                journalLineInserts.push({
                  accountId: accountDefaults.data.payablesAccount,
                  description: "Accounts Payable",
                  amount: credit("liability", totalLineCostWithWeightedShipping),
                  quantity: invoiceLineQuantityInInventoryUnit,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  journalLineReference,
                  companyId,
                });

                const lineItemPostingGroupId =
                  itemCosts.data.find(
                    (cost) => cost.itemId === invoiceLine.itemId
                  )?.itemPostingGroupId ?? null;
                const itemDimMeta = {
                  supplierTypeId: supplier.data.supplierTypeId ?? null,
                  itemPostingGroupId: lineItemPostingGroupId,
                  itemId: invoiceLine.itemId ?? null,
                  locationId: invoiceLine.locationId ?? null,
                  costCenterId: null,
                  processId: null,
                  fixedAssetClassId: null,
                };
                journalLineDimensionsMeta.push(itemDimMeta, itemDimMeta);
              }
            } // if the line is associated with a purchase order line, we do accrual/reversing
            else {
              // The receipt is the sole creator of purchase cost layers; this
              // invoice adjusts the receipt's layers (below) instead of
              // creating its own.

              // determine the journal lines that should be reversed
              const existingJournalLines = invoiceLine.purchaseOrderLineId
                ? journalLinesByPurchaseOrderLine[
                    invoiceLine.purchaseOrderLineId
                  ] ?? []
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
                (line) => line.id === invoiceLine.purchaseOrderLineId
              );

              const isOutsideProcessing = !!purchaseOrderLine?.jobOperationId;

              const quantityReceived =
                (purchaseOrderLine?.quantityReceived ?? 0) *
                (purchaseOrderLine?.conversionFactor ?? 1);

              const quantityInvoiced =
                (purchaseOrderLine?.quantityInvoiced ?? 0) *
                (purchaseOrderLine?.conversionFactor ?? 1);

              const quantityToReverse = Math.max(
                0,
                Math.min(
                  invoiceLineQuantityInInventoryUnit,
                  quantityReceived - quantityInvoiced
                )
              );

              const quantityAlreadyReversed =
                quantityReceived > quantityInvoiced ? quantityInvoiced : 0;

              const jlStartIdxReverse = journalLineInserts.length;

              if (quantityToReverse > 0 && accountingEnabled && accountDefaults?.data) {
                // Calculate receipt cost from existing journal lines for PPV
                let receiptCostForReversedQty = 0;
                let quantityCounted = 0;
                let quantityReversedForVariance = 0;

                existingJournalLineGroups.forEach((entry) => {
                  if (entry[0].quantity) {
                    const unitCostForEntry =
                      Math.abs(entry[0].amount ?? 0) / entry[0].quantity;

                    const quantityAvailableToReverseForEntry =
                      quantityAlreadyReversed > quantityCounted
                        ? entry[0].quantity +
                          quantityCounted -
                          quantityAlreadyReversed
                        : entry[0].quantity;

                    const quantityRequiredToReverse =
                      quantityToReverse - quantityReversedForVariance;

                    const quantityToReverseForEntry = Math.max(
                      0,
                      Math.min(
                        quantityAvailableToReverseForEntry,
                        quantityRequiredToReverse
                      )
                    );

                    receiptCostForReversedQty +=
                      quantityToReverseForEntry * unitCostForEntry;
                    quantityCounted += entry[0].quantity;
                    quantityReversedForVariance += quantityToReverseForEntry;
                  }
                });

                const invoiceCostForReversedQty =
                  quantityToReverse * invoiceLineUnitCostInInventoryUnit;
                const variance =
                  invoiceCostForReversedQty - receiptCostForReversedQty;

                journalLineReference = nanoid();

                // DR GR/IR Clearing at receipt cost — clears the receipt's CR
                journalLineInserts.push({
                  accountId:
                    accountDefaults.data.goodsReceivedNotInvoicedAccount,
                  description: "GR/IR Clearing",
                  amount: debit("liability", receiptCostForReversedQty),
                  quantity: quantityToReverse,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  documentLineReference: journalReference.to.purchaseInvoice(
                    invoiceLine.purchaseOrderLineId!
                  ),
                  journalLineReference,
                  companyId,
                });

                // Split the invoice-vs-receipt variance by stock coverage:
                // the on-hand share writes up Inventory (GL) and the receipt
                // layers (adjustment child rows); the consumed share posts to
                // PPV. Standard-cost items and outside-processing or
                // non-inventory lines keep the full variance in PPV — they
                // have no layers to adjust.
                const invoiceLineItem = items.data.find(
                  (item: { id: string }) => item.id === invoiceLine.itemId
                );
                const lineItemTrackingType =
                  invoiceLineItem?.itemTrackingType ?? "Inventory";
                const lineCostingMethod =
                  itemCosts.data.find(
                    (cost: { itemId: string }) =>
                      cost.itemId === invoiceLine.itemId
                  )?.costingMethod ?? "FIFO";
                const usesLayers =
                  !isOutsideProcessing &&
                  lineItemTrackingType !== "Non-Inventory" &&
                  lineCostingMethod !== "Standard" &&
                  !!invoiceLine.itemId;

                let allocation: VarianceAllocation = {
                  inventoryShare: 0,
                  ppvShare: Math.abs(variance) > 0.005 ? variance : 0,
                  perLayer: [],
                };

                if (usesLayers && Math.abs(variance) > 0.005) {
                  const receiptLinesForPoLine = await client
                    .from("receiptLine")
                    .select("receiptId")
                    .eq("lineId", invoiceLine.purchaseOrderLineId!)
                    .eq("companyId", companyId);
                  if (receiptLinesForPoLine.error) {
                    throw new Error("Failed to fetch receipt lines for PO line");
                  }
                  const receiptIds = [
                    ...new Set(
                      (receiptLinesForPoLine.data ?? [])
                        .map(
                          (line: { receiptId: string | null }) =>
                            line.receiptId
                        )
                        .filter((id: string | null): id is string => !!id)
                    ),
                  ];

                  const receiptLayers =
                    receiptIds.length > 0
                      ? await client
                          .from("costLedger")
                          .select("id, quantity, remainingQuantity")
                          .eq("documentType", "Purchase Receipt")
                          .in("documentId", receiptIds)
                          .eq("itemId", invoiceLine.itemId!)
                          .eq("adjustment", false)
                          .eq("companyId", companyId)
                          .order("postingDate", { ascending: true })
                          .order("createdAt", { ascending: true })
                      : { data: [], error: null };
                  if (receiptLayers.error) {
                    throw new Error("Failed to fetch receipt cost layers");
                  }

                  if ((receiptLayers.data ?? []).length > 0) {
                    allocation = allocateVarianceAcrossLayers(
                      (receiptLayers.data ?? []).map(
                        (layer: {
                          id: string;
                          quantity: number | null;
                          remainingQuantity: number | null;
                        }) => ({
                          id: layer.id,
                          quantity: Number(layer.quantity),
                          remainingQuantity: Number(
                            layer.remainingQuantity ?? 0
                          ),
                        })
                      ),
                      quantityToReverse,
                      variance
                    );

                    // Subledger: adjustment child rows on the covered layers,
                    // consumed alongside their parent by calculateCOGS.
                    for (const entry of allocation.perLayer) {
                      costLedgerInserts.push({
                        itemLedgerType: "Purchase",
                        costLedgerType: "Direct Cost",
                        adjustment: true,
                        appliesToCostLedgerId: entry.costLedgerId,
                        documentType: "Purchase Invoice",
                        documentId: purchaseInvoice.data?.id ?? undefined,
                        externalDocumentId:
                          purchaseInvoice.data?.supplierReference ?? undefined,
                        itemId: invoiceLine.itemId,
                        quantity: entry.appliedQuantity,
                        nominalCost: entry.adjustmentCost,
                        cost: entry.adjustmentCost,
                        remainingQuantity: entry.appliedQuantity,
                        supplierId: purchaseInvoice.data?.supplierId,
                        companyId,
                      });
                    }
                  } else {
                    // Legacy self-heal: goods received before receipt-created
                    // layers shipped. Measure coverage from on-hand quantity
                    // (itemInventory cache) and create the layer now at
                    // receipt cost + on-hand variance share, so downstream
                    // consumption converges instead of double-counting.
                    const itemInventoryRows = await client
                      .from("itemInventory")
                      .select("quantityOnHand")
                      .eq("itemId", invoiceLine.itemId!)
                      .eq("companyId", companyId);
                    const onHandQuantity = Math.max(
                      0,
                      (itemInventoryRows.data ?? []).reduce(
                        (
                          acc: number,
                          row: { quantityOnHand: number | null }
                        ) => acc + Number(row.quantityOnHand ?? 0),
                        0
                      )
                    );
                    const coveredQuantity = Math.min(
                      onHandQuantity,
                      quantityToReverse
                    );
                    allocation = allocateVarianceAcrossLayers(
                      [
                        {
                          id: "legacy-self-heal",
                          quantity: quantityToReverse,
                          remainingQuantity: coveredQuantity,
                        },
                      ],
                      quantityToReverse,
                      variance
                    );
                    // The layer only represents stock still on hand — the
                    // consumed remainder's variance is PPV and must not become
                    // consumable subledger value.
                    if (coveredQuantity > 0) {
                      const coverageRatio = coveredQuantity / quantityToReverse;
                      costLedgerInserts.push({
                        itemLedgerType: "Purchase",
                        costLedgerType: "Direct Cost",
                        adjustment: false,
                        documentType: "Purchase Receipt",
                        documentId: purchaseInvoice.data?.id ?? undefined,
                        externalDocumentId:
                          purchaseInvoice.data?.supplierReference ?? undefined,
                        itemId: invoiceLine.itemId,
                        quantity: coveredQuantity,
                        nominalCost:
                          coveredQuantity * invoiceLineUnitCostInInventoryUnit,
                        cost:
                          receiptCostForReversedQty * coverageRatio +
                          allocation.inventoryShare,
                        remainingQuantity: coveredQuantity,
                        supplierId: purchaseInvoice.data?.supplierId,
                        companyId,
                      });
                    }
                    // The write-up is baked into the layer; no child rows.
                    allocation = {
                      ...allocation,
                      perLayer: [],
                    };
                  }
                }

                // DR Inventory for the on-hand share of the variance
                if (Math.abs(allocation.inventoryShare) > 0.005) {
                  const inventoryAccount = resolveInventoryAccount(
                    invoiceLineItem?.replenishmentSystem ?? null,
                    accountDefaults.data
                  );
                  journalLineInserts.push({
                    accountId: inventoryAccount.account,
                    description: inventoryAccount.description,
                    amount: debit("asset", allocation.inventoryShare),
                    quantity: quantityToReverse,
                    documentType: "Invoice",
                    documentId: purchaseInvoice.data?.id,
                    externalDocumentId: purchaseInvoice.data?.supplierReference,
                    documentLineReference: journalReference.to.purchaseInvoice(
                      invoiceLine.purchaseOrderLineId!
                    ),
                    journalLineReference,
                    companyId,
                  });
                }

                // DR/CR Purchase Price Variance for the consumed share
                if (Math.abs(allocation.ppvShare) > 0.005) {
                  journalLineInserts.push({
                    accountId: accountDefaults.data.purchaseVarianceAccount,
                    description: "Purchase Price Variance",
                    amount: debit("expense", allocation.ppvShare),
                    quantity: quantityToReverse,
                    documentType: "Invoice",
                    documentId: purchaseInvoice.data?.id,
                    externalDocumentId: purchaseInvoice.data?.supplierReference,
                    documentLineReference: journalReference.to.purchaseInvoice(
                      invoiceLine.purchaseOrderLineId!
                    ),
                    journalLineReference,
                    companyId,
                  });
                }

                // CR Accounts Payable at invoice cost
                journalLineInserts.push({
                  accountId: accountDefaults.data.payablesAccount,
                  description: "Accounts Payable",
                  amount: credit("liability", invoiceCostForReversedQty),
                  quantity: quantityToReverse,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  documentLineReference: journalReference.to.purchaseInvoice(
                    invoiceLine.purchaseOrderLineId!
                  ),
                  journalLineReference,
                  companyId,
                });

                const reverseLineItemPostingGroupId =
                  itemCosts.data.find(
                    (cost) => cost.itemId === invoiceLine.itemId
                  )?.itemPostingGroupId ?? null;
                const lineProcessId = purchaseOrderLine?.jobOperationId
                  ? processIdByJobOperationId.get(purchaseOrderLine.jobOperationId) ?? null
                  : null;
                const reverseDimMeta = {
                  supplierTypeId: supplier.data.supplierTypeId ?? null,
                  itemPostingGroupId: reverseLineItemPostingGroupId,
                  itemId: invoiceLine.itemId ?? null,
                  locationId: invoiceLine.locationId ?? null,
                  costCenterId: null,
                  processId: lineProcessId,
                  fixedAssetClassId: null,
                };
                const reverseJlCount =
                  journalLineInserts.length - jlStartIdxReverse;
                for (let i = 0; i < reverseJlCount; i++) {
                  journalLineDimensionsMeta.push(reverseDimMeta);
                }
              }

              if (invoiceLineQuantityInInventoryUnit > quantityToReverse && accountingEnabled && accountDefaults?.data) {
                const quantityToAccrue =
                  invoiceLineQuantityInInventoryUnit - quantityToReverse;
                const accrualCost =
                  quantityToAccrue * invoiceLineUnitCostInInventoryUnit;

                journalLineReference = nanoid();

                // Services are never received, so there is no GR/IR accrual to
                // clear — expense the cost directly to indirect cost instead.
                const isService = invoiceLine.invoiceLineType === "Service";

                if (isService) {
                  // DR Indirect Cost Account
                  journalLineInserts.push({
                    accountId: accountDefaults.data.indirectCostAccount,
                    description: "Indirect Cost Account",
                    amount: debit("asset", accrualCost),
                    quantity: quantityToAccrue,
                    documentType: "Invoice",
                    documentId: purchaseInvoice.data?.id,
                    externalDocumentId: purchaseInvoice.data?.supplierReference,
                    documentLineReference: invoiceLine.purchaseOrderLineId
                      ? journalReference.to.purchaseInvoice(
                          invoiceLine.purchaseOrderLineId
                        )
                      : null,
                    journalLineReference,
                    companyId,
                  });
                } else {
                  // DR GR/IR Clearing — debit balance represents goods invoiced but not received
                  journalLineInserts.push({
                    accountId:
                      accountDefaults.data.goodsReceivedNotInvoicedAccount,
                    description: "GR/IR Clearing",
                    accrual: true,
                    amount: debit("liability", accrualCost),
                    quantity: quantityToAccrue,
                    documentType: "Invoice",
                    documentId: purchaseInvoice.data?.id,
                    externalDocumentId: purchaseInvoice.data?.supplierReference,
                    documentLineReference: invoiceLine.purchaseOrderLineId
                      ? journalReference.to.purchaseInvoice(
                          invoiceLine.purchaseOrderLineId
                        )
                      : null,
                    journalLineReference,
                    companyId,
                  });
                }

                // CR Accounts Payable
                journalLineInserts.push({
                  accountId: accountDefaults.data.payablesAccount,
                  description: "Accounts Payable",
                  accrual: isService ? undefined : true,
                  amount: credit("liability", accrualCost),
                  quantity: quantityToAccrue,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  documentLineReference: invoiceLine.purchaseOrderLineId
                    ? journalReference.to.purchaseInvoice(
                        invoiceLine.purchaseOrderLineId
                      )
                    : null,
                  journalLineReference,
                  companyId,
                });

                const accrualLineItemPostingGroupId =
                  itemCosts.data.find(
                    (cost) => cost.itemId === invoiceLine.itemId
                  )?.itemPostingGroupId ?? null;
                const accrualProcessId = purchaseOrderLine?.jobOperationId
                  ? processIdByJobOperationId.get(purchaseOrderLine.jobOperationId) ?? null
                  : null;
                const accrualDimMeta = {
                  supplierTypeId: supplier.data.supplierTypeId ?? null,
                  itemPostingGroupId: accrualLineItemPostingGroupId,
                  itemId: invoiceLine.itemId ?? null,
                  locationId: invoiceLine.locationId ?? null,
                  costCenterId: null,
                  processId: accrualProcessId,
                  fixedAssetClassId: null,
                };
                journalLineDimensionsMeta.push(accrualDimMeta, accrualDimMeta);
              }
            }
          }

          break;
        case "Fixed Asset": {
          // Silently skipping would credit less to AP than the invoice total
          // the payment flow is allowed to apply against.
          if (accountingEnabled && !invoiceLine.assetId) {
            throw new Error(
              `Fixed Asset invoice line ${invoiceLine.id} has no asset selected`
            );
          }
          if (accountingEnabled && accountDefaults?.data && invoiceLine.assetId) {
            const purchaseOrderLine = purchaseOrderLines.data.find(
              (line) => line.id === invoiceLine.purchaseOrderLineId
            );

            const wasReceived =
              purchaseOrderLine &&
              (purchaseOrderLine.quantityReceived ?? 0) > 0;

            const faRecord = await client
              .from("fixedAsset")
              .select("locationId, fixedAssetClassId")
              .eq("id", invoiceLine.assetId)
              .single();
            const faLocationId = faRecord.data?.locationId ?? null;
            const faClassId = faRecord.data?.fixedAssetClassId ?? null;

            const jlStartIdxFa = journalLineInserts.length;
            let faFixedAssetClassId: string | null = null;

            if (wasReceived && invoiceLine.purchaseOrderLineId) {
              // Receipt was already posted — reverse the GR/IR accrual
              const existingJournalLines =
                journalLinesByPurchaseOrderLine[
                  invoiceLine.purchaseOrderLineId
                ] ?? [];

              let receiptCost = 0;
              for (const entry of existingJournalLines) {
                if (
                  (entry.amount ?? 0) > 0 &&
                  entry.description === "Fixed Asset Acquisition"
                ) {
                  receiptCost += Math.abs(entry.amount ?? 0);
                }
              }
              if (receiptCost === 0) {
                for (const entry of existingJournalLines) {
                  if (
                    (entry.amount ?? 0) < 0 &&
                    entry.description === "Goods Received Not Invoiced"
                  ) {
                    receiptCost += Math.abs(entry.amount ?? 0);
                  }
                }
              }

              const invoiceCost = totalLineCostWithWeightedShipping;
              const variance = invoiceCost - receiptCost;

              journalLineReference = nanoid();

              // DR GR/IR at receipt cost (clear the accrual)
              journalLineInserts.push({
                accountId:
                  accountDefaults.data.goodsReceivedNotInvoicedAccount,
                description: "GR/IR Clearing",
                amount: debit("liability", receiptCost),
                quantity: invoiceLineQuantityInInventoryUnit,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                externalDocumentId: purchaseInvoice.data?.supplierReference,
                documentLineReference: journalReference.to.purchaseInvoice(
                  invoiceLine.purchaseOrderLineId
                ),
                journalLineReference,
                companyId,
              });

              if (Math.abs(variance) > 0.005) {
                journalLineInserts.push({
                  accountId: accountDefaults.data.purchaseVarianceAccount,
                  description: "Purchase Price Variance",
                  amount: debit("expense", variance),
                  quantity: invoiceLineQuantityInInventoryUnit,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  documentLineReference: journalReference.to.purchaseInvoice(
                    invoiceLine.purchaseOrderLineId
                  ),
                  journalLineReference,
                  companyId,
                });
              }

              // CR Payables at invoice cost
              journalLineInserts.push({
                accountId: accountDefaults.data.payablesAccount,
                description: "Accounts Payable",
                amount: credit("liability", invoiceCost),
                quantity: invoiceLineQuantityInInventoryUnit,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                externalDocumentId: purchaseInvoice.data?.supplierReference,
                documentLineReference: journalReference.to.purchaseInvoice(
                  invoiceLine.purchaseOrderLineId
                ),
                journalLineReference,
                companyId,
              });

              // Update FA acquisition cost if variance exists
              if (Math.abs(variance) > 0.005) {
                const assetRecord = await client
                  .from("fixedAsset")
                  .select("id, acquisitionCost")
                  .eq("id", invoiceLine.assetId)
                  .single();
                if (!assetRecord.error) {
                  await client
                    .from("fixedAsset")
                    .update({
                      acquisitionCost:
                        Number(assetRecord.data.acquisitionCost) + variance,
                      updatedBy: userId,
                    })
                    .eq("id", invoiceLine.assetId);
                }
              }
              faFixedAssetClassId = faClassId;
            } else {
              // Direct invoice (no prior receipt) — full acquisition
              const assetRecord = await client
                .from("fixedAsset")
                .select(
                  "id, status, acquisitionDate, depreciationStartDate, acquisitionCost, fixedAssetClassId, fixedAssetClass:fixedAssetClassId(assetAccountId)"
                )
                .eq("id", invoiceLine.assetId)
                .single();

              if (assetRecord.error)
                throw new Error("Failed to fetch fixed asset");

              faFixedAssetClassId = assetRecord.data.fixedAssetClassId ?? null;

              journalLineReference = nanoid();

              journalLineInserts.push({
                accountId: (assetRecord.data.fixedAssetClass as any)
                  .assetAccountId,
                description: "Fixed Asset Acquisition",
                amount: debit("asset", totalLineCostWithWeightedShipping),
                quantity: invoiceLineQuantityInInventoryUnit,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                externalDocumentId: purchaseInvoice.data?.supplierReference,
                documentLineReference: invoiceLine.purchaseOrderLineId
                  ? journalReference.to.purchaseInvoice(
                      invoiceLine.purchaseOrderLineId
                    )
                  : null,
                journalLineReference,
                companyId,
              });

              journalLineInserts.push({
                accountId: accountDefaults.data.payablesAccount,
                description: "Accounts Payable",
                amount: credit("liability", totalLineCostWithWeightedShipping),
                quantity: invoiceLineQuantityInInventoryUnit,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                externalDocumentId: purchaseInvoice.data?.supplierReference,
                documentLineReference: invoiceLine.purchaseOrderLineId
                  ? journalReference.to.purchaseInvoice(
                      invoiceLine.purchaseOrderLineId
                    )
                  : null,
                journalLineReference,
                companyId,
              });

              const updateData: Record<string, any> = {
                acquisitionCost:
                  (Number(assetRecord.data.acquisitionCost) ?? 0) +
                  totalLineCostWithWeightedShipping,
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

              if (invoiceLine.locationId) {
                updateData.locationId = invoiceLine.locationId;
              }

              await client
                .from("fixedAsset")
                .update(updateData)
                .eq("id", invoiceLine.assetId);
            }

            const faJlCount = journalLineInserts.length - jlStartIdxFa;
            const assetDimMeta = {
              supplierTypeId: supplier.data.supplierTypeId ?? null,
              itemPostingGroupId: null,
              itemId: null,
              locationId: invoiceLine.locationId ?? purchaseOrderLine?.locationId ?? faLocationId,
              costCenterId: null,
              processId: null,
              fixedAssetClassId: faFixedAssetClassId,
            };
            for (let i = 0; i < faJlCount; i++) {
              journalLineDimensionsMeta.push(assetDimMeta);
            }
          }
          break;
        }
        case "Comment":
          break;
        case "G/L Account": {
          if (accountingEnabled && accountDefaults?.data) {
            const account = await client
              .from("account")
              .select("id, name, isGroup")
              .eq("id", invoiceLine.accountId ?? "")
              .single();

            if (account.error || !account.data)
              throw new Error("Failed to fetch account");
            if (account.data.isGroup)
              throw new Error("Cannot post to a group account");

            journalLineReference = nanoid();

            journalLineInserts.push({
              accountId: account.data.id,
              description: account.data.name!,
              amount: debit("asset", totalLineCostWithWeightedShipping),
              quantity: invoiceLineQuantityInInventoryUnit,
              documentType: "Invoice",
              documentId: purchaseInvoice.data?.id,
              externalDocumentId: purchaseInvoice.data?.supplierReference,
              documentLineReference: invoiceLine.purchaseOrderLineId
                ? journalReference.to.purchaseInvoice(
                    invoiceLine.purchaseOrderLineId
                  )
                : null,
              journalLineReference,
              companyId,
            });

            journalLineInserts.push({
              accountId: accountDefaults.data.payablesAccount,
              description: "Accounts Payable",
              amount: credit("liability", totalLineCostWithWeightedShipping),
              quantity: invoiceLineQuantityInInventoryUnit,
              documentType: "Invoice",
              documentId: purchaseInvoice.data?.id,
              externalDocumentId: purchaseInvoice.data?.supplierReference,
              documentLineReference: invoiceLine.purchaseOrderLineId
                ? journalReference.to.purchaseInvoice(
                    invoiceLine.purchaseOrderLineId
                  )
                : null,
              journalLineReference,
              companyId,
            });

            const glDimMeta = {
              supplierTypeId: null,
              itemPostingGroupId: null,
              itemId: null,
              locationId: invoiceLine.locationId ?? null,
              costCenterId: invoiceLine.costCenterId ?? null,
              processId: null,
              fixedAssetClassId: null,
            };
            journalLineDimensionsMeta.push(glDimMeta, glDimMeta);
          }
          break;
        }
        default:
          throw new Error("Unsupported invoice line type");
      }
    }

    const accountingPeriodId = accountingEnabled
      ? await getCurrentAccountingPeriod(client, companyId, db)
      : null;

    const createdReceiptIds: string[] = [];

    await db.transaction().execute(async (trx) => {
      if (receiptLineInserts.length > 0) {
        const receiptLinesGroupedByLocationId = receiptLineInserts.reduce<
          Record<string, typeof receiptLineInserts>
        >((acc, line) => {
          if (line.locationId) {
            if (line.locationId in acc) {
              acc[line.locationId].push(line);
            } else {
              acc[line.locationId] = [line];
            }
          }

          return acc;
        }, {});

        for await (const [locationId, receiptLines] of Object.entries(
          receiptLinesGroupedByLocationId
        )) {
          const readableReceiptId = await getNextSequence(
            trx,
            "receipt",
            companyId
          );
          const receipt = await trx
            .insertInto("receipt")
            .values({
              receiptId: readableReceiptId,
              locationId,
              sourceDocument: "Purchase Invoice",
              sourceDocumentId: purchaseInvoice.data.id,
              sourceDocumentReadableId: purchaseInvoice.data.invoiceId,
              externalDocumentId: purchaseInvoice.data.supplierReference,
              supplierId: purchaseInvoice.data.supplierId,
              status: skipReceiptPost ? "Draft" : "Posted",
              postingDate: skipReceiptPost ? null : today,
              postedBy: skipReceiptPost ? null : userId,
              invoiced: true,
              companyId,
              createdBy: purchaseInvoice.data.createdBy,
            })
            .returning(["id"])
            .execute();

          const receiptId = receipt[0].id;
          if (!receiptId) throw new Error("Failed to insert receipt");
          createdReceiptIds.push(receiptId);

          await trx
            .insertInto("receiptLine")
            .values(
              receiptLines.map((r) => ({
                ...r,
                receiptId: receiptId,
              }))
            )
            .returning(["id"])
            .execute();
        }
      }

      for await (const [purchaseOrderLineId, update] of Object.entries(
        purchaseOrderLineUpdates
      )) {
        await trx
          .updateTable("purchaseOrderLine")
          .set(update)
          .where("id", "=", purchaseOrderLineId)
          .execute();
      }

      const purchaseOrdersUpdated = Object.values(
        purchaseOrderLineUpdates
      ).reduce<string[]>((acc, update) => {
        if (update.purchaseOrderId && !acc.includes(update.purchaseOrderId)) {
          acc.push(update.purchaseOrderId);
        }
        return acc;
      }, []);

      for await (const purchaseOrderId of purchaseOrdersUpdated) {
        const purchaseOrderLines = await trx
          .selectFrom("purchaseOrderLine")
          .select([
            "id",
            "purchaseOrderLineType",
            "invoicedComplete",
            "receivedComplete",
          ])
          .where("purchaseOrderId", "=", purchaseOrderId)
          .execute();

        const areAllLinesInvoiced = purchaseOrderLines.every(
          (line) =>
            line.purchaseOrderLineType === "Comment" || line.invoicedComplete
        );

        const areAllLinesReceived = purchaseOrderLines.every(
          (line) =>
            line.purchaseOrderLineType === "Comment" ||
            line.purchaseOrderLineType === "G/L Account" ||
            line.purchaseOrderLineType === "Service" ||
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
          .where("id", "=", purchaseOrderId)
          .execute();
      }

      if (accountingEnabled && journalLineInserts.length > 0) {
        const journalEntryId = await getNextSequence(
          trx,
          "journalEntry",
          companyId
        );

        const journal = await trx
          .insertInto("journal")
          .values({
            journalEntryId,
            accountingPeriodId,
            description: `Purchase Invoice ${purchaseInvoice.data?.invoiceId}`,
            postingDate: today,
            companyId,
            sourceType: "Purchase Invoice",
            status: "Posted",
            postedAt: new Date().toISOString(),
            postedBy: userId,
            createdBy: userId,
          })
          .returning(["id"])
          .execute();

        const journalId = journal[0].id;
        if (!journalId) throw new Error("Failed to insert journal");

        const journalLineResults = await trx
          .insertInto("journalLine")
          .values(
            journalLineInserts.map((journalLine) => ({
              ...journalLine,
              journalId,
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
            if (meta.itemId && dimensionMap.has("Item")) {
              journalLineDimensionInserts.push({
                journalLineId: jl.id,
                dimensionId: dimensionMap.get("Item")!,
                valueId: meta.itemId,
                companyId,
              });
            }
            if (
              purchaseInvoice.data?.supplierId &&
              dimensionMap.has("Supplier")
            ) {
              journalLineDimensionInserts.push({
                journalLineId: jl.id,
                dimensionId: dimensionMap.get("Supplier")!,
                valueId: purchaseInvoice.data.supplierId,
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

      if (costLedgerInserts.length > 0) {
        await trx
          .insertInto("costLedger")
          .values(costLedgerInserts)
          .returning(["id"])
          .execute();
      }

      await trx
        .updateTable("purchaseInvoice")
        .set({
          datePaid: today, // TODO: remove this once we have payments working
          postingDate: today,
          status: "Open",
        })
        .where("id", "=", invoiceId)
        .execute();
    });

    return new Response(
      JSON.stringify({
        success: true,
        receiptIds: createdReceiptIds,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(err);
    if (payload.type !== "void" && "invoiceId" in payload) {
      const client = await requirePermissions(req, payload.companyId, payload.userId, { update: "invoicing" });
      await client
        .from("purchaseInvoice")
        .update({ status: "Draft" })
        .eq("id", payload.invoiceId);
    }
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
