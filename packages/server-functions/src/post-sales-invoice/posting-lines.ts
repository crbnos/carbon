// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal of one sales invoice, from facts the caller loaded. No reads and
// no writes. `post-sales-invoice` posts it, and the accounting cutover's
// legacy backfill (`activate-accounting/legacy/sales-invoice.ts`) writes it
// again for an invoice that has none. Both use the steps below, in the order
// the posting runs them:
//
// 1. `planSalesInvoiceAccounts` — the account ids to read. It refuses an
//    empty default that a line needs, before any account is read.
// 2. `resolveSalesInvoiceAccounts` — the accounts read, validated. Both are
//    in posting-accounts.ts; `postingAccountNeeds` says what the posting's
//    lines need.
// 3. `buildSalesInvoiceJournal` — the journal lines and their dimension
//    metadata, and what the posting writes next to them (schedule rows,
//    contract movements, asset disposals).
// 4. `salesLineDimensions` — the dimension values of each line, which
//    `journalLineDimensionRows` (lib/journal-line-dimensions) writes.
//
// The caller decides where each line's revenue goes (`SalesLineRevenue`).
// The posting uses `postingLineRevenue`. The backfill books plain revenue,
// or the deferral rows that it found, and needs no contract, rental or
// disposal facts.

import { type Database, journalReference } from "@carbon/database";
import {
  addMovement,
  type ContractMovement,
  type ContractPosition,
  EMPTY_POSITION
} from "@carbon/database/contract-position";
import {
  buildSalesPostingLines,
  credit,
  debit,
  round,
  roundSalesPostingAmounts,
  type SalesPostingAccount,
  type SalesPostingMetadata,
  type SalesRevenueLeg,
  type ScheduleRow
} from "@carbon/utils";
import { nanoid } from "nanoid";
import { signedCreditAmount } from "../lib/contract-ledger";
import { resolveInventoryAccount } from "../lib/get-posting-group";
import type { JournalLineDimensionValues } from "../lib/journal-line-dimensions";
import { planContractInvoiceLine } from "./contract-posting";
import {
  isLeaf,
  type SalesInvoiceAccountNeeds,
  type SalesInvoiceAccounts
} from "./posting-accounts";
import {
  leaseSettlementJournalLines,
  planRentalLine,
  purchaseOptionSettlement,
  type RentalScheduleFact,
  rentalScheduleRows
} from "./rental-posting";

type Tables = Database["public"]["Tables"];

/** A journal line as the posting inserts it, before its journal exists. */
export type SalesInvoiceJournalLine = Omit<
  Tables["journalLine"]["Insert"],
  "journalId"
>;

/** The invoice line fields the journal reads. */
export type SalesInvoiceLine = Pick<
  Tables["salesInvoiceLine"]["Row"],
  | "id"
  | "invoiceLineType"
  | "itemId"
  | "quantity"
  | "unitPrice"
  | "discountPercent"
  | "shippingCost"
  | "addOnCost"
  | "nonTaxableAddOnCost"
  | "taxPercent"
  | "salesOrderLineId"
  | "methodType"
  | "locationId"
  | "projectId"
  | "customerContractId"
  | "customerContractLineId"
  | "serviceStartDate"
  | "serviceEndDate"
  | "assetId"
  | "rentalAgreementLineId"
  | "rentalBillingPeriodId"
  | "rentalLineType"
>;

/** The line types that sell an item. */
export const ITEM_LINE_TYPES: ReadonlySet<string> = new Set([
  "Part",
  "Service",
  "Consumable",
  "Fixture",
  "Material",
  "Tool"
]);

/**
 * An item line with no sales order that is not built to order. Its posting
 * ships it: it writes the shipment and the item ledger, and its COGS pair
 * is in the invoice journal. A sales-order or Make-to-Order line keeps the
 * COGS that its shipment posted.
 */
