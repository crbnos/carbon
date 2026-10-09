// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The database reads of the accounting cutover
// (.ai/specs/2026-10-08-accounting-cutover.md sections 3 and 4): the
// readiness checks, the open items, the inventory and fixed assets at the
// cutover date, and Migration Clearing. Also the two writes the wizard makes
// before the enable: the Draft opening trial balance and the accumulated
// depreciation of an asset. Server-only. Every function takes a Kysely handle
// or a transaction, so the wizard loaders and the enable transaction run the
// same reads.

import { parseDate, startOfMonth, today } from "@internationalized/date";
import { type Expression, type Kysely, sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import {
  type AccountClass,
  type LayerBeforeCutover,
  type MigrationClearingRow,
  migrationClearingByAccount,
  type OpenItem,
  type OpenItemType,
  type TrialBalanceLine,
  unitCostAtCutover
} from "./accounting-cutover";
import {
  CUSTOMER_DEPOSIT_DESCRIPTION,
  DOCUMENT_JOURNAL_STATUSES,
  onAccountCreditDescription
} from "./accounting-posting";
import type { KyselyDatabase } from "./client";
import { isAccountClass } from "./ledger";
import {
  assetsLeavingWithoutJournal,
  LEGACY_DOCUMENT_FAMILIES,
  LEGACY_PURCHASE_RETURN_SHIPMENT,
  LEGACY_SALES_RETURN_SHIPMENT,
  LEGACY_SALES_SHIPMENT,
  type LegacyDocumentCounts,
  legacyAdjustmentCostRows,
  legacyCharges,
  legacyDepreciationRunLines,
  legacyDisposals,
  legacyJobMovements,
  legacyMemos,
  legacyPayments,
  legacyPurchaseInvoices,
  legacyReceipts,
  legacyRecognitionSchedule,
  legacyReimbursements,
  legacySalesInvoices,
  legacyShipments
} from "./legacy-documents";
import { EPSILON, round } from "./precision";
import { getNextSequence } from "./sequence";
import { getCompanyTimeZone } from "./timezone";
import { journalReference } from "./utils";

export {
  type LegacyDocumentCounts,
  type LegacyDocumentFamily,
  REBUILT_DISPOSAL_METHOD
} from "./legacy-documents";

export type CutoverDb = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

type CutoverArgs = { companyId: string; cutoverDate: string };

/** How many blocking documents or jobs a readiness check lists. */
const READINESS_ITEM_LIMIT = 25;
/** How many periods before the current one the cutover date may be. */
export const CUTOVER_MAX_PERIODS_BACK = 3;

export const ACCOUNTING_ALREADY_SET_UP = "Accounting is already set up.";

const OPENING_BALANCE_SOURCE = "Opening Balance" as const;
const OPENING_TRIAL_BALANCE_DESCRIPTION = "Opening trial balance";
/** The descriptions a receipt and a purchase invoice write on GR/IR. */
const GOODS_RECEIVED_NOT_INVOICED_DESCRIPTION = "Goods Received Not Invoiced";
const GR_IR_CLEARING_DESCRIPTION = "GR/IR Clearing";

/** The day before the cutover: the date the opening journal carries. */
export function dayBeforeCutover(cutoverDate: string): string {
  return parseDate(cutoverDate).subtract({ days: 1 }).toString();
}

/** Debit-signed value of a natural-balance-signed amount on an account. */
function toDebit(amount: number, accountClass: AccountClass) {
  return accountClass === "Asset" || accountClass === "Expense"
    ? amount
    : -amount;
}

/** Natural-balance-signed amount of a debit-signed value on an account. */
function toNatural(debit: number, accountClass: AccountClass) {
  return toDebit(debit, accountClass);
}

async function withTransaction<T>(
  db: CutoverDb,
  fn: (trx: Transaction<KyselyDatabase>) => Promise<T>
): Promise<T> {
  if (db.isTransaction) return fn(db as Transaction<KyselyDatabase>);
  return db.transaction().execute(fn);
}

async function getCompany(db: CutoverDb, companyId: string) {
  const company = await db
    .selectFrom("company")
    .select(["id", "name", "companyGroupId", "baseCurrencyCode"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company?.companyGroupId) throw new Error("Company not found");
  return { ...company, companyGroupId: company.companyGroupId };
}

async function getAccountDefaults(db: CutoverDb, companyId: string) {
  const defaults = await db
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) throw new Error("Account defaults are not set up");
  return defaults;
}

type AccountDefaults = Awaited<ReturnType<typeof getAccountDefaults>>;

/** The account columns of `accountDefault` (every column but the keys). */
function accountDefaultColumns(defaults: AccountDefaults) {
  return (Object.keys(defaults) as (keyof AccountDefaults)[]).filter(
    (column) => column !== "companyId" && column !== "updatedBy"
  );
}

/** Accounts of the company group by id, with their class. One query. */
async function getAccounts(
  db: CutoverDb,
  companyGroupId: string,
  accountIds: Iterable<string>
) {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0)
    return new Map<
      string,
      { id: string; class: string | null; active: boolean; name: string }
    >();
  const rows = await db
    .selectFrom("account")
    .select(["id", "class", "active", "name"])
    .where("companyGroupId", "=", companyGroupId)
    .where("id", "in", ids)
    .execute();
  return new Map(rows.map((row) => [row.id, row]));
}

