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
import { getNextSequence } from "../shared/get-next-sequence.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import { calculateCOGS } from "../shared/calculate-cogs.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  invoiceId: z.string(),
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
    const { type, invoiceId, userId, companyId } =
      payloadValidator.parse(payload);

    console.log({
      function: "post-sales-invoice",
      type,
      invoiceId,
      userId,
      companyId,
    });

    const client = await requirePermissions(req, companyId, userId, { update: "invoicing" });

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

    const [salesInvoice, salesInvoiceLines, salesInvoiceShipment] =
      await Promise.all([
        client.from("salesInvoice").select("*").eq("id", invoiceId).single(),
        client.from("salesInvoiceLine").select("*").eq("invoiceId", invoiceId),
        client
          .from("salesInvoiceShipment")
          .select("shippingCost, shippingMethodId")
          .eq("id", invoiceId)
          .single(),
      ]);

    if (salesInvoice.error) throw new Error("Failed to fetch salesInvoice");
    if (salesInvoiceLines.error)
      throw new Error("Failed to fetch shipment lines");
    if (salesInvoiceShipment.error)
      throw new Error("Failed to fetch sales invoice shipment");

    const shippingCost = salesInvoiceShipment.data?.shippingCost ?? 0;

    // Fetch sales order lines (needed by both post and void cases)
    const salesOrderLineIds = salesInvoiceLines.data.reduce<string[]>(
      (acc, invoiceLine) => {
        if (
          invoiceLine.salesOrderLineId &&
          !acc.includes(invoiceLine.salesOrderLineId)
        ) {
          acc.push(invoiceLine.salesOrderLineId);
        }
        return acc;
      },
      []
    );

    const { data: salesOrderLines } = await client
      .from("salesOrderLine")
      .select("*")
      .in("id", salesOrderLineIds);

    if (!salesOrderLines) {
      throw new Error("Failed to fetch sales order lines");
    }

    switch (type) {
      case "post": {
        const totalLinesCost = salesInvoiceLines.data.reduce(
          (acc, invoiceLine) => {
            const lineCost =
              (invoiceLine.quantity ?? 0) * (invoiceLine.unitPrice ?? 0) +
              (invoiceLine.shippingCost ?? 0) +
              (invoiceLine.addOnCost ?? 0);
            return acc + lineCost;
          },
          0
        );

        const itemIds = salesInvoiceLines.data.reduce<string[]>(
          (acc, invoiceLine) => {
            if (invoiceLine.itemId && !acc.includes(invoiceLine.itemId)) {
              acc.push(invoiceLine.itemId);
            }
            return acc;
          },
          []
        );

        const [items, itemCosts, customer] = await Promise.all([
          client
            .from("item")
            .select("id, itemTrackingType")
            .in("id", itemIds)
            .eq("companyId", companyId),
          client
            .from("itemCost")
            .select("itemId, itemPostingGroupId, costingMethod")
            .in("itemId", itemIds),
          client
            .from("customer")
            .select("*")
            .eq("id", salesInvoice.data.customerId ?? "")
            .eq("companyId", companyId)
            .single(),
        ]);
        if (items.error) throw new Error("Failed to fetch items");
        if (itemCosts.error) throw new Error("Failed to fetch item costs");
        if (customer.error) throw new Error("Failed to fetch customer");

        // Detect intercompany transaction
        const isIntercompany =
          customer.data.intercompanyCompanyId != null;
        const intercompanyPartnerId = isIntercompany
          ? customer.data.intercompanyCompanyId
          : null;

        const salesOrders = await client
          .from("salesOrder")
          .select("*")
          .in(
            "salesOrderId",
            salesOrderLines.reduce<string[]>((acc, salesOrderLine) => {
              if (
                salesOrderLine.salesOrderId &&
                !acc.includes(salesOrderLine.salesOrderId)
              ) {
                acc.push(salesOrderLine.salesOrderId);
              }
              return acc;
            }, [])
          )
          .eq("companyId", companyId);

        if (salesOrders.error) throw new Error("Failed to fetch sales orders");

        const journalLineInserts: Omit<
          Database["public"]["Tables"]["journalLine"]["Insert"],
          "journalId"
        >[] = [];

        const shipmentLineInserts: Omit<
          Database["public"]["Tables"]["shipmentLine"]["Insert"],
          "shipmentId"
        >[] = [];

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];

        const salesInvoiceLinesBySalesOrderLine = salesInvoiceLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["salesInvoiceLine"]["Row"]
          >
        >((acc, invoiceLine) => {
          if (invoiceLine.salesOrderLineId) {
            acc[invoiceLine.salesOrderLineId] = invoiceLine;
          }
          return acc;
        }, {});

        const salesOrderLineUpdates = salesOrderLines.reduce<
          Record<
            string,
            Database["public"]["Tables"]["salesOrderLine"]["Update"]
          >
        >((acc, salesOrderLine) => {
          const invoiceLine =
            salesInvoiceLinesBySalesOrderLine[salesOrderLine.id];
          if (
            invoiceLine &&
            invoiceLine.quantity &&
            salesOrderLine.saleQuantity &&
            salesOrderLine.saleQuantity > 0
          ) {
            const newQuantityInvoiced =
              (salesOrderLine.quantityInvoiced ?? 0) + invoiceLine.quantity;

            const invoicedComplete =
              newQuantityInvoiced >=
              (salesOrderLine.quantityToInvoice ?? salesOrderLine.saleQuantity);

            return {
              ...acc,
              [salesOrderLine.id]: {
                quantityInvoiced: newQuantityInvoiced,
                invoicedComplete,
                salesOrderId: salesOrderLine.salesOrderId,
              },
            };
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
                "Customer",
                "Item",
              ])
          : null;

        const dimensionMap = new Map<string, string>();
        if (dimensions?.data) {
          for (const dim of dimensions.data) {
            if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
          }
        }

        const journalLineDimensionsMeta: {
          customerTypeId: string | null;
          itemPostingGroupId: string | null;
          itemId: string | null;
          locationId: string | null;
          costCenterId: string | null;
          fixedAssetClassId: string | null;
        }[] = [];

        // For IC transactions, use IC Receivables (1130) instead of regular AR
        let receivablesAccountId: string | undefined;
        if (isIntercompany && companyGroupId) {
          // TODO: consider storing the IC receivables account ID in a config
          // rather than looking it up by number each time
          const icAccount = await client
            .from("account")
            .select("id")
            .eq("number", "1130")
            .eq("companyGroupId", companyGroupId)
            .single();
          if (icAccount.error) throw new Error("Failed to fetch IC receivables account 1130");
          receivablesAccountId = icAccount.data.id;
        } else {
          receivablesAccountId = accountDefaults?.data?.receivablesAccount;
        }

        // Invoice exchange rate (defaults to 1 for base-currency invoices).
        // journalLine.amount is denominated in base currency, so all monetary
        // amounts derived from the invoice's foreign-currency unitPrice etc.
        // must be multiplied by this rate before they reach a journal line.
        const invoiceExchangeRate = salesInvoice.data?.exchangeRate ?? 1;

        for await (const invoiceLine of salesInvoiceLines.data) {
          const invoiceLineQuantityInInventoryUnit = invoiceLine.quantity;

          const totalLineCost =
            (invoiceLine.quantity * (invoiceLine.unitPrice ?? 0) +
              (invoiceLine.shippingCost ?? 0) +
              (invoiceLine.addOnCost ?? 0)) *
            (1 + (invoiceLine.taxPercent ?? 0));

          const lineCostPercentageOfTotalCost =
            totalLinesCost === 0 ? 0 : totalLineCost / totalLinesCost;
          const lineWeightedShippingCost =
            shippingCost * lineCostPercentageOfTotalCost;
          // Convert to base currency for the GL.
          const totalLineCostWithWeightedShipping =
            (totalLineCost + lineWeightedShippingCost) * invoiceExchangeRate;

          const invoiceLineUnitCostInInventoryUnit =
            totalLineCostWithWeightedShipping / invoiceLine.quantity;

          let journalLineReference: string;

          switch (invoiceLine.invoiceLineType) {
            case "Part":
            case "Service":
            case "Consumable":
            case "Fixture":
            case "Material":
            case "Tool":
              {
                const itemTrackingType =
                  items.data.find((item) => item.id === invoiceLine.itemId)
                    ?.itemTrackingType ?? "Inventory";

                // if the sales order line is null, we ship the part, do the normal entries and do not use accrual/reversing
                if (
                  invoiceLine.salesOrderLineId === null &&
                  invoiceLine.methodType !== "Make to Order"
                ) {
                  // create the shipment line
                  shipmentLineInserts.push({
                    itemId: invoiceLine.itemId!,
                    lineId: invoiceLine.id,
                    orderQuantity: invoiceLineQuantityInInventoryUnit,
                    outstandingQuantity: invoiceLineQuantityInInventoryUnit,
                    shippedQuantity: invoiceLineQuantityInInventoryUnit,
                    locationId: invoiceLine.locationId,
                    storageUnitId: invoiceLine.storageUnitId,
                    unitOfMeasure: invoiceLine.unitOfMeasureCode ?? "EA",
                    unitPrice: invoiceLine.unitPrice ?? 0,
                    createdBy: invoiceLine.createdBy,
                    companyId,
                  });

                  if (itemTrackingType === "Inventory") {
                    // create the part ledger line
                    itemLedgerInserts.push({
                      postingDate: today,
                      itemId: invoiceLine.itemId!,
                      quantity: -invoiceLineQuantityInInventoryUnit,
                      locationId: invoiceLine.locationId,
                      storageUnitId: invoiceLine.storageUnitId,
                      entryType: "Negative Adjmt.",
                      documentType: "Sales Shipment",
                      documentId: salesInvoice.data?.id ?? undefined,
                      externalDocumentId:
                        salesInvoice.data?.customerReference ?? undefined,
                      createdBy: userId,
                      companyId,
                    });
                  }

                  // create the normal GL entries for a part

                  if (accountingEnabled && accountDefaults?.data) {
                    const lineItemPostingGroupId =
                      itemCosts.data.find(
                        (cost) => cost.itemId === invoiceLine.itemId
                      )?.itemPostingGroupId ?? null;

                    journalLineReference = nanoid();

                    // credit the sales account
                    journalLineInserts.push({
                      accountId: accountDefaults.data.salesAccount,
                      description: "Sales Account",
                      amount: credit(
                        "revenue",
                        totalLineCostWithWeightedShipping
                      ),
                      quantity: invoiceLineQuantityInInventoryUnit,
                      documentType: "Invoice",
                      documentId: salesInvoice.data?.id,
                      externalDocumentId: salesInvoice.data?.customerReference,
                      documentLineReference: journalReference.to.salesInvoice(
                        invoiceLine.salesOrderLineId!
                      ),
                      journalLineReference,
                      companyId,
                    });

                    // debit the accounts receivable account
                    journalLineInserts.push({
                      accountId: receivablesAccountId,
                      description: isIntercompany
                        ? "IC Receivables"
                        : "Accounts Receivable",
                      amount: debit("asset", totalLineCostWithWeightedShipping),
                      quantity: invoiceLineQuantityInInventoryUnit,
                      documentType: "Invoice",
                      documentId: salesInvoice.data?.id,
                      externalDocumentId: salesInvoice.data?.customerReference,
                      documentLineReference: journalReference.to.salesInvoice(
                        invoiceLine.salesOrderLineId!
                      ),
                      journalLineReference,
                      intercompanyPartnerId,
                      companyId,
                    });

                    for (let i = 0; i < 2; i++) {
                      journalLineDimensionsMeta.push({
                        customerTypeId: customer.data.customerTypeId ?? null,
                        itemPostingGroupId: lineItemPostingGroupId,
                        itemId: invoiceLine.itemId ?? null,
                        locationId: invoiceLine.locationId ?? null,
                        costCenterId: null,
                        fixedAssetClassId: null,
                      });
                    }

                    if (itemTrackingType === "Inventory") {
                      const cogsJournalLineReference = nanoid();

                      journalLineInserts.push({
                        accountId: accountDefaults.data.costOfGoodsSoldAccount,
                        description: "Cost of Goods Sold",
                        amount: 0,
                        quantity: invoiceLineQuantityInInventoryUnit,
                        documentType: "Invoice",
                        documentId: salesInvoice.data?.id,
                        externalDocumentId: salesInvoice.data?.customerReference,
                        journalLineReference: cogsJournalLineReference,
                        companyId,
                      });

                      journalLineInserts.push({
                        accountId: accountDefaults.data.inventoryAccount,
                        description: "Inventory Account",
                        amount: 0,
                        quantity: invoiceLineQuantityInInventoryUnit,
                        documentType: "Invoice",
                        documentId: salesInvoice.data?.id,
                        externalDocumentId: salesInvoice.data?.customerReference,
                        journalLineReference: cogsJournalLineReference,
                        companyId,
                      });

                      for (let i = 0; i < 2; i++) {
                        journalLineDimensionsMeta.push({
                          customerTypeId: customer.data.customerTypeId ?? null,
                          itemPostingGroupId: lineItemPostingGroupId,
                          itemId: invoiceLine.itemId ?? null,
                          locationId: invoiceLine.locationId ?? null,
                          costCenterId: null,
                          fixedAssetClassId: null,
                        });
                      }
                    }
                  }
                } // if the line is associated with a sales order line, COGS was posted at shipment — keep only AR + Revenue
                else {
                  if (accountingEnabled && accountDefaults?.data) {
                    // Create the normal GL entries for the invoice
                    journalLineReference = nanoid();

                    // Credit the sales account
                    journalLineInserts.push({
                      accountId: accountDefaults.data.salesAccount,
                      description: "Sales Account",
                      amount: credit(
                        "revenue",
                        totalLineCostWithWeightedShipping
                      ),
                      quantity: invoiceLineQuantityInInventoryUnit,
                      documentType: "Invoice",
                      documentId: salesInvoice.data?.id,
                      externalDocumentId: salesInvoice.data?.customerReference,
                      documentLineReference: invoiceLine.salesOrderLineId
                        ? journalReference.to.salesInvoice(
                            invoiceLine.salesOrderLineId
                          )
                        : null,
                      journalLineReference,
                      companyId,
                    });

                    // Debit the accounts receivable account
                    journalLineInserts.push({
                      accountId: receivablesAccountId,
                      description: isIntercompany
                        ? "IC Receivables"
                        : "Accounts Receivable",
                      amount: debit("asset", totalLineCostWithWeightedShipping),
                      quantity: invoiceLineQuantityInInventoryUnit,
                      documentType: "Invoice",
                      documentId: salesInvoice.data?.id,
                      externalDocumentId: salesInvoice.data?.customerReference,
                      documentLineReference: invoiceLine.salesOrderLineId
                        ? journalReference.to.salesInvoice(
                            invoiceLine.salesOrderLineId
                          )
                        : null,
                      journalLineReference,
                      intercompanyPartnerId,
                      companyId,
                    });

                    const itemPostingGroupId =
                      itemCosts.data.find(
                        (cost) => cost.itemId === invoiceLine.itemId
                      )?.itemPostingGroupId ?? null;

                    for (let i = 0; i < 2; i++) {
                      journalLineDimensionsMeta.push({
                        customerTypeId: customer.data.customerTypeId ?? null,
                        itemPostingGroupId,
                        itemId: invoiceLine.itemId ?? null,
                        locationId: invoiceLine.locationId ?? null,
                        costCenterId: null,
                        fixedAssetClassId: null,
                      });
                    }
                  }
                }
              }

              break;
            case "Fixed Asset": {
              if (accountingEnabled && accountDefaults?.data && invoiceLine.assetId) {
                const salesOrderLine = salesOrderLines?.find(
                  (sol) => sol.id === invoiceLine.salesOrderLineId
                );
                const wasShipped = salesOrderLine?.sentComplete === true;
                const saleProceeds = totalLineCostWithWeightedShipping;

                if (wasShipped && invoiceLine.salesOrderLineId) {
                  // Shipment already handled disposal — just post AR/proceeds
                  const assetRecord = await client
                    .from("fixedAsset")
                    .select(
                      "locationId, fixedAssetClassId, fixedAssetClass:fixedAssetClassId(writeOffAccountId)"
                    )
                    .eq("id", invoiceLine.assetId)
                    .single();

                  if (assetRecord.error)
                    throw new Error("Failed to fetch fixed asset");

                  const writeOffAccountId = (
                    assetRecord.data.fixedAssetClass as any
                  ).writeOffAccountId;

                  const arJournalLineReference = nanoid();

                  journalLineInserts.push({
                    accountId: receivablesAccountId,
                    description: "Accounts Receivable",
                    amount: debit("asset", saleProceeds),
                    quantity: invoiceLineQuantityInInventoryUnit,
                    documentType: "Invoice",
                    documentId: salesInvoice.data?.id ?? undefined,
                    externalDocumentId:
                      salesInvoice.data?.customerReference ?? undefined,
                    documentLineReference: journalReference.to.salesInvoice(
                      invoiceLine.salesOrderLineId
                    ),
                    journalLineReference: arJournalLineReference,
                    intercompanyPartnerId,
                    companyId,
                  });

                  journalLineInserts.push({
                    accountId: writeOffAccountId,
                    description: "Disposal proceeds",
                    amount: credit("expense", saleProceeds),
                    quantity: invoiceLineQuantityInInventoryUnit,
                    documentType: "Invoice",
                    documentId: salesInvoice.data?.id ?? undefined,
                    externalDocumentId:
                      salesInvoice.data?.customerReference ?? undefined,
                    documentLineReference: journalReference.to.salesInvoice(
                      invoiceLine.salesOrderLineId
                    ),
                    journalLineReference: arJournalLineReference,
                    intercompanyPartnerId,
                    companyId,
                  });

                  for (let i = 0; i < 2; i++) {
                    journalLineDimensionsMeta.push({
                      customerTypeId: customer.data.customerTypeId ?? null,
                      itemPostingGroupId: null,
                      itemId: null,
                      locationId: invoiceLine.locationId ?? salesOrderLine?.locationId ?? assetRecord.data.locationId ?? null,
                      costCenterId: null,
                      fixedAssetClassId: (assetRecord.data.fixedAssetClass as any)?.id ?? null,
                    });
                  }

                  // Update fixedAssetDisposal with sale proceeds
                  const disposal = await client
                    .from("fixedAssetDisposal")
                    .select("id, netBookValueAtDisposal")
                    .eq("fixedAssetId", invoiceLine.assetId)
                    .order("createdAt", { ascending: false })
                    .limit(1)
                    .single();

                  if (!disposal.error && disposal.data) {
                    const nbv = Number(disposal.data.netBookValueAtDisposal);
                    await client
                      .from("fixedAssetDisposal")
                      .update({
                        saleProceeds,
                        gainLoss: saleProceeds - nbv,
                      })
                      .eq("id", disposal.data.id);
                  }

                  await client
                    .from("fixedAsset")
                    .update({
                      saleProceeds,
                      updatedBy: userId,
                    })
                    .eq("id", invoiceLine.assetId);
                } else {
                  // Direct invoice (no prior shipment) — full disposal + AR
                  const assetRecord = await client
                    .from("fixedAsset")
                    .select(
                      "id, status, acquisitionCost, accumulatedDepreciation, locationId, fixedAssetClass:fixedAssetClassId(id, assetAccountId, accumulatedDepreciationAccountId, writeOffAccountId)"
                    )
                    .eq("id", invoiceLine.assetId)
                    .single();

                  if (assetRecord.error)
                    throw new Error(
                      "Failed to fetch fixed asset for disposal"
                    );

                  const assetClass =
                    assetRecord.data.fixedAssetClass as any;
                  const acquisitionCost =
                    Number(assetRecord.data.acquisitionCost) ?? 0;
                  const accumulatedDepreciation =
                    Number(assetRecord.data.accumulatedDepreciation) ?? 0;
                  const nbv = acquisitionCost - accumulatedDepreciation;

                  if (accumulatedDepreciation > 0) {
                    journalLineReference = nanoid();
                    journalLineInserts.push({
                      accountId:
                        assetClass.accumulatedDepreciationAccountId,
                      description: "Clear accumulated depreciation",
                      amount: debit("asset", accumulatedDepreciation),
                      quantity: 1,
                      documentType: "Invoice",
                      documentId: salesInvoice.data?.id ?? undefined,
                      externalDocumentId:
                        salesInvoice.data?.customerReference ?? undefined,
                      documentLineReference: invoiceLine.salesOrderLineId
                        ? journalReference.to.salesInvoice(
                            invoiceLine.salesOrderLineId
                          )
                        : null,
                      journalLineReference,
                      companyId,
                    });

                    journalLineDimensionsMeta.push({
                      customerTypeId:
                        customer.data.customerTypeId ?? null,
                      itemPostingGroupId: null,
                      itemId: null,
                      locationId: invoiceLine.locationId ?? salesOrderLine?.locationId ?? assetRecord.data.locationId ?? null,
                      costCenterId: null,
                      fixedAssetClassId: (assetRecord.data.fixedAssetClass as any)?.id ?? null,
                    });
                  }

                  if (nbv > 0) {
                    const nbvJournalLineReference = nanoid();
                    journalLineInserts.push({
                      accountId: assetClass.writeOffAccountId,
                      description: "Write-off remaining book value",
                      amount: debit("expense", nbv),
                      quantity: 1,
                      documentType: "Invoice",
                      documentId: salesInvoice.data?.id ?? undefined,
                      externalDocumentId:
                        salesInvoice.data?.customerReference ?? undefined,
                      documentLineReference: invoiceLine.salesOrderLineId
                        ? journalReference.to.salesInvoice(
                            invoiceLine.salesOrderLineId
                          )
                        : null,
                      journalLineReference: nbvJournalLineReference,
                      companyId,
                    });

                    journalLineDimensionsMeta.push({
                      customerTypeId:
                        customer.data.customerTypeId ?? null,
                      itemPostingGroupId: null,
                      itemId: null,
                      locationId: invoiceLine.locationId ?? salesOrderLine?.locationId ?? assetRecord.data.locationId ?? null,
                      costCenterId: null,
                      fixedAssetClassId: (assetRecord.data.fixedAssetClass as any)?.id ?? null,
                    });
                  }

                  const removeJournalLineReference = nanoid();
                  journalLineInserts.push({
                    accountId: assetClass.assetAccountId,
                    description: "Remove asset at cost",
                    amount: credit("asset", acquisitionCost),
                    quantity: 1,
                    documentType: "Invoice",
                    documentId: salesInvoice.data?.id ?? undefined,
                    externalDocumentId:
                      salesInvoice.data?.customerReference ?? undefined,
                    documentLineReference: invoiceLine.salesOrderLineId
                      ? journalReference.to.salesInvoice(
                          invoiceLine.salesOrderLineId
                        )
                      : null,
                    journalLineReference: removeJournalLineReference,
                    companyId,
                  });

                  journalLineDimensionsMeta.push({
                    customerTypeId:
                      customer.data.customerTypeId ?? null,
                    itemPostingGroupId: null,
                    itemId: null,
                    locationId: invoiceLine.locationId ?? salesOrderLine?.locationId ?? null,
                    costCenterId: null,
                    fixedAssetClassId: (assetRecord.data.fixedAssetClass as any)?.id ?? null,
                  });

                  const arJournalLineReference = nanoid();
                  journalLineInserts.push({
                    accountId: receivablesAccountId,
                    description: "Accounts Receivable",
                    amount: debit("asset", saleProceeds),
                    quantity: invoiceLineQuantityInInventoryUnit,
                    documentType: "Invoice",
                    documentId: salesInvoice.data?.id ?? undefined,
                    externalDocumentId:
                      salesInvoice.data?.customerReference ?? undefined,
                    documentLineReference: invoiceLine.salesOrderLineId
                      ? journalReference.to.salesInvoice(
                          invoiceLine.salesOrderLineId
                        )
                      : null,
                    journalLineReference: arJournalLineReference,
                    intercompanyPartnerId,
                    companyId,
                  });

                  journalLineInserts.push({
                    accountId: assetClass.writeOffAccountId,
                    description: "Disposal proceeds",
                    amount: credit("expense", saleProceeds),
                    quantity: invoiceLineQuantityInInventoryUnit,
                    documentType: "Invoice",
                    documentId: salesInvoice.data?.id ?? undefined,
                    externalDocumentId:
                      salesInvoice.data?.customerReference ?? undefined,
                    documentLineReference: invoiceLine.salesOrderLineId
                      ? journalReference.to.salesInvoice(
                          invoiceLine.salesOrderLineId
                        )
                      : null,
                    journalLineReference: arJournalLineReference,
                    intercompanyPartnerId,
                    companyId,
                  });

                  for (let i = 0; i < 2; i++) {
                    journalLineDimensionsMeta.push({
                      customerTypeId:
                        customer.data.customerTypeId ?? null,
                      itemPostingGroupId: null,
                      itemId: null,
                      locationId: invoiceLine.locationId ?? salesOrderLine?.locationId ?? assetRecord.data.locationId ?? null,
                      costCenterId: null,
                      fixedAssetClassId: (assetRecord.data.fixedAssetClass as any)?.id ?? null,
                    });
                  }

                  await client
                    .from("fixedAsset")
                    .update({
                      status: "Disposed",
                      disposalDate: today,
                      disposalMethod: "Sale",
                      saleProceeds,
                      updatedBy: userId,
                    })
                    .eq("id", invoiceLine.assetId);

                  await client.from("fixedAssetDisposal").insert({
                    fixedAssetId: invoiceLine.assetId,
                    disposalMethod: "Sale",
                    disposalDate: today,
                    saleProceeds,
                    netBookValueAtDisposal: nbv,
                    gainLoss: saleProceeds - nbv,
                    companyId,
                    createdBy: userId,
                  });
                }
              }
              break;
            }
            case "Comment":
              break;

            default:
              throw new Error("Unsupported invoice line type");
          }
        }

        const accountingPeriodId = accountingEnabled
          ? await getCurrentAccountingPeriod(client, companyId, db)
          : null;

        await db.transaction().execute(async (trx) => {
          if (shipmentLineInserts.length > 0) {
            const shipmentLinesGroupedByLocationId = shipmentLineInserts.reduce<
              Record<string, typeof shipmentLineInserts>
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

            for await (const [locationId, shipmentLines] of Object.entries(
              shipmentLinesGroupedByLocationId
            )) {
              const readableShipmentId = await getNextSequence(
                trx,
                "shipment",
                companyId
              );
              const shipment = await trx
                .insertInto("shipment")
                .values({
                  shipmentId: readableShipmentId ?? "x",
                  locationId,
                  sourceDocument: "Sales Invoice",
                  sourceDocumentId: salesInvoice.data.id,
                  sourceDocumentReadableId: salesInvoice.data.invoiceId,
                  shippingMethodId: salesInvoiceShipment.data?.shippingMethodId,
                  customerId: salesInvoice.data.customerId,
                  externalDocumentId: salesInvoice.data.customerReference,
                  status: "Posted",
                  postingDate: today,
                  postedBy: userId,
                  invoiced: true,
                  opportunityId: salesInvoice.data.opportunityId,
                  companyId,
                  createdBy: salesInvoice.data.createdBy,
                })
                .returning(["id"])
                .execute();

              const shipmentId = shipment[0].id;
              if (!shipmentId) throw new Error("Failed to insert shipment");

              await trx
                .insertInto("shipmentLine")
                .values(
                  shipmentLines.map((r) => ({
                    ...r,
                    shipmentId: shipmentId,
                  }))
                )
                .returning(["id"])
                .execute();
            }
          }

          for await (const [salesOrderLineId, update] of Object.entries(
            salesOrderLineUpdates
          )) {
            await trx
              .updateTable("salesOrderLine")
              .set(update)
              .where("id", "=", salesOrderLineId)
              .execute();
          }

          const salesOrdersUpdated = Object.values(
            salesOrderLineUpdates
          ).reduce<string[]>((acc, update) => {
            if (update.salesOrderId && !acc.includes(update.salesOrderId)) {
              acc.push(update.salesOrderId);
            }
            return acc;
          }, []);

          for await (const salesOrderId of salesOrdersUpdated) {
            const salesOrderLines = await trx
              .selectFrom("salesOrderLine")
              .selectAll()
              .where("salesOrderId", "=", salesOrderId)
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
            } else if (areAllLinesInvoiced) {
              status = "To Ship";
            } else if (areAllLinesShipped) {
              status = "To Invoice";
            }

            if (areAllLinesInvoiced) {
              await trx
                .updateTable("shipment")
                .set({
                  invoiced: true,
                })
                .where("sourceDocumentId", "=", salesOrderId)
                .execute();
            }

            await trx
              .updateTable("salesOrder")
              .set({
                status,
              })
              .where("id", "=", salesOrderId)
              .execute();
          }

          // Calculate COGS for direct invoice items (no sales order)
          const directInvoiceItems = salesInvoiceLines.data.filter(
            (line) => line.salesOrderLineId === null && line.itemId
          );

          for (const directLine of directInvoiceItems) {
            if (!directLine.itemId) continue;

            const itemTrackingType =
              items.data.find((item) => item.id === directLine.itemId)
                ?.itemTrackingType ?? "Inventory";

            if (itemTrackingType !== "Inventory") continue;

            const cogsResult = await calculateCOGS(trx, {
              itemId: directLine.itemId,
              quantity: directLine.quantity,
              companyId,
            });

            for (let i = 0; i < journalLineInserts.length; i++) {
              const jl = journalLineInserts[i];
              if (
                jl.description === "Cost of Goods Sold" &&
                jl.amount === 0 &&
                jl.quantity === directLine.quantity
              ) {
                journalLineInserts[i].amount = debit("expense", cogsResult.totalCost);
                if (i + 1 < journalLineInserts.length) {
                  journalLineInserts[i + 1].amount = credit("asset", cogsResult.totalCost);
                }

                await trx
                  .insertInto("costLedger")
                  .values({
                    itemLedgerType: "Sale",
                    costLedgerType: "Direct Cost",
                    adjustment: false,
                    documentType: "Sales Shipment",
                    documentId: salesInvoice.data?.id ?? "",
                    itemId: directLine.itemId,
                    quantity: -directLine.quantity,
                    cost: -cogsResult.totalCost,
                    remainingQuantity: 0,
                    companyId,
                  })
                  .execute();

                break;
              }
            }
          }

          let journalLineResults: { id: string }[] = [];
          if (accountingEnabled) {
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
                description: `Sales Invoice ${salesInvoice.data?.invoiceId}`,
                postingDate: today,
                companyId,
                sourceType: "Sales Invoice",
                status: "Posted",
                postedAt: new Date().toISOString(),
                postedBy: userId,
                createdBy: userId,
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            if (journalLineInserts.length > 0) {
              journalLineResults = await trx
                .insertInto("journalLine")
                .values(
                  journalLineInserts.map((line) => ({
                    ...line,
                    journalId: journalResult.id,
                  }))
                )
                .returning(["id"])
                .execute();
            }

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
                if (meta.itemId && dimensionMap.has("Item")) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("Item")!,
                    valueId: meta.itemId,
                    companyId,
                  });
                }
                if (salesInvoice.data?.customerId && dimensionMap.has("Customer")) {
                  journalLineDimensionInserts.push({
                    journalLineId: jl.id,
                    dimensionId: dimensionMap.get("Customer")!,
                    valueId: salesInvoice.data.customerId,
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

          if (salesInvoice.data.shipmentId) {
            await trx
              .updateTable("shipment")
              .set({
                invoiced: true,
              })
              .where("id", "=", salesInvoice.data.shipmentId)
              .execute();
          }

          // Create intercompany transaction record if IC
          if (accountingEnabled && isIntercompany && intercompanyPartnerId) {
            const icJournalLineId = journalLineResults.length > 0
              ? journalLineResults[0].id
              : null;

            await trx
              .insertInto("intercompanyTransaction")
              .values({
                companyGroupId: companyGroupId!,
                sourceCompanyId: companyId,
                targetCompanyId: intercompanyPartnerId,
                sourceJournalLineId: icJournalLineId,
                amount: totalLinesCost,
                currencyCode: salesInvoice.data?.currencyCode ?? "USD",
                description: `Sales Invoice ${salesInvoice.data?.invoiceId}`,
                documentType: "Invoice",
                documentId: salesInvoice.data?.id,
                status: "Unmatched",
              })
              .execute();
          }

          await trx
            .updateTable("salesInvoice")
            .set({
              dateIssued: today,
              postingDate: today,
              status: "Submitted",
            })
            .where("id", "=", invoiceId)
            .execute();
        });
        break;
      }

      case "void": {
        // Get journal entries to reverse
        const { data: journalEntries } = await client
          .from("journalLine")
          .select("*")
          .eq("documentId", invoiceId)
          .eq("documentType", "Invoice");

        if (!journalEntries) {
          throw new Error("No journal entries found for invoice");
        }

        // Get shipments created from this invoice
        const { data: invoiceShipments } = await client
          .from("shipment")
          .select("id")
          .eq("sourceDocument", "Sales Invoice")
          .eq("sourceDocumentId", invoiceId);

        const salesOrderLinesBySalesOrderLineId = salesOrderLines.reduce<
          Record<string, Database["public"]["Tables"]["salesOrderLine"]["Row"]>
        >((acc, salesOrderLine) => {
          acc[salesOrderLine.id] = salesOrderLine;
          return acc;
        }, {});

        // Reverse sales order line updates
        const salesOrderLineUpdates = salesInvoiceLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["salesOrderLine"]["Update"]
          >
        >((acc, invoiceLine) => {
          const salesOrderLine =
            salesOrderLinesBySalesOrderLineId[
              invoiceLine.salesOrderLineId ?? ""
            ];
          if (
            invoiceLine.salesOrderLineId &&
            salesOrderLine &&
            invoiceLine.quantity &&
            salesOrderLine.saleQuantity &&
            salesOrderLine.saleQuantity > 0
          ) {
            const newQuantityInvoiced = Math.max(
              0,
              (salesOrderLine.quantityInvoiced ?? 0) - invoiceLine.quantity
            );

            const invoicedComplete =
              newQuantityInvoiced >= salesOrderLine.saleQuantity;

            const updates: Database["public"]["Tables"]["salesOrderLine"]["Update"] =
              {
                quantityInvoiced: newQuantityInvoiced,
                invoicedComplete,
                salesOrderId: salesOrderLine.salesOrderId,
              };

            return {
              ...acc,
              [invoiceLine.salesOrderLineId]: updates,
            };
          }

          return acc;
        }, {});

        // Create reversing journal entries
        const reversingJournalEntries = accountingEnabled
          ? journalEntries.map((entry) => ({
              accountId: entry.accountId,
              description: `VOID: ${entry.description}`,
              amount: -entry.amount, // Reverse the amount
              quantity: -entry.quantity,
              documentType: "Invoice" as const,
              documentId: salesInvoice.data?.id,
              externalDocumentId: entry.externalDocumentId,
              documentLineReference: entry.documentLineReference,
              journalLineReference: entry.journalLineReference,
              companyId,
            }))
          : [];

        // Create reversing item ledger entries
        const reversingItemLedgerEntries: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];

        const { data: originalItemLedgerEntries } = await client
          .from("itemLedger")
          .select("*")
          .eq("documentId", invoiceId)
          .eq("documentType", "Sales Shipment");

        if (originalItemLedgerEntries) {
          originalItemLedgerEntries.forEach((entry) => {
            reversingItemLedgerEntries.push({
              postingDate: today,
              itemId: entry.itemId,
              quantity: -entry.quantity, // Reverse the quantity
              locationId: entry.locationId,
              storageUnitId: entry.storageUnitId,
              entryType:
                entry.entryType === "Negative Adjmt."
                  ? "Positive Adjmt."
                  : "Negative Adjmt.",
              documentType: "Sales Shipment",
              documentId: salesInvoice.data?.id ?? undefined,
              externalDocumentId: entry.externalDocumentId,
              createdBy: userId,
              companyId,
            });
          });
        }

        const accountingPeriodId = accountingEnabled
          ? await getCurrentAccountingPeriod(client, companyId, db)
          : null;

        await db.transaction().execute(async (trx) => {
          // Update sales order lines to reverse invoiced quantities
          for await (const [salesOrderLineId, update] of Object.entries(
            salesOrderLineUpdates
          )) {
            await trx
              .updateTable("salesOrderLine")
              .set(update)
              .where("id", "=", salesOrderLineId)
              .execute();
          }

          // Update sales orders status - fetch fresh data after updates
          const salesOrdersUpdated = Object.values(
            salesOrderLineUpdates
          ).reduce<string[]>((acc, update) => {
            if (update.salesOrderId && !acc.includes(update.salesOrderId)) {
              acc.push(update.salesOrderId);
            }
            return acc;
          }, []);

          for await (const salesOrderId of salesOrdersUpdated) {
            // Fetch fresh data after the sales order line updates
            const salesOrderLines = await trx
              .selectFrom("salesOrderLine")
              .selectAll()
              .where("salesOrderId", "=", salesOrderId)
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
            } else if (areAllLinesInvoiced) {
              status = "To Ship";
            } else if (areAllLinesShipped) {
              status = "To Invoice";
            }

            // If no lines are invoiced anymore, remove invoiced flag from shipments
            if (!areAllLinesInvoiced) {
              await trx
                .updateTable("shipment")
                .set({
                  invoiced: false,
                })
                .where("sourceDocumentId", "=", salesOrderId)
                .execute();
            }

            await trx
              .updateTable("salesOrder")
              .set({
                status,
              })
              .where("id", "=", salesOrderId)
              .execute();
          }

          if (accountingEnabled) {
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
                description: `VOID Sales Invoice ${salesInvoice.data?.invoiceId}`,
                postingDate: today,
                companyId,
                sourceType: "Sales Invoice",
                status: "Posted",
                postedAt: new Date().toISOString(),
                postedBy: userId,
                createdBy: userId,
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            if (reversingJournalEntries.length > 0) {
              await trx
                .insertInto("journalLine")
                .values(
                  reversingJournalEntries.map((line) => ({
                    ...line,
                    journalId: voidJournalResult.id,
                  }))
                )
                .returning(["id"])
                .execute();
            }
          }

          // Insert reversing item ledger entries
          if (reversingItemLedgerEntries.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(reversingItemLedgerEntries)
              .returning(["id"])
              .execute();
          }

          // Delete invoice-created shipments
          if (invoiceShipments && invoiceShipments.length > 0) {
            for (const shipment of invoiceShipments) {
              await trx
                .updateTable("shipment")
                .set({
                  invoiced: false,
                  status: "Voided",
                  updatedAt: today,
                  updatedBy: userId,
                })
                .where("id", "=", shipment.id)
                .execute();
            }
          }

          // Remove invoiced flag from related shipment if it exists
          if (salesInvoice.data.shipmentId) {
            await trx
              .updateTable("shipment")
              .set({
                invoiced: false,
              })
              .where("id", "=", salesInvoice.data.shipmentId)
              .execute();
          }

          // Update invoice status to voided
          await trx
            .updateTable("salesInvoice")
            .set({
              status: "Voided",
              updatedAt: today,
              updatedBy: userId,
            })
            .where("id", "=", invoiceId)
            .execute();
        });

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
    if ("invoiceId" in payload) {
      const client = await requirePermissions(req, payload.companyId, payload.userId, { update: "invoicing" });
      await client
        .from("salesInvoice")
        .update({ status: "Draft" })
        .eq("id", payload.invoiceId);
    }
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