export function isDirectItemLine(line: SalesInvoiceLine): boolean {
  return (
    ITEM_LINE_TYPES.has(line.invoiceLineType) &&
    line.salesOrderLineId === null &&
    line.methodType !== "Make to Order"
  );
}

/**
 * The service range of a line whose revenue the posting defers. Only a
 * Service line is deferred: every other item type is a physical good, earned
 * when it ships, so dates left on one (a line whose type changed, an API
 * write) must not move its revenue. Rental and contract lines defer through
 * their own paths (plan D6).
 */
export function deferredServicePeriod(
  line: SalesInvoiceLine
): { startDate: string; endDate: string } | null {
  return line.invoiceLineType === "Service" &&
    !line.customerContractLineId &&
    line.serviceStartDate &&
    line.serviceEndDate
    ? { startDate: line.serviceStartDate, endDate: line.serviceEndDate }
    : null;
}

/** Where a line's revenue goes. The legs, AR, tax and shipping follow. */
export type SalesLineRevenue =
  /** The Sales Account, whatever the line's type. */
  | { book: "sales" }
  /** Deferred Revenue now, recognized straight-line over the period. */
  | { book: "deferral"; startDate: string; endDate: string }
  /** These revenue legs. The last leg takes the remainder. */
  | { book: "legs"; legs: SalesRevenueLeg[] }
  /** The contract line's position (`planContractInvoiceLine`). */
  | { book: "contract" }
  /** The rental agreement line (`planRentalLine`). */
  | { book: "rental" }
  /** The asset's disposal: proceeds against its carrying value. */
  | { book: "disposal" };

/** Where the posting books a line's revenue. A Comment line posts nothing
 *  and never gets here. */
export function postingLineRevenue(line: SalesInvoiceLine): SalesLineRevenue {
  if (ITEM_LINE_TYPES.has(line.invoiceLineType)) {
    if (line.customerContractLineId) return { book: "contract" };
    const period = deferredServicePeriod(line);
    return period ? { book: "deferral", ...period } : { book: "sales" };
  }
  if (line.invoiceLineType === "Fixed Asset") return { book: "disposal" };
  if (line.invoiceLineType === "Rental") return { book: "rental" };
  throw new Error("Unsupported invoice line type");
}

type FixedAssetClassAccounts = Pick<
  Tables["fixedAssetClass"]["Row"],
  | "assetAccountId"
  | "accumulatedDepreciationAccountId"
  | "writeOffAccountId"
  | "gainOnDisposalAccountId"
  | "lossOnDisposalAccountId"
>;

/** The defaults the posting reads for these lines and the classes of the
 *  assets that they sell. */
export function postingAccountNeeds(
  lines: readonly SalesInvoiceLine[],
  assetClasses: Iterable<FixedAssetClassAccounts | null>
): SalesInvoiceAccountNeeds {
  const rentalLines = lines.filter((line) => line.invoiceLineType === "Rental");
  return {
    deferredRevenue: lines.some((line) => deferredServicePeriod(line) !== null),
    rental:
      rentalLines.length > 0
        ? {
            purchaseOption: rentalLines.some(
              (line) => line.rentalLineType === "Purchase Option"
            )
          }
        : null,
    contract: lines.some(
      (line) =>
        !!line.customerContractLineId && line.invoiceLineType !== "Comment"
    ),
    accountIds: [...assetClasses].flatMap((assetClass) => [
      assetClass?.assetAccountId,
      assetClass?.accumulatedDepreciationAccountId,
      assetClass?.writeOffAccountId,
      assetClass?.gainOnDisposalAccountId,
      assetClass?.lossOnDisposalAccountId
    ])
  };
}

export type RentalAgreementLineFacts = Pick<
  Tables["rentalAgreementLine"]["Row"],
  "id" | "rentalAgreementId" | "itemId" | "lessorClassification"
>;

/** A fixed asset sold on a Fixed Asset line, with its class's accounts. */
export type DisposableAsset = Pick<
  Tables["fixedAsset"]["Row"],
  | "id"
  | "status"
  | "acquisitionCost"
  | "accumulatedDepreciation"
  | "locationId"
  | "fixedAssetClassId"
