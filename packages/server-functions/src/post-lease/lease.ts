// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The lease row and its lock, the accounts and dimensions its journals use,
// the 'Lease' journal writer, the schedule writer and the commencement void —
// shared by every `post-lease` action.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  journalPostingStatus
} from "@carbon/database/journal-posting-status";
import type { AccountClass } from "@carbon/database/ledger";
import { round } from "@carbon/database/precision";
import { getNextSequence } from "@carbon/database/sequence";
import {
  addMonths,
  buildJournalLineDimensionInserts,
  datetime,
  type LeasePaymentPoint,
  type LesseeScheduleLine,
  leaseMonthEnds,
  paymentMonthIndex,
  wholeMonthsInTerm
} from "@carbon/utils";
import { sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { InvalidInputError, NotFoundError } from "../errors";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import { createAdjustmentJournal } from "../lib/post-adjustment";
import { allocateJournalLineIds } from "../post-charge/journal-line-ids";
import {
  type LesseeAccounts,
  type PostingLine,
  scheduleRowAccounts
} from "./lessee";
import { scheduleMonths } from "./validators";

export type Db = Kysely<KyselyDatabase>;
export type Trx = Transaction<KyselyDatabase>;
type Enums = Database["public"]["Enums"];

export type LeaseRow = {
  id: string;
  leaseId: string;
  status: Enums["leaseStatus"];
  name: string;
  supplierId: string;
  locationId: string | null;
  commencementDate: string;
  endDate: string;
  invoiceFromDate: string;
  paymentAmount: number;
  paymentFrequency: Enums["leasePaymentFrequency"];
  paymentTiming: Enums["rentalBillingTiming"];
  annualEscalationPercent: number;
  discountRate: number;
  currencyCode: string;
  fairValue: number | null;
  economicLifeMonths: number | null;
  ownershipTransfers: boolean;
  specializedAsset: boolean;
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: boolean;
  lesseeClassification: Enums["lesseeClassification"] | null;
  classificationOverride: Enums["lesseeClassification"] | null;
  initialLiability: number | null;
  rouAssetCost: number | null;
  commencementJournalId: string | null;
};

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

// Re-read under the caller's company and lock: the id comes from the payload,
// and the permission check proves nothing about it. The lock serializes two
// actions on one lease (a double-clicked Activate, a Modify racing a
// Terminate). DATE columns are selected as text — the lease math works on
// `YYYY-MM-DD` strings.
export async function lockLease(
  trx: Trx,
  companyId: string,
  id: string
): Promise<LeaseRow> {
  const lease = await trx
    .selectFrom("lease")
    .select([
      "id",
      "leaseId",
      "status",
      "name",
      "supplierId",
      "locationId",
      sql<string>`"commencementDate"::text`.as("commencementDate"),
      sql<string>`"endDate"::text`.as("endDate"),
      sql<string>`"invoiceFromDate"::text`.as("invoiceFromDate"),
      "paymentAmount",
      "paymentFrequency",
      "paymentTiming",
      "annualEscalationPercent",
      "discountRate",
      "currencyCode",
      "fairValue",
      "economicLifeMonths",
      "ownershipTransfers",
      "specializedAsset",
      "purchaseOptionAmount",
      "purchaseOptionReasonablyCertain",
      "lesseeClassification",
      "classificationOverride",
      "initialLiability",
      "rouAssetCost",
      "commencementJournalId"
    ])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!lease) throw new NotFoundError("Lease not found");
  return {
    ...lease,
    paymentAmount: Number(lease.paymentAmount),
    annualEscalationPercent: Number(lease.annualEscalationPercent),
    discountRate: Number(lease.discountRate),
    fairValue: num(lease.fairValue),
    economicLifeMonths: num(lease.economicLifeMonths),
    purchaseOptionAmount: num(lease.purchaseOptionAmount),
    initialLiability: num(lease.initialLiability),
    rouAssetCost: num(lease.rouAssetCost)
  };
}

export type LeasePaymentRow = {
  id: string;
  paymentType: Enums["leasePaymentType"];
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amount: number;
  status: Enums["leasePaymentStatus"];
};

