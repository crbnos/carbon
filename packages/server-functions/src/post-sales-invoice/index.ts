// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Database, getCompanyTimeZone } from "@carbon/database";
import { DOCUMENT_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import {
  addMovement,
  type ContractPosition,
  EMPTY_POSITION,
  negatePosition,
  normalizePosition
} from "@carbon/database/contract-position";
import {
  assertPostingStatusUnchanged,
  journalPostingStatus
} from "@carbon/database/journal-posting-status";
import {
  inOrder,
  isNull,
  many,
  maybeSingle,
  single,
  type Tables,
  updateRows
} from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { getLogger } from "@carbon/logger";
import {
  allocateSalesHeaderShipping,
  assertCurrencyDecimals,
  assertExchangeRate,
  calculateDueDate,
  calculateSalesIntercompanyAmount,
  classifyIntercompanyPostingLines,
  datetime,
  round,
  spreadStraightLine
} from "@carbon/utils";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { calculateCOGS } from "../lib/calculate-cogs";
import {
  loadContractPositions,
  lockContractPositions,
  samePosition,
  signedCreditAmount
} from "../lib/contract-ledger";
import {
  refuseVoidBeforeCutover,
  SALES_INVOICE_VOID_BEFORE_CUTOVER_ERROR
} from "../lib/cutover-void";
import { documentJournalLines } from "../lib/document-journal-lines";
import { syncDraftRecognitionRuns } from "../lib/draft-recognition-run";
import { getCurrentAccountingPeriod } from "../lib/get-accounting-period";
import { getDefaultPostingGroup } from "../lib/get-posting-group";
import { journalLineDimensionRows } from "../lib/journal-line-dimensions";
import { assertPostable } from "../lib/postable";
import {
  netInvestmentInLeasesAccount,
  planSalesInvoiceAccounts,
  resolveSalesInvoiceAccounts
} from "./posting-accounts";
import {
  buildSalesInvoiceJournal,
  type DisposableAsset,
  fillDirectCogs,
  isDirectItemLine,
  postingAccountNeeds,
  postingLineRevenue,
  type RentalAgreementLineFacts,
  salesLineDimensions
} from "./posting-lines";
import type { RentalScheduleFact } from "./rental-posting";

const logger = getLogger("server-functions", "post-sales-invoice");

export const postSalesInvoiceInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  invoiceId: z.string()
});

const RECOGNIZED_REVENUE_VOID_ERROR =
  "Invoice has recognized revenue; reverse its revenue recognition run first";