function requireClass(
  accounts: Awaited<ReturnType<typeof getAccounts>>,
  accountId: string
): AccountClass {
  const accountClass = accounts.get(accountId)?.class ?? null;
  if (!isAccountClass(accountClass)) {
    throw new Error(`Account ${accountId} has no account class`);
  }
  return accountClass;
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type ActivationCheckKey =
  | "account-defaults"
  | "fiscal-settings"
  | "cutover-date"
  | "pending-documents"
  | "legacy-jobs"
  | "opening-balance";

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

  // account-defaults: every account column set, to an active account.
  const emptyDefaults: ActivationCheckItem[] = [];
  if (defaults) {
    const columns = accountDefaultColumns(defaults);
    const accounts = await getAccounts(
      db,
      company.companyGroupId,
      columns
        .map((column) => defaults[column])
        .filter((id): id is string => typeof id === "string" && id !== "")
    );
    for (const column of columns) {
      const accountId = defaults[column];
      const account =
        typeof accountId === "string" ? accounts.get(accountId) : undefined;
      if (!account || !account.active) {
        emptyDefaults.push({
          type: "accountDefault",
          id: column,
          readableId: column,
          status: account ? "Inactive" : null
        });
      }
    }
  }
  const accountDefaultsCheck: ActivationCheck = {
    key: "account-defaults",
    label: "Every account default is set",
    passed: Boolean(defaults) && emptyDefaults.length === 0,
    detail: !defaults
      ? "The company has no account defaults."
      : emptyDefaults.length > 0
        ? `Set these account defaults to an active account: ${emptyDefaults
            .map((item) => item.id)
            .join(", ")}.`
        : null,
    items: emptyDefaults,
    count: emptyDefaults.length
  };

  // fiscal-settings: the fiscal year settings and the base currency exist.
  const fiscalSettingsCheck: ActivationCheck = {
    key: "fiscal-settings",
    label: "Fiscal year and base currency are set",
    passed: Boolean(fiscalYearSettings) && Boolean(company.baseCurrencyCode),
    detail: !fiscalYearSettings
      ? "Set the fiscal year settings."
      : !company.baseCurrencyCode
        ? "Set the base currency."
        : null,
    items: [],
    count: 0
  };

  // cutover-date: the first day of a period (periods are calendar months),
  // not after today in the company time zone, and at most three periods
  // before the current one.
  const cutoverDateCheck: ActivationCheck = {
    key: "cutover-date",
    label: "The cutover date is valid",
    passed: true,
    detail: null,
    items: [],
    count: 0
  };
  const cutoverError = cutoverDateError(cutoverDate, timeZone);
  if (cutoverError) {
    cutoverDateCheck.passed = false;
    cutoverDateCheck.detail = cutoverError;
  }

  const pendingDocumentsCheck: ActivationCheck = {
    key: "pending-documents",
    label: "No unposted documents dated before the cutover",
    passed: pending.count === 0,
    detail:
      pending.count > 0
        ? `Post or delete ${pending.count} document(s) dated before the cutover.`
        : null,
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

/** Why a cutover date is not allowed, or null. */
export function cutoverDateError(
  cutoverDate: string,
  timeZone: string
): string | null {
  let date: ReturnType<typeof parseDate>;
  try {
    date = parseDate(cutoverDate);
  } catch {
    return "The cutover date is not a valid date.";
  }
  if (date.day !== 1) {
    return "The cutover date must be the first day of a period.";
  }
  const now = today(timeZone);
  if (date.compare(now) > 0) {
    return "The cutover date cannot be after today.";
  }
  const current = startOfMonth(now);
  const periodsBack =
    current.year * 12 + current.month - (date.year * 12 + date.month);
  if (periodsBack > CUTOVER_MAX_PERIODS_BACK) {
    return `The cutover date can be at most ${CUTOVER_MAX_PERIODS_BACK} periods before the current period.`;
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
      sql<string>`coalesce((
        SELECT min("createdAt") FROM "journal"
        WHERE "companyId" = ${companyId}
          AND "status" IN ('Provisional', 'Superseded')
      ), now())`
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

// ---------------------------------------------------------------------------
// Open items
// ---------------------------------------------------------------------------

/**
 * An open item before its account class is known. `basis` says how its
 * amounts are signed: "debit" (positive = debit) or "natural" (already
 * natural-balance-signed for its account, as a journal line).
 */
type DraftItem = {
  openItemType: OpenItemType;
  accountId: string;
  basis: "debit" | "natural";
  original: number;
  settled: number;
  documentType: string | null;
  documentId: string | null;
  documentLineReference: string | null;
  description: string;
  /** The original line's quantity. */
  quantity?: number | null;
  /** How the part settled before the cutover is keyed, when not the default. */
  settledLine?: OpenItem["settled"];
};

type OpenDocumentRow = {
  partyId: string | null;
  documentId: string;
  documentNumber: string;
  documentType: string;
  totalAmount: number;
  exchangeRate: number;
  openInBase: number;
};

type SettlementRow = {
  paymentId: string | null;
  memoId: string | null;
  sourcePaymentId: string | null;
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  targetMemoId: string | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number;
};

/**
 * Settlements in effect on the day before the cutover, by the rule
 * `get_ar_open_by_customer` and `get_ap_open_by_supplier` use: a payment's
 * settlements once the payment is Posted on or before that day; a memo's
 * once the memo is, and, when it was applied through a payment, that payment
 * too.
 */
async function getSettlementsBeforeCutover(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string
): Promise<SettlementRow[]> {
  const rows = await db
    .selectFrom("invoiceSettlement as s")
    .leftJoin("payment as p", (join) =>
      join
        .onRef("p.id", "=", "s.paymentId")
        .onRef("p.companyId", "=", "s.companyId")
    )
    .leftJoin("memo as m", (join) =>
      join
        .onRef("m.id", "=", "s.memoId")
        .onRef("m.companyId", "=", "s.companyId")
    )
    .leftJoin("payment as vp", (join) =>
      join
        .onRef("vp.id", "=", "s.appliedViaPaymentId")
        .onRef("vp.companyId", "=", "s.companyId")
    )
    .select([
      "s.paymentId",
      "s.memoId",
      "s.sourcePaymentId",
      "s.targetSalesInvoiceId",
      "s.targetPurchaseInvoiceId",
      "s.targetMemoId",
      "s.appliedAmount",
      "s.discountAmount",
      "s.writeOffAmount",
      "s.fxGainLossAmount"
    ])
    .where("s.companyId", "=", companyId)
    .where((eb) =>
      eb.or([
        eb.and([
          eb("s.paymentId", "is not", null),
          eb("p.status", "=", "Posted"),
          eb("p.postingDate", "<", cutoverDate)
        ]),
        eb.and([
          eb("s.memoId", "is not", null),
          eb("m.status", "=", "Posted"),
          eb("m.postingDate", "<", cutoverDate),
          eb.or([
            eb.and([
              eb("s.appliedViaPaymentId", "is", null),
              eb("s.appliedDate", "<", cutoverDate)
            ]),
            eb.and([
              eb("vp.status", "=", "Posted"),
              eb("vp.postingDate", "<", cutoverDate)
            ])
          ])
        ])
      ])
    )
    .execute();
  return rows.map((row) => ({
    ...row,
    appliedAmount: Number(row.appliedAmount ?? 0),
    discountAmount: Number(row.discountAmount ?? 0),
    writeOffAmount: Number(row.writeOffAmount ?? 0),
    fxGainLossAmount: Number(row.fxGainLossAmount ?? 0)
  }));
}

function addTo(map: Map<string, number>, key: string | null, value: number) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + value);
}

/**
 * Receivables and payables open at the cutover: one item per invoice and
 * memo `get_ar_open_by_customer` / `get_ap_open_by_supplier` report open on
 * the day before the cutover. `originalAmount` is the document's base
 * control amount as those readers compute it when no Posted control line
 * exists (an invoice's base total; a memo's amount at its rate), and
 * `settledBeforeCutover` is what settlements in effect by then applied. The
 * split must agree with the readers' open amount, or the read refuses.
 */
async function getReceivableAndPayableItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults,
  settlements: SettlementRow[]
): Promise<DraftItem[]> {
  const asOf = dayBeforeCutover(cutoverDate);
  const [receivables, payables] = await Promise.all([
    sql<OpenDocumentRow>`
      SELECT "customerId" AS "partyId", "documentId", "documentNumber",
        "documentType", "totalAmount", "exchangeRate", "openInBase"
      FROM get_ar_open_by_customer(${companyId}, ${asOf}::date)
    `.execute(db),
    sql<OpenDocumentRow>`
      SELECT "supplierId" AS "partyId", "documentId", "documentNumber",
        "documentType", "totalAmount", "exchangeRate", "openInBase"
      FROM get_ap_open_by_supplier(${companyId}, ${asOf}::date)
    `.execute(db)
  ]);

  const customerIds = receivables.rows
    .map((row) => row.partyId)
    .filter((id): id is string => Boolean(id));
  const supplierIds = payables.rows
    .map((row) => row.partyId)
    .filter((id): id is string => Boolean(id));
  const [customers, suppliers] = await Promise.all([
    customerIds.length
      ? db
          .selectFrom("customer")
          .select(["id", "intercompanyCompanyId"])
          .where("companyId", "=", companyId)
          .where("id", "in", [...new Set(customerIds)])
          .execute()
      : Promise.resolve([]),
    supplierIds.length
      ? db
          .selectFrom("supplier")
          .select(["id", "intercompanyCompanyId"])
          .where("companyId", "=", companyId)
          .where("id", "in", [...new Set(supplierIds)])
          .execute()
      : Promise.resolve([])
  ]);
  const intercompanyCustomers = new Set(
    customers.filter((row) => row.intercompanyCompanyId).map((row) => row.id)
  );
  const intercompanySuppliers = new Set(
    suppliers.filter((row) => row.intercompanyCompanyId).map((row) => row.id)
  );

  // Base settled before the cutover, per the readers' own sums.
  const invoiceSettled = new Map<string, number>();
  const arMemoSettled = new Map<string, number>();
  const apMemoSettled = new Map<string, number>();
  for (const row of settlements) {
    const adjusted =
      row.appliedAmount + row.discountAmount + row.writeOffAmount;
    addTo(invoiceSettled, row.targetSalesInvoiceId, adjusted);
    addTo(invoiceSettled, row.targetPurchaseInvoiceId, adjusted);
    // A memo applied as a credit: AR adds the realized FX, AP subtracts it.
    addTo(arMemoSettled, row.memoId, row.appliedAmount + row.fxGainLossAmount);
    addTo(apMemoSettled, row.memoId, row.appliedAmount - row.fxGainLossAmount);
    // A memo refunded by a payment.
    if (row.paymentId) {
      addTo(arMemoSettled, row.targetMemoId, row.appliedAmount);
      addTo(apMemoSettled, row.targetMemoId, row.appliedAmount);
    }
  }

  const items: DraftItem[] = [];
  const mismatches: string[] = [];
  const build = (row: OpenDocumentRow, isAR: boolean) => {
    const isInvoice = row.documentType === "Invoice";
    const isIntercompany = row.partyId
      ? (isAR ? intercompanyCustomers : intercompanySuppliers).has(row.partyId)
      : false;
    // Signed as the reader signs `openInBase`: positive is the control
    // account's natural side (a debit on receivables, a credit on payables).
    const sign = isInvoice
      ? 1
      : isAR
        ? row.documentType === "Credit Memo"
          ? -1
          : 1
        : row.documentType === "Debit Memo"
          ? -1
          : 1;
    const originalBase = isInvoice
      ? round(Number(row.totalAmount))
      : round(Number(row.totalAmount) / Number(row.exchangeRate));
    const settledBase = isInvoice
      ? (invoiceSettled.get(row.documentId) ?? 0)
      : ((isAR ? arMemoSettled : apMemoSettled).get(row.documentId) ?? 0);
    const original = sign * originalBase;
    const settled = round(sign * settledBase);
    if (Math.abs(original - settled - Number(row.openInBase)) > EPSILON) {
      mismatches.push(row.documentNumber);
    }

    const accountId = isAR
      ? isInvoice && isIntercompany
        ? (defaults.intercompanyReceivablesAccount ??
          defaults.receivablesAccount)
        : defaults.receivablesAccount
      : isInvoice && isIntercompany
        ? (defaults.intercompanyPayablesAccount ?? defaults.payablesAccount)
        : defaults.payablesAccount;
    // The description the document's own posting writes on its control
    // line. Sales invoices write "IC Receivables" for an intercompany
    // customer; purchase invoices and memos always write the plain one.
    const description = isAR
      ? isInvoice && isIntercompany
        ? "IC Receivables"
        : "Accounts Receivable"
      : "Accounts Payable";
    // A natural-signed amount on the control account's own side: receivables
    // are debit-natured, payables credit-natured.
    items.push({
      openItemType: isAR ? "Receivable" : "Payable",
      accountId,
      basis: "debit",
      original: isAR ? original : -original,
      settled: isAR ? settled : -settled,
      documentType: isInvoice ? "Invoice" : "Memo",
      documentId: row.documentId,
      documentLineReference: null,
      description
    });
  };
  for (const row of receivables.rows) build(row, true);
  for (const row of payables.rows) build(row, false);

  if (mismatches.length > 0) {
    throw new Error(
      `The open amount of ${mismatches.join(", ")} does not match the receivables and payables reports`
    );
  }
  return items;
}

/**
 * Unapplied credit and customer deposits: per payment posted before the
 * cutover, the unapplied line its own journal wrote, less what later
 * payments before the cutover drew from it.
 */
async function getUnappliedPaymentItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults,
  settlements: SettlementRow[]
): Promise<DraftItem[]> {
  const lines = await db
    .selectFrom("payment")
    .innerJoin("journalLine as line", (join) =>
      join
        .onRef("line.journalId", "=", "payment.journalId")
        .onRef("line.companyId", "=", "payment.companyId")
        .onRef("line.documentId", "=", "payment.id")
    )
    .select([
      "payment.id",
      "payment.customerId",
      "line.accountId",
      "line.accountDefaultRole",
      "line.amount",
      "line.description"
    ])
    .where("payment.companyId", "=", companyId)
    .where("payment.status", "=", "Posted")
    .where("payment.postingDate", "<", cutoverDate)
    .where("line.documentType", "=", "Payment")
    .where("line.description", "in", [
      onAccountCreditDescription(true),
      onAccountCreditDescription(false),
      CUSTOMER_DEPOSIT_DESCRIPTION
    ])
    .execute();

  // Base each source payment's credit released before the cutover, as
  // `remainingFundingSources` reduces a funding source.
  const consumed = new Map<string, { ar: number; ap: number }>();
  for (const row of settlements) {
    if (!row.sourcePaymentId) continue;
    const current = consumed.get(row.sourcePaymentId) ?? { ar: 0, ap: 0 };
    current.ar += row.appliedAmount + row.fxGainLossAmount;
    current.ap += row.appliedAmount - row.fxGainLossAmount;
    consumed.set(row.sourcePaymentId, current);
  }

  return lines.map((line) => {
    const isAR = line.customerId != null;
    const original = Number(line.amount);
    const use = consumed.get(line.id);
    const released = use ? (isAR ? use.ar : use.ap) : 0;
    const isDeposit = line.description === CUSTOMER_DEPOSIT_DESCRIPTION;
    return {
      openItemType: isDeposit ? "Customer Deposit" : "Unapplied Credit",
      accountId: resolveLineAccount(line, defaults),
      basis: "natural" as const,
      original,
      settled: round(Math.sign(original) * released),
      documentType: "Payment",
      documentId: line.id,
      documentLineReference: null,
      description: line.description ?? ""
    };
  });
}

