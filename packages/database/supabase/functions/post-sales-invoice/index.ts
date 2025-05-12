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
  getSalesPostingGroup,
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
      function: "post-sales-invoice",
      invoiceId,
      userId,
    });
    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const [salesInvoice, salesInvoiceLines, salesInvoiceShipment] =
      await Promise.all([
        client.from("salesInvoice").select("*").eq("id", invoiceId).single(),
        client.from("salesInvoiceLine").select("*").eq("invoiceId", invoiceId),
        client
          .from("salesInvoiceShipment")
          .select("shippingCost")
          .eq("id", invoiceId)
          .single(),
      ]);

    if (salesInvoice.error) throw new Error("Failed to fetch salesInvoice");
    if (salesInvoiceLines.error)
      throw new Error("Failed to fetch shipment lines");
    if (salesInvoiceShipment.error)
      throw new Error("Failed to fetch sales invoice shipment");

    const shippingCost = salesInvoiceShipment.data?.shippingCost ?? 0;

    const totalLinesCost = salesInvoiceLines.data.reduce((acc, invoiceLine) => {
      const lineCost =
        (invoiceLine.quantity ?? 0) * (invoiceLine.unitPrice ?? 0) +
        (invoiceLine.shippingCost ?? 0) +
        (invoiceLine.addOnCost ?? 0);
      return acc + lineCost;
    }, 0);

    const itemIds = salesInvoiceLines.data.reduce<string[]>(
      (acc, invoiceLine) => {
        if (invoiceLine.itemId && !acc.includes(invoiceLine.itemId)) {
          acc.push(invoiceLine.itemId);
        }
        return acc;
      },
      []
    );

    const [items, itemCosts, salesOrderLines, customer] = await Promise.all([
      client
        .from("item")
        .select("id, itemTrackingType, readableId")
        .in("id", itemIds)
        .eq("companyId", companyId),
      client
        .from("itemCost")
        .select("itemId, itemPostingGroupId")
        .in("itemId", itemIds),
      client
        .from("salesOrderLine")
        .select("*")
        .in(
          "id",
          salesInvoiceLines.data.reduce<string[]>((acc, invoiceLine) => {
            if (
              invoiceLine.salesOrderLineId &&
              !acc.includes(invoiceLine.salesOrderLineId)
            ) {
              acc.push(invoiceLine.salesOrderLineId);
            }
            return acc;
          }, [])
        ),
      client
        .from("customer")
        .select("*")
        .eq("id", salesInvoice.data.customerId ?? "")
        .eq("companyId", companyId)
        .single(),
    ]);
    if (items.error) throw new Error("Failed to fetch items");
    if (itemCosts.error) throw new Error("Failed to fetch item costs");
    if (salesOrderLines.error)
      throw new Error("Failed to fetch sales order lines");
    if (customer.error) throw new Error("Failed to fetch customer");

    const salesOrders = await client
      .from("salesOrder")
      .select("*")
      .in(
        "salesOrderId",
        salesOrderLines.data.reduce<string[]>((acc, salesOrderLine) => {
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
      Record<string, Database["public"]["Tables"]["salesInvoiceLine"]["Row"]>
    >((acc, invoiceLine) => {
      if (invoiceLine.salesOrderLineId) {
        acc[invoiceLine.salesOrderLineId] = invoiceLine;
      }
      return acc;
    }, {});

    const salesOrderLineUpdates = salesOrderLines.data.reduce<
      Record<string, Database["public"]["Tables"]["salesOrderLine"]["Update"]>
    >((acc, salesOrderLine) => {
      const invoiceLine = salesInvoiceLinesBySalesOrderLine[salesOrderLine.id];
      if (
        invoiceLine &&
        invoiceLine.quantity &&
        salesOrderLine.saleQuantity &&
        salesOrderLine.saleQuantity > 0
      ) {
        const newQuantityInvoiced =
          (salesOrderLine.quantityInvoiced ?? 0) + invoiceLine.quantity;

        const invoicedComplete =
          salesOrderLine.invoicedComplete ||
          invoiceLine.quantity >=
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

    const journalLines = await client
      .from("journalLine")
      .select("*")
      .in(
        "documentLineReference",
        salesOrderLines.data.reduce<string[]>((acc, salesOrderLine) => {
          if (
            (salesOrderLine.quantitySent ?? 0) >
            (salesOrderLine.quantityInvoiced ?? 0)
          ) {
            acc.push(journalReference.to.shipment(salesOrderLine.id));
          }
          return acc;
        }, [])
      )
      .eq("companyId", companyId);
    if (journalLines.error) {
      throw new Error("Failed to fetch journal entries to reverse");
    }

    const journalLinesBySalesOrderLine = journalLines.data.reduce<
      Record<string, Database["public"]["Tables"]["journalLine"]["Row"][]>
    >((acc, journalEntry) => {
      const [type, salesOrderLineId] = (
        journalEntry.documentLineReference ?? ""
      ).split(":");
      if (type === "shipment") {
        if (acc[salesOrderLineId] && Array.isArray(acc[salesOrderLineId])) {
          acc[salesOrderLineId].push(journalEntry);
        } else {
          acc[salesOrderLineId] = [journalEntry];
        }
      }
      return acc;
    }, {});

    // save the posting groups in memory to avoid unnecessary queries
    const inventoryPostingGroups: Record<
      string,
      Database["public"]["Tables"]["postingGroupInventory"]["Row"] | null
    > = {};

    // sales posting group
    const salesPostingGroups: Record<
      string,
      Database["public"]["Tables"]["postingGroupSales"]["Row"] | null
    > = {};

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
      const totalLineCostWithWeightedShipping =
        totalLineCost + lineWeightedShippingCost;

      const invoiceLineUnitCostInInventoryUnit =
        totalLineCostWithWeightedShipping / invoiceLine.quantity;

      // declaring shared variables between part and service cases
      // outside of the switch case to avoid redeclaring them
      let postingGroupInventory:
        | Database["public"]["Tables"]["postingGroupInventory"]["Row"]
        | null = null;

      let itemPostingGroupId: string | null = null;

      let postingGroupSales:
        | Database["public"]["Tables"]["postingGroupSales"]["Row"]
        | null = null;

      const locationId = invoiceLine.locationId ?? null;
      const customerTypeId: string | null =
        customer.data.customerTypeId ?? null;

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
              `${itemPostingGroupId}-${customerTypeId}` in salesPostingGroups
            ) {
              postingGroupSales =
                salesPostingGroups[`${itemPostingGroupId}-${customerTypeId}`];
            } else {
              const salesPostingGroup = await getSalesPostingGroup(
                client,
                companyId,
                {
                  itemPostingGroupId,
                  customerTypeId,
                }
              );

              if (salesPostingGroup.error || !salesPostingGroup.data) {
                throw new Error("Error getting sales posting group");
              }

              postingGroupSales = salesPostingGroup.data ?? null;
              salesPostingGroups[`${itemPostingGroupId}-${customerTypeId}`] =
                postingGroupSales;
            }

            if (!postingGroupSales) {
              throw new Error("No sales posting group found");
            }

            // if the sales order line is null, we ship the part, do the normal entries and do not use accrual/reversing
            if (invoiceLine.salesOrderLineId === null) {
              // create the shipment line
              shipmentLineInserts.push({
                itemId: invoiceLine.itemId!,
                lineId: invoiceLine.id,
                orderQuantity: invoiceLineQuantityInInventoryUnit,
                outstandingQuantity: invoiceLineQuantityInInventoryUnit,
                shippedQuantity: invoiceLineQuantityInInventoryUnit,
                locationId: invoiceLine.locationId,
                shelfId: invoiceLine.shelfId,
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
                  itemReadableId: invoiceLine.itemReadableId!,
                  quantity: invoiceLineQuantityInInventoryUnit,
                  locationId: invoiceLine.locationId,
                  shelfId: invoiceLine.shelfId,
                  entryType: "Negative Adjmt.",
                  documentType: "Sales Shipment",
                  documentId: salesInvoice.data?.id ?? undefined,
                  externalDocumentId:
                    salesInvoice.data?.customerReference ?? undefined,
                  createdBy: userId,
                  companyId,
                });
              }

              // create the cost ledger line
              costLedgerInserts.push({
                itemLedgerType: "Sales",
                costLedgerType: "Direct Cost",
                adjustment: false,
                documentType: "Sales Invoice",
                documentId: salesInvoice.data?.id ?? undefined,
                externalDocumentId:
                  salesInvoice.data?.customerReference ?? undefined,
                itemId: invoiceLine.itemId,
                quantity: invoiceLineQuantityInInventoryUnit,
                nominalCost:
                  invoiceLine.quantity * (invoiceLine.unitPrice ?? 0),
                cost: totalLineCostWithWeightedShipping,
                customerId: salesInvoice.data?.customerId,
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
                  documentId: salesInvoice.data?.id,
                  externalDocumentId: salesInvoice.data?.customerReference,
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
                  documentId: salesInvoice.data?.id,
                  externalDocumentId: salesInvoice.data?.customerReference,
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
                  documentId: salesInvoice.data?.id,
                  externalDocumentId: salesInvoice.data?.customerReference,
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
                  documentId: salesInvoice.data?.id,
                  externalDocumentId: salesInvoice.data?.customerReference,
                  journalLineReference,
                  companyId,
                });
              }

              journalLineReference = nanoid();

              // debit the sales account
              journalLineInserts.push({
                accountNumber: postingGroupSales.salesAccount,
                description: "Sales Account",
                amount: debit("expense", totalLineCostWithWeightedShipping),
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

              // credit the accounts payable account
              journalLineInserts.push({
                accountNumber: postingGroupSales.payablesAccount,
                description: "Accounts Payable",
                amount: credit("liability", totalLineCostWithWeightedShipping),
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
            } // if the line is associated with a sales order line, we do accrual/reversing
            else {
              // create the cost entry
              costLedgerInserts.push({
                itemLedgerType: "Sales",
                costLedgerType: "Direct Cost",
                adjustment: false,
                documentType: "Sales Invoice",
                documentId: salesInvoice.data?.id ?? undefined,
                externalDocumentId:
                  salesInvoice.data?.customerReference ?? undefined,
                itemId: invoiceLine.itemId,
                quantity: invoiceLineQuantityInInventoryUnit,
                nominalCost:
                  invoiceLine.quantity * (invoiceLine.unitPrice ?? 0),
                cost: totalLineCostWithWeightedShipping,
                customerId: salesInvoice.data?.customerId,
                companyId,
              });

              // determine the journal lines that should be reversed
              const existingJournalLines = invoiceLine.salesOrderLineId
                ? journalLinesBySalesOrderLine[invoiceLine.salesOrderLineId] ??
                  []
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

              const salesOrderLine = salesOrderLines.data.find(
                (line) => line.id === invoiceLine.salesOrderLineId
              );

              const quantitySent = salesOrderLine?.quantitySent ?? 0;

              const quantityInvoiced = salesOrderLine?.quantityInvoiced ?? 0;

              const quantityToReverse = Math.max(
                0,
                Math.min(
                  invoiceLineQuantityInInventoryUnit,
                  quantitySent - quantityInvoiced
                )
              );

              const quantityAlreadyReversed =
                quantitySent > quantityInvoiced ? quantityInvoiced : 0;

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
                        documentId: salesInvoice.data?.id,
                        externalDocumentId:
                          salesInvoice?.data.customerReference,
                        documentLineReference: invoiceLine.salesOrderLineId
                          ? journalReference.to.salesInvoice(
                              invoiceLine.salesOrderLineId
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
                        documentId: salesInvoice.data?.id,
                        externalDocumentId:
                          salesInvoice?.data.customerReference,
                        documentLineReference: journalReference.to.salesInvoice(
                          invoiceLine.salesOrderLineId!
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
                    documentId: salesInvoice.data?.id,
                    externalDocumentId: salesInvoice.data?.customerReference,
                    documentLineReference: journalReference.to.salesInvoice(
                      invoiceLine.salesOrderLineId!
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
                    documentId: salesInvoice.data?.id,
                    externalDocumentId: salesInvoice.data?.customerReference,
                    documentLineReference: journalReference.to.salesInvoice(
                      invoiceLine.salesOrderLineId!
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
                    documentId: salesInvoice.data?.id,
                    externalDocumentId: salesInvoice.data?.customerReference,
                    documentLineReference: journalReference.to.salesInvoice(
                      invoiceLine.salesOrderLineId!
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
                    documentId: salesInvoice.data?.id,
                    externalDocumentId: salesInvoice.data?.customerReference,
                    documentLineReference: journalReference.to.salesInvoice(
                      invoiceLine.salesOrderLineId!
                    ),
                    journalLineReference,
                    companyId,
                  });
                }

                journalLineReference = nanoid();

                // debit the sales account
                journalLineInserts.push({
                  accountNumber: postingGroupSales.salesAccount,
                  description: "Sales Account",
                  amount: debit(
                    "expense",
                    quantityToReverse * invoiceLineUnitCostInInventoryUnit
                  ),
                  quantity: quantityToReverse,
                  documentType: "Invoice",
                  documentId: salesInvoice.data?.id,
                  externalDocumentId: salesInvoice.data?.customerReference,
                  documentLineReference: journalReference.to.salesInvoice(
                    invoiceLine.salesOrderLineId!
                  ),
                  journalLineReference,
                  companyId,
                });

                // credit the accounts payable account
                journalLineInserts.push({
                  accountNumber: postingGroupSales.payablesAccount,
                  description: "Accounts Payable",
                  amount: credit(
                    "liability",
                    quantityToReverse * invoiceLineUnitCostInInventoryUnit
                  ),
                  quantity: quantityToReverse,
                  documentType: "Invoice",
                  documentId: salesInvoice.data?.id,
                  externalDocumentId: salesInvoice.data?.customerReference,
                  documentLineReference: journalReference.to.salesInvoice(
                    invoiceLine.salesOrderLineId!
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
                "overheadCostAppliedAccount, payablesAccount, salesAccount"
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
            documentId: salesInvoice.data?.id,
            externalDocumentId: salesInvoice.data?.customerReference,
            documentLineReference: journalReference.to.salesInvoice(
              invoiceLine.salesOrderLineId!
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
            documentId: salesInvoice.data?.id,
            externalDocumentId: salesInvoice.data?.customerReference,
            documentLineReference: journalReference.to.salesInvoice(
              invoiceLine.salesOrderLineId!
            ),
            journalLineReference,
            companyId,
          });

          journalLineReference = nanoid();

          // debit the sales account
          journalLineInserts.push({
            accountNumber: accountDefaults.data.salesAccount!,
            description: "Sales Account",
            amount: debit("expense", totalLineCostWithWeightedShipping),
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

          // credit the accounts payable account
          journalLineInserts.push({
            accountNumber: accountDefaults.data.payablesAccount!,
            description: "Accounts Payable",
            amount: credit("liability", totalLineCostWithWeightedShipping),
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
          const readableReceiptId = await getNextSequence(
            trx,
            "shipment",
            companyId
          );
          const shipment = await trx
            .insertInto("shipment")
            .values({
              shipmentId: readableReceiptId,
              locationId,
              sourceDocument: "Sales Invoice",
              sourceDocumentId: salesInvoice.data.id,
              sourceDocumentReadableId: salesInvoice.data.invoiceId,
              externalDocumentId: salesInvoice.data.customerReference,
              customerId: salesInvoice.data.customerId,
              status: "Posted",
              postingDate: today,
              postedBy: userId,
              invoiced: true,
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

      const salesOrdersUpdated = Object.values(salesOrderLineUpdates).reduce<
        string[]
      >((acc, update) => {
        if (update.salesOrderId && !acc.includes(update.salesOrderId)) {
          acc.push(update.salesOrderId);
        }
        return acc;
      }, []);

      for await (const salesOrderId of salesOrdersUpdated) {
        const salesOrderLines = await trx
          .selectFrom("salesOrderLine")
          .select([
            "id",
            "salesOrderLineType",
            "invoicedComplete",
            "receivedComplete",
          ])
          .where("salesOrderId", "=", salesOrderId)
          .execute();

        const areAllLinesInvoiced = salesOrderLines.every(
          (line) =>
            line.salesOrderLineType === "Comment" || line.invoicedComplete
        );

        const areAllLinesReceived = salesOrderLines.every(
          (line) =>
            line.salesOrderLineType === "Comment" || line.receivedComplete
        );

        let status: Database["public"]["Tables"]["salesOrder"]["Row"]["status"] =
          "To Receive and Invoice";

        if (areAllLinesInvoiced && areAllLinesReceived) {
          status = "Completed";
        } else if (areAllLinesInvoiced) {
          status = "To Receive";
        } else if (areAllLinesReceived) {
          status = "To Invoice";
        }

        await trx
          .updateTable("salesOrder")
          .set({
            status,
          })
          .where("id", "=", salesOrderId)
          .execute();
      }

      const journal = await trx
        .insertInto("journal")
        .values({
          accountingPeriodId,
          description: `Sales Invoice ${salesInvoice.data?.invoiceId}`,
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
        .updateTable("salesInvoice")
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
