import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";
import { credit, debit, journalReference } from "../lib/utils.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import {
  getInventoryPostingGroup,
  getPurchasingPostingGroup,
} from "../shared/get-posting-group.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { receiptId } = await req.json();
  const today = format(new Date(), "yyyy-MM-dd");

  try {
    if (!receiptId) throw new Error("Payload is missing receiptId");

    const client = getSupabaseServiceRole(req.headers.get("Authorization"));

    const [receipt, receiptLines] = await Promise.all([
      client.from("receipt").select("*").eq("id", receiptId).single(),
      client.from("receiptLine").select("*").eq("receiptId", receiptId),
    ]);

    if (receipt.error) throw new Error("Failed to fetch receipt");
    if (receiptLines.error) throw new Error("Failed to fetch receipt lines");

    const companyId = receipt.data?.companyId;

    const parts = await client
      .from("part")
      .select("id, itemGroupId, partType")
      .in(
        "id",
        receiptLines.data.reduce<string[]>((acc, receiptLine) => {
          if (receiptLine.partId && !acc.includes(receiptLine.partId)) {
            acc.push(receiptLine.partId);
          }
          return acc;
        }, [])
      )
      .eq("companyId", companyId);
    if (parts.error) throw new Error("Failed to fetch item groups");

    switch (receipt.data?.sourceDocument) {
      case "Purchase Order": {
        if (!receipt.data.sourceDocumentId)
          throw new Error("Receipt has no sourceDocumentId");

        const [purchaseOrder, purchaseOrderLines] = await Promise.all([
          client
            .from("purchaseOrder")
            .select("*")
            .eq("id", receipt.data.sourceDocumentId)
            .single(),
          client
            .from("purchaseOrderLine")
            .select("*")
            .eq("purchaseOrderId", receipt.data.sourceDocumentId),
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

        const costLedgerInserts: Database["public"]["Tables"]["costLedger"]["Insert"][] =
          [];
        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        const journalLineInserts: Omit<
          Database["public"]["Tables"]["journalLine"]["Insert"],
          "journalId"
        >[] = [];

        const receiptLinesByPurchaseOrderLineId = receiptLines.data.reduce<
          Record<string, Database["public"]["Tables"]["receiptLine"]["Row"]>
        >((acc, receiptLine) => {
          if (receiptLine.lineId) {
            acc[receiptLine.lineId] = receiptLine;
          }
          return acc;
        }, {});

        const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
          >
        >((acc, purchaseOrderLine) => {
          const receiptLine =
            receiptLinesByPurchaseOrderLineId[purchaseOrderLine.id];
          if (
            receiptLine &&
            receiptLine.receivedQuantity &&
            purchaseOrderLine.purchaseQuantity &&
            purchaseOrderLine.purchaseQuantity > 0
          ) {
            const recivedQuantityInPurchaseUnit =
              receiptLine.receivedQuantity /
              (receiptLine.conversionFactor ?? 1);

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

          const partType =
            parts.data.find((part) => part.id === receiptLine.partId)
              ?.partType ?? "Inventory";

          const itemGroupId: string | null =
            parts.data.find((part) => part.id === receiptLine.partId)
              ?.itemGroupId ?? null;
          const locationId = receiptLine.locationId ?? null;
          const supplierTypeId: string | null =
            supplier.data.supplierTypeId ?? null;

          // inventory posting group
          if (`${itemGroupId}-${locationId}` in inventoryPostingGroups) {
            postingGroupInventory =
              inventoryPostingGroups[`${itemGroupId}-${locationId}`];
          } else {
            const inventoryPostingGroup = await getInventoryPostingGroup(
              client,
              {
                itemGroupId,
                locationId,
              }
            );

            if (inventoryPostingGroup.error || !inventoryPostingGroup.data) {
              throw new Error("Error getting inventory posting group");
            }

            postingGroupInventory = inventoryPostingGroup.data ?? null;
            inventoryPostingGroups[`${itemGroupId}-${locationId}`] =
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

          if (`${itemGroupId}-${supplierTypeId}` in purchasingPostingGroups) {
            postingGroupPurchasing =
              purchasingPostingGroups[`${itemGroupId}-${supplierTypeId}`];
          } else {
            const purchasingPostingGroup = await getPurchasingPostingGroup(
              client,
              {
                itemGroupId,
                supplierTypeId,
              }
            );

            if (purchasingPostingGroup.error || !purchasingPostingGroup.data) {
              throw new Error("Error getting purchasing posting group");
            }

            postingGroupPurchasing = purchasingPostingGroup.data ?? null;
            purchasingPostingGroups[`${itemGroupId}-${supplierTypeId}`] =
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
              receiptLine.receivedQuantity ?? 0,
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

            // create the cost ledger entry
            costLedgerInserts.push({
              itemLedgerType: "Purchase",
              costLedgerType: "Direct Cost",
              adjustment: false,
              documentType: "Purchase Receipt",
              documentId: receipt.data?.id ?? undefined,
              externalDocumentId: receipt.data?.externalDocumentId ?? undefined,
              partId: receiptLine.partId,
              quantity: quantityToReverse,
              cost: reversedValue,
              costPostedToGL: reversedValue,
              companyId,
            });

            // create the normal GL entries

            let journalLineReference = nanoid();

            if (partType === "Inventory") {
              // debit the inventory account
              journalLineInserts.push({
                accountNumber: postingGroupInventory.inventoryAccount,
                description: "Inventory Account",
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

              // creidt the direct cost applied account
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

              // creidt the overhead cost applied account
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

          if (receiptLine.receivedQuantity > quantityToReverse) {
            // create the accrual entries for received not invoiced
            const quantityToAccrue =
              receiptLine.receivedQuantity - quantityToReverse;

            const expectedValue =
              (receiptLine.receivedQuantity - quantityToReverse) *
              receiptLine.unitPrice;

            const journalLineReference = nanoid();

            journalLineInserts.push({
              accountNumber:
                postingGroupInventory.inventoryInterimAccrualAccount,
              description: "Interim Inventory Accrual",
              accrual: true,
              amount: debit("asset", expectedValue),
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
              amount: credit("liability", expectedValue),
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

          if (partType === "Inventory") {
            itemLedgerInserts.push({
              postingDate: today,
              partId: receiptLine.partId,
              quantity: receiptLine.receivedQuantity,
              locationId: receiptLine.locationId,
              shelfId: receiptLine.shelfId,
              entryType: "Positive Adjmt.",
              documentType: "Purchase Receipt",
              documentId: receipt.data?.id ?? undefined,
              externalDocumentId: receipt.data?.externalDocumentId ?? undefined,
              companyId,
            });
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

          if (costLedgerInserts.length > 0) {
            await trx
              .insertInto("costLedger")
              .values(costLedgerInserts)
              .returning(["id"])
              .execute();
          }

          await trx
            .updateTable("receipt")
            .set({
              status: "Posted",
              postingDate: today,
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
    if (receiptId) {
      const client = getSupabaseServiceRole(req.headers.get("Authorization"));
      client.from("receipt").update({ status: "Draft" }).eq("id", receiptId);
    }
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