/**
 * The account a journal line belongs on. A stand-in line, written before the
 * cutover while its default was empty, names the default it wanted.
 */
function resolveLineAccount(
  line: { accountId: string | null; accountDefaultRole: string | null },
  defaults: AccountDefaults
): string {
  if (line.accountDefaultRole) {
    const accountId =
      defaults[line.accountDefaultRole as keyof AccountDefaults];
    if (typeof accountId !== "string" || !accountId) {
      throw new Error(`Set the ${line.accountDefaultRole} account default`);
    }
    return accountId;
  }
  if (!line.accountId) throw new Error("A journal line has no account");
  return line.accountId;
}

/**
 * Received, not invoiced: per purchase order line with more received than
 * invoiced before the cutover, what the purchase invoice's GR/IR walk needs
 * to find. That walk reads the line's `receipt:<poLineId>` journal groups in
 * order, skips the units already invoiced and costs the rest from each
 * group's amount and quantity. So the item carries:
 * - everything received before the cutover, with its quantity (inventory
 *   unit) and receipt cost, on `receipt:<poLineId>`;
 * - what the invoices before the cutover cleared, with the opposite sign, on
 *   `purchase-invoice:<poLineId>`, which the walk does not read.
 * A receipt's cost is its GR/IR journal line; a receipt with none (posted
 * before Carbon wrote journals for every company) takes its cost layers, else
 * quantity × unit price. An invoice's clearing is its GR/IR Clearing lines; an
 * invoice with no journal at all clears its quantity at the line's average
 * receipt cost.
 */
async function getReceivedNotInvoicedItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults
): Promise<DraftItem[]> {
  const grIrAccountId = defaults.goodsReceivedNotInvoicedAccount;
  const receiptLines = await db
    .selectFrom("receiptLine as line")
    .innerJoin("receipt", (join) =>
      join
        .onRef("receipt.id", "=", "line.receiptId")
        .onRef("receipt.companyId", "=", "line.companyId")
    )
    .select([
      "line.receiptId",
      "line.lineId",
      "line.itemId",
      "line.receivedQuantity",
      "line.unitPrice"
    ])
    .where("line.companyId", "=", companyId)
    .where("receipt.status", "=", "Posted")
    .where("receipt.sourceDocument", "=", "Purchase Order")
    .where("receipt.postingDate", "<", cutoverDate)
    .where("line.lineId", "is not", null)
    .where("line.receivedQuantity", "<>", 0)
    .execute();
  if (receiptLines.length === 0) return [];

  const receiptIds = [...new Set(receiptLines.map((line) => line.receiptId))];
  const purchaseOrderLineIds = [
    ...new Set(receiptLines.map((line) => line.lineId as string))
  ];
  const receiptPrefix = journalReference.to.receipt("");
  const invoicePrefix = journalReference.to.purchaseInvoice("");

  const [receiptGrIr, receiptLayers, invoiceLines] = await Promise.all([
    db
      .selectFrom("journalLine as line")
      .innerJoin("journal", (join) =>
        join
          .onRef("journal.id", "=", "line.journalId")
          .onRef("journal.companyId", "=", "line.companyId")
      )
      .select([
        "line.documentId",
        "line.documentLineReference",
        sql<number>`sum("line"."amount")`.as("amount")
      ])
      .where("line.companyId", "=", companyId)
      .where("line.accountId", "=", grIrAccountId)
      .where("line.documentId", "in", receiptIds)
      .where("line.documentLineReference", "like", `${receiptPrefix}%`)
      .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
      .groupBy(["line.documentId", "line.documentLineReference"])
      .execute(),
    db
      .selectFrom("costLedger")
      .select([
        "documentId",
        "itemId",
        sql<number>`sum("cost")`.as("cost"),
        sql<number>`sum("quantity")`.as("quantity")
      ])
      .where("companyId", "=", companyId)
      .where("documentType", "=", "Purchase Receipt")
      .where("documentId", "in", receiptIds)
      .where("adjustment", "=", false)
      .where("appliesToCostLedgerId", "is", null)
      .where("quantity", ">", 0)
      .groupBy(["documentId", "itemId"])
      .execute(),
    db
      .selectFrom("purchaseInvoiceLine as line")
      .innerJoin("purchaseInvoice as invoice", (join) =>
        join
          .onRef("invoice.id", "=", "line.invoiceId")
          .onRef("invoice.companyId", "=", "line.companyId")
      )
      .select([
        "invoice.id as invoiceId",
        "line.purchaseOrderLineId",
        "line.quantity",
        "line.conversionFactor"
      ])
      .where("line.companyId", "=", companyId)
      .where("line.purchaseOrderLineId", "in", purchaseOrderLineIds)
      .where("invoice.status", "not in", ["Draft", "Pending", "Voided"])
      .where("invoice.postingDate", "<", cutoverDate)
      .execute()
  ]);

  const invoiceIds = [...new Set(invoiceLines.map((line) => line.invoiceId))];
  const invoiceJournalLines =
    invoiceIds.length > 0
      ? await db
          .selectFrom("journalLine as line")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "line.journalId")
              .onRef("journal.companyId", "=", "line.companyId")
          )
          .select([
            "line.documentId",
            "line.documentLineReference",
            sql<boolean>`bool_or(
              "line"."accountId" = ${grIrAccountId}
              AND "line"."description" = ${GR_IR_CLEARING_DESCRIPTION}
            )`.as("isClearing"),
            sql<number>`sum("line"."amount") FILTER (
              WHERE "line"."accountId" = ${grIrAccountId}
                AND "line"."description" = ${GR_IR_CLEARING_DESCRIPTION}
            )`.as("amount"),
            sql<number>`sum("line"."quantity") FILTER (
              WHERE "line"."accountId" = ${grIrAccountId}
                AND "line"."description" = ${GR_IR_CLEARING_DESCRIPTION}
            )`.as("quantity")
          ])
          .where("line.companyId", "=", companyId)
          .where("line.documentId", "in", invoiceIds)
          .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
          .groupBy(["line.documentId", "line.documentLineReference"])
          .execute()
      : [];

  // Received before the cutover, per (receipt, PO line): quantity and the
  // cost a receipt with no journal falls back to.
  const layerByReceiptItem = new Map(
    receiptLayers.map((row) => [
      `${row.documentId}:${row.itemId}`,
      { cost: Number(row.cost), quantity: Number(row.quantity) }
    ])
  );
  const grIrByReceiptLine = new Map(
    receiptGrIr.map((row) => [
      `${row.documentId}:${(row.documentLineReference ?? "").slice(receiptPrefix.length)}`,
      Number(row.amount)
    ])
  );
  const received = new Map<
    string,
    { purchaseOrderLineId: string; quantity: number; fallbackCost: number }
  >();
  for (const line of receiptLines) {
    const purchaseOrderLineId = line.lineId as string;
    const quantity = Number(line.receivedQuantity);
    const layer = layerByReceiptItem.get(`${line.receiptId}:${line.itemId}`);
    const fallbackCost =
      quantity > 0 && layer && layer.quantity > EPSILON
        ? (quantity / layer.quantity) * layer.cost
        : quantity * Number(line.unitPrice ?? 0);
    const key = `${line.receiptId}:${purchaseOrderLineId}`;
    const current = received.get(key) ?? {
      purchaseOrderLineId,
      quantity: 0,
      fallbackCost: 0
    };
    current.quantity += quantity;
    current.fallbackCost += fallbackCost;
    received.set(key, current);
  }
  const receivedByLine = new Map<string, { quantity: number; cost: number }>();
  for (const [key, row] of received) {
    const current = receivedByLine.get(row.purchaseOrderLineId) ?? {
      quantity: 0,
      cost: 0
    };
    current.quantity += row.quantity;
    current.cost += grIrByReceiptLine.get(key) ?? row.fallbackCost;
    receivedByLine.set(row.purchaseOrderLineId, current);
  }

  // Cleared before the cutover, per PO line: the GR/IR Clearing lines of the
  // invoices with a journal, and the inventory quantity of those without one.
  const invoicesWithJournal = new Set(
    invoiceJournalLines.map((row) => row.documentId)
  );
  const clearedByLine = new Map<
    string,
    { quantity: number; amount: number; legacyQuantity: number }
  >();
  const cleared = (purchaseOrderLineId: string) => {
    const current = clearedByLine.get(purchaseOrderLineId) ?? {
      quantity: 0,
      amount: 0,
      legacyQuantity: 0
    };
    clearedByLine.set(purchaseOrderLineId, current);
    return current;
  };
  for (const row of invoiceJournalLines) {
    const reference = row.documentLineReference ?? "";
    if (!row.isClearing || !reference.startsWith(invoicePrefix)) continue;
    const current = cleared(reference.slice(invoicePrefix.length));
    current.quantity += Number(row.quantity ?? 0);
    // A debit on the liability: natural-signed negative.
    current.amount -= Number(row.amount ?? 0);
  }
  for (const line of invoiceLines) {
    if (!line.purchaseOrderLineId || invoicesWithJournal.has(line.invoiceId)) {
      continue;
    }
    cleared(line.purchaseOrderLineId).legacyQuantity +=
      Number(line.quantity) * Number(line.conversionFactor ?? 1);
  }

  const items: DraftItem[] = [];
  for (const [purchaseOrderLineId, receipt] of receivedByLine) {
    const clearing = clearedByLine.get(purchaseOrderLineId);
    const unitCost =
      Math.abs(receipt.quantity) > EPSILON
        ? receipt.cost / receipt.quantity
        : 0;
    const legacyQuantity = clearing
      ? Math.min(
          clearing.legacyQuantity,
          Math.max(0, receipt.quantity - clearing.quantity)
        )
      : 0;
    const clearedQuantity = (clearing?.quantity ?? 0) + legacyQuantity;
    const clearedAmount = (clearing?.amount ?? 0) + legacyQuantity * unitCost;
    if (receipt.quantity - clearedQuantity <= EPSILON) continue;
    items.push({
      openItemType: "Received Not Invoiced",
      accountId: grIrAccountId,
      basis: "natural",
      original: round(receipt.cost),
      settled: round(clearedAmount),
      documentType: null,
      documentId: null,
      documentLineReference: journalReference.to.receipt(purchaseOrderLineId),
      description: GOODS_RECEIVED_NOT_INVOICED_DESCRIPTION,
      quantity: round(receipt.quantity),
      settledLine:
        clearedQuantity > EPSILON || Math.abs(clearedAmount) > EPSILON
          ? {
              documentLineReference:
                journalReference.to.purchaseInvoice(purchaseOrderLineId),
              description: GR_IR_CLEARING_DESCRIPTION,
              quantity: round(clearedQuantity)
            }
          : null
    });
  }
  return items;
}

/**
 * Work in progress: per job, its lines on the WIP account dated before the
 * cutover, as `close-job` sums them. Every job with a balance, whatever its
 * status, so the account's opening balance is the sum of its jobs.
 */
async function getWorkInProgressItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults
): Promise<DraftItem[]> {
  const rows = await db
    .selectFrom("journalLine as line")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "line.journalId")
        .onRef("journal.companyId", "=", "line.companyId")
    )
    .innerJoin("job", (join) =>
      join
        .onRef("job.id", "=", "line.documentId")
        .onRef("job.companyId", "=", "line.companyId")
    )
    .select([
      "job.id as jobId",
      sql<number>`sum("line"."amount")`.as("balance")
    ])
    .where("line.companyId", "=", companyId)
    .where("line.accountId", "=", defaults.workInProgressAccount)
    .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
    .where("journal.postingDate", "<", cutoverDate)
    .groupBy("job.id")
    .execute();
  return rows.map((row) => ({
    openItemType: "Work in Progress",
    accountId: defaults.workInProgressAccount,
    basis: "natural",
    original: round(Number(row.balance)),
    settled: 0,
    documentType: null,
    documentId: row.jobId,
    documentLineReference: null,
    description: "WIP Account"
  }));
}

/**
 * Deferred revenue: the Deferral rows dated on or after the cutover of sales
 * invoices posted before it, per invoice line, that were still deferred the
 * day before the cutover. The balance sits on
 * the row's DEBIT account (the deferred revenue liability the run debits);
 * its credit account is the revenue the run credits.
 */