export async function readPayments(
  trx: Trx,
  companyId: string,
  leaseId: string
): Promise<LeasePaymentRow[]> {
  const rows = await trx
    .selectFrom("leasePayment")
    .select([
      "id",
      "paymentType",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd"),
      sql<string>`"dueDate"::text`.as("dueDate"),
      "amount",
      "status"
    ])
    .where("leaseId", "=", leaseId)
    .where("companyId", "=", companyId)
    .orderBy("dueDate")
    .execute();
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

export type LesseeAccounting = {
  // Provisional before the company's accounting cutover, Posted after it.
  postingStatus: AutomaticJournalStatus;
  accounts: LesseeAccounts;
  // active dimensions for the company group, entityType → dimension id
  dimensionMap: Map<string, string>;
};

export const LESSEE_ACCOUNTS_REQUIRED =
  "Set the lease (lessee) accounts in Accounting → Default Accounts before activating a lease";

const LESSEE_DEFAULT_COLUMNS = [
  "rightOfUseAssetAccount",
  "accumulatedRightOfUseAmortizationAccount",
  "leaseLiabilityAccount",
  "operatingLeaseExpenseAccount",
  "rightOfUseAmortizationExpenseAccount",
  "leaseInterestExpenseAccount",
  "assetGainOnDisposalAccount",
  "assetLossOnDisposalAccount"
] as const;

/** The lessee lease accounts with their classes, and the dimensions. Every
 *  account is required — the migration seeds and maps them for every
 *  company — because the schedule rows name them and are never re-pointed. */
export async function loadLesseeAccounting(
  trx: Trx,
  args: { companyId: string; companyGroupId: string | null }
): Promise<LesseeAccounting> {
  const { companyId } = args;
  const postingStatus = await journalPostingStatus(trx, companyId);
  const defaults = await trx
    .selectFrom("accountDefault")
    .select([...LESSEE_DEFAULT_COLUMNS])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) throw new Error("Error getting account defaults");
  const ids = LESSEE_DEFAULT_COLUMNS.map((column) => defaults[column]);
  if (ids.some((id) => !id)) {
    throw new InvalidInputError(LESSEE_ACCOUNTS_REQUIRED);
  }

  // `account` is group-scoped; the ids came from this company's defaults.
  const accounts = await trx
    .selectFrom("account")
    .select(["id", "class"])
    .where("id", "in", ids as string[])
    .execute();
  const classOf = (id: string): AccountClass => {
    const account = accounts.find((row) => row.id === id);
    if (!account?.class) {
      throw new InvalidInputError(
        `Account ${id} in the lease account defaults has no class. Set its class in Accounting → Chart of Accounts.`
      );
    }
    return account.class;
  };
  const account = (column: (typeof LESSEE_DEFAULT_COLUMNS)[number]) => {
    const id = defaults[column] as string;
    return { id, class: classOf(id) };
  };

  // Dimensions are configured per company group; a company outside one
  // tags nothing.
  const dimensions =
    args.companyGroupId === null
      ? []
      : await trx
          .selectFrom("dimension")
          .select(["id", "entityType"])
          .where("companyGroupId", "=", args.companyGroupId)
          .where("active", "=", true)
          .where("entityType", "in", ["Supplier", "Location"])
          .execute();

  return {
    postingStatus,
    accounts: {
      rightOfUseAsset: account("rightOfUseAssetAccount"),
      accumulatedRightOfUseAmortization: account(
        "accumulatedRightOfUseAmortizationAccount"
      ),
      leaseLiability: account("leaseLiabilityAccount"),
      operatingLeaseExpense: account("operatingLeaseExpenseAccount"),
      rightOfUseAmortizationExpense: account(
        "rightOfUseAmortizationExpenseAccount"
      ),
      leaseInterestExpense: account("leaseInterestExpenseAccount"),
      gain: account("assetGainOnDisposalAccount"),
      loss: account("assetLossOnDisposalAccount")
    },
    dimensionMap: new Map(
      dimensions.map((dimension) => [dimension.entityType, dimension.id])
    )
  };
}

/** One 'Lease' journal from already-balanced lines: Provisional before the
 *  accounting cutover (no period), Posted after it in the period of its date
 *  (the next open period when that one is Locked or Closed). Every line
 *  carries the lease as its document, tagged with Supplier and Location. */
export async function postLesseeJournal(
  trx: Trx,
  args: {
    accounting: LesseeAccounting;
    companyId: string;
    userId: string;
    postingDate: string;
    description: string;
    lines: PostingLine[];
    lease: Pick<LeaseRow, "id" | "supplierId" | "locationId">;
  }
): Promise<string> {
  const { accounting, companyId, userId } = args;
  const period =
    accounting.postingStatus === "Posted"
      ? await resolveAccountingPeriod(
          trx,
          companyId,
          args.postingDate,
          "historical-with-shift"
        )
      : null;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId: period?.id ?? null,
    status: accounting.postingStatus,
    description: args.description,
    postingDate: period?.postingDate ?? args.postingDate,
    userId,
    sourceType: "Lease"
  });

  const journalLineReference = nanoid();
  const journalLines = await trx
    .insertInto("journalLine")
    .values(
      args.lines.map((line) => ({
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: round(line.amount),
        quantity: 1,
        documentType: "Lease" as const,
        documentId: args.lease.id,
        documentLineReference: null,
        journalLineReference,
        companyId
      }))
    )
    .returning(["id"])
    .execute();

  // Every line carries the same tags, so the order of the returned ids does
  // not matter.
  const dimensionInserts = buildJournalLineDimensionInserts({
    journalLineIds: journalLines.map((line) => line.id),
    meta: journalLines.map(() => ({
      supplierId: args.lease.supplierId,
      locationId: args.lease.locationId
    })),
    dimensionMap: accounting.dimensionMap,
    companyId
  });
  if (dimensionInserts.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(dimensionInserts)
      .execute();
  }

  return journalId;
}

