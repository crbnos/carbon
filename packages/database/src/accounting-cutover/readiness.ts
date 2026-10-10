// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The readiness checks of the enable wizard's first step
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 3).

import { parseDate, startOfMonth, today } from "@internationalized/date";
import { sql } from "kysely";
import { MIGRATION_CLEARING_ACCOUNT_CLASS } from "../accounting-cutover";
import { PRE_CUTOVER_JOURNAL_STATUSES } from "../accounting-posting";
import { hasDefaultFallback } from "../journal-posting-status";
import { getCompanyTimeZone } from "../timezone";
import {
  ACCOUNT_DEFAULT_COLUMNS,
  type CutoverArgs,
  type CutoverDb,
  getAccounts,
  getCompany,
  OPENING_BALANCE_SOURCE
} from "./shared";

/** How many blocking documents or jobs a readiness check lists. */
const READINESS_ITEM_LIMIT = 25;
/** How many periods before the current one the cutover date may be. */
export const CUTOVER_MAX_PERIODS_BACK = 3;

export type ActivationCheckKey =
  | "account-defaults"
  | "fiscal-settings"
  | "cutover-date"
  | "pending-documents"
  | "legacy-jobs"
  | "opening-balance";

/** Why the cutover date is not allowed. */
export type CutoverDateReason =
  | "cutover-date-invalid"
  | "cutover-date-not-period-start"
  | "cutover-date-after-today"
  | "cutover-date-too-far-back";

/**
 * Why a check fails, as a code the wizard translates, on the checks whose key
 * alone does not say what to fix. `detail` says the same in English, for the
 * enable's refusal.
 */
export type ActivationCheckReason =
  | "no-fiscal-year-settings"
  | "no-base-currency"
  | "migration-clearing-wrong-kind"
  | CutoverDateReason;

/** The status of a Migration Clearing default item of the wrong kind: not an
 *  Equity account, or a group. A code, like the reason it goes with. */
const MIGRATION_CLEARING_WRONG_KIND = "migration-clearing-wrong-kind";

/** Something a check lists as a blocker: an empty default, a document, a job. */
export type ActivationCheckItem = {
  type: string;
  id: string;
  readableId: string;
  status: string | null;
};

export type ActivationCheck = {
  key: ActivationCheckKey;
  label: string;
  passed: boolean;
  /** Why the check fails, in one sentence; null when it passes. */
  detail: string | null;
  /** Why the check fails, as codes; empty when it passes or the key says it. */
  reasons: ActivationCheckReason[];
  /** What blocks the check, up to 25 per source. */
  items: ActivationCheckItem[];
  /** The number of blockers, which can exceed `items`. */
  count: number;
};

