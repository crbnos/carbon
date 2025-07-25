import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";
import { credit, debit, journalReference } from "../lib/utils.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import {
  getInventoryPostingGroup,
  getPurchasingPostingGroup,
} from "../shared/get-posting-group.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
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
    const { invoiceId, userId, companyId } = payloadValidator.parse(payload);

    console.log({
      function: "post-purchase-invoice",
      invoiceId,
      userId,
    });
    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const [purchaseInvoice, purchaseInvoiceLines, purchaseInvoiceDelivery] =
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
      ]);

    if (purchaseInvoice.error)
      throw new Error("Failed to fetch purchaseInvoice");
    if (purchaseInvoiceLines.error)
      throw new Error("Failed to fetch receipt lines");
    if (purchaseInvoiceDelivery.error)
      throw new Error("Failed to fetch purchase invoice delivery");

    const shippingCost =
      (purchaseInvoiceDelivery.data?.supplierShippingCost ?? 0) *
      (purchaseInvoice.data?.exchangeRate ?? 1);

    const totalLinesCost = purchaseInvoiceLines.data.reduce(
      (acc, invoiceLine) => {
        const lineCost =
          (invoiceLine.quantity ?? 0) * (invoiceLine.unitPrice ?? 0) +
          (invoiceLine.shippingCost ?? 0) +
          (invoiceLine.taxAmount ?? 0);
        return acc + lineCost;
      },
      0
    );

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
        .select("id, itemTrackingType")
        .in("id", itemIds)
        .eq("companyId", companyId),
      client
        .from("itemCost")
        .select("itemId, itemPostingGroupId")
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

    // save the posting groups in memory to avoid unnecessary queries
    const inventoryPostingGroups: Record<
      string,
      Database["public"]["Tables"]["postingGroupInventory"]["Row"] | null
    > = {};

    // purchasing posting group
    const purchasingPostingGroups: Record<
      string,
      Database["public"]["Tables"]["postingGroupPurchasing"]["Row"] | null
    > = {};

    for await (const invoiceLine of purchaseInvoiceLines.data) {
      const invoiceLineQuantityInInventoryUnit =
        invoiceLine.quantity * (invoiceLine.conversionFactor ?? 1);

      const totalLineCost =
        invoiceLine.quantity * (invoiceLine.unitPrice ?? 0) +
        (invoiceLine.shippingCost ?? 0) +
        (invoiceLine.taxAmount ?? 0);

      const lineCostPercentageOfTotalCost =
        totalLinesCost === 0 ? 0 : totalLineCost / totalLinesCost;
      const lineWeightedShippingCost =
        shippingCost * lineCostPercentageOfTotalCost;
      const totalLineCostWithWeightedShipping =
        totalLineCost + lineWeightedShippingCost;

      const invoiceLineUnitCostInInventoryUnit =
        totalLineCostWithWeightedShipping /
        (invoiceLine.quantity * (invoiceLine.conversionFactor ?? 1));

      // declaring shared variables between part and service cases
      // outside of the switch case to avoid redeclaring them
      let postingGroupInventory:
        | Database["public"]["Tables"]["postingGroupInventory"]["Row"]
        | null = null;

      let itemPostingGroupId: string | null = null;

      let postingGroupPurchasing:
        | Database["public"]["Tables"]["postingGroupPurchasing"]["Row"]
        | null = null;

      const locationId = invoiceLine.locationId ?? null;
      const supplierTypeId: string | null =
        supplier.data.supplierTypeId ?? null;

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

            itemPostingGroupId =
              itemCosts.data.find((item) => item.itemId === invoiceLine.itemId)
                ?.itemPostingGroupId ?? null;

            // inventory posting group
            if (
              `${itemPostingGroupId}-${locationId}` in inventoryPostingGroups
            ) {
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

            if (
              `${itemPostingGroupId}-${supplierTypeId}` in
              purchasingPostingGroups
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

              if (
                purchasingPostingGroup.error ||
                !purchasingPostingGroup.data
              ) {
                throw new Error("Error getting purchasing posting group");
              }

              postingGroupPurchasing = purchasingPostingGroup.data ?? null;
              purchasingPostingGroups[
                `${itemPostingGroupId}-${supplierTypeId}`
              ] = postingGroupPurchasing;
            }

            if (!postingGroupPurchasing) {
              throw new Error("No purchasing posting group found");
            }

            // if the purchase order line is null, we receive the part, do the normal entries and do not use accrual/reversing
            if (invoiceLine.purchaseOrderLineId === null) {
              // create the receipt line
              receiptLineInserts.push({
                itemId: invoiceLine.itemId!,
                lineId: invoiceLine.id,
                orderQuantity: invoiceLineQuantityInInventoryUnit,
                outstandingQuantity: invoiceLineQuantityInInventoryUnit,
                receivedQuantity: invoiceLineQuantityInInventoryUnit,
                locationId: invoiceLine.locationId,
                shelfId: invoiceLine.shelfId,
                unitOfMeasure: invoiceLine.inventoryUnitOfMeasureCode ?? "EA",
                unitPrice: invoiceLine.unitPrice ?? 0,
                createdBy: invoiceLine.createdBy,
                companyId,
              });

              if (itemTrackingType === "Inventory") {
                // create the part ledger line
                itemLedgerInserts.push({
                  postingDate: today,
                  itemId: invoiceLine.itemId!,
                  quantity: invoiceLineQuantityInInventoryUnit,
                  locationId: invoiceLine.locationId,
                  shelfId: invoiceLine.shelfId,
                  entryType: "Positive Adjmt.",
                  documentType: "Purchase Receipt",
                  documentId: purchaseInvoice.data?.id ?? undefined,
                  externalDocumentId:
                    purchaseInvoice.data?.supplierReference ?? undefined,
                  createdBy: userId,
                  companyId,
                });
              }

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
                supplierId: purchaseInvoice.data?.supplierId,
                companyId,
              });

              // create the normal GL entries for a part

              journalLineReference = nanoid();

              if (itemTrackingType === "Inventory") {
                // debit the inventory account
                journalLineInserts.push({
                  accountNumber: postingGroupInventory.inventoryAccount,
                  description: "Inventory Account",
                  amount: debit("asset", totalLineCostWithWeightedShipping),
                  quantity: invoiceLineQuantityInInventoryUnit,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  journalLineReference,
                  companyId,
                });

                // creidt the direct cost applied account
                journalLineInserts.push({
                  accountNumber: postingGroupInventory.directCostAppliedAccount,
                  description: "Direct Cost Applied",
                  amount: credit("expense", totalLineCostWithWeightedShipping),
                  quantity: invoiceLineQuantityInInventoryUnit,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  journalLineReference,
                  companyId,
                });
              } else {
                // debit the overhead account
                journalLineInserts.push({
                  accountNumber: postingGroupInventory.overheadAccount,
                  description: "Overhead Account",
                  amount: debit("asset", totalLineCostWithWeightedShipping),
                  quantity: invoiceLineQuantityInInventoryUnit,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  journalLineReference,
                  companyId,
                });

                // creidt the overhead cost applied account
                journalLineInserts.push({
                  accountNumber:
                    postingGroupInventory.overheadCostAppliedAccount,
                  description: "Overhead Cost Applied",
                  amount: credit("expense", totalLineCostWithWeightedShipping),
                  quantity: invoiceLineQuantityInInventoryUnit,
                  documentType: "Invoice",
                  documentId: purchaseInvoice.data?.id,
                  externalDocumentId: purchaseInvoice.data?.supplierReference,
                  journalLineReference,
                  companyId,
                });
              }

              journalLineReference = nanoid();

              // debit the purchase account
              journalLineInserts.push({
                accountNumber: postingGroupPurchasing.purchaseAccount,
                description: "Purchase Account",
                amount: debit("expense", totalLineCostWithWeightedShipping),
                quantity: invoiceLineQuantityInInventoryUnit,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                externalDocumentId: purchaseInvoice.data?.supplierReference,
                documentLineReference: journalReference.to.purchaseInvoice(
                  invoiceLine.purchaseOrderLineId!
                ),
                journalLineReference,
                companyId,
              });

              // credit the accounts payable account
              journalLineInserts.push({
                accountNumber: postingGroupPurchasing.payablesAccount,
                description: "Accounts Payable",
                amount: credit("liability", totalLineCostWithWeightedShipping),
                quantity: invoiceLineQuantityInInventoryUnit,
                documentType: "Invoice",
                documentId: purchaseInvoice.data?.id,
                externalDocumentId: purchaseInvoice.data?.supplierReference,
                documentLineReference: journalReference.to.purchaseInvoice(
                  invoiceLine.purchaseOrderLineId!
                ),
                journalLineReference,
                companyId,
              });
            } // if the line is associated with a purchase order line, we do accrual/reversing
            else {
              // create the cost entry
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
                supplierId: purchaseInvoice.data?.supplierId,
                companyId,
              });

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

              if (quantityToReverse > 0) {
                let quantityCounted = 0;
                let quantityReversed = 0;

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
                      journalLineReference = nanoid();

                      // create the reversal entries
                      journalLineInserts.push({
                        accountNumber: entry[0].accountNumber!,
                        description: entry[0].description,
                        amount:
                          entry[0].description === "Interim Inventory Accrual"
                            ? credit(
                                "asset",
                                quantityToReverseForEntry * unitCostForEntry
                              )
                            : debit(
                                "liability",
                                quantityToReverseForEntry * unitCostForEntry
                              ),
                        quantity: quantityToReverseForEntry,
                        documentType: "Invoice",
                        documentId: purchaseInvoice.data?.id,
                        externalDocumentId:
                          purchaseInvoice?.data.supplierReference,
                        documentLineReference: invoiceLine.purchaseOrderLineId
                          ? journalReference.to.purchaseInvoice(
                              invoiceLine.purchaseOrderLineId
                            )
                          : null,
                        journalLineReference,
                        companyId,
                      });

                      journalLineInserts.push({
                        accountNumber: entry[1].accountNumber!,
                        description: entry[1].description,
                        amount:
                          entry[1].description === "Interim Inventory Accrual"
                            ? credit(
                                "asset",
                                quantityToReverseForEntry * unitCostForEntry
                              )
                            : debit(
                                "liability",
                                quantityToReverseForEntry * unitCostForEntry
                              ),
                        quantity: quantityToReverseForEntry,
                        documentType: "Invoice",
                        documentId: purchaseInvoice.data?.id,
                        externalDocumentId:
                          purchaseInvoice?.data.supplierReference,
                        documentLineReference:
                          journalReference.to.purchaseInvoice(
                            invoiceLine.purchaseOrderLineId!
                          ),
                        journalLineReference,
                        companyId,
                      });
                    }

                    quantityCounted += entry[0].quantity;
                    quantityReversed += quantityToReverseForEntry;
                  }
                });

                // create the normal GL entries for a part

                journalLineReference = nanoid();

                if (itemTrackingType !== "Non-Inventory") {
                  // debit the inventory account
                  journalLineInserts.push({
                    accountNumber: isOutsideProcessing
                      ? postingGroupInventory.workInProgressAccount
                      : postingGroupInventory.inventoryAccount,
                    description: isOutsideProcessing
                      ? "WIP Account"
                      : "Inventory Account",
                    amount: debit(
                      "asset",
                      quantityToReverse * invoiceLineUnitCostInInventoryUnit
                    ),
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

                  // creidt the direct cost applied account
                  journalLineInserts.push({
                    accountNumber:
                      postingGroupInventory.directCostAppliedAccount,
                    description: "Direct Cost Applied",
                    amount: credit(
                      "expense",
                      quantityToReverse * invoiceLineUnitCostInInventoryUnit
                    ),
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
                } else {
                  // debit the overhead account
                  journalLineInserts.push({
                    accountNumber: postingGroupInventory.overheadAccount,
                    description: "Overhead Account",
                    amount: debit(
                      "asset",
                      quantityToReverse * invoiceLineUnitCostInInventoryUnit
                    ),
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

                  // creidt the overhead cost applied account
                  journalLineInserts.push({
                    accountNumber:
                      postingGroupInventory.overheadCostAppliedAccount,
                    description: "Overhead Cost Applied",
                    amount: credit(
                      "expense",
                      quantityToReverse * invoiceLineUnitCostInInventoryUnit
                    ),
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

                journalLineReference = nanoid();

                // debit the purchase account
                journalLineInserts.push({
                  accountNumber: postingGroupPurchasing.purchaseAccount,
                  description: "Purchase Account",
                  amount: debit(
                    "expense",
                    quantityToReverse * invoiceLineUnitCostInInventoryUnit
                  ),
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

                // credit the accounts payable account
                journalLineInserts.push({
                  accountNumber: postingGroupPurchasing.payablesAccount,
                  description: "Accounts Payable",
                  amount: credit(
                    "liability",
                    quantityToReverse * invoiceLineUnitCostInInventoryUnit
                  ),
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

              if (invoiceLineQuantityInInventoryUnit > quantityToReverse) {
                // create the accrual entries for invoiced not received
                const quantityToAccrue =
                  invoiceLineQuantityInInventoryUnit - quantityToReverse;

                journalLineReference = nanoid();

                // debit the inventory invoiced not received account
                journalLineInserts.push({
                  accountNumber:
                    postingGroupInventory.inventoryInvoicedNotReceivedAccount,
                  description: "Inventory Invoiced Not Received",
                  accrual: true,
                  amount: debit(
                    "asset",
                    quantityToAccrue * invoiceLineUnitCostInInventoryUnit
                  ),
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

                // credit the inventory interim accrual account
                journalLineInserts.push({
                  accountNumber:
                    postingGroupInventory.inventoryInterimAccrualAccount,
                  accrual: true,
                  description: "Interim Inventory Accrual",
                  amount: credit(
                    "asset",
                    quantityToAccrue * invoiceLineUnitCostInInventoryUnit
                  ),
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
            }
          }

          break;
        case "Fixed Asset":
          // TODO: fixed assets
          break;
        case "Comment":
          break;
        case "G/L Account": {
          const [account, accountDefaults] = await Promise.all([
            client
              .from("accounts")
              .select("name, number, directPosting")
              .eq("number", invoiceLine.accountNumber ?? "")
              .eq("companyId", companyId)
              .single(),
            client
              .from("accountDefault")
              .select(
                "overheadCostAppliedAccount, payablesAccount, purchaseAccount"
              )
              .eq("companyId", companyId)
              .single(),
          ]);
          if (account.error || !account.data)
            throw new Error("Failed to fetch account");
          if (!account.data.directPosting)
            throw new Error("Account is not a direct posting account");

          if (accountDefaults.error || !accountDefaults.data)
            throw new Error("Failed to fetch account defaults");

          journalLineReference = nanoid();

          // debit the G/L account
          journalLineInserts.push({
            accountNumber: account.data.number!,
            description: account.data.name!,
            // we limit the account to assets and expenses in the UI, so we don't need to check here
            amount: debit("asset", totalLineCostWithWeightedShipping),
            quantity: invoiceLineQuantityInInventoryUnit,
            documentType: "Invoice",
            documentId: purchaseInvoice.data?.id,
            externalDocumentId: purchaseInvoice.data?.supplierReference,
            documentLineReference: journalReference.to.purchaseInvoice(
              invoiceLine.purchaseOrderLineId!
            ),
            journalLineReference,
            companyId,
          });

          // credit the direct cost applied account
          journalLineInserts.push({
            accountNumber: accountDefaults.data.overheadCostAppliedAccount!,
            description: "Overhead Cost Applied",
            amount: credit("expense", totalLineCostWithWeightedShipping),
            quantity: invoiceLineQuantityInInventoryUnit,
            documentType: "Invoice",
            documentId: purchaseInvoice.data?.id,
            externalDocumentId: purchaseInvoice.data?.supplierReference,
            documentLineReference: journalReference.to.purchaseInvoice(
              invoiceLine.purchaseOrderLineId!
            ),
            journalLineReference,
            companyId,
          });

          journalLineReference = nanoid();

          // debit the purchase account
          journalLineInserts.push({
            accountNumber: accountDefaults.data.purchaseAccount!,
            description: "Purchase Account",
            amount: debit("expense", totalLineCostWithWeightedShipping),
            quantity: invoiceLineQuantityInInventoryUnit,
            documentType: "Invoice",
            documentId: purchaseInvoice.data?.id,
            externalDocumentId: purchaseInvoice.data?.supplierReference,
            documentLineReference: journalReference.to.purchaseInvoice(
              invoiceLine.purchaseOrderLineId!
            ),
            journalLineReference,
            companyId,
          });

          // credit the accounts payable account
          journalLineInserts.push({
            accountNumber: accountDefaults.data.payablesAccount!,
            description: "Accounts Payable",
            amount: credit("liability", totalLineCostWithWeightedShipping),
            quantity: invoiceLineQuantityInInventoryUnit,
            documentType: "Invoice",
            documentId: purchaseInvoice.data?.id,
            externalDocumentId: purchaseInvoice.data?.supplierReference,
            documentLineReference: journalReference.to.purchaseInvoice(
              invoiceLine.purchaseOrderLineId!
            ),
            journalLineReference,
            companyId,
          });
          break;
        }
        default:
          throw new Error("Unsupported invoice line type");
      }
    }

    const accountingPeriodId = await getCurrentAccountingPeriod(
      client,
      companyId,
      db
    );

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
              status: "Posted",
              postingDate: today,
              postedBy: userId,
              invoiced: true,
              companyId,
              createdBy: purchaseInvoice.data.createdBy,
            })
            .returning(["id"])
            .execute();

          const receiptId = receipt[0].id;
          if (!receiptId) throw new Error("Failed to insert receipt");

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
          .where("id", "=", purchaseOrderId)
          .execute();
      }

      const journal = await trx
        .insertInto("journal")
        .values({
          accountingPeriodId,
          description: `Purchase Invoice ${purchaseInvoice.data?.invoiceId}`,
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
          status: "Submitted",
        })
        .where("id", "=", invoiceId)
        .execute();
    });

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
      const client = await getSupabaseServiceRole(
        req.headers.get("Authorization"),
        req.headers.get("carbon-key") ?? "",
        payload.companyId
      );
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