async function getDeferredRevenueItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults
): Promise<DraftItem[]> {
  const rows = await db
    .selectFrom("revenueRecognitionSchedule as schedule")
    .innerJoin("salesInvoiceLine as line", (join) =>
      join
        .onRef("line.id", "=", "schedule.salesInvoiceLineId")
        .onRef("line.companyId", "=", "schedule.companyId")
    )
    .innerJoin("salesInvoice as invoice", (join) =>
      join
        .onRef("invoice.id", "=", "line.invoiceId")
        .onRef("invoice.companyId", "=", "line.companyId")
    )
    .select([
      "invoice.id as invoiceId",
      "line.id as invoiceLineId",
      "schedule.debitAccountId",
      sql<number>`sum("schedule"."amount")`.as("amount")
    ])
    .where("schedule.companyId", "=", companyId)
    .where("schedule.type", "=", "Deferral")
    // Still deferred the day before the cutover: Planned, or Posted by a run
    // whose journal the reset deleted. The enable writes that run's journal
    // again (activate-accounting/legacy/runs.ts), and it debits this balance.
    .where((eb) =>
      eb.or([
        eb("schedule.status", "=", "Planned"),
        eb.and([
          eb("schedule.status", "=", "Posted"),
          eb("schedule.journalId", "is", null),
          eb("schedule.runLineId", "is not", null)
        ])
      ])
    )
    .where("schedule.scheduledDate", ">=", cutoverDate)
    .where("invoice.postingDate", "<", cutoverDate)
    .where("invoice.status", "not in", ["Draft", "Pending", "Voided"])
    .groupBy(["invoice.id", "line.id", "schedule.debitAccountId"])
    .execute();
  return rows.map((row) => {
    // Before the cutover an empty deferred revenue default wrote the row on
    // retained earnings; the enable re-points it.
    const accountId =
      row.debitAccountId === defaults.retainedEarningsAccount
        ? defaults.deferredRevenueAccount
        : row.debitAccountId;
    if (!accountId) {
      throw new Error("Set the deferredRevenueAccount account default");
    }
    return {
      openItemType: "Deferred Revenue",
      accountId,
      basis: "debit",
      // A credit balance: the run will debit it.
      original: -round(Number(row.amount)),
      settled: 0,
      documentType: "Invoice",
      documentId: row.invoiceId,
      documentLineReference: journalReference.to.salesInvoice(
        row.invoiceLineId
      ),
      description: "Deferred Revenue"
    };
  });
}

/**
 * Lease net investment: per rental agreement, the closing net investment of
 * each lease line commenced before the cutover at its last schedule line
 * before the cutover, or its initial net investment when no schedule line
 * falls before it. Read from the lease rows, not the commencement journal:
 * a lease commenced before the reset has none. Commencement sells the unit
 * to the lease, so the date is its asset's disposal date.
 */
async function getLeaseNetInvestmentItems(
  db: CutoverDb,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults
): Promise<DraftItem[]> {
  const leaseLines = await db
    .selectFrom("rentalAgreementLine as line")
    .innerJoin("rentalAgreement as agreement", (join) =>
      join
        .onRef("agreement.id", "=", "line.rentalAgreementId")
        .onRef("agreement.companyId", "=", "line.companyId")
    )
    .innerJoin("fixedAsset as asset", (join) =>
      join
        .onRef("asset.id", "=", "line.fixedAssetId")
        .onRef("asset.companyId", "=", "line.companyId")
    )
    .select([
      "line.id",
      "line.rentalAgreementId",
      "line.initialNetInvestment",
      "agreement.exchangeRate"
    ])
    .where("line.companyId", "=", companyId)
    .where("line.lessorClassification", "=", "Sale")
    .where("line.initialNetInvestment", "is not", null)
    .where("asset.disposalDate", "<", cutoverDate)
    .execute();
  if (leaseLines.length === 0) return [];

  const lastScheduleLines = await db
    .selectFrom("rentalLeaseScheduleLine")
    .distinctOn("rentalAgreementLineId")
    .select(["rentalAgreementLineId", "closingNetInvestment"])
    .where("companyId", "=", companyId)
    .where(
      "rentalAgreementLineId",
      "in",
      leaseLines.map((line) => line.id)
    )
    .where("periodDate", "<", cutoverDate)
    .orderBy("rentalAgreementLineId")
    .orderBy("periodDate", "desc")
    .execute();
  const closingByLine = new Map(
    lastScheduleLines.map((row) => [
      row.rentalAgreementLineId,
      Number(row.closingNetInvestment)
    ])
  );

  const byAgreement = new Map<string, number>();
  for (const line of leaseLines) {
    const netInvestment =
      closingByLine.get(line.id) ?? Number(line.initialNetInvestment ?? 0);
    const rate = Number(line.exchangeRate ?? 1) || 1;
    addTo(byAgreement, line.rentalAgreementId, netInvestment / rate);
  }
  const accountId = defaults.netInvestmentInLeasesAccount;
  const items: DraftItem[] = [];
  for (const [rentalAgreementId, netInvestment] of byAgreement) {
    if (Math.abs(netInvestment) <= EPSILON) continue;
    if (!accountId) {
      throw new Error("Set the netInvestmentInLeasesAccount account default");
    }
    items.push({
      openItemType: "Lease Net Investment",
      accountId,
      basis: "debit",
      original: round(netInvestment),
      settled: 0,
      documentType: "Rental Agreement",
      documentId: rentalAgreementId,
      documentLineReference: null,
      description: "Net Investment in Leases"
    });
  }
  return items;
}

/** Converts draft items to open items, signed for each account's class. */
async function finishItems(
  db: CutoverDb,
  companyGroupId: string,
  drafts: DraftItem[]
): Promise<OpenItem[]> {
  const accounts = await getAccounts(
    db,
    companyGroupId,
    drafts.map((item) => item.accountId)
  );
  const items: OpenItem[] = [];
  for (const draft of drafts) {
    const accountClass = requireClass(accounts, draft.accountId);
    const sign = (value: number) =>
      draft.basis === "debit" ? toNatural(value, accountClass) : value;
    const originalAmount = round(sign(draft.original));
    const settledBeforeCutover = round(sign(draft.settled));
    const amount = round(originalAmount - settledBeforeCutover);
    if (Math.abs(amount) <= EPSILON) continue;
    items.push({
      openItemType: draft.openItemType,
      accountId: draft.accountId,
      accountClass,
      amount,
      originalAmount,
      settledBeforeCutover,
      documentType: draft.documentType,
      documentId: draft.documentId,
      documentLineReference: draft.documentLineReference,
      description: draft.description,
      ...(draft.quantity != null ? { quantity: draft.quantity } : {}),
      ...(draft.settledLine ? { settled: draft.settledLine } : {})
    });
  }
  return items;
}

/**
 * Every document-level item open at the cutover, in base currency, positive
 * on the natural side of its account: receivables, payables, unapplied
 * credit, deposits, received-not-invoiced, work in progress, deferred revenue
 * and lease net investment. Inventory and fixed assets come from
 * `getCutoverInventory` and `getCutoverFixedAssets`.
 */
