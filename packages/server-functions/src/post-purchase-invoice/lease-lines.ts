// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// How a purchase invoice's Lease line posts: which lease account it debits,
// and the checks a line must pass first. Used by `post-purchase-invoice` and
// by the accounting cutover's legacy backfill
// (`activate-accounting/legacy/purchase-invoice.ts`), so a rebuilt journal
// refuses exactly what the posting refuses.
//
// The classification of the payment row's asset picks the account (spec
// 2026-10-11-lessee-leases §5): a fixed payment of a capitalized asset
// (Operating or Finance) debits the lease liability with its NOMINAL amount —
// what the schedule took out of the liability — and the line's tax, line
// shipping and share of the header freight go to the operating lease expense;
// a payment of a Short-Term asset debits the operating lease expense in full;
// a variable charge (a line with no payment row) debits the variable lease
// expense in full.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { AccountClass } from "@carbon/database/ledger";
import { chunkArray, equals } from "@carbon/utils";
import { InvalidInputError } from "../errors";
import type { PurchasePostingAmounts } from "./purchase-posting-amounts";

type Enums = Database["public"]["Enums"];
type Tables = Database["public"]["Tables"];

export type LeaseStatus = Enums["leaseStatus"];

/** A lease that has run its course but may still owe a payment: a
 *  termination penalty, a purchase price, or a row a voided invoice
 *  returned to Pending. */
export const ENDED_LEASE_STATUSES = [
  "Expired",
  "Terminated",
  "Purchased"
] as const satisfies readonly LeaseStatus[];

/** The statuses a lease can be invoiced in: Active, or ended. A Draft lease
 *  is not yet a lease, and a Cancelled one never was. Drafting
 *  (`create-lease-invoices`, the daily job) and posting agree on this list. */
export const BILLABLE_LEASE_STATUSES = [
  "Active",
  ...ENDED_LEASE_STATUSES
] as const satisfies readonly LeaseStatus[];

export function isBillableLeaseStatus(status: LeaseStatus): boolean {
  return (BILLABLE_LEASE_STATUSES as readonly LeaseStatus[]).includes(status);
}

export type LeaseAccount = { id: string; name: string; class: AccountClass };

type LeaseAccountRole = "liability" | "operating" | "variable";

/** A payment row, with what posting reads of its asset (`leaseLine`). */
export type LeasePostingPayment = {
  leaseId: string;
  amount: number;
  /** The invoice line that bills the row; null while it is Pending. */
  purchaseInvoiceLineId: string | null;
  /** The asset's description. */
  description: string;
  /** Null until the lease is activated. */
  lesseeClassification: Enums["lesseeClassification"] | null;
};

export type LeasePostingFacts = {
  leases: Map<string, { status: LeaseStatus }>;
  payments: Map<string, LeasePostingPayment>;
  accounts: Map<LeaseAccountRole, LeaseAccount>;
};

export type LeaseAccountDefaults = Pick<
  Tables["accountDefault"]["Row"],
  | "leaseLiabilityAccount"
  | "operatingLeaseExpenseAccount"
  | "variableLeaseExpenseAccount"
>;

export type LeaseInvoiceLine = Pick<
  Tables["purchaseInvoiceLine"]["Row"],
  "id" | "leaseId" | "leasePaymentId" | "projectId"
>;

/** Kept under Postgres' bind-parameter limit for a long legacy backfill. */
const IDS_PER_STATEMENT = 1000;