> & {
  fixedAssetClass:
    | (Pick<Tables["fixedAssetClass"]["Row"], "id"> & FixedAssetClassAccounts)
    | null;
};

/** The facts a contract line moves its position with. */
export type SalesInvoiceContractFacts = {
  /** Each contract line's position before this invoice. */
  positions: ReadonlyMap<string, ContractPosition>;
  /** The invoice's rate, foreign units per base unit. */
  rate: number;
};

/** The facts a rental line posts with, by agreement line. */
export type SalesInvoiceRentalFacts = {
  netInvestmentInLeases: SalesPostingAccount | null;
  billingPeriods: ReadonlyMap<
    string,
    { periodStart: string; periodEnd: string }
  >;
  /** Unbilled Accrual rows (Planned or Posted). */
  accruals: ReadonlyMap<string, RentalScheduleFact[]>;
  /** Planned Deferral rows. */
  deferrals: ReadonlyMap<string, RentalScheduleFact[]>;
  /** The lease schedule's closing balance, which a purchase option settles. */
  leaseClosing: ReadonlyMap<
    string,
    { periodDate: string; closingNetInvestment: number }
  >;
};

/** The facts a Fixed Asset line disposes its asset with. */
export type SalesInvoiceDisposalFacts = {
  assets: ReadonlyMap<string, DisposableAsset>;
  /** The latest disposal of each asset, which its shipment wrote. */
  latestDisposal: ReadonlyMap<
    string,
    Pick<Tables["fixedAssetDisposal"]["Row"], "id" | "netBookValueAtDisposal">
  >;
};

export type SalesInvoiceJournalFacts = {
  companyId: string;
  companyGroupId: string;
  invoice: {
    id: string;
    customerId: string | null;
    customerReference: string | null;
  };
  customerTypeId: string | null;
  /** The customer's company in the group; null for an outside customer. */
  intercompanyPartnerId: string | null;
  /** In posting order. */
  lines: readonly SalesInvoiceLine[];
  /** The header shipping of each line (`allocateSalesHeaderShipping`). */
  headerShipping: ReadonlyMap<string, number>;
  items: ReadonlyMap<
    string,
    Pick<Tables["item"]["Row"], "itemTrackingType" | "replenishmentSystem">
  >;
  /** Each item's posting group. */
  postingGroups: ReadonlyMap<string, string | null>;
  salesOrderLines: ReadonlyMap<
    string,
    Pick<Tables["salesOrderLine"]["Row"], "locationId" | "sentComplete">
  >;
  assets: ReadonlyMap<
    string,
    Pick<Tables["fixedAsset"]["Row"], "locationId" | "fixedAssetClassId">
  >;
  rentalAgreementLines: ReadonlyMap<string, RentalAgreementLineFacts>;
  accounts: SalesInvoiceAccounts;
  /** Where each line's revenue goes. */
  revenue: (line: SalesInvoiceLine) => SalesLineRevenue;
  /** The cost of a direct inventory line's COGS pair, called once per such
   *  line in order. Null writes no pair. */
  directCost: (line: SalesInvoiceLine) => number | null;
  /** Required by a `contract` line. */
  contract: SalesInvoiceContractFacts | null;
  /** Required by a `rental` line. */
  rental: SalesInvoiceRentalFacts | null;
  /** Required by a `disposal` line. */
  disposal: SalesInvoiceDisposalFacts | null;
};

