import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { sql } from "kysely";
import z from "npm:zod@^4.5.4";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { fetchAll } from "../lib/fetch-all.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";

import { credit, debit, journalReference } from "../lib/utils.ts";
import { calculateDueDate } from "../shared/calculate-due-date.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import {
  getDefaultPostingGroup,
  resolveInventoryAccount,
} from "../shared/get-posting-group.ts";
import { round } from "../shared/precision.ts";
import { calculateCOGS } from "../shared/calculate-cogs.ts";
import {
  assertCurrencyDecimals,
  assertExchangeRate,
} from "../shared/accounting-currency.ts";
import { classifyIntercompanyPostingLines } from "../shared/intercompany-capture.ts";
import {
  allocateSalesHeaderShipping,
  buildSalesPostingLines,
  calculateSalesIntercompanyAmount,
  type SalesPostingAccount,
  type SalesPostingMetadata,
} from "../shared/sales-posting-amounts.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("post-sales-invoice");

const payloadValidator = z.object({
  type: z.enum(["post", "void"]).default("post"),
  invoiceId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  const payload = await req.json();

  try {
    const { type, invoiceId, userId, companyId } =
      payloadValidator.parse(payload);

    logger.info({ type, invoiceId, userId, companyId });

    const client = await requirePermissions(req, companyId, userId, { update: "invoicing" });
    const today = datetime.today(await getCompanyTimeZone(client, companyId)).toString();

    const [companyRecord, accountingSettings] = await Promise.all([
      client
        .from("company")
        .select("companyGroupId, baseCurrencyCode")
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
        const headerShippingAllocations = accountingEnabled
          ? allocateSalesHeaderShipping(salesInvoiceLines.data, shippingCost)
          : new Map<string, number>();

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
            .select("id, itemTrackingType, replenishmentSystem")
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

        // Fixed-asset disposal state changes are deferred and applied inside the
        // same Kysely transaction as the journal posting, so a failure to update
        // the asset/disposal rows rolls the journals back instead of leaving the
        // ledger posted against a stale asset record.
        const fixedAssetDisposalUpdates: {
          disposalId: string;
          assetId: string;
          saleProceeds: number;
          gainLoss: number;
        }[] = [];
        const directAssetDisposals: {
          assetId: string;
          saleProceeds: number;
          netBookValue: number;
          gainLoss: number;
        }[] = [];

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

        const journalLineDimensionsMeta: SalesPostingMetadata[] = [];

        // For IC transactions, book to Inter-Company Receivables instead of
        // regular AR. Resolve it from accountDefault (stable id), not by account
        // number — numbers are user-editable. Fall back to regular receivables
        // if the IC default isn't configured.
        const icReceivablesAccount = (
          accountDefaults?.data as unknown as {
            intercompanyReceivablesAccount?: string | null;
          }
        )?.intercompanyReceivablesAccount;
        const receivablesAccountId: string | undefined =
          isIntercompany && icReceivablesAccount
            ? icReceivablesAccount
            : accountDefaults?.data?.receivablesAccount;

        const invoiceCurrencyCode = salesInvoice.data.currencyCode ?? companyRecord.data.baseCurrencyCode;
        const invoiceExchangeRate = salesInvoice.data.exchangeRate ??
          (invoiceCurrencyCode === companyRecord.data.baseCurrencyCode ? 1 : Number.NaN);
        if (accountingEnabled) {
          if (!companyGroupId) throw new Error("Accounting requires a company group");
          assertExchangeRate(invoiceExchangeRate);
          if (invoiceCurrencyCode === companyRecord.data.baseCurrencyCode && invoiceExchangeRate !== 1) {
            throw new Error("Base-currency invoices require an identity exchange rate");
          }
        }

        // Batch the asset/class and disposal facts once. No asset state changes
        // occur until the journal transaction commits.
        type InvoiceLineRecord = Database["public"]["Tables"]["salesInvoiceLine"]["Row"];
        const assetIds = [...new Set(salesInvoiceLines.data
          .filter((line: InvoiceLineRecord) => line.invoiceLineType === "Fixed Asset" && line.assetId)
          .map((line: InvoiceLineRecord) => line.assetId!))];
        const assetQuery = () => client.from("fixedAsset")
          .select("id, status, acquisitionCost, accumulatedDepreciation, locationId, fixedAssetClass:fixedAssetClassId(id, assetAccountId, accumulatedDepreciationAccountId, writeOffAccountId, gainOnDisposalAccountId, lossOnDisposalAccountId)")
          .in("id", assetIds).eq("companyId", companyId).order("id");
        type AssetRecord = Pick<Database["public"]["Tables"]["fixedAsset"]["Row"],
          "id" | "status" | "acquisitionCost" | "accumulatedDepreciation" | "locationId"> & {
            fixedAssetClass: Pick<Database["public"]["Tables"]["fixedAssetClass"]["Row"],
              "id" | "assetAccountId" | "accumulatedDepreciationAccountId" | "writeOffAccountId" | "gainOnDisposalAccountId" | "lossOnDisposalAccountId"> | null;
          };
        type DisposalRecord = Pick<Database["public"]["Tables"]["fixedAssetDisposal"]["Row"], "id" | "fixedAssetId" | "netBookValueAtDisposal">;
        const [assetRecords, disposalRecords, currencyConfig] = await Promise.all([
          accountingEnabled && assetIds.length > 0
            ? fetchAll<AssetRecord>(assetQuery)
            : Promise.resolve({ data: [] as AssetRecord[], error: null }),
          accountingEnabled && assetIds.length > 0
            ? fetchAll<DisposalRecord>(() => client.from("fixedAssetDisposal")
              .select("id, fixedAssetId, netBookValueAtDisposal")
              .in("fixedAssetId", assetIds).eq("companyId", companyId)
              .order("createdAt", { ascending: false }).order("id", { ascending: false }))
            : Promise.resolve({ data: [] as DisposalRecord[], error: null }),
          accountingEnabled
            ? client.from("currency").select("decimalPlaces")
              .eq("companyGroupId", companyGroupId!).eq("code", invoiceCurrencyCode).single()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (assetRecords.error) throw new Error("Failed to fetch fixed assets for invoice posting");
        if (disposalRecords.error) throw new Error("Failed to fetch fixed-asset disposal records");
        if (accountingEnabled && (currencyConfig.error || !currencyConfig.data)) {
          throw new Error("Missing invoice currency precision configuration");
        }
        const invoiceCurrencyDecimals = currencyConfig.data?.decimalPlaces;
        if (accountingEnabled) assertCurrencyDecimals(invoiceCurrencyDecimals!);
        const assetsById = new Map<string, AssetRecord>((assetRecords.data ?? []).map((asset: AssetRecord) => [asset.id, asset]));
        const latestDisposalByAsset = new Map<string, DisposalRecord>();
        for (const disposal of disposalRecords.data ?? []) {
          if (!latestDisposalByAsset.has(disposal.fixedAssetId)) latestDisposalByAsset.set(disposal.fixedAssetId, disposal);
        }
        const accountIds = new Set<string>();
        for (const id of [receivablesAccountId, accountDefaults?.data?.salesAccount,
          accountDefaults?.data?.salesShippingRevenueAccount, accountDefaults?.data?.salesTaxPayableAccount]) {
          if (id) accountIds.add(id);
        }
        for (const asset of assetRecords.data ?? []) {
          const assetClass = asset.fixedAssetClass;
          for (const id of [assetClass?.assetAccountId, assetClass?.accumulatedDepreciationAccountId,
            assetClass?.writeOffAccountId, assetClass?.gainOnDisposalAccountId, assetClass?.lossOnDisposalAccountId]) {
            if (id) accountIds.add(id);
          }
        }
        const postingAccounts = accountingEnabled
          ? await client.from("account").select("id, class, active, isGroup, companyGroupId")
            .in("id", [...accountIds]).eq("companyGroupId", companyGroupId!)
          : { data: [], error: null };
        if (postingAccounts.error) throw new Error("Failed to validate invoice posting accounts");
        const accountsById = new Map<string, SalesPostingAccount>((postingAccounts.data ?? []).map((account: SalesPostingAccount) => [account.id, account]));
        const account = (id: string | null | undefined) => id ? accountsById.get(id) : undefined;
        const chargeAccounts = {
          receivables: account(receivablesAccountId), sales: account(accountDefaults?.data?.salesAccount),
          shipping: account(accountDefaults?.data?.salesShippingRevenueAccount), tax: account(accountDefaults?.data?.salesTaxPayableAccount),
        };

        for (const invoiceLine of salesInvoiceLines.data) {
          const invoiceLineQuantityInInventoryUnit = invoiceLine.quantity;
          const postingLine = { ...invoiceLine, allocatedHeaderShipping: headerShippingAllocations.get(invoiceLine.id) ?? 0 };
          const postingContext = {
            companyId, companyGroupId: companyGroupId!, documentId: salesInvoice.data.id,
            externalDocumentId: salesInvoice.data.customerReference,
            documentLineReference: invoiceLine.salesOrderLineId ? journalReference.to.salesInvoice(invoiceLine.salesOrderLineId) : null,
            journalLineReference: nanoid(), intercompanyPartnerId,
          };

          switch (invoiceLine.invoiceLineType) {
            case "Part":
            case "Service":
            case "Consumable":
            case "Fixture":
            case "Material":
            case "Tool":
              {
                const invoiceLineItem = items.data.find(
                  (item) => item.id === invoiceLine.itemId
                );
                const itemTrackingType =
                  invoiceLineItem?.itemTrackingType ?? "Inventory";

                if (accountingEnabled && accountDefaults?.data) {
                  const charges = buildSalesPostingLines({
                    line: postingLine, context: postingContext, accounts: chargeAccounts,
                    metadata: {
                      customerTypeId: customer.data.customerTypeId ?? null,
                      itemPostingGroupId: itemCosts.data.find((cost: Pick<Database["public"]["Tables"]["itemCost"]["Row"], "itemId" | "itemPostingGroupId">) => cost.itemId === invoiceLine.itemId)?.itemPostingGroupId ?? null,
                      itemId: invoiceLine.itemId ?? null, locationId: invoiceLine.locationId ?? null,
                      costCenterId: null, fixedAssetClassId: null,
                    },
                  });
                  journalLineInserts.push(...charges.lines);
                  journalLineDimensionsMeta.push(...charges.metadata);
                }

                // if the sales order line is null, we ship the part, do the normal entries and do not use accrual/reversing
                if (
                  invoiceLine.salesOrderLineId === null &&
                  invoiceLine.methodType !== "Make to Order"
                ) {
                  // Services are never shipped, so they must not materialize a
                  // shipment document — only the revenue + AR entries below.
                  if (invoiceLine.invoiceLineType !== "Service") {
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
                  }

                  if (itemTrackingType === "Inventory") {
                    // create the part ledger line
                    itemLedgerInserts.push({
                      postingDate: today,
                      itemId: invoiceLine.itemId!,
                      quantity: round(-invoiceLineQuantityInInventoryUnit),
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

                    if (itemTrackingType === "Inventory") {
                      const cogsJournalLineReference = nanoid();

                      journalLineInserts.push({
                        accountId: accountDefaults.data.costOfGoodsSoldAccount,
                        description: "Cost of Goods Sold",
                        amount: 0,
                        quantity: round(invoiceLineQuantityInInventoryUnit),
                        documentType: "Invoice",
                        documentId: salesInvoice.data?.id,
                        externalDocumentId: salesInvoice.data?.customerReference,
                        journalLineReference: cogsJournalLineReference,
                        companyId,
                      });

                      const inventoryAccount = resolveInventoryAccount(
                        invoiceLineItem?.replenishmentSystem ?? null,
                        accountDefaults.data
                      );
                      journalLineInserts.push({
                        accountId: inventoryAccount.account,
                        description: inventoryAccount.description,
                        amount: 0,
                        quantity: round(invoiceLineQuantityInInventoryUnit),
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
                }
                // Sales-order and Make-to-Order lines retain shipment-owned COGS;
                // their charge rows were constructed through the same path above.
              }

              break;
            case "Fixed Asset": {
              if (!accountingEnabled) break;
              if (!invoiceLine.assetId) throw new Error(`Fixed Asset invoice line ${invoiceLine.id} has no asset selected`);
              const asset = assetsById.get(invoiceLine.assetId);
              const assetClass = asset?.fixedAssetClass;
              if (!asset || !assetClass) throw new Error(`Failed to fetch fixed asset/class ${invoiceLine.assetId}`);
              const salesOrderLine = salesOrderLines.find((line: Database["public"]["Tables"]["salesOrderLine"]["Row"]) => line.id === invoiceLine.salesOrderLineId);
              const wasShipped = salesOrderLine?.sentComplete === true && !!invoiceLine.salesOrderLineId;
              const disposal = wasShipped ? latestDisposalByAsset.get(invoiceLine.assetId) : undefined;
              if (wasShipped && !disposal) {
                throw new Error(`No disposal record found for asset ${invoiceLine.assetId} — shipment must create it before invoice posting`);
              }
              const disposalAccounts = {
                gainAccount: account(assetClass.gainOnDisposalAccountId),
                lossAccount: account(assetClass.lossOnDisposalAccountId),
              };
              const charges = buildSalesPostingLines({
                line: postingLine, context: postingContext, accounts: chargeAccounts,
                metadata: {
                  customerTypeId: customer.data.customerTypeId ?? null,
                  itemPostingGroupId: null, itemId: null,
                  locationId: invoiceLine.locationId ?? salesOrderLine?.locationId ?? asset.locationId ?? null,
                  costCenterId: null, fixedAssetClassId: assetClass.id,
                },
                disposal: wasShipped && disposal ? {
                  mode: "shipment", netBookValue: Number(disposal.netBookValueAtDisposal),
                  clearingAccount: account(assetClass.writeOffAccountId), ...disposalAccounts,
                } : {
                  mode: "direct", acquisitionCost: Number(asset.acquisitionCost),
                  accumulatedDepreciation: Number(asset.accumulatedDepreciation),
                  assetAccount: account(assetClass.assetAccountId),
                  accumulatedDepreciationAccount: account(assetClass.accumulatedDepreciationAccountId),
                  ...disposalAccounts,
                },
              });
              journalLineInserts.push(...charges.lines);
              journalLineDimensionsMeta.push(...charges.metadata);
              if (charges.netBookValue === null || charges.gainLoss === null) {
                throw new Error("Fixed asset disposal posting is missing carrying values");
              }
              if (wasShipped && disposal) {
                fixedAssetDisposalUpdates.push({
                  disposalId: disposal.id, assetId: invoiceLine.assetId,
                  saleProceeds: charges.saleProceeds, gainLoss: charges.gainLoss,
                });
              } else {
                directAssetDisposals.push({
                  assetId: invoiceLine.assetId, saleProceeds: charges.saleProceeds,
                  netBookValue: charges.netBookValue, gainLoss: charges.gainLoss,
                });
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
          ? await getCurrentAccountingPeriod(client, companyId, db, today)
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
                line.salesOrderLineType === "Comment" ||
                  line.salesOrderLineType === "Service" ||
                  line.sentComplete
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
                jl.quantity === round(directLine.quantity)
              ) {
                journalLineInserts[i].amount = round(
                  debit("expense", cogsResult.totalCost)
                );
                if (i + 1 < journalLineInserts.length) {
                  journalLineInserts[i + 1].amount = round(
                    credit("asset", cogsResult.totalCost)
                  );
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
                    quantity: round(-directLine.quantity),
                    cost: round(-cogsResult.totalCost),
                    remainingQuantity: 0,
                    companyId,
                    postingDate: today,
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
                postedAt: datetime.timestamp(),
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
            const cogsAccount = accountDefaults?.data?.costOfGoodsSoldAccount;
            const classifiedLines = classifyIntercompanyPostingLines(
              journalLineInserts.map((line, index) => ({ ...line, id: journalLineResults[index]?.id ?? "" })),
              journalLineDimensionsMeta,
              {
                controlAccountId: receivablesAccountId,
                revenueAccountIds: [accountDefaults?.data?.salesAccount, accountDefaults?.data?.salesShippingRevenueAccount]
                  .filter((id): id is string => !!id),
                cogsAccountId: cogsAccount,
              }
            );
            // Keep the first control as the existing matching anchor, but capture
            // every emitted control line so multiline balances eliminate fully.
            const icJournalLineId = classifiedLines.find((line) => line.role === "Control")?.journalLineId;
            const intercompanyAmount = calculateSalesIntercompanyAmount(
              salesInvoiceLines.data, invoiceExchangeRate
            );

            if (icJournalLineId) {
              const icTxn = await trx
                .insertInto("intercompanyTransaction")
                .values({
                  companyGroupId: companyGroupId!,
                  sourceCompanyId: companyId,
                  targetCompanyId: intercompanyPartnerId,
                  sourceJournalLineId: icJournalLineId,
                  amount: intercompanyAmount,
                  currencyCode: invoiceCurrencyCode,
                  description: `Sales Invoice ${salesInvoice.data?.invoiceId}`,
                  documentType: "Invoice",
                  documentId: salesInvoice.data?.id,
                  status: "Unmatched",
                })
                .returning(["id"])
                .executeTakeFirstOrThrow();

              const eliminationLineInserts: Database["public"]["Tables"]["intercompanyEliminationLine"]["Insert"][] =
                classifiedLines.map((line) => ({
                  ...line, companyId, intercompanyTransactionId: icTxn.id, createdBy: userId,
                }));

              // Sales-order-based sales post COGS at SHIPMENT (a prior posting),
              // not on this invoice, so it is not in journalLineInserts. Capture
              // those shipment COGS lines via the deterministic invoice ->
              // salesInvoiceLine.salesOrderId -> shipment(sourceDocument = 'Sales
              // Order') link. Done once, here, and stored — never re-derived per
              // elimination run.
              const salesOrderIds = [
                ...new Set(
                  salesInvoiceLines.data
                    .map((line) => line.salesOrderId)
                    .filter((id): id is string => !!id)
                ),
              ];
              if (cogsAccount && salesOrderIds.length > 0) {
                const shipmentCogsLines = await trx
                  .selectFrom("journalLine as jl")
                  .innerJoin("shipment as s", "s.id", "jl.documentId")
                  .select([
                    "jl.id as id",
                    "jl.accountId as accountId",
                    "jl.amount as amount",
                    "jl.quantity as quantity",
                  ])
                  .where("jl.companyId", "=", companyId)
                  .where("jl.accountId", "=", cogsAccount)
                  .where("s.companyId", "=", companyId)
                  .where("s.sourceDocument", "=", "Sales Order")
                  .where("s.sourceDocumentId", "in", salesOrderIds)
                  .execute();
                for (const cogs of shipmentCogsLines) {
                  eliminationLineInserts.push({
                    companyId,
                    intercompanyTransactionId: icTxn.id,
                    role: "COGS",
                    journalLineId: cogs.id,
                    accountId: cogs.accountId,
                    amount: cogs.amount ?? 0,
                    itemId: null,
                    quantity: cogs.quantity ?? null,
                    createdBy: userId,
                  });
                }
              }

              if (eliminationLineInserts.length > 0) {
                await trx
                  .insertInto("intercompanyEliminationLine")
                  .values(eliminationLineInserts)
                  .execute();
              }
            }
          }

          // All disposal state changes share the journal transaction. Batch
          // monetary enrichment separately from direct-disposal lifecycle changes.
          const assetProceeds = new Map([
            ...directAssetDisposals.map((entry) => [entry.assetId, entry.saleProceeds] as const),
            ...fixedAssetDisposalUpdates.map((entry) => [entry.assetId, entry.saleProceeds] as const),
          ]);
          if (assetProceeds.size > 0) {
            await trx.updateTable("fixedAsset").set({
              saleProceeds: sql<number>`CASE "id" ${sql.join([...assetProceeds].map(([id, proceeds]) => sql`WHEN ${id} THEN ${proceeds}::numeric`), sql` `)} ELSE "saleProceeds" END`,
              updatedBy: userId,
            }).where("id", "in", [...assetProceeds.keys()]).where("companyId", "=", companyId).execute();
          }
          if (fixedAssetDisposalUpdates.length > 0) {
            const updates = [...new Map(fixedAssetDisposalUpdates.map((entry) => [entry.disposalId, entry])).values()];
            await trx.updateTable("fixedAssetDisposal").set({
              saleProceeds: sql<number>`CASE "id" ${sql.join(updates.map((entry) => sql`WHEN ${entry.disposalId} THEN ${entry.saleProceeds}::numeric`), sql` `)} ELSE "saleProceeds" END`,
              gainLoss: sql<number>`CASE "id" ${sql.join(updates.map((entry) => sql`WHEN ${entry.disposalId} THEN ${entry.gainLoss}::numeric`), sql` `)} ELSE "gainLoss" END`,
            }).where("id", "in", updates.map((entry) => entry.disposalId)).where("companyId", "=", companyId).execute();
          }
          if (directAssetDisposals.length > 0) {
            await trx.updateTable("fixedAsset").set({
              status: "Disposed", disposalDate: today, disposalMethod: "Sale", updatedBy: userId,
            }).where("id", "in", directAssetDisposals.map((entry) => entry.assetId)).where("companyId", "=", companyId).execute();
            await trx.insertInto("fixedAssetDisposal").values(directAssetDisposals.map((entry) => ({
              fixedAssetId: entry.assetId, disposalMethod: "Sale" as const, disposalDate: today,
              saleProceeds: entry.saleProceeds, netBookValueAtDisposal: entry.netBookValue,
              gainLoss: entry.gainLoss, companyId, createdBy: userId,
            }))).execute();
          }

          // Posting stamps dateIssued with today, so recompute dateDue from
          // the payment term to keep it consistent with the new issue date.
          // With no payment term the invoice still gets one, via Net 30.
          const paymentTerm = salesInvoice.data?.paymentTermId
            ? await trx
                .selectFrom("paymentTerm")
                .select(["daysDue", "calculationMethod"])
                .where("id", "=", salesInvoice.data.paymentTermId)
                .where("companyId", "=", companyId)
                .executeTakeFirst()
            : undefined;
          const dateDue = calculateDueDate(today, paymentTerm);

          await trx
            .updateTable("salesInvoice")
            .set({
              dateIssued: today,
              ...(dateDue ? { dateDue } : {}),
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
              // A reversal is a sign flip of an already-posted value, which is
              // exact — no rounding to do.
              amount: -entry.amount,
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
              quantity: -entry.quantity,
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
          ? await getCurrentAccountingPeriod(client, companyId, db, today)
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
                line.salesOrderLineType === "Comment" ||
                  line.salesOrderLineType === "Service" ||
                  line.sentComplete
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
                postedAt: datetime.timestamp(),
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

    return jsonResponse({ success: true });
  } catch (err) {
    logger.error("post-sales-invoice failed", {
      error: String((err as Error)?.stack ?? err),
    });
    if ("invoiceId" in payload) {
      const client = await requirePermissions(req, payload.companyId, payload.userId, { update: "invoicing" });
      await client
        .from("salesInvoice")
        .update({ status: "Draft" })
        .eq("id", payload.invoiceId);
    }
    return errorResponse(err, 500);
  }
});
