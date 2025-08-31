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
            .select("itemId, itemPostingGroupId")
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
                  itemCosts.data.find(
                    (item) => item.itemId === invoiceLine.itemId
                  )?.itemPostingGroupId ?? null;

                // inventory posting group
                if (
                  `${itemPostingGroupId}-${locationId}` in
                  inventoryPostingGroups
                ) {
                  postingGroupInventory =
                    inventoryPostingGroups[
                      `${itemPostingGroupId}-${locationId}`
                    ];
                } else {
                  const inventoryPostingGroup = await getInventoryPostingGroup(
                    client,
                    companyId,
                    {
                      itemPostingGroupId,
                      locationId,
                    }
                  );

                  if (
                    inventoryPostingGroup.error ||
                    !inventoryPostingGroup.data
                  ) {
                    throw new Error("Error getting inventory posting group");
                  }

                  postingGroupInventory = inventoryPostingGroup.data ?? null;
                  inventoryPostingGroups[
                    `${itemPostingGroupId}-${locationId}`
                  ] = postingGroupInventory;
                }

                if (!postingGroupInventory) {
                  throw new Error("No inventory posting group found");
                }

                if (
                  `${itemPostingGroupId}-${customerTypeId}` in
                  salesPostingGroups
                ) {
                  postingGroupSales =
                    salesPostingGroups[
                      `${itemPostingGroupId}-${customerTypeId}`
                    ];
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
                  salesPostingGroups[
                    `${itemPostingGroupId}-${customerTypeId}`
                  ] = postingGroupSales;
                }

                if (!postingGroupSales) {
                  throw new Error("No sales posting group found");
                }

                // if the sales order line is null, we ship the part, do the normal entries and do not use accrual/reversing
                if (
                  invoiceLine.salesOrderLineId === null &&
                  invoiceLine.methodType !== "Make"
                ) {
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
                      quantity: -invoiceLineQuantityInInventoryUnit,
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

                  // create the normal GL entries for a part

                  journalLineReference = nanoid();

                  if (itemTrackingType === "Inventory") {
                    // debit the inventory account
                    journalLineInserts.push({
                      accountNumber: postingGroupInventory.inventoryAccount,
                      description: "Inventory Account",
                      amount: credit(
                        "asset",
                        totalLineCostWithWeightedShipping
                      ),
                      quantity: invoiceLineQuantityInInventoryUnit,
                      documentType: "Invoice",
                      documentId: salesInvoice.data?.id,
                      externalDocumentId: salesInvoice.data?.customerReference,
                      journalLineReference,
                      companyId,
                    });

                    // creidt the cost of goods sold account
                    journalLineInserts.push({
                      accountNumber:
                        postingGroupInventory.costOfGoodsSoldAccount,
                      description: "Cost of Goods Sold",
                      amount: debit(
                        "expense",
                        totalLineCostWithWeightedShipping
                      ),
                      quantity: invoiceLineQuantityInInventoryUnit,
                      documentType: "Invoice",
                      documentId: salesInvoice.data?.id,
                      externalDocumentId: salesInvoice.data?.customerReference,
                      journalLineReference,
                      companyId,
                    });
                  }

                  journalLineReference = nanoid();

                  // credit the sales account
                  journalLineInserts.push({
                    accountNumber: postingGroupSales.salesAccount,
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
                    accountNumber: postingGroupSales.receivablesAccount,
                    description: "Accounts Receivable",
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
                } // if the line is associated with a sales order line, we do accrual/reversing
                else {
                  // Create the normal GL entries for the invoice
                  journalLineReference = nanoid();

                  // Credit the sales account
                  journalLineInserts.push({
                    accountNumber: postingGroupSales.salesAccount,
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
                    accountNumber: postingGroupSales.receivablesAccount,
                    description: "Accounts Receivable",
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
                    companyId,
                  });

                  // For inventory items, handle COGS and inventory
                  if (itemTrackingType !== "Non-Inventory") {
                    journalLineReference = nanoid();

                    // Debit cost of goods sold
                    journalLineInserts.push({
                      accountNumber:
                        postingGroupInventory.costOfGoodsSoldAccount,
                      description: "Cost of Goods Sold",
                      amount: debit(
                        "expense",
                        invoiceLineQuantityInInventoryUnit *
                          invoiceLineUnitCostInInventoryUnit
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

                    // Credit inventory account
                    journalLineInserts.push({
                      accountNumber: postingGroupInventory.inventoryAccount,
                      description: "Inventory Account",
                      amount: credit(
                        "asset",
                        invoiceLineQuantityInInventoryUnit *
                          invoiceLineUnitCostInInventoryUnit
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
                  }
                }
              }

              break;
            case "Fixed Asset":
              // TODO: fixed assets
              break;
            case "Comment":
              break;

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

          if (salesInvoice.data.shipmentId) {
            await trx
              .updateTable("shipment")
              .set({
                invoiced: true,
              })
              .where("id", "=", salesInvoice.data.shipmentId)
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
        const reversingJournalEntries = journalEntries.map((entry) => ({
          accountNumber: entry.accountNumber,
          description: `VOID: ${entry.description}`,
          amount: -entry.amount, // Reverse the amount
          quantity: -entry.quantity,
          documentType: "Invoice" as const,
          documentId: salesInvoice.data?.id,
          externalDocumentId: entry.externalDocumentId,
          documentLineReference: entry.documentLineReference,
          journalLineReference: entry.journalLineReference,
          companyId,
        }));

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
              shelfId: entry.shelfId,
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

        const accountingPeriodId = await getCurrentAccountingPeriod(
          client,
          companyId,
          db
        );

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

          // Create reversing journal
          const journal = await trx
            .insertInto("journal")
            .values({
              accountingPeriodId,
              description: `VOID Sales Invoice ${salesInvoice.data?.invoiceId}`,
              postingDate: today,
              companyId,
            })
            .returning(["id"])
            .execute();

          const journalId = journal[0].id;
          if (!journalId) throw new Error("Failed to insert journal");

          // Insert reversing journal entries
          await trx
            .insertInto("journalLine")
            .values(
              reversingJournalEntries.map((journalLine) => ({
                ...journalLine,
                journalId,
              }))
            )
            .returning(["id"])
            .execute();

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
                .deleteFrom("shipmentLine")
                .where("shipmentId", "=", shipment.id)
                .execute();

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
