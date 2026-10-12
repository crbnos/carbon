// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The accounts of one sales invoice journal, from the loaded account
// defaults and account rows. No reads. `post-sales-invoice` and the legacy
// backfill both resolve them here, in two steps around the one account read:
// `planSalesInvoiceAccounts` (the ids to read, and a refusal for an empty
// default a line needs) and `resolveSalesInvoiceAccounts` (the rows read,
// validated). `posting-lines.ts` builds the journal on them.

import type { Database } from "@carbon/database";
import {
  type AutomaticJournalStatus,
  MissingAccountDefaultError,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import type { SalesPostingAccount } from "@carbon/utils";
import { InvalidInputError } from "../errors";
import { salesInvoiceStandIns } from "../lib/sales-invoice-stand-ins";
import type { ContractPostingAccounts } from "./contract-posting";

type Tables = Database["public"]["Tables"];
type AccountDefaults = Tables["accountDefault"]["Row"];

/** The defaults the lines need, beyond the receivables, sales, shipping and
 *  tax accounts that every invoice reads. */
export type SalesInvoiceAccountNeeds = {
  /** A line defers to the Deferred Revenue default. */
  deferredRevenue: boolean;
  /** The invoice has rental lines, and one of them exercises a purchase
   *  option. */
  rental: { purchaseOption: boolean } | null;
  /** The invoice has contract lines. */
  contract: boolean;
  /** Other accounts that a line posts to, read with the defaults. */
  accountIds: (string | null | undefined)[];
};

/**
 * The accounts a sales invoice journal reads. The intercompany receivables
 * default falls back to receivables when empty. An empty optional default
 * becomes a stand-in before the cutover (`salesInvoiceStandIns`). Refuses an
 * empty default that a line needs and can never take a stand-in: the
 * deferral, rental and contract defaults name schedule rows.
 */
export function planSalesInvoiceAccounts(
  defaults: AccountDefaults,
  postingStatus: AutomaticJournalStatus,
  needs: SalesInvoiceAccountNeeds
) {
  const standIns = salesInvoiceStandIns(defaults, postingStatus);
  const ids = new Set<string>();
  const read = (...candidates: (string | null | undefined)[]) => {
    for (const id of candidates) if (id) ids.add(id);
  };

  // An intercompany customer books to Inter-Company Receivables, resolved from
  // accountDefault (a stable id), never by account number.
  const receivables = {
    standard: defaults.receivablesAccount,
    intercompany: resolveDefaultAccount(
      defaults,
      "intercompanyReceivablesAccount",
      postingStatus
    ).accountId
  };
  const shippingAccountId = standIns.defaultId("salesShippingRevenueAccount");
  read(
    receivables.standard,
    receivables.intercompany,
    defaults.salesAccount,
    shippingAccountId,
    defaults.salesTaxPayableAccount
  );

  // A dated line with no deferral account refuses to post rather than book
  // deferrable revenue straight to Sales.
  const deferredRevenueAccountId = needs.deferredRevenue
    ? defaults.deferredRevenueAccount
    : null;
  if (needs.deferredRevenue && !deferredRevenueAccountId) {
    throw new MissingAccountDefaultError("deferredRevenueAccount");
  }
  read(deferredRevenueAccountId);

  // Rental lines always post through deferred revenue, contract assets and
  // rental income: rent is recognized by schedule, never at billing.
  let rentalAccountIds: Record<
    "deferredRevenue" | "contractAsset" | "rentalIncome",
    string
  > | null = null;
  if (needs.rental) {
    const {
      deferredRevenueAccount,
      contractAssetAccount,
      rentalIncomeAccount
    } = defaults;
    if (
      !deferredRevenueAccount ||
      !contractAssetAccount ||
      !rentalIncomeAccount
    ) {
      throw new InvalidInputError(
        "Rental invoices need the Deferred Revenue, Contract Assets and Rental Income accounts mapped in the accounting defaults"
      );
    }
    rentalAccountIds = {
      deferredRevenue: deferredRevenueAccount,
      contractAsset: contractAssetAccount,
      rentalIncome: rentalIncomeAccount
    };
    read(deferredRevenueAccount, contractAssetAccount, rentalIncomeAccount);
    // Read with the others, but only required (and validated) once the
    // agreement lines show a Sale line (`netInvestmentInLeasesAccount`).
    read(standIns.defaultId("netInvestmentInLeasesAccount"));
    // An exercised purchase option settles the rest of the net investment to
    // one of these; each is required only when its settlement leg is.
    if (needs.rental.purchaseOption) {
      read(
        defaults.costOfGoodsSoldAccount,
        standIns.defaultId("leaseRevenueAccount")
      );
    }
  }

  // Contract lines post to Deferred Revenue / Contract Assets, and to
  // realized FX when a pool carried at another rate is cleared.
  if (needs.contract) {
    read(
      defaults.deferredRevenueAccount,
      defaults.contractAssetAccount,
      defaults.realizedExchangeGainAccount,
      defaults.realizedExchangeLossAccount
    );
  }
  read(...needs.accountIds);

  return {
    defaults,
    standIns,
    receivables,
    shippingAccountId,
    deferredRevenueAccountId,
    rentalAccountIds,
    contract: needs.contract,
    /** The ids to read. A stand-in is not an account. */
    accountIds: [...ids].filter((id) => !standIns.isPlaceholder(id))
  };
}

export type SalesInvoiceAccountPlan = ReturnType<
  typeof planSalesInvoiceAccounts
>;

/** An active posting account of the class. */
export const isLeaf = (
  account: SalesPostingAccount | null | undefined,
  accountClass: string
): account is SalesPostingAccount =>
  !!account &&
  account.class === accountClass &&
  account.active &&
  !account.isGroup;

/**
 * The accounts the plan read, with a stand-in for each placeholder. Refuses
 * a deferral, rental or contract account that is not an active leaf of its
 * class: the schedule rows and the recognition run credit them later, even
 * when this posting skips them.
 */
export function resolveSalesInvoiceAccounts(
  plan: SalesInvoiceAccountPlan,
  rows: Iterable<SalesPostingAccount>,
  companyGroupId: string
) {
  const accountsById = new Map<string, SalesPostingAccount>();
  for (const row of rows) accountsById.set(row.id, row);
  // A stand-in resolves to an account of the class its default must have;
  // the journal insert swaps it for Retained Earnings.
  for (const placeholder of plan.standIns.placeholderAccounts(companyGroupId)) {
    accountsById.set(placeholder.id, placeholder);
  }
  const account = (id: string | null | undefined) =>
    id ? accountsById.get(id) : undefined;

  const deferredRevenue = plan.deferredRevenueAccountId
    ? (account(plan.deferredRevenueAccountId) ?? null)
    : null;
  if (plan.deferredRevenueAccountId && !isLeaf(deferredRevenue, "Liability")) {
    throw new Error(
      "Deferred Revenue account is invalid; expected an active Liability leaf in this company group"
    );
  }

  let rental: Record<
    "deferredRevenue" | "contractAsset" | "rentalIncome",
    SalesPostingAccount
  > | null = null;
  if (plan.rentalAccountIds) {
    const resolved = (
      key: keyof NonNullable<SalesInvoiceAccountPlan["rentalAccountIds"]>,
      accountClass: string,
      label: string
    ) => {
      const candidate = account(plan.rentalAccountIds?.[key]);
      if (!isLeaf(candidate, accountClass)) {
        throw new Error(
          `${label} account is invalid; expected an active ${accountClass} leaf in this company group`
        );
      }
      return candidate;
    };
    rental = {
      deferredRevenue: resolved(
        "deferredRevenue",
        "Liability",
        "Deferred Revenue"
      ),
      contractAsset: resolved("contractAsset", "Asset", "Contract Assets"),
      rentalIncome: resolved("rentalIncome", "Revenue", "Rental Income")
    };
  }

  let contract: ContractPostingAccounts | null = null;
  if (plan.contract) {
    const leaf = (
      id: string | null | undefined,
      accountClass: string,
      label: string,
      required: boolean
    ) => {
      const candidate = account(id);
      if (!id && !required) return null;
      // The FX accounts are only needed when a line clears a pool carried at
      // another rate; the planner refuses then.
      if (!required && !isLeaf(candidate, accountClass)) return null;
      if (!isLeaf(candidate, accountClass)) {
        if (!id) {
          throw new InvalidInputError(
            `Contract invoices need the ${label} account mapped in the accounting defaults`
          );
        }
        throw new Error(
          `${label} account is invalid; expected an active ${accountClass} leaf in this company group`
        );
      }
      return candidate;
    };
    const { defaults } = plan;
    contract = {
      deferredRevenue: leaf(
        defaults.deferredRevenueAccount,
        "Liability",
        "Deferred Revenue",
        true
      )!,
      contractAsset: leaf(
        defaults.contractAssetAccount,
        "Asset",
        "Contract Assets",
        true
      )!,
      fxGain: leaf(
        defaults.realizedExchangeGainAccount,
        "Revenue",
        "Realized Exchange Gain",
        false
      ),
      fxLoss: leaf(
        defaults.realizedExchangeLossAccount,
        "Expense",
        "Realized Exchange Loss",
        false
      )
    };
    // The run recognizes from both pools into Sales.
    leaf(defaults.salesAccount, "Revenue", "Sales", true);
  }

  const receivablesAccountId = (intercompany: boolean) =>
    intercompany ? plan.receivables.intercompany : plan.receivables.standard;

  return {
    defaults: plan.defaults,
    standIns: plan.standIns,
    shippingAccountId: plan.shippingAccountId,
    account,
    receivablesAccountId,
    /** The accounts of the AR, sales, shipping and tax legs. */
    charges: (intercompany: boolean) => ({
      receivables: account(receivablesAccountId(intercompany)),
      sales: account(plan.defaults.salesAccount),
      shipping: account(plan.shippingAccountId),
      tax: account(plan.defaults.salesTaxPayableAccount)
    }),
    deferredRevenue,
    rental,
    contract
  };
}

export type SalesInvoiceAccounts = ReturnType<
  typeof resolveSalesInvoiceAccounts
>;

/**
 * The Net Investment in Leases account, which a sales-type line's rent and
 * purchase option collect. Null when no agreement line is a sale: an
 * operating-only invoice never needs the account mapped.
 */
export function netInvestmentInLeasesAccount(
  accounts: SalesInvoiceAccounts,
  agreementLines: Iterable<
    Pick<Tables["rentalAgreementLine"]["Row"], "lessorClassification">
  >
): SalesPostingAccount | null {
  if (
    ![...agreementLines].some((line) => line.lessorClassification === "Sale")
  ) {
    return null;
  }
  const id = accounts.standIns.defaultId("netInvestmentInLeasesAccount");
  const candidate = accounts.account(id);
  if (!id) {
    throw new Error(
      "Rentals treated as a sale need the Net Investment in Leases account mapped in the accounting defaults"
    );
  }
  if (!isLeaf(candidate, "Asset")) {
    throw new Error(
      "Net Investment in Leases account is invalid; expected an active Asset leaf in this company group"
    );
  }
  return candidate;
}