/** Posts or voids a sales invoice: its ledger, cost and journal rows, atomically. */
const postSalesInvoice = defineServerFn({
  name: "post-sales-invoice",
  input: postSalesInvoiceInput,
  permissions: { update: "invoicing" },
  async run(ctx, { type, invoiceId }) {
    const { db, companyId, userId } = ctx;

    logger.info({ type, invoiceId, userId, companyId });
    if (type === "post")
      await assertPostable(db, "salesInvoice", invoiceId, companyId);
    try {
      const today = datetime
        .today(await getCompanyTimeZone(db, companyId))
        .toString();

      const companyRecord = await single(
        db,
        "company",
        { id: companyId },
        { columns: ["companyGroupId", "baseCurrencyCode"] }
      );
      if (companyRecord.error) throw new Error("Failed to fetch company");
      const companyGroupId = companyRecord.data.companyGroupId;

      // Every invoice posts a journal: Provisional before the company's
      // accounting cutover, Posted after it. Read here to decide whether to
      // resolve a period, and again inside each transaction, where FOR SHARE
      // holds the status until commit.
      const postingStatus = await journalPostingStatus(db, companyId);

      const [salesInvoice, salesInvoiceLines, salesInvoiceShipment] =
        await inOrder([
          // The client is service-role: authorization proved the caller may
          // act in companyId, not that invoiceId belongs to it.
          () => maybeSingle(db, "salesInvoice", { id: invoiceId, companyId }),
          () => many(db, "salesInvoiceLine", { invoiceId, companyId }),
          () =>
            single(
              db,
              "salesInvoiceShipment",
              { companyId, id: invoiceId },
              { columns: ["shippingCost", "shippingMethodId"] }
            )
        ]);

      if (salesInvoice.error) throw new Error("Failed to fetch salesInvoice");
      if (!salesInvoice.data)
        throw new NotFoundError("Sales invoice not found");
      const invoiceHeader = salesInvoice.data;
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

      const { data: salesOrderLines } = await many(db, "salesOrderLine", {
        id: salesOrderLineIds
      });

      if (!salesOrderLines) {
        throw new Error("Failed to fetch sales order lines");
      }

      switch (type) {
        case "post": {
          const headerShippingAllocations = allocateSalesHeaderShipping(
            salesInvoiceLines.data,
            shippingCost
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

          const [items, itemCosts, customer] = await inOrder([
            () =>
              many(
                db,
                "item",
                { id: itemIds, companyId },
                { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
              ),
            () =>
              many(
                db,
                "itemCost",
                { itemId: itemIds },
                { columns: ["itemId", "itemPostingGroupId", "costingMethod"] }
              ),
            () =>
              single(db, "customer", {
                id: invoiceHeader.customerId ?? "",
                companyId
              })
          ]);
          if (items.error) throw new Error("Failed to fetch items");
          if (itemCosts.error) throw new Error("Failed to fetch item costs");
          if (customer.error) throw new Error("Failed to fetch customer");

          // Detect intercompany transaction
          const isIntercompany = customer.data.intercompanyCompanyId != null;
          const intercompanyPartnerId = isIntercompany
            ? customer.data.intercompanyCompanyId
            : null;

          const salesOrders = await many(db, "salesOrder", {
            salesOrderId: salesOrderLines.reduce<string[]>(
              (acc, salesOrderLine) => {
                if (
                  salesOrderLine.salesOrderId &&
                  !acc.includes(salesOrderLine.salesOrderId)
                ) {
                  acc.push(salesOrderLine.salesOrderId);
                }
                return acc;
              },
              []
            ),
            companyId
          });

          if (salesOrders.error)
            throw new Error("Failed to fetch sales orders");

          const shipmentLineInserts: Omit<
            Database["public"]["Tables"]["shipmentLine"]["Insert"],
            "shipmentId"
          >[] = [];

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];

          const salesInvoiceLinesBySalesOrderLine =
            salesInvoiceLines.data.reduce<
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
                (salesOrderLine.quantityToInvoice ??
                  salesOrderLine.saleQuantity);

              return {
                ...acc,
                [salesOrderLine.id]: {
                  quantityInvoiced: newQuantityInvoiced,
                  invoicedComplete,
                  salesOrderId: salesOrderLine.salesOrderId
                }
              };
            }

            return acc;
          }, {});

          // Get account defaults (once for all lines)
          const accountDefaults = await getDefaultPostingGroup(db, companyId);
          if (accountDefaults.error || !accountDefaults.data) {
            throw new Error("Error getting account defaults");
          }
          const defaults = accountDefaults.data;

          const dimensions = await many(
            db,
            "dimension",
            {
              companyGroupId: companyGroupId!,
              active: true,
              entityType: [
                "CustomerType",
                "ItemPostingGroup",
                "Location",
                "CostCenter",
                "FixedAssetClass",
                "Customer",
                "Item",
                "Project"
              ]
            },
            { columns: ["id", "entityType"] }
          );

          const dimensionMap = new Map<string, string>();
          if (dimensions?.data) {
            for (const dim of dimensions.data) {
              if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
            }
          }

          const invoiceCurrencyCode =
            invoiceHeader.currencyCode ?? companyRecord.data.baseCurrencyCode;
          const invoiceExchangeRate =
            invoiceHeader.exchangeRate ??
            (invoiceCurrencyCode === companyRecord.data.baseCurrencyCode
              ? 1
              : Number.NaN);
          if (!companyGroupId)
            throw new Error("Accounting requires a company group");
          assertExchangeRate(invoiceExchangeRate);
          if (
            invoiceCurrencyCode === companyRecord.data.baseCurrencyCode &&
            invoiceExchangeRate !== 1
          ) {
            throw new Error(
              "Base-currency invoices require an identity exchange rate"
            );
          }

          // Batch the asset/class and disposal facts once. No asset state changes
          // occur until the journal transaction commits.
          type InvoiceLineRecord =
            Database["public"]["Tables"]["salesInvoiceLine"]["Row"];
          const assetIds = [
            ...new Set(
              salesInvoiceLines.data
                .filter(
                  (line: InvoiceLineRecord) =>
                    line.invoiceLineType === "Fixed Asset" && line.assetId
                )
                .map((line: InvoiceLineRecord) => line.assetId!)
            )
          ];
          type DisposalRecord = Pick<
            Database["public"]["Tables"]["fixedAssetDisposal"]["Row"],
            "id" | "fixedAssetId" | "netBookValueAtDisposal"
          >;
          const [assetRecords, disposalRecords, currencyConfig] = await inOrder(
            [
              () =>
                assetIds.length > 0
                  ? many<"fixedAsset", DisposableAsset>(
                      db,
                      "fixedAsset",
                      { id: assetIds, companyId },
                      {
                        columns: [
                          "id",
                          "status",
                          "acquisitionCost",
                          "accumulatedDepreciation",
                          "locationId",
                          "fixedAssetClassId"
                        ],
                        embed: {
                          fixedAssetClass: {
                            table: "fixedAssetClass",
                            via: "fixedAssetClassId",
                            columns: [
                              "id",
                              "assetAccountId",
                              "accumulatedDepreciationAccountId",
                              "writeOffAccountId",
                              "gainOnDisposalAccountId",
                              "lossOnDisposalAccountId"
                            ]
                          }
                        },
                        orderBy: ["id"]
                      }
                    )
                  : Promise.resolve({
                      data: [] as DisposableAsset[],
                      error: null
                    }),
              () =>
                assetIds.length > 0
                  ? many<"fixedAssetDisposal", DisposalRecord>(
                      db,
                      "fixedAssetDisposal",
                      { fixedAssetId: assetIds, companyId },
                      {
                        columns: [
                          "id",
                          "fixedAssetId",
                          "netBookValueAtDisposal"
                        ],
                        orderBy: [{ desc: "createdAt" }, { desc: "id" }]
                      }
                    )
                  : Promise.resolve({
                      data: [] as DisposalRecord[],
                      error: null
                    }),
              () =>
                single(
                  db,
                  "currency",
                  {
                    companyGroupId: companyGroupId!,
                    code: invoiceCurrencyCode
                  },
                  { columns: ["decimalPlaces"] }
                )
            ]
          );
          if (assetRecords.error)
            throw new Error("Failed to fetch fixed assets for invoice posting");
          if (disposalRecords.error)
            throw new Error("Failed to fetch fixed-asset disposal records");
          if (currencyConfig.error || !currencyConfig.data) {
            throw new Error("Missing invoice currency precision configuration");
          }
          const invoiceCurrencyDecimals = currencyConfig.data.decimalPlaces;
          assertCurrencyDecimals(invoiceCurrencyDecimals);
          const assetsById = new Map<string, DisposableAsset>(
            (assetRecords.data ?? []).map((asset: DisposableAsset) => [
              asset.id,
              asset
            ])
          );
          const latestDisposalByAsset = new Map<string, DisposalRecord>();
          for (const disposal of disposalRecords.data ?? []) {
            if (!latestDisposalByAsset.has(disposal.fixedAssetId))
              latestDisposalByAsset.set(disposal.fixedAssetId, disposal);
          }

          // The accounts this invoice posts to (posting-lines.ts): stand-ins
          // for an empty optional default before the cutover, and a refusal
          // for a deferral, rental or contract default a line needs.
          const accountPlan = planSalesInvoiceAccounts(
            defaults,
            postingStatus,
            postingAccountNeeds(
              salesInvoiceLines.data,
              (assetRecords.data ?? []).map(
                (asset: DisposableAsset) => asset.fixedAssetClass
              )
            )
          );
          const postingAccounts = await many(
            db,
            "account",
            {
              id: accountPlan.accountIds,
              companyGroupId: companyGroupId!
            },
            {
              columns: ["id", "class", "active", "isGroup", "companyGroupId"]
            }
          );
          if (postingAccounts.error)
            throw new Error("Failed to validate invoice posting accounts");
          const accounts = resolveSalesInvoiceAccounts(
            accountPlan,
            postingAccounts.data ?? [],
            companyGroupId!
          );
          const receivablesAccountId =
            accounts.receivablesAccountId(isIntercompany);

          // Each involved contract line's position, read once; the journal
          // builder keeps it running. Re-read under the position lock inside
          // the posting transaction, which refuses if it moved meanwhile.
          const contractLineIds = salesInvoiceLines.data
            .filter(
              (line: InvoiceLineRecord) =>
                !!line.customerContractLineId &&
                line.invoiceLineType !== "Comment"
            )
            .map((line: InvoiceLineRecord) => line.customerContractLineId!);
          const contractPositionsRead =
            contractLineIds.length > 0
              ? await loadContractPositions(db, companyId, contractLineIds)
              : new Map<string, ContractPosition>();

          // Rental facts, read once for every Rental line: the agreement lines,
          // the billing periods the lines bill, and each agreement line's
          // unbilled Accrual rows (Planned or Posted) and Planned Deferral rows.
          type RentalBillingPeriodRecord = Pick<
            Tables["rentalBillingPeriod"]["Row"],
            "id" | "periodStart" | "periodEnd"
          >;
          type RentalScheduleRecord = Pick<
            Tables["revenueRecognitionSchedule"]["Row"],
            | "id"
            | "rentalAgreementLineId"
            | "periodStart"
            | "periodEnd"
            | "scheduledDate"
            | "amount"
          >;
          type RentalLeaseScheduleRecord = Pick<
            Tables["rentalLeaseScheduleLine"]["Row"],
            | "id"
            | "rentalAgreementLineId"
            | "periodDate"
            | "closingNetInvestment"
          >;
          const rentalInvoiceLines = salesInvoiceLines.data.filter(
            (line: InvoiceLineRecord) => line.invoiceLineType === "Rental"
          );
          const rentalAgreementLineIds = [
            ...new Set(
              rentalInvoiceLines
                .map((line: InvoiceLineRecord) => line.rentalAgreementLineId)
                .filter((id: string | null): id is string => !!id)
            )
          ];
          // Agreement lines whose purchase option this invoice exercises: their
          // lease schedule's closing balance is what the option settles.
          const purchaseOptionAgreementLineIds = [
            ...new Set(
              rentalInvoiceLines
                .filter(
                  (line: InvoiceLineRecord) =>
                    line.rentalLineType === "Purchase Option"
                )
                .map((line: InvoiceLineRecord) => line.rentalAgreementLineId)
                .filter((id: string | null): id is string => !!id)
            )
          ];
          const rentalBillingPeriodIds = [
            ...new Set(
              rentalInvoiceLines
                .map((line: InvoiceLineRecord) => line.rentalBillingPeriodId)
                .filter((id: string | null): id is string => !!id)
            )
          ];
          const scheduleColumns = [
            "id",
            "rentalAgreementLineId",
            "periodStart",
            "periodEnd",
            "scheduledDate",
            "amount"
          ] as const;
          const noRows = <T>() =>
            Promise.resolve({ data: [] as T[], error: null as Error | null });
          const [
            rentalAgreementLines,
            rentalBillingPeriods,
            rentalAccruals,
            rentalDeferrals,
            rentalLeaseSchedules
          ] = await inOrder([
            () =>
              rentalAgreementLineIds.length > 0
                ? many(
                    db,
                    "rentalAgreementLine",
                    { id: rentalAgreementLineIds, companyId },
                    {
                      columns: [
                        "id",
                        "rentalAgreementId",
                        "itemId",
                        "lessorClassification"
                      ],
                      orderBy: ["id"]
                    }
                  )
                : noRows<RentalAgreementLineFacts>(),
            () =>
              rentalBillingPeriodIds.length > 0
                ? many(
                    db,
                    "rentalBillingPeriod",
                    { id: rentalBillingPeriodIds, companyId },
                    {
                      columns: ["id", "periodStart", "periodEnd"],
                      orderBy: ["id"]
                    }
                  )
                : noRows<RentalBillingPeriodRecord>(),
            () =>
              rentalAgreementLineIds.length > 0
                ? many(
                    db,
                    "revenueRecognitionSchedule",
                    {
                      companyId,
                      rentalAgreementLineId: rentalAgreementLineIds,
                      type: "Accrual",
                      billedBySalesInvoiceLineId: isNull
                    },
                    { columns: scheduleColumns, orderBy: ["id"] }
                  )
                : noRows<RentalScheduleRecord>(),
            () =>
              rentalAgreementLineIds.length > 0
                ? many(
                    db,
                    "revenueRecognitionSchedule",
                    {
                      companyId,
                      rentalAgreementLineId: rentalAgreementLineIds,
                      type: "Deferral",
                      status: "Planned"
                    },
                    { columns: scheduleColumns, orderBy: ["id"] }
                  )
                : noRows<RentalScheduleRecord>(),
            () =>
              purchaseOptionAgreementLineIds.length > 0
                ? many(
                    db,
                    "rentalLeaseScheduleLine",
                    {
                      companyId,
                      rentalAgreementLineId: purchaseOptionAgreementLineIds
                    },
                    {
                      columns: [
                        "id",
                        "rentalAgreementLineId",
                        "periodDate",
                        "closingNetInvestment"
                      ],
                      orderBy: ["id"]
                    }
                  )
                : noRows<RentalLeaseScheduleRecord>()
          ]);
          if (rentalAgreementLines.error)
            throw new Error("Failed to fetch rental agreement lines");
          if (rentalBillingPeriods.error)
            throw new Error("Failed to fetch rental billing periods");
          if (rentalAccruals.error || rentalDeferrals.error)
            throw new Error("Failed to fetch rental revenue schedules");
          if (rentalLeaseSchedules.error)
            throw new Error("Failed to fetch rental lease schedules");
          // Each agreement line's lease schedule closing balance: the
          // closingNetInvestment of its last line by period date.
          const leaseClosingTargetByLine = new Map<
            string,
            { periodDate: string; closingNetInvestment: number }
          >();
          for (const row of rentalLeaseSchedules.data ?? []) {
            const latest = leaseClosingTargetByLine.get(
              row.rentalAgreementLineId
            );
            if (!latest || row.periodDate > latest.periodDate) {
              leaseClosingTargetByLine.set(row.rentalAgreementLineId, {
                periodDate: row.periodDate,
                closingNetInvestment: Number(row.closingNetInvestment)
              });
            }
          }
          const scheduleFactsByAgreementLine = (
            rows: RentalScheduleRecord[] | null
          ) => {
            const byLine = new Map<string, RentalScheduleFact[]>();
            for (const row of rows ?? []) {
              if (!row.rentalAgreementLineId) continue;
              const facts = byLine.get(row.rentalAgreementLineId) ?? [];
              facts.push({
                id: row.id,
                periodStart: row.periodStart,
                periodEnd: row.periodEnd,
                scheduledDate: row.scheduledDate,
                amount: Number(row.amount)
              });
              byLine.set(row.rentalAgreementLineId, facts);
            }
            return byLine;
          };

          const journal = buildSalesInvoiceJournal({
            companyId,
            companyGroupId: companyGroupId!,
            invoice: invoiceHeader,
            customerTypeId: customer.data.customerTypeId ?? null,
            intercompanyPartnerId,
            lines: salesInvoiceLines.data,
            headerShipping: headerShippingAllocations,
            items: new Map(items.data.map((item) => [item.id, item])),
            postingGroups: new Map(
              itemCosts.data.map((cost) => [
                cost.itemId,
                cost.itemPostingGroupId
              ])
            ),
            salesOrderLines: new Map(
              salesOrderLines.map((line) => [line.id, line])
            ),
            assets: assetsById,
            rentalAgreementLines: new Map(
              (rentalAgreementLines.data ?? []).map(
                (line: RentalAgreementLineFacts) => [line.id, line]
              )
            ),
            accounts,
            revenue: postingLineRevenue,
            // Built at zero; the posting transaction relieves the cost and
            // fills the pair in (fillDirectCogs).
            directCost: () => 0,
            contract: {
              positions: contractPositionsRead,
              rate: invoiceExchangeRate
            },
            rental: {
              netInvestmentInLeases: netInvestmentInLeasesAccount(
                accounts,
                rentalAgreementLines.data ?? []
              ),
              billingPeriods: new Map(
                (rentalBillingPeriods.data ?? []).map(
                  (period: RentalBillingPeriodRecord) => [period.id, period]
                )
              ),
              accruals: scheduleFactsByAgreementLine(rentalAccruals.data),
              deferrals: scheduleFactsByAgreementLine(rentalDeferrals.data),
              leaseClosing: leaseClosingTargetByLine
            },
            disposal: {
              assets: assetsById,
              latestDisposal: latestDisposalByAsset
            }
          });
          const journalLineInserts = journal.lines;

          // A direct item line ships on the invoice: a shipment (never for a
          // service) and, for a stocked item, the item ledger.
          for (const invoiceLine of salesInvoiceLines.data) {
            if (!isDirectItemLine(invoiceLine)) continue;
            if (invoiceLine.invoiceLineType !== "Service") {
              shipmentLineInserts.push({
                itemId: invoiceLine.itemId!,
                lineId: invoiceLine.id,
                orderQuantity: invoiceLine.quantity,
                outstandingQuantity: invoiceLine.quantity,
                shippedQuantity: invoiceLine.quantity,
                locationId: invoiceLine.locationId,
                storageUnitId: invoiceLine.storageUnitId,
                unitOfMeasure: invoiceLine.unitOfMeasureCode ?? "EA",
                // Net of the line discount: what the line sold for.
                unitPrice: invoiceLine.netUnitPrice ?? 0,
                createdBy: invoiceLine.createdBy,
                companyId
              });
            }
            const itemTrackingType =
              items.data.find((item) => item.id === invoiceLine.itemId)
                ?.itemTrackingType ?? "Inventory";
            if (itemTrackingType === "Inventory") {
              itemLedgerInserts.push({
                postingDate: today,
                itemId: invoiceLine.itemId!,
                quantity: round(-invoiceLine.quantity),
                locationId: invoiceLine.locationId,
                storageUnitId: invoiceLine.storageUnitId,
                entryType: "Negative Adjmt.",
                documentType: "Sales Shipment",
                documentId: invoiceHeader.id ?? undefined,
                externalDocumentId:
                  invoiceHeader.customerReference ?? undefined,
                createdBy: userId,
                companyId
              });
            }
          }

          // An exercised purchase option sells the unit to the lessee. It is a
          // custody fact, so it applies whether or not accounting is on.
          const soldAgreementLineIds = [
            ...new Set<string>(
              salesInvoiceLines.data
                .filter(
                  (line: InvoiceLineRecord) =>
                    line.invoiceLineType === "Rental" &&
                    line.rentalLineType === "Purchase Option"
                )
                .map((line: InvoiceLineRecord) => line.rentalAgreementLineId)
                .filter((id: string | null): id is string => !!id)
            )
          ];

          // A Provisional journal has no accounting period.
          const accountingPeriodId =
            postingStatus === "Posted"
              ? await getCurrentAccountingPeriod(companyId, db, today)
              : null;

          await db.transaction().execute(async (trx) => {
            await assertPostingStatusUnchanged(trx, companyId, postingStatus);
            // The movements above were computed from positions read before
            // this transaction; refuse if another writer moved one since.
            if (contractPositionsRead.size > 0) {
              await lockContractPositions(trx, companyId);
              const current = await loadContractPositions(trx, companyId, [
                ...contractPositionsRead.keys()
              ]);
              for (const [lineId, read] of contractPositionsRead) {
                if (
                  !samePosition(read, current.get(lineId) ?? EMPTY_POSITION)
                ) {
                  throw new Error(
                    "A contract line's revenue position changed while this invoice was posting; post it again"
                  );
                }
              }
            }

            if (shipmentLineInserts.length > 0) {
              const shipmentLinesGroupedByLocationId =
                shipmentLineInserts.reduce<
                  Record<string, typeof shipmentLineInserts>
                >((acc, line) => {
                  if (line.locationId) {
                    if (line.locationId in acc) {
                      acc[line.locationId]!.push(line);
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
                    sourceDocumentId: invoiceHeader.id,
                    sourceDocumentReadableId: invoiceHeader.invoiceId,
                    shippingMethodId:
                      salesInvoiceShipment.data?.shippingMethodId,
                    customerId: invoiceHeader.customerId,
                    externalDocumentId: invoiceHeader.customerReference,
                    status: "Posted",
                    postingDate: today,
                    postedBy: userId,
                    invoiced: true,
                    opportunityId: invoiceHeader.opportunityId,
                    companyId,
                    createdBy: invoiceHeader.createdBy
                  })
                  .returning(["id"])
                  .execute();

                const shipmentId = shipment[0]!.id;
                if (!shipmentId) throw new Error("Failed to insert shipment");

                await trx
                  .insertInto("shipmentLine")
                  .values(
                    shipmentLines.map((r) => ({
                      ...r,
                      shipmentId: shipmentId
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
                .where("companyId", "=", companyId)
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
                    invoiced: true
                  })
                  .where("sourceDocumentId", "=", salesOrderId)
                  .where("companyId", "=", companyId)
                  .execute();
              }

              await trx
                .updateTable("salesOrder")
                .set({
                  status
                })
                .where("id", "=", salesOrderId)
                .where("companyId", "=", companyId)
                .execute();
            }

            // Calculate COGS for direct invoice items (no sales order)
            const directInvoiceItems = salesInvoiceLines.data.filter(
              (line) =>
                line.salesOrderLineId === null &&
                line.itemId &&
                line.invoiceLineType !== "Rental"
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
                companyId
              });

              // The pair the journal builder wrote at zero.
              if (
                fillDirectCogs(
                  journalLineInserts,
                  journal.directCogsReferences.get(directLine.id),
                  cogsResult.totalCost
                )
              ) {
                await trx
                  .insertInto("costLedger")
                  .values({
                    itemLedgerType: "Sale",
                    costLedgerType: "Direct Cost",
                    adjustment: false,
                    documentType: "Sales Shipment",
                    documentId: invoiceHeader.id ?? "",
                    itemId: directLine.itemId,
                    quantity: round(-directLine.quantity),
                    cost: round(-cogsResult.totalCost),
                    remainingQuantity: 0,
                    companyId,
                    postingDate: today
                  })
                  .execute();
              }
            }

            let journalLineResults: { id: string }[] = [];
            // A zero-value invoice has no lines to post; an empty header would
            // still consume a journal entry number.
            if (journalLineInserts.length > 0) {
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
                  description: `Sales Invoice ${invoiceHeader.invoiceId}`,
                  postingDate: today,
                  companyId,
                  sourceType: "Sales Invoice",
                  status: postingStatus,
                  postedAt: datetime.timestamp(),
                  postedBy: userId,
                  createdBy: userId
                })
                .returning(["id"])
                .executeTakeFirstOrThrow();

              journalLineResults = await trx
                .insertInto("journalLine")
                .values(
                  journalLineInserts.map((line) => ({
                    ...accounts.standIns.storedLine(line),
                    journalId: journalResult.id
                  }))
                )
                .returning(["id"])
                .execute();

              const journalLineDimensionInserts = journalLineDimensionRows({
                journalLineIds: journalLineResults.map((line) => line.id),
                lines: journal.metadata.map((meta) => ({
                  dimensions: salesLineDimensions(
                    meta,
                    invoiceHeader.customerId
                  )
                })),
                dimensionIdByEntity: dimensionMap,
                companyId
              });
              if (journalLineDimensionInserts.length > 0) {
                await trx
                  .insertInto("journalLineDimension")
                  .values(journalLineDimensionInserts)
                  .execute();
              }

              // Straight-line each deferred line into Planned schedule rows; a
              // recognition run later moves each row from Deferred Revenue to
              // Sales. The rows sum to the deferred leg exactly.
              if (journal.deferrals.length > 0) {
                await trx
                  .insertInto("revenueRecognitionSchedule")
                  .values(
                    journal.deferrals.flatMap((deferral) =>
                      spreadStraightLine({
                        amount: deferral.amountBase,
                        startDate: deferral.startDate,
                        endDate: deferral.endDate
                      }).map((row) => ({
                        type: "Deferral" as const,
                        status: "Planned" as const,
                        salesInvoiceLineId: deferral.salesInvoiceLineId,
                        periodStart: row.periodStart,
                        periodEnd: row.periodEnd,
                        scheduledDate: row.scheduledDate,
                        amount: row.amount,
                        debitAccountId: deferral.debitAccountId,
                        creditAccountId: deferral.creditAccountId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                  )
                  .execute();
              }

              // One movement per contract invoice line, on this journal.
              if (journal.contractMovements.length > 0) {
                await trx
                  .insertInto("customerContractLedgerEntry")
                  .values(
                    journal.contractMovements.map(({ movement, ...entry }) => ({
                      ...entry,
                      entryType: "Invoice" as const,
                      postingDate: today,
                      deferredAmount: movement.deferredAmount,
                      deferredBase: movement.deferredBase,
                      assetAmount: movement.assetAmount,
                      assetBase: movement.assetBase,
                      companyId,
                      createdBy: userId,
                      journalId: journalResult.id
                    }))
                  )
                  .execute();
              }

              // Rental rent: the unearned part as Planned Deferral rows (an
              // early-return credit as negative rows shrinking its period).
              if (journal.rentalSchedules.length > 0) {
                await trx
                  .insertInto("revenueRecognitionSchedule")
                  .values(
                    journal.rentalSchedules.map((row) => ({
                      type: "Deferral" as const,
                      status: "Planned" as const,
                      ...row,
                      companyId,
                      createdBy: userId
                    }))
                  )
                  .execute();
              }

              // Accrued rent this invoice bills moved off the contract asset;
              // stamp each Accrual row with the line that billed it. A row still
              // Planned debits the contract asset when its run posts, cancelling
              // this credit, so the balance nets to zero whichever posts first.
              // The guard columns make a concurrent bill fail loudly instead of
              // crediting the contract asset twice.
              if (journal.billedAccruals.size > 0) {
                const billed = [...journal.billedAccruals];
                const stamped = await trx
                  .updateTable("revenueRecognitionSchedule")
                  .set({
                    billedBySalesInvoiceLineId: sql<string>`CASE "id" ${sql.join(
                      billed.map(
                        ([accrualId, invoiceLineId]) =>
                          sql`WHEN ${accrualId} THEN ${invoiceLineId}`
                      ),
                      sql` `
                    )} END`,
                    updatedBy: userId,
                    updatedAt: datetime.timestamp()
                  })
                  .where("companyId", "=", companyId)
                  .where(
                    "id",
                    "in",
                    billed.map(([accrualId]) => accrualId)
                  )
                  .where("type", "=", "Accrual")
                  .where("billedBySalesInvoiceLineId", "is", null)
                  .executeTakeFirst();
                if (Number(stamped.numUpdatedRows) !== billed.length) {
                  throw new Error(
                    "A rental accrual changed while this invoice was posting; post it again"
                  );
                }
              }
            }

            // The unit is the lessee's now: the line is Sold, which lets the
            // agreement close. Only a sales-type unit still on rent can be sold;
            // a second purchase option on the same line finds it Sold and fails.
            if (soldAgreementLineIds.length > 0) {
              const sold = await trx
                .updateTable("rentalAgreementLine")
                .set({
                  status: "Sold",
                  updatedBy: userId,
                  updatedAt: datetime.timestamp()
                })
                .where("companyId", "=", companyId)
                .where("id", "in", soldAgreementLineIds)
                .where("lessorClassification", "=", "Sale")
                .where("status", "=", "On Rent")
                .executeTakeFirst();
              if (Number(sold.numUpdatedRows) !== soldAgreementLineIds.length) {
                throw new Error(
                  "A purchase option can only be billed on a unit treated as a sale that is on rent"
                );
              }
            }

            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .returning(["id"])
                .execute();
            }

            if (invoiceHeader.shipmentId) {
              await trx
                .updateTable("shipment")
                .set({
                  invoiced: true
                })
                .where("id", "=", invoiceHeader.shipmentId)
                .where("companyId", "=", companyId)
                .execute();
            }

            // Create intercompany transaction record if IC
            if (isIntercompany && intercompanyPartnerId) {
              const cogsAccount = defaults.costOfGoodsSoldAccount;
              const classifiedLines = classifyIntercompanyPostingLines(
                journalLineInserts.map((line, index) => ({
                  ...line,
                  id: journalLineResults[index]?.id ?? ""
                })),
                journal.metadata,
                {
                  controlAccountId: receivablesAccountId,
                  revenueAccountIds: [
                    defaults.salesAccount,
                    accounts.shippingAccountId
                  ].filter((id): id is string => !!id),
                  cogsAccountId: cogsAccount
                }
              );
              // Keep the first control as the existing matching anchor, but capture
              // every emitted control line so multiline balances eliminate fully.
              const icJournalLineId = classifiedLines.find(
                (line) => line.role === "Control"
              )?.journalLineId;
              const intercompanyAmount = calculateSalesIntercompanyAmount(
                salesInvoiceLines.data,
                invoiceExchangeRate
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
                    description: `Sales Invoice ${invoiceHeader.invoiceId}`,
                    documentType: "Invoice",
                    documentId: invoiceHeader.id,
                    status: "Unmatched"
                  })
                  .returning(["id"])
                  .executeTakeFirstOrThrow();

                const eliminationLineInserts: Database["public"]["Tables"]["intercompanyEliminationLine"]["Insert"][] =
                  classifiedLines.map((line) => ({
                    ...line,
                    accountId: accounts.standIns.storedAccountId(
                      line.accountId
                    ),
                    companyId,
                    intercompanyTransactionId: icTxn.id,
                    createdBy: userId
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
                  )
                ];
                if (cogsAccount && salesOrderIds.length > 0) {
                  const shipmentCogsLines = await trx
                    .selectFrom("journalLine as jl")
                    .innerJoin("journal as j", (join) =>
                      join
                        .onRef("j.id", "=", "jl.journalId")
                        .onRef("j.companyId", "=", "jl.companyId")
                    )
                    .innerJoin("shipment as s", "s.id", "jl.documentId")
                    .select([
                      "jl.id as id",
                      "jl.accountId as accountId",
                      "jl.amount as amount",
                      "jl.quantity as quantity"
                    ])
                    .where("jl.companyId", "=", companyId)
                    .where("jl.accountId", "=", cogsAccount)
                    .where("s.companyId", "=", companyId)
                    .where("s.sourceDocument", "=", "Sales Order")
                    .where("s.sourceDocumentId", "in", salesOrderIds)
                    .where("j.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
                    .execute();
                  for (const cogs of shipmentCogsLines) {
                    eliminationLineInserts.push({
                      companyId,
                      intercompanyTransactionId: icTxn.id,
                      role: "COGS",
                      journalLineId: cogs.id,
                      accountId: cogs.accountId!,
                      amount: cogs.amount ?? 0,
                      itemId: null,
                      quantity: cogs.quantity ?? null,
                      createdBy: userId
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
              ...journal.directDisposals.map(
                (entry) => [entry.assetId, entry.saleProceeds] as const
              ),
              ...journal.shippedDisposals.map(
                (entry) => [entry.assetId, entry.saleProceeds] as const
              )
            ]);
            if (assetProceeds.size > 0) {
              await trx
                .updateTable("fixedAsset")
                .set({
                  saleProceeds: sql<number>`CASE "id" ${sql.join(
                    [...assetProceeds].map(
                      ([id, proceeds]) =>
                        sql`WHEN ${id} THEN ${proceeds}::numeric`
                    ),
                    sql` `
                  )} ELSE "saleProceeds" END`,
                  updatedBy: userId
                })
                .where("id", "in", [...assetProceeds.keys()])
                .where("companyId", "=", companyId)
                .execute();
            }
            if (journal.shippedDisposals.length > 0) {
              const updates = [
                ...new Map(
                  journal.shippedDisposals.map((entry) => [
                    entry.disposalId,
                    entry
                  ])
                ).values()
              ];
              await trx
                .updateTable("fixedAssetDisposal")
                .set({
                  saleProceeds: sql<number>`CASE "id" ${sql.join(
                    updates.map(
                      (entry) =>
                        sql`WHEN ${entry.disposalId} THEN ${entry.saleProceeds}::numeric`
                    ),
                    sql` `
                  )} ELSE "saleProceeds" END`,
                  gainLoss: sql<number>`CASE "id" ${sql.join(
                    updates.map(
                      (entry) =>
                        sql`WHEN ${entry.disposalId} THEN ${entry.gainLoss}::numeric`
                    ),
                    sql` `
                  )} ELSE "gainLoss" END`
                })
                .where(
                  "id",
                  "in",
                  updates.map((entry) => entry.disposalId)
                )
                .where("companyId", "=", companyId)
                .execute();
            }
            if (journal.directDisposals.length > 0) {
              await trx
                .updateTable("fixedAsset")
                .set({
                  status: "Disposed",
                  disposalDate: today,
                  disposalMethod: "Sale",
                  updatedBy: userId
                })
                .where(
                  "id",
                  "in",
                  journal.directDisposals.map((entry) => entry.assetId)
                )
                .where("companyId", "=", companyId)
                .execute();
              await trx
                .insertInto("fixedAssetDisposal")
                .values(
                  journal.directDisposals.map((entry) => ({
                    fixedAssetId: entry.assetId,
                    disposalMethod: "Sale" as const,
                    disposalDate: today,
                    saleProceeds: entry.saleProceeds,
                    netBookValueAtDisposal: entry.netBookValue,
                    gainLoss: entry.gainLoss,
                    companyId,
                    createdBy: userId
                  }))
                )
                .execute();
            }

            // Posting stamps dateIssued with today, so recompute dateDue from
            // the payment term to keep it consistent with the new issue date.
            // With no payment term the invoice still gets one, via Net 30.
            const paymentTerm = invoiceHeader.paymentTermId
              ? await trx
                  .selectFrom("paymentTerm")
                  .select(["daysDue", "calculationMethod"])
                  .where("id", "=", invoiceHeader.paymentTermId)
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
                status: "Submitted"
              })
              .where("id", "=", invoiceId)
              .where("companyId", "=", companyId)
              .execute();
          });
          break;
        }

        case "void": {
          // The enable superseded this invoice's journal and opened its
          // receivable in the opening journal.
          await refuseVoidBeforeCutover(
            db,
            companyId,
            invoiceHeader.postingDate,
            SALES_INVOICE_VOID_BEFORE_CUTOVER_ERROR
          );
          // Get journal entries to reverse
          const journalEntries = await documentJournalLines(db, companyId, {
            documentId: invoiceId,
            documentType: "Invoice"
          });

          // A Rental line's revenue legs reference the rental agreement, not the
          // invoice, so the query above misses them; a contract line's
          // revenue legs (and FX reclass) reference the contract. They share
          // the posting journal and the journal line reference of their
          // invoice line's AR leg, which is how they are found.
          const rentalLineIds = salesInvoiceLines.data
            .filter((line) => line.invoiceLineType === "Rental")
            .map((line) => line.id);
          const contractInvoiceLines = salesInvoiceLines.data.filter(
            (line) => !!line.customerContractLineId
          );
          type JournalLineRecord = Tables["journalLine"]["Row"];
          let rentalJournalEntries: JournalLineRecord[] = [];
          if (
            (rentalLineIds.length > 0 || contractInvoiceLines.length > 0) &&
            journalEntries.length > 0
          ) {
            const journalIds = [
              ...new Set(
                journalEntries.map(
                  (entry: JournalLineRecord) => entry.journalId
                )
              )
            ];
            const references = [
              ...new Set(
                journalEntries
                  .map((entry: JournalLineRecord) => entry.journalLineReference)
                  .filter(
                    (reference: string | null): reference is string =>
                      !!reference
                  )
              )
            ];
            rentalJournalEntries = await documentJournalLines(db, companyId, {
              documentType: ["Rental Agreement", "Contract"],
              journalId: journalIds,
              journalLineReference: references
            });
          }

          // Get shipments created from this invoice
          const { data: invoiceShipments } = await many(
            db,
            "shipment",
            { sourceDocument: "Sales Invoice", sourceDocumentId: invoiceId },
            { columns: ["id"] }
          );

          const salesOrderLinesBySalesOrderLineId = salesOrderLines.reduce<
            Record<
              string,
              Database["public"]["Tables"]["salesOrderLine"]["Row"]
            >
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
                  salesOrderId: salesOrderLine.salesOrderId
                };

              return {
                ...acc,
                [invoiceLine.salesOrderLineId]: updates
              };
            }

            return acc;
          }, {});

          // Deferred revenue already recognized cannot be voided by flipping the
          // invoice journal alone — the recognition journal must be reversed
          // first. Planned rows are dropped inside the void transaction below.
          // A contract line has no Deferral rows (it posts to its position),
          // so this never refuses one: its VOID reclasses instead.
          const invoiceLineIds = salesInvoiceLines.data.map((line) => line.id);
          if (invoiceLineIds.length > 0) {
            const recognized = await db
              .selectFrom("revenueRecognitionSchedule")
              .select(["status"])
              .where("companyId", "=", companyId)
              .where("salesInvoiceLineId", "in", invoiceLineIds)
              .where("status", "=", "Posted")
              .executeTakeFirst();
            if (recognized) {
              throw new InvalidInputError(RECOGNIZED_REVENUE_VOID_ERROR);
            }
          }

          // Create reversing journal entries
          const reversingJournalEntries: Omit<
            Tables["journalLine"]["Insert"],
            "journalId"
          >[] = [...journalEntries, ...rentalJournalEntries].map((entry) => ({
            accountId: entry.accountId,
            // A reversed stand-in line names the same default, so the enable
            // re-points both sides together.
            accountDefaultRole: entry.accountDefaultRole,
            description: `VOID: ${entry.description}`,
            // A reversal is a sign flip of an already-posted value, which is
            // exact — no rounding to do.
            amount: -entry.amount,
            quantity: -entry.quantity,
            ...(entry.documentType === "Rental Agreement" ||
            entry.documentType === "Contract"
              ? {
                  documentType: entry.documentType,
                  documentId: entry.documentId
                }
              : {
                  documentType: "Invoice" as const,
                  documentId: invoiceHeader.id
                }),
            externalDocumentId: entry.externalDocumentId,
            documentLineReference: entry.documentLineReference,
            journalLineReference: entry.journalLineReference,
            companyId
          }));

          // Create reversing item ledger entries
          const reversingItemLedgerEntries: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];

          const { data: originalItemLedgerEntries } = await many(
            db,
            "itemLedger",
            { documentId: invoiceId, documentType: "Sales Shipment" }
          );

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
                documentId: invoiceHeader.id ?? undefined,
                externalDocumentId: entry.externalDocumentId,
                createdBy: userId,
                companyId
              });
            });
          }

          // A Provisional journal has no accounting period.
          const accountingPeriodId =
            postingStatus === "Posted"
              ? await getCurrentAccountingPeriod(companyId, db, today)
              : null;

          await db.transaction().execute(async (trx) => {
            await assertPostingStatusUnchanged(trx, companyId, postingStatus);
            if (invoiceLineIds.length > 0) {
              // Re-checked under lock: a run may have posted since the check
              // above, and its rows must never be dropped. Every row left is
              // Planned; a Draft recognition run may hold some, and its lines
              // go with them (a Draft is a proposal, not a commitment).
              const rows = await trx
                .selectFrom("revenueRecognitionSchedule")
                .select(["id", "status", "runLineId"])
                .where("companyId", "=", companyId)
                .where("salesInvoiceLineId", "in", invoiceLineIds)
                .forUpdate()
                .execute();
              if (rows.some((row) => row.status === "Posted")) {
                throw new InvalidInputError(RECOGNIZED_REVENUE_VOID_ERROR);
              }
              await syncDraftRecognitionRuns(trx, {
                companyId,
                userId,
                deletedScheduleIds: rows
                  .filter((row) => row.runLineId !== null)
                  .map((row) => row.id)
              });
              await trx
                .deleteFrom("revenueRecognitionSchedule")
                .where("companyId", "=", companyId)
                .where("salesInvoiceLineId", "in", invoiceLineIds)
                .execute();
            }

            // Undo what posting a Rental line consumed: its accruals are unbilled
            // again (the reversed journal restores the contract asset), and the
            // billing periods and charges it billed are billable again — and
            // remember the voided invoice, so the automated re-bill is held for
            // review (spec 2026-10-02-rental-invoice-automation).
            if (rentalLineIds.length > 0) {
              const updatedAt = datetime.timestamp();
              await trx
                .updateTable("revenueRecognitionSchedule")
                .set({
                  billedBySalesInvoiceLineId: null,
                  updatedBy: userId,
                  updatedAt
                })
                .where("companyId", "=", companyId)
                .where("billedBySalesInvoiceLineId", "in", rentalLineIds)
                .execute();
              await trx
                .updateTable("rentalBillingPeriod")
                .set({
                  status: "Pending",
                  salesInvoiceLineId: null,
                  voidedSalesInvoiceId: invoiceId,
                  updatedBy: userId,
                  updatedAt
                })
                .where("companyId", "=", companyId)
                .where("salesInvoiceLineId", "in", rentalLineIds)
                .execute();
              await trx
                .updateTable("rentalAgreementCharge")
                .set({
                  salesInvoiceLineId: null,
                  voidedSalesInvoiceId: invoiceId,
                  updatedBy: userId,
                  updatedAt
                })
                .where("companyId", "=", companyId)
                .where("salesInvoiceLineId", "in", rentalLineIds)
                .execute();
              // A voided purchase option un-sells the unit: back on rent, but
              // only if nothing has moved the line on since it was sold.
              const soldAgreementLineIds = [
                ...new Set<string>(
                  salesInvoiceLines.data
                    .filter(
                      (line) =>
                        line.invoiceLineType === "Rental" &&
                        line.rentalLineType === "Purchase Option"
                    )
                    .map((line) => line.rentalAgreementLineId)
                    .filter((id: string | null): id is string => !!id)
                )
              ];
              if (soldAgreementLineIds.length > 0) {
                await trx
                  .updateTable("rentalAgreementLine")
                  .set({ status: "On Rent", updatedBy: userId, updatedAt })
                  .where("companyId", "=", companyId)
                  .where("id", "in", soldAgreementLineIds)
                  .where("status", "=", "Sold")
                  .execute();
              }
            }

            // Undo what drafting a contract invoice stamped: its schedule rows
            // are billable again (remembering the voided invoice, so the
            // automated re-bill is held for review) and the planned invoice is
            // Planned again.
            if (invoiceLineIds.length > 0) {
              const updatedAt = datetime.timestamp();
              await trx
                .updateTable("customerContractInvoiceLine")
                .set({
                  salesInvoiceLineId: null,
                  voidedSalesInvoiceId: invoiceId,
                  updatedBy: userId,
                  updatedAt
                })
                .where("companyId", "=", companyId)
                .where("salesInvoiceLineId", "in", invoiceLineIds)
                .execute();
            }
            await trx
              .updateTable("customerContractInvoice")
              .set({
                status: "Planned",
                salesInvoiceId: null,
                updatedBy: userId,
                updatedAt: datetime.timestamp()
              })
              .where("companyId", "=", companyId)
              .where("salesInvoiceId", "=", invoiceId)
              .execute();

            // Update sales order lines to reverse invoiced quantities
            for await (const [salesOrderLineId, update] of Object.entries(
              salesOrderLineUpdates
            )) {
              await trx
                .updateTable("salesOrderLine")
                .set(update)
                .where("id", "=", salesOrderLineId)
                .where("companyId", "=", companyId)
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
                    invoiced: false
                  })
                  .where("sourceDocumentId", "=", salesOrderId)
                  .where("companyId", "=", companyId)
                  .execute();
              }

              await trx
                .updateTable("salesOrder")
                .set({
                  status
                })
                .where("id", "=", salesOrderId)
                .where("companyId", "=", companyId)
                .execute();
            }

            // A contract line's VOID is the negation of its Invoice entry —
            // the journal above reverses its legs exactly — then any pool the
            // negation drove below zero (the run already recognized part of
            // what this invoice deferred) is reclassed to the other pool, on
            // this VOID journal, so Deferred Revenue and Contract Assets stay
            // max(N, 0) / max(−N, 0) (plan D6).
            const contractVoidEntries: Omit<
              Tables["customerContractLedgerEntry"]["Insert"],
              "journalId"
            >[] = [];
            if (contractInvoiceLines.length > 0) {
              await lockContractPositions(trx, companyId);
              const invoiceEntries = await trx
                .selectFrom("customerContractLedgerEntry")
                .select([
                  "customerContractId",
                  "customerContractLineId",
                  "salesInvoiceLineId",
                  "deferredAmount",
                  "deferredBase",
                  "assetAmount",
                  "assetBase"
                ])
                .where("companyId", "=", companyId)
                .where("entryType", "=", "Invoice")
                .where(
                  "salesInvoiceLineId",
                  "in",
                  contractInvoiceLines.map((line) => line.id)
                )
                .orderBy("createdAt")
                .orderBy("id")
                .execute();
              if (invoiceEntries.length > 0) {
                const positions = await loadContractPositions(
                  trx,
                  companyId,
                  invoiceEntries.map((entry) => entry.customerContractLineId)
                );
                const defaults = await trx
                  .selectFrom("accountDefault")
                  .select(["deferredRevenueAccount", "contractAssetAccount"])
                  .where("companyId", "=", companyId)
                  .executeTakeFirst();
                for (const entry of invoiceEntries) {
                  const negation = negatePosition({
                    deferredAmount: Number(entry.deferredAmount),
                    deferredBase: Number(entry.deferredBase),
                    assetAmount: Number(entry.assetAmount),
                    assetBase: Number(entry.assetBase)
                  });
                  const before = addMovement(
                    positions.get(entry.customerContractLineId) ??
                      EMPTY_POSITION,
                    negation
                  );
                  const reclass = normalizePosition(before);
                  const movement = addMovement(negation, reclass);
                  positions.set(
                    entry.customerContractLineId,
                    addMovement(before, reclass)
                  );
                  contractVoidEntries.push({
                    customerContractId: entry.customerContractId,
                    customerContractLineId: entry.customerContractLineId,
                    entryType: "Void",
                    postingDate: today,
                    salesInvoiceLineId: entry.salesInvoiceLineId,
                    ...movement,
                    companyId,
                    createdBy: userId
                  });
                  // Equal base on both pools: one Contract Assets / Deferred
                  // Revenue pair.
                  if (reclass.deferredBase !== 0) {
                    // The contract defaults never take a stand-in: the void
                    // refuses when either is empty, as the posting does.
                    const deferredRevenueAccount =
                      defaults?.deferredRevenueAccount;
                    const contractAssetAccount = defaults?.contractAssetAccount;
                    if (!deferredRevenueAccount || !contractAssetAccount) {
                      throw new InvalidInputError(
                        "Voiding a contract invoice needs the Deferred Revenue and Contract Assets accounts mapped in the accounting defaults"
                      );
                    }
                    const invoiceLine = contractInvoiceLines.find(
                      (line) => line.id === entry.salesInvoiceLineId
                    );
                    const reference = nanoid();
                    for (const [target, accountClass, description, value] of [
                      [
                        deferredRevenueAccount,
                        "Liability",
                        "VOID: Deferred Revenue reclass",
                        reclass.deferredBase
                      ],
                      [
                        contractAssetAccount,
                        "Asset",
                        "VOID: Contract Assets reclass",
                        -reclass.assetBase
                      ]
                    ] as const) {
                      reversingJournalEntries.push({
                        accountId: target,
                        description,
                        amount: signedCreditAmount(accountClass, value),
                        quantity: invoiceLine?.quantity ?? 0,
                        documentType: "Contract",
                        documentId: entry.customerContractId,
                        externalDocumentId: invoiceHeader.customerReference,
                        documentLineReference: null,
                        journalLineReference: reference,
                        companyId
                      });
                    }
                  }
                }
              }
            }

            // Nothing to reverse for a zero-value invoice — no empty VOID header.
            if (reversingJournalEntries.length > 0) {
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
                  description: `VOID Sales Invoice ${invoiceHeader.invoiceId}`,
                  postingDate: today,
                  companyId,
                  sourceType: "Sales Invoice",
                  status: postingStatus,
                  postedAt: datetime.timestamp(),
                  postedBy: userId,
                  createdBy: userId
                })
                .returning(["id"])
                .executeTakeFirstOrThrow();

              await trx
                .insertInto("journalLine")
                .values(
                  reversingJournalEntries.map((line) => ({
                    ...line,
                    journalId: voidJournalResult.id
                  }))
                )
                .returning(["id"])
                .execute();

              if (contractVoidEntries.length > 0) {
                await trx
                  .insertInto("customerContractLedgerEntry")
                  .values(
                    contractVoidEntries.map((entry) => ({
                      ...entry,
                      journalId: voidJournalResult.id
                    }))
                  )
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
                    updatedBy: userId
                  })
                  .where("id", "=", shipment.id)
                  .where("companyId", "=", companyId)
                  .execute();
              }
            }

            // Remove invoiced flag from related shipment if it exists
            if (invoiceHeader.shipmentId) {
              await trx
                .updateTable("shipment")
                .set({
                  invoiced: false
                })
                .where("id", "=", invoiceHeader.shipmentId)
                .where("companyId", "=", companyId)
                .execute();
            }

            // Update invoice status to voided
            await trx
              .updateTable("salesInvoice")
              .set({
                status: "Voided",
                updatedAt: today,
                updatedBy: userId
              })
              .where("id", "=", invoiceId)
              .where("companyId", "=", companyId)
              .execute();
          });

          break;
        }
      }

      return { success: true };
    } catch (err) {
      // A failed VOID must not touch status: the invoice is still Posted and its
      // ledger/journal rows still stand, so forcing it to Draft would contradict
      // the books and let it be edited and posted a second time. Same guard
      // post-receipt, post-shipment and post-purchase-invoice carry.
      if (type !== "void") {
        await updateRows(
          db,
          "salesInvoice",
          { status: "Draft" },
          { id: invoiceId, companyId }
        );
      }
      throw err;
    }
  }
});

export default postSalesInvoice;