/** The six readiness checks of the enable wizard's first step. */
export async function getActivationReadiness(
  db: CutoverDb,
  { companyId, cutoverDate }: CutoverArgs
): Promise<{ checks: ActivationCheck[]; passed: boolean }> {
  const company = await getCompany(db, companyId);
  const [
    defaults,
    fiscalYearSettings,
    timeZone,
    pending,
    legacyJobs,
    openingBalances
  ] = await Promise.all([
    db
      .selectFrom("accountDefault")
      .selectAll()
      .where("companyId", "=", companyId)
      .executeTakeFirst(),
    db
      .selectFrom("fiscalYearSettings")
      .select("startMonth")
      .where("companyId", "=", companyId)
      .executeTakeFirst(),
    getCompanyTimeZone(db, companyId),
    getPendingDocumentsBeforeCutover(db, companyId, cutoverDate),
    getLegacyOpenJobs(db, companyId),
    db
      .selectFrom("journal")
      .select(["id", "journalEntryId", "status"])
      .where("companyId", "=", companyId)
      .where("status", "=", "Posted")
      .where("sourceType", "=", OPENING_BALANCE_SOURCE)
      .execute()
  ]);

  // account-defaults: every account column set, to an active account; the
  // Migration Clearing account an Equity posting account, since the opening
  // journal signs its lines as equity. A default with a fallback
  // (DEFAULT_FALLBACKS) may stay empty: every posting uses the fallback.
  const emptyDefaults: ActivationCheckItem[] = [];
  let clearingIsWrongKind = false;
  if (defaults) {
    const accounts = await getAccounts(
      db,
      company.companyGroupId,
      ACCOUNT_DEFAULT_COLUMNS.map((column) => defaults[column]).filter(
        (id): id is string => typeof id === "string" && id !== ""
      )
    );
    for (const column of ACCOUNT_DEFAULT_COLUMNS) {
      const accountId = defaults[column];
      if (!accountId && hasDefaultFallback(column)) continue;
      const account = accountId ? accounts.get(accountId) : undefined;
      if (!account || !account.active) {
        emptyDefaults.push({
          type: "accountDefault",
          id: column,
          readableId: column,
          status: account ? "Inactive" : null
        });
      } else if (
        column === "migrationClearingAccount" &&
        (account.class !== MIGRATION_CLEARING_ACCOUNT_CLASS || account.isGroup)
      ) {
        clearingIsWrongKind = true;
        emptyDefaults.push({
          type: "accountDefault",
          id: column,
          readableId: column,
          status: MIGRATION_CLEARING_WRONG_KIND
        });
      }
    }
  }
  const unsetDefaults = emptyDefaults.filter(
    (item) => item.status !== MIGRATION_CLEARING_WRONG_KIND
  );
  const accountDefaultsCheck: ActivationCheck = {
    key: "account-defaults",
    label: "Every account default is set",
    passed: Boolean(defaults) && emptyDefaults.length === 0,
    detail: !defaults
      ? "The company has no account defaults."
      : emptyDefaults.length > 0
        ? [
            unsetDefaults.length > 0
              ? `Set these account defaults to an active account: ${unsetDefaults
                  .map((item) => item.id)
                  .join(", ")}.`
              : null,
            clearingIsWrongKind
              ? `Set migrationClearingAccount to an active ${MIGRATION_CLEARING_ACCOUNT_CLASS} account that is not a group.`
              : null
          ]
            .filter(Boolean)
            .join(" ")
        : null,
    reasons: clearingIsWrongKind ? ["migration-clearing-wrong-kind"] : [],
    items: emptyDefaults,
    count: emptyDefaults.length
  };

  // fiscal-settings: the fiscal year settings and the base currency exist.
  const fiscalReasons: ActivationCheckReason[] = [
    ...(fiscalYearSettings ? [] : ["no-fiscal-year-settings" as const]),
    ...(company.baseCurrencyCode ? [] : ["no-base-currency" as const])
  ];
  const fiscalSettingsCheck: ActivationCheck = {
    key: "fiscal-settings",
    label: "Fiscal year and base currency are set",
    passed: fiscalReasons.length === 0,
    detail:
      fiscalReasons.length > 0
        ? fiscalReasons
            .map((reason) =>
              reason === "no-fiscal-year-settings"
                ? "Set the fiscal year settings."
                : "Set the base currency."
            )
            .join(" ")
        : null,
    reasons: fiscalReasons,
    items: [],
    count: 0
  };

  // cutover-date: the first day of a period (periods are calendar months),
  // not after today in the company time zone, and at most three periods
  // before the current one.
  const cutoverReason = cutoverDateReason(cutoverDate, timeZone);
  const cutoverDateCheck: ActivationCheck = {
    key: "cutover-date",
    label: "The cutover date is valid",
    passed: cutoverReason === null,
    detail: cutoverReason ? CUTOVER_DATE_ERRORS[cutoverReason] : null,
    reasons: cutoverReason ? [cutoverReason] : [],
    items: [],
    count: 0
  };

  const pendingDocumentsCheck: ActivationCheck = {
    key: "pending-documents",
    label: "No unposted documents dated before the cutover",
    passed: pending.count === 0,
    detail:
      pending.count > 0
        ? `Post or delete ${pending.count} document(s) dated before the cutover.`
        : null,
    reasons: [],
    items: pending.items,
    count: pending.count
  };

  const legacyJobsCheck: ActivationCheck = {
    key: "legacy-jobs",
    label: "No open jobs from before Carbon recorded their costs",
    passed: legacyJobs.count === 0,
    detail:
      legacyJobs.count > 0
        ? `Complete or cancel ${legacyJobs.count} job(s) created before Carbon recorded their costs.`
        : null,
    reasons: [],
    items: legacyJobs.items,
    count: legacyJobs.count
  };

  const openingBalanceCheck: ActivationCheck = {
    key: "opening-balance",
    label: "No posted opening balance",
    passed: openingBalances.length === 0,
    detail:
      openingBalances.length > 0
        ? "The company already has a posted opening balance journal."
        : null,
    reasons: [],
    items: openingBalances.map((journal) => ({
      type: "Journal",
      id: journal.id,
      readableId: journal.journalEntryId,
      status: journal.status
    })),
    count: openingBalances.length
  };

  const checks = [
    accountDefaultsCheck,
    fiscalSettingsCheck,
    cutoverDateCheck,
    pendingDocumentsCheck,
    legacyJobsCheck,
    openingBalanceCheck
  ];
  return { checks, passed: checks.every((check) => check.passed) };
}

/** What `detail` says for each reason the cutover date is not allowed. */
const CUTOVER_DATE_ERRORS: Record<CutoverDateReason, string> = {
  "cutover-date-invalid": "The cutover date is not a valid date.",
  "cutover-date-not-period-start":
    "The cutover date must be the first day of a period.",
  "cutover-date-after-today": "The cutover date cannot be after today.",
  "cutover-date-too-far-back": `The cutover date can be at most ${CUTOVER_MAX_PERIODS_BACK} periods before the current period.`
};

/** Why a cutover date is not allowed, or null. */
export function cutoverDateReason(
  cutoverDate: string,
  timeZone: string
): CutoverDateReason | null {
  let date: ReturnType<typeof parseDate>;
  try {
    date = parseDate(cutoverDate);
  } catch {
    return "cutover-date-invalid";
  }
  if (date.day !== 1) return "cutover-date-not-period-start";
  const now = today(timeZone);
  if (date.compare(now) > 0) return "cutover-date-after-today";
  const current = startOfMonth(now);
  const periodsBack =
    current.year * 12 + current.month - (date.year * 12 + date.month);
  if (periodsBack > CUTOVER_MAX_PERIODS_BACK) {
    return "cutover-date-too-far-back";
  }
  return null;
}

