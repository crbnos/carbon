// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The lease row and its lock, the accounts and dimensions its journals use,
// the 'Lease' journal writer, the schedule writer and the commencement void —
// shared by every `post-lease` action.

import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  journalPostingStatus
} from "@carbon/database/journal-posting-status";
import type { AccountClass } from "@carbon/database/ledger";
import { round } from "@carbon/database/precision";
import {
  addMonths,
  buildJournalLineDimensionInserts,
  datetime,
  type LeasePaymentPoint,
  type LesseeScheduleLine,
  measureLesseeAsset,
  paymentMonthIndex
} from "@carbon/utils";
import { sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { InvalidInputError, NotFoundError } from "../errors";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import { allocateJournalLineIds } from "../lib/journal-line-ids";
import { createAdjustmentJournal } from "../lib/post-adjustment";
import { insertNegatedJournal } from "../lib/void-journal";
import {
  type LesseeAccounts,
  type PostingLine,
  scheduleRowAccounts
} from "./lessee";

export type Db = Kysely<KyselyDatabase>;
export type Trx = Transaction<KyselyDatabase>;
type Enums = Database["public"]["Enums"];

/** The lease header: the term and the payment terms every asset shares. */
export type LeaseRow = {
  id: string;
  leaseId: string;
  status: Enums["leaseStatus"];
  name: string | null;
  supplierId: string;
  locationId: string | null;
  commencementDate: string;
  /** Null is open-ended: every asset is short-term (spec Addendum A10). */
  endDate: string | null;
  invoiceFromDate: string;
  paymentFrequency: Enums["leasePaymentFrequency"];
  paymentTiming: Enums["rentalBillingTiming"];
  annualEscalationPercent: number;
  discountRate: number;
  currencyCode: string;
  commencementJournalId: string | null;
};

/** One leased asset: a separate lease component (ASC 842-10-15-28), with its
 *  own payment, classification inputs, classification and measurement. */
export type LeaseLineRow = {
  id: string;
  description: string;
  serialNumber: string | null;
  locationId: string | null;
  paymentAmount: number;
  fairValue: number | null;
  economicLifeMonths: number | null;
  ownershipTransfers: boolean;
  specializedAsset: boolean;
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: boolean;
  status: Enums["leaseLineStatus"];
  lesseeClassification: Enums["lesseeClassification"] | null;
  classificationOverride: Enums["lesseeClassification"] | null;
  initialLiability: number | null;
  rouAssetCost: number | null;
};

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

// Re-read under the caller's company and lock: the id comes from the payload,
// and the permission check proves nothing about it. The lock serializes two
// actions on one lease (a double-clicked Activate, a Modify racing a
// Terminate of one asset). DATE columns are selected as text — the lease
// math works on `YYYY-MM-DD` strings.
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
      sql<string | null>`"endDate"::text`.as("endDate"),
      sql<string>`"invoiceFromDate"::text`.as("invoiceFromDate"),
      "paymentFrequency",
      "paymentTiming",
      "annualEscalationPercent",
      "discountRate",
      "currencyCode",
      "commencementJournalId"
    ])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!lease) throw new NotFoundError("Lease not found");
  return {
    ...lease,
    annualEscalationPercent: Number(lease.annualEscalationPercent),
    discountRate: Number(lease.discountRate)
  };
}

/** The lease's assets in their order. The lease row's lock covers them:
 *  every writer of a line locks the lease first. */
export async function readLines(
  trx: Trx,
  companyId: string,
  leaseId: string
): Promise<LeaseLineRow[]> {
  const rows = await trx
    .selectFrom("leaseLine")
    .select([
      "id",
      "description",
      "serialNumber",
      "locationId",
      "paymentAmount",
      "fairValue",
      "economicLifeMonths",
      "ownershipTransfers",
      "specializedAsset",
      "purchaseOptionAmount",
      "purchaseOptionReasonablyCertain",
      "status",
      "lesseeClassification",
      "classificationOverride",
      "initialLiability",
      "rouAssetCost"
    ])
    .where("leaseId", "=", leaseId)
    .where("companyId", "=", companyId)
    .orderBy("sortOrder")
    .orderBy("createdAt")
    .execute();
  return rows.map((row) => ({
    ...row,
    paymentAmount: Number(row.paymentAmount),
    fairValue: num(row.fairValue),
    economicLifeMonths: num(row.economicLifeMonths),
    purchaseOptionAmount: num(row.purchaseOptionAmount),
    initialLiability: num(row.initialLiability),
    rouAssetCost: num(row.rouAssetCost)
  }));
}

