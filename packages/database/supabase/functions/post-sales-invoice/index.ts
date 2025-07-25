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
        .select("id, itemTrackingType")
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
                  amount: credit("asset", totalLineCostWithWeightedShipping),
                  quantity: invoiceLineQuantityInInventoryUnit,
                  documentType: "Invoice",
                  documentId: salesInvoice.data?.id,
                  externalDocumentId: salesInvoice.data?.customerReference,
                  journalLineReference,
                  companyId,
                });

                // creidt the cost of goods sold account
                journalLineInserts.push({
                  accountNumber: postingGroupInventory.costOfGoodsSoldAccount,
                  description: "Cost of Goods Sold",
                  amount: debit("expense", totalLineCostWithWeightedShipping),
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
                amount: credit("revenue", totalLineCostWithWeightedShipping),
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
                amount: credit("revenue", totalLineCostWithWeightedShipping),
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
                  accountNumber: postingGroupInventory.costOfGoodsSoldAccount,
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
          .selectAll()
          .where("salesOrderId", "=", salesOrderId)
          .execute();

        const areAllLinesInvoiced = salesOrderLines.every(
          (line) =>
            line.salesOrderLineType === "Comment" || line.invoicedComplete
        );

        const areAllLinesShipped = salesOrderLines.every(
          (line) => line.salesOrderLineType === "Comment" || line.sentComplete
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