function unique(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** Reads the leases, payment rows and lease accounts the lines name. */
export async function loadLeasePostingFacts(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    companyGroupId: string;
    defaults: LeaseAccountDefaults;
    lines: Pick<LeaseInvoiceLine, "leaseId" | "leasePaymentId">[];
  }
): Promise<LeasePostingFacts> {
  const { companyId, companyGroupId, defaults, lines } = args;
  const facts: LeasePostingFacts = {
    leases: new Map(),
    payments: new Map(),
    accounts: new Map()
  };
  if (lines.length === 0) return facts;

  for (const ids of chunkArray(
    unique(lines.map((line) => line.leaseId)),
    IDS_PER_STATEMENT
  )) {
    const leases = await db
      .selectFrom("lease")
      .select(["id", "status"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute();
    for (const lease of leases) {
      facts.leases.set(lease.id, { status: lease.status });
    }
  }

  for (const ids of chunkArray(
    unique(lines.map((line) => line.leasePaymentId)),
    IDS_PER_STATEMENT
  )) {
    const payments = await db
      .selectFrom("leasePayment as p")
      .innerJoin("leaseLine as l", (join) =>
        join
          .onRef("l.id", "=", "p.leaseLineId")
          .onRef("l.companyId", "=", "p.companyId")
      )
      .select([
        "p.id",
        "p.leaseId",
        "p.amount",
        "p.purchaseInvoiceLineId",
        "l.description",
        "l.lesseeClassification"
      ])
      .where("p.companyId", "=", companyId)
      .where("p.id", "in", ids)
      .execute();
    for (const { id, ...payment } of payments) {
      facts.payments.set(id, { ...payment, amount: Number(payment.amount) });
    }
  }

  const roles: [LeaseAccountRole, string | null][] = [
    ["liability", defaults.leaseLiabilityAccount],
    ["operating", defaults.operatingLeaseExpenseAccount],
    ["variable", defaults.variableLeaseExpenseAccount]
  ];
  const accountIds = unique(roles.map(([, id]) => id));
  const accounts =
    accountIds.length > 0
      ? await db
          .selectFrom("account")
          .select(["id", "name", "class"])
          .where("companyGroupId", "=", companyGroupId)
          .where("id", "in", accountIds)
          .execute()
      : [];
  for (const [role, id] of roles) {
    const account = accounts.find((row) => row.id === id);
    if (account?.class) {
      facts.accounts.set(role, {
        id: account.id,
        name: account.name,
        class: account.class
      });
    }
  }
  return facts;
}

const MISSING_ACCOUNTS =
  "Set the lease (lessee) accounts in Accounting → Default Accounts";

/**
 * The accounts a Lease line debits, or an `InvalidInputError` when it cannot
 * be posted: no lease, a Draft or Cancelled lease, a project, a payment row of
 * another lease or billed by another invoice line, a lease not yet activated,
 * a capitalized payment whose amount differs from its row's, or a lease
 * account left unset.
 *
 * `account` takes the nominal amount; `extrasAccount`, set for a capitalized
 * payment only, takes the rest of the line's total (tax, shipping, freight).
 */
export function resolveLeasePostingLine(
  line: LeaseInvoiceLine,
  amounts: Pick<PurchasePostingAmounts, "nominalBaseCost" | "totalBaseCost">,
  facts: LeasePostingFacts
): {
  leaseId: string;
  account: LeaseAccount;
  extrasAccount: LeaseAccount | null;
} {
  const lease = line.leaseId ? facts.leases.get(line.leaseId) : undefined;
  if (!line.leaseId || !lease) {
    throw new InvalidInputError(
      `Lease invoice line ${line.id} has no lease selected`
    );
  }
  if (lease.status === "Draft") {
    throw new InvalidInputError("Activate the lease before invoicing it");
  }
  if (!isBillableLeaseStatus(lease.status)) {
    throw new InvalidInputError(
      "The lease is cancelled; remove its line from this invoice"
    );
  }
  if (line.projectId) {
    throw new InvalidInputError("A lease line cannot be charged to a project");
  }

  const payment = line.leasePaymentId
    ? facts.payments.get(line.leasePaymentId)
    : undefined;
  if (line.leasePaymentId && (!payment || payment.leaseId !== line.leaseId)) {
    throw new InvalidInputError(
      `Lease invoice line ${line.id} names a payment of another lease`
    );
  }
  // The row is billed by the line its drafting stamped on it. Another line
  // naming it would settle the same payment twice.
  if (payment && payment.purchaseInvoiceLineId !== line.id) {
    throw new InvalidInputError(
      `The ${payment.description} payment is billed by another invoice line; remove this line from the invoice`
    );
  }
  if (payment && !payment.lesseeClassification) {
    throw new InvalidInputError("Activate the lease before invoicing it");
  }

  const role: LeaseAccountRole = !payment
    ? "variable"
    : payment.lesseeClassification === "Short-Term"
      ? "operating"
      : "liability";
  // A capitalized payment settles exactly what the schedule took out of the
  // liability; another amount would leave the liability off. A different
  // price is a Modify of the lease. Compared in base, as the liability is.
  if (
    payment &&
    role === "liability" &&
    !equals(amounts.nominalBaseCost, payment.amount)
  ) {
    throw new InvalidInputError(
      `The ${payment.description} line must be ${payment.amount}, its payment's amount; modify the lease to change a payment`
    );
  }

  const account = facts.accounts.get(role);
  if (!account) throw new InvalidInputError(MISSING_ACCOUNTS);
  if (role !== "liability") {
    return { leaseId: line.leaseId, account, extrasAccount: null };
  }
  const extrasAccount = facts.accounts.get("operating") ?? null;
  if (
    !extrasAccount &&
    !equals(amounts.totalBaseCost, amounts.nominalBaseCost)
  ) {
    throw new InvalidInputError(MISSING_ACCOUNTS);
  }
  return { leaseId: line.leaseId, account, extrasAccount };
}