/**
 * Writes schedule lines from lease month `fromMonth` on, and two
 * `revenueRecognitionSchedule` rows per line (Interest and Amortization, each
 * on its own accounts — spec §3) that the lease run posts. A row with no
 * amount is not written. Rows dated before `postedBefore` are written Posted
 * with no journal: their entries are in an opening balance, as the enable's
 * step 5 does for rows before the cutover.
 */
export async function writeSchedule(
  trx: Trx,
  args: {
    lease: Pick<LeaseRow, "id" | "commencementDate">;
    lines: LesseeScheduleLine[];
    fromMonth: number;
    classification: "Operating" | "Finance";
    accounts: LesseeAccounts;
    companyId: string;
    userId: string;
    postedBefore?: string;
  }
): Promise<void> {
  const { lease, lines, companyId, userId } = args;
  if (lines.length === 0) return;

  const inserted = await trx
    .insertInto("leaseScheduleLine")
    .values(
      lines.map((line) => ({
        leaseId: lease.id,
        periodDate: line.periodDate,
        openingLiability: line.openingLiability,
        paymentAmount: line.paymentAmount,
        interestAmount: line.interestAmount,
        principalAmount: line.principalAmount,
        closingLiability: line.closingLiability,
        leaseCost: line.leaseCost,
        rouAmortization: line.rouAmortization,
        closingRouAsset: line.closingRouAsset,
        companyId,
        createdBy: userId
      }))
    )
    .returning(["id", sql<string>`"periodDate"::text`.as("periodDate")])
    .execute();
  const idByDate = new Map(inserted.map((row) => [row.periodDate, row.id]));

  const accounts = scheduleRowAccounts(args.classification, args.accounts);
  const rows = lines.flatMap((line, index) => {
    const leaseScheduleLineId = idByDate.get(line.periodDate);
    if (!leaseScheduleLineId) {
      throw new Error(`Schedule line ${line.periodDate} was not written`);
    }
    const periodStart = addMonths(
      lease.commencementDate,
      args.fromMonth + index
    );
    const posted =
      args.postedBefore !== undefined && line.periodDate < args.postedBefore;
    const base = {
      status: posted ? ("Posted" as const) : ("Planned" as const),
      leaseId: lease.id,
      leaseScheduleLineId,
      periodStart,
      periodEnd: line.periodDate,
      scheduledDate: line.periodDate,
      companyId,
      createdBy: userId
    };
    return [
      {
        ...base,
        type: "Interest" as const,
        amount: line.interestAmount,
        ...accounts.interest
      },
      {
        ...base,
        type: "Amortization" as const,
        amount: line.rouAmortization,
        ...accounts.amortization
      }
    ].filter((row) => row.amount !== 0);
  });
  if (rows.length > 0) {
    await trx.insertInto("revenueRecognitionSchedule").values(rows).execute();
  }
}

/** The run holding a schedule row of the lease from `fromDate` on, or null.
 *  A row a run holds cannot be rewritten until the run is recalculated or
 *  deleted. */
export async function heldByRun(
  trx: Trx,
  args: { companyId: string; leaseId: string; fromDate?: string }
): Promise<string | null> {
  let query = trx
    .selectFrom("revenueRecognitionSchedule as s")
    .innerJoin("revenueRecognitionRunLine as l", (join) =>
      join
        .onRef("l.id", "=", "s.runLineId")
        .onRef("l.companyId", "=", "s.companyId")
    )
    .innerJoin("revenueRecognitionRun as r", (join) =>
      join
        .onRef("r.id", "=", "l.runId")
        .onRef("r.companyId", "=", "l.companyId")
    )
    .select("r.runId")
    .where("s.companyId", "=", args.companyId)
    .where("s.leaseId", "=", args.leaseId)
    .where("s.status", "=", "Planned");
  if (args.fromDate) {
    query = query.where("s.scheduledDate", ">=", args.fromDate);
  }
  const row = await query.executeTakeFirst();
  return row?.runId ?? null;
}