export async function getCutoverOpenItems(
  db: CutoverDb,
  { companyId, cutoverDate }: CutoverArgs
): Promise<OpenItem[]> {
  const [company, defaults, settlements] = await Promise.all([
    getCompany(db, companyId),
    getAccountDefaults(db, companyId),
    getSettlementsBeforeCutover(db, companyId, cutoverDate)
  ]);
  const groups = await Promise.all([
    getReceivableAndPayableItems(
      db,
      companyId,
      cutoverDate,
      defaults,
      settlements
    ),
    getUnappliedPaymentItems(db, companyId, cutoverDate, defaults, settlements),
    getReceivedNotInvoicedItems(db, companyId, cutoverDate, defaults),
    getWorkInProgressItems(db, companyId, cutoverDate, defaults),
    getDeferredRevenueItems(db, companyId, cutoverDate, defaults),
    getLeaseNetInvestmentItems(db, companyId, cutoverDate, defaults)
  ]);
  return finishItems(db, company.companyGroupId, groups.flat());
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export type CutoverInventoryItem = {
  itemId: string;
  readableId: string;
  name: string;
  /** On-hand at the cutover across every location (`itemLedger`). */
  quantity: number;
  /** The default unit cost the reset uses. */
  unitCost: number;
  costingMethod: string;
  inventoryAccountId: string;
};

/**
 * Per inventory item, the on-hand quantity at the cutover across every
 * location and its default unit cost: the standard cost for a Standard item;
 * for a FIFO or LIFO item, the value of its stock at the cutover replayed
 * from the layers dated before it (`unitCostAtCutover`); for an Average item,
 * `itemCost.unitCost`. The inventory account follows
 * the item's replenishment, as the postings resolve it.
 */
export async function getCutoverInventory(
  db: CutoverDb,
  { companyId, cutoverDate }: CutoverArgs
): Promise<CutoverInventoryItem[]> {
  const [defaults, onHand, layers] = await Promise.all([
    getAccountDefaults(db, companyId),
    db
      .selectFrom("itemLedger")
      .innerJoin("item", (join) =>
        join
          .onRef("item.id", "=", "itemLedger.itemId")
          .onRef("item.companyId", "=", "itemLedger.companyId")
      )
      .leftJoin("itemCost", (join) =>
        join
          .onRef("itemCost.itemId", "=", "item.id")
          .onRef("itemCost.companyId", "=", "item.companyId")
      )
      .select([
        "item.id as itemId",
        "item.readableId",
        "item.name",
        "item.replenishmentSystem",
        "itemCost.costingMethod",
        "itemCost.unitCost",
        "itemCost.standardCost",
        sql<number>`sum("itemLedger"."quantity")`.as("quantity")
      ])
      .where("itemLedger.companyId", "=", companyId)
      .where("itemLedger.postingDate", "<", cutoverDate)
      .where("item.itemTrackingType", "!=", "Non-Inventory")
      .groupBy([
        "item.id",
        "item.readableId",
        "item.name",
        "item.replenishmentSystem",
        "itemCost.costingMethod",
        "itemCost.unitCost",
        "itemCost.standardCost"
      ])
      .having(sql`sum("itemLedger"."quantity")`, "<>", 0)
      .orderBy("item.readableId")
      .execute(),
    // Every layer `calculateCOGS` relieves, dated before the cutover, oldest
    // first, with the cost adjustments posted against it before the cutover.
    db
      .selectFrom("costLedger as layer")
      .leftJoin("costLedger as child", (join) =>
        join
          .onRef("child.appliesToCostLedgerId", "=", "layer.id")
          .onRef("child.companyId", "=", "layer.companyId")
          .on("child.postingDate", "<", cutoverDate)
      )
      .select([
        "layer.itemId",
        "layer.quantity",
        sql<number>`"layer"."cost" + coalesce(sum("child"."cost"), 0)`.as(
          "cost"
        )
      ])
      .where("layer.companyId", "=", companyId)
      .where("layer.postingDate", "<", cutoverDate)
      .where("layer.quantity", ">", 0)
      .where("layer.adjustment", "=", false)
      .where("layer.appliesToCostLedgerId", "is", null)
      .where((eb) =>
        eb.or([
          eb("layer.documentType", "is", null),
          eb("layer.documentType", "!=", "Purchase Order")
        ])
      )
      .groupBy([
        "layer.id",
        "layer.itemId",
        "layer.quantity",
        "layer.cost",
        "layer.postingDate",
        "layer.createdAt"
      ])
      .orderBy("layer.postingDate")
      .orderBy("layer.createdAt")
      .execute()
  ]);

  const layersByItem = new Map<string, LayerBeforeCutover[]>();
  for (const layer of layers) {
    if (!layer.itemId) continue;
    const list = layersByItem.get(layer.itemId) ?? [];
    list.push({ quantity: Number(layer.quantity), cost: Number(layer.cost) });
    layersByItem.set(layer.itemId, list);
  }

  return onHand.map((row) => {
    const costingMethod = row.costingMethod ?? "FIFO";
    const quantity = Number(row.quantity);
    const unitCost =
      costingMethod === "Standard"
        ? Number(row.standardCost ?? 0)
        : costingMethod === "FIFO" || costingMethod === "LIFO"
          ? unitCostAtCutover(
              layersByItem.get(row.itemId) ?? [],
              quantity,
              costingMethod,
              Number(row.unitCost ?? 0)
            )
          : Number(row.unitCost ?? 0);
    const isMade =
      row.replenishmentSystem === "Make" ||
      row.replenishmentSystem === "Buy and Make";
    return {
      itemId: row.itemId,
      readableId: row.readableId,
      name: row.name,
      quantity: round(quantity),
      unitCost,
      costingMethod,
      inventoryAccountId: isMade
        ? defaults.finishedGoodsAccount
        : defaults.rawMaterialsAccount
    };
  });
}

// ---------------------------------------------------------------------------
// Fixed assets
// ---------------------------------------------------------------------------

export type CutoverFixedAsset = {
  id: string;
  fixedAssetId: string;
  name: string;
  status: string;
  fixedAssetClassId: string;
  cost: number;
  /** As of the day before the cutover. */
  accumulatedDepreciation: number;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
};

/**
 * Assets disposed on or after the cutover whose disposal has no journal and
 * gets none at the enable (`assetsLeavingWithoutJournal`,
 * legacy-documents.ts). Such an asset leaves the books with no journal, so it
 * is not in the opening fixed assets, and its depreciation after the cutover
 * is not rebuilt.
 */
export async function getAssetsLeavingWithoutJournal(
  db: CutoverDb,
  args: CutoverArgs
): Promise<Set<string>> {
  const rows = await assetsLeavingWithoutJournal(db, args).execute();
  return new Set(rows.map((row) => row.id));
}

/**
 * Per asset, the depreciation that Posted runs booked for months on or after
 * the cutover. The asset's `accumulatedDepreciation` includes it; the enable
 * writes those runs' journals again (activate-accounting/legacy/runs.ts), so
 * the opening balance takes it out.
 */
export async function getDepreciationAfterCutover(
  db: CutoverDb,
  { companyId, cutoverDate }: CutoverArgs
): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom("depreciationRunLine as line")
    .innerJoin("depreciationRun as run", (join) =>
      join
        .onRef("run.id", "=", "line.depreciationRunId")
        .onRef("run.companyId", "=", "line.companyId")
    )
    .select([
      "line.fixedAssetId",
      sql<number>`sum("line"."amount")`.as("amount")
    ])
    .where("line.companyId", "=", companyId)
    .where("run.status", "=", "Posted")
    // A line from before per-month lines has no month: it is the run's.
    .where(
      sql<string>`coalesce("line"."periodEnd", "run"."periodEnd")`,
      ">=",
      cutoverDate
    )
    .groupBy("line.fixedAssetId")
    .execute();
  return new Map(
    rows.map((row) => [row.fixedAssetId, round(Number(row.amount))])
  );
}

/**
 * The fixed assets on the books the day before the cutover, with their class
 * accounts: acquired before the cutover, and not disposed, or disposed on or
 * after it by a disposal that carries a journal after the enable (see
 * `getAssetsLeavingWithoutJournal`). `accumulatedDepreciation` is as of the
 * day before the cutover: the asset's own less what runs booked for months
 * on or after it.
 */
export async function getCutoverFixedAssets(
  db: CutoverDb,
  args: CutoverArgs
): Promise<CutoverFixedAsset[]> {
  const { companyId, cutoverDate } = args;
  const [rows, leavingWithoutJournal, depreciationAfter] = await Promise.all([
    db
      .selectFrom("fixedAsset as asset")
      .innerJoin("fixedAssetClass as class", (join) =>
        join
          .onRef("class.id", "=", "asset.fixedAssetClassId")
          .onRef("class.companyId", "=", "asset.companyId")
      )
      .select([
        "asset.id",
        "asset.fixedAssetId",
        "asset.name",
        "asset.status",
        "asset.fixedAssetClassId",
        "asset.acquisitionCost",
        "asset.accumulatedDepreciation",
        "class.assetAccountId",
        "class.accumulatedDepreciationAccountId"
      ])
      .where("asset.companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("asset.status", "!=", "Disposed"),
          eb("asset.disposalDate", ">=", cutoverDate)
        ])
      )
      .where("asset.acquisitionDate", "<", cutoverDate)
      .orderBy("asset.fixedAssetId")
      .execute(),
    getAssetsLeavingWithoutJournal(db, args),
    getDepreciationAfterCutover(db, args)
  ]);
  return rows
    .filter((row) => !leavingWithoutJournal.has(row.id))
    .map((row) => ({
      id: row.id,
      fixedAssetId: row.fixedAssetId,
      name: row.name,
      status: row.status,
      fixedAssetClassId: row.fixedAssetClassId,
      cost: Number(row.acquisitionCost),
      accumulatedDepreciation: round(
        Number(row.accumulatedDepreciation) -
          (depreciationAfter.get(row.id) ?? 0)
      ),
      assetAccountId: row.assetAccountId,
      accumulatedDepreciationAccountId: row.accumulatedDepreciationAccountId
    }));
}