/**
 * Draft and Pending receipts, shipments and invoices, and Draft payments and
 * memos, dated before the cutover. A document with no posting date posts on
 * the day it is posted, which is on or after a valid cutover date.
 */
async function getPendingDocumentsBeforeCutover(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string
): Promise<{ items: ActivationCheckItem[]; count: number }> {
  const total = sql<number>`count(*) over ()`.as("total");
  const [
    receipts,
    shipments,
    salesInvoices,
    purchaseInvoices,
    payments,
    memos
  ] = await Promise.all([
    db
      .selectFrom("receipt")
      .select(["id", "receiptId as readableId", "status", total])
      .where("companyId", "=", companyId)
      .where("status", "in", ["Draft", "Pending"])
      .where("postingDate", "<", cutoverDate)
      .orderBy("receiptId")
      .limit(READINESS_ITEM_LIMIT)
      .execute(),
    db
      .selectFrom("shipment")
      .select(["id", "shipmentId as readableId", "status", total])
      .where("companyId", "=", companyId)
      .where("status", "in", ["Draft", "Pending"])
      .where("postingDate", "<", cutoverDate)
      .orderBy("shipmentId")
      .limit(READINESS_ITEM_LIMIT)
      .execute(),
    db
      .selectFrom("salesInvoice")
      .select(["id", "invoiceId as readableId", "status", total])
      .where("companyId", "=", companyId)
      .where("status", "in", ["Draft", "Pending"])
      .where("postingDate", "<", cutoverDate)
      .orderBy("invoiceId")
      .limit(READINESS_ITEM_LIMIT)
      .execute(),
    db
      .selectFrom("purchaseInvoice")
      .select(["id", "invoiceId as readableId", "status", total])
      .where("companyId", "=", companyId)
      .where("status", "in", ["Draft", "Pending"])
      .where("postingDate", "<", cutoverDate)
      .orderBy("invoiceId")
      .limit(READINESS_ITEM_LIMIT)
      .execute(),
    db
      .selectFrom("payment")
      .select(["id", "paymentId as readableId", "status", total])
      .where("companyId", "=", companyId)
      .where("status", "=", "Draft")
      .where("postingDate", "<", cutoverDate)
      .orderBy("paymentId")
      .limit(READINESS_ITEM_LIMIT)
      .execute(),
    db
      .selectFrom("memo")
      .select(["id", "memoId as readableId", "status", total])
      .where("companyId", "=", companyId)
      .where("status", "=", "Draft")
      .where("postingDate", "<", cutoverDate)
      .orderBy("memoId")
      .limit(READINESS_ITEM_LIMIT)
      .execute()
  ]);

  const sources: [
    string,
    { id: string; readableId: string; status: string; total: number }[]
  ][] = [
    ["Receipt", receipts],
    ["Shipment", shipments],
    ["Sales Invoice", salesInvoices],
    ["Purchase Invoice", purchaseInvoices],
    ["Payment", payments],
    ["Memo", memos]
  ];
  const items: ActivationCheckItem[] = [];
  let count = 0;
  for (const [type, rows] of sources) {
    count += Number(rows[0]?.total ?? 0);
    for (const row of rows) {
      items.push({
        type,
        id: row.id,
        readableId: row.readableId,
        status: row.status
      });
    }
  }
  return { items, count };
}

/** Job statuses after which a job takes no more cost. */
const CLOSED_JOB_STATUSES = ["Completed", "Cancelled", "Closed"] as const;

/**
 * Open jobs created before L, the creation time of the company's first
 * Provisional or Superseded journal (now when it has none). Carbon did not
 * record the cost of such a job from its start.
 */
async function getLegacyOpenJobs(
  db: CutoverDb,
  companyId: string
): Promise<{ items: ActivationCheckItem[]; count: number }> {
  const firstPreCutoverJournal = db
    .selectFrom("journal")
    .select((eb) => eb.fn.min("createdAt").as("createdAt"))
    .where("companyId", "=", companyId)
    .where("status", "in", [...PRE_CUTOVER_JOURNAL_STATUSES]);
  const rows = await db
    .selectFrom("job")
    .select([
      "id",
      "jobId as readableId",
      "status",
      sql<number>`count(*) over ()`.as("total")
    ])
    .where("companyId", "=", companyId)
    .where("status", "not in", [...CLOSED_JOB_STATUSES])
    .where(
      "createdAt",
      "<",
      sql<string>`coalesce(${firstPreCutoverJournal}, now())`
    )
    .orderBy("jobId")
    .limit(READINESS_ITEM_LIMIT)
    .execute();
  return {
    items: rows.map((row) => ({
      type: "Job",
      id: row.id,
      readableId: row.readableId,
      status: row.status
    })),
    count: Number(rows[0]?.total ?? 0)
  };
}