/** The one asset of the lease the payload names, or a 404. */
export function findLine(lines: LeaseLineRow[], id: string): LeaseLineRow {
  const line = lines.find((row) => row.id === id);
  if (!line) throw new NotFoundError("Leased asset not found");
  return line;
}

/** The classification of an asset past Draft. Activation stores one for
 *  every asset, so a missing one is a broken row, not a default. */
export function classificationOf(
  line: Pick<LeaseLineRow, "description" | "lesseeClassification">
): Enums["lesseeClassification"] {
  if (!line.lesseeClassification) {
    throw new Error(`${line.description} has no lessee classification`);
  }
  return line.lesseeClassification;
}

export type LeasePaymentRow = {
  id: string;
  leaseLineId: string;
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
      "leaseLineId",
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

/** One asset's balanced journal lines. */
export type AssetLines = {
  leaseLineId: string;
  /** The asset's location, else the lease's: the Location dimension. */
  locationId: string | null;
  lines: PostingLine[];
};

/** One 'Lease' journal from each asset's balanced lines: Provisional before
 *  the accounting cutover (no period), Posted after it in the period of its
 *  date (the next open period when that one is Locked or Closed). Every line
 *  carries the lease as its document and its asset line as the document
 *  line, tagged with Supplier and the asset's Location. Null when no asset
 *  has a line to post. */
export async function postLesseeJournal(
  trx: Trx,
  args: {
    accounting: LesseeAccounting;
    companyId: string;
    userId: string;
    postingDate: string;
    description: string;
    assets: AssetLines[];
    lease: Pick<LeaseRow, "id" | "supplierId">;
  }
): Promise<string | null> {
  const { accounting, companyId, userId } = args;
  const lines = args.assets.flatMap((asset) =>
    asset.lines.map((line) => ({ ...line, asset }))
  );
  if (lines.length === 0) return null;

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
  const journalLineIds = await allocateJournalLineIds(trx, lines.length);
  await trx
    .insertInto("journalLine")
    .values(
      lines.map((line, index) => ({
        id: journalLineIds[index],
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: round(line.amount),
        quantity: 1,
        documentType: "Lease" as const,
        documentId: args.lease.id,
        documentLineReference: line.asset.leaseLineId,
        journalLineReference,
        companyId
      }))
    )
    .execute();

  const dimensionInserts = buildJournalLineDimensionInserts({
    journalLineIds: journalLineIds as string[],
    meta: lines.map((line) => ({
      supplierId: args.lease.supplierId,
      locationId: line.asset.locationId
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

/** One asset's schedule from lease month `fromMonth` on: line `i` is lease
 *  month `fromMonth + i` of the lease that commenced on `commencementDate`. */
export type AssetSchedule = {
  leaseLineId: string;
  commencementDate: string;
  fromMonth: number;
  lines: LesseeScheduleLine[];
  classification: "Operating" | "Finance";
};

/**
 * Writes each asset's schedule lines, and two `revenueRecognitionSchedule`
 * rows per line (Interest and Amortization, each on its own accounts — spec
 * §3) that the lease run posts. A row with no amount is not written. Rows
 * dated before `postedBefore` are written Posted with no journal, and their
 * lines with `postedAt`: their entries are in an opening balance, as the
 * enable's step 5 does for rows before the cutover.
 */
export async function writeSchedules(
  trx: Trx,
  args: {
    leaseId: string;
    schedules: AssetSchedule[];
    accounts: LesseeAccounts;
    companyId: string;
    userId: string;
    postedBefore?: string;
  }
): Promise<void> {
  const { leaseId, companyId, userId } = args;
  const lines = args.schedules.flatMap((schedule) =>
    schedule.lines.map((line, index) => ({ schedule, line, index }))
  );
  if (lines.length === 0) return;
  const postedAt = datetime.timestamp();

  const inserted = await trx
    .insertInto("leaseScheduleLine")
    .values(
      lines.map(({ schedule, line }) => ({
        leaseId,
        leaseLineId: schedule.leaseLineId,
        periodDate: line.periodDate,
        openingLiability: line.openingLiability,
        paymentAmount: line.paymentAmount,
        interestAmount: line.interestAmount,
        principalAmount: line.principalAmount,
        closingLiability: line.closingLiability,
        leaseCost: line.leaseCost,
        rouAmortization: line.rouAmortization,
        closingRouAsset: line.closingRouAsset,
        // An opening-balance month is on the books like a run-posted one;
        // the `leases` view and the lease page read posted state from here.
        postedAt:
          args.postedBefore !== undefined && line.periodDate < args.postedBefore
            ? postedAt
            : null,
        companyId,
        createdBy: userId
      }))
    )
    .returning([
      "id",
      "leaseLineId",
      sql<string>`"periodDate"::text`.as("periodDate")
    ])
    .execute();
  const key = (leaseLineId: string, periodDate: string) =>
    `${leaseLineId}|${periodDate}`;
  const idByKey = new Map(
    inserted.map((row) => [key(row.leaseLineId, row.periodDate), row.id])
  );

  const rows = lines.flatMap(({ schedule, line, index }) => {
    const leaseScheduleLineId = idByKey.get(
      key(schedule.leaseLineId, line.periodDate)
    );
    if (!leaseScheduleLineId) {
      throw new Error(`Schedule line ${line.periodDate} was not written`);
    }
    const accounts = scheduleRowAccounts(
      schedule.classification,
      args.accounts
    );
    const posted =
      args.postedBefore !== undefined && line.periodDate < args.postedBefore;
    const base = {
      status: posted ? ("Posted" as const) : ("Planned" as const),
      leaseId,
      leaseScheduleLineId,
      periodStart: addMonths(
        schedule.commencementDate,
        schedule.fromMonth + index
      ),
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

/** Deletes the schedule lines of `leaseLineIds` dated on or after
 *  `startDate`; their Planned run rows cascade with them. */
export async function deleteSchedulesFrom(
  trx: Trx,
  args: { companyId: string; leaseLineIds: string[]; startDate: string }
): Promise<void> {
  if (args.leaseLineIds.length === 0) return;
  await trx
    .deleteFrom("leaseScheduleLine")
    .where("leaseLineId", "in", args.leaseLineIds)
    .where("companyId", "=", args.companyId)
    .where("periodDate", ">=", args.startDate)
    .execute();
}

/** The run holding a schedule row of the lease from `fromDate` on, or null.
 *  A row a run holds cannot be rewritten until the run is recalculated or
 *  deleted. */
export async function heldByRun(
  trx: Trx,
  args: {
    companyId: string;
    leaseId: string;
    fromDate?: string;
    /** Only the rows of these assets; every asset when absent. */
    leaseLineIds?: string[];
  }
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
  if (args.leaseLineIds) {
    const ids = args.leaseLineIds;
    if (ids.length === 0) return null;
    query = query.where("s.leaseScheduleLineId", "in", (eb) =>
      eb
        .selectFrom("leaseScheduleLine")
        .select("id")
        .where("leaseLineId", "in", ids)
        .where("companyId", "=", args.companyId)
    );
  }
  const row = await query.executeTakeFirst();
  return row?.runId ?? null;
}

/** Voids a lease journal with a negated copy dated today (the next open
 *  period when today's is Locked or Closed), keeping its documents and
 *  dimensions. */
export async function voidLeaseJournal(
  trx: Trx,
  args: {
    journalId: string;
    postingStatus: AutomaticJournalStatus;
    companyId: string;
    userId: string;
    today: string;
  }
): Promise<string> {
  const { companyId } = args;
  const original = await trx
    .selectFrom("journal")
    .select(["id", "sourceType", "description"])
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
  return insertNegatedJournal(trx, {
    companyId,
    userId: args.userId,
    originalLines,
    description: `VOID ${original.description ?? "Lease"}`,
    sourceType: "Lease",
    postingStatus: args.postingStatus,
    date: args.today,
    periodMode: "historical-with-shift",
    postedAt: datetime.timestamp()
  });
}

export type Scope = { db: Db; companyId: string; userId: string };

/** The payments' whole-month points from lease month `fromMonth` (0 at
 *  commencement). Counted from the commencement, never from a later date: a
 *  lease from the 29th–31st has clamped months that a later start would
 *  not line up with. */
export function paymentPoints(
  payments: Pick<
    LeasePaymentRow,
    "periodStart" | "periodEnd" | "dueDate" | "paymentType" | "amount"
  >[],
  commencementDate: string,
  timing: LeaseRow["paymentTiming"],
  fromMonth = 0
): LeasePaymentPoint[] {
  return payments.map((payment) => ({
    monthIndex:
      paymentMonthIndex(payment, commencementDate, timing) - fromMonth,
    amount: payment.amount
  }));
}

/** Straight-line ROU amortization runs over what is left of the useful life
 *  when the lessee will own the asset, else over the `months` the schedule
 *  covers. `elapsedMonths` are the lease months before the schedule starts
 *  (0 at commencement). */
export function amortizationMonths(
  line: Pick<
    LeaseLineRow,
    | "ownershipTransfers"
    | "purchaseOptionReasonablyCertain"
    | "economicLifeMonths"
  >,
  months: number,
  elapsedMonths = 0
): number {
  const remainingLife = (line.economicLifeMonths ?? 0) - elapsedMonths;
  return (line.ownershipTransfers || line.purchaseOptionReasonablyCertain) &&
    remainingLife > months
    ? remainingLife
    : months;
}

type Thresholds = { majorPartPercent: number; substantiallyAllPercent: number };

export type MeasuredAsset = {
  line: LeaseLineRow;
  liability: number;
  classification: "Operating" | "Finance" | "Short-Term";
  classificationInputs: Json;
};

/** One asset's liability (the PV of its payment rows) and classification
 *  over the term from lease month `fromMonth` (0 at commencement) to
 *  `endDate`. An override wins. */
export function measureAsset(args: {
  line: LeaseLineRow;
  payments: Pick<
    LeasePaymentRow,
    "periodStart" | "periodEnd" | "dueDate" | "paymentType" | "amount"
  >[];
  fromMonth?: number;
  endDate: string;
  lease: Pick<LeaseRow, "commencementDate" | "paymentTiming" | "discountRate">;
  thresholds: Thresholds;
  shortTermExpedient: boolean;
}): MeasuredAsset {
  const { line, lease, thresholds } = args;
  const { liability, termMonths, ...result } = measureLesseeAsset({
    commencementDate: lease.commencementDate,
    endDate: args.endDate,
    timing: lease.paymentTiming,
    discountRate: lease.discountRate,
    payments: args.payments,
    fromMonth: args.fromMonth,
    inputs: line,
    shortTermExpedient: args.shortTermExpedient,
    thresholds
  });
  return {
    line,
    liability,
    classification: line.classificationOverride ?? result.classification,
    classificationInputs: {
      ...result,
      termMonths,
      pvPayments: liability,
      discountRate: lease.discountRate,
      thresholds,
      override: line.classificationOverride
    }
  };
}

export async function readThresholds(
  trx: Trx,
  companyId: string
): Promise<Thresholds & { shortTermExpedient: boolean }> {
  const settings = await trx
    .selectFrom("companySettings")
    .select([
      "leaseMajorPartThresholdPercent",
      "leaseSubstantiallyAllThresholdPercent",
      "leaseShortTermExpedient"
    ])
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  return {
    majorPartPercent: Number(settings.leaseMajorPartThresholdPercent),
    substantiallyAllPercent: Number(
      settings.leaseSubstantiallyAllThresholdPercent
    ),
    shortTermExpedient: settings.leaseShortTermExpedient
  };
}

/** Writes each asset's measurement in one statement. Columns left out of a
 *  row keep their value. */
export async function updateLineMeasurements(
  trx: Trx,
  args: {
    companyId: string;
    userId: string;
    rows: {
      id: string;
      lesseeClassification: "Operating" | "Finance" | "Short-Term";
      classificationInputs?: Json;
      initialLiability?: number | null;
      rouAssetCost?: number | null;
      paymentAmount?: number;
    }[];
  }
): Promise<void> {
  if (args.rows.length === 0) return;
  const values = sql.join(
    args.rows.map(
      (row) =>
        sql`(${row.id}, ${row.lesseeClassification}, ${
          row.classificationInputs === undefined
            ? null
            : JSON.stringify(row.classificationInputs)
        }, ${row.classificationInputs !== undefined}, ${
          row.initialLiability ?? null
        }, ${row.initialLiability !== undefined}, ${row.rouAssetCost ?? null}, ${
          row.rouAssetCost !== undefined
        }, ${row.paymentAmount ?? null}, ${row.paymentAmount !== undefined})`
    )
  );
  await sql`
    UPDATE "leaseLine" AS l SET
      "lesseeClassification" = v.classification::"lesseeClassification",
      "classificationInputs" = CASE WHEN v."setInputs"::boolean
        THEN v.inputs::jsonb ELSE l."classificationInputs" END,
      "initialLiability" = CASE WHEN v."setInitial"::boolean
        THEN v.initial::numeric ELSE l."initialLiability" END,
      "initialRouAsset" = CASE WHEN v."setInitial"::boolean
        THEN v.initial::numeric ELSE l."initialRouAsset" END,
      "rouAssetCost" = CASE WHEN v."setCost"::boolean
        THEN v.cost::numeric ELSE l."rouAssetCost" END,
      "paymentAmount" = CASE WHEN v."setPayment"::boolean
        THEN v.payment::numeric ELSE l."paymentAmount" END,
      "updatedBy" = ${args.userId},
      "updatedAt" = ${datetime.timestamp()}
    FROM (VALUES ${values}) AS v(
      id, classification, inputs, "setInputs", initial, "setInitial",
      cost, "setCost", payment, "setPayment"
    )
    WHERE l."id" = v.id AND l."companyId" = ${args.companyId}
  `.execute(trx);
}