// ---------------------------------------------------------------------------
// Trial balance and Migration Clearing
// ---------------------------------------------------------------------------

async function getDraftOpeningJournal(db: CutoverDb, companyId: string) {
  return db
    .selectFrom("journal")
    .select(["id", "journalEntryId", "postingDate"])
    .where("companyId", "=", companyId)
    .where("status", "=", "Draft")
    .where("sourceType", "=", OPENING_BALANCE_SOURCE)
    .orderBy("createdAt")
    .executeTakeFirst();
}

/**
 * The prior system's trial balance: the lines of the company's Draft
 * opening balance journal, as debit and credit per account.
 */
export async function getOpeningTrialBalance(
  db: CutoverDb,
  { companyId }: { companyId: string }
): Promise<{ journalId: string | null; lines: TrialBalanceLine[] }> {
  const company = await getCompany(db, companyId);
  const journal = await getDraftOpeningJournal(db, companyId);
  if (!journal) return { journalId: null, lines: [] };
  const rows = await db
    .selectFrom("journalLine")
    .select(["accountId", "amount"])
    .where("companyId", "=", companyId)
    .where("journalId", "=", journal.id)
    .execute();
  const accounts = await getAccounts(
    db,
    company.companyGroupId,
    rows.map((row) => row.accountId).filter((id): id is string => !!id)
  );
  const debitByAccount = new Map<string, number>();
  for (const row of rows) {
    if (!row.accountId) continue;
    const accountClass = requireClass(accounts, row.accountId);
    addTo(
      debitByAccount,
      row.accountId,
      toDebit(Number(row.amount), accountClass)
    );
  }
  return {
    journalId: journal.id,
    lines: [...debitByAccount].map(([accountId, debit]) => ({
      accountId,
      accountClass: requireClass(accounts, accountId),
      debit: debit > 0 ? round(debit) : 0,
      credit: debit < 0 ? round(-debit) : 0
    }))
  };
}

export type CutoverOpeningInputs = {
  /** Open items, inventory per account and fixed assets per class account. */
  items: OpenItem[];
  trialBalance: TrialBalanceLine[];
  /** Accounts whose opening balance comes from Carbon, not the trial balance. */
  controlAccountIds: Set<string>;
  migrationClearingAccountId: string | null;
};

/**
 * Everything the opening journal and Migration Clearing are built from. The
 * control accounts are the defaults that carry open items, every fixed asset
 * class's asset and accumulated depreciation accounts, and every account an
 * item lands on.
 */
export async function getCutoverOpeningInputs(
  db: CutoverDb,
  { companyId, cutoverDate }: CutoverArgs
): Promise<CutoverOpeningInputs> {
  const [
    company,
    defaults,
    openItems,
    inventory,
    fixedAssets,
    classes,
    trialBalance
  ] = await Promise.all([
    getCompany(db, companyId),
    getAccountDefaults(db, companyId),
    getCutoverOpenItems(db, { companyId, cutoverDate }),
    getCutoverInventory(db, { companyId, cutoverDate }),
    getCutoverFixedAssets(db, { companyId, cutoverDate }),
    db
      .selectFrom("fixedAssetClass")
      .select(["assetAccountId", "accumulatedDepreciationAccountId"])
      .where("companyId", "=", companyId)
      .execute(),
    getOpeningTrialBalance(db, { companyId })
  ]);

  // Inventory per account, valued as the reset values each opening layer.
  const inventoryByAccount = new Map<string, number>();
  for (const item of inventory) {
    if (item.quantity <= EPSILON) continue;
    addTo(
      inventoryByAccount,
      item.inventoryAccountId,
      round(item.quantity * item.unitCost)
    );
  }
  const costByAccount = new Map<string, number>();
  const depreciationByAccount = new Map<string, number>();
  for (const asset of fixedAssets) {
    addTo(costByAccount, asset.assetAccountId, asset.cost);
    addTo(
      depreciationByAccount,
      asset.accumulatedDepreciationAccountId,
      asset.accumulatedDepreciation
    );
  }
  const drafts: DraftItem[] = [
    ...[...inventoryByAccount].map(
      ([accountId, value]): DraftItem => ({
        openItemType: "Inventory",
        accountId,
        basis: "debit",
        original: value,
        settled: 0,
        documentType: null,
        documentId: null,
        documentLineReference: null,
        description: "Inventory"
      })
    ),
    ...[...costByAccount].map(
      ([accountId, value]): DraftItem => ({
        openItemType: "Fixed Asset Cost",
        accountId,
        basis: "debit",
        original: value,
        settled: 0,
        documentType: null,
        documentId: null,
        documentLineReference: null,
        description: "Fixed Asset Cost"
      })
    ),
    ...[...depreciationByAccount].map(
      ([accountId, value]): DraftItem => ({
        openItemType: "Accumulated Depreciation",
        accountId,
        basis: "debit",
        // A credit balance.
        original: -value,
        settled: 0,
        documentType: null,
        documentId: null,
        documentLineReference: null,
        description: "Accumulated Depreciation"
      })
    )
  ];
  const items = [
    ...openItems,
    ...(await finishItems(db, company.companyGroupId, drafts))
  ];

  const controlAccountIds = new Set<string>(
    [
      defaults.receivablesAccount,
      defaults.payablesAccount,
      defaults.intercompanyReceivablesAccount,
      defaults.intercompanyPayablesAccount,
      defaults.prepaymentAccount,
      defaults.goodsReceivedNotInvoicedAccount,
      defaults.workInProgressAccount,
      defaults.rawMaterialsAccount,
      defaults.finishedGoodsAccount,
      defaults.deferredRevenueAccount,
      defaults.netInvestmentInLeasesAccount,
      ...classes.flatMap((row) => [
        row.assetAccountId,
        row.accumulatedDepreciationAccountId
      ]),
      ...items.map((item) => item.accountId)
    ].filter((id): id is string => Boolean(id))
  );

  return {
    items,
    trialBalance: trialBalance.lines,
    controlAccountIds,
    migrationClearingAccountId: defaults.migrationClearingAccount
  };
}

/**
 * Migration Clearing per control account: what the trial balance asserts,
 * what Carbon's open items, inventory and fixed assets hold, and the
 * difference. The enable needs `total` to be zero within 0.01.
 */
export async function getMigrationClearing(
  db: CutoverDb,
  args: CutoverArgs
): Promise<
  { rows: MigrationClearingRow[]; total: number } & CutoverOpeningInputs
> {
  const inputs = await getCutoverOpeningInputs(db, args);
  const { rows, total } = migrationClearingByAccount(
    inputs.items,
    inputs.trialBalance,
    inputs.controlAccountIds
  );
  return { rows, total, ...inputs };
}

// ---------------------------------------------------------------------------
// Writes before the enable
// ---------------------------------------------------------------------------

async function refuseAfterCutover(db: CutoverDb, companyId: string) {
  const settings = await db
    .selectFrom("companySettings")
    .select("accountingCutoverDate")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!settings) throw new Error("Company settings not found");
  if (settings.accountingCutoverDate) {
    throw new Error(ACCOUNTING_ALREADY_SET_UP);
  }
}

/**
 * Keeps one Draft opening balance journal, dated the day before the cutover
 * with no accounting period, and replaces its lines with `lines`. Each line
 * becomes a natural-balance-signed amount on its account.
 */