/** What the posting writes with the journal, from the same lines. */
export type SalesInvoiceJournal = {
  lines: SalesInvoiceJournalLine[];
  /** One per line: the dimensions it carries. */
  metadata: SalesPostingMetadata[];
  /** Deferred service lines, spread into Planned Deferral rows. */
  deferrals: {
    salesInvoiceLineId: string;
    amountBase: number;
    debitAccountId: string;
    creditAccountId: string;
    startDate: string;
    endDate: string;
  }[];
  /** One movement per contract line that moved its position. */
  contractMovements: {
    customerContractId: string;
    customerContractLineId: string;
    salesInvoiceLineId: string;
    movement: ContractMovement;
  }[];
  /** Planned Deferral rows of rent. */
  rentalSchedules: (ScheduleRow & {
    salesInvoiceLineId: string;
    rentalAgreementLineId: string;
    debitAccountId: string;
    creditAccountId: string;
  })[];
  /** Accrual rows this invoice bills, by the invoice line that bills them. */
  billedAccruals: Map<string, string>;
  /** The journalLineReference of each direct line's COGS pair, by invoice
   *  line id: the posting fills that pair once it relieves the cost. */
  directCogsReferences: Map<string, string>;
  /** Assets sold after their shipment wrote the disposal. */
  shippedDisposals: {
    disposalId: string;
    assetId: string;
    saleProceeds: number;
    gainLoss: number;
  }[];
  /** Assets sold on the invoice alone. */
  directDisposals: {
    assetId: string;
    saleProceeds: number;
    netBookValue: number;
    gainLoss: number;
  }[];
};

/** The metadata of a line's legs, by its type. */
function lineMetadata(
  facts: SalesInvoiceJournalFacts,
  line: SalesInvoiceLine
): SalesPostingMetadata {
  const projectId = line.projectId ?? null;
  if (line.invoiceLineType === "Fixed Asset") {
    const asset = line.assetId ? facts.assets.get(line.assetId) : undefined;
    const salesOrderLine = line.salesOrderLineId
      ? facts.salesOrderLines.get(line.salesOrderLineId)
      : undefined;
    return {
      customerTypeId: facts.customerTypeId,
      itemPostingGroupId: null,
      itemId: null,
      locationId:
        line.locationId ??
        salesOrderLine?.locationId ??
        asset?.locationId ??
        null,
      costCenterId: null,
      fixedAssetClassId: asset?.fixedAssetClassId ?? null,
      projectId
    };
  }
  if (line.invoiceLineType === "Rental") {
    const agreementLine = line.rentalAgreementLineId
      ? facts.rentalAgreementLines.get(line.rentalAgreementLineId)
      : undefined;
    return {
      customerTypeId: facts.customerTypeId,
      itemPostingGroupId: null,
      // The rented unit's item, for the Item dimension only.
      itemId: agreementLine?.itemId ?? null,
      locationId: line.locationId ?? null,
      costCenterId: null,
      fixedAssetClassId: null,
      projectId
    };
  }
  return {
    customerTypeId: facts.customerTypeId,
    itemPostingGroupId: line.itemId
      ? (facts.postingGroups.get(line.itemId) ?? null)
      : null,
    itemId: line.itemId ?? null,
    locationId: line.locationId ?? null,
    costCenterId: null,
    fixedAssetClassId: null,
    projectId
  };
}

/** The COGS pair of a direct inventory line, at `cost`: Dr Cost of Goods Sold,
 *  Cr the item's inventory account. */
function directCogsLines(
  facts: SalesInvoiceJournalFacts,
  line: SalesInvoiceLine,
  cost: number
): SalesInvoiceJournalLine[] {
  const { defaults } = facts.accounts;
  const item = line.itemId ? facts.items.get(line.itemId) : undefined;
  const inventoryAccount = resolveInventoryAccount(
    item?.replenishmentSystem ?? null,
    defaults
  );
  const keys = {
    quantity: round(line.quantity),
    documentType: "Invoice" as const,
    documentId: facts.invoice.id,
    externalDocumentId: facts.invoice.customerReference,
    journalLineReference: nanoid(),
    companyId: facts.companyId
  };
  return [
    {
      accountId: defaults.costOfGoodsSoldAccount,
      description: "Cost of Goods Sold",
      amount: round(debit("expense", cost)),
      ...keys
    },
    {
      accountId: inventoryAccount.account,
      description: inventoryAccount.description,
      amount: round(credit("asset", cost)),
      ...keys
    }
  ];
}