/** Voids a journal with a negated copy dated today (the next open period
 *  when today's is Locked or Closed), keeping its documents and dimensions —
 *  the pattern of `post-charge/post-charge-void.ts`. */
export async function voidLeaseJournal(
  trx: Trx,
  args: {
    journalId: string;
    description: string;
    postingStatus: AutomaticJournalStatus;
    companyId: string;
    userId: string;
    today: string;
  }
): Promise<string> {
  const { companyId, userId } = args;
  const original = await trx
    .selectFrom("journal")
    .select(["id", "sourceType"])
    .where("id", "=", args.journalId)
    .where("companyId", "=", companyId)
    .forShare()
    .executeTakeFirst();
  if (!original || original.sourceType !== "Lease") {
    throw new Error("The lease journal has invalid provenance");
  }
  const originalLines = await trx
    .selectFrom("journalLine")
    .selectAll()
    .where("journalId", "=", original.id)
    .where("companyId", "=", companyId)
    .orderBy("id")
    .execute();

  const period =
    args.postingStatus === "Posted"
      ? await resolveAccountingPeriod(
          trx,
          companyId,
          args.today,
          "historical-with-shift"
        )
      : null;
  const reversal = await trx
    .insertInto("journal")
    .values({
      journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
      accountingPeriodId: period?.id ?? null,
      description: args.description,
      postingDate: period?.postingDate ?? args.today,
      companyId,
      sourceType: "Lease",
      status: args.postingStatus,
      postedAt: datetime.timestamp(),
      postedBy: userId,
      createdBy: userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  if (originalLines.length === 0) return reversal.id;

  const reversalLineIds = await allocateJournalLineIds(
    trx,
    originalLines.length
  );
  await trx
    .insertInto("journalLine")
    .values(
      originalLines.map((line, index) => ({
        id: reversalLineIds[index],
        journalId: reversal.id,
        accountId: line.accountId,
        amount: -Number(line.amount),
        quantity: line.quantity,
        description: `VOID: ${line.description ?? ""}`,
        documentType: line.documentType,
        documentId: line.documentId,
        documentLineReference: line.documentLineReference,
        journalLineReference: line.journalLineReference,
        accountDefaultRole: line.accountDefaultRole,
        companyId
      }))
    )
    .execute();
  const dimensions = await trx
    .selectFrom("journalLineDimension")
    .select(["journalLineId", "dimensionId", "valueId"])
    .where("companyId", "=", companyId)
    .where(
      "journalLineId",
      "in",
      originalLines.map((line) => line.id)
    )
    .execute();
  const reversalByOriginal = new Map(
    originalLines.map((line, index) => [line.id, reversalLineIds[index]])
  );
  if (dimensions.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(
        dimensions.map((dimension) => {
          const journalLineId = reversalByOriginal.get(dimension.journalLineId);
          if (!journalLineId) {
            throw new Error("Failed to map a reversed journal line");
          }
          return { ...dimension, journalLineId, companyId };
        })
      )
      .execute();
  }
  return reversal.id;
}

export type Scope = { db: Db; companyId: string; userId: string };

/** The lease's whole-month points, measured from `fromDate`. */
export function paymentPoints(
  payments: Pick<
    LeasePaymentRow,
    "periodStart" | "periodEnd" | "dueDate" | "paymentType" | "amount"
  >[],
  fromDate: string,
  timing: LeaseRow["paymentTiming"]
): LeasePaymentPoint[] {
  return payments.map((payment) => ({
    monthIndex: paymentMonthIndex(payment, fromDate, timing),
    amount: payment.amount
  }));
}

/** The lease months a schedule from `fromDate` to `endDate` covers, and
 *  their last days (the final one clamped to `endDate`). */
export function scheduleSpan(fromDate: string, endDate: string) {
  const whole = wholeMonthsInTerm(fromDate, endDate);
  const months = scheduleMonths(whole, addMonths(fromDate, whole) <= endDate);
  const periodDates = leaseMonthEnds(fromDate, 0, months).map((date) =>
    date > endDate ? endDate : date
  );
  return { termMonths: whole, months, periodDates };
}

/** Straight-line ROU amortization runs over the useful life when the lessee
 *  will own the asset, else over the lease term. */
export function amortizationMonths(lease: LeaseRow, months: number): number {
  return (lease.ownershipTransfers || lease.purchaseOptionReasonablyCertain) &&
    lease.economicLifeMonths &&
    lease.economicLifeMonths > months
    ? lease.economicLifeMonths
    : months;
}