export async function saveOpeningTrialBalance(
  db: CutoverDb,
  {
    companyId,
    cutoverDate,
    userId,
    lines
  }: CutoverArgs & {
    userId: string;
    lines: { accountId: string; debit: number; credit: number }[];
  }
): Promise<{ journalId: string }> {
  return withTransaction(db, async (trx) => {
    await refuseAfterCutover(trx, companyId);
    const company = await getCompany(trx, companyId);
    const accounts = await getAccounts(
      trx,
      company.companyGroupId,
      lines.map((line) => line.accountId)
    );
    const amountByAccount = new Map<string, number>();
    for (const line of lines) {
      if (!accounts.has(line.accountId)) {
        throw new Error(`Account ${line.accountId} not found`);
      }
      const accountClass = requireClass(accounts, line.accountId);
      addTo(
        amountByAccount,
        line.accountId,
        toNatural(
          Number(line.debit ?? 0) - Number(line.credit ?? 0),
          accountClass
        )
      );
    }

    const postingDate = dayBeforeCutover(cutoverDate);
    const existing = await getDraftOpeningJournal(trx, companyId);
    let journalId: string;
    if (existing) {
      journalId = existing.id;
      await trx
        .updateTable("journal")
        .set({
          postingDate,
          accountingPeriodId: null,
          updatedBy: userId,
          updatedAt: sql`now()`
        })
        .where("id", "=", journalId)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .deleteFrom("journalLine")
        .where("journalId", "=", journalId)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      const journalEntryId = await getNextSequence(
        trx,
        "journalEntry",
        companyId
      );
      const journal = await trx
        .insertInto("journal")
        .values({
          journalEntryId,
          description: OPENING_TRIAL_BALANCE_DESCRIPTION,
          postingDate,
          status: "Draft",
          sourceType: OPENING_BALANCE_SOURCE,
          accountingPeriodId: null,
          companyId,
          createdBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      journalId = journal.id;
    }

    const inserts = [...amountByAccount]
      .map(([accountId, amount]) => ({ accountId, amount: round(amount) }))
      .filter((line) => line.amount !== 0)
      .map((line) => ({
        journalId,
        accountId: line.accountId,
        amount: line.amount,
        description: OPENING_TRIAL_BALANCE_DESCRIPTION,
        quantity: 0,
        journalLineReference: nanoid(),
        companyId,
        createdBy: userId
      }));
    if (inserts.length > 0) {
      await trx.insertInto("journalLine").values(inserts).execute();
    }
    return { journalId };
  });
}

/**
 * Sets an asset's accumulated depreciation as of the day before the cutover,
 * before the enable. The asset keeps what runs booked for months on or after
 * the cutover on top of it, so the stored value is the entered one plus that
 * (see `getDepreciationAfterCutover`). Returns the value as of the day
 * before the cutover.
 */
export async function updateCutoverAccumulatedDepreciation(
  db: CutoverDb,
  {
    companyId,
    cutoverDate,
    fixedAssetId,
    accumulatedDepreciation,
    userId
  }: {
    companyId: string;
    cutoverDate: string;
    fixedAssetId: string;
    accumulatedDepreciation: number;
    userId?: string;
  }
): Promise<{ id: string; accumulatedDepreciation: number }> {
  if (
    !Number.isFinite(accumulatedDepreciation) ||
    accumulatedDepreciation < 0
  ) {
    throw new Error("Accumulated depreciation must be zero or more");
  }
  return withTransaction(db, async (trx) => {
    await refuseAfterCutover(trx, companyId);
    const asset = await trx
      .selectFrom("fixedAsset")
      .select(["id", "status", "acquisitionCost"])
      .where("id", "=", fixedAssetId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!asset) throw new Error("Fixed asset not found");
    if (asset.status === "Disposed") {
      // A disposal after the cutover cleared the accumulated depreciation it
      // found; changing it now would part the asset from its disposal.
      throw new Error(
        "A disposed asset keeps the accumulated depreciation its disposal cleared"
      );
    }
    const after =
      (await getDepreciationAfterCutover(trx, { companyId, cutoverDate })).get(
        fixedAssetId
      ) ?? 0;
    const stored = round(accumulatedDepreciation + after);
    if (stored > Number(asset.acquisitionCost) + EPSILON) {
      throw new Error(
        "Accumulated depreciation cannot exceed the asset's cost"
      );
    }
    const updated = await trx
      .updateTable("fixedAsset")
      .set({
        accumulatedDepreciation: stored,
        ...(userId ? { updatedBy: userId, updatedAt: sql`now()` } : {})
      })
      .where("id", "=", fixedAssetId)
      .where("companyId", "=", companyId)
      .returning(["id", "accumulatedDepreciation"])
      .executeTakeFirstOrThrow();
    return {
      id: updated.id,
      accumulatedDepreciation: round(
        Number(updated.accumulatedDepreciation) - after
      )
    };
  });
}

/**
 * The legacy documents the enable journals (spec section 5a), per family, in
 * one statement: posted on or after the cutover with no journal. It counts
 * the rows of the detection the enable runs (legacy-documents.ts). A sales
 * shipment that stored no cost row counts: the enable writes the row first.
 * The enable returns the journals it wrote, and writes none for a document
 * whose journal has no lines, so its count can be lower.
 *
 * Grouped as the enable groups its journals: a job issue per job and posting
 * date, and a job completion per completion, on a day with no job journal;
 * an adjustment per document and instant (a movement with no document per
 * instant, so a CSV import is one); a depreciation or recognition run per
 * run. The keys are in the order the enable writes the families
 * (`LEGACY_DOCUMENT_FAMILIES`).
 */
export async function getLegacyDocumentCounts(
  db: CutoverDb,
  args: CutoverArgs
): Promise<LegacyDocumentCounts> {
  const adjustmentFamily = (
    family: Extract<
      keyof LegacyDocumentCounts,
      | "inventoryAdjustments"
      | "inventoryCounts"
      | "nonConformances"
      | "maintenanceConsumptions"
    >
  ) => sql<number>`(
    SELECT count(DISTINCT CASE
      WHEN "documentType" IS NULL THEN "createdAt"
      ELSE "documentType"::text || ':' || "documentId" || ':' || "createdAt"
    END)::int
    FROM "adjustment"
    WHERE "family" = ${family}
  )`;
  // A query in the template is a parenthesized subquery.
  const count = (query: { clearOrderBy(): Expression<unknown> }) =>
    sql<number>`(SELECT count(*)::int FROM ${query.clearOrderBy()} AS "row")`;

  const counts = await sql<LegacyDocumentCounts>`
    WITH
      "adjustment" AS ${legacyAdjustmentCostRows(db, args).clearOrderBy()},
      "jobMovement" AS ${legacyJobMovements(db, args).clearOrderBy()}
    SELECT
      ${count(legacySalesInvoices(db, args))} AS "salesInvoices",
      ${count(legacyPurchaseInvoices(db, args))} AS "purchaseInvoices",
      ${count(legacyMemos(db, args))} AS "memos",
      ${count(legacyCharges(db, args))} AS "charges",
      ${count(legacyReimbursements(db, args))} AS "reimbursements",
      ${count(legacyPayments(db, args))} AS "payments",
      ${count(legacyReceipts(db, args, "Purchase Order"))} AS "purchaseReceipts",
      ${count(legacyReceipts(db, args, "Sales Return Order"))} AS "salesReturnReceipts",
      ${count(
        legacyShipments(db, args, LEGACY_SALES_SHIPMENT, {
          withUncostedSales: true
        })
      )} AS "salesShipments",
      ${count(legacyShipments(db, args, LEGACY_SALES_RETURN_SHIPMENT))}
        + ${count(legacyShipments(db, args, LEGACY_PURCHASE_RETURN_SHIPMENT))}
        AS "returnShipments",
      ${adjustmentFamily("inventoryAdjustments")} AS "inventoryAdjustments",
      ${adjustmentFamily("inventoryCounts")} AS "inventoryCounts",
      ${adjustmentFamily("nonConformances")} AS "nonConformances",
      ${adjustmentFamily("maintenanceConsumptions")} AS "maintenanceConsumptions",
      (
        SELECT count(DISTINCT ("documentId", "postingDate"))::int
        FROM "jobMovement"
        WHERE "entryType" = 'Consumption' AND NOT "journaled"
      ) AS "jobConsumptions",
      (
        SELECT count(DISTINCT ("documentId", "itemId", "postingDate", "createdAt"))::int
        FROM "jobMovement"
        WHERE "entryType" = 'Assembly Output' AND NOT "journaled"
      ) AS "jobOutputs",
      (
        SELECT count(DISTINCT "depreciationRunId")::int
        FROM ${legacyDepreciationRunLines(db, args).clearOrderBy()} AS "line"
      ) AS "depreciationRuns",
      ${count(legacyDisposals(db, args))} AS "assetDisposals",
      (
        SELECT count(DISTINCT "runId")::int
        FROM ${legacyRecognitionSchedule(db, args).clearOrderBy()} AS "schedule"
      ) AS "revenueRecognitionRuns"
  `.execute(db);
  const row = counts.rows[0];
  return Object.fromEntries(
    LEGACY_DOCUMENT_FAMILIES.map((family) => [
      family,
      Number(row?.[family] ?? 0)
    ])
  ) as LegacyDocumentCounts;
}