/**
 * Sets the cost of a direct line's COGS pair, written at zero before the
 * posting relieved the cost. The pair is found by its journalLineReference
 * (`directCogsReferences`), not by quantity, so two direct lines of one
 * quantity can never take each other's cost. Returns false when there is
 * no such pair.
 */
export function fillDirectCogs(
  lines: SalesInvoiceJournalLine[],
  journalLineReference: string | undefined,
  totalCost: number
): boolean {
  if (!journalLineReference) return false;
  const pair = lines.filter(
    (line) => line.journalLineReference === journalLineReference
  );
  const cogs = pair.find((line) => line.description === "Cost of Goods Sold");
  const inventory = pair.find((line) => line !== cogs);
  if (!cogs || !inventory) return false;
  cogs.amount = round(debit("expense", totalCost));
  inventory.amount = round(credit("asset", totalCost));
  return true;
}

const required = <T>(value: T | null, what: string): T => {
  if (value === null) throw new Error(`A sales invoice line needs ${what}`);
  return value;
};

/**
 * The journal of one sales invoice: for each line, its revenue legs (as
 * `facts.revenue` books them), shipping, tax and receivable through
 * `buildSalesPostingLines`, then the COGS pair of a direct inventory line.
 * Throws on the first line that cannot post.
 */
export function buildSalesInvoiceJournal(
  facts: SalesInvoiceJournalFacts
): SalesInvoiceJournal {
  const { accounts, invoice, companyId } = facts;
  const charges = accounts.charges(facts.intercompanyPartnerId !== null);
  // Each contract line's running position, so two lines of one contract
  // line on this invoice see each other.
  const positions = new Map(facts.contract?.positions ?? []);
  const journal: SalesInvoiceJournal = {
    lines: [],
    metadata: [],
    deferrals: [],
    contractMovements: [],
    rentalSchedules: [],
    billedAccruals: new Map(),
    directCogsReferences: new Map(),
    shippedDisposals: [],
    directDisposals: []
  };
  const push = (
    lines: SalesInvoiceJournalLine[],
    metadata: SalesPostingMetadata | SalesPostingMetadata[]
  ) => {
    lines.forEach((line, index) => {
      journal.lines.push(line);
      journal.metadata.push(
        Array.isArray(metadata) ? metadata[index]! : metadata
      );
    });
  };

  for (const line of facts.lines) {
    if (line.invoiceLineType === "Comment") continue;
    const revenue = facts.revenue(line);
    const metadata = lineMetadata(facts, line);
    const postingLine = {
      ...line,
      allocatedHeaderShipping: facts.headerShipping.get(line.id) ?? 0
    };
    const context = {
      companyId,
      companyGroupId: facts.companyGroupId,
      documentId: invoice.id,
      externalDocumentId: invoice.customerReference,
      documentLineReference: line.salesOrderLineId
        ? journalReference.to.salesInvoice(line.salesOrderLineId)
        : null,
      journalLineReference: nanoid(),
      intercompanyPartnerId: facts.intercompanyPartnerId
    };

    switch (revenue.book) {
      case "sales":
      case "legs": {
        const built = buildSalesPostingLines({
          line: {
            ...postingLine,
            // Booked as plain revenue, a rental or fixed-asset line needs no
            // rental legs and no disposal.
            invoiceLineType:
              line.invoiceLineType === "Rental" ||
              line.invoiceLineType === "Fixed Asset"
                ? "Part"
                : line.invoiceLineType
          },
          context,
          accounts: charges,
          revenueLegs: revenue.book === "legs" ? revenue.legs : undefined,
          metadata
        });
        push(built.lines, built.metadata);
        break;
      }
      case "deferral": {
        // The sales leg is credited to Deferred Revenue now, and a
        // straight-line schedule recognizes it into Sales later.
        const deferredRevenue = required(
          accounts.deferredRevenue,
          "the Deferred Revenue account to defer"
        );
        const built = buildSalesPostingLines({
          line: postingLine,
          context,
          accounts: charges,
          deferredRevenueAccount: deferredRevenue,
          metadata
        });
        push(built.lines, built.metadata);
        if (built.amounts.salesRevenueBase !== 0) {
          // The run credits Sales when it recognizes, so the revenue account
          // must be valid even though this posting skipped it.
          const salesAccount = charges.sales;
          if (!isLeaf(salesAccount, "Revenue")) {
            throw new Error(
              "Invalid or missing Sales Account; a deferred line needs an active Revenue leaf to recognize into"
            );
          }
          journal.deferrals.push({
            salesInvoiceLineId: line.id,
            // The builder's sales component IS the deferral leg in base
            // currency (credit("liability", x) === x).
            amountBase: built.amounts.salesRevenueBase,
            debitAccountId: deferredRevenue.id,
            creditAccountId: salesAccount.id,
            startDate: revenue.startDate,
            endDate: revenue.endDate
          });
        }
        break;
      }
      case "contract": {
        // A contract line moves its position: Cr Contract Assets for what the
        // run accrued ahead of billing, the rest Cr Deferred Revenue (a
        // negative line the reverse), and the run recognizes from there. No
        // schedule rows (plan D6).
        const contract = required(facts.contract, "its contract positions");
        const contractAccounts = required(
          accounts.contract,
          "the contract accounts"
        );
        const contractLineId = required(
          line.customerContractLineId,
          "a contract line"
        );
        const contractDocumentId = line.customerContractId ?? invoice.id;
        const position = positions.get(contractLineId) ?? EMPTY_POSITION;
        const plan = planContractInvoiceLine({
          position,
          revenueBase: roundSalesPostingAmounts(postingLine).salesRevenueBase,
          rate: contract.rate,
          accounts: contractAccounts,
          customerContractId: contractDocumentId
        });
        const built = buildSalesPostingLines({
          line: postingLine,
          context,
          accounts: charges,
          revenueLegs: plan.revenueLegs,
          metadata
        });
        push(built.lines, built.metadata);
        // Same journal line reference, so a VOID reverses them with the line.
        push(
          plan.reclass.map((reclass) => ({
            accountId: reclass.account.id,
            description: reclass.description,
            amount: signedCreditAmount(reclass.accountClass, reclass.credit),
            quantity: round(line.quantity),
            documentType: "Contract" as const,
            documentId: contractDocumentId,
            externalDocumentId: context.externalDocumentId,
            documentLineReference: context.documentLineReference,
            journalLineReference: context.journalLineReference,
            companyId
          })),
          metadata
        );
        positions.set(contractLineId, addMovement(position, plan.movement));
        if (
          plan.movement.deferredAmount !== 0 ||
          plan.movement.assetAmount !== 0 ||
          plan.movement.deferredBase !== 0 ||
          plan.movement.assetBase !== 0
        ) {
          journal.contractMovements.push({
            customerContractId: line.customerContractId!,
            customerContractLineId: contractLineId,
            salesInvoiceLineId: line.id,
            movement: plan.movement
          });
        }
        break;
      }
      case "disposal": {
        const disposalFacts = required(facts.disposal, "its asset facts");
        if (!line.assetId)
          throw new Error(
            `Fixed Asset invoice line ${line.id} has no asset selected`
          );
        const asset = disposalFacts.assets.get(line.assetId);
        const assetClass = asset?.fixedAssetClass;
        if (!asset || !assetClass)
          throw new Error(`Failed to fetch fixed asset/class ${line.assetId}`);
        const salesOrderLine = line.salesOrderLineId
          ? facts.salesOrderLines.get(line.salesOrderLineId)
          : undefined;
        const wasShipped =
          salesOrderLine?.sentComplete === true && !!line.salesOrderLineId;
        const disposal = wasShipped
          ? disposalFacts.latestDisposal.get(line.assetId)
          : undefined;
        if (wasShipped && !disposal) {
          throw new Error(
            `No disposal record found for asset ${line.assetId} — shipment must create it before invoice posting`
          );
        }
        const disposalAccounts = {
          gainAccount: accounts.account(assetClass.gainOnDisposalAccountId),
          lossAccount: accounts.account(assetClass.lossOnDisposalAccountId)
        };
        const built = buildSalesPostingLines({
          line: postingLine,
          context,
          accounts: charges,
          metadata,
          disposal:
            wasShipped && disposal
              ? {
                  mode: "shipment",
                  netBookValue: Number(disposal.netBookValueAtDisposal),
                  clearingAccount: accounts.account(
                    assetClass.writeOffAccountId
                  ),
                  ...disposalAccounts
                }
              : {
                  mode: "direct",
                  acquisitionCost: Number(asset.acquisitionCost),
                  accumulatedDepreciation: Number(
                    asset.accumulatedDepreciation
                  ),
                  assetAccount: accounts.account(assetClass.assetAccountId),
                  accumulatedDepreciationAccount: accounts.account(
                    assetClass.accumulatedDepreciationAccountId
                  ),
                  ...disposalAccounts
                }
        });
        push(built.lines, built.metadata);
        if (built.netBookValue === null || built.gainLoss === null) {
          throw new Error(
            "Fixed asset disposal posting is missing carrying values"
          );
        }
        if (wasShipped && disposal) {
          journal.shippedDisposals.push({
            disposalId: disposal.id,
            assetId: line.assetId,
            saleProceeds: built.saleProceeds,
            gainLoss: built.gainLoss
          });
        } else {
          journal.directDisposals.push({
            assetId: line.assetId,
            saleProceeds: built.saleProceeds,
            netBookValue: built.netBookValue,
            gainLoss: built.gainLoss
          });
        }
        break;
      }
      case "rental": {
        // A Rental line has no item: nothing ships, nothing leaves stock, and
        // there is no COGS. Only its revenue legs differ from a sale.
        const rental = required(facts.rental, "its rental facts");
        const rentalAccounts = required(accounts.rental, "the rental accounts");
        const agreementLine = line.rentalAgreementLineId
          ? facts.rentalAgreementLines.get(line.rentalAgreementLineId)
          : undefined;
        if (!agreementLine) {
          throw new Error(
            `Rental invoice line ${line.id} has no rental agreement line`
          );
        }
        if (!line.rentalLineType) {
          throw new Error(
            `Rental invoice line ${line.id} has no rental line type`
          );
        }
        const billingPeriod = line.rentalBillingPeriodId
          ? rental.billingPeriods.get(line.rentalBillingPeriodId)
          : undefined;
        if (line.rentalBillingPeriodId && !billingPeriod) {
          throw new Error(
            `Rental billing period ${line.rentalBillingPeriodId} was not found`
          );
        }
        const period = billingPeriod
          ? {
              periodStart: billingPeriod.periodStart,
              periodEnd: billingPeriod.periodEnd
            }
          : line.serviceStartDate && line.serviceEndDate
            ? {
                periodStart: line.serviceStartDate,
                periodEnd: line.serviceEndDate
              }
            : null;
        const plan = planRentalLine({
          lineType: line.rentalLineType,
          classification: agreementLine.lessorClassification,
          revenueBase: roundSalesPostingAmounts(postingLine).salesRevenueBase,
          period,
          unbilledAccruals: (
            rental.accruals.get(agreementLine.id) ?? []
          ).filter((row) => !journal.billedAccruals.has(row.id)),
          plannedDeferrals: rental.deferrals.get(agreementLine.id) ?? [],
          accounts: {
            ...rentalAccounts,
            netInvestmentInLeases: rental.netInvestmentInLeases
          },
          rentalAgreementId: agreementLine.rentalAgreementId
        });
        const built = buildSalesPostingLines({
          line: postingLine,
          context,
          accounts: charges,
          revenueLegs: plan.revenueLegs,
          metadata
        });
        push(built.lines, built.metadata);
        // An exercised purchase option derecognizes the whole net
        // investment: the schedule's closing balance less the option just
        // credited goes to COGS (a shortfall) or Lease Revenue (a gain), on
        // the same journal line reference so a VOID reverses it.
        if (
          line.rentalLineType === "Purchase Option" &&
          agreementLine.lessorClassification === "Sale" &&
          rental.netInvestmentInLeases
        ) {
          const closing = rental.leaseClosing.get(agreementLine.id);
          if (!closing) {
            throw new Error(
              `Rental agreement line ${agreementLine.id} has no lease schedule to settle the purchase option against`
            );
          }
          push(
            leaseSettlementJournalLines(
              purchaseOptionSettlement({
                closingTarget: closing.closingNetInvestment,
                // The Net Investment leg is the plan's only revenue leg.
                optionAmount: built.revenueLegAmounts[0] ?? 0,
                accounts: {
                  netInvestmentInLeases: rental.netInvestmentInLeases,
                  costOfGoodsSold: accounts.account(
                    accounts.defaults.costOfGoodsSoldAccount
                  ),
                  leaseRevenue: accounts.account(
                    accounts.standIns.defaultId("leaseRevenueAccount")
                  )
                },
                rentalAgreementId: agreementLine.rentalAgreementId
              }),
              {
                companyId,
                quantity: line.quantity,
                journalLineReference: context.journalLineReference,
                externalDocumentId: context.externalDocumentId,
                documentLineReference: context.documentLineReference
              }
            ),
            // Derecognition (COGS / Lease Revenue) is not the line's revenue
            // side, so it carries no project.
            { ...metadata, projectId: null }
          );
        }
        for (const accrualId of plan.billedAccrualIds) {
          journal.billedAccruals.set(accrualId, line.id);
        }
        // The deferred-revenue leg is always the last revenue leg; its posted
        // base amount is what the Deferral rows must sum to.
        const deferredAmount =
          built.revenueLegAmounts[built.revenueLegAmounts.length - 1] ?? 0;
        for (const row of rentalScheduleRows(plan.schedule, deferredAmount)) {
          journal.rentalSchedules.push({
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            scheduledDate: row.scheduledDate,
            amount: row.amount,
            salesInvoiceLineId: line.id,
            rentalAgreementLineId: agreementLine.id,
            debitAccountId: rentalAccounts.deferredRevenue.id,
            creditAccountId: rentalAccounts.rentalIncome.id
          });
        }
        break;
      }
    }

    // A direct line ships here, so its COGS is in this journal.
    if (isDirectItemLine(line)) {
      const item = line.itemId ? facts.items.get(line.itemId) : undefined;
      if ((item?.itemTrackingType ?? "Inventory") === "Inventory") {
        const cost = facts.directCost(line);
        if (cost !== null) {
          const pair = directCogsLines(facts, line, cost);
          journal.directCogsReferences.set(
            line.id,
            pair[0]!.journalLineReference
          );
          push(pair, {
            ...metadata,
            projectId: null
          });
        }
      }
    }
  }
  return journal;
}

/** A line's dimension values by entity type, in write order
 *  (`journalLineDimensionRows`). The project is on the revenue side only
 *  (`buildSalesPostingLines`); the customer is on every line. */
export function salesLineDimensions(
  meta: SalesPostingMetadata,
  customerId: string | null
): JournalLineDimensionValues {
  return {
    CustomerType: meta.customerTypeId,
    ItemPostingGroup: meta.itemPostingGroupId,
    Location: meta.locationId,
    CostCenter: meta.costCenterId,
    FixedAssetClass: meta.fixedAssetClassId,
    Item: meta.itemId,
    Project: meta.projectId ?? null,
    Customer: customerId
  };
}
